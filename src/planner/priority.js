/**
 * Preparation priority scoring (pure).
 *
 * PER EXAM e, TOPIC t  (all factors in 0–1)
 *   I   importance       = √(effectiveWeight / heaviest topic weight in e)        (gate-only topics: gateTopicImportance)
 *   F   history          = trendScore[Phase-2 trend]                               (how reliably it is asked)
 *   I'  = I × (base + (1 − base) × F)
 *   G   learning gap     = 1 − completion/100
 *   M   mastery gap      = 1 − mastery/100
 *   U0  untouched        = 1 if completion = 0 else 0
 *   R   revision due     = overdue: min(1, 0.5 + 0.5·daysOverdue/interval); due today 0.5; due soon 0.25; else 0
 *   A   accuracy gap     = max(0, (target − recent accuracy)/target)   (only with ≥ minQuestions recent questions)
 *   D   difficulty       = difficultyScore[exam-specific difficulty]
 *
 *   score_e = 100 × ( wL·I'·G + wM·I'·M + wU·I'·U0 + wR·R·(0.5 + 0.5·I') + wA·I'·A + wD·D·max(G, M) ) / Σw
 *   Final stretch (≤ N days to the exam): wR × revisionWeightFactor; wU × lowImportanceUntouchedFactor when I < lowImportanceBelow.
 *
 * MULTIPLE TARGET EXAMS
 *   share_e   = importance_e × (1 + urgencyBoost × urgency_e) / Σ (…)      (urgency from the exam date)
 *   combined  = Σ_e share_e × score_e   (score_e = 0 when the topic is not in exam e)
 *   This is a share-weighted average, not a sum: a topic cannot outscore its best per-exam score, so
 *   appearing in many exams only helps in proportion to its real weight in each of them.
 */
import { clamp01, round2, classify, daysBetween } from './config.js';
import { computeRevision, sessionStats } from './revision.js';

export function examShares(targets, today, cfg) {
  const U = cfg.priority.examUrgency;
  const rows = targets.map((t) => {
    const daysLeft = t.examDate ? daysBetween(today, t.examDate) : null;
    const urgency = daysLeft === null ? 0 : daysLeft < 0 ? 0 : clamp01(1 - daysLeft / U.horizonDays);
    return { examId: t.examId, importance: t.importance, examDate: t.examDate ?? null, daysLeft, urgency, past: daysLeft !== null && daysLeft < 0, raw: daysLeft !== null && daysLeft < 0 ? 0 : t.importance * (1 + U.urgencyBoost * urgency) };
  });
  const sum = rows.reduce((a, r) => a + r.raw, 0);
  return rows.map((r) => ({ ...r, share: sum > 0 ? r.raw / sum : 0 }));
}

/** Score one topic in one exam. */
export function scoreExamTopic({ topic, exam, revision, recent, cfg }) {
  const P = cfg.priority;
  const gateOnly = topic.isGateOnly || topic.effectiveWeight === 0;
  const I = gateOnly ? P.importance.gateTopicImportance : clamp01(Math.sqrt(topic.effectiveWeight / (exam.maxWeight || 1)));
  const trend = topic.trend ?? 'unknown';
  const F = P.historicalFrequency.trendScore[trend] ?? P.historicalFrequency.trendScore.unknown;
  const Ip = I * (P.historicalFrequency.base + (1 - P.historicalFrequency.base) * F);
  const G = clamp01(1 - topic.completion / 100);
  const M = clamp01(1 - topic.mastery / 100);
  const U0 = topic.completion === 0 ? 1 : 0;
  let R = 0;
  if (revision.status === 'overdue') R = clamp01(0.5 + 0.5 * revision.daysOverdue / Math.max(1, revision.intervalDays));
  else if (revision.status === 'due-today') R = 0.5;
  else if (revision.status === 'due-soon') R = 0.25;
  const req = topic.requirement ?? {};
  const accTarget = req.accuracyTarget ?? 80;
  const A = recent.recentAccuracy !== null && recent.recentAttempted >= P.accuracy.minQuestions ? clamp01((accTarget - recent.recentAccuracy) / accTarget) : 0;
  const difficulty = req.difficulty ?? topic.targetDifficulty ?? 'unknown';
  const D = P.difficultyScore[difficulty] ?? P.difficultyScore.unknown;

  const w = { ...P.weights };
  const fs = cfg.priority.finalStretch;
  const finalStretch = exam.daysLeft !== null && exam.daysLeft >= 0 && exam.daysLeft <= fs.days;
  if (finalStretch) {
    w.revisionDue *= fs.revisionWeightFactor;
    if (I < fs.lowImportanceBelow) w.untouched *= fs.lowImportanceUntouchedFactor;
  }
  const f = { learningGap: Ip * G, masteryGap: Ip * M, untouched: Ip * U0, revisionDue: R * (0.5 + 0.5 * Ip), accuracyGap: Ip * A, difficulty: D * Math.max(G, M) };
  const wSum = Object.values(w).reduce((a, b) => a + b, 0);
  const contributions = Object.fromEntries(Object.keys(f).map((k) => [k, (100 * w[k] * f[k]) / wSum]));
  const score = Math.min(100, Math.max(0, Object.values(contributions).reduce((a, b) => a + b, 0)));
  return {
    score,
    factors: { importance: I, history: F, adjustedImportance: Ip, learningGap: G, masteryGap: M, untouched: U0, revisionDue: R, accuracyGap: A, difficulty: D },
    contributions,
    context: { trend, difficulty, accuracyTarget: accTarget, recentAccuracy: recent.recentAccuracy, finalStretch, gateOnly },
  };
}

/** Suggested next action for a topic in an exam (explainable rule list, first match wins). */
export function suggestAction({ topic, revision, subtopics = [], cfg }) {
  const req = topic.requirement ?? {};
  const pending = subtopics.filter((s) => s.completion < 50);
  if (['overdue', 'due-today'].includes(revision.status))
    return { action: 'revise-notes', detail: `Revision ${revision.revisionNumber} ${revision.status === 'overdue' ? `overdue by ${revision.daysOverdue} day(s)` : 'due today'}: revise notes and key formulas.` };
  if (topic.completion === 0) return { action: 'learn-concept', detail: 'Not started: learn the concept first.' };
  if (topic.completion < 50) return { action: 'learn-concept', detail: `Concept ${round2(topic.completion * 2)}% learned: finish the concept.` };
  if (pending.length && topic.completion < cfg.priority.exclude.completedAndMasteredAtOrAbove)
    return { action: 'complete-subtopics', detail: `Complete pending subtopics: ${pending.slice(0, 4).map((s) => s.name).join(', ')}${pending.length > 4 ? ` +${pending.length - 4} more` : ''}.`, pendingSubtopics: pending.map((s) => s.id) };
  const tm = topic.targetsMet;
  if (req.questionTarget != null && (topic.attempted ?? 0) < req.questionTarget)
    return { action: 'practice-questions', detail: `Solve ${req.questionTarget - (topic.attempted ?? 0)} more questions at ${req.depth ?? 'exam'} level${req.accuracyTarget ? ` (≥ ${req.accuracyTarget}% accuracy` : ''}${req.speedTargetSec ? `, ≤ ${req.speedTargetSec} s each)` : req.accuracyTarget ? ')' : ''}.` };
  if (tm && !tm.all) return { action: 'practice-questions', detail: `Targeted practice to close: ${tm.gaps.map((g) => `${g.target} ${g.have ?? '–'} → ${g.need}`).join('; ')}.` };
  if (topic.mastery >= cfg.actions.sectionalTest.topicMasteryAtOrAbove) return { action: 'sectional-test', detail: 'Targets met: take a sectional test to confirm under exam timing.' };
  return { action: 'practice-questions', detail: 'Keep practising to raise mastery.' };
}

const pct = (x) => `${round2(x)}%`;
/** Human-readable reasons from the largest contributions (explainability). */
export function reasonsFor({ topic, examName, scored, revision }) {
  const c = scored.contributions;
  const out = [];
  const ranked = Object.entries(c).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]);
  for (const [k] of ranked.slice(0, 3)) {
    if (k === 'learningGap') out.push(`${scored.factors.importance >= 0.6 ? 'High' : scored.factors.importance >= 0.35 ? 'Moderate' : 'Low'} weightage (${pct(topic.effectiveWeight)} of ${examName}) with ${pct(topic.completion)} syllabus completion`);
    if (k === 'masteryGap') out.push(topic.attempted ? `Exam mastery only ${pct(topic.mastery)} after ${topic.attempted} questions` : `No ${examName} practice yet (mastery ${pct(topic.mastery)})`);
    if (k === 'untouched') out.push(`Important topic not studied yet${topic.priority ? ` (Phase-2 priority ${topic.priority})` : ''}`);
    if (k === 'revisionDue') out.push(revision.status === 'overdue' ? `Revision overdue by ${revision.daysOverdue} day(s)` : `Revision ${revision.status.replace('-', ' ')}`);
    if (k === 'accuracyGap') out.push(`Recent accuracy ${pct(scored.context.recentAccuracy)} vs target ${scored.context.accuracyTarget}%`);
    if (k === 'difficulty') out.push(`${scored.context.difficulty} difficulty for ${examName}`);
  }
  if (scored.context.trend === 'consistent' && scored.factors.importance >= 0.35) out.push('Asked consistently in previous papers');
  if (scored.context.finalStretch) out.push(`Final stretch before ${examName}: revision weighted up`);
  return out;
}

/**
 * Score every topic of every target exam and combine.
 * @param {object} p
 * @param {object} p.reports   { examId: progress report } (engine.getCrossExamReports)
 * @param {object} p.sessions  { examId: practice sessions }
 * @param {object[]} p.shares  examShares(...)
 */
export function computePriorities({ reports, sessions, shares, cfg, today }) {
  const perExam = {};
  const combined = new Map();
  for (const sh of shares) {
    const rep = reports[sh.examId];
    if (!rep) continue;
    const topics = Object.values(rep.topics).filter((t) => t.inScope);
    const maxWeight = Math.max(...topics.map((t) => t.effectiveWeight), 0);
    const secName = {};
    for (const st of rep.stages) for (const s of st.sections) secName[s.key] = s.name;
    const bySession = groupSessions(sessions[sh.examId] ?? []);
    const exam = { examId: sh.examId, name: rep.shortName, maxWeight, daysLeft: sh.daysLeft };
    const rows = {};
    for (const t of topics) {
      const sess = [...(bySession.get(t.topicId) ?? []), ...t.subtopicIds.flatMap((id) => bySession.get(id) ?? [])];
      const recent = recentStats(sess, cfg);
      const revision = revisionFor(t, sess, cfg, today);
      const scored = scoreExamTopic({ topic: t, exam, revision, recent, cfg });
      const subs = t.subtopicIds.map((id) => rep.subtopics[id]).filter(Boolean);
      const action = suggestAction({ topic: t, revision, subtopics: subs, cfg });
      const occ = [...t.occurrences].sort((a, b) => b.weightInExam - a.weightInExam)[0];
      const done = t.completion >= cfg.priority.exclude.completedAndMasteredAtOrAbove && t.mastery >= cfg.priority.exclude.completedAndMasteredAtOrAbove && !['overdue', 'due-today'].includes(revision.status);
      rows[t.topicId] = {
        examId: sh.examId, examName: rep.shortName, topicId: t.topicId, name: t.name, subject: t.subject,
        section: occ ? { key: occ.sectionKey, name: secName[occ.sectionKey] ?? occ.sectionKey } : null,
        effectiveWeight: t.effectiveWeight, completion: t.completion, mastery: t.mastery, priorityClassPhase2: t.priority,
        score: round2(scored.score), classification: classify(scored.score, cfg), done,
        factors: mapRound(scored.factors, 3), contributions: mapRound(scored.contributions, 2), context: scored.context,
        reasons: reasonsFor({ topic: t, examName: rep.shortName, scored, revision }),
        action, revision, masterTopicId: t.masterTopicId, attempted: t.attempted, accuracy: t.accuracy, avgTimeSeconds: t.avgTimeSeconds,
        requirement: t.requirement, targetsMet: t.targetsMet,
      };
      if (!combined.has(t.topicId)) combined.set(t.topicId, []);
      combined.get(t.topicId).push({ share: sh.share, row: rows[t.topicId] });
    }
    perExam[sh.examId] = rows;
  }
  const topics = [...combined.entries()].map(([topicId, list]) => {
    const score = Math.min(100, list.reduce((a, x) => a + x.share * x.row.score, 0));
    const primary = [...list].sort((a, b) => b.share * b.row.score - a.share * a.row.score)[0].row;
    return {
      topicId, name: primary.name, subject: primary.subject, masterTopicId: primary.masterTopicId,
      score: round2(score), classification: classify(score, cfg),
      exams: list.map((x) => x.row.examId), examCount: list.length, primaryExamId: primary.examId,
      done: list.every((x) => x.row.done),
      perExam: Object.fromEntries(list.map((x) => [x.row.examId, { share: round2(x.share), contribution: round2(x.share * x.row.score), ...x.row }])),
    };
  }).sort((a, b) => b.score - a.score || a.topicId.localeCompare(b.topicId));
  return { topics, perExam };
}

function groupSessions(sessions) {
  const m = new Map();
  for (const s of sessions) { if (!m.has(s.nodeId)) m.set(s.nodeId, []); m.get(s.nodeId).push(s); }
  return m;
}
const recentStats = (sess, cfg) => sessionStats(sess, cfg.priority.accuracy.recentSessions);
const revisionFor = (t, sess, cfg, today) => computeRevision({ topic: t, sessions: sess, cfg, today });
const mapRound = (o, d) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10 ** d) / 10 ** d]));
