// StudyPlanner on the real databases: multi-exam priority, revision, weak areas, daily plan, user controls.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProgressEngine, MemoryStorage } from '../../src/progress/index.js';
import { createNodeLoader, PROJECT_ROOT } from '../../src/progress/node.js';
import { StudyPlanner, PLANNER_KEY } from '../../src/planner/index.js';
import { config, DIST_READY } from '../progress/fixtures.mjs';

const plannerDefaults = JSON.parse(await readFile(join(PROJECT_ROOT, 'data', 'planner', 'config.json'), 'utf8'));
const loader = createNodeLoader();

/** Engine + planner sharing a mutable clock and one storage. */
async function setup({ storage = new MemoryStorage(), date = '2026-11-20', targets = [{ examId: 'ssc-cgl', importance: 50 }, { examId: 'sbi-po', importance: 50 }] } = {}) {
  const clock = { now: new Date(`${date}T09:00:00Z`) };
  const tick = () => clock.now;
  let n = 0;
  const engine = await new ProgressEngine({ loader, storage, config, clock: tick, idGenerator: () => `s${++n}` }).init();
  const planner = await new StudyPlanner({ engine, storage, config: plannerDefaults, clock: tick }).init();
  if (targets) await planner.setTargets(targets);
  return { engine, planner, storage, clock, setDate: (d) => { clock.now = new Date(`${d}T09:00:00Z`); } };
}
const rankOf = (list, id) => list.findIndex((t) => t.topicId === id);
const snapshotProgress = (engine) => { const s = engine.snapshot(); return JSON.stringify([s.progress.exams, s.practice.exams, s.sharedLearning.topics, s.sharedLearning.subtopics]); };

describe('Phase 5 planner (real data)', { skip: !DIST_READY && 'run `npm run build` first' }, () => {
  test('1. high-weightage incomplete topics receive higher priority (and drop once completed)', async () => {
    const { engine, planner } = await setup({ targets: [{ examId: 'ssc-cgl', importance: 100 }] });
    let p = (await planner.getPriorities()).topics;
    const rc = p.find((t) => t.topicId === 'english.reading-comprehension'), pct = p.find((t) => t.topicId === 'quant.percentage');
    assert.ok(rc.perExam['ssc-cgl'].effectiveWeight > pct.perExam['ssc-cgl'].effectiveWeight && rc.score > pct.score);
    await engine.switchExam('ssc-cgl');
    engine.setStatus('english.reading-comprehension', 'completed');
    p = (await planner.getPriorities()).topics;
    assert.ok(p.find((t) => t.topicId === 'english.reading-comprehension').score < rc.score);
  });

  test('2. low mastery increases preparation priority', async () => {
    const run = async (correct) => {
      const { engine, planner } = await setup({ targets: [{ examId: 'ssc-cgl', importance: 100 }] });
      await engine.switchExam('ssc-cgl');
      engine.setStatus('quant.percentage', 'completed');
      engine.recordPractice('quant.percentage', { attempted: 40, correct, timeSeconds: 1400, stageId: 'tier1' });
      return (await planner.getPriorities()).topics.find((t) => t.topicId === 'quant.percentage');
    };
    const weak = await run(12), strong = await run(38);
    assert.ok(weak.perExam['ssc-cgl'].mastery < strong.perExam['ssc-cgl'].mastery);
    assert.ok(weak.score > strong.score);
  });

  test('3. overdue revisions are identified; only confirmed revisions count', async () => {
    const { engine, planner, setDate } = await setup({ date: '2026-11-10', targets: [{ examId: 'ssc-cgl', importance: 100 }] });
    await engine.switchExam('ssc-cgl');
    engine.setStatus('quant.percentage', 'completed');                       // studied on 11-10 → 1st revision due 11-11
    setDate('2026-11-20');
    let tr = await planner.getRevisionTracker();
    let item = tr.items.find((i) => i.topicId === 'quant.percentage');
    assert.deepEqual([item.status, item.nextDue, item.daysOverdue, item.revisionCount], ['overdue', '2026-11-11', 9, 0]);
    // a status change is NOT a revision
    engine.setStatus('quant.percentage', 'revision-pending');
    item = (await planner.getRevisionTracker()).items.find((i) => i.topicId === 'quant.percentage');
    assert.deepEqual([item.revisionCount, item.status], [0, 'overdue']);
    // a confirmed revision (manual) counts: 2nd revision due 3 days later
    engine.addRevision('quant.percentage', { date: '2026-11-20' });
    item = (await planner.getRevisionTracker()).items.find((i) => i.topicId === 'quant.percentage');
    assert.deepEqual([item.revisionCount, item.nextDue, item.status], [1, '2026-11-23', 'scheduled']);
    // a practice session marked as revision also counts
    engine.recordPractice('quant.percentage', { attempted: 10, correct: 9, revision: true, stageId: 'tier1', date: '2026-11-20' });
    item = (await planner.getRevisionTracker()).items.find((i) => i.topicId === 'quant.percentage');
    assert.equal(item.revisionCount, 2);
    // editable intervals
    await planner.setRevisionIntervals([1, 2, 5]);
    item = (await planner.getRevisionTracker()).items.find((i) => i.topicId === 'quant.percentage');
    assert.equal(item.nextDue, '2026-11-25');
    assert.deepEqual(tr.intervalsDays, [1, 3, 7, 15, 30]);
  });

  test('4. common topics: counted by real weight in each exam, never inflated by exam count', async () => {
    const { planner } = await setup();
    const p = (await planner.getPriorities()).topics;
    for (const t of p) {
      const per = Object.values(t.perExam);
      const sum = per.reduce((a, r) => a + r.share * r.score, 0);
      assert.ok(Math.abs(t.score - sum) < 0.02, `${t.topicId} combined = Σ share × score`);
      assert.ok(t.score <= Math.max(...per.map((r) => r.score)) + 0.01, `${t.topicId} never above its best exam score`);
    }
    // a low-weight topic common to both exams stays below a high-weight single-exam topic
    const staticGk = p.find((t) => t.topicId === 'ga.static-gk'), puzzles = p.find((t) => t.topicId === 'reasoning.puzzles');
    assert.equal(staticGk.examCount, 2); assert.equal(puzzles.examCount, 1);
    assert.ok(puzzles.score > staticGk.score);
    // a high-weight common topic benefits from relevance to both
    assert.equal(p[0].examCount, 2);
  });

  test('5. exam priorities influence recommendations', async () => {
    const rec = async (cgl, sbi) => (await (await setup({ targets: [{ examId: 'ssc-cgl', importance: cgl }, { examId: 'sbi-po', importance: sbi }] })).planner.getRecommendations({ limit: 140 })).recommendations;
    const cglFirst = await rec(90, 10), sbiFirst = await rec(10, 90);
    assert.ok(rankOf(sbiFirst, 'reasoning.puzzles') < rankOf(cglFirst, 'reasoning.puzzles'), 'SBI-only topic rises with SBI priority');
    assert.ok(rankOf(cglFirst, 'quant.geometry-triangles') < rankOf(sbiFirst, 'quant.geometry-triangles') || rankOf(sbiFirst, 'quant.geometry-triangles') === -1, 'CGL-only topic rises with CGL priority');
    assert.equal(sbiFirst.find((r) => r.topicId === 'reasoning.puzzles').relevantExam.examId, 'sbi-po');
  });

  test('6. changing available study hours adjusts the daily plan', async () => {
    const { planner } = await setup();
    const small = await planner.generateDailyPlan('2026-11-21', { hours: 1.5 });
    const big = await planner.generateDailyPlan('2026-11-22', { hours: 6 });
    assert.ok(big.tasks.length > small.tasks.length && big.plannedMinutes > small.plannedMinutes);
    assert.ok(small.plannedMinutes <= 90 && big.plannedMinutes <= 360);
    await planner.setDailyHours(0);
    assert.equal((await planner.generateDailyPlan('2026-11-23')).tasks.length, 0);
  });

  test('7. completing a task updates progress only through the progress engine, and only with an outcome', async () => {
    const { engine, planner } = await setup();
    const plan = await planner.generateDailyPlan('2026-11-20', { hours: 4 });
    const [t1, t2] = plan.tasks;
    const before = snapshotProgress(engine);
    const done = await planner.completeTask('2026-11-20', t1.taskId);
    assert.equal(done.status, 'completed');
    assert.deepEqual(done.progressUpdates, []);
    assert.equal(snapshotProgress(engine), before, 'no outcome → no progress change');
    // with an outcome: applied via engine methods for the task's exam
    const d2 = await planner.completeTask('2026-11-20', t2.taskId, { outcome: { status: 'concept-completed', practice: { attempted: 20, correct: 15 } } });
    assert.deepEqual(d2.progressUpdates.map((u) => u.via), ['engine.updateTopic', 'engine.recordPractice']);
    const rep = (await engine.getCrossExamReports([t2.primaryExamId]))[t2.primaryExamId].topics[t2.topicId];
    assert.deepEqual([rep.status, rep.attempted], ['concept-completed', 20]);
    // other tasks stay pending: nothing is completed automatically
    assert.ok(planner.getDailyPlan('2026-11-20').tasks.filter((t) => ![t1.taskId, t2.taskId].includes(t.taskId)).every((t) => t.status === 'pending'));
  });

  test('8. dismissing a recommendation does not erase syllabus progress', async () => {
    const { engine, planner } = await setup();
    await engine.switchExam('ssc-cgl');
    engine.setStatus('english.reading-comprehension', 'learning');
    const before = snapshotProgress(engine);
    await planner.dismissRecommendation('english.reading-comprehension', { reason: 'later' });
    let recs = (await planner.getRecommendations({ limit: 140 })).recommendations;
    assert.equal(rankOf(recs, 'english.reading-comprehension'), -1);
    assert.equal(snapshotProgress(engine), before);
    assert.equal((await engine.getCrossExamReports(['ssc-cgl']))['ssc-cgl'].topics['english.reading-comprehension'].status, 'learning');
    // exam-specific dismissal removes only that exam's contribution
    await planner.undismissRecommendation('english.reading-comprehension');
    await planner.dismissRecommendation('english.reading-comprehension', { examId: 'sbi-po' });
    recs = (await planner.getRecommendations({ limit: 140 })).recommendations;
    const rc = recs.find((r) => r.topicId === 'english.reading-comprehension');
    assert.deepEqual(rc.relevantExams.map((e) => e.examId), ['ssc-cgl']);
    // dismissal until a date expires
    await planner.dismissRecommendation('quant.data-interpretation', { until: '2026-11-19' });
    recs = (await planner.getRecommendations({ limit: 140 })).recommendations;
    assert.ok(rankOf(recs, 'quant.data-interpretation') >= 0);
  });

  test('9. priority scores stay within range across all 9 exams with random progress', async () => {
    const targets = (await loader.listExams()).map((e, i) => ({ examId: e.examId, importance: 10 + i * 5 }));
    const { engine, planner } = await setup({ targets });
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const { examId } of targets.slice(0, 4)) {
      await engine.switchExam(examId);
      const model = engine.getModel();
      for (const topicId of Object.keys(model.topics)) {
        if (rand() < 0.4) engine.setStatus(topicId, config.statuses[Math.floor(rand() * 7)].id);
        if (rand() < 0.2) { const a = 1 + Math.floor(rand() * 40); engine.recordPractice(topicId, { attempted: a, correct: Math.floor(rand() * (a + 1)), timeSeconds: rand() * 3000 }); }
      }
    }
    const p = await planner.getPriorities();
    const classes = new Set(['Critical', 'High', 'Medium', 'Low']);
    for (const t of p.topics) {
      assert.ok(t.score >= 0 && t.score <= 100 && Number.isFinite(t.score), `${t.topicId}: ${t.score}`);
      assert.ok(classes.has(t.classification));
      for (const r of Object.values(t.perExam)) assert.ok(r.score >= 0 && r.score <= 100);
    }
    assert.ok(Math.abs(p.shares.reduce((a, s) => a + s.share, 0) - 1) < 1e-9);
  });

  test('10. no duplicate topics in recommendations or the daily plan; user edits survive regeneration', async () => {
    const { planner } = await setup();
    const recs = (await planner.getRecommendations({ limit: 140 })).recommendations;
    assert.equal(new Set(recs.map((r) => r.topicId)).size, recs.length);
    let plan = await planner.generateDailyPlan('2026-11-20', { hours: 5 });
    const ids = plan.tasks.filter((t) => t.topicId).map((t) => t.topicId);
    assert.equal(new Set(ids).size, ids.length);
    // manual add, remove, reorder → regenerate keeps them
    const manual = await planner.addTask('2026-11-20', { topicId: 'quant.percentage', examId: 'ssc-cgl', action: 'practice-questions', minutes: 30 });
    const removed = plan.tasks[0];
    await planner.removeTask('2026-11-20', removed.taskId);
    plan = planner.getDailyPlan('2026-11-20');
    const order = [...plan.tasks.map((t) => t.taskId)].reverse();
    await planner.reorderTasks('2026-11-20', order);
    plan = await planner.generateDailyPlan('2026-11-20', { hours: 5 });
    assert.ok(plan.tasks.some((t) => t.taskId === manual && t.source === 'manual'));
    assert.ok(!plan.tasks.some((t) => t.topicId === removed.topicId), 'removed topic not re-added');
    assert.equal(plan.tasks.filter((t) => t.topicId === 'quant.percentage').length, 1);
    assert.equal(plan.tasks[0].taskId, order[0], 'custom order kept');
    assert.ok(plan.tasks.every((t) => t.status === 'pending'));
  });

  test('weak-area detection distinguishes the four kinds of weakness', async () => {
    const { engine, planner } = await setup({ targets: [{ examId: 'sbi-po', importance: 100 }] });
    await engine.switchExam('sbi-po');
    engine.setStatus('quant.average', 'practicing');
    engine.recordPractice('quant.average', { attempted: 20, correct: 8, stageId: 'prelims' });                         // weak
    engine.setStatus('quant.percentage', 'practicing');
    engine.recordPractice('quant.percentage', { attempted: 20, correct: 18, timeSeconds: 20 * 90, stageId: 'prelims' }); // slow (target 40 s)
    engine.setStatus('quant.profit-loss', 'practicing');
    engine.recordPractice('quant.profit-loss', { attempted: 10, correct: 10, timeSeconds: 300, stageId: 'prelims' });     // accurate, too little practice
    for (const [c, d] of [[9, '2026-11-01'], [9, '2026-11-02'], [9, '2026-11-03'], [4, '2026-11-10'], [4, '2026-11-11'], [4, '2026-11-12']])
      engine.recordPractice('quant.time-work', { attempted: 10, correct: c, date: d, stageId: 'prelims' });             // declining
    engine.setStatus('quant.simple-interest', 'practicing');
    engine.recordPractice('quant.simple-interest', { attempted: 20, correct: 14, stageId: 'prelims' });                // 70%: not weak, below target
    const w = (await planner.getWeakAreas())['sbi-po'];
    const cat = (id) => w.all[id].category;
    assert.equal(cat('quant.average'), 'studied-but-weak');
    assert.equal(cat('quant.percentage'), 'good-concept-poor-speed');
    assert.equal(cat('quant.profit-loss'), 'good-accuracy-insufficient-practice');
    assert.equal(cat('reasoning.puzzles'), 'not-studied');
    assert.ok(w.all['quant.time-work'].flags.includes('declining-accuracy'));
    assert.equal(cat('quant.time-work'), 'studied-but-weak', 'overall 65% but the last 3 sessions are at 40%');
    assert.equal(cat('quant.simple-interest'), 'below-target');
    assert.ok(w.all['quant.simple-interest'].evidence.accuracy < w.all['quant.simple-interest'].evidence.accuracyTarget);
    assert.ok(w.weakTopics.some((t) => t.topicId === 'quant.average'));
    assert.ok(w.weakestSections.length > 0);
  });

  test('recommendation fields, explanation and insights', async () => {
    const { engine, planner } = await setup();
    await engine.switchExam('ssc-cgl');
    engine.updateConcept('quant.percentage', { status: 'concept-completed' });
    const { recommendations } = await planner.getRecommendations({ limit: 5 });
    for (const r of recommendations) for (const k of ['name', 'relevantExam', 'section', 'topicWeightage', 'syllabusCompletion', 'examMastery', 'priorityScore', 'reasons', 'suggestedAction']) assert.ok(r[k] !== undefined && r[k] !== null, `${r.topicId} missing ${k}`);
    const ex = await planner.explain('quant.percentage');
    assert.ok(ex.perExam.every((x) => Math.abs(x.share * x.score - x.contribution) < 0.02));
    assert.equal(ex.perExam.find((x) => x.examId === 'sbi-po').action.action, 'practice-questions', 'concept shared → practise, not re-learn');
    const ins = await planner.getInsights();
    assert.ok(ins.untouchedHighWeight.length > 0 && ins.commonAcrossTargets.length > 0 && ins.lowestMasterySections.length > 0);
    assert.equal(ins.sharedLearningSavings.conceptReuse.repetitionsAvoided, 1);
  });

  test('mock test is recommended once the exam is mock-ready', async () => {
    const { engine, planner } = await setup({ targets: [{ examId: 'ibps-clerk', importance: 100 }] });
    await engine.switchExam('ibps-clerk');
    for (const topicId of Object.keys(engine.getModel().topics)) engine.setStatus(topicId, 'practicing'); // 65% completion
    const { examRecommendations } = await planner.getRecommendations();
    assert.equal(examRecommendations[0].action, 'mock-test');
    const plan = await planner.generateDailyPlan('2026-11-20', { hours: 4 });
    const mock = plan.tasks.find((t) => t.action === 'mock-test');
    assert.ok(mock);
    await planner.completeTask('2026-11-20', mock.taskId, { note: 'scored 72/100' });
    assert.equal((await planner.getRecommendations()).examRecommendations.length, 0, 'min gap between mocks respected');
  });

  test('user controls persist across reloads in the planner collection only', async () => {
    const storage = new MemoryStorage();
    const a = await setup({ storage });
    await a.planner.setExamImportance('ssc-cgl', 70);
    await a.planner.setExamDate('sbi-po', '2027-03-10');
    await a.planner.setDailyHours(3);
    await a.planner.setConfigOverrides({ priority: { weights: { revisionDue: 0.4 } } });
    await a.planner.dismissRecommendation('ga.sports');
    await a.planner.generateDailyPlan('2026-11-20');
    await a.planner.flush();
    const b = await setup({ storage, targets: null });
    assert.deepEqual(b.planner.settings, a.planner.settings);
    assert.deepEqual(b.planner.getDailyPlan('2026-11-20'), a.planner.getDailyPlan('2026-11-20'));
    assert.equal(b.planner.config().priority.weights.revisionDue, 0.4);
    assert.ok((await storage.read(PLANNER_KEY)).dismissed['ga.sports']);
    assert.equal(await storage.read('progress'), null, 'planner never writes the progress collection');
    await assert.rejects(() => b.planner.setTargets([{ examId: 'ssc-xyz', importance: 50 }]), RangeError);
    assert.throws(() => b.planner.setDailyHours(30), RangeError);
  });
});

describe('Phase 6 planner additions (UI support)', { skip: !DIST_READY && 'run `npm run build` first' }, () => {
  test('addTask creates an empty plan for a day without one; moveTask moves between days and reorders', async () => {
    const { planner, engine } = await setup();
    const before = snapshotProgress(engine);
    const id = await planner.addTask('2026-11-25', { topicId: 'quant.percentage', examId: 'ssc-cgl', action: 'practice-questions', minutes: 30 });
    let p = planner.getDailyPlan('2026-11-25');
    assert.deepEqual([p.tasks.length, p.tasks[0].taskId, p.tasks[0].name, p.generatedAt], [1, id, 'Percentage', null]);
    const gen = await planner.generateDailyPlan('2026-11-26', { hours: 4 });
    const moving = gen.tasks[1];
    const moved = await planner.moveTask('2026-11-26', moving.taskId, '2026-11-25', { index: 0 });
    p = planner.getDailyPlan('2026-11-25');
    assert.deepEqual(p.tasks.map((t) => t.taskId), [moved, id]);
    assert.equal(p.tasks[0].topicId, moving.topicId);
    const day26 = await planner.generateDailyPlan('2026-11-26', { hours: 4 });
    assert.ok(!day26.tasks.some((t) => t.topicId === moving.topicId), 'moved topic is not re-added on the old day');
    // same-day move = reorder
    await planner.moveTask('2026-11-25', id, '2026-11-25', { index: 0 });
    assert.equal(planner.getDailyPlan('2026-11-25').tasks[0].taskId, id);
    assert.equal(snapshotProgress(engine), before, 'planning never changes progress');
  });

  test('generateDailyPlan can exclude topics already planned on other days', async () => {
    const { planner } = await setup();
    const a = await planner.generateDailyPlan('2026-11-21', { hours: 4 });
    const ids = a.tasks.map((t) => t.topicId).filter(Boolean);
    const b = await planner.generateDailyPlan('2026-11-22', { hours: 4, excludeTopicIds: ids });
    assert.ok(b.tasks.length > 0 && b.tasks.every((t) => !ids.includes(t.topicId)));
    assert.deepEqual(b.removed, [], 'exclusions are not stored as removals');
  });
});
