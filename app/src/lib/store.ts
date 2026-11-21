/**
 * AppStore: the single source of truth for the UI.
 *
 * It owns exactly one ProgressEngine (Phase 3/4) and one StudyPlanner (Phase 5), both on the same storage
 * adapter (IndexedDB in the browser, Phase 7). Collections are stored under their own keys:
 *   progress, sharedLearning, practice, weightOverrides, syncSettings   ← ProgressEngine
 *   planner                                                            ← StudyPlanner
 *   progressConfig   user-edited scoring config (status scores, mastery parameters); absent = defaults
 *   history          daily snapshot of each exam's whole-exam completion/mastery, for the trend chart
 * React subscribes through subscribe()/getVersion() for data, and subscribeUi()/getUiVersion() for
 * toasts and save status, so a toast never re-renders the pages.
 */
import { progress, planner as plannerApi, COLLECTIONS, PLANNER_KEY } from './engines';
import type { Engine, Loader, Planner, PlannerConfig, ProgressConfig, StorageAdapter } from './engines';
import type { ExamInfo, HistoryData, HistoryPoint, Report } from './types';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, BACKUP_KEYS, buildBackup, mergeCollections, validateBackup, type MergeReport, type ValidationResult } from './backup';
import type { CloudAccount } from './account';
import { buildCsv, type CsvKind } from './csv';
import type { IndexedDBStorage, SnapshotInfo, SnapshotReason } from './idb';

export const CONFIG_KEY = 'progressConfig';
export const HISTORY_KEY = 'history';
export const ALL_KEYS = [...COLLECTIONS, PLANNER_KEY, CONFIG_KEY, HISTORY_KEY];
export const EXPORT_FORMAT = BACKUP_FORMAT;

export type Status = 'idle' | 'loading' | 'ready' | 'error';
export type SaveState = 'saved' | 'saving' | 'error';
export type ImportMode = 'replace' | 'merge';
export interface Toast { id: number; kind: 'success' | 'error' | 'info'; message: string; action?: { label: string; run: () => void | Promise<unknown> } }

export interface StoreDeps {
  loader: Loader & { loadDefaults?(): Promise<{ progress: unknown; planner: unknown }> };
  storage: StorageAdapter;
  defaults?: { progress: ProgressConfig; planner: PlannerConfig };
  clock?: () => Date;
  historyDelayMs?: number;
  /** Where the data lives, for the user-facing explanation. */
  storageKind?: 'indexeddb' | 'localstorage' | 'memory';
}

const emptyHistory = (): HistoryData => ({ schemaVersion: 1, kind: 'history', exams: {} });
const hasSnapshots = (s: StorageAdapter): s is IndexedDBStorage => typeof (s as IndexedDBStorage).createSnapshot === 'function';

export class AppStore {
  status: Status = 'idle';
  error: string | null = null;
  saveState: SaveState = 'saved';
  saveError: string | null = null;
  toasts: Toast[] = [];
  exams: ExamInfo[] = [];
  defaults: { progress: ProgressConfig; planner: PlannerConfig } | null = null;
  customConfig = false;
  history: HistoryData = emptyHistory();
  engine!: Engine;
  planner!: Planner;
  /** Present only when cloud sync is configured. */
  account: CloudAccount | null = null;

  private listeners = new Set<() => void>();
  private uiListeners = new Set<() => void>();
  private version = 0;
  private uiVersion = 0;
  private toastSeq = 0;
  private historyTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private pending = 0;
  private syllabusIds = new Map<string, Set<string>>();
  private offStorageSave: (() => void) | null = null;

  constructor(private deps: StoreDeps) {
    this.watchStorage();
  }

  private watchStorage() {
    this.offStorageSave?.();
    const s = this.deps.storage;
    this.offStorageSave = hasSnapshots(s) ? s.onSave((state, err) => this.onStorageSave(state, err)) : null;
  }

  get storage() { return this.deps.storage; }
  get storageKind() { return this.deps.storageKind ?? (hasSnapshots(this.deps.storage) ? 'indexeddb' : 'memory'); }
  get snapshotsSupported() { return hasSnapshots(this.deps.storage); }

  // ───────── React binding ─────────
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getVersion = () => this.version;
  subscribeUi = (l: () => void) => { this.uiListeners.add(l); return () => { this.uiListeners.delete(l); }; };
  getUiVersion = () => this.uiVersion;
  private emit() { this.version++; for (const l of this.listeners) l(); }
  private emitUi() { this.uiVersion++; for (const l of this.uiListeners) l(); }

  get clock() { return this.deps.clock ?? (() => new Date()); }
  today() { return this.planner ? this.planner.today() : this.clock().toISOString().slice(0, 10); }
  examName(examId: string | null | undefined) { return this.exams.find((e) => e.examId === examId)?.shortName ?? examId ?? ''; }

  // ───────── lifecycle ─────────
  async init() {
    this.status = 'loading';
    this.error = null;
    this.emit();
    try {
      this.useData(await this.loadData(false));
      const issues = [...((this.deps.storage as { issues?: string[] }).issues ?? []), ...this.engine.loadIssues, ...this.planner.loadIssues];
      for (const issue of issues) this.toast('info', issue);
      this.status = 'ready';
      this.emit();
      void this.dailySnapshot();
    } catch (e) {
      this.status = 'error';
      this.error = (e as Error).message;
      this.emit();
    }
    return this;
  }

  /** Builds engines from storage without touching the ones on screen. */
  private async loadData(quiet: boolean) {
    const { loader, storage } = this.deps;
    this.defaults = (this.deps.defaults ?? this.defaults ?? (await loader.loadDefaults?.())) as StoreDeps['defaults'] ?? null;
    if (!this.defaults) throw new Error('default configuration could not be loaded');
    const stored = (await storage.read(CONFIG_KEY)) as ProgressConfig | null;
    let config = this.defaults.progress;
    let customConfig = false;
    if (stored) {
      try { progress.compileConfig(stored); config = stored; customConfig = true; } catch (e) { if (!quiet) this.toast('error', `Saved scoring settings were invalid and have been ignored: ${(e as Error).message}`); }
    }
    const engine = await new progress.ProgressEngine({ loader, storage, config, clock: this.deps.clock }).init();
    const exams = await loader.listExams();
    const planner = await new plannerApi.StudyPlanner({ engine, storage, config: this.defaults.planner, clock: this.deps.clock }).init();
    const h = (await storage.read(HISTORY_KEY)) as HistoryData | null;
    return { engine, exams, planner, customConfig, history: h && h.kind === 'history' && h.exams ? h : emptyHistory() };
  }
  private useData(d: Awaited<ReturnType<AppStore['loadData']>>) {
    this.unsubscribe?.();
    this.engine = d.engine;
    this.exams = d.exams;
    this.planner = d.planner;
    this.customConfig = d.customConfig;
    this.history = d.history;
    this.unsubscribe = this.engine.subscribe(() => this.changed());
  }

  /** Shows data that changed in storage (from sync) without a loading screen, keeping open pages and forms. */
  async reload() {
    if (this.status !== 'ready') return this.init();
    let data: Awaited<ReturnType<AppStore['loadData']>> | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.flush();
      const before = this.version;
      data = await this.loadData(true);
      if (before === this.version) break; // nothing was edited while loading
    }
    this.useData(data!);
    this.emit();
    return this;
  }

  /** Moves the app to another account's (or the guest) database. */
  async switchStorage(storage: StorageAdapter, kind: NonNullable<StoreDeps['storageKind']>) {
    await this.flush().catch(() => {});
    this.deps = { ...this.deps, storage, storageKind: kind };
    this.watchStorage();
    this.saveState = 'saved';
    this.saveError = null;
    this.pending = 0;
    this.emitUi();
    return this.init();
  }

  /** Waits for every pending write (engine, planner, history). Rejects if the last write failed. */
  async flush() {
    if (this.status !== 'ready') return;
    if (this.historyTimer) { clearTimeout(this.historyTimer); this.historyTimer = null; await this.recordHistory(); }
    await Promise.all([this.engine.flush(), this.planner.flush()]);
    await (this.deps.storage as { flush?: () => Promise<void> }).flush?.();
  }

  private changed() {
    this.scheduleHistory();
    this.trackSave();
    this.emit();
  }
  private setSave(state: SaveState, error: string | null = null) {
    if (this.saveState === state && this.saveError === error) return;
    this.saveState = state;
    this.saveError = error;
    this.emitUi();
  }
  private onStorageSave(state: 'saving' | 'saved' | 'error', err?: Error) {
    if (state === 'error') this.setSave('error', err?.message ?? 'unknown error');
    else if (state === 'saving') this.setSave('saving');
    else if (this.pending === 0) this.setSave('saved');
  }
  private trackSave() {
    this.pending++;
    this.setSave('saving');
    Promise.all([this.engine.flush(), this.planner.flush()])
      // IndexedDB retries everything still pending, so a successful flush means all data is on disk
      .then(() => { if (--this.pending === 0 && (this.saveState !== 'error' || hasSnapshots(this.deps.storage))) this.setSave('saved'); })
      .catch((e) => {
        this.pending = Math.max(0, this.pending - 1);
        this.setSave('error', (e as Error).message);
        this.toast('error', `Save failed: ${(e as Error).message}. Your change is kept in memory; use “Retry” in the header.`);
      });
  }
  /** Retry writes that failed (IndexedDB keeps them pending). */
  async retrySave() {
    try {
      const s = this.deps.storage as { retry?: () => Promise<void> };
      if (s.retry) await s.retry();
      else { await this.engine.flush(); await this.planner.flush(); }
      this.setSave('saved');
      this.toast('success', 'All changes saved');
    } catch (e) {
      this.setSave('error', (e as Error).message);
      this.toast('error', `Save failed again: ${(e as Error).message}`);
    }
  }

  // ───────── notifications ─────────
  toast(kind: Toast['kind'], message: string, action?: Toast['action']) {
    const t: Toast = { id: ++this.toastSeq, kind, message, action };
    this.toasts = [...this.toasts.slice(-3), t];
    this.emitUi();
    if (typeof window !== 'undefined') setTimeout(() => this.dismissToast(t.id), kind === 'error' || action ? 8000 : 4000);
  }
  dismissToast(id: number) { this.toasts = this.toasts.filter((t) => t.id !== id); this.emitUi(); }

  /** Runs a user action; errors become a toast instead of crashing the page. */
  async run<T>(fn: () => T | Promise<T>, success?: string): Promise<T | undefined> {
    try {
      const out = await fn();
      if (success) this.toast('success', success);
      this.changed();
      return out;
    } catch (e) {
      this.toast('error', (e as Error).message);
      return undefined;
    }
  }

  // ───────── exam & scope ─────────
  get activeExamId() { return this.status === 'ready' ? this.engine.activeExamId : null; }
  report(): Report | null { return this.activeExamId ? this.engine.getReport() : null; }
  selectExam(examId: string) { return this.run(() => this.engine.switchExam(examId)); }
  setStage(stageId: string | null) { return this.run(() => this.engine.setStage(stageId)); }
  setTrack(trackId: string) { return this.run(() => this.engine.setTrack(trackId)); }
  setChoice(group: string, sectionId: string) { return this.run(() => this.engine.setChoice(group, sectionId)); }

  /** Run engine updates for another exam (engine methods act on the active exam), then return to the current one. */
  async withExam<T>(examId: string, fn: () => T | Promise<T>): Promise<T> {
    const prev = this.engine.activeExamId;
    if (prev !== examId) await this.engine.switchExam(examId);
    try {
      return await fn();
    } finally {
      if (prev && this.engine.activeExamId !== prev) await this.engine.switchExam(prev);
    }
  }

  // ───────── scoring configuration ─────────
  async setProgressConfig(config: ProgressConfig | null) {
    const next = config ?? this.defaults!.progress;
    this.engine.setConfig(next); // validates; throws without changing anything when invalid
    await this.deps.storage.write(CONFIG_KEY, config);
    this.customConfig = !!config;
    this.changed();
  }

  // ───────── history (trend) ─────────
  private scheduleHistory() {
    if (this.historyTimer) clearTimeout(this.historyTimer);
    this.historyTimer = setTimeout(() => { this.historyTimer = null; void this.recordHistory(); }, this.deps.historyDelayMs ?? 600);
  }
  /** Stores today's whole-exam completion/mastery for the active exam (one point per exam per day). */
  async recordHistory() {
    const examId = this.activeExamId;
    if (!examId) return;
    const r = this.engine.getReport({ stageId: null });
    const s = r.summary;
    const point: HistoryPoint = {
      completion: s.syllabusCompletion, mastery: s.examMastery, completed: s.topicCounts.completed, total: s.topicCounts.total,
      attempted: s.practice.attempted, accuracy: s.practice.accuracy,
    };
    const day = this.today();
    const exam = this.history.exams[examId] ?? {};
    const hasProgress = point.completion > 0 || point.attempted > 0 || Object.keys(exam).length > 0;
    if (!hasProgress || JSON.stringify(exam[day]) === JSON.stringify(point)) return;
    this.history = { ...this.history, exams: { ...this.history.exams, [examId]: { ...exam, [day]: point } } };
    await this.deps.storage.write(HISTORY_KEY, this.history);
    this.emit();
  }

  // ───────── backup (export / import) ─────────
  readCollections() { return this.currentCollections(); }
  private async currentCollections() {
    await this.flush().catch(() => {});
    const out: Record<string, unknown> = {};
    for (const k of ALL_KEYS) out[k] = await this.deps.storage.read(k);
    return out;
  }
  private mappingInfo() {
    const m = this.engine.mapping as { masterTopics?: { meta?: Record<string, unknown>; masters?: unknown[] } } | null;
    return m ? { masterTopics: m.masterTopics?.masters?.length ?? null, meta: m.masterTopics?.meta ?? null } : null;
  }

  async exportData() {
    return buildBackup({ collections: await this.currentCollections(), exportedAt: this.clock().toISOString(), mapping: this.mappingInfo() });
  }

  /** IDs of every topic and subtopic in an exam's syllabus (all tracks), for referential checks. */
  private async syllabusNodeIds(examIds: string[]) {
    for (const id of examIds) {
      if (this.syllabusIds.has(id) || !this.exams.some((e) => e.examId === id)) continue;
      const { syllabusExam } = await this.deps.loader.loadExam(id);
      const set = new Set<string>();
      const ex = syllabusExam as { stages: { sections: { topics: { topicId: string; subtopics: { id: string }[] }[] }[] }[] };
      for (const st of ex.stages) for (const sec of st.sections ?? []) for (const t of sec.topics ?? []) { set.add(t.topicId); for (const s of t.subtopics ?? []) set.add(s.id); }
      this.syllabusIds.set(id, set);
    }
  }

  /** Validates a backup and describes it next to the current data (nothing is written). */
  async previewImport(data: unknown): Promise<ValidationResult & { current: Awaited<ReturnType<typeof buildBackup>>['summary'] }> {
    const result = await this.validateData(data);
    const current = (await this.exportData()).summary;
    return { ...result, current };
  }
  private async validateData(data: unknown) {
    const c = (data as { collections?: Record<string, { exams?: Record<string, unknown> } | null> })?.collections ?? {};
    const referenced = [...new Set([...Object.keys(c.progress?.exams ?? {}), ...Object.keys(c.practice?.exams ?? {})])];
    await this.syllabusNodeIds(referenced).catch(() => {});
    return validateBackup(data, {
      knownExams: this.exams.map((e) => e.examId),
      nodeInExam: (examId, nodeId) => this.syllabusIds.get(examId)?.has(nodeId) ?? null,
      knownStatuses: this.engine.config.statuses.map((s) => s.id),
      validateConfig: (cfg) => progress.compileConfig(cfg as ProgressConfig),
    });
  }
  /** Runs the backup checks on data from the cloud before it is saved. An account with no progress yet is valid. */
  async validateCollections(collections: Record<string, unknown>) {
    const clean = Object.fromEntries(BACKUP_KEYS.map((k) => [k, collections[k] ?? null]));
    const result = await this.validateData({ format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, exportedAt: this.clock().toISOString(), collections: clean });
    const errors = clean.progress === null ? result.errors.filter((e) => !e.startsWith('Required collection')) : result.errors;
    return { ok: errors.length === 0, errors };
  }

  /**
   * Restores a validated backup. 'replace' = full restore (the backup becomes your data); 'merge' = combine safely
   * (see mergeCollections). A snapshot of the current data is taken first in both cases.
   */
  async importData(data: unknown, mode: ImportMode = 'replace'): Promise<{ report: MergeReport | null; snapshot: SnapshotInfo | null }> {
    const v = await this.previewImport(data);
    if (!v.ok) throw new Error(`The backup cannot be imported: ${v.errors.slice(0, 3).join(' ')}`);
    const incoming = (data as { collections: Record<string, unknown> }).collections;
    const current = await this.currentCollections();
    const snapshot = await this.snapshot('before-import');
    let next: Record<string, unknown>;
    let report: MergeReport | null = null;
    if (mode === 'merge') ({ collections: next, report } = mergeCollections(current, incoming, this.clock().toISOString()));
    else next = Object.fromEntries(ALL_KEYS.map((k) => [k, incoming[k] ?? null]));
    await this.writeAll(next);
    await this.init();
    if (this.status !== 'ready') throw new Error(this.error ?? 'import failed');
    return { report, snapshot };
  }

  private async writeAll(collections: Record<string, unknown>) {
    const entries = ALL_KEYS.map((k) => [k, collections[k] ?? null] as [string, unknown]);
    const s = this.deps.storage as StorageAdapter & { writeMany?: (e: [string, unknown][]) => Promise<void> };
    if (s.writeMany) await s.writeMany(entries); // one atomic transaction
    else for (const [k, v] of entries) await s.write(k, v);
  }

  async resetAll() {
    await this.snapshot('before-reset');
    await this.flush().catch(() => {});
    await this.writeAll({});
    await this.init();
  }

  // ───────── local snapshots (IndexedDB) ─────────
  async snapshot(reason: SnapshotReason): Promise<SnapshotInfo | null> {
    if (!hasSnapshots(this.deps.storage)) return null;
    await this.flush().catch(() => {});
    return this.deps.storage.createSnapshot(reason, ALL_KEYS);
  }
  async listSnapshots(): Promise<SnapshotInfo[]> { return hasSnapshots(this.deps.storage) ? this.deps.storage.listSnapshots() : []; }
  async deleteSnapshot(id: string) { if (hasSnapshots(this.deps.storage)) await this.deps.storage.deleteSnapshot(id); }
  async snapshotAsBackup(id: string) {
    if (!hasSnapshots(this.deps.storage)) throw new Error('snapshots are not available');
    const s = await this.deps.storage.getSnapshot(id);
    if (!s) throw new Error('snapshot not found');
    return buildBackup({ collections: s.collections, exportedAt: s.createdAt, mapping: this.mappingInfo() });
  }
  async restoreSnapshot(id: string) {
    if (!hasSnapshots(this.deps.storage)) throw new Error('snapshots are not available');
    const s = await this.deps.storage.getSnapshot(id);
    if (!s) throw new Error('snapshot not found');
    await this.snapshot('before-restore');
    await this.writeAll(s.collections);
    await this.init();
  }
  /** One automatic restore point per day (only when there is data). */
  private async dailySnapshot() {
    if (!hasSnapshots(this.deps.storage) || !this.deps.storage.keys().some((k) => k !== HISTORY_KEY)) return;
    try {
      const last = (await this.deps.storage.listSnapshots()).find((x) => x.reason === 'daily');
      if (!last || last.createdAt.slice(0, 10) !== this.today()) await this.deps.storage.createSnapshot('daily', ALL_KEYS);
    } catch { /* snapshots are best-effort; the live data is unaffected */ }
  }

  // ───────── CSV ─────────
  async exportCsv(kind: CsvKind, examIds: string[]) {
    const reports = await this.engine.getCrossExamReports(examIds);
    return buildCsv(kind, {
      reports,
      records: Object.fromEntries(examIds.map((e) => [e, this.engine.getExamRecords(e)])),
      sessions: Object.fromEntries(examIds.map((e) => [e, this.engine.getExamSessions(e)])),
      plans: this.planner.data.plans,
      examName: (id) => this.examName(id),
    });
  }
  /** Exams that have any saved progress or practice. */
  examsWithData() {
    return this.exams.map((e) => e.examId).filter((id) => this.engine.getExamRecords(id) || this.engine.getExamSessions(id).length);
  }

  // ───────── integrity check ─────────
  async checkIntegrity() {
    const backup = await this.exportData();
    const v = await this.previewImport(backup);
    const orphans: string[] = [];
    const examIds = this.examsWithData();
    const reports = await this.engine.getCrossExamReports(examIds);
    for (const id of examIds) for (const o of reports[id].diagnostics.orphanRecords as { nodeId?: string; id?: string }[]) orphans.push(`${this.examName(id)}: ${o.nodeId ?? o.id ?? JSON.stringify(o)}`);
    return { errors: v.errors, warnings: v.warnings, orphans, summary: v.summary, checkedAt: this.clock().toISOString() };
  }

  // ───────── storage info ─────────
  async storageInfo() {
    const nav = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    const [estimate, persisted] = await Promise.all([nav?.estimate?.().catch(() => null) ?? null, nav?.persisted?.().catch(() => false) ?? false]);
    return { kind: this.storageKind, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null, persisted: !!persisted };
  }
  async requestPersistence() {
    const ok = await (typeof navigator !== 'undefined' ? navigator.storage?.persist?.() : undefined)?.catch(() => false);
    return !!ok;
  }
}
