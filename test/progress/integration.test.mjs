// Runs the engine against the real build output for all 9 exams and every track.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildExamModel, calculateProgress, compileConfig, progressDb as P } from '../../src/progress/index.js';
import { createNodeLoader } from '../../src/progress/node.js';
import { config, NOW, rng, idGen, DIST_READY } from './fixtures.mjs';
import { assertBounded } from './calculation.test.mjs';

const cfg = compileConfig(config);
const near = (a, e, msg, tol = 0.02) => assert.ok(Math.abs(a - e) <= tol, `${msg ?? ''} expected ${e}, got ${a}`);

describe('All exams (dist/)', { skip: !DIST_READY && 'run `npm run build` first' }, async () => {
  const loader = createNodeLoader();
  const exams = DIST_READY ? await loader.listExams() : [];

  for (const { examId } of exams) {
    test(`${examId}: 0% when nothing started, 100% when every topic is Mastered (all tracks, all stages)`, async () => {
      const data = await loader.loadExam(examId);
      for (const track of data.weightageExam.tracks) {
        const model = buildExamModel({ ...data, trackId: track.trackId });
        assert.equal(model.warnings.length, 0, `${examId}/${track.trackId}: ${model.warnings.join('; ')}`);
        const empty = calculateProgress({ model, db: P.createEmptyDb(NOW), config, now: NOW });
        assert.equal(empty.summary.syllabusCompletion, 0);
        assert.equal(empty.summary.topicCounts.pending, empty.summary.topicCounts.total);
        let db = P.createEmptyDb(NOW);
        for (const topicId of Object.keys(model.topics)) db = P.updateNode(db, { examId, nodeId: topicId, patch: { status: 'mastered' }, cfg, now: NOW });
        const full = calculateProgress({ model, db, config, now: NOW });
        near(full.summary.syllabusCompletion, 100, `${examId}/${track.trackId}`);
        for (const st of model.stages) {
          const r = calculateProgress({ model, db, config, now: NOW, stageId: st.id });
          if (st.sections.length) near(r.summary.syllabusCompletion, 100, `${examId}/${st.id}`);
          else assert.ok(r.diagnostics.warnings.some((w) => w.includes('has no syllabus')), `${examId}/${st.id} flagged as having no syllabus`);
        }
        // effective topic weights in the exam sum to 100 (no double counting across stages/sections)
        near(Object.values(full.topics).reduce((a, t) => a + t.effectiveWeight, 0), 100, `${examId} weight sum`, 0.1);
      }
    });
  }

  test('RRB PO: choosing Hindi instead of English swaps which section counts', async () => {
    const data = await loader.loadExam('ibps-rrb-po');
    let db = P.createEmptyDb(NOW);
    for (const id of ['english.reading-comprehension', 'english.cloze-test']) db = P.updateNode(db, { examId: 'ibps-rrb-po', nodeId: id, patch: { status: 'mastered' }, cfg, now: NOW });
    const eng = calculateProgress({ model: buildExamModel({ ...data, choices: { language: 'english' } }), db, config, now: NOW });
    const hin = calculateProgress({ model: buildExamModel({ ...data, choices: { language: 'hindi' } }), db, config, now: NOW });
    assert.ok(eng.summary.syllabusCompletion > 0);
    assert.equal(hin.summary.syllabusCompletion, 0);
  });

  test('fuzz on SSC CGL and SBI PO: random progress stays within 0–100 everywhere', async () => {
    const rand = rng(7);
    for (const examId of ['ssc-cgl', 'sbi-po']) {
      const data = await loader.loadExam(examId);
      const model = buildExamModel(data);
      const nodes = [...Object.keys(model.topics), ...Object.keys(model.subtopics)];
      for (let i = 0; i < 8; i++) {
        let db = P.createEmptyDb(NOW);
        for (const n of nodes) {
          if (rand() < 0.5) db = P.updateNode(db, { examId, nodeId: n, patch: { status: cfg.statusIds[Math.floor(rand() * cfg.statusIds.length)] }, cfg, now: NOW });
          if (rand() < 0.2) { const a = Math.floor(rand() * 60); db = P.recordPractice(db, { examId, nodeId: n, session: { attempted: a, correct: Math.floor(rand() * (a + 1)) }, newId: idGen, now: NOW }); }
        }
        assertBounded(calculateProgress({ model, db, config, now: NOW }));
      }
    }
  });
});
