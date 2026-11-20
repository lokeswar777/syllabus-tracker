/**
 * Typed bridge to the existing engines in ../src (Phase 3 progress, Phase 4 mapping, Phase 5 planner).
 * The app never re-implements their logic: every number on screen comes from these modules.
 */
// @ts-expect-error untyped JS module (the engines are plain ESM shared with the Node tests)
import * as progressModule from '../../../src/progress/index.js';
// @ts-expect-error untyped JS module
import * as plannerModule from '../../../src/planner/index.js';
import type {
  DailyPlan, ExamInfo, ExamModel, ExamRecords, Explanation, MockRecommendation, PracticeSession, PriorityTopic,
  Recommendation, Report, RevisionInfo, RevisionTracker, Share, SharedDashboard, Target, Task, WeakAreas, PerExamRow, PlannerAction,
} from './types';

export interface StorageAdapter { read(key: string): Promise<unknown>; write(key: string, value: unknown): Promise<void> }
export interface Loader {
  listExams(): Promise<ExamInfo[]>;
  loadExam(examId: string): Promise<{ syllabusExam: unknown; weightageExam: unknown }>;
  loadMapping?(): Promise<unknown>;
}

export interface Engine {
  loadIssues: string[];
  config: ProgressConfig;
  mapping: unknown;
  readonly activeExamId: string | null;
  init(): Promise<Engine>;
  switchExam(examId: string, o?: { trackId?: string; stageId?: string | null }): Promise<Report>;
  getModel(): ExamModel;
  getReport(o?: { stageId?: string | null }): Report;
  getCrossExamReports(examIds: string[]): Promise<Record<string, Report>>;
  getSharedTopicDashboard(examIds: string[]): Promise<SharedDashboard>;
  getConcept(id: string): { status: string | null; conceptCompletion: number; notes: string; learningDates: string[]; linkedExams: { examId: string; syncMode: string }[] } | null;
  getExamSessions(examId: string): readonly PracticeSession[];
  getExamRecords(examId: string): ExamRecords | null;
  getWeightOverrides(examId: string): Record<string, number>;
  updateTopic(topicId: string, patch: Record<string, unknown>): Report;
  updateSubtopic(id: string, patch: Record<string, unknown>): Report;
  setStatus(nodeId: string, status: string): Report;
  addRevision(nodeId: string, o: { date?: string; note?: string }): Report;
  recordPractice(nodeId: string, s: { attempted: number; correct: number; timeSeconds?: number | null; date?: string; revision?: boolean; stageId?: string | null; difficulty?: string | null; note?: string }): Report;
  deletePractice(sessionId: string): Report;
  updateConcept(id: string, patch: Record<string, unknown>): void;
  setSyncMode(id: string, mode: string | null): void;
  setSharedLearningEnabled(enabled: boolean): void;
  setStage(stageId: string | null): Report;
  setTrack(trackId: string): Report;
  setChoice(group: string, sectionId: string): Report;
  setWeightOverride(k: { kind: 'stage' | 'section' | 'topic' | 'subtopic'; stageId?: string; sectionId?: string; topicId?: string; slug?: string }, value: number | null): Report;
  setConfig(config: ProgressConfig): Report | null;
  subscribe(l: (v: number) => void): () => void;
  getVersion(): number;
  flush(): Promise<void>;
  db: { progress: { settings: { activeExamId?: string | null; sharedLearning?: boolean } } };
}

export interface ProgressConfig {
  statuses: { id: string; label: string; score: number; phase: string }[];
  classification: Record<string, unknown>;
  sharedLearning: Record<string, unknown>;
  mastery: {
    weights: Record<'concept' | 'accuracy' | 'consistency' | 'revision' | 'speed', number>;
    accuracy: { targetQuestions: { topic: number; subtopic: number } } & Record<string, unknown>;
    consistency: { targetPracticeSets: { topic: number; subtopic: number }; fullCreditDays: number; zeroCreditDays: number } & Record<string, unknown>;
    revision: { targetRevisions: number } & Record<string, unknown>;
    speed: { targetSecondsPerQuestion: number } & Record<string, unknown>;
  } & Record<string, unknown>;
  [k: string]: unknown;
}

export interface PlannerConfig {
  priority: { weights: Record<string, number>; classification: { thresholds: Record<string, number> } } & Record<string, unknown>;
  revision: { intervalsDays: number[] } & Record<string, unknown>;
  dailyPlan: { defaultHours: number } & Record<string, unknown>;
  [k: string]: unknown;
}

export interface Planner {
  loadIssues: string[];
  topicNames: Map<string, string>;
  readonly settings: { targets: Target[]; dailyHours: number | null; configOverrides: Record<string, unknown> };
  data: { dismissed: Record<string, { topicId: string; examId: string | null; until: string | null; reason: string }>; plans: Record<string, DailyPlan> };
  init(): Promise<Planner>;
  config(): PlannerConfig;
  today(): string;
  setTargets(t: { examId: string; importance: number; examDate?: string | null }[]): Promise<void>;
  setExamImportance(examId: string, importance: number): Promise<void>;
  setExamDate(examId: string, date: string | null): Promise<void>;
  setDailyHours(h: number): Promise<void>;
  setConfigOverrides(o: Record<string, unknown>): Promise<void>;
  setRevisionIntervals(iv: number[]): Promise<void>;
  dismissRecommendation(topicId: string, o?: { examId?: string | null; until?: string | null; reason?: string }): Promise<void>;
  undismissRecommendation(topicId: string, o?: { examId?: string | null }): Promise<void>;
  compute(): Promise<{ priorities: { topics: PriorityTopic[]; perExam: Record<string, Record<string, PerExamRow>> }; shares: Share[]; weakAreas: Record<string, WeakAreas>; warnings: string[] }>;
  getPriorities(): Promise<{ shares: Share[]; warnings: string[]; topics: (PriorityTopic & { dismissed: boolean })[] }>;
  getRecommendations(o?: { limit?: number }): Promise<{ generatedFor: string; shares: Share[]; recommendations: Recommendation[]; examRecommendations: MockRecommendation[] }>;
  explain(topicId: string): Promise<Explanation>;
  getRevisionTracker(): Promise<RevisionTracker>;
  getWeakAreas(): Promise<Record<string, WeakAreas>>;
  getInsights(): Promise<Record<string, unknown>>;
  generateDailyPlan(date?: string, o?: { hours?: number; excludeTopicIds?: string[] }): Promise<DailyPlan>;
  getDailyPlan(date?: string): DailyPlan | null;
  addTask(date: string, t: { topicId?: string | null; examId: string; action: PlannerAction; minutes: number; detail?: string; name?: string | null }): Promise<string>;
  removeTask(date: string, taskId: string): Promise<void>;
  reorderTasks(date: string, ids: string[]): Promise<void>;
  moveTask(from: string, taskId: string, to: string, o?: { index?: number | null }): Promise<string>;
  completeTask(date: string, taskId: string, o?: { outcome?: Record<string, unknown> | null; note?: string }): Promise<Task>;
  reopenTask(date: string, taskId: string): Promise<void>;
  flush(): Promise<void>;
}

type ProgressModule = {
  ProgressEngine: new (o: { loader: Loader; storage: StorageAdapter; config: ProgressConfig; clock?: () => Date }) => Engine;
  WebStorageAdapter: new (s: Storage, prefix?: string) => StorageAdapter;
  MemoryStorage: new (initial?: Record<string, unknown>) => StorageAdapter;
  compileConfig: (c: ProgressConfig) => unknown;
  weightKey: { stage(trackId: string, stageId: string): string; section(stageId: string, sectionId: string): string; topic(stageId: string, sectionId: string, topicId: string): string };
  progressDb: { COLLECTIONS: string[] };
};
type PlannerModule = {
  StudyPlanner: new (o: { engine: Engine; storage: StorageAdapter; config: PlannerConfig; clock?: () => Date }) => Planner;
  PLANNER_KEY: string;
  resolvePlannerConfig: (defaults: PlannerConfig, overrides?: Record<string, unknown>) => PlannerConfig;
  computePriorities: (o: { reports: Record<string, Report>; sessions: Record<string, readonly PracticeSession[]>; shares: Partial<Share>[]; cfg: PlannerConfig; today: string }) => { topics: PriorityTopic[]; perExam: Record<string, Record<string, PerExamRow>> };
  detectWeakAreas: (o: { perExam: Record<string, Record<string, PerExamRow>>; reports: Record<string, Report>; sessions: Record<string, readonly PracticeSession[]>; cfg: PlannerConfig }) => Record<string, WeakAreas>;
  computeRevision: (o: { topic: unknown; sessions?: readonly PracticeSession[]; cfg: PlannerConfig; today: string }) => RevisionInfo;
  estimateMinutes: (action: PlannerAction, row: unknown, cfg: PlannerConfig, pending?: number) => number;
  examShares: (targets: Target[], today: string, cfg: PlannerConfig) => Share[];
  ACTIONS: PlannerAction[];
};

export const progress = progressModule as ProgressModule;
export const planner = plannerModule as PlannerModule;
export const COLLECTIONS: string[] = progress.progressDb.COLLECTIONS;
export const PLANNER_KEY: string = planner.PLANNER_KEY;
