/**
 * Keeps one account's IndexedDB database and its Supabase rows in step.
 *
 * Every collection has a version. A device writes with the version it last saw, and the server refuses the write
 * if another device got there first. The device then fetches the newer data, combines it with mergeCollections
 * and tries again. Local data is always saved first, so being offline never blocks or loses an edit.
 */
import { mergeCollections } from './backup';
import type { IndexedDBStorage, RemoteRow } from './idb';
import { ALL_KEYS, type AppStore } from './store';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
export interface CloudVersion { key: string; version: number }
export interface CloudRow extends CloudVersion { data: unknown }
export interface CloudEntry { key: string; data: unknown; baseVersion: number }
export type PushResult = { ok: true; versions: CloudVersion[] } | { ok: false; conflicts: CloudVersion[] };

export interface CloudBackend {
  listVersions(): Promise<CloudVersion[]>;
  fetch(keys: string[]): Promise<CloudRow[]>;
  push(entries: CloudEntry[]): Promise<PushResult>;
}

interface SyncDeps {
  store: AppStore;
  storage: IndexedDBStorage;
  backend: CloudBackend;
  isOnline?: () => boolean;
  clock?: () => Date;
  debounceMs?: number;
}

class SyncStopped extends Error {}
const MAX_ATTEMPTS = 4;

const isAuthError = (e: unknown) => {
  const x = e as { status?: number; code?: string; message?: string };
  return x?.status === 401 || x?.code === 'PGRST301' || x?.code === 'PGRST303' || x?.code === '42501' || /jwt|not authenticated/i.test(x?.message ?? '');
};
const isNetworkError = (e: unknown) => e instanceof TypeError || /failed to fetch|network|load failed/i.test((e as Error)?.message ?? '');

export class CloudSync {
  status: SyncStatus = 'idle';
  error: string | null = null;
  lastSyncedAt: string | null = null;
  hasUnsynced = false;
  needsSignIn = false;

  private listeners = new Set<() => void>();
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<boolean> | null = null;
  private again = false;
  private stopped = false;
  private offCommit: (() => void) | null = null;

  constructor(private deps: SyncDeps) {}

  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getVersion = () => this.version;
  private emit() { this.version++; for (const l of this.listeners) l(); }
  private get online() { return this.deps.isOnline ? this.deps.isOnline() : typeof navigator === 'undefined' || navigator.onLine !== false; }
  private assertRunning() { if (this.stopped) throw new SyncStopped(); }

  start() {
    this.offCommit = this.deps.storage.onCommit(() => this.schedule());
    return this.syncNow();
  }

  /** Stops future work and waits for a sync already in progress. */
  async stop() {
    this.stopped = true;
    this.offCommit?.();
    this.offCommit = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running?.catch(() => false);
  }

  schedule() {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.hasUnsynced = true;
    this.emit();
    this.timer = setTimeout(() => { this.timer = null; void this.syncNow(); }, this.deps.debounceMs ?? 1500);
  }

  /** Resolves true when this device and the cloud hold the same data. */
  syncNow(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    if (this.running) { this.again = true; return this.running; }
    this.running = this.loop().finally(() => { this.running = null; });
    return this.running;
  }

  private async loop() {
    do {
      this.again = false;
      await this.withLock(() => this.run());
    } while (this.again && !this.stopped);
    return this.status === 'synced' && !this.hasUnsynced;
  }

  /** Only one tab talks to the cloud at a time. */
  private withLock(fn: () => Promise<void>): Promise<void> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks ? locks.request('syllabus-tracker-sync', fn) as Promise<void> : fn();
  }

  private async run() {
    if (!this.online) {
      await this.refreshUnsynced();
      this.status = 'offline';
      this.error = null;
      this.emit();
      return;
    }
    this.status = 'syncing';
    this.error = null;
    this.emit();
    try {
      let done = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !done; attempt++) done = await this.syncOnce();
      if (!done) throw new Error('Another device is saving at the same time. Sync will try again.');
      this.status = 'synced';
      this.needsSignIn = false;
      this.lastSyncedAt = (this.deps.clock ?? (() => new Date()))().toISOString();
    } catch (e) {
      if (e instanceof SyncStopped) return;
      if (isNetworkError(e)) {
        this.status = 'offline';
      } else {
        this.status = 'error';
        this.needsSignIn = isAuthError(e);
        this.error = this.needsSignIn ? 'Please sign in again to continue syncing.' : (e as Error).message;
      }
    }
    await this.refreshUnsynced();
    this.emit();
  }

  private async refreshUnsynced() {
    try { this.hasUnsynced = Object.keys((await this.deps.storage.syncState()).dirty).length > 0; } catch { /* database closed during sign-out */ }
  }

  /** One pull-merge-push pass. Returns false when another device saved first and the pass must be repeated. */
  private async syncOnce(): Promise<boolean> {
    const { store, storage, backend } = this.deps;
    await store.flush();
    this.assertRunning();
    if ((await storage.refreshFromDisk()).length) await store.reload();

    let state = await storage.syncState();
    const remote = await backend.listVersions();
    this.assertRunning();
    const remoteVersions = new Map(remote.map((r) => [r.key, r.version]));
    const changed = remote.filter((r) => r.version !== (state.versions[r.key] ?? 0)).map((r) => r.key);
    if (changed.length) {
      const rows = await backend.fetch(changed);
      this.assertRunning();
      if (await this.applyRows(rows, state.dirty)) await store.reload();
      state = await storage.syncState();
      if (rows.some((r) => (state.versions[r.key] ?? 0) !== r.version)) return false; // edited meanwhile: start again
    }

    const dirty = Object.keys(state.dirty).filter((k) => ALL_KEYS.includes(k));
    if (!dirty.length) return true;
    const entries: CloudEntry[] = [];
    const nothingToSend: { key: string; version: number; token: string }[] = [];
    for (const key of dirty) {
      const data = (await storage.read(key)) ?? null;
      const baseVersion = remoteVersions.get(key) ?? 0;
      if (data === null && baseVersion === 0) nothingToSend.push({ key, version: 0, token: state.dirty[key] });
      else entries.push({ key, data, baseVersion });
    }
    if (nothingToSend.length) await storage.markSynced(nothingToSend);
    if (!entries.length) return true;
    this.assertRunning();
    const result = await backend.push(entries);
    if (!result.ok) return false;
    await storage.markSynced(result.versions.map((v) => ({ ...v, token: state.dirty[v.key] })));
    return true;
  }

  private async applyRows(rows: { key: string; version: number; data: unknown }[], dirty: Record<string, string>) {
    const { store, storage } = this.deps;
    const local = await store.readCollections();
    const conflict = (key: string) => dirty[key] !== undefined;
    let merged: Record<string, unknown> = {};
    if (rows.some((r) => conflict(r.key))) {
      await storage.createSnapshot('before-sync', ALL_KEYS);
      const incoming = Object.fromEntries(rows.map((r) => [r.key, r.data ?? null]));
      merged = mergeCollections(local, incoming, (this.deps.clock ?? (() => new Date()))().toISOString()).collections;
    }
    const next = { ...local };
    const out: RemoteRow[] = rows.map((r) => {
      const isConflict = conflict(r.key);
      const data = (isConflict ? merged[r.key] : r.data) ?? null;
      next[r.key] = data;
      return { key: r.key, data, version: r.version, dirty: isConflict, expect: isConflict ? dirty[r.key] : null };
    });
    const check = await store.validateCollections(next);
    if (!check.ok) throw new Error(`Cloud data was not applied: ${check.errors[0]}`);
    return (await storage.applyRemote(out)).length > 0;
  }
}
