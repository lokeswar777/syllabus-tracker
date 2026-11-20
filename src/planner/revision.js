/**
 * Revision tracker (per exam, per topic). Spaced-repetition schedule with editable intervals.
 *
 *   studied        own (exam-specific) completion ≥ revision.studiedAtOrAbove, or any practice/revision logged
 *   lastStudied    latest of: last practice, last revision, completion date, start date
 *   revisionCount  confirmed revisions only = manual revision entries + practice sessions marked `revision`
 *                  (from the progress engine; a status change is never counted as a revision)
 *   next due       (lastRevised ?? lastStudied) + intervalsDays[min(revisionCount, n − 1)]
 *                  interval × lowAccuracy.intervalFactor when the previous test accuracy is below lowAccuracy.below
 */
import { addDays, daysBetween, maxDate, round2 } from './config.js';

/** Most recent session accuracy (previous test accuracy) and recent-window accuracy for a topic subtree. */
export function sessionStats(sessions, recentN = 3) {
  const withQ = sessions.filter((s) => s.attempted > 0).sort((a, b) => (a.date + (a.createdAt ?? '')).localeCompare(b.date + (b.createdAt ?? '')));
  const acc = (list) => { const att = list.reduce((a, s) => a + s.attempted, 0); return att ? (list.reduce((a, s) => a + s.correct, 0) / att) * 100 : null; };
  const last = withQ.at(-1);
  const recent = withQ.slice(-recentN);
  const earlier = withQ.slice(-2 * recentN, -recentN);
  return {
    previousAccuracy: last ? round2((last.correct / last.attempted) * 100) : null,
    recentAccuracy: recent.length ? round2(acc(recent)) : null,
    recentAttempted: recent.reduce((a, s) => a + s.attempted, 0),
    earlierAccuracy: earlier.length ? round2(acc(earlier)) : null,
    incorrect: withQ.reduce((a, s) => a + (s.incorrect ?? s.attempted - s.correct), 0),
    sessions: withQ.length,
  };
}

export function computeRevision({ topic, sessions = [], cfg, today }) {
  const R = cfg.revision;
  const own = topic.ownCompletion ?? topic.completion ?? 0;
  const studied = own >= R.studiedAtOrAbove || (topic.attempted ?? 0) > 0 || (topic.revisionCount ?? 0) > 0;
  const lastStudied = maxDate(topic.lastPracticed, topic.lastRevised, topic.completionDate, topic.startDate);
  const ss = sessionStats(sessions, cfg.priority.accuracy.recentSessions);
  const base = {
    studied, lastStudied, lastRevised: topic.lastRevised ?? null, revisionCount: topic.revisionCount ?? 0,
    previousAccuracy: ss.previousAccuracy, mastery: topic.mastery ?? 0,
  };
  if (!studied || !lastStudied) return { ...base, status: studied ? 'unscheduled' : 'not-studied', nextDue: null, intervalDays: null, daysOverdue: 0, daysUntilDue: null };
  const iv = R.intervalsDays;
  const idx = Math.min(base.revisionCount, iv.length - 1);
  let interval = iv[idx];
  const lowAcc = ss.previousAccuracy !== null && ss.previousAccuracy < R.lowAccuracy.below;
  if (lowAcc) interval = Math.max(1, Math.ceil(interval * R.lowAccuracy.intervalFactor));
  const anchor = base.lastRevised ?? lastStudied;
  const nextDue = addDays(anchor, interval);
  const until = daysBetween(today, nextDue);
  const status = until < 0 ? 'overdue' : until === 0 ? 'due-today' : until <= R.dueSoonDays ? 'due-soon' : 'scheduled';
  return {
    ...base, status, nextDue, intervalDays: interval, revisionNumber: base.revisionCount + 1,
    intervalShortenedForLowAccuracy: lowAcc, anchor, daysOverdue: Math.max(0, -until), daysUntilDue: Math.max(0, until),
  };
}
