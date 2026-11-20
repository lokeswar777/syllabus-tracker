import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProgressEngine, MemoryStorage } from '../../src/progress/index.js';
import { createNodeLoader } from '../../src/progress/node.js';
import { SIMPLE, OTHER, MULTI, fixtureLoader, config, NOW, idGen, DIST_READY } from './fixtures.mjs';

const near = (a, e, msg, tol = 0.01) => assert.ok(Math.abs(a - e) <= tol, `${msg ?? ''} expected ${e}, got ${a}`);
const engineWith = (loader, storage = new MemoryStorage()) => new ProgressEngine({ loader, storage, config, clock: () => NOW, idGenerator: idGen }).init();

describe('5. Shared topic progress', () => {
  test('conceptual learning is shared; exam-specific completion, mastery and practice are not', async () => {
    const e = await engineWith(fixtureLoader(SIMPLE, OTHER));
    await e.switchExam('simple');
    e.setStatus('quant.percentage', 'mastered');
    e.updateTopic('quant.percentage', { difficulty: 'medium' });
    e.recordPractice('quant.percentage.a', { attempted: 40, correct: 36, difficulty: 'medium' });
    const a = e.getReport().topics['quant.percentage'];

    const r = await e.switchExam('other');
    const t = r.topics['quant.percentage'];
    near(t.completion, 50, 'shared conceptual learning reflected (capped at Concept Completed)');
    assert.equal(r.subtopics['quant.percentage.a'].completionSource, 'shared');
    assert.equal(t.status, null, 'exam-specific status not copied');
    assert.equal(t.attempted, 0, 'practice records are separate');
    near(t.mastery, 0, 'mastery is independent');
    near(r.summary.syllabusCompletion, 25); // 50% of a 50%-weight topic

    // own status above the shared level wins; below it, the shared level is kept
    near(e.setStatus('quant.percentage', 'practicing').topics['quant.percentage'].completion, 65);
    near(e.setStatus('quant.percentage', 'learning').topics['quant.percentage'].completion, 50);
    // different difficulty level per exam
    e.updateTopic('quant.percentage', { difficulty: 'hard' });
    await e.switchExam('simple');
    const back = e.getReport().topics['quant.percentage'];
    assert.equal(back.targetDifficulty, 'medium');
    assert.equal(back.mastery, a.mastery, 'exam A mastery untouched by exam B activity');
    assert.equal(back.attempted, 40);
  });

  test('shared learning can be disabled per topic, and the shared store only ever increases', async () => {
    const e = await engineWith(fixtureLoader(SIMPLE, OTHER));
    await e.switchExam('simple');
    e.setStatus('quant.percentage', 'concept-completed');
    await e.switchExam('other');
    near(e.getReport().topics['quant.percentage'].completion, 50);
    const off = e.setShareLearning('quant.percentage', false);
    near(off.topics['quant.percentage'].completion, 0, 'sharing disabled → own progress only');
    assert.equal(off.topics['quant.percentage'].sharedLearning.enabled, false);
    // updates in an exam with sharing disabled do not write to the shared store
    e.setStatus('quant.percentage', 'learning');
    assert.equal(e.snapshot().sharedLearning.topics['quant.percentage'].status, 'concept-completed');
    // lowering a status in the source exam does not lower what is shared
    await e.switchExam('simple');
    e.setStatus('quant.percentage', 'learning');
    assert.equal(e.snapshot().sharedLearning.topics['quant.percentage'].status, 'concept-completed');
    // only an explicit shared reset lowers it
    e.setSharedStatus('quant.percentage', null);
    assert.equal(e.snapshot().sharedLearning.topics['quant.percentage'], undefined);
  });

  test('global switch turns shared learning off for every exam', async () => {
    const e = await engineWith(fixtureLoader(SIMPLE, OTHER));
    await e.switchExam('simple');
    e.setStatus('quant.percentage', 'mastered');
    await e.switchExam('other');
    near(e.getReport().topics['quant.percentage'].completion, 50);
    near(e.setSharedLearningEnabled(false).topics['quant.percentage'].completion, 0);
  });
});

describe('4. Exam switching', () => {
  test('switching loads independent progress and never overwrites another exam', async () => {
    const e = await engineWith(fixtureLoader(SIMPLE, OTHER, MULTI));
    await e.switchExam('simple');
    e.setStatus('quant.average', 'completed');
    e.updateTopic('english.cloze-test', { status: 'practicing', notes: 'simple-exam note' });
    const before = structuredClone(e.snapshot().progress.exams.simple);
    const reportA = e.getReport();

    await e.switchExam('multi');
    e.setStatus('reasoning.puzzles', 'mastered');
    e.updateTopic('quant.percentage', { notes: 'multi note' });
    await e.switchExam('other');
    e.setStatus('quant.data-interpretation', 'learning');

    const r = await e.switchExam('simple');
    assert.deepEqual(e.snapshot().progress.exams.simple, { ...before, updatedAt: e.snapshot().progress.exams.simple.updatedAt });
    near(r.summary.syllabusCompletion, reportA.summary.syllabusCompletion);
    assert.equal(r.topics['english.cloze-test'].notes, 'simple-exam note');
    assert.equal(e.snapshot().progress.exams.multi.topics['quant.percentage'].notes, 'multi note');
    assert.equal(e.activeExamId, 'simple');
  });

  test('updating a topic that is not in the active exam is rejected', async () => {
    const e = await engineWith(fixtureLoader(SIMPLE, OTHER));
    await e.switchExam('other');
    assert.throws(() => e.setStatus('english.cloze-test', 'learning'), RangeError);
    assert.throws(() => e.updateTopic('quant.percentage.a', { status: 'learning' }), TypeError); // subtopic via topic API
  });

  test('changes recalculate automatically and notify subscribers', async () => {
    const e = await engineWith(fixtureLoader(SIMPLE));
    await e.switchExam('simple');
    const seen = [];
    const off = e.subscribe((v) => seen.push(v));
    near(e.setStatus('quant.percentage', 'mastered').summary.syllabusCompletion, 6);
    near(e.setWeightOverride({ kind: 'section', stageId: 's1', sectionId: 'secA' }, 60).summary.syllabusCompletion, 9.23);
    near(e.setWeightOverride({ kind: 'section', stageId: 's1', sectionId: 'secA' }, null).summary.syllabusCompletion, 6);
    off();
    assert.equal(seen.length, 3);
  });
});

describe('Real data (dist/)', { skip: !DIST_READY && 'run `npm run build` first' }, () => {
  test('SSC CGL ↔ SBI PO ↔ IBPS PO: shared Percentage, independent everything else', async () => {
    const e = await engineWith(createNodeLoader());
    await e.switchExam('ssc-cgl');
    e.setStatus('quant.percentage', 'mastered');
    e.recordPractice('quant.percentage', { attempted: 30, correct: 27 });
    const cgl = e.getReport();
    near(cgl.topics['quant.percentage'].completion, 100);
    near(cgl.summary.syllabusCompletion, cgl.topics['quant.percentage'].effectiveWeight);

    for (const examId of ['sbi-po', 'ibps-po']) {
      const r = await e.switchExam(examId);
      const t = r.topics['quant.percentage'];
      near(t.completion, 50, `${examId} shared completion`);
      assert.equal(t.attempted, 0, `${examId} practice independent`);
      near(t.mastery, 0, `${examId} mastery independent`);
      near(r.summary.syllabusCompletion, t.effectiveWeight * 0.5, `${examId} overall`);
      assert.ok(t.effectiveWeight !== cgl.topics['quant.percentage'].effectiveWeight || examId === 'sbi-po', 'exam-specific weights');
    }
    const back = await e.switchExam('ssc-cgl');
    assert.equal(back.topics['quant.percentage'].attempted, 30);
  });

  test('tracks and stage scope on SSC CGL (JSO track adds Paper-II)', async () => {
    const e = await engineWith(createNodeLoader());
    await e.switchExam('ssc-cgl');
    assert.equal(e.getReport().topics['stats.sampling'], undefined, 'Paper-II topics not in default track');
    assert.throws(() => e.setStatus('stats.sampling', 'mastered'), RangeError, 'cannot mark a topic outside the selected track');
    e.setTrack('tier2-paper2');
    const jso = e.setStatus('stats.sampling', 'mastered');
    assert.ok(jso.topics['stats.sampling'].completion === 100 && jso.summary.syllabusCompletion > 0);
    const stage = e.setStage('tier2-paper2');
    assert.deepEqual(stage.scope, { type: 'stage', stageId: 'tier2-paper2' });
    near(stage.summary.syllabusCompletion, stage.topics['stats.sampling'].effectiveWeight);
  });
});

describe('Phase 6 engine additions (UI support)', { skip: !DIST_READY && 'run `npm run build` first' }, () => {
  test('setConfig validates, recalculates and leaves stored records untouched', async () => {


    const e = await new ProgressEngine({ loader: createNodeLoader(), storage: new MemoryStorage(), config, clock: () => NOW }).init();
    await e.switchExam('ssc-cgl');
    e.setStatus('quant.percentage', 'practicing');
    const rec = JSON.stringify(e.getExamRecords('ssc-cgl'));
    const before = e.getReport().topics['quant.percentage'].completion;
    const next = structuredClone(config);
    next.statuses.find((s) => s.id === 'practicing').score = 70;
    let notified = 0; e.subscribe(() => notified++);
    e.setConfig(next);
    assert.equal(before, 65);
    assert.equal(e.getReport().topics['quant.percentage'].completion, 70);
    assert.equal(JSON.stringify(e.getExamRecords('ssc-cgl')), rec);
    assert.equal(notified, 1);
    const bad = structuredClone(config); bad.statuses[1].score = 99;
    assert.throws(() => e.setConfig(bad), /Invalid progress config/);
    assert.equal(e.getReport().topics['quant.percentage'].completion, 70, 'invalid config is not applied');
    assert.deepEqual(e.getWeightOverrides('ssc-cgl'), {});
    assert.equal(e.getExamRecords('sbi-po'), null);
  });
});

describe('Phase 6 regression: classification uses the displayed (rounded) completion', { skip: !DIST_READY && 'run `npm run build` first' }, () => {
  test('every topic set to "completed" is counted as completed in all 9 exams (no 89.999… misses)', async () => {
    const e = await new ProgressEngine({ loader: createNodeLoader(), storage: new MemoryStorage(), config, clock: () => NOW }).init();
    const exams = (await createNodeLoader().listExams()).map((x) => x.examId);
    const misses = [];
    for (const ex of exams) {
      await e.switchExam(ex);
      for (const id of Object.keys(e.getModel().topics)) e.setStatus(id, 'completed');
      for (const t of Object.values(e.getReport({ stageId: null }).topics)) if (t.category !== 'completed') misses.push(`${ex}:${t.topicId}=${t.completion}`);
    }
    assert.deepEqual(misses, []);
  });
});
