// Cloud sync with the real engines and IndexedDB code. Only the network is replaced, by an in-memory server
// that follows the same version rules as the sync_push_collections database function.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { CloudAccount, openAccountDatabase, readAccountPointer } from '../src/lib/account';
import { IndexedDBStorage } from '../src/lib/idb';
import { AppStore } from '../src/lib/store';
import { CloudSync, type CloudBackend, type CloudEntry, type PushResult } from '../src/lib/sync';
import { defaults, fixedClock, nodeLoader } from './helpers';

class FakeCloud implements CloudBackend {
  rows = new Map<string, { data: unknown; version: number }>();
  online = true;
  pushes = 0;
  beforePush: (() => Promise<void>) | null = null;
  async listVersions() {
    this.assertOnline();
    return [...this.rows].map(([key, r]) => ({ key, version: r.version }));
  }
  async fetch(keys: string[]) {
    this.assertOnline();
    return keys.filter((k) => this.rows.has(k)).map((key) => ({ key, ...structuredClone(this.rows.get(key)!) }));
  }
  async push(entries: CloudEntry[]): Promise<PushResult> {
    this.assertOnline();
    const hook = this.beforePush;
    this.beforePush = null;
    await hook?.();
    this.pushes++;
    const conflicts = entries.filter((e) => (this.rows.get(e.key)?.version ?? 0) !== e.baseVersion).map((e) => ({ key: e.key, version: this.rows.get(e.key)?.version ?? 0 }));
    if (conflicts.length) return { ok: false, conflicts };
    for (const e of entries) this.rows.set(e.key, { data: structuredClone(e.data), version: e.baseVersion + 1 });
    return { ok: true, versions: entries.map((e) => ({ key: e.key, version: e.baseVersion + 1 })) };
  }
  private assertOnline() { if (!this.online) throw new TypeError('Failed to fetch'); }
}

async function device(cloud: FakeCloud, factory = new IDBFactory()) {
  const storage = await IndexedDBStorage.open({ factory, name: 'account', clock: fixedClock });
  storage.enableSyncTracking();
  const store = new AppStore({ loader: nodeLoader(), storage, defaults, clock: fixedClock, historyDelayMs: 5 });
  await store.init();
  const sync = new CloudSync({ store, storage, backend: cloud, clock: fixedClock, debounceMs: 60_000, isOnline: () => cloud.online });
  return { store, storage, sync, factory };
}
const practice = (store: AppStore, topic: string, attempted: number, correct: number) => store.engine.recordPractice(topic, { attempted, correct, date: '2026-11-19', stageId: 'tier1' });
const sessionsOf = (store: AppStore) => [...store.engine.getExamSessions('ssc-cgl')].map((s) => s.id).sort();

describe('cloud sync', () => {
  test('progress saved on one device appears on another, with identical calculations', async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.store.selectExam('ssc-cgl');
    a.store.engine.setStatus('quant.percentage', 'practicing');
    practice(a.store, 'quant.percentage', 40, 33);
    await a.store.flush();
    expect(await a.sync.syncNow()).toBe(true);
    const b = await device(cloud);
    expect(await b.sync.syncNow()).toBe(true);
    expect(b.store.activeExamId).toBe('ssc-cgl');
    expect(b.store.report()!.summary).toEqual(a.store.report()!.summary);
  });

  test('a repeated sync with no changes uploads nothing', async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.store.selectExam('ssc-cgl');
    a.store.engine.setStatus('quant.average', 'completed');
    await a.store.flush();
    await a.sync.syncNow();
    const b = await device(cloud);
    await b.sync.syncNow();
    const pushes = cloud.pushes;
    await a.sync.syncNow();
    await b.sync.syncNow();
    expect(cloud.pushes).toBe(pushes);
    expect(a.sync.hasUnsynced).toBe(false);
    expect(b.sync.hasUnsynced).toBe(false);
  });

  test('offline edits stay safe and upload when the connection returns', async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.store.selectExam('ssc-cgl');
    await a.store.flush();
    await a.sync.syncNow();
    cloud.online = false;
    practice(a.store, 'quant.average', 10, 9);
    await a.store.flush();
    expect(await a.sync.syncNow()).toBe(false);
    expect(a.sync.status).toBe('offline');
    expect(a.sync.hasUnsynced).toBe(true);
    cloud.online = true;
    expect(await a.sync.syncNow()).toBe(true);
    const b = await device(cloud);
    await b.sync.syncNow();
    expect(sessionsOf(b.store)).toEqual(sessionsOf(a.store));
  });

  test('an unsynced edit survives closing the app and is uploaded on the next start', async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.store.selectExam('ssc-cgl');
    await a.store.flush();
    await a.sync.syncNow();
    cloud.online = false;
    practice(a.store, 'quant.average', 12, 10);
    await a.store.flush();
    const expected = sessionsOf(a.store);
    a.storage.close();
    cloud.online = true;
    const reopened = await device(cloud, a.factory);
    expect(reopened.store.engine.loadIssues).toEqual([]); // collections never written are not reported as damaged
    expect(await reopened.sync.syncNow()).toBe(true);
    const b = await device(cloud);
    await b.sync.syncNow();
    expect(sessionsOf(b.store)).toEqual(expected);
  });

  test('edits made offline on two devices are combined on both, with nothing lost', async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.store.selectExam('ssc-cgl');
    await a.store.flush();
    await a.sync.syncNow();
    const b = await device(cloud);
    await b.sync.syncNow();
    practice(a.store, 'quant.percentage', 10, 8);
    a.store.engine.setStatus('quant.percentage', 'practicing');
    practice(b.store, 'quant.average', 20, 15);
    b.store.engine.setStatus('quant.average', 'completed');
    await a.store.flush();
    await b.store.flush();
    expect(await a.sync.syncNow()).toBe(true);
    expect(await b.sync.syncNow()).toBe(true);
    expect(await a.sync.syncNow()).toBe(true);
    expect(sessionsOf(a.store)).toHaveLength(2);
    expect(sessionsOf(b.store)).toEqual(sessionsOf(a.store));
    for (const d of [a, b]) {
      expect(d.store.engine.getExamRecords('ssc-cgl')!.topics['quant.percentage'].status).toBe('practicing');
      expect(d.store.engine.getExamRecords('ssc-cgl')!.topics['quant.average'].status).toBe('completed');
    }
    expect((await b.storage.listSnapshots()).some((s) => s.reason === 'before-sync')).toBe(true);
  });

  test('when another device saves first, the upload is retried without overwriting it', async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.store.selectExam('ssc-cgl');
    await a.store.flush();
    await a.sync.syncNow();
    const b = await device(cloud);
    await b.sync.syncNow();
    practice(b.store, 'quant.average', 5, 5);
    await b.store.flush();
    practice(a.store, 'quant.percentage', 5, 4);
    await a.store.flush();
    cloud.beforePush = async () => { await b.sync.syncNow(); };
    expect(await a.sync.syncNow()).toBe(true);
    await b.sync.syncNow();
    expect(sessionsOf(a.store)).toHaveLength(2);
    expect(sessionsOf(b.store)).toEqual(sessionsOf(a.store));
  });

  test('a deleted practice session stays deleted on a device with no conflicting edits', async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.store.selectExam('ssc-cgl');
    practice(a.store, 'quant.average', 10, 8);
    await a.store.flush();
    await a.sync.syncNow();
    const b = await device(cloud);
    await b.sync.syncNow();
    expect(sessionsOf(b.store)).toHaveLength(1);
    a.store.engine.deletePractice(sessionsOf(a.store)[0]);
    await a.store.flush();
    await a.sync.syncNow();
    await b.sync.syncNow();
    expect(sessionsOf(b.store)).toEqual([]);
  });

  test('invalid or newer-format cloud data is refused and local data is untouched', async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.store.selectExam('ssc-cgl');
    a.store.engine.setStatus('quant.average', 'completed');
    await a.store.flush();
    await a.sync.syncNow();
    const row = cloud.rows.get('progress')!;
    cloud.rows.set('progress', { version: row.version + 1, data: { ...(row.data as object), schemaVersion: 99 } });
    expect(await a.sync.syncNow()).toBe(false);
    expect(a.sync.status).toBe('error');
    expect(a.sync.error).toContain('newer than this app supports');
    expect(a.store.engine.getExamRecords('ssc-cgl')!.topics['quant.average'].status).toBe('completed');
  });

  test('a reset reaches other devices', async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.store.selectExam('ssc-cgl');
    practice(a.store, 'quant.average', 10, 8);
    await a.store.flush();
    await a.sync.syncNow();
    const b = await device(cloud);
    await b.sync.syncNow();
    await a.store.resetAll();
    expect(await a.sync.syncNow()).toBe(true);
    expect(await b.sync.syncNow()).toBe(true);
    expect(b.store.activeExamId).toBeNull();
    expect(b.store.engine.getExamSessions('ssc-cgl')).toHaveLength(0);
  });
});

const sessionFor = (id: string, email: string) => ({ user: { id, email, user_metadata: { full_name: email } } }) as unknown as Session;

function fakeClient(initial: Session | null) {
  let listener: ((event: string, session: Session | null) => void) | null = null;
  const state = { session: initial };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: state.session }, error: null }),
      onAuthStateChange: (cb: (event: string, session: Session | null) => void) => { listener = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => { state.session = null; return { error: null }; },
      signInWithOAuth: async () => ({ data: {}, error: null }),
    },
  } as unknown as SupabaseClient;
  return { client, state, emit: (event: string, session: Session | null) => listener?.(event, session) };
}

async function app(cloudFor: (userId: string) => FakeCloud, initial: Session | null, factory = new IDBFactory()) {
  const guest = await IndexedDBStorage.open({ factory, clock: fixedClock });
  const activeDb = await openAccountDatabase(readAccountPointer(), factory);
  const store = new AppStore({ loader: nodeLoader(), storage: activeDb ?? guest, defaults, clock: fixedClock, historyDelayMs: 5 });
  await store.init();
  const fake = fakeClient(initial);
  const account = new CloudAccount({ store, guest, activeDb, factory, debounceMs: 60_000, createClient: async () => fake.client, createBackend: (_c, id) => cloudFor(id) });
  store.account = account;
  await account.init();
  await account.sync?.syncNow();
  return { store, guest, account, fake, factory };
}

describe('accounts on a device', () => {
  beforeEach(() => localStorage.clear());
  const clouds = () => { const m = new Map<string, FakeCloud>(); return { m, of: (id: string) => { if (!m.has(id)) m.set(id, new FakeCloud()); return m.get(id)!; } }; };

  test('existing guest progress is added only after asking, then cleared from the guest copy', async () => {
    const c = clouds();
    const factory = new IDBFactory();
    const before = await app(c.of, null, factory);
    await before.store.selectExam('ssc-cgl');
    practice(before.store, 'quant.average', 10, 8);
    await before.store.flush();
    before.guest.close();

    const x = await app(c.of, sessionFor('user-a', 'a@example.com'), factory);
    expect(x.account.guestPrompt).not.toBeNull();
    expect(x.store.engine.getExamSessions('ssc-cgl')).toHaveLength(0);
    await x.account.addGuestProgress();
    expect(x.account.guestPrompt).toBeNull();
    expect(x.store.engine.getExamSessions('ssc-cgl')).toHaveLength(1);
    expect(c.of('user-a').rows.has('practice')).toBe(true);
    expect(await x.guest.read('practice')).toBeNull();
  });

  test('choosing Keep separate leaves guest progress alone and does not ask again', async () => {
    const c = clouds();
    const factory = new IDBFactory();
    const before = await app(c.of, null, factory);
    await before.store.selectExam('ssc-cgl');
    practice(before.store, 'quant.average', 10, 8);
    await before.store.flush();
    before.guest.close();
    const x = await app(c.of, sessionFor('user-a', 'a@example.com'), factory);
    await x.account.keepGuestSeparate();
    expect(x.account.guestPrompt).toBeNull();
    expect(c.of('user-a').rows.get('practice')).toBeUndefined();
    expect(await x.guest.read('practice')).not.toBeNull();
    await x.account.signOut();
    x.guest.close();
    const again = await app(c.of, sessionFor('user-a', 'a@example.com'), factory);
    expect(again.account.guestPrompt).toBeNull();
  });

  test('two accounts on one device never see each other’s data, and signing back in restores progress', async () => {
    const c = clouds();
    const factory = new IDBFactory();
    const a = await app(c.of, sessionFor('user-a', 'a@example.com'), factory);
    await a.store.selectExam('ssc-cgl');
    practice(a.store, 'quant.average', 10, 8);
    await a.store.flush();
    await a.account.sync!.syncNow();
    expect(await a.account.signOut()).toBe('done');
    expect(readAccountPointer()).toBeNull();
    expect(a.store.activeExamId).toBeNull();
    a.guest.close();

    const b = await app(c.of, sessionFor('user-b', 'b@example.com'), factory);
    expect(b.store.activeExamId).toBeNull();
    expect(c.of('user-b').rows.has('practice')).toBe(false);
    expect(await b.account.signOut()).toBe('done');
    b.guest.close();

    const back = await app(c.of, sessionFor('user-a', 'a@example.com'), factory);
    expect(back.store.engine.getExamSessions('ssc-cgl')).toHaveLength(1);
  });

  test('sign-out refuses to discard changes that have not reached the cloud', async () => {
    const c = clouds();
    const a = await app(c.of, sessionFor('user-a', 'a@example.com'));
    await a.store.selectExam('ssc-cgl');
    await a.store.flush();
    await a.account.sync!.syncNow();
    c.of('user-a').online = false;
    practice(a.store, 'quant.average', 10, 8);
    await a.store.flush();
    vi.spyOn(a.fake.client.auth, 'signOut');
    expect(await a.account.signOut()).toBe('unsynced');
    expect(a.fake.client.auth.signOut).not.toHaveBeenCalled();
    expect(a.account.user?.id).toBe('user-a');
    expect(a.store.engine.getExamSessions('ssc-cgl')).toHaveLength(1);
    c.of('user-a').online = true;
    expect(await a.account.signOut()).toBe('done');
    expect((c.of('user-a').rows.get('practice')!.data as { exams: Record<string, { sessions: unknown[] }> }).exams['ssc-cgl'].sessions).toHaveLength(1);
  });

  test('losing the session keeps unsynced data for the next sign-in', async () => {
    const c = clouds();
    const factory = new IDBFactory();
    const a = await app(c.of, sessionFor('user-a', 'a@example.com'), factory);
    await a.store.selectExam('ssc-cgl');
    await a.store.flush();
    await a.account.sync!.syncNow();
    c.of('user-a').online = false;
    practice(a.store, 'quant.average', 10, 8);
    await a.store.flush();
    a.fake.emit('SIGNED_OUT', null);
    await vi.waitFor(() => expect(a.account.state).toBe('signed-out'));
    expect(a.store.activeExamId).toBeNull();
    a.guest.close();
    c.of('user-a').online = true;
    const back = await app(c.of, sessionFor('user-a', 'a@example.com'), factory);
    await back.account.sync!.syncNow();
    expect(back.store.engine.getExamSessions('ssc-cgl')).toHaveLength(1);
    expect((c.of('user-a').rows.get('practice')!.data as { exams: Record<string, { sessions: unknown[] }> }).exams['ssc-cgl'].sessions).toHaveLength(1);
  });
});
