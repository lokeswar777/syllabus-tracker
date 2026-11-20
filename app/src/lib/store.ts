/**
 * AppStore: the single source of truth for the UI.
 *
 * It owns exactly one ProgressEngine (Phase 3/4) and one StudyPlanner (Phase 5), both on the same storage
 * adapter. Collections are stored under their own keys (written by the engines themselves):
 *   progress, sharedLearning, practice, weightOverrides, syncSettings   ← ProgressEngine
 *   planner                                                            ← StudyPlanner
 *   progressConfig   user-edited scoring config (status scores, mastery parameters); absent = defaults
 *   history          daily snapshot of each exam's whole-exam completion/mastery, for the trend chart
 * React subscribes through subscribe()/getVersion() (useSyncExternalStore).
 */
import { progress, planner as plannerApi, COLLECTIONS, PLANNER_KEY } from './engines';
import type { Engine, Loader, Planner, PlannerConfig, ProgressConfig, StorageAdapter } from './engines';
import type { ExamInfo, HistoryData, HistoryPoint, Report } from './types';

export const CONFIG_KEY = 'progressConfig';
export const HISTORY_KEY = 'history';
export const ALL_KEYS = [...COLLECTIONS, PLANNER_KEY, CONFIG_KEY, HISTORY_KEY];
export const EXPORT_FORMAT = 'syllabus-tracker-export';

export type Status = 'idle' | 'loading' | 'ready' | 'error';
export type SaveState = 'saved' | 'saving' | 'error';
export interface Toast { id: number; kind: 'success' | 'error' | 'info'; message: string }

export interface StoreDeps {
  loader: Loader & { loadDefaults?(): Promise<{ progress: unknown; planner: unknown }> };
  storage: StorageAdapter;
  defaults?: { progress: ProgressConfig; planner: PlannerConfig };
  clock?: () => Date;
  historyDelayMs?: number;
}

const emptyHistory = (): HistoryData => ({ schemaVersion: 1, kind: 'history', exams: {} });

export class AppStore {
  status: Status = 'idle';
  error: string | null = null;
  saveState: SaveState = 'saved';
  toasts: Toast[] = [];
  exams: ExamInfo[] = [];
  defaults: { progress: ProgressConfig; planner: PlannerConfig } | null = null;
  customConfig = false;
  history: HistoryData = emptyHistory();
  engine!: Engine;
  planner!: Planner;

  private listeners = new Set<() => void>();
  private version = 0;
  private toastSeq = 0;
  private historyTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private pending = 0;

  constructor(private deps: StoreDeps) {}

  // ───────── React binding ─────────
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getVersion = () => this.version;
  private emit() { this.version++; for (const l of this.listeners) l(); }

  get clock() { return this.deps.clock ?? (() => new Date()); }
  today() { return this.planner ? this.planner.today() : this.clock().toISOString().slice(0, 10); }
  examName(examId: string | null | undefined) { return this.exams.find((e) => e.examId === examId)?.shortName ?? examId ?? ''; }

  // ───────── lifecycle ─────────
  async init() {
    this.status = 'loading';
    this.error = null;
    this.emit();
    try {
      const { loader, storage } = this.deps;
      this.defaults = (this.deps.defaults ?? (await loader.loadDefaults?.())) as StoreDeps['defaults'] ?? null;
      if (!this.defaults) throw new Error('default configuration could not be loaded');
      const stored = (await storage.read(CONFIG_KEY)) as ProgressConfig | null;
      let config = this.defaults.progress;
      this.customConfig = false;
      if (stored) {
        try { progress.compileConfig(stored); config = stored; this.customConfig = true; } catch (e) { this.toast('error', `Saved scoring settings were invalid and have been ignored: ${(e as Error).message}`); }
      }
      this.unsubscribe?.();
      this.engine = await new progress.ProgressEngine({ loader, storage, config, clock: this.deps.clock }).init();
      this.exams = await loader.listExams();
      this.planner = await new plannerApi.StudyPlanner({ engine: this.engine, storage, config: this.defaults.planner, clock: this.deps.clock }).init();
      const h = (await storage.read(HISTORY_KEY)) as HistoryData | null;
      this.history = h && h.kind === 'history' && h.exams ? h : emptyHistory();
      for (const issue of [...this.engine.loadIssues, ...this.planner.loadIssues]) this.toast('info', issue);
      this.unsubscribe = this.engine.subscribe(() => this.changed());
      this.status = 'ready';
      this.emit();
    } catch (e) {
      this.status = 'error';
      this.error = (e as Error).message;
      this.emit();
    }
    return this;
  }

  /** Waits for every pending write (engine, planner, history). */
  async flush() {
    if (this.status !== 'ready') return;
    await Promise.all([this.engine.flush(), this.planner.flush()]);
    if (this.historyTimer) { clearTimeout(this.historyTimer); this.historyTimer = null; await this.recordHistory(); }
  }

  private changed() {
    this.scheduleHistory();
    this.trackSave();
    this.emit();
  }
  private trackSave() {
    this.pending++;
    if (this.saveState !== 'saving') { this.saveState = 'saving'; }
    Promise.all([this.engine.flush(), this.planner.flush()])
      .then(() => { if (--this.pending === 0) { this.saveState = 'saved'; this.emit(); } })
      .catch((e) => { this.pending = Math.max(0, this.pending - 1); this.saveState = 'error'; this.toast('error', `Saving failed: ${(e as Error).message}`); });
  }

  // ───────── notifications ─────────
  toast(kind: Toast['kind'], message: string) {
    const t = { id: ++this.toastSeq, kind, message };
    this.toasts = [...this.toasts.slice(-3), t];
    this.emit();
    if (typeof window !== 'undefined') setTimeout(() => this.dismissToast(t.id), kind === 'error' ? 8000 : 4000);
  }
  dismissToast(id: number) { this.toasts = this.toasts.filter((t) => t.id !== id); this.emit(); }

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

  // ───────── export / import / reset ─────────
  async exportData() {
    await this.flush();
    const collections: Record<string, unknown> = {};
    for (const k of ALL_KEYS) collections[k] = await this.deps.storage.read(k);
    return { format: EXPORT_FORMAT, formatVersion: 1, exportedAt: this.clock().toISOString(), collections };
  }

  /** Validates an export file, writes its collections and reloads the engines from them. */
  async importData(data: unknown) {
    const d = data as { format?: string; collections?: Record<string, unknown> };
    if (!d || d.format !== EXPORT_FORMAT || typeof d.collections !== 'object' || !d.collections) throw new Error('Not a Syllabus Tracker export file.');
    const kinds: Record<string, string> = { progress: 'progress', sharedLearning: 'shared-learning', practice: 'practice', weightOverrides: 'weight-overrides', syncSettings: 'sync-settings', planner: 'planner', history: 'history' };
    for (const [k, v] of Object.entries(d.collections)) {
      if (!ALL_KEYS.includes(k)) throw new Error(`Unknown collection '${k}' in the import file.`);
      if (v === null || k === CONFIG_KEY) continue;
      if (typeof v !== 'object' || (kinds[k] && (v as { kind?: string }).kind !== kinds[k])) throw new Error(`Collection '${k}' has an unexpected format.`);
    }
    if (d.collections[CONFIG_KEY]) progress.compileConfig(d.collections[CONFIG_KEY] as ProgressConfig);
    await this.flush();
    for (const k of ALL_KEYS) await this.deps.storage.write(k, d.collections[k] ?? null);
    await this.init();
    if (this.status !== 'ready') throw new Error(this.error ?? 'import failed');
  }

  async resetAll() {
    await this.flush();
    for (const k of ALL_KEYS) await this.deps.storage.write(k, null);
    await this.init();
  }
}
