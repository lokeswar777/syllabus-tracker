#!/usr/bin/env node
/**
 * Worked example on the real data (requires `npm run build`). Deterministic: fixed clock and ids.
 * Prints example calculations and writes the resulting progress collections to examples/progress-sample/.
 *
 *   node scripts/progress-demo.mjs
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ProgressEngine } from '../src/progress/index.js';
import { FileStorage, createNodeLoader, loadDefaultConfig, PROJECT_ROOT } from '../src/progress/node.js';

const OUT = join(PROJECT_ROOT, 'examples', 'progress-sample');
await rm(OUT, { recursive: true, force: true });
let n = 0;
const engine = await new ProgressEngine({
  loader: createNodeLoader(),
  storage: new FileStorage(OUT),
  config: await loadDefaultConfig(),
  clock: () => new Date('2026-11-20T09:00:00Z'),
  idGenerator: () => `session-${String(++n).padStart(3, '0')}`,
}).init();

const pct = (x) => `${x.toFixed(2)}%`;
const line = (s = '') => console.log(s);

// ── SSC CGL ──
await engine.switchExam('ssc-cgl');
engine.setStatus('quant.percentage', 'mastered');
for (const [attempted, correct, date] of [[15, 13, '2026-11-02'], [15, 14, '2026-11-09'], [10, 9, '2026-11-14'], [10, 9, '2026-11-19']])
  engine.recordPractice('quant.percentage', { attempted, correct, difficulty: 'medium', timeSeconds: attempted * 55, date });
engine.recordPractice('quant.percentage.successive-change', { attempted: 10, correct: 8, difficulty: 'hard', timeSeconds: 700, revision: true, date: '2026-11-18' });
engine.addRevision('quant.percentage', { date: '2026-11-12', note: 'formula sheet' });
engine.setStatus('quant.algebra-identities', 'concept-completed');
engine.updateTopic('english.reading-comprehension', { status: 'practicing', notes: 'Editorial passages are slow; time each set.' });
engine.recordPractice('english.reading-comprehension', { attempted: 30, correct: 24, timeSeconds: 2400, date: '2026-11-17' });
engine.setStatus('quant.trigonometry.identities', 'mastered');
engine.setStatus('ga.history-modern', 'learning');
const cgl = engine.getReport();
const cglTier1 = engine.getReport({ stageId: 'tier1' });

line('══ SSC CGL (default track) ══');
line(`Syllabus completion ${pct(cgl.summary.syllabusCompletion)} · Exam mastery ${pct(cgl.summary.examMastery)} · Remaining ${pct(cgl.summary.remainingWeightedSyllabus)}`);
line(`Tier-I only: completion ${pct(cglTier1.summary.syllabusCompletion)} · mastery ${pct(cglTier1.summary.examMastery)}`);
line(`Topics: ${JSON.stringify(cgl.summary.topicCounts)}`);
line('\nTopic contributions (effective weight × completion):');
for (const id of ['quant.percentage', 'quant.algebra-identities', 'english.reading-comprehension', 'quant.trigonometry', 'ga.history-modern']) {
  const t = cgl.topics[id];
  line(`  ${t.name.padEnd(36)} weight ${pct(t.effectiveWeight).padStart(7)} × completion ${pct(t.completion).padStart(7)} = ${t.contribution.toFixed(4)} pts · mastery ${pct(t.mastery)} (${t.masteryLevel})`);
}
const p = cgl.topics['quant.percentage'];
line(`\nPercentage occurrences: ${p.occurrences.map((o) => `${o.stageId}/${o.sectionKey.split('/')[1]} ${o.weightInExam.toFixed(4)}%`).join(' + ')}`);
line(`Percentage practice: ${p.attempted} Q, ${p.correct} correct (${pct(p.accuracy)}), ${p.practiceSets} sets, ${p.avgTimeSeconds.toFixed(1)} s/Q, ${p.revisionCount} revisions, last ${p.lastPracticed}`);
line(`Percentage mastery components: ${JSON.stringify(p.masteryComponents)} → ${pct(p.mastery)}`);
line('\nSection-wise (completion / mastery):');
for (const s of cgl.analytics.sectionWise) line(`  ${s.stageId.padEnd(13)} ${s.name.slice(0, 46).padEnd(46)} ${pct(s.weightInScope).padStart(7)} of exam  ${pct(s.completion).padStart(7)} / ${pct(s.mastery)}`);
line('\nHigh-weightage incomplete topics (top 5):');
for (const t of cgl.analytics.highWeightIncomplete.slice(0, 5)) line(`  ${t.name.padEnd(36)} ${t.priority.padEnd(9)} weight ${pct(t.effectiveWeight)} done ${pct(t.completion)} → remaining ${t.remainingWeight.toFixed(2)} pts`);

// ── SBI PO: shared conceptual learning, independent preparation ──
const cglRecordsBefore = JSON.stringify(engine.snapshot().progress.exams['ssc-cgl'].topics);
await engine.switchExam('sbi-po');
engine.setStatus('quant.data-interpretation', 'practicing');
engine.recordPractice('quant.data-interpretation', { attempted: 20, correct: 13, difficulty: 'hard', timeSeconds: 1500, date: '2026-11-19' });
engine.setStatus('reasoning.puzzles', 'learning');
const sbi = engine.getReport();
const sp = sbi.topics['quant.percentage'];
line('\n══ SBI PO ══');
line(`Syllabus completion ${pct(sbi.summary.syllabusCompletion)} · Exam mastery ${pct(sbi.summary.examMastery)}`);
line(`Percentage in SBI PO: completion ${pct(sp.completion)} (shared from CGL, capped at Concept Completed), own status ${sp.status}, mastery ${pct(sp.mastery)}, attempted ${sp.attempted}`);
line(`Data Interpretation: weight ${pct(sbi.topics['quant.data-interpretation'].effectiveWeight)}, completion ${pct(sbi.topics['quant.data-interpretation'].completion)}, mastery ${pct(sbi.topics['quant.data-interpretation'].mastery)}`);

// back to CGL: its own records are untouched; only SBI PO's *conceptual* DI learning flows back
const again = await engine.switchExam('ssc-cgl');
const di = again.topics['quant.data-interpretation'];
line(`\nBack to SSC CGL: own records unchanged = ${JSON.stringify(engine.snapshot().progress.exams['ssc-cgl'].topics) === cglRecordsBefore}`);
line(`  completion ${pct(cgl.summary.syllabusCompletion)} → ${pct(again.summary.syllabusCompletion)}: SBI PO's DI concept is shared → DI ${pct(di.completion)} (source: shared) × weight ${pct(di.effectiveWeight)} = +${(di.contribution).toFixed(2)} pts; DI mastery in CGL stays ${pct(di.mastery)}`);
await engine.flush();
line(`\nSample progress collections written to examples/progress-sample/`);
