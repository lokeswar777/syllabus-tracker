// Master topic database + cross-exam mapping: identity by stable IDs, integrity, review flags, manual edits.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildMapping } from '../../src/mapping/build.js';
import { PROJECT_ROOT } from '../../src/progress/node.js';
import { makeExam, DIST_READY } from '../progress/fixtures.mjs';

const readJson = async (...p) => JSON.parse(await readFile(join(PROJECT_ROOT, ...p), 'utf8'));
const mappingConfig = await readJson('data', 'mapping', 'config.json');

describe('Real mapping (dist + data/mapping)', { skip: !DIST_READY && 'run `npm run build` first' }, async () => {
  const syllabus = DIST_READY ? await readJson('dist', 'syllabus.json') : null;
  const overrides = await readJson('data', 'mapping', 'overrides.json');
  const built = DIST_READY ? buildMapping({ exams: syllabus.exams, libraryTopics: syllabus.topics, subjects: syllabus.subjects, config: mappingConfig, overrides, dataVersion: syllabus.meta.dataVersion }) : null;
  const masters = built?.masterTopics.masters ?? [];
  const cem = built?.crossExamMapping;

  test('builds without errors; committed files are up to date', async () => {
    assert.deepEqual(built.errors, []);
    const committed = await readJson('data', 'mapping', 'master-topics.json');
    assert.deepEqual(committed.masters, masters, 'run `npm run build:mapping`');
    assert.deepEqual((await readJson('data', 'mapping', 'cross-exam-mapping.json')).byExam, cem.byExam);
  });

  test('no duplicate master topics; each master is exactly one stable library ID', () => {
    const ids = masters.map((m) => m.masterTopicId);
    assert.equal(new Set(ids).size, ids.length);
    for (const m of masters) assert.equal(m.masterTopicId, `mt.${m.libraryTopicId}`);
    assert.equal(new Set(masters.map((m) => m.libraryTopicId)).size, masters.length);
  });

  test('every topic used by 2+ exams has a master; single-exam topics stay unmapped', () => {
    for (const [topicId, t] of Object.entries(syllabus.topics)) {
      const m = masters.find((x) => x.libraryTopicId === topicId);
      if (t.coverage.exams.length >= 2) assert.ok(m, `${topicId} should be a master`);
      else assert.equal(m, undefined, `${topicId} is single-exam`);
      if (m) assert.deepEqual([...m.exams].sort(), [...t.coverage.exams].sort());
    }
    assert.ok(cem.unmapped.some((u) => u.topicId === 'skill.dest' && u.examId === 'ssc-cgl'));
  });

  test('no incorrect mappings: every mapping points at a real exam/stage/section/topic with its exact subtopics', () => {
    for (const [mid, list] of Object.entries(cem.mappings)) {
      for (const m of list) {
        const exam = syllabus.exams.find((e) => e.id === m.examId);
        const sec = exam?.stages.find((s) => s.id === m.stageId)?.sections.find((s) => s.id === m.sectionId);
        const t = sec?.topics.find((x) => x.topicId === m.topicId);
        assert.ok(t, `${m.mappingId} must exist in the syllabus`);
        assert.equal(`mt.${t.topicId}`, mid);
        assert.deepEqual(m.subtopicSlugs, t.subtopics.map((s) => s.slug));
      }
    }
    // every exam topic is indexed exactly once
    for (const exam of syllabus.exams) {
      const ids = new Set(exam.stages.flatMap((s) => s.sections.flatMap((x) => x.topics.map((t) => t.topicId))));
      assert.deepEqual(Object.keys(cem.byExam[exam.id]).sort(), [...ids].sort());
    }
  });

  test('identity is by ID, not by name: same-named concepts in different subjects stay separate', () => {
    const cloze = masters.filter((m) => /cloze/i.test(m.name)).map((m) => m.masterTopicId).sort();
    assert.deepEqual(cloze, ['mt.english.cloze-test', 'mt.hindi.cloze-test']);
  });

  test('Percentage maps to all 9 exams, including the SSC and banking examples', () => {
    const p = masters.find((m) => m.masterTopicId === 'mt.quant.percentage');
    for (const e of ['ssc-cgl', 'ssc-chsl', 'sbi-po', 'ibps-po', 'sbi-clerk']) assert.ok(p.exams.includes(e));
    assert.equal(p.exams.length, 9);
    assert.equal(p.coverage, 'ssc-and-banking');
    assert.equal(p.similarity.level, 'identical');
    assert.equal(p.verification.status, 'verified');
    assert.equal(p.defaultSyncMode, 'full');
    const ids = cem.mappings['mt.quant.percentage'].map((m) => m.mappingId);
    assert.ok(ids.includes('ssc-cgl/tier1/quant/quant.percentage') && ids.includes('sbi-po/mains/data-analysis/quant.percentage'));
  });

  test('uncertain mappings are flagged for review and never default to full sync', () => {
    assert.ok(cem.review.length > 0);
    for (const r of cem.review) {
      const m = masters.find((x) => x.masterTopicId === r.masterTopicId);
      assert.notEqual(m.verification.status, 'verified');
      assert.notEqual(m.defaultSyncMode, 'full', `${m.masterTopicId} needs review`);
    }
    // low/partial similarity is never auto-verified
    for (const m of masters.filter((x) => ['partial', 'low'].includes(x.similarity.level) && x.verification.method === 'auto')) assert.equal(m.verification.status, 'needs-review');
  });

  test('preparation depth differs per exam (Percentage: SSC vs banking prelims vs banking mains)', () => {
    const req = (e, key) => cem.byExam[e]['quant.percentage'].stageRequirements[key];
    const cgl = req('ssc-cgl', 'tier1/quant'), sbiPre = req('sbi-po', 'prelims/quant'), sbiMains = req('sbi-po', 'mains/data-analysis');
    assert.match(cgl.depthDescription, /Standard to advanced arithmetic/);
    assert.match(sbiPre.depthDescription, /Speed-based calculations/);
    assert.match(sbiMains.depthDescription, /DI-related/);
    assert.equal(sbiPre.speedTargetSec, 40); // 30 Q in 20 min (official)
    assert.equal(cgl.speedTargetSec, 36);    // 25 Q in 15 min (official)
    assert.notDeepEqual([cgl.depth, cgl.difficulty], [sbiMains.depth, sbiMains.difficulty]);
  });
});

describe('Manual edits and validation (fixtures)', () => {
  const ssc = makeExam({ id: 'ssc-a', category: 'ssc', stages: [{ id: 'tier1', w: 100, sections: [{ id: 'quant', w: 100, topics: [
    { id: 'quant.percentage', w: 50, subs: [['basics', 50], ['successive-change', 50]] },
    { id: 'quant.geometry-triangles', w: 50, subs: [['centres', 100]] },
  ] }] }] });
  const bank = makeExam({ id: 'bank-a', category: 'banking', stages: [{ id: 'prelims', w: 100, sections: [{ id: 'quant', w: 100, topics: [
    { id: 'quant.percentage', w: 50, subs: [['basics', 100]] },
    { id: 'reasoning.puzzles', w: 50, subs: [['floor', 100]] },
  ] }] }] });
  const bank2 = makeExam({ id: 'bank-b', category: 'banking', stages: [{ id: 'mains', w: 100, sections: [{ id: 'quant', w: 100, topics: [
    { id: 'quant.percentage', w: 50, subs: [['basics', 50], ['applications', 50]] },
    { id: 'reasoning.puzzles', w: 50, subs: [['floor', 100]] },
  ] }] }] });
  const exams = [ssc.syllabusExam, bank.syllabusExam, bank2.syllabusExam];
  const build = (overrides = {}) => buildMapping({ exams, config: mappingConfig, overrides: { schemaVersion: 1, ...overrides } });

  test('similarity is measured from subtopic overlap and drives verification + default sync', () => {
    const { masterTopics } = build();
    const p = masterTopics.masters.find((m) => m.masterTopicId === 'mt.quant.percentage');
    assert.equal(p.similarity.minJaccard, 0.333); // {basics,successive} vs {basics,applications}
    assert.equal(p.similarity.level, 'partial');
    assert.equal(p.verification.status, 'needs-review');
    assert.equal(p.defaultSyncMode, 'partial');
    assert.deepEqual(p.sharedSubtopicIds, ['quant.percentage.basics']);
    const puzzles = masterTopics.masters.find((m) => m.masterTopicId === 'mt.reasoning.puzzles');
    assert.equal(puzzles.similarity.level, 'identical');
    assert.equal(puzzles.coverage, 'banking-only');
  });

  test('mapping can be manually edited: verification, sync mode, requirements, exclusions, related links', () => {
    const { masterTopics, crossExamMapping, errors } = build({
      masters: {
        'mt.quant.percentage': { verification: { status: 'verified', note: 'reviewed' }, syncMode: 'full', requirements: { 'bank-b/mains': { questionTarget: 99, depthDescription: 'Custom mains depth.' } } },
        'mt.reasoning.puzzles': { verification: { status: 'rejected', note: 'not comparable' } },
      },
      excludeMappings: [{ masterTopicId: 'mt.quant.percentage', examId: 'bank-a', reason: 'test exclusion' }],
      relatedLinks: { add: [{ from: 'mt.quant.percentage', to: 'mt.reasoning.puzzles', relation: 'related-concept' }] },
    });
    assert.deepEqual(errors, []);
    const p = masterTopics.masters.find((m) => m.masterTopicId === 'mt.quant.percentage');
    assert.deepEqual([p.verification.status, p.verification.method, p.defaultSyncMode], ['verified', 'manual', 'full']);
    assert.deepEqual(p.exams, ['ssc-a', 'bank-b'], 'excluded exam removed from the master');
    assert.equal(crossExamMapping.byExam['bank-a']['quant.percentage'].masterTopicId, null, 'excluded exam is unmapped → independent');
    assert.deepEqual(crossExamMapping.excluded.map((x) => x.examId), ['bank-a']);
    const req = crossExamMapping.byExam['bank-b']['quant.percentage'].requirement;
    assert.deepEqual([req.questionTarget, req.depthDescription, req.source], [99, 'Custom mains depth.', 'manual-override']);
    const puzzles = masterTopics.masters.find((m) => m.masterTopicId === 'mt.reasoning.puzzles');
    assert.equal(puzzles.defaultSyncMode, 'independent', 'rejected mapping never syncs');
    assert.ok(crossExamMapping.review.some((r) => r.masterTopicId === 'mt.reasoning.puzzles' && r.status === 'rejected'));
    assert.deepEqual(p.relatedMasterTopics.map((r) => [r.masterTopicId, r.sync]), [['mt.reasoning.puzzles', 'never']]);
  });

  test('invalid manual edits are rejected (no incorrect mappings)', () => {
    const { errors } = build({
      masters: {
        'mt.quant.not-a-topic': { syncMode: 'full' },
        'mt.quant.percentage': { syncMode: 'sometimes', requirements: { 'ssc-zzz': {}, 'bank-a/mains': {} } },
      },
      excludeMappings: [{ masterTopicId: 'mt.reasoning.puzzles', examId: 'ssc-a' }],
      relatedLinks: { add: [{ from: 'mt.quant.percentage', to: 'mt.quant.percentage' }] },
    });
    for (const frag of ["'mt.quant.not-a-topic'", "syncMode 'sometimes'", "unknown exam 'ssc-zzz'", "not in stage 'mains'", 'excludeMappings', 'relatedLinks.add'])
      assert.ok(errors.some((e) => e.includes(frag)), `expected an error mentioning ${frag}: ${errors.join(' | ')}`);
  });

  test('single-exam topics get no master but still get exam requirements', () => {
    const { masterTopics, crossExamMapping } = build();
    assert.equal(masterTopics.masters.find((m) => m.libraryTopicId === 'quant.geometry-triangles'), undefined);
    const e = crossExamMapping.byExam['ssc-a']['quant.geometry-triangles'];
    assert.equal(e.masterTopicId, null);
    assert.equal(e.requirement.depth, 'standard');
  });
});
