// Types for the data produced by the existing engines (src/progress, src/mapping, src/planner).
// They describe the engines' outputs; nothing here computes values.

export type ExamInfo = { examId: string; shortName: string; name: string; category: string };

export type StatusDef = { id: string; label: string; score: number; phase: string };

export interface PracticeStats {
  attempted: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  practiceSets: number;
  avgTimeSeconds: number | null;
  revisionCount: number;
  revisionAccuracy: number | null;
  lastPracticed: string | null;
  lastRevised: string | null;
  practiceDifficulty: string | null;
}

export interface Requirement {
  stageClass?: string;
  depth?: string;
  depthDescription?: string;
  difficulty?: 'easy' | 'medium' | 'hard' | null;
  questionTarget?: number | null;
  accuracyTarget?: number | null;
  speedTargetSec?: number | null;
}

export interface TargetGap { target: string; have: number | null; need: number }
export interface TargetsMet { questions: boolean; accuracy: boolean; speed: boolean; all: boolean; gaps: TargetGap[] }

export interface TopicReport extends PracticeStats {
  topicId: string;
  name: string;
  subject: string;
  priority: string | null;
  trend: string | null;
  weightageConfidence: string | null;
  masterTopicId: string | null;
  inScope: boolean;
  isGateOnly: boolean;
  effectiveWeight: number;
  status: string | null;
  completion: number;
  ownCompletion: number;
  sharedUplift: number;
  mastery: number;
  masteryOverridden: boolean;
  masteryLevel: string;
  masteryComponents: Record<string, number>;
  concept: number;
  contribution: number;
  remaining: number;
  category: string;
  sharedLearning: { enabled: boolean; syncMode: string; subtopicsUsingShared: number; conceptStatus: string | null; conceptCompletion: number } | null;
  requirement: Requirement | null;
  targetsMet: TargetsMet | null;
  subtopicIds: string[];
  occurrences: { stageId: string; sectionKey: string; weightInExam: number; weightInStage: number }[];
  notes: string;
  startDate: string | null;
  completionDate: string | null;
  lastUpdated: string | null;
  targetDifficulty: string | null;
}

export interface SubtopicReport extends PracticeStats {
  id: string;
  topicId: string;
  name: string;
  status: string | null;
  inheritedStatus: string | null;
  effectiveStatus: string;
  completionSource: string;
  completion: number;
  ownCompletion: number;
  mastery: number;
  masteryLevel: string;
  concept: number;
  notes: string;
  startDate: string | null;
  completionDate: string | null;
}

export interface SectionTopic {
  topicId: string;
  name: string;
  weightInSection: number;
  weightInExam: number;
  completion: number;
  mastery: number;
  contribution: number;
  subtopics: { id: string; weightInTopic: number }[];
}

export interface SectionReport {
  sectionId: string;
  key: string;
  name: string;
  gate: boolean;
  active: boolean;
  choiceGroup: string | null;
  weightInStage: number;
  weightInExam: number;
  completion: number;
  mastery: number;
  topics: SectionTopic[];
}

export interface StageReport {
  stageId: string;
  name: string;
  gate: boolean;
  inScope: boolean;
  weightInExam: number;
  completion: number;
  mastery: number;
  sections: SectionReport[];
}

export interface SectionWise {
  stageId: string;
  sectionId: string;
  key: string;
  name: string;
  gate: boolean;
  weightInStage: number;
  weightInScope: number;
  completion: number;
  mastery: number;
}

export interface Report {
  examId: string;
  shortName: string;
  category: string;
  trackId: string;
  trackName: string;
  scope: { type: string; stageId?: string };
  calculatedAt: string;
  summary: {
    syllabusCompletion: number;
    ownSyllabusCompletion: number;
    sharedLearningUplift: number;
    examMastery: number;
    remainingWeightedSyllabus: number;
    topicCounts: { total: number; completed: number; inProgress: number; pending: number; mastered: number; markedMasteredStatus: number };
    practice: PracticeStats;
  };
  analytics: {
    sectionWise: SectionWise[];
    completedTopics: string[];
    inProgressTopics: string[];
    pendingTopics: string[];
    masteredTopics: string[];
    highWeightIncomplete: { topicId: string; name: string; priority: string; effectiveWeight: number; completion: number; mastery: number; remainingWeight: number }[];
    gates: { stageId: string; sectionId: string; name: string; completion: number; passFail: boolean }[];
  };
  stages: StageReport[];
  topics: Record<string, TopicReport>;
  subtopics: Record<string, SubtopicReport>;
  diagnostics: { warnings: string[]; orphanRecords: unknown[]; ignoredSessions: unknown[] };
}

export interface ExamModel {
  examId: string;
  shortName: string;
  name: string;
  category: string;
  trackId: string;
  trackName: string;
  tracks: { trackId: string; name: string; default: boolean }[];
  choiceGroups: Record<string, { sectionId: string; name: string }[]> | Record<string, unknown>;
  stages: { id?: string; stageId?: string; name: string }[];
  topics: Record<string, unknown>;
}

export interface PracticeSession {
  id: string;
  nodeId: string;
  date: string;
  attempted: number;
  correct: number;
  incorrect: number;
  timeSeconds: number | null;
  difficulty: string | null;
  practiceSet: boolean;
  revision: boolean;
  stageId: string | null;
  level: string | null;
  note: string;
  createdAt: string;
}

export interface NodeRecord {
  status?: string | null;
  notes?: string;
  revisions?: { date: string; note?: string }[];
  startDate?: string | null;
  completionDate?: string | null;
}
export interface ExamRecords {
  examId: string;
  trackId: string | null;
  stageId: string | null;
  choices: Record<string, string>;
  topics: Record<string, NodeRecord>;
  subtopics: Record<string, NodeRecord>;
}

// ── planner (Phase 5) ──
export type PriorityClass = 'Critical' | 'High' | 'Medium' | 'Low';
export type PlannerAction = 'learn-concept' | 'complete-subtopics' | 'practice-questions' | 'sectional-test' | 'revise-notes' | 'mock-test';

export interface Target { examId: string; importance: number; examDate: string | null }
export interface Share { examId: string; importance: number; examDate: string | null; daysLeft: number | null; urgency: number; past: boolean; share: number }

export interface RevisionInfo {
  studied: boolean;
  status: 'overdue' | 'due-today' | 'due-soon' | 'scheduled' | 'not-studied' | 'unscheduled';
  lastStudied: string | null;
  lastRevised: string | null;
  revisionCount: number;
  revisionNumber: number | null;
  intervalDays: number | null;
  nextDue: string | null;
  daysOverdue: number;
  daysUntilDue: number | null;
  previousAccuracy: number | null;
  mastery: number;
  intervalShortenedForLowAccuracy?: boolean;
}

export interface PerExamRow {
  examId: string;
  examName: string;
  topicId: string;
  name: string;
  subject: string;
  section: { key: string; name: string } | null;
  effectiveWeight: number;
  completion: number;
  mastery: number;
  priorityClassPhase2: string | null;
  score: number;
  classification: PriorityClass;
  done: boolean;
  factors: Record<string, number>;
  contributions: Record<string, number>;
  reasons: string[];
  action: { action: PlannerAction; detail: string };
  revision: RevisionInfo;
  share?: number;
  contribution?: number;
  attempted: number;
  accuracy: number | null;
}

export interface PriorityTopic {
  topicId: string;
  name: string;
  subject: string;
  masterTopicId: string | null;
  score: number;
  classification: PriorityClass;
  exams: string[];
  examCount: number;
  primaryExamId: string;
  done: boolean;
  perExam: Record<string, PerExamRow>;
}

export interface Recommendation {
  rank: number;
  topicId: string;
  name: string;
  subject: string;
  masterTopicId: string | null;
  priorityScore: number;
  classification: PriorityClass;
  relevantExam: { examId: string; name: string };
  section: string | null;
  topicWeightage: number;
  syllabusCompletion: number;
  examMastery: number;
  reasons: string[];
  suggestedAction: { action: PlannerAction; label: string; detail: string };
  relevantExams: { examId: string; name: string; share: number; score: number; contribution: number; section: string | null; topicWeightage: number; syllabusCompletion: number; examMastery: number; action: PlannerAction; revisionStatus: string }[];
}
export interface MockRecommendation { examId: string; examName: string; syllabusCompletion: number; daysLeft: number | null; lastMock: string | null; reason: string; action: 'mock-test'; label: string }

export interface Explanation {
  topicId: string;
  name: string;
  score: number;
  classification: PriorityClass;
  formula: string;
  thresholds: Record<PriorityClass, number>;
  weights: Record<string, number>;
  perExam: { examId: string; share: number; score: number; contribution: number; classification: PriorityClass; factors: Record<string, number>; contributions: Record<string, number>; reasons: string[]; arithmetic: string; action: { action: PlannerAction; detail: string } }[];
}

export interface Task {
  taskId: string;
  kind: 'topic' | 'exam';
  topicId: string | null;
  name: string;
  subject: string | null;
  examIds: string[];
  primaryExamId: string;
  section: string | null;
  action: PlannerAction;
  detail: string | null;
  minutes: number;
  priorityScore: number | null;
  classification: PriorityClass | null;
  reason: string | null;
  source: 'auto' | 'manual';
  status: 'pending' | 'completed';
  order: number;
  completedAt?: string;
  note?: string;
  progressUpdates?: { via: string }[];
}
export interface DailyPlan { date: string; hours: number; budgetMinutes: number; plannedMinutes: number; generatedAt: string | null; tasks: Task[]; removed: string[]; customOrder: string[] | null }

export interface RevisionTracker {
  today: string;
  intervalsDays: number[];
  summary: { tracked: number; overdue: number; dueToday: number; dueSoon: number; scheduled: number };
  items: (RevisionInfo & { examId: string; topicId: string; name: string; section: string | null })[];
}

export interface WeakItem {
  topicId: string;
  name: string;
  section: string | null;
  effectiveWeight: number;
  completion: number;
  mastery: number;
  category: string;
  flags: string[];
  weakness: number;
  evidence: Record<string, number | null>;
}
export interface WeakAreas {
  weakTopics: WeakItem[];
  weakestSections: { stageId: string; sectionId: string; name: string; weightInExam: number; completion: number; mastery: number }[];
  categories: Record<string, { count: number; topicIds: string[] }>;
  all: Record<string, WeakItem>;
}

// ── mapping (Phase 4) ──
export interface TopicCardExam {
  category: string;
  syncMode: 'full' | 'partial' | 'independent';
  status: string | null;
  completion: number;
  ownCompletion: number;
  mastery: number;
  masteryLevel: string;
  attempted: number;
  accuracy: number | null;
  avgTimeSeconds: number | null;
  effectiveWeight: number;
  priority: string | null;
  requirement: Requirement | null;
  targetsMet: TargetsMet | null;
}
export interface TopicCard {
  masterTopicId: string;
  topicId: string;
  name: string;
  subject: string;
  similarity: string;
  verification: string;
  concept: { completion: number; status: string | null };
  exams: Record<string, TopicCardExam>;
}
export interface SharedDashboard {
  selectedExams: string[];
  counts: Record<string, number>;
  topicCards: Record<string, TopicCard>;
}

export interface HistoryPoint { completion: number; mastery: number; completed: number; total: number; attempted: number; accuracy: number | null }
export interface HistoryData { schemaVersion: 1; kind: 'history'; exams: Record<string, Record<string, HistoryPoint>> }
