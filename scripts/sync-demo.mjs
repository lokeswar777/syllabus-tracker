#!/usr/bin/env node
/**
 * Phase 4 worked example on the real data (requires `npm run build` and `npm run build:mapping`).
 * Deterministic (fixed clock and ids). Prints the example and writes:
 *   examples/common-mapping/progress/*.json        progress collections (schema v2, incl. syncSettings)
 *   examples/common-mapping/concept-percentage.json shared concept record view
 *   examples/common-mapping/shared-dashboard.json   shared-topic dashboard data
 *   examples/common-mapping/cross-exam-insights.json
 */
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProgressEngine } from '../src/progress/index.js';
import { FileStorage, createNodeLoader, loadDefaultConfig, PROJECT_ROOT } from '../src/progress/node.js';

const OUT = join(PROJECT_ROOT, 'examples', 'common-mapping');
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
let n = 0;
const engine = await new ProgressEngine({
  loader: createNodeLoader(), storage: new FileStorage(join(OUT, 'progress')), config: await loadDefaultConfig(),
  clock: () => new Date('2026-11-20T09:00:00Z'), idGenerator: () => `id-${String(++n).padStart(3, '0')}`,
}).init();
const P = 'quant.percentage';
const SEL = ['ssc-cgl', 'ssc-chsl', 'sbi-po', 'ibps-po', 'sbi-clerk'];
const pct = (x) => `${(x ?? 0).toFixed(2)}%`;
const line = (s = '') => console.log(s);

await engine.switchExam('ssc-cgl');
// 1. shared concept learning (master topic Percentage)
engine.updateConcept(P, { status: 'concept-completed', notes: 'Fraction equivalents, successive change, product constancy.', learningDate: '2026-11-15' });
engine.addConceptResource(P, { title: 'Quantitative Aptitude: Percentage chapter', type: 'book' });
engine.addConceptResource(P, { title: 'Percentage shortcuts lecture', type: 'video', url: 'https://example.com/percentage' });
engine.addConceptRevision(P, { date: '2026-11-18', note: 'Formula sheet recap' });
engine.updateConcept('quant.ratio-proportion', { conceptCompletion: 60 });
// 2. exam-specific preparation stays separate
engine.setStatus(P, 'practicing');
engine.recordPractice(P, { attempted: 40, correct: 34, timeSeconds: 1500, difficulty: 'medium', stageId: 'tier1', date: '2026-11-19' });
await engine.switchExam('sbi-po');
engine.recordPractice(P, { attempted: 30, correct: 22, timeSeconds: 1380, difficulty: 'medium', stageId: 'prelims', date: '2026-11-19' });
// 3. sync choices: current affairs only partially, coding-decoding independent for this learner
engine.setSyncMode('mt.ga.current-affairs', 'partial');
engine.setSyncMode('mt.reasoning.coding-decoding', 'independent');

const concept = engine.getConcept(P);
const reports = await engine.getCrossExamReports(SEL);
line('══ Master topic: Percentage (mt.quant.percentage) ══');
line(`Concept: ${concept.status} (${concept.conceptCompletion}%), ${concept.resources.length} resources, ${concept.conceptRevisionCount} concept revision(s), learned on ${concept.learningDates.join(', ')}`);
line(`Similarity ${concept.similarity.level}, verification ${concept.verification.status}, default sync ${concept.defaultSyncMode}\n`);
line('Exam            sync  completion (own)   mastery  practice        requirement (exam level)');
for (const e of SEL) {
  const t = reports[e].topics[P];
  const r = t.requirement;
  line(`${reports[e].shortName.padEnd(15)} ${t.sharedLearning.syncMode.padEnd(5)} ${pct(t.completion).padStart(7)} (${pct(t.ownCompletion).padStart(7)})  ${pct(t.mastery).padStart(7)}  ${String(t.attempted).padStart(3)} Q ${t.accuracy === null ? '   –  ' : pct(t.accuracy)}  ${r.depth}/${r.difficulty}, ${r.questionTarget} Q ≥${r.accuracyTarget}% ≤${r.speedTargetSec}s`);
}
const po = reports['sbi-po'].topics[P].stagePreparation;
line(`\nSBI PO stage readiness: prelims ${po.prelims.attempted} Q, ${pct(po.prelims.accuracy)}, ${po.prelims.avgTimeSeconds}s/Q vs ≤${po.prelims.requirement.speedTargetSec}s → ${po.prelims.targetsMet.all ? 'met' : po.prelims.targetsMet.gaps.map((g) => g.target).join(', ') + ' pending'}; mains ${po.mains.attempted} Q (${po.mains.requirement.depthDescription})`);

const dash = await engine.getSharedTopicDashboard(SEL);
const ins = await engine.getCrossExamInsights(SEL);
line(`\n══ Shared-topic dashboard (${SEL.length} exams) ══`);
line(`Common to all ${dash.counts.commonToAllSelected} · common to SSC ${dash.counts.commonToSSC} · common to banking ${dash.counts.commonToBanking} · unique to SSC ${dash.counts.uniqueToSSC} · unique to banking ${dash.counts.uniqueToBanking}`);
line(`Shared concepts completed: ${dash.sharedConceptsCompleted.map((x) => x.name).join(', ')} · exam-specific practice pending: ${dash.examSpecificPracticePending.length}`);
line('\n══ Cross-exam insights ══');
line(`Concept learning repetitions avoided: ${ins.conceptReuse.repetitionsAvoided}`);
line(`Exams benefiting: ${ins.examsBenefiting.map((x) => `${x.shortName} +${x.sharedLearningUplift} pts`).join(', ')}`);
for (const r of ins.recommendations.slice(0, 4)) line(`• ${r.message}`);
line(`Common high-weightage topics (top 5): ${ins.commonHighWeightage.slice(0, 5).map((x) => `${x.name} (high in ${x.highIn.length})`).join(', ')}`);

await engine.flush();
await writeFile(join(OUT, 'concept-percentage.json'), JSON.stringify(concept, null, 2) + '\n');
await writeFile(join(OUT, 'shared-dashboard.json'), JSON.stringify({ ...dash, topicCards: Object.fromEntries(Object.entries(dash.topicCards).filter(([k]) => ['mt.quant.percentage', 'mt.quant.ratio-proportion', 'mt.ga.current-affairs'].includes(k))) }, null, 2) + '\n');
await writeFile(join(OUT, 'cross-exam-insights.json'), JSON.stringify({ ...ins, recommendations: ins.recommendations.slice(0, 10), commonHighWeightage: ins.commonHighWeightage.slice(0, 10) }, null, 2) + '\n');
line('\nWrote examples/common-mapping/ (progress collections, concept record, dashboard and insights samples)');
