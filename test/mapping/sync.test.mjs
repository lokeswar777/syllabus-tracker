// Shared concept learning, synchronization modes and exam independence on the real databases.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProgressEngine, MemoryStorage } from '../../src/progress/index.js';
import { createNodeLoader, PROJECT_ROOT } from '../../src/progress/node.js';
import { config, NOW, idGen, DIST_READY } from '../progress/fixtures.mjs';

const near = (a, e, msg, tol = 0.01) => assert.ok(Math.abs(a - e) <= tol, `${msg ?? ''} expected ${e}, got ${a}`);
const loader = createNodeLoader();
const newEngine = (storage = new MemoryStorage()) => new ProgressEngine({ loader, storage, config, clock: () => NOW, idGenerator: idGen }).init();
const PCT = 'quant.percentage';
const ALL9 = ['ssc-cgl', 'ssc-chsl', 'ssc-cpo', 'sbi-po', 'sbi-clerk', 'ibps-po', 'ibps-clerk', 'ibps-rrb-po', 'ibps-rrb-clerk'];

describe('Phase 4 synchronization (real data)', { skip: !DIST_READY && 'run `npm run build` first' }, () => {
  test('1. completing Percentage concept learning updates every linked exam (full sync)', async () => {
    const e = await newEngine();
    await e.switchExam('ssc-cgl');
    const c = e.updateConcept('mt.quant.percentage', { status: 'concept-completed', notes: 'fraction equivalents learned', learningDate: '2026-11-18' });
    e.addConceptResource(PCT, { title: 'Arithmetic workbook ch. 3', type: 'book' });
    e.addConceptRevision(PCT, { date: '2026-11-19', note: 'quick recap' });
    const concept = e.getConcept(PCT);
    assert.equal(c.conceptCompletion, 100);
    assert.deepEqual([concept.status, concept.notes, concept.learningDates, concept.resources.length, concept.conceptRevisionCount], ['concept-completed', 'fraction equivalents learned', ['2026-11-18'], 1, 1]);
    assert.deepEqual(concept.linkedExams.map((x) => x.examId).sort(), [...ALL9].sort());

    const reports = await e.getCrossExamReports(ALL9);
    for (const id of ALL9) {
      const t = reports[id].topics[PCT];
      near(t.completion, 50, `${id} completion`);
      assert.equal(t.sharedLearning.syncMode, 'full');
      assert.equal(reports[id].subtopics[`${PCT}.basics`].effectiveStatus, 'concept-completed', `${id} learning record`);
      assert.equal(t.status, null, `${id}: the exam's own record is not overwritten`);
      near(t.mastery, 0, `${id}: concept learning is not mastery`);
    }
  });

  test('2. SSC CGL mastery stays independent of SBI PO mastery', async () => {
    const e = await newEngine();
    await e.switchExam('ssc-cgl');
    e.updateConcept(PCT, { status: 'concept-completed' });
    e.setStatus(PCT, 'mastered');
    e.recordPractice(PCT, { attempted: 60, correct: 54, timeSeconds: 2000, stageId: 'tier2-paper1' });
    const before = await e.getCrossExamReports(['ssc-cgl', 'sbi-po']);
    assert.ok(before['ssc-cgl'].topics[PCT].mastery > 50);
    near(before['sbi-po'].topics[PCT].mastery, 0);
    assert.equal(before['sbi-po'].topics[PCT].attempted, 0);
    assert.equal(before['sbi-po'].topics[PCT].masteryComponents.concept, 0, 'shared concept never feeds another exam\'s mastery');

    await e.switchExam('sbi-po');
    e.recordPractice(PCT, { attempted: 30, correct: 15, timeSeconds: 1800, stageId: 'prelims' });
    const after = await e.getCrossExamReports(['ssc-cgl', 'sbi-po']);
    assert.deepEqual(after['ssc-cgl'].topics[PCT], before['ssc-cgl'].topics[PCT], 'CGL unchanged by SBI PO practice');
    assert.equal(after['sbi-po'].topics[PCT].attempted, 30);
  });

  test('3. sync modes: full writes back, partial shares completion only, independent and disabling stop updates', async () => {
    const e = await newEngine();
    await e.switchExam('ssc-cgl');
    // full (default for Percentage): an exam status change writes the concept back
    e.setStatus(PCT, 'concept-completed');
    assert.equal(e.getConcept(PCT).conceptCompletion, 100);

    // partial: exam status changes are NOT written back; explicit concept learning IS shared, statuses differ
    e.setSyncMode(PCT, 'partial');
    e.updateConcept(PCT, { status: 'learning' });       // explicit concept record: 40%
    e.setStatus(PCT, 'mastered');                       // CGL status: not written back in partial mode
    assert.equal(e.getConcept(PCT).conceptCompletion, 40);
    let sbi = (await e.getCrossExamReports(['sbi-po']))['sbi-po'];
    near(sbi.topics[PCT].completion, 20, 'partial: concept completion (40% of 50) shared');
    assert.equal(sbi.subtopics[`${PCT}.basics`].effectiveStatus, 'not-started', 'partial: SBI keeps its own status');

    // independent: no synchronization in either direction from now on
    e.setSyncMode(PCT, 'independent');
    sbi = (await e.getCrossExamReports(['sbi-po']))['sbi-po'];
    near(sbi.topics[PCT].completion, 0);
    e.setStatus(PCT, 'concept-completed');
    assert.equal(e.getConcept(PCT).conceptCompletion, 40, 'independent: no write-back');

    // back to full: the existing shared record is still there (nothing was deleted)
    e.setSyncMode(PCT, null);
    sbi = (await e.getCrossExamReports(['sbi-po']))['sbi-po'];
    near(sbi.topics[PCT].completion, 20);

    // global switch-off stops all synchronization
    e.setSyncEnabled(false);
    sbi = (await e.getCrossExamReports(['sbi-po']))['sbi-po'];
    near(sbi.topics[PCT].completion, 0);
    e.updateTopic('quant.average', { status: 'concept-completed' });
    assert.equal(e.snapshot().sharedLearning.topics['quant.average'], undefined, 'no shared write while sync is disabled');
    e.setSyncEnabled(true);
  });

  test('3b. per-exam opt-out: one exam can stop reading/writing shared learning for a topic', async () => {
    const e = await newEngine();
    await e.switchExam('ssc-cgl');
    e.updateConcept(PCT, { status: 'concept-completed' });
    await e.switchExam('ibps-po');
    near(e.setShareLearning(PCT, false).topics[PCT].completion, 0);
    near((await e.getCrossExamReports(['sbi-po']))['sbi-po'].topics[PCT].completion, 50, 'other exams unaffected');
  });

  test('4. changing one exam\'s practice score does not affect another exam', async () => {
    const e = await newEngine();
    await e.switchExam('ssc-cgl');
    e.recordPractice(PCT, { attempted: 40, correct: 30, stageId: 'tier1' });
    const cgl = (await e.getCrossExamReports(['ssc-cgl']))['ssc-cgl'];
    await e.switchExam('sbi-po');
    e.recordPractice(PCT, { attempted: 10, correct: 10 });
    const sid = e.practiceSessions(PCT)[0].id;
    e.setPracticeTotals(PCT, { attempted: 80, correct: 70 });
    e.deletePractice(sid);
    const cglAfter = (await e.getCrossExamReports(['ssc-cgl']))['ssc-cgl'];
    assert.deepEqual(cglAfter.topics[PCT], cgl.topics[PCT]);
    assert.equal(cglAfter.summary.examMastery, cgl.summary.examMastery);
  });

  test('5. exam-specific difficulty and preparation requirements stay separate', async () => {
    const e = await newEngine();
    const r = await e.getCrossExamReports(['ssc-cgl', 'sbi-po', 'sbi-clerk']);
    const cgl = r['ssc-cgl'].topics[PCT], po = r['sbi-po'].topics[PCT], clerk = r['sbi-clerk'].topics[PCT];
    assert.notDeepEqual([cgl.requirement.depth, cgl.requirement.speedTargetSec], [po.requirement.depth, po.requirement.speedTargetSec]);
    assert.equal(po.stagePreparation.prelims.requirement.depth, 'speed');
    assert.equal(po.stagePreparation.mains.requirement.depth, 'applied');
    assert.equal(clerk.stagePreparation.prelims.requirement.difficulty, 'easy');
    assert.equal(po.stagePreparation.prelims.requirement.difficulty, 'medium');

    await e.switchExam('ssc-cgl');
    e.updateTopic(PCT, { difficulty: 'hard', targets: { questionTarget: 150, accuracyTarget: 90 } });
    const r2 = await e.getCrossExamReports(['ssc-cgl', 'sbi-po']);
    assert.deepEqual([r2['ssc-cgl'].topics[PCT].requirement.questionTarget, r2['ssc-cgl'].topics[PCT].requirement.source], [150, 'user-override']);
    assert.equal(r2['ssc-cgl'].topics[PCT].targetDifficulty, 'hard');
    assert.deepEqual(r2['sbi-po'].topics[PCT].requirement, po.requirement, 'SBI PO requirement unchanged');
    assert.equal(r2['sbi-po'].topics[PCT].targetDifficulty, null);
  });

  test('5b. prelims vs mains practice and SSC-level vs banking-level practice are kept apart', async () => {
    const e = await newEngine();
    await e.switchExam('sbi-po');
    e.recordPractice(PCT, { attempted: 20, correct: 18, timeSeconds: 700, stageId: 'prelims' });
    e.recordPractice(PCT, { attempted: 10, correct: 6, timeSeconds: 900, stageId: 'mains' });
    const po = e.getReport().topics[PCT];
    assert.deepEqual([po.practiceByStage.prelims.attempted, po.practiceByStage.mains.attempted], [20, 10]);
    assert.deepEqual([po.stagePreparation.prelims.attempted, po.stagePreparation.mains.attempted], [20, 10]);
    near(po.stagePreparation.prelims.avgTimeSeconds, 35); near(po.stagePreparation.mains.accuracy, 60);
    assert.equal(e.practiceSessions(PCT)[0].level, 'banking');
    await e.switchExam('ssc-cgl');
    e.recordPractice('quant.algebra-identities', { attempted: 5, correct: 5 });
    const s = e.practiceSessions('quant.algebra-identities')[0];
    assert.equal(s.level, 'ssc');
    assert.equal(s.stageId, null, 'topic in two stages and no stage selected → left unspecified');
    assert.throws(() => e.recordPractice(PCT, { attempted: 1, correct: 1, stageId: 'mains' }), RangeError);
  });

  test('6. unmapped topics remain independent', async () => {
    const e = await newEngine();
    await e.switchExam('ssc-cgl');
    assert.throws(() => e.updateConcept('skill.dest', { status: 'learning' }), RangeError);
    const r = e.setStatus('skill.dest', 'concept-completed');
    assert.equal(r.topics['skill.dest'].masterTopicId, null);
    assert.equal(r.topics['skill.dest'].sharedLearning.syncMode, 'independent');
    assert.equal(e.snapshot().sharedLearning.topics['skill.dest'], undefined, 'no shared record for an unmapped topic');
    assert.equal(e.syncModeFor('ssc-cgl', 'stats.sampling'), 'independent');
  });

  test('7. existing Phase 3 progress data is preserved', async () => {
    const dir = join(PROJECT_ROOT, 'test', 'fixtures', 'phase3-progress');
    const original = {};
    for (const k of ['progress', 'sharedLearning', 'practice']) original[k] = JSON.parse(await readFile(join(dir, `${k}.json`), 'utf8'));
    const storage = new MemoryStorage(original);
    const e = await newEngine(storage);
    const snap = e.snapshot();
    assert.deepEqual(snap.progress.exams, original.progress.exams, 'exam records intact');
    assert.deepEqual(snap.practice.exams, original.practice.exams, 'practice sessions intact');
    assert.deepEqual(snap.sharedLearning.topics, original.sharedLearning.topics, 'shared records intact');
    assert.deepEqual(snap.sharedLearning.subtopics, original.sharedLearning.subtopics);
    // Phase 3 demo results unchanged by the Phase 4 engine
    const reports = await e.getCrossExamReports(['ssc-cgl', 'sbi-po']);
    near(reports['ssc-cgl'].summary.syllabusCompletion, 7.26);
    near(reports['sbi-po'].summary.syllabusCompletion, 10.66);
    // a Phase 4 action on another topic, then save: the old records are still byte-identical
    e.setSyncMode('mt.reasoning.puzzles', 'partial');
    await e.flush();
    for (const k of ['progress', 'practice']) assert.deepEqual((await storage.read(k)).exams, original[k].exams);
    assert.deepEqual((await storage.read('syncSettings')).modes, { 'mt.reasoning.puzzles': 'partial' });
  });

  test('8. invalid synchronization input is rejected', async () => {
    const e = await newEngine();
    await e.switchExam('ssc-cgl');
    assert.throws(() => e.updateConcept(PCT, { status: 'practicing' }), /exam-specific/);
    assert.throws(() => e.updateConcept(PCT, { conceptCompletion: 140 }), RangeError);
    assert.throws(() => e.setSyncMode(PCT, 'sometimes'), TypeError);
    assert.throws(() => e.updateTopic(PCT, { targets: { accuracyTarget: 120 } }), RangeError);
  });
});

describe('Shared-topic dashboard and insights (real data)', { skip: !DIST_READY && 'run `npm run build` first' }, () => {
  test('groups, completed concepts, pending exam practice, recommendations, benefits', async () => {
    const e = await newEngine();
    await e.switchExam('ssc-cgl');
    e.updateConcept(PCT, { status: 'concept-completed' });
    e.updateConcept('quant.average', { status: 'learning' });
    const sel = ['ssc-cgl', 'ssc-chsl', 'sbi-po', 'ibps-po'];
    const d = await e.getSharedTopicDashboard(sel);
    const ids = (k) => d.groups[k].map((x) => x.topicId);
    assert.ok(ids('commonToAllSelected').includes(PCT));
    assert.ok(ids('commonToSSC').includes('reasoning.analogy'));
    assert.ok(ids('commonToBanking').includes('reasoning.puzzles'));
    assert.ok(ids('uniqueToSSC').includes('quant.geometry-triangles') && !ids('uniqueToSSC').includes(PCT));
    assert.ok(ids('uniqueToBanking').includes('reasoning.puzzles'));
    assert.deepEqual(d.sharedConceptsCompleted.map((x) => x.masterTopicId), ['mt.quant.percentage']);
    assert.ok(d.examSpecificPracticePending.some((x) => x.examId === 'sbi-po' && x.masterTopicId === 'mt.quant.percentage'));
    assert.equal(d.topicCards['mt.quant.percentage'].exams['sbi-po'].requirement.depth, 'applied');

    const ins = await e.getCrossExamInsights(sel);
    const rec = (stageId) => ins.recommendations.find((r) => r.type === 'practice-exam-pattern' && r.examId === 'sbi-po' && r.topicId === PCT && r.stageId === stageId);
    assert.match(rec('prelims').message, /skip basic concept learning for SBI PO prelims\. Practise speed-based calculations/);
    assert.match(rec('mains').message, /SBI PO mains\. Practise complex applications and DI-related/);
    assert.ok(d.examSpecificPracticePending.some((x) => x.examId === 'sbi-po' && x.stageId === 'prelims') && d.examSpecificPracticePending.some((x) => x.examId === 'sbi-po' && x.stageId === 'mains'));
    assert.ok(ins.recommendations.some((r) => r.type === 'finish-shared-concept' && r.topicId === 'quant.average' && r.benefitsExams.length === 4));
    assert.equal(ins.conceptReuse.repetitionsAvoided, 3); // Percentage learned once for 4 selected exams
    assert.deepEqual(ins.examsBenefiting.map((x) => x.examId).sort(), [...sel].sort());
    assert.ok(ins.commonHighWeightage.some((x) => x.masterTopicId === 'mt.quant.data-interpretation'));
    assert.ok(ins.remainingExamSpecific['sbi-po'].topics >= 1);
  });
});
