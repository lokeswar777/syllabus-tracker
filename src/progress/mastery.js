/**
 * Practice aggregation and the exam-mastery score.
 * Mastery is computed from practice evidence. It is never derived from the completion status
 * alone: without practice data it is capped at the concept component (25% by default).
 */
import { clampPct, daysBetween, maxDate } from './config.js';

/**
 * Aggregates practice sessions plus manual totals (`manualStats`) and manual revision logs of node records.
 * Each session is counted once, at the node it was logged against.
 */
export function aggregateStats({ sessions = [], records = [], cfg }) {
  const mult = cfg.mastery.accuracy.difficultyMultiplier;
  const defDiff = cfg.mastery.accuracy.defaultDifficulty;
  const s = {
    attempted: 0, correct: 0, incorrect: 0, practiceSets: 0, timeSeconds: 0, timedQuestions: 0,
    weightedCorrect: 0, revisionCount: 0, revisionAttempted: 0, revisionCorrect: 0,
    lastPracticed: null, lastRevised: null, difficultyCounts: {}, sessions: 0,
  };
  for (const x of sessions) {
    const att = x.attempted ?? 0, cor = x.correct ?? 0;
    s.sessions++;
    s.attempted += att;
    s.correct += cor;
    s.incorrect += x.incorrect ?? Math.max(0, att - cor);
    if (x.practiceSet !== false) s.practiceSets++;
    if (Number.isFinite(x.timeSeconds) && att > 0) { s.timeSeconds += x.timeSeconds; s.timedQuestions += att; }
    const d = x.difficulty ?? defDiff;
    s.weightedCorrect += cor * (mult[d] ?? 1);
    s.difficultyCounts[d] = (s.difficultyCounts[d] ?? 0) + 1;
    if (x.revision) {
      s.revisionCount++;
      s.revisionAttempted += att;
      s.revisionCorrect += cor;
      s.lastRevised = maxDate(s.lastRevised, x.date);
    }
    s.lastPracticed = maxDate(s.lastPracticed, x.date);
  }
  for (const r of records) {
    if (!r) continue;
    const m = r.manualStats;
    if (m) {
      const att = m.attempted ?? 0, cor = m.correct ?? 0;
      s.attempted += att;
      s.correct += cor;
      s.incorrect += m.incorrect ?? Math.max(0, att - cor);
      s.practiceSets += m.practiceSets ?? 0;
      s.revisionCount += m.revisionCount ?? 0;
      if (Number.isFinite(m.totalTimeSeconds) && att > 0) { s.timeSeconds += m.totalTimeSeconds; s.timedQuestions += att; }
      s.weightedCorrect += cor * (mult[r.difficulty ?? defDiff] ?? 1);
      s.lastPracticed = maxDate(s.lastPracticed, m.lastPracticed ?? null);
    }
    for (const rev of r.revisions ?? []) {
      s.revisionCount++;
      s.lastRevised = maxDate(s.lastRevised, rev.date);
    }
  }
  const topDifficulty = Object.entries(s.difficultyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    attempted: s.attempted,
    correct: s.correct,
    incorrect: s.incorrect,
    accuracy: s.attempted > 0 ? clampPct((s.correct / s.attempted) * 100) : null,
    practiceSets: s.practiceSets,
    avgTimeSeconds: s.timedQuestions > 0 ? s.timeSeconds / s.timedQuestions : null,
    revisionCount: s.revisionCount,
    revisionAccuracy: s.revisionAttempted > 0 ? clampPct((s.revisionCorrect / s.revisionAttempted) * 100) : null,
    lastPracticed: s.lastPracticed,
    lastRevised: s.lastRevised,
    practiceDifficulty: topDifficulty,
    sessions: s.sessions,
    _weightedCorrect: s.weightedCorrect,
  };
}

/**
 * Mastery = Σ weight_k × component_k / Σ weight_k, with components on a 0–100 scale:
 *   concept     = conceptScoreByStatus[status]
 *   accuracy    = min(100, Σ correct·difficultyMultiplier / attempted × 100) × volume(attempted / targetQuestions)
 *   consistency = 100 × (setsWeight × min(1, sets/targetSets) + recencyWeight × recency(daysSinceLastActivity))
 *   revision    = 100 × min(1, revisions/targetRevisions) × revisionPerformance
 *   speed       = 100 when avg time ≤ target, 0 at target × zeroCreditMultiple (linear between)
 */
export function scoreMastery({ concept, stats, level, cfg, now }) {
  const M = cfg.mastery;
  const att = stats.attempted;
  const target = M.accuracy.targetQuestions[level];
  const ratio = target > 0 ? Math.min(1, att / target) : 1;
  const volume = M.accuracy.volumeCurve === 'linear' ? ratio : Math.sqrt(ratio);
  const accuracy = att > 0 ? clampPct(Math.min(100, (stats._weightedCorrect / att) * 100) * volume) : 0;

  const C = M.consistency;
  const setsPart = Math.min(1, stats.practiceSets / (C.targetPracticeSets[level] || 1));
  const lastActivity = maxDate(stats.lastPracticed, stats.lastRevised);
  const days = daysBetween(lastActivity, now);
  let recency = 0;
  if (days !== null) {
    if (days <= C.fullCreditDays) recency = 1;
    else if (days >= C.zeroCreditDays) recency = 0;
    else recency = 1 - (days - C.fullCreditDays) / (C.zeroCreditDays - C.fullCreditDays);
  }
  const consistency = clampPct(100 * (C.setsWeight * setsPart + C.recencyWeight * recency));

  const R = M.revision;
  const countPart = Math.min(1, stats.revisionCount / (R.targetRevisions || 1));
  const perf = stats.revisionAccuracy !== null ? stats.revisionAccuracy / 100 : (stats.revisionCount > 0 ? R.unknownPerformance : 0);
  const revision = clampPct(100 * countPart * perf);

  const S = M.speed;
  let speed = 0;
  if (stats.avgTimeSeconds !== null) {
    const t = stats.avgTimeSeconds, tgt = S.targetSecondsPerQuestion, zero = tgt * S.zeroCreditMultiple;
    speed = t <= tgt ? 100 : t >= zero ? 0 : clampPct(100 * (1 - (t - tgt) / (zero - tgt)));
  }

  const components = { concept: clampPct(concept), accuracy, consistency, revision, speed };
  const w = M.weights;
  const score = clampPct((Object.keys(components).reduce((a, k) => a + (w[k] ?? 0) * components[k], 0)) / M.weightSum);
  return { score, components };
}
