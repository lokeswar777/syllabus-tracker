// Pure priority-scoring, revision and config tests (no data files needed beyond the planner config).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../../src/progress/node.js';
import { resolvePlannerConfig, scoreExamTopic, computeRevision, examShares, classify, suggestAction, buildDailyPlan } from '../../src/planner/index.js';
import { rng } from '../progress/fixtures.mjs';

const defaults = JSON.parse(await readFile(join(PROJECT_ROOT, 'data', 'planner', 'config.json'), 'utf8'));
const cfg = resolvePlannerConfig(defaults);
const exam = { examId: 'x', name: 'X', maxWeight: 6, daysLeft: null };
const none = { status: 'not-studied', daysOverdue: 0, intervalDays: null };
const noRecent = { recentAccuracy: null, recentAttempted: 0 };
const T = (o = {}) => ({ effectiveWeight: 6, completion: 0, mastery: 0, trend: 'consistent', requirement: { difficulty: 'medium', accuracyTarget: 80 }, ...o });
const score = (topic, { revision = none, recent = noRecent, ex = exam, c = cfg } = {}) => scoreExamTopic({ topic, exam: ex, revision, recent, cfg: c }).score;

describe('Priority scoring', () => {
  test('1. high-weightage incomplete topics outrank low-weightage ones; completion lowers priority', () => {
    assert.ok(score(T({ effectiveWeight: 6 })) > score(T({ effectiveWeight: 0.7 })));
    assert.ok(score(T({ completion: 0 })) > score(T({ completion: 50, mastery: 0 })));
    assert.ok(score(T({ completion: 50 })) > score(T({ completion: 100, mastery: 100 })));
  });

  test('2. low mastery increases priority (same completion)', () => {
    assert.ok(score(T({ completion: 90, mastery: 20 })) > score(T({ completion: 90, mastery: 80 })));
  });

  test('3. overdue revision raises priority, more overdue raises it further', () => {
    const studied = T({ completion: 90, mastery: 60 });
    const base = score(studied, { revision: { status: 'scheduled', daysOverdue: 0, intervalDays: 7 } });
    const late = score(studied, { revision: { status: 'overdue', daysOverdue: 2, intervalDays: 7 } });
    const later = score(studied, { revision: { status: 'overdue', daysOverdue: 7, intervalDays: 7 } });
    assert.ok(base < late && late < later);
  });

  test('4. poor recent accuracy raises priority only with enough recent questions', () => {
    const t = T({ completion: 70, mastery: 50 });
    assert.ok(score(t, { recent: { recentAccuracy: 40, recentAttempted: 20 } }) > score(t, { recent: { recentAccuracy: 90, recentAttempted: 20 } }));
    assert.equal(score(t, { recent: { recentAccuracy: 40, recentAttempted: 5 } }), score(t), 'below minQuestions → ignored');
  });

  test('5. worked example: explainable contributions that sum to the score', () => {
    // I = √(6/6) = 1, F = 1 → I' = 1; G = 1, M = 1, U0 = 1, D(medium) = 0.6
    const s = scoreExamTopic({ topic: T(), exam, revision: none, recent: noRecent, cfg });
    const wSum = 0.95;
    assert.ok(Math.abs(s.score - (100 * (0.3 + 0.2 + 0.1 + 0.05 * 0.6)) / wSum) < 1e-9);
    assert.ok(Math.abs(Object.values(s.contributions).reduce((a, b) => a + b, 0) - s.score) < 1e-9);
    assert.equal(classify(s.score, cfg), 'Critical'); // 66.3
  });

  test('9. scores stay within 0–100 for any input and any valid weights (fuzz)', () => {
    const r = rng(5);
    for (let i = 0; i < 3000; i++) {
      const c = resolvePlannerConfig(defaults, { priority: { weights: { learningGap: r() * 5, masteryGap: r() * 5, untouched: r() * 5, revisionDue: r() * 5, accuracyGap: r() * 5, difficulty: r() * 5 + 0.01 } } });
      const status = ['overdue', 'due-today', 'due-soon', 'scheduled', 'not-studied'][Math.floor(r() * 5)];
      const sc = score(T({ effectiveWeight: r() * 12, completion: r() * 100, mastery: r() * 100, trend: ['consistent', 'fluctuating', 'emerging', 'declining', null][Math.floor(r() * 5)], requirement: { difficulty: ['easy', 'medium', 'hard', null][Math.floor(r() * 4)], accuracyTarget: 50 + r() * 50 } }), {
        revision: { status, daysOverdue: Math.floor(r() * 400), intervalDays: 1 + Math.floor(r() * 30) },
        recent: { recentAccuracy: r() * 100, recentAttempted: Math.floor(r() * 50) },
        ex: { ...exam, maxWeight: 12, daysLeft: r() < 0.5 ? Math.floor(r() * 60) : null }, c,
      });
      assert.ok(Number.isFinite(sc) && sc >= 0 && sc <= 100, `score ${sc}`);
    }
  });

  test('final stretch: revision weighs more and low-importance untouched topics weigh less', () => {
    const near = { ...exam, daysLeft: 10 };
    const rev = { status: 'overdue', daysOverdue: 3, intervalDays: 7 };
    const studied = T({ completion: 90, mastery: 60 });
    assert.ok(score(studied, { revision: rev, ex: near }) > score(studied, { revision: rev }));
    const minor = T({ effectiveWeight: 0.3 });
    assert.ok(score(minor, { ex: near }) < score(minor));
  });
});

describe('Exam shares (multi-exam, time remaining)', () => {
  test('importance sets the share; a nearer exam date raises it; a past exam is excluded', () => {
    const s = examShares([{ examId: 'a', importance: 60 }, { examId: 'b', importance: 40 }], '2026-11-20', cfg);
    assert.deepEqual(s.map((x) => Math.round(x.share * 100)), [60, 40]);
    const d = examShares([{ examId: 'a', importance: 60, examDate: '2027-11-20' }, { examId: 'b', importance: 40, examDate: '2026-12-20' }], '2026-11-20', cfg);
    assert.ok(d[1].share > 0.4 && d[1].urgency > 0.8);
    const p = examShares([{ examId: 'a', importance: 60 }, { examId: 'b', importance: 40, examDate: '2026-11-01' }], '2026-11-20', cfg);
    assert.deepEqual([p[0].share, p[1].share, p[1].past], [1, 0, true]);
  });
});

describe('Revision tracker (pure)', () => {
  const topic = (o) => ({ ownCompletion: 90, completion: 90, mastery: 60, attempted: 0, revisionCount: 0, lastRevised: null, lastPracticed: null, completionDate: '2026-11-10', startDate: '2026-11-05', ...o });
  test('1st revision due 1 day after study; overdue detected; next intervals 3, 7, 15, 30, then 30 again', () => {
    const r0 = computeRevision({ topic: topic(), cfg, today: '2026-11-20' });
    assert.deepEqual([r0.nextDue, r0.status, r0.daysOverdue, r0.revisionNumber], ['2026-11-11', 'overdue', 9, 1]);
    const due = (count, lastRevised) => computeRevision({ topic: topic({ revisionCount: count, lastRevised }), cfg, today: '2026-11-20' }).nextDue;
    assert.deepEqual([due(1, '2026-11-12'), due(2, '2026-11-12'), due(3, '2026-11-12'), due(4, '2026-11-12'), due(9, '2026-11-12')], ['2026-11-15', '2026-11-19', '2026-11-27', '2026-12-12', '2026-12-12']);
    const r = computeRevision({ topic: topic({ revisionCount: 1, lastRevised: '2026-11-19' }), cfg, today: '2026-11-20' });
    assert.deepEqual([r.status, r.daysUntilDue], ['due-soon', 2]);
  });
  test('intervals are editable; low previous accuracy shortens the interval', () => {
    const c2 = resolvePlannerConfig(defaults, { revision: { intervalsDays: [2, 4] } });
    assert.equal(computeRevision({ topic: topic(), cfg: c2, today: '2026-11-20' }).nextDue, '2026-11-12');
    const r = computeRevision({ topic: topic({ revisionCount: 2, lastRevised: '2026-11-15' }), sessions: [{ attempted: 10, correct: 4, date: '2026-11-15' }], cfg, today: '2026-11-16' });
    assert.deepEqual([r.intervalDays, r.intervalShortenedForLowAccuracy], [4, true]); // 7 × 0.5 → 4
  });
  test('topics never studied are not scheduled', () => {
    assert.equal(computeRevision({ topic: topic({ ownCompletion: 20, completion: 50, startDate: '2026-11-05', completionDate: null }), cfg, today: '2026-11-20' }).status, 'not-studied');
  });
});

describe('Config validation and actions', () => {
  test('invalid scoring weights, thresholds or intervals are rejected', () => {
    assert.throws(() => resolvePlannerConfig(defaults, { priority: { weights: { learningGap: -1 } } }), /learningGap/);
    assert.throws(() => resolvePlannerConfig(defaults, { priority: { classification: { thresholds: { Critical: 20, High: 30 } } } }), /decrease/);
    assert.throws(() => resolvePlannerConfig(defaults, { revision: { intervalsDays: [1, 0] } }), /intervalsDays\[1\]/);
    assert.throws(() => resolvePlannerConfig(defaults, { revision: { intervalsDays: [] } }), /non-empty/);
  });
  test('suggested next action follows the topic state', () => {
    const rev = { status: 'scheduled' };
    const req = { questionTarget: 60, accuracyTarget: 80, speedTargetSec: 40, depth: 'speed' };
    assert.equal(suggestAction({ topic: { completion: 0 }, revision: rev, cfg }).action, 'learn-concept');
    assert.equal(suggestAction({ topic: { completion: 70, requirement: req }, revision: rev, subtopics: [{ id: 'a', name: 'A', completion: 20 }], cfg }).action, 'complete-subtopics');
    assert.equal(suggestAction({ topic: { completion: 50, attempted: 10, requirement: req }, revision: rev, subtopics: [{ completion: 50 }], cfg }).action, 'practice-questions');
    assert.equal(suggestAction({ topic: { completion: 95, attempted: 70, mastery: 75, requirement: req, targetsMet: { all: true, gaps: [] } }, revision: rev, cfg }).action, 'sectional-test');
    assert.equal(suggestAction({ topic: { completion: 95 }, revision: { status: 'overdue', daysOverdue: 3, revisionNumber: 2 }, cfg }).action, 'revise-notes');
  });
  test('daily plan respects the time budget, one task per topic, and keeps nothing auto-completed', () => {
    const mk = (id, score, subject = 'quant') => ({ topicId: id, name: id, subject, score, classification: 'High', exams: ['x'], examCount: 1, primaryExamId: 'x', done: false,
      perExam: { x: { examId: 'x', reasons: ['r'], section: { name: 'S' }, requirement: { difficulty: 'medium' }, revision: { status: 'scheduled' }, action: { action: 'learn-concept', detail: 'd' } } } });
    const topics = [mk('quant.a', 50), mk('quant.b', 40), mk('quant.c', 30), mk('quant.d', 20), mk('english.e', 10, 'english')];
    const plan = (h) => buildDailyPlan({ date: '2026-11-20', hours: h, topics, cfg, now: new Date() });
    assert.deepEqual(plan(1).tasks.map((t) => t.topicId), ['quant.a']);
    assert.deepEqual(plan(4).tasks.map((t) => t.topicId), ['quant.a', 'quant.b', 'quant.c', 'english.e'], 'max 3 tasks per subject');
    assert.ok(plan(4).plannedMinutes <= 240 && plan(4).tasks.every((t) => t.status === 'pending'));
    assert.equal(plan(0).tasks.length, 0);
  });
});
