// Selectors only regroup engine output: their totals must equal the engine's own figures.
import { describe, expect, test } from 'vitest';
import { makeStore } from './helpers';
import { examAnalysis, practiceBySection, practiceByTopic, practiceTotals, practiceTrend, scopedSessions, statusDistribution, subjectSummary, revisionHistory, scopeTopics } from '../src/lib/selectors';

async function seeded() {
  const s = await makeStore();
  await s.selectExam('sbi-po');
  const e = s.engine;
  e.setStatus('quant.percentage', 'practicing');
  e.recordPractice('quant.percentage', { attempted: 20, correct: 15, timeSeconds: 900, stageId: 'prelims', date: '2026-11-10' });
  e.recordPractice('quant.percentage', { attempted: 30, correct: 18, timeSeconds: 1500, stageId: 'mains', date: '2026-11-17' });
  e.setStatus('reasoning.puzzles', 'learning');
  e.recordPractice('reasoning.puzzles', { attempted: 10, correct: 4, stageId: 'prelims', date: '2026-11-18', revision: true });
  e.addRevision('quant.percentage', { date: '2026-11-19', note: 'formulas' });
  return s;
}

describe('selectors', () => {
  test('practice totals, per-section and per-topic sums equal the engine summary', async () => {
    const s = await seeded();
    const r = s.report()!;
    const all = scopedSessions(r, s.engine.getExamSessions('sbi-po'));
    const t = practiceTotals(all);
    expect([t.attempted, t.correct, t.incorrect]).toEqual([r.summary.practice.attempted, r.summary.practice.correct, r.summary.practice.incorrect]);
    expect(t.accuracy).toBeCloseTo(r.summary.practice.accuracy!, 1);
    const sec = practiceBySection(r, all);
    expect(sec.reduce((a, x) => a + x.attempted, 0)).toBe(t.attempted);
    const top = practiceByTopic(r, all);
    expect(top.find((x) => x.key === 'quant.percentage')!.attempted).toBe(r.topics['quant.percentage'].attempted);
    expect(practiceTrend(all, 'day').reduce((a, x) => a + x.attempted, 0)).toBe(t.attempted);
  });

  test('stage scope filters practice to that stage only', async () => {
    const s = await seeded();
    await s.setStage('prelims');
    const r = s.report()!;
    const pre = scopedSessions(r, s.engine.getExamSessions('sbi-po'));
    expect(pre.map((x) => x.stageId)).toEqual(['prelims', 'prelims']);
    await s.setStage('mains');
    expect(scopedSessions(s.report()!, s.engine.getExamSessions('sbi-po')).map((x) => x.attempted)).toEqual([30]);
  });

  test('status distribution covers every in-scope topic exactly once', async () => {
    const s = await seeded();
    const r = s.report()!;
    const d = statusDistribution(r, s.engine.config.statuses);
    expect(d.reduce((a, x) => a + x.count, 0)).toBe(r.summary.topicCounts.total);
    expect(d.find((x) => x.id === 'practicing')!.count).toBe(1);
    expect(scopeTopics(r).length).toBe(r.summary.topicCounts.total);
  });

  test('exam analysis is the Phase 5 engine applied to this exam (scores in range, revision from records)', async () => {
    const s = await seeded();
    const r = s.report()!;
    const a = examAnalysis({ report: r, sessions: s.engine.getExamSessions('sbi-po'), cfg: s.planner.config(), today: s.today(), version: 'x' });
    expect(Object.keys(a.rows).length).toBe(r.summary.topicCounts.total);
    for (const row of Object.values(a.rows)) expect(row.score).toBeGreaterThanOrEqual(0), expect(row.score).toBeLessThanOrEqual(100);
    expect(a.revisions['quant.percentage'].revisionCount).toBe(1);
    expect(a.weak.all['reasoning.puzzles'].category).toBe('studied-but-weak');
  });

  test('revision history lists confirmed revisions and revision sessions', async () => {
    const s = await seeded();
    const h = revisionHistory(s.engine.getExamRecords('sbi-po'), s.engine.getExamSessions('sbi-po'), (id) => id);
    expect(h.map((x) => [x.date, x.nodeId, x.kind])).toEqual([['2026-11-19', 'quant.percentage', 'confirmed'], ['2026-11-18', 'reasoning.puzzles', 'session']]);
    expect(h[1].accuracy).toBe(40);
  });

  test('subject summary is weighted by effective weight', async () => {
    const s = await seeded();
    const r = s.report()!;
    const q = subjectSummary(r).find((x) => x.subject === 'quant')!;
    const quant = Object.values(r.topics).filter((t) => t.inScope && !t.isGateOnly && t.subject === 'quant');
    const w = quant.reduce((a, t) => a + t.effectiveWeight, 0);
    expect(q.completion).toBeCloseTo(quant.reduce((a, t) => a + t.effectiveWeight * t.completion, 0) / w, 6);
  });
});
