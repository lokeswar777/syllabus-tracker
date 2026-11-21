/**
 * IndexedDB storage for the preparation database (Phase 7).
 *
 * Database `syllabus-tracker` (version 1), object stores:
 *   collections  { key, data, savedAt, schema }      one record per collection (progress, practice, planner …)
 *   snapshots    { id, createdAt, reason, collections, bytes }   local restore points (daily, before import/restore, manual)
 *   meta         { key, value }                      e.g. migration from localStorage
 *
 * Reliability:
 *   - writeMany() puts several collections in ONE transaction: a change that touches practice + progress is all-or-nothing,
 *     so an interrupted save can never leave them inconsistent.
 *   - Writes are coalesced: changes made in the same tick are written once (latest value per key).
 *   - A value identical (same object) to the last one written is skipped (engines update immutably).
 *   - A failed write keeps its data pending and is retried with the next write or retry(); nothing is dropped.
 *   - Unreadable records are moved to `quarantine:<key>` in meta instead of being discarded.
 */
import type { StorageAdapter } from './engines';

export const IDB_NAME = 'syllabus-tracker';
export const IDB_VERSION = 1;
const STORES = { collections: 'collections', snapshots: 'snapshots', meta: 'meta' } as const;

export interface Snapshot { id: string; createdAt: string; reason: SnapshotReason; collections: Record<string, unknown>; bytes: number }
export type SnapshotReason = 'daily' | 'manual' | 'before-import' | 'before-restore' | 'before-reset' | 'before-sync' | 'migration';
export type SnapshotInfo = Omit<Snapshot, 'collections'> & { keys: string[] };
export type SaveListener = (state: 'saving' | 'saved' | 'error', error?: Error) => void;
/** A collection coming from the cloud. `expect` is the local change marker it may replace (null = no local change). */
export interface RemoteRow { key: string; data: unknown; version: number; dirty: boolean; expect: string | null }
const SYNC_DIRTY = 'syncDirty:';
const SYNC_VERSION = 'syncVersion:';
const newToken = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => {
  tx.oncomplete = () => res();
  tx.onerror = () => rej(tx.error ?? new Error('IndexedDB transaction failed'));
  tx.onabort = () => rej(tx.error ?? new Error('IndexedDB transaction aborted'));
});

export function openDatabase(factory: IDBFactory = indexedDB, name = IDB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let open: IDBOpenDBRequest;
    try { open = factory.open(name, IDB_VERSION); } catch (e) { reject(e); return; }
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORES.collections)) db.createObjectStore(STORES.collections, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORES.snapshots)) db.createObjectStore(STORES.snapshots, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta, { keyPath: 'key' });
    };
    open.onsuccess = () => {
      open.result.onversionchange = () => open.result.close(); // lets another tab delete this database on sign-out
      resolve(open.result);
    };
    open.onerror = () => reject(open.error ?? new Error('IndexedDB could not be opened'));
    open.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another open tab: close other tabs of the tracker and reload'));
  });
}

export function deleteDatabase(name: string, factory: IDBFactory = indexedDB): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = factory.deleteDatabase(name);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => resolve(); // completes as soon as the other tab closes its connection
  });
}

export class IndexedDBStorage implements StorageAdapter {
  readonly kind = 'indexeddb';
  private cache = new Map<string, unknown>();
  private lastWritten = new Map<string, unknown>();
  private pending = new Map<string, unknown>();
  private batch: Promise<void> | null = null;
  private listeners = new Set<SaveListener>();
  private commitListeners = new Set<(keys: string[]) => void>();
  private revisions = new Map<string, string>();
  private syncTracking = false;
  issues: string[] = [];
  writes = 0; // number of committed transactions (diagnostics / tests)

  private constructor(readonly idb: IDBDatabase, private clock: () => Date, readonly factory: IDBFactory) {}

  /** Opens the database and preloads every collection in a single read transaction. */
  static async open({ factory = indexedDB, name = IDB_NAME, clock = () => new Date() }: { factory?: IDBFactory; name?: string; clock?: () => Date } = {}) {
    const s = new IndexedDBStorage(await openDatabase(factory, name), clock, factory);
    await s.preload();
    return s;
  }

  private async preload() {
    const tx = this.idb.transaction([STORES.collections, STORES.meta], 'readwrite');
    const all = await req(tx.objectStore(STORES.collections).getAll());
    for (const rec of all as { key: string; data: unknown; savedAt?: string; rev?: string }[]) {
      if (rec && typeof rec.key === 'string' && 'data' in rec && (rec.data === null || typeof rec.data === 'object')) {
        this.cache.set(rec.key, rec.data);
        this.lastWritten.set(rec.key, rec.data);
        this.revisions.set(rec.key, rec.rev ?? rec.savedAt ?? '');
      } else if (rec && typeof rec.key === 'string') {
        // keep the unreadable record for recovery instead of discarding it
        tx.objectStore(STORES.meta).put({ key: `quarantine:${rec.key}:${this.clock().toISOString()}`, value: rec });
        tx.objectStore(STORES.collections).delete(rec.key);
        this.issues.push(`stored '${rec.key}' was unreadable and has been set aside; restore a snapshot or backup if data is missing`);
      }
    }
    await done(tx);
  }

  onSave(l: SaveListener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  private notify(state: 'saving' | 'saved' | 'error', error?: Error) { for (const l of this.listeners) l(state, error); }

  async read(key: string) { return this.cache.has(key) ? this.cache.get(key) ?? null : null; }
  keys() { return [...this.cache.keys()]; }
  get hasPendingWrites() { return this.pending.size > 0 || this.batch !== null; }

  write(key: string, value: unknown) { return this.writeMany([[key, value]]); }

  /** All entries are committed in one transaction (together with anything else written in the same tick). */
  writeMany(entries: [string, unknown][]) {
    let changed = false;
    for (const [k, v] of entries) {
      this.cache.set(k, v);
      if (this.lastWritten.has(k) && this.lastWritten.get(k) === v && !this.pending.has(k)) continue; // unchanged: no write
      this.pending.set(k, v);
      changed = true;
    }
    if (!changed && !this.batch) return Promise.resolve();
    return this.schedule();
  }

  private schedule(): Promise<void> {
    if (this.batch) return this.batch;
    this.notify('saving');
    this.batch = Promise.resolve().then(() => this.commit());
    return this.batch;
  }

  private async commit(): Promise<void> {
    const entries = [...this.pending.entries()];
    try {
      if (entries.length) {
        const tx = this.idb.transaction(this.syncTracking ? [STORES.collections, STORES.meta] : [STORES.collections], 'readwrite');
        const store = tx.objectStore(STORES.collections);
        const savedAt = this.clock().toISOString();
        const revs = new Map<string, string>();
        for (const [key, data] of entries) {
          const rev = newToken();
          revs.set(key, rev);
          if (data === null || data === undefined) store.delete(key);
          else store.put({ key, data, savedAt, rev, schema: (data as { schemaVersion?: number }).schemaVersion ?? null });
          // Saved in the same transaction, so a crash can never leave an edit that sync does not know about.
          if (this.syncTracking) tx.objectStore(STORES.meta).put({ key: SYNC_DIRTY + key, value: rev });
        }
        await done(tx);
        this.writes++;
        for (const [k, v] of entries) {
          if (this.pending.get(k) === v) this.pending.delete(k);
          this.lastWritten.set(k, v);
          if (v === null || v === undefined) this.revisions.delete(k); else this.revisions.set(k, revs.get(k)!);
        }
        for (const l of this.commitListeners) l(entries.map(([k]) => k));
      }
    } catch (e) {
      this.batch = null;
      const err = e instanceof Error ? e : new Error(String(e));
      this.notify('error', err);
      throw err; // entries stay pending and are retried with the next write or retry()
    }
    this.batch = null;
    if (this.pending.size) return this.schedule(); // writes that arrived during the commit
    this.notify('saved');
  }

  /** Retry pending writes after a failure. */
  retry() { return this.pending.size ? this.schedule() : Promise.resolve(); }
  /** Resolves when everything written so far is on disk (rejects if the last attempt failed). */
  flush() { return this.batch ?? (this.pending.size ? this.schedule() : Promise.resolve()); }

  // ───────── cloud sync bookkeeping ─────────
  enableSyncTracking() { this.syncTracking = true; }
  onCommit(l: (keys: string[]) => void) { this.commitListeners.add(l); return () => { this.commitListeners.delete(l); }; }

  /** Last version seen from the cloud per collection, and collections changed here since then. */
  async syncState() {
    const tx = this.idb.transaction(STORES.meta, 'readonly');
    const all = (await req(tx.objectStore(STORES.meta).getAll())) as { key: string; value: unknown }[];
    const versions: Record<string, number> = {};
    const dirty: Record<string, string> = {};
    for (const r of all) {
      if (r.key.startsWith(SYNC_VERSION)) versions[r.key.slice(SYNC_VERSION.length)] = r.value as number;
      else if (r.key.startsWith(SYNC_DIRTY)) dirty[r.key.slice(SYNC_DIRTY.length)] = r.value as string;
    }
    return { versions, dirty };
  }

  /** Records a successful upload. A collection edited again since it was read stays marked as changed. */
  async markSynced(rows: { key: string; version: number; token: string }[]) {
    const tx = this.idb.transaction(STORES.meta, 'readwrite');
    const meta = tx.objectStore(STORES.meta);
    for (const r of rows) {
      meta.put({ key: SYNC_VERSION + r.key, value: r.version });
      const mark = meta.get(SYNC_DIRTY + r.key);
      mark.onsuccess = () => { if (mark.result?.value === r.token) meta.delete(SYNC_DIRTY + r.key); };
    }
    await done(tx);
  }

  /** Saves cloud data atomically, skipping any collection edited locally after it was read. Returns the applied keys. */
  async applyRemote(rows: RemoteRow[]) {
    if (!rows.length) return [];
    const tx = this.idb.transaction([STORES.collections, STORES.meta], 'readwrite');
    const store = tx.objectStore(STORES.collections);
    const meta = tx.objectStore(STORES.meta);
    const savedAt = this.clock().toISOString();
    const applied: (RemoteRow & { rev: string })[] = [];
    for (const row of rows) {
      if (this.pending.has(row.key)) continue;
      const mark = meta.get(SYNC_DIRTY + row.key);
      mark.onsuccess = () => {
        if ((mark.result?.value ?? null) !== row.expect) return;
        const rev = newToken();
        if (row.data === null || row.data === undefined) store.delete(row.key);
        else store.put({ key: row.key, data: row.data, savedAt, rev, schema: (row.data as { schemaVersion?: number }).schemaVersion ?? null });
        meta.put({ key: SYNC_VERSION + row.key, value: row.version });
        if (row.dirty) meta.put({ key: SYNC_DIRTY + row.key, value: rev });
        else meta.delete(SYNC_DIRTY + row.key);
        applied.push({ ...row, rev });
      };
    }
    await done(tx);
    for (const row of applied) {
      if (this.pending.has(row.key)) continue;
      if (row.data === null || row.data === undefined) { this.cache.delete(row.key); this.lastWritten.delete(row.key); this.revisions.delete(row.key); }
      else { this.cache.set(row.key, row.data); this.lastWritten.set(row.key, row.data); this.revisions.set(row.key, row.rev); }
    }
    return applied.map((r) => r.key);
  }

  /** Picks up what another tab saved. Returns the collections that changed. */
  async refreshFromDisk() {
    const tx = this.idb.transaction(STORES.collections, 'readonly');
    const all = (await req(tx.objectStore(STORES.collections).getAll())) as { key: string; data: unknown; savedAt?: string; rev?: string }[];
    const changed: string[] = [];
    const seen = new Set<string>();
    for (const rec of all) {
      seen.add(rec.key);
      if (this.pending.has(rec.key)) continue;
      const rev = rec.rev ?? rec.savedAt ?? '';
      if (this.revisions.get(rec.key) === rev) continue;
      this.cache.set(rec.key, rec.data);
      this.lastWritten.set(rec.key, rec.data);
      this.revisions.set(rec.key, rev);
      changed.push(rec.key);
    }
    for (const [key, value] of [...this.cache]) {
      if (seen.has(key) || this.pending.has(key) || value === null || value === undefined) continue;
      this.cache.delete(key);
      this.lastWritten.delete(key);
      this.revisions.delete(key);
      changed.push(key);
    }
    return changed;
  }

  // ───────── snapshots (local restore points) ─────────
  async createSnapshot(reason: SnapshotReason, keys?: string[]): Promise<SnapshotInfo | null> {
    await this.flush().catch(() => {});
    const collections: Record<string, unknown> = {};
    for (const k of keys ?? this.keys()) { const v = this.cache.get(k); if (v != null) collections[k] = v; }
    if (!Object.keys(collections).length) return null;
    const createdAt = this.clock().toISOString();
    const snap: Snapshot = { id: `${createdAt}-${reason}-${Math.random().toString(36).slice(2, 7)}`, createdAt, reason, collections, bytes: JSON.stringify(collections).length };
    const tx = this.idb.transaction(STORES.snapshots, 'readwrite');
    tx.objectStore(STORES.snapshots).put(snap);
    await done(tx);
    await this.pruneSnapshots();
    return { id: snap.id, createdAt, reason, bytes: snap.bytes, keys: Object.keys(collections) };
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const tx = this.idb.transaction(STORES.snapshots, 'readonly');
    const all = (await req(tx.objectStore(STORES.snapshots).getAll())) as Snapshot[];
    return all.map(({ collections, ...s }) => ({ ...s, keys: Object.keys(collections ?? {}) })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getSnapshot(id: string): Promise<Snapshot | null> {
    const tx = this.idb.transaction(STORES.snapshots, 'readonly');
    return ((await req(tx.objectStore(STORES.snapshots).get(id))) as Snapshot | undefined) ?? null;
  }
  async deleteSnapshot(id: string) {
    const tx = this.idb.transaction(STORES.snapshots, 'readwrite');
    tx.objectStore(STORES.snapshots).delete(id);
    await done(tx);
  }
  /** Keeps the 7 most recent daily snapshots and the 10 most recent others. */
  async pruneSnapshots(keepDaily = 7, keepOther = 10) {
    const list = await this.listSnapshots();
    const daily = list.filter((s) => s.reason === 'daily').slice(keepDaily);
    const other = list.filter((s) => s.reason !== 'daily').slice(keepOther);
    if (!daily.length && !other.length) return;
    const tx = this.idb.transaction(STORES.snapshots, 'readwrite');
    for (const s of [...daily, ...other]) tx.objectStore(STORES.snapshots).delete(s.id);
    await done(tx);
  }

  // ───────── meta ─────────
  async getMeta<T>(key: string): Promise<T | null> {
    const tx = this.idb.transaction(STORES.meta, 'readonly');
    const r = (await req(tx.objectStore(STORES.meta).get(key))) as { value: T } | undefined;
    return r ? r.value : null;
  }
  async setMeta(key: string, value: unknown) {
    const tx = this.idb.transaction(STORES.meta, 'readwrite');
    tx.objectStore(STORES.meta).put({ key, value });
    await done(tx);
  }

  close() { this.idb.close(); }
}

/**
 * One-time migration of Phase 6 data (localStorage, prefix `syllabus-tracker:`) into IndexedDB.
 * Runs only when IndexedDB holds no collections. Data is written in one transaction, verified by reading it back,
 * and only then removed from localStorage. UI preferences (`ui:*`, `theme`) stay in localStorage.
 */
export async function migrateFromLocalStorage(storage: IndexedDBStorage, ls: Storage, keys: string[], prefix = 'syllabus-tracker:'): Promise<{ migrated: string[]; skipped: string[] }> {
  if (storage.keys().length) return { migrated: [], skipped: [] };
  const found: [string, unknown][] = [];
  const skipped: string[] = [];
  for (const k of keys) {
    const raw = ls.getItem(prefix + k);
    if (raw == null) continue;
    try { const v = JSON.parse(raw); if (v !== null) found.push([k, v]); } catch { skipped.push(k); }
  }
  if (!found.length) return { migrated: [], skipped };
  await storage.writeMany(found);
  // verify through a fresh connection (reads what is really on disk)
  const fresh = await IndexedDBStorage.open({ factory: storage.factory, name: storage.idb.name });
  try {
    for (const [k, v] of found) {
      if (JSON.stringify(await fresh.read(k)) !== JSON.stringify(v)) throw new Error(`migration check failed for '${k}': localStorage data kept`);
    }
  } finally { fresh.close(); }
  await storage.setMeta('migratedFromLocalStorage', { at: new Date().toISOString(), keys: found.map(([k]) => k), skipped });
  for (const [k] of found) ls.removeItem(prefix + k);
  return { migrated: found.map(([k]) => k), skipped };
}
