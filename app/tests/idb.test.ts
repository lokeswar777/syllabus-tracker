import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { IndexedDBStorage, migrateFromLocalStorage, openDatabase } from '../src/lib/idb';

let n = 0;
const fresh = () => IndexedDBStorage.open({ name: `test-${Date.now()}-${++n}` });

describe('IndexedDB storage', () => {
  test('writes survive reopening; null deletes', async () => {
    const s = await fresh();
    await s.write('progress', { kind: 'progress', schemaVersion: 2, exams: { a: 1 } });
    await s.write('planner', { kind: 'planner' });
    await s.write('planner', null);
    s.close();
    const again = await IndexedDBStorage.open({ name: s.idb.name });
    expect(await again.read('progress')).toEqual({ kind: 'progress', schemaVersion: 2, exams: { a: 1 } });
    expect(await again.read('planner')).toBeNull();
  });

  test('writes in the same tick are coalesced into one atomic transaction; identical objects are skipped', async () => {
    const s = await fresh();
    const p = { kind: 'progress', v: 1 };
    const before = s.writes;
    await Promise.all([s.write('progress', { v: 0 }), s.writeMany([['progress', p], ['practice', { v: 2 }]])]);
    expect(s.writes - before).toBe(1);
    expect(await s.read('progress')).toBe(p);
    await s.write('progress', p); // same object as last written → no write
    expect(s.writes - before).toBe(1);
  });

  test('a failed transaction keeps the data pending, reports the error, and retry() saves it', async () => {
    const s = await fresh();
    const states: string[] = [];
    s.onSave((st) => states.push(st));
    const real = s.idb.transaction.bind(s.idb);
    (s.idb as unknown as { transaction: unknown }).transaction = () => { throw new DOMException('quota', 'QuotaExceededError'); };
    await expect(s.write('practice', { sessions: [1, 2, 3] })).rejects.toThrow(/quota/);
    expect(states.at(-1)).toBe('error');
    expect(s.hasPendingWrites).toBe(true);
    (s.idb as unknown as { transaction: unknown }).transaction = real;
    await s.retry();
    expect(states.at(-1)).toBe('saved');
    s.close();
    const again = await IndexedDBStorage.open({ name: s.idb.name });
    expect(await again.read('practice')).toEqual({ sessions: [1, 2, 3] });
  });

  test('unreadable records are quarantined instead of crashing or being lost', async () => {
    const name = `corrupt-${Date.now()}`;
    const db = await openDatabase(indexedDB, name);
    await new Promise<void>((res) => { const tx = db.transaction('collections', 'readwrite'); tx.objectStore('collections').put({ key: 'progress', data: 'not-an-object' }); tx.oncomplete = () => res(); });
    db.close();
    const s = await IndexedDBStorage.open({ name });
    expect(await s.read('progress')).toBeNull();
    expect(s.issues[0]).toMatch(/progress/);
  });

  test('snapshots: create, list, read, prune (7 daily + 10 others)', async () => {
    let t = Date.parse('2026-11-01T00:00:00Z');
    const s = await IndexedDBStorage.open({ name: `snap-${Date.now()}`, clock: () => new Date((t += 3600000)) });
    await s.write('progress', { kind: 'progress', n: 1 });
    for (let i = 0; i < 9; i++) await s.createSnapshot('daily');
    for (let i = 0; i < 12; i++) await s.createSnapshot('manual');
    const list = await s.listSnapshots();
    expect(list.filter((x) => x.reason === 'daily')).toHaveLength(7);
    expect(list.filter((x) => x.reason === 'manual')).toHaveLength(10);
    const full = await s.getSnapshot(list[0].id);
    expect(full!.collections.progress).toEqual({ kind: 'progress', n: 1 });
  });

  test('migration from localStorage: copied, verified, then removed (UI preferences kept)', async () => {
    const s = await fresh();
    const ls = window.localStorage;
    ls.clear();
    ls.setItem('syllabus-tracker:progress', JSON.stringify({ kind: 'progress', exams: { 'ssc-cgl': {} } }));
    ls.setItem('syllabus-tracker:planner', JSON.stringify({ kind: 'planner' }));
    ls.setItem('syllabus-tracker:theme', 'dark');
    const r = await migrateFromLocalStorage(s, ls, ['progress', 'planner', 'practice']);
    expect(r.migrated.sort()).toEqual(['planner', 'progress']);
    expect(await s.read('progress')).toEqual({ kind: 'progress', exams: { 'ssc-cgl': {} } });
    expect(ls.getItem('syllabus-tracker:progress')).toBeNull();
    expect(ls.getItem('syllabus-tracker:theme')).toBe('dark');
    expect(await s.getMeta('migratedFromLocalStorage')).toMatchObject({ keys: ['progress', 'planner'] });
    // never runs twice / never overwrites IndexedDB data
    ls.setItem('syllabus-tracker:progress', JSON.stringify({ kind: 'progress', exams: {} }));
    expect((await migrateFromLocalStorage(s, ls, ['progress'])).migrated).toEqual([]);
    expect(await s.read('progress')).toEqual({ kind: 'progress', exams: { 'ssc-cgl': {} } });
  });
});
