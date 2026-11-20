/**
 * Derived views for the pages. Every value is taken from the engines' outputs:
 *   - progress report (calculateProgress)           → completion, mastery, weights, counts
 *   - computePriorities / detectWeakAreas / computeRevision (Phase 5, pure) → per-topic priority, weakness, revision
 *   - practice sessions (engine.getExamSessions)    → aggregated, never estimated
 * Selectors only regroup or filter; they never invent or recompute scores.
 */
import { planner as plannerApi } from './engines';
import type { PlannerConfig } from './engines';
import type { PerExamRow, PracticeSession, PriorityTopic, Report, RevisionInfo, Target, WeakAreas, HistoryData } from './types';
import { daysBetween, weekStart } from './format';

export interface ExamAnalysis {
  rows: Record<string, PerExamRow>;
  priorities: PriorityTopic[];
  weak: WeakAreas;
  revisions: Record<string, RevisionInfo>;
}

const analysisCache = new Map<string, ExamAnalysis>();

/** Phase 5 analysis of ONE exam in the current scope (priority, revision, weak areas), independent of planner targets. */
export function examAnalysis({ report, sessions, cfg, today, target, version }: { report: Report; sessions: readonly PracticeSession[]; cfg: PlannerConfig; today: string; target?: Target | null; version: string }): ExamAnalysis {
  const key = `${version}|${report.examId}|${report.scope.stageId ?? 'all'}|${today}|${target?.examDate ?? ''}`;
  const hit = analysisCache.get(key);
  if (hit) return hit;
  const examId = report.examId;
  const daysLeft = target?.examDate ? daysBetween(today, target.examDate) : null;
  const shares = [{ examId, importance: 100, examDate: target?.examDate ?? null, daysLeft, urgency: 0, past: false, share: 1 }];
  const reports = { [examId]: report };
  const sess = { [examId]: sessions };
  const pr = plannerApi.computePriorities({ reports, sessions: sess, shares, cfg, today });
  const weak = plannerApi.detectWeakAreas({ perExam: pr.perExam, reports, sessions: sess, cfg })[examId];
  const rows = pr.perExam[examId] ?? {};
  const revisions = Object.fromEntries(Object.values(rows).map((r) => [r.topicId, r.revision]));
  const out = { rows, priorities: pr.topics, weak, revisions };
  analysisCache.clear();
  analysisCache.set(key, out);
  return out;
}

/** In-scope topics of the report, in syllabus order, each with the section(s) it appears in. */
export function scopeTopics(report: Report) {
  const seen = new Set<string>();
  const out: { topicId: string; stageId: string; sectionKey: string; sectionName: string; weightInSection: number; weightInExam: number }[] = [];
  for (const st of report.stages) {
    if (!st.inScope) continue;
    for (const sec of st.sections) {
      for (const t of sec.topics) {
        if (seen.has(t.topicId)) continue;
        seen.add(t.topicId);
        out.push({ topicId: t.topicId, stageId: st.stageId, sectionKey: sec.key, sectionName: sec.name, weightInSection: t.weightInSection, weightInExam: t.weightInExam });
      }
    }
  }
  return out;
}

/** Number of in-scope topics per status (uses the engine's status list and the topic's effective status). */
export function statusDistribution(report: Report, statuses: { id: string; label: string }[]) {
  const counts = new Map(statuses.map((s) => [s.id, 0]));
  for (const t of Object.values(report.topics)) {
    if (!t.inScope) continue;
    const id = t.status ?? 'not-started';
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return statuses.map((s) => ({ id: s.id, label: s.label, count: counts.get(s.id) ?? 0 }));
}

/** Sessions that belong to the current scope (all stages, or one stage). */
export function scopedSessions(report: Report, sessions: readonly PracticeSession[]) {
  const stageId = report.scope.stageId ?? null;
  return sessions.filter((s) => {
    const topic = report.topics[topicOf(s.nodeId)];
    if (!topic || !topic.inScope) return false;
    if (!stageId) return true;
    if (s.stageId) return s.stageId === stageId;
    return topic.occurrences.some((o) => o.stageId === stageId);
  });
}

export const topicOf = (nodeId: string) => nodeId.split('.').slice(0, 2).join('.');

export interface PerfRow { key: string; name: string; attempted: number; correct: number; incorrect: number; accuracy: number | null; avgTimeSeconds: number | null; sessions: number }
function perf(key: string, name: string, list: PracticeSession[]): PerfRow {
  const attempted = list.reduce((a, s) => a + s.attempted, 0);
  const correct = list.reduce((a, s) => a + s.correct, 0);
  const timed = list.filter((s) => s.timeSeconds != null && s.attempted > 0);
  const tq = timed.reduce((a, s) => a + s.attempted, 0);
  return {
    key, name, attempted, correct, incorrect: attempted - correct, sessions: list.length,
    accuracy: attempted ? (correct / attempted) * 100 : null,
    avgTimeSeconds: tq ? timed.reduce((a, s) => a + (s.timeSeconds ?? 0), 0) / tq : null,
  };
}

export function practiceTotals(list: readonly PracticeSession[]) { return perf('all', 'All', [...list]); }

/** Section of a session: the occurrence in the session's stage, else the first in-scope occurrence. */
export function sectionOfSession(report: Report, s: PracticeSession) {
  const t = report.topics[topicOf(s.nodeId)];
  if (!t) return null;
  const occ = (s.stageId && t.occurrences.find((o) => o.stageId === s.stageId)) || t.occurrences.find((o) => report.stages.find((st) => st.stageId === o.stageId)?.inScope) || t.occurrences[0];
  return occ?.sectionKey ?? null;
}

export function practiceBySection(report: Report, list: readonly PracticeSession[]) {
  const names = new Map(report.stages.flatMap((st) => st.sections.map((s) => [s.key, s.name] as const)));
  const groups = new Map<string, PracticeSession[]>();
  for (const s of list) {
    const k = sectionOfSession(report, s);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  return [...groups.entries()].map(([k, l]) => perf(k, names.get(k) ?? k, l)).sort((a, b) => b.attempted - a.attempted);
}

export function practiceByTopic(report: Report, list: readonly PracticeSession[]) {
  const groups = new Map<string, PracticeSession[]>();
  for (const s of list) {
    const k = topicOf(s.nodeId);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  return [...groups.entries()].map(([k, l]) => perf(k, report.topics[k]?.name ?? k, l));
}

/** Questions and accuracy per day or per week (Monday). */
export function practiceTrend(list: readonly PracticeSession[], by: 'day' | 'week' = 'week') {
  const groups = new Map<string, PracticeSession[]>();
  for (const s of list) {
    const k = by === 'week' ? weekStart(s.date) : s.date;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, l]) => ({ ...perf(k, k, l), date: k }));
}

export function historySeries(history: HistoryData, examId: string) {
  return Object.entries(history.exams[examId] ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([date, p]) => ({ date, ...p }));
}

/** Revision history of one exam: confirmed revisions (records) and revision practice sessions. */
export function revisionHistory(records: { topics?: Record<string, { revisions?: { date: string; note?: string }[] }>; subtopics?: Record<string, { revisions?: { date: string; note?: string }[] }> } | null, sessions: readonly PracticeSession[], nameOf: (nodeId: string) => string) {
  const out: { date: string; nodeId: string; name: string; kind: 'confirmed' | 'session'; note: string; accuracy: number | null; attempted: number | null }[] = [];
  for (const group of [records?.topics ?? {}, records?.subtopics ?? {}]) {
    for (const [nodeId, r] of Object.entries(group)) for (const rv of r.revisions ?? []) out.push({ date: rv.date, nodeId, name: nameOf(nodeId), kind: 'confirmed', note: rv.note ?? '', accuracy: null, attempted: null });
  }
  for (const s of sessions) if (s.revision) out.push({ date: s.date, nodeId: s.nodeId, name: nameOf(s.nodeId), kind: 'session', note: s.note ?? '', accuracy: s.attempted ? (s.correct / s.attempted) * 100 : null, attempted: s.attempted });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Completion and mastery per subject (weighted by each topic's effective weight in the exam). */
export function subjectSummary(report: Report) {
  const acc = new Map<string, { w: number; c: number; m: number; n: number; done: number }>();
  for (const t of Object.values(report.topics)) {
    if (!t.inScope || t.isGateOnly) continue;
    const a = acc.get(t.subject) ?? { w: 0, c: 0, m: 0, n: 0, done: 0 };
    a.w += t.effectiveWeight; a.c += t.effectiveWeight * t.completion; a.m += t.effectiveWeight * t.mastery; a.n++;
    if (t.category === 'completed' || t.category === 'mastered') a.done++;
    acc.set(t.subject, a);
  }
  return [...acc.entries()].map(([subject, a]) => ({ subject, weight: a.w, completion: a.w ? a.c / a.w : 0, mastery: a.w ? a.m / a.w : 0, topics: a.n, done: a.done }))
    .sort((x, y) => y.weight - x.weight);
}

export const isDone = (category: string) => category === 'completed' || category === 'mastered';
