import { useMemo } from 'react';
import { useApp } from './hooks';
import { examAnalysis } from './selectors';

/**
 * Everything a page needs about the ACTIVE exam in the CURRENT scope (stage), straight from the engines:
 *   report   engine.getReport()            (Phase 3/4: completion, mastery, weights; scope = selected stage)
 *   sessions engine.getExamSessions()      (this exam's practice only; exams never mixed)
 *   analysis Phase 5 priority/revision/weak-area functions applied to this exam only
 */
export function useExam() {
  const { store, version } = useApp();
  const examId = store.activeExamId;
  const engineVersion = store.status === 'ready' ? store.engine.getVersion() : -1;
  const settings = store.status === 'ready' ? store.planner.settings : null;
  const settingsKey = JSON.stringify(settings);
  return useMemo(() => {
    if (!examId || !settings) return null;
    const report = store.engine.getReport();
    const sessions = store.engine.getExamSessions(examId);
    const cfg = store.planner.config();
    const today = store.today();
    const target = settings.targets.find((t) => t.examId === examId) ?? null;
    const analysis = examAnalysis({ report, sessions, cfg, today, target, version: `${engineVersion}|${settingsKey}` });
    return { examId, report, sessions, cfg, today, target, analysis, statuses: store.engine.config.statuses, model: store.engine.getModel() };
    // `version` keeps the memo fresh after any store change (e.g. day roll-over)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, examId, engineVersion, settingsKey, version]);
}
export type ExamCtx = NonNullable<ReturnType<typeof useExam>>;

export const WEAK_LABEL: Record<string, string> = {
  'not-studied': 'Not studied',
  'studied-but-weak': 'Studied but weak',
  'below-target': 'Below accuracy target',
  'good-concept-poor-speed': 'Good concept, poor speed',
  'good-accuracy-insufficient-practice': 'Good accuracy, too little practice',
  'studied-not-practised': 'Studied, not practised',
  ok: 'On track',
};
export const FLAG_LABEL: Record<string, string> = {
  slow: 'slow', 'repeated-incorrect': 'repeated mistakes', 'needs-repeated-revision': 'needs repeated revision', 'declining-accuracy': 'declining accuracy',
};
