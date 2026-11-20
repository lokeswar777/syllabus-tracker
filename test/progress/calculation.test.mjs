import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildExamModel, calculateProgress, compileConfig, progressDb as P } from '../../src/progress/index.js';
import { SIMPLE, MULTI, CHOICE, makeExam, config, NOW, rng, idGen } from './fixtures.mjs';

const cfg = compileConfig(config);
const near = (actual, expected, msg, tol = 0.01) => assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} expected ${expected}, got ${actual}`);

/** Build a db by applying [nodeId, patch] updates, then calculate. */
function calc(fixture, updates = [], { stageId = null, overrides = {}, choices = {}, db: start, extra } = {}) {
  let db = start ?? P.createEmptyDb(NOW);
  for (const [nodeId, patch] of updates) db = P.updateNode(db, { examId: fixture.syllabusExam.id, nodeId, patch, cfg, now: NOW });
  if (extra) db = extra(db);
  const model = buildExamModel({ ...fixture, weightOverrides: overrides, choices });
  return { report: calculateProgress({ model, db, config, now: NOW, stageId }), model, db };
}
/** Independent check: Σ over leaves (stageW·sectionW·topicW·subW) × completion(sub). */
function leafSum(model, report, stageId = null) {
  let s = 0;
  for (const st of model.stages) {
    if (stageId && st.id !== stageId) continue;
    const sw = stageId ? 1 : st.w;
    for (const sec of st.sections) for (const tp of sec.topics) for (const sub of tp.subtopics) s += sw * sec.w * tp.w * sub.w * report.subtopics[sub.id].completion;
  }
  return s;
}

describe('A. Syllabus completion', () => {
  test('1. a topic marked Not Started contributes 0%', () => {
    const { report } = calc(SIMPLE, [['quant.percentage', { status: 'not-started' }]]);
    assert.equal(report.summary.syllabusCompletion, 0);
    assert.equal(report.topics['quant.percentage'].contribution, 0);
    assert.equal(report.topics['quant.percentage'].category, 'pending');
  });

  test('2. a topic marked Mastered contributes 100% of its effective weight (20% × 30% = 6%)', () => {
    const { report } = calc(SIMPLE, [['quant.percentage', { status: 'mastered' }]]);
    near(report.topics['quant.percentage'].effectiveWeight, 6);
    near(report.topics['quant.percentage'].contribution, 6);
    near(report.summary.syllabusCompletion, 6);
    near(report.summary.remainingWeightedSyllabus, 94);
  });

  test('3. partial completion: Concept Completed (50) on 6% = 3.00; + Practicing (65) on 24% = 18.60', () => {
    near(calc(SIMPLE, [['quant.percentage', { status: 'concept-completed' }]]).report.summary.syllabusCompletion, 3);
    const { report } = calc(SIMPLE, [['quant.percentage', { status: 'concept-completed' }], ['quant.average', { status: 'practicing' }]]);
    near(report.summary.syllabusCompletion, 18.6);
    near(report.stages[0].sections[0].completion, 62); // secA: 0.2×50 + 0.8×65
  });

  test('3b. every configured status score maps exactly onto the topic contribution', () => {
    for (const s of config.statuses) {
      const { report } = calc(SIMPLE, [['english.cloze-test', { status: s.id }]]);
      near(report.summary.syllabusCompletion, 70 * s.score / 100, s.id); // cloze = 70% of the exam
    }
  });

  test('3c. subtopic-level progress: one of two equal subtopics Mastered → topic 50% → 3.00 overall', () => {
    const { report } = calc(SIMPLE, [['quant.percentage.a', { status: 'mastered' }]]);
    near(report.topics['quant.percentage'].completion, 50);
    near(report.summary.syllabusCompletion, 3);
    assert.equal(report.subtopics['quant.percentage.b'].completionSource, 'default');
  });

  test('4. parent and child progress are not double-counted', () => {
    // topic Completed (90) is the default for subtopic b; subtopic a is Mastered (100) → 0.5×100 + 0.5×90 = 95
    const r1 = calc(SIMPLE, [['quant.percentage', { status: 'completed' }], ['quant.percentage.a', { status: 'mastered' }]]).report;
    near(r1.topics['quant.percentage'].completion, 95);
    near(r1.summary.syllabusCompletion, 5.7);
    // topic and all subtopics Mastered: still exactly the topic's 6%, never 12%
    const r2 = calc(SIMPLE, [['quant.percentage', { status: 'mastered' }], ['quant.percentage.a', { status: 'mastered' }], ['quant.percentage.b', { status: 'mastered' }]]);
    near(r2.report.summary.syllabusCompletion, 6);
    near(leafSum(r2.model, r2.report), 6);
    // the hierarchical rollup equals the flat leaf sum
    const sectionSum = r2.report.stages[0].sections.reduce((a, s) => a + s.weightInExam * s.completion / 100, 0);
    near(sectionSum, r2.report.summary.syllabusCompletion);
  });

  test('stage scope: puzzles Mastered → exam 56%, prelims 50%, mains 60%', () => {
    const upd = [['reasoning.puzzles', { status: 'mastered' }]];
    near(calc(MULTI, upd).report.summary.syllabusCompletion, 56);
    near(calc(MULTI, upd, { stageId: 'prelims' }).report.summary.syllabusCompletion, 50);
    near(calc(MULTI, upd, { stageId: 'mains' }).report.summary.syllabusCompletion, 60);
    near(calc(MULTI, upd).report.topics['reasoning.puzzles'].effectiveWeight, 56);
    near(calc(MULTI, upd, { stageId: 'mains' }).report.topics['reasoning.puzzles'].effectiveWeight, 60);
    assert.deepEqual(calc(MULTI, upd, { stageId: 'mains' }).report.scope, { type: 'stage', stageId: 'mains' });
  });

  test('gate sections carry no weight but are reported separately', () => {
    const { report } = calc(SIMPLE, [['skill.dest', { status: 'mastered' }]]);
    assert.equal(report.summary.syllabusCompletion, 0);
    assert.deepEqual(report.analytics.gates.map((g) => [g.sectionId, g.completion]), [['secG', 100]]);
  });

  test('manual completion override replaces the status score for that node only', () => {
    const { report } = calc(SIMPLE, [['quant.percentage.a', { status: 'learning', completionOverride: 80 }]]);
    near(report.topics['quant.percentage'].completion, 40);
    near(report.summary.syllabusCompletion, 2.4);
  });

  test('choice groups: only the chosen language counts', () => {
    const upd = [['english.cloze-test', { status: 'mastered' }]];
    near(calc(CHOICE, upd).report.summary.syllabusCompletion, 50); // english is the default (first) alternative
    near(calc(CHOICE, upd, { choices: { language: 'hindi' } }).report.summary.syllabusCompletion, 0);
    near(calc(CHOICE, [['hindi.comprehension', { status: 'mastered' }]], { choices: { language: 'hindi' } }).report.summary.syllabusCompletion, 50);
  });
});

describe('Weight changes', () => {
  test('6a. overriding a section weight re-normalises siblings: secA 30→60 (of 130) → t1 = 9.23%', () => {
    const { report } = calc(SIMPLE, [['quant.percentage', { status: 'mastered' }]], { overrides: { 'section:s1/secA': 60 } });
    near(report.summary.syllabusCompletion, (60 / 130) * 0.2 * 100);
    near(report.topics['quant.percentage'].effectiveWeight, 9.23);
  });
  test('6b. changing weightage data (custom topic weight 20→40 within secA) updates percentages: 0.3 × 0.4 = 12%', () => {
    const fx = structuredClone(SIMPLE);
    const sec = fx.weightageExam.tracks[0].stages[0].sections[0];
    sec.topics[0].weight = { default: 20, custom: 40, effective: 40 };
    sec.topics[1].weight = { default: 80, custom: 60, effective: 60 };
    near(calc(fx, [['quant.percentage', { status: 'mastered' }]]).report.summary.syllabusCompletion, 12);
  });
  test('6c. subtopic weight override changes the topic completion', () => {
    const { report } = calc(SIMPLE, [['quant.percentage.a', { status: 'mastered' }]], { overrides: { 'subtopic:s1/secA/quant.percentage/a': 75, 'subtopic:s1/secA/quant.percentage/b': 25 } });
    near(report.topics['quant.percentage'].completion, 75);
    near(report.summary.syllabusCompletion, 4.5);
  });
});

describe('B. Exam mastery (independent of completion)', () => {
  test('Mastered status without any practice is NOT mastery: concept only = 25, level not-assessed', () => {
    const { report } = calc(SIMPLE, [['quant.percentage', { status: 'mastered' }]]);
    const t = report.topics['quant.percentage'];
    near(t.completion, 100);
    near(t.mastery, 25);
    assert.equal(t.masteryLevel, 'not-assessed');
    assert.equal(report.summary.topicCounts.mastered, 0);
    assert.equal(report.summary.topicCounts.markedMasteredStatus, 1);
  });

  test('mastery formula: 50 Q at 90% (medium), 6 sets today, 3 revisions w/o scores → 25+36+20+12 = 93', () => {
    const { report } = calc(SIMPLE, [['quant.percentage', { status: 'mastered' }]], {
      extra: (db) => {
        const sizes = [[8, 7], [8, 7], [8, 7], [8, 7], [8, 7], [10, 10]]; // 50 attempted, 45 correct
        for (const [attempted, correct] of sizes) db = P.recordPractice(db, { examId: 'simple', nodeId: 'quant.percentage.a', session: { attempted, correct, difficulty: 'medium', timeSeconds: attempted * 60, date: '2026-11-20' }, newId: idGen, now: NOW });
        for (let i = 0; i < 3; i++) db = P.addRevision(db, { examId: 'simple', nodeId: 'quant.percentage', date: '2026-11-19', now: NOW });
        return db;
      },
    });
    const t = report.topics['quant.percentage'];
    assert.deepEqual(t.masteryComponents, { concept: 100, accuracy: 90, consistency: 100, revision: 80, speed: 100 });
    near(t.mastery, 93);
    assert.equal(t.masteryLevel, 'mastered');
    assert.equal(t.attempted, 50); assert.equal(t.correct, 45); assert.equal(t.incorrect, 5);
    near(t.accuracy, 90); assert.equal(t.practiceSets, 6); assert.equal(t.revisionCount, 3); near(t.avgTimeSeconds, 60);
    assert.equal(t.lastPracticed, '2026-11-20');
    assert.deepEqual(report.analytics.masteredTopics, ['quant.percentage']);
    // completion is unchanged by practice: the two metrics are independent
    near(t.completion, 100);
  });

  test('recency decays consistency: last practice 40 days ago → recency 1 − 33/53', () => {
    const { report } = calc(SIMPLE, [], { extra: (db) => P.recordPractice(db, { examId: 'simple', nodeId: 'quant.average', session: { attempted: 10, correct: 10, date: '2026-10-11' }, newId: idGen, now: NOW }) });
    const c = report.topics['quant.average'].masteryComponents.consistency;
    near(c, 100 * (0.6 * (1 / 6) + 0.4 * (1 - 33 / 53)));
  });

  test('hard questions earn more accuracy credit than easy ones (capped at 100)', () => {
    const mk = (difficulty) => calc(SIMPLE, [], { extra: (db) => P.recordPractice(db, { examId: 'simple', nodeId: 'quant.average', session: { attempted: 50, correct: 40, difficulty }, newId: idGen, now: NOW }) }).report.topics['quant.average'].masteryComponents.accuracy;
    near(mk('easy'), 68); near(mk('medium'), 80); near(mk('hard'), 92);
  });

  test('setPracticeTotals sets displayed totals directly while sessions still add on', () => {
    let db = P.createEmptyDb(NOW);
    db = P.recordPractice(db, { examId: 'simple', nodeId: 'quant.average', session: { attempted: 10, correct: 8 }, newId: idGen, now: NOW });
    db = P.setPracticeTotals(db, { examId: 'simple', nodeId: 'quant.average', totals: { attempted: 100, correct: 70 }, now: NOW });
    const { report } = calc(SIMPLE, [], { db });
    assert.equal(report.topics['quant.average'].attempted, 100);
    assert.equal(report.topics['quant.average'].correct, 70);
    assert.throws(() => P.setPracticeTotals(db, { examId: 'simple', nodeId: 'quant.average', totals: { attempted: 5 }, now: NOW }), RangeError);
  });

  test('section and exam mastery roll up with the same weights as completion', () => {
    const { report } = calc(SIMPLE, [['english.cloze-test', { masteryOverride: 80 }]]);
    near(report.stages[0].sections[1].mastery, 80);
    near(report.summary.examMastery, 56); // cloze is 70% of the exam
  });
});

describe('Topic-level fields and validation of updates', () => {
  test('dates are maintained automatically and every field updates independently', () => {
    let db = P.createEmptyDb(NOW);
    db = P.updateNode(db, { examId: 'simple', nodeId: 'quant.average', patch: { status: 'learning' }, cfg, now: NOW });
    let rec = db.progress.exams.simple.topics['quant.average'];
    assert.equal(rec.startDate, '2026-11-20'); assert.equal(rec.completionDate, null);
    db = P.updateNode(db, { examId: 'simple', nodeId: 'quant.average', patch: { notes: 'revise shortcuts' }, cfg, now: NOW });
    rec = db.progress.exams.simple.topics['quant.average'];
    assert.equal(rec.status, 'learning'); assert.equal(rec.notes, 'revise shortcuts');
    db = P.updateNode(db, { examId: 'simple', nodeId: 'quant.average', patch: { status: 'completed' }, cfg, now: new Date('2026-12-01T09:00:00Z') });
    rec = db.progress.exams.simple.topics['quant.average'];
    assert.equal(rec.completionDate, '2026-12-01'); assert.equal(rec.startDate, '2026-11-20');
    db = P.updateNode(db, { examId: 'simple', nodeId: 'quant.average', patch: { status: 'revision-pending' }, cfg, now: NOW });
    assert.equal(db.progress.exams.simple.topics['quant.average'].completionDate, null);
    db = P.updateNode(db, { examId: 'simple', nodeId: 'quant.average', patch: { startDate: '2026-10-01', completionDate: '2026-11-15', difficulty: 'hard' }, cfg, now: NOW });
    rec = db.progress.exams.simple.topics['quant.average'];
    assert.deepEqual([rec.startDate, rec.completionDate, rec.difficulty, rec.status], ['2026-10-01', '2026-11-15', 'hard', 'revision-pending']);
  });

  test('invalid input is rejected with a clear error (never silently stored)', () => {
    const db = P.createEmptyDb(NOW);
    assert.throws(() => P.updateNode(db, { examId: 'x', nodeId: 'quant.average', patch: { status: 'done' }, cfg }), /unknown status/);
    assert.throws(() => P.updateNode(db, { examId: 'x', nodeId: 'quant.average', patch: { completionOverride: 120 }, cfg }), RangeError);
    assert.throws(() => P.updateNode(db, { examId: 'x', nodeId: 'quant.average', patch: { colour: 'red' }, cfg }), /not editable/);
    assert.throws(() => P.recordPractice(db, { examId: 'x', nodeId: 'quant.average', session: { attempted: 5, correct: 6 }, newId: idGen }), RangeError);
    assert.throws(() => P.updateNode(db, { examId: 'x', nodeId: 'badid', patch: { status: 'learning' }, cfg }), TypeError);
  });

  test('analytics: categories, remaining weight and high-weightage incomplete topics', () => {
    const { report } = calc(SIMPLE, [['quant.percentage', { status: 'completed' }], ['quant.average', { status: 'learning' }]]);
    assert.deepEqual(report.analytics.completedTopics, ['quant.percentage']);
    assert.deepEqual(report.analytics.inProgressTopics, ['quant.average']);
    assert.deepEqual(report.analytics.pendingTopics.sort(), ['english.cloze-test', 'skill.dest']);
    // incomplete VH/H topics sorted by remaining weighted gap: cloze 70 > average 24×0.8 = 19.2
    assert.deepEqual(report.analytics.highWeightIncomplete.map((t) => [t.topicId, t.remainingWeight]), [['english.cloze-test', 70], ['quant.average', 19.2]]);
    near(report.summary.remainingWeightedSyllabus, 100 - (6 * 0.9 + 24 * 0.2));
  });
});

describe('Robustness', () => {
  test('8. missing / unknown topics never cause calculation errors', () => {
    // stored records and practice for IDs that are not in the exam
    let db = P.createEmptyDb(NOW);
    db = P.updateNode(db, { examId: 'simple', nodeId: 'quant.not-a-topic', patch: { status: 'mastered' }, cfg, now: NOW });
    db = P.updateNode(db, { examId: 'simple', nodeId: 'quant.percentage.ghost', patch: { status: 'mastered' }, cfg, now: NOW });
    db = P.recordPractice(db, { examId: 'simple', nodeId: 'gk.unknown', session: { attempted: 5, correct: 5 }, newId: () => 'orphan-1', now: NOW });
    db.progress.exams.simple.topics['quant.average'] = { status: 'legacy-status' }; // corrupted/unknown status value
    const { report } = calc(SIMPLE, [], { db });
    assert.equal(report.summary.syllabusCompletion, 0);
    assert.deepEqual(report.diagnostics.orphanRecords.sort(), ['quant.not-a-topic', 'quant.percentage.ghost']);
    assert.deepEqual(report.diagnostics.ignoredSessions, ['orphan-1']);
    assert.ok(report.diagnostics.warnings.some((w) => w.includes('legacy-status')));

    // weightage missing a syllabus topic → sibling-mean fallback (t2 gets 20 → t1 = 20/40 of secA)
    const fx = structuredClone(SIMPLE);
    fx.weightageExam.tracks[0].stages[0].sections[0].topics.splice(1, 1);
    const r2 = calc(fx, [['quant.percentage', { status: 'mastered' }]]).report;
    near(r2.summary.syllabusCompletion, 15);
    assert.ok(r2.diagnostics.warnings.some((w) => w.includes('quant.average')));

    // no weightage at all → equal weights, still bounded
    const r3 = calc({ syllabusExam: SIMPLE.syllabusExam, weightageExam: null }, [['quant.percentage', { status: 'mastered' }]]).report;
    assert.ok(r3.summary.syllabusCompletion > 0 && r3.summary.syllabusCompletion <= 100);

    // empty / partial db objects
    const model = buildExamModel(SIMPLE);
    for (const dbx of [undefined, {}, { progress: {} }, { practice: { exams: { simple: {} } } }])
      assert.equal(calculateProgress({ model, db: dbx, config, now: NOW }).summary.syllabusCompletion, 0);

    // stale weightage topic that is no longer in the syllabus is ignored
    const fx4 = structuredClone(SIMPLE);
    fx4.weightageExam.tracks[0].stages[0].sections[0].topics.push({ topicId: 'quant.removed', weight: { effective: 50 }, subtopics: [] });
    assert.ok(calc(fx4).model.warnings.some((w) => w.includes('quant.removed')));
  });

  test('9. all calculations stay within 0–100 (fuzz: random statuses, overrides, weights, practice)', () => {
    const rand = rng(20261120);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const statuses = config.statuses.map((s) => s.id);
    for (const fx of [SIMPLE, MULTI, CHOICE]) {
      const model0 = buildExamModel(fx);
      const nodes = [...Object.keys(model0.topics), ...Object.keys(model0.subtopics)];
      for (let iter = 0; iter < 150; iter++) {
        let db = P.createEmptyDb(NOW);
        for (const n of nodes) {
          if (rand() < 0.6) db = P.updateNode(db, { examId: fx.syllabusExam.id, nodeId: n, patch: { status: pick(statuses) }, cfg, now: NOW });
          if (rand() < 0.15) db = P.updateNode(db, { examId: fx.syllabusExam.id, nodeId: n, patch: { completionOverride: Math.round(rand() * 100) }, cfg, now: NOW });
          if (rand() < 0.1) db = P.updateNode(db, { examId: fx.syllabusExam.id, nodeId: n, patch: { masteryOverride: Math.round(rand() * 100) }, cfg, now: NOW });
          if (rand() < 0.4) {
            const attempted = Math.floor(rand() * 200);
            db = P.recordPractice(db, { examId: fx.syllabusExam.id, nodeId: n, session: { attempted, correct: Math.floor(rand() * (attempted + 1)), difficulty: pick(['easy', 'medium', 'hard']), timeSeconds: rand() * 500, revision: rand() < 0.3, date: `2026-${String(1 + Math.floor(rand() * 11)).padStart(2, '0')}-10` }, newId: idGen, now: NOW });
          }
        }
        const overrides = {};
        for (const st of fx.syllabusExam.stages) for (const sec of st.sections) if (rand() < 0.3) overrides[`section:${st.id}/${sec.id}`] = pick([0, 1e-9, rand() * 500, 1e6]);
        const model = buildExamModel({ ...fx, weightOverrides: overrides, choices: { language: pick(['english', 'hindi']) } });
        for (const stageId of [null, ...fx.syllabusExam.stages.map((s) => s.id)]) {
          const r = calculateProgress({ model, db, config, now: NOW, stageId });
          assertBounded(r);
          near(r.summary.syllabusCompletion, leafSum(model, r, stageId), `leaf sum (${fx.syllabusExam.id}, ${stageId})`, 0.02);
        }
      }
    }
  });
});

export function assertBounded(r) {
  const pctKeys = new Set(['syllabusCompletion', 'examMastery', 'remainingWeightedSyllabus', 'completion', 'mastery', 'concept', 'accuracy', 'revisionAccuracy', 'weightInExam', 'weightInStage', 'weightInSection', 'weightInScope', 'effectiveWeight', 'contribution', 'remaining', 'remainingWeight', 'score']);
  const walk = (o, path) => {
    if (Array.isArray(o)) return o.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'number') {
          assert.ok(Number.isFinite(v), `${path}.${k} is not finite`);
          if (pctKeys.has(k) || path.endsWith('masteryComponents')) assert.ok(v >= 0 && v <= 100.000001, `${path}.${k} = ${v} out of 0–100`);
        } else walk(v, `${path}.${k}`);
      }
    }
  };
  walk(r, 'report');
}
