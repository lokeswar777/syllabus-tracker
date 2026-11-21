/**
 * Sign-in and per-account storage.
 *
 * Signed out, the app uses the guest database, exactly as before. Each signed-in account gets its own IndexedDB
 * database, so people sharing a device never see each other's progress or restore points. Guest progress moves into
 * an account only when the user chooses to add it.
 */
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { buildBackup, checksumOf, summarize, type BackupSummary } from './backup';
import { deleteDatabase, IDB_NAME, IndexedDBStorage } from './idb';
import { ALL_KEYS, type AppStore } from './store';
import { CloudSync, type CloudBackend, type CloudEntry, type PushResult } from './sync';

const env = import.meta.env as Record<string, string | undefined>;
export const cloudSettings = {
  url: env.VITE_SUPABASE_URL?.trim() || '',
  key: (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY)?.trim() || '',
};
export const isCloudConfigured = () => !!(cloudSettings.url && cloudSettings.key);

const AUTH_STORAGE_KEY = 'syllabus-tracker-auth';
const POINTER_KEY = 'syllabus-tracker:ui:account';
const userDbName = (id: string) => `${IDB_NAME}:user:${id}`;

export interface AccountUser { id: string; email: string; name: string; avatarUrl: string | null }
export type AccountState = 'loading' | 'signed-out' | 'signed-in';

export function readAccountPointer(): AccountUser | null {
  try {
    const raw = localStorage.getItem(POINTER_KEY);
    const v = raw ? JSON.parse(raw) as AccountUser : null;
    return v && typeof v.id === 'string' ? v : null;
  } catch { return null; }
}
const writePointer = (u: AccountUser | null) => {
  try { if (u) localStorage.setItem(POINTER_KEY, JSON.stringify(u)); else localStorage.removeItem(POINTER_KEY); } catch { /* preference only */ }
};

/** Opens the last signed-in account's database, so its data shows immediately and offline. */
export async function openAccountDatabase(pointer: AccountUser | null, factory?: IDBFactory) {
  if (!pointer) return null;
  const db = await IndexedDBStorage.open({ name: userDbName(pointer.id), ...(factory ? { factory } : {}) });
  db.enableSyncTracking();
  return db;
}

export function supabaseBackend(client: SupabaseClient, userId: string): CloudBackend {
  return {
    async listVersions() {
      const { data, error } = await client.from('user_collections').select('key,version').eq('user_id', userId);
      if (error) throw error;
      return (data ?? []).map((r) => ({ key: r.key as string, version: Number(r.version) }));
    },
    async fetch(keys) {
      const { data, error } = await client.from('user_collections').select('key,version,data').eq('user_id', userId).in('key', keys);
      if (error) throw error;
      return (data ?? []).map((r) => ({ key: r.key as string, version: Number(r.version), data: r.data }));
    },
    async push(entries: CloudEntry[]) {
      const p_entries = entries.map((e) => ({ key: e.key, data: e.data, base_version: e.baseVersion }));
      const { data, error } = await client.rpc('sync_push_collections', { p_entries });
      if (error) throw error;
      return data as PushResult;
    },
  };
}

const toUser = (s: Session): AccountUser => {
  const m = s.user.user_metadata as Record<string, string | undefined>;
  return { id: s.user.id, email: s.user.email ?? '', name: m.full_name || m.name || s.user.email || 'Your account', avatarUrl: m.avatar_url || m.picture || null };
};

const hasProgress = (c: Record<string, unknown>) => {
  const s = summarize(c);
  return Object.values(s.exams).some((e) => e.topicRecords || e.subtopicRecords || e.sessions) || !!(s.sharedConcepts || s.plans || s.targets.length || s.customWeights || s.syncPreferences || s.historyDays);
};

interface AccountDeps {
  store: AppStore;
  guest: IndexedDBStorage;
  activeDb?: IndexedDBStorage | null;
  createClient?: () => Promise<SupabaseClient>;
  createBackend?: (client: SupabaseClient, userId: string) => CloudBackend;
  factory?: IDBFactory;
  debounceMs?: number;
}

export class CloudAccount {
  state: AccountState = 'loading';
  user: AccountUser | null;
  sync: CloudSync | null = null;
  guestPrompt: BackupSummary | null = null;
  busy = false;

  private client: SupabaseClient | null = null;
  private activeDb: IndexedDBStorage | null;
  private listeners = new Set<() => void>();
  private version = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private cleanup: (() => void)[] = [];
  private offSync: (() => void) | null = null;

  constructor(private deps: AccountDeps) {
    this.activeDb = deps.activeDb ?? null;
    this.user = this.activeDb ? readAccountPointer() : null;
  }

  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getVersion = () => this.version;
  private emit() { this.version++; for (const l of this.listeners) l(); }
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async init() {
    try {
      this.client = this.deps.createClient ? await this.deps.createClient() : await this.createClient();
      this.reportReturnedError();
      const { data, error } = await this.client.auth.getSession();
      if (error && !this.user) this.deps.store.toast('error', `Sign-in could not be restored: ${error.message}`);
      // Supabase asks callers not to await its methods inside this callback.
      this.client.auth.onAuthStateChange((event, session) => { setTimeout(() => { void this.enqueue(() => this.onAuth(event, session)); }, 0); });
      await this.enqueue(() => this.onAuth('INITIAL', data.session));
    } catch (e) {
      this.state = this.user ? 'signed-in' : 'signed-out';
      this.deps.store.toast('error', `Cloud sync is unavailable: ${(e as Error).message}`);
      this.emit();
    }
  }

  private async createClient() {
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(cloudSettings.url, cloudSettings.key, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: AUTH_STORAGE_KEY },
    });
  }

  private reportReturnedError() {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const message = url.searchParams.get('error_description') ?? url.searchParams.get('error');
    if (!message) return;
    this.deps.store.toast('error', `Sign-in failed: ${message}`);
    for (const k of ['error', 'error_code', 'error_description']) url.searchParams.delete(k);
    window.history.replaceState(window.history.state, '', url);
  }

  private async onAuth(event: string, session: Session | null) {
    if (session?.user) {
      const user = toUser(session);
      if (this.sync && this.user?.id === user.id) {
        this.user = user;
        writePointer(user);
        if (this.sync.needsSignIn || event === 'SIGNED_IN') void this.sync.syncNow();
        this.state = 'signed-in';
        this.emit();
        return;
      }
      await this.activate(user);
      return;
    }
    if (event === 'SIGNED_OUT') {
      const wasSignedIn = !!this.user;
      await this.deactivate(false);
      if (wasSignedIn) this.deps.store.toast('info', 'You were signed out. Sign in again to continue syncing.');
      return;
    }
    // No session, but this device has an account: keep its local data usable while offline or until sign-in is renewed.
    this.state = this.user ? 'signed-in' : 'signed-out';
    this.emit();
  }

  private async activate(user: AccountUser) {
    const { store } = this.deps;
    await this.stopSync();
    let db = this.activeDb;
    if (!db || this.user?.id !== user.id) {
      const previous = db;
      db = await openAccountDatabase(user, this.deps.factory);
      this.activeDb = db;
      await store.switchStorage(db!, 'indexeddb');
      if (previous) previous.close();
    } else if (store.storage !== db) {
      await store.switchStorage(db, 'indexeddb');
    }
    this.user = user;
    writePointer(user);
    this.state = 'signed-in';
    this.guestPrompt = await this.guestSummary(user.id);
    const sync = new CloudSync({ store, storage: db!, backend: (this.deps.createBackend ?? supabaseBackend)(this.client!, user.id), debounceMs: this.deps.debounceMs });
    this.sync = sync;
    this.offSync = sync.subscribe(() => this.emit());
    this.listen(sync);
    this.emit();
    void sync.start();
  }

  /** Syncs when the connection returns, the app comes back into view, and once a minute while visible. */
  private listen(sync: CloudSync) {
    if (typeof window === 'undefined') return;
    const syncNow = () => { void sync.syncNow(); };
    const onVisibility = () => { void sync.syncNow(); };
    window.addEventListener('online', syncNow);
    window.addEventListener('focus', syncNow);
    document.addEventListener('visibilitychange', onVisibility);
    const interval = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60_000);
    this.cleanup.push(() => {
      window.removeEventListener('online', syncNow);
      window.removeEventListener('focus', syncNow);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    });
  }

  private async stopSync() {
    for (const f of this.cleanup.splice(0)) f();
    this.offSync?.();
    this.offSync = null;
    const sync = this.sync;
    this.sync = null;
    await sync?.stop();
  }

  private async deactivate(deleteLocal: boolean) {
    await this.stopSync();
    const db = this.activeDb;
    this.activeDb = null;
    this.user = null;
    this.guestPrompt = null;
    this.state = 'signed-out';
    writePointer(null);
    if (this.deps.store.storage !== this.deps.guest) await this.deps.store.switchStorage(this.deps.guest, 'indexeddb');
    if (db) {
      const name = db.idb.name;
      db.close();
      if (deleteLocal) await deleteDatabase(name, this.deps.factory);
    }
    this.emit();
  }

  signIn() {
    return this.enqueue(async () => {
      if (!this.client) throw new Error('Cloud sync is still starting. Try again in a moment.');
      await this.deps.store.flush().catch(() => {});
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { error } = await this.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      if (error) throw error;
    }).catch((e) => this.deps.store.toast('error', `Sign-in failed: ${(e as Error).message}`));
  }

  /** Returns 'unsynced' without signing out if some changes exist only on this device, unless `force` is set. */
  signOut(force = false): Promise<'done' | 'unsynced'> {
    return this.enqueue(async () => {
      this.busy = true;
      this.emit();
      try {
        if (!force) {
          try {
            await this.deps.store.flush();
            if (this.sync) await this.sync.syncNow();
          } catch { return 'unsynced' as const; }
          const unsynced = this.sync ? this.sync.hasUnsynced : !!this.activeDb && Object.keys((await this.activeDb.syncState()).dirty).length > 0;
          if (unsynced) return 'unsynced' as const;
        }
        await this.deactivate(true);
        const { error } = (await this.client?.auth.signOut({ scope: 'local' })) ?? { error: null };
        if (error) { try { localStorage.removeItem(AUTH_STORAGE_KEY); localStorage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`); } catch { /* nothing stored */ } }
        return 'done' as const;
      } finally {
        this.busy = false;
        this.emit();
      }
    });
  }

  private async guestCollections() {
    await this.deps.guest.flush().catch(() => {});
    const out: Record<string, unknown> = {};
    for (const k of ALL_KEYS) out[k] = await this.deps.guest.read(k);
    return out;
  }

  private async guestSummary(userId: string) {
    const c = await this.guestCollections();
    if (!hasProgress(c)) return null;
    const handled = await this.deps.guest.getMeta<string>(`guestHandled:${userId}`);
    return handled && handled === await checksumOf(c) ? null : summarize(c);
  }

  /** Copies this device's guest progress into the account, and clears the guest copy once the cloud has it. */
  addGuestProgress() {
    return this.enqueue(async () => {
      const { store, guest } = this.deps;
      const sync = this.sync;
      if (!this.user || !sync) return;
      this.busy = true;
      this.emit();
      try {
        await sync.syncNow(); // start from the account's latest data
        const collections = await this.guestCollections();
        const backup = await buildBackup({ collections, exportedAt: store.clock().toISOString() });
        await store.importData(backup, 'merge');
        const synced = await sync.syncNow();
        if (synced) {
          await guest.createSnapshot('migration', ALL_KEYS);
          await guest.writeMany(ALL_KEYS.map((k) => [k, null]));
          await guest.flush();
        } else {
          await guest.setMeta(`guestHandled:${this.user.id}`, await checksumOf(collections));
        }
        this.guestPrompt = null;
        store.toast('success', synced ? 'This device’s progress was added to your account.' : 'Progress added to your account. It will upload when you are back online.');
      } catch (e) {
        store.toast('error', `Progress could not be added: ${(e as Error).message}`);
      } finally {
        this.busy = false;
        this.emit();
      }
    });
  }

  /** Leaves guest progress on this device and stops asking about it. */
  keepGuestSeparate() {
    return this.enqueue(async () => {
      if (!this.user) return;
      await this.deps.guest.setMeta(`guestHandled:${this.user.id}`, await checksumOf(await this.guestCollections()));
      this.guestPrompt = null;
      this.emit();
    });
  }
}
