/**
 * Weak-area detection (pure). Works on the per-exam rows produced by computePriorities, so it uses
 * each exam's own practice records only.
 *
 * Primary category (one per topic):
 *   not-studied                         completion = 0
 *   studied-but-weak                    studied, ≥ minQuestions, accuracy (overall, or over the recent sessions when they
 *                                       hold ≥ minQuestions) < weakAccuracyBelow, or mastery < weakMasteryBelow
 *   good-concept-poor-speed             concept understood (completion ≥ 50), accuracy within goodAccuracyMargin of target,
 *                                       average time > speed target × speedSlowerThanTargetBy
 *   good-accuracy-insufficient-practice accuracy ≥ target but attempted < question target × insufficientPracticeBelowShare
 *   below-target                        ≥ minQuestions, not weak, but accuracy below the exam's target − goodAccuracyMargin
 *   studied-not-practised               some completion, no questions attempted
 *   ok                                  none of the above
 * Additional flags: repeated-incorrect, needs-repeated-revision, declining-accuracy, slow.
 */
import { round2 } from './config.js';
import { sessionStats } from './revision.js';

export function classifyWeakness(row, sessions, cfg) {
  const W = cfg.weakAreas;
  const req = row.requirement ?? {};
  const att = row.attempted ?? 0;
  const acc = row.accuracy;
  const accTarget = req.accuracyTarget ?? 80;
  const ss = sessionStats(sessions, cfg.priority.accuracy.recentSessions);
  const flags = [];
  const slow = req.speedTargetSec != null && row.avgTimeSeconds != null && row.avgTimeSeconds > req.speedTargetSec * W.speedSlowerThanTargetBy;
  if (slow) flags.push('slow');
  if (ss.incorrect >= W.repeatedIncorrectAtOrAbove && acc !== null && acc < accTarget) flags.push('repeated-incorrect');
  if ((row.revision?.revisionCount ?? 0) >= W.repeatedRevisionAtOrAbove && row.mastery < W.repeatedRevisionMasteryBelow) flags.push('needs-repeated-revision');
  if (ss.recentAccuracy !== null && ss.earlierAccuracy !== null && ss.earlierAccuracy - ss.recentAccuracy >= W.decliningAccuracyDrop) flags.push('declining-accuracy');

  const recentWeak = ss.recentAccuracy !== null && ss.recentAttempted >= W.minQuestions && ss.recentAccuracy < W.weakAccuracyBelow;
  let category = 'ok';
  if (row.completion === 0 && att === 0) category = 'not-studied';
  else if (att >= W.minQuestions && ((acc !== null && acc < W.weakAccuracyBelow) || recentWeak || row.mastery < W.weakMasteryBelow)) category = 'studied-but-weak';
  else if (row.completion >= 50 && acc !== null && acc >= accTarget - W.goodAccuracyMargin && slow) category = 'good-concept-poor-speed';
  else if (acc !== null && acc >= accTarget && req.questionTarget != null && att < req.questionTarget * W.insufficientPracticeBelowShare) category = 'good-accuracy-insufficient-practice';
  else if (att >= W.minQuestions && acc !== null && acc < accTarget - W.goodAccuracyMargin) category = 'below-target';
  else if (row.completion > 0 && att === 0) category = 'studied-not-practised';

  // weakness score (0–100) for ranking studied topics: low accuracy, low mastery, slowness, flags; weighted by importance
  const accPart = acc === null ? 0.5 : Math.max(0, (accTarget - acc) / accTarget);
  const masteryPart = 1 - row.mastery / 100;
  const speedPart = slow ? Math.min(1, row.avgTimeSeconds / req.speedTargetSec - 1) : 0;
  const weakness = round2(100 * Math.min(1, (0.4 * accPart + 0.35 * masteryPart + 0.15 * speedPart + 0.1 * Math.min(1, flags.length / 2)) * (0.5 + 0.5 * (row.factors?.importance ?? 0.5))));
  return {
    category, flags, weakness,
    evidence: { attempted: att, accuracy: acc, accuracyTarget: accTarget, recentAccuracy: ss.recentAccuracy, earlierAccuracy: ss.earlierAccuracy, incorrect: ss.incorrect, avgTimeSeconds: row.avgTimeSeconds, speedTargetSec: req.speedTargetSec ?? null, mastery: row.mastery, revisionCount: row.revision?.revisionCount ?? 0, questionTarget: req.questionTarget ?? null },
  };
}

/** Weak topics (studied ones ranked by weakness) and weakest sections per exam. */
export function detectWeakAreas({ perExam, reports, sessions, cfg, limit = 15 }) {
  const out = {};
  for (const [examId, rows] of Object.entries(perExam)) {
    const byNode = new Map();
    for (const s of sessions[examId] ?? []) { if (!byNode.has(s.nodeId)) byNode.set(s.nodeId, []); byNode.get(s.nodeId).push(s); }
    const rep = reports[examId];
    const items = Object.values(rows).map((row) => {
      const t = rep.topics[row.topicId];
      const sess = [...(byNode.get(row.topicId) ?? []), ...t.subtopicIds.flatMap((id) => byNode.get(id) ?? [])];
      return { topicId: row.topicId, name: row.name, section: row.section?.name ?? null, effectiveWeight: row.effectiveWeight, completion: row.completion, mastery: row.mastery, ...classifyWeakness(row, sess, cfg) };
    });
    const byCategory = {};
    for (const it of items) (byCategory[it.category] ??= []).push(it.topicId);
    const weakTopics = items.filter((i) => ['studied-but-weak', 'below-target', 'good-concept-poor-speed', 'good-accuracy-insufficient-practice'].includes(i.category) || i.flags.length)
      .sort((a, b) => b.weakness - a.weakness).slice(0, limit);
    const weakestSections = rep.analytics.sectionWise.filter((s) => !s.gate && s.weightInScope > 0)
      .map((s) => ({ stageId: s.stageId, sectionId: s.sectionId, name: s.name, weightInExam: s.weightInScope, completion: s.completion, mastery: s.mastery }))
      .sort((a, b) => a.mastery - b.mastery || b.weightInExam - a.weightInExam).slice(0, 5);
    out[examId] = { weakTopics, weakestSections, categories: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, { count: v.length, topicIds: v }])), all: Object.fromEntries(items.map((i) => [i.topicId, i])) };
  }
  return out;
}
