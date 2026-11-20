#!/usr/bin/env node
/**
 * Phase 5 worked example on the real data (requires `npm run build` and `npm run build:mapping`).
 * Deterministic: a fixed, mutable clock and fixed ids. Simulates three weeks of preparation for
 * SSC CGL (importance 60, exam 2027-06-15) + SBI PO (importance 40, exam 2027-03-10), then prints the
 * recommendations and writes:
 *   examples/planner/store/*.json            progress collections + the planner collection
 *   examples/planner/recommendations.json    top 15 + mock-test recommendations
 *   examples/planner/explain-<topic>.json    score breakdown of one topic
 *   examples/planner/revision-tracker.json
 *   examples/planner/weak-areas.json         weakest topics/sections and categories per exam
 *   examples/planner/daily-plan.json         3.5 h plan (after a manual edit), one task completed
 *   examples/planner/insights.json
 */
import { rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ProgressEngine } from '../src/progress/index.js';
import { FileStorage, createNodeLoader, loadDefaultConfig, PROJECT_ROOT } from '../src/progress/node.js';
import { StudyPlanner } from '../src/planner/index.js';

const OUT = join(PROJECT_ROOT, 'examples', 'planner');
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const clock = { now: new Date('2026-10-30T09:00:00Z') };
const on = (d) => { clock.now = new Date(`${d}T09:00:00Z`); };
let n = 0;
const storage = new FileStorage(join(OUT, 'store'));
const engine = await new ProgressEngine({
  loader: createNodeLoader(), storage, config: await loadDefaultConfig(),
  clock: () => clock.now, idGenerator: () => `id-${String(++n).padStart(3, '0')}`,
}).init();
const plannerConfig = JSON.parse(await readFile(join(PROJECT_ROOT, 'data', 'planner', 'config.json'), 'utf8'));
const planner = await new StudyPlanner({ engine, storage, config: plannerConfig, clock: () => clock.now }).init();

// ── 1. user controls ──
await planner.setTargets([
  { examId: 'ssc-cgl', importance: 60, examDate: '2027-06-15' },
  { examId: 'sbi-po', importance: 40, examDate: '2027-03-10' },
]);
await planner.setDailyHours(3.5);

// ── 2. three weeks of simulated preparation ──
await engine.switchExam('ssc-cgl');
on('2026-10-30'); engine.updateConcept('quant.percentage', { status: 'concept-completed', learningDate: '2026-10-30' });
engine.setStatus('quant.percentage', 'practicing');
engine.recordPractice('quant.percentage', { attempted: 40, correct: 33, timeSeconds: 1500, stageId: 'tier1' });
on('2026-11-02'); engine.setStatus('quant.ratio-proportion', 'completed');
engine.recordPractice('quant.ratio-proportion', { attempted: 25, correct: 22, timeSeconds: 900, stageId: 'tier1' });
on('2026-11-05'); engine.setStatus('english.synonyms-antonyms', 'learning');
on('2026-11-08'); engine.setStatus('reasoning.coding-decoding', 'practicing');
engine.recordPractice('reasoning.coding-decoding', { attempted: 20, correct: 9, timeSeconds: 700, stageId: 'tier1' });
on('2026-11-12'); engine.recordPractice('reasoning.coding-decoding', { attempted: 20, correct: 10, timeSeconds: 650, stageId: 'tier1' });
on('2026-11-14'); engine.addRevision('quant.percentage', { date: '2026-11-14', note: 'Successive change formulas' });

await engine.switchExam('sbi-po');
on('2026-11-03'); engine.setStatus('quant.simplification', 'practicing');
engine.recordPractice('quant.simplification', { attempted: 30, correct: 27, timeSeconds: 30 * 55, stageId: 'prelims' }); // accurate but slow
on('2026-11-06'); engine.recordPractice('quant.percentage', { attempted: 20, correct: 14, timeSeconds: 900, stageId: 'prelims' });
for (const [d, c] of [['2026-11-07', 8], ['2026-11-09', 8], ['2026-11-11', 8], ['2026-11-16', 4], ['2026-11-17', 5], ['2026-11-18', 4]]) {
  on(d); engine.setStatus('reasoning.seating-arrangement', 'practicing');
  engine.recordPractice('reasoning.seating-arrangement', { attempted: 10, correct: c, timeSeconds: 10 * 70, stageId: 'prelims' }); // declining accuracy
}
on('2026-11-19'); engine.setStatus('english.reading-comprehension', 'learning');
await engine.flush();

// ── 3. today ──
on('2026-11-20');
await planner.dismissRecommendation('ga.current-affairs', { examId: 'ssc-cgl', reason: 'Following a separate monthly current-affairs routine for CGL' });
const recs = await planner.getRecommendations({ limit: 15 });
const explainId = 'quant.data-interpretation';
const explanation = await planner.explain(explainId);
const tracker = await planner.getRevisionTracker();
const weak = await planner.getWeakAreas();
const insights = await planner.getInsights();

let plan = await planner.generateDailyPlan('2026-11-20');
// the learner edits the plan: removes the last task, adds 20 min of vocabulary revision, then completes the first task with an outcome
await planner.removeTask('2026-11-20', plan.tasks.at(-1).taskId);
await planner.addTask('2026-11-20', { topicId: 'english.synonyms-antonyms', examId: 'ssc-cgl', action: 'revise-notes', minutes: 20, detail: 'Daily word list' });
plan = await planner.generateDailyPlan('2026-11-20');
const first = plan.tasks[0];
await planner.completeTask('2026-11-20', first.taskId, first.action === 'revise-notes'
  ? { outcome: { revision: { date: '2026-11-20', note: 'Revised from the daily plan' } }, note: 'done' }
  : { note: 'done (no outcome recorded, so progress unchanged)' });
plan = planner.getDailyPlan('2026-11-20');
await planner.flush();
await engine.flush();

// ── 4. write the example files ──
const W = (f, v) => writeFile(join(OUT, f), JSON.stringify(v, null, 2) + '\n');
const trimWeak = Object.fromEntries(Object.entries(weak).map(([e, w]) => [e, { weakTopics: w.weakTopics.slice(0, 10), weakestSections: w.weakestSections, categories: Object.fromEntries(Object.entries(w.categories).map(([k, v]) => [k, ({ count: v.count, topicIds: v.topicIds.slice(0, 8) })])) }]));
await W('recommendations.json', recs);
await W(`explain-${explainId}.json`, explanation);
await W('revision-tracker.json', tracker);
await W('weak-areas.json', trimWeak);
await W('daily-plan.json', plan);
await W('insights.json', insights);

// ── 5. print ──
const line = (s = '') => console.log(s);
line(`══ Targets on ${recs.generatedFor} ══`);
for (const s of recs.shares) line(`  ${s.examId.padEnd(8)} importance ${s.importance}, exam ${s.examDate} (${s.daysLeft} days) → urgency ${s.urgency.toFixed(2)}, share ${(s.share * 100).toFixed(1)}%`);
line('\n══ Top recommendations ══');
line(' #  Score  Class     Topic                               Exam     Section                     Wt    Compl  Mast   Action');
for (const r of recs.recommendations.slice(0, 12)) {
  line(`${String(r.rank).padStart(2)}  ${r.priorityScore.toFixed(1).padStart(5)}  ${r.classification.padEnd(8)}  ${r.name.slice(0, 34).padEnd(34)}  ${r.relevantExam.name.slice(0, 7).padEnd(7)}  ${(r.section ?? '').slice(0, 26).padEnd(26)}  ${r.topicWeightage.toFixed(2).padStart(5)}  ${r.syllabusCompletion.toFixed(0).padStart(4)}%  ${r.examMastery.toFixed(0).padStart(3)}%  ${r.suggestedAction.action}`);
  line(`      ↳ ${r.reasons.slice(0, 2).join(' · ')}`);
}
for (const m of recs.examRecommendations) line(`  mock: ${m.reason}`);
line(`\n══ Why "${explanation.name}" scored ${explanation.score} (${explanation.classification}) ══`);
for (const x of explanation.perExam) line(`  ${x.examId}: ${x.arithmetic}  contributions ${Object.entries(x.contributions).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`);
line(`\n══ Revision tracker (${tracker.summary.tracked} tracked: ${tracker.summary.overdue} overdue, ${tracker.summary.dueToday} due today, ${tracker.summary.dueSoon} due soon) ══`);
for (const i of tracker.items.slice(0, 8)) line(`  ${i.examId.padEnd(8)} ${i.name.slice(0, 30).padEnd(30)} revisions ${i.revisionCount}, next ${i.nextDue} → ${i.status}${i.daysOverdue ? ` (${i.daysOverdue} d overdue)` : ''}`);
line('\n══ Weak areas ══');
for (const [e, w] of Object.entries(weak)) {
  line(`  ${e}: ${w.weakTopics.slice(0, 4).map((t) => `${t.name} [${t.category}${t.flags.length ? `; ${t.flags.join(', ')}` : ''}]`).join(' | ') || '—'}`);
  line(`    weakest sections: ${w.weakestSections.slice(0, 3).map((s) => `${s.name} (mastery ${s.mastery})`).join(', ')}`);
}
line(`\n══ Daily plan ${plan.date}: ${plan.plannedMinutes}/${plan.budgetMinutes} min ══`);
for (const t of plan.tasks) line(`  ${t.order}. [${t.status}] ${String(t.minutes).padStart(3)} min  ${t.action.padEnd(18)} ${t.name} (${t.examIds.join('+')}, ${t.source})${t.progressUpdates?.length ? `  → ${t.progressUpdates.map((u) => u.via).join(', ')}` : ''}`);
line('\n══ Insights ══');
line(`  untouched high-weight: ${insights.untouchedHighWeight.slice(0, 5).map((t) => t.name).join(', ')}`);
line(`  common to both exams (by combined weight): ${insights.commonAcrossTargets.slice(0, 5).map((t) => t.name).join(', ')}`);
line(`  declining accuracy: ${insights.decliningAccuracy.map((t) => `${t.name} ${t.earlierAccuracy}% → ${t.recentAccuracy}% (${t.examId})`).join(', ') || '—'}`);
line(`  more practice would help: ${insights.morePracticeWouldHelp.slice(0, 4).map((t) => `${t.name} (${t.examId}, ${t.category})`).join(', ')}`);
if (insights.sharedLearningSavings) line(`  shared learning: ${JSON.stringify(insights.sharedLearningSavings.conceptReuse)}`);
line(`\nWrote ${OUT}`);
