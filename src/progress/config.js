/**
 * Compiles and validates the scoring configuration (data/progress/config.json).
 * Pure module with no I/O, so it runs in Node and the browser alike.
 */

export const clampPct = (x) => (Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 0);
export const round2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : 0);

const cache = new WeakMap();

/** Returns a compiled config: lookup maps plus the original values. Throws on invalid config. */
export function compileConfig(config) {
  if (cache.has(config)) return cache.get(config);
  const errors = [];
  const statuses = config?.statuses;
  if (!Array.isArray(statuses) || statuses.length === 0) errors.push('statuses must be a non-empty array');
  const scoreOf = new Map();
  let prev = -Infinity;
  for (const s of statuses ?? []) {
    if (scoreOf.has(s.id)) errors.push(`duplicate status '${s.id}'`);
    if (!(s.score >= 0 && s.score <= 100)) errors.push(`status '${s.id}' score must be within 0–100`);
    if (s.score < prev) errors.push(`status '${s.id}' score must not be lower than the previous status`);
    prev = s.score;
    scoreOf.set(s.id, s.score);
  }
  if (!scoreOf.has('not-started')) errors.push("a 'not-started' status is required");
  const sl = config.sharedLearning ?? {};
  if (sl.enabled && !scoreOf.has(sl.maxSharedStatus)) errors.push(`sharedLearning.maxSharedStatus '${sl.maxSharedStatus}' is not a status`);
  const m = config.mastery ?? {};
  const w = m.weights ?? {};
  for (const k of ['concept', 'accuracy', 'consistency', 'revision', 'speed'])
    if (!(w[k] >= 0)) errors.push(`mastery.weights.${k} must be ≥ 0`);
  const wSum = ['concept', 'accuracy', 'consistency', 'revision', 'speed'].reduce((a, k) => a + (w[k] ?? 0), 0);
  if (!(wSum > 0)) errors.push('mastery weights must not all be 0');
  if (!['exam-only', 'effective'].includes(m.conceptSource)) errors.push("mastery.conceptSource must be 'exam-only' or 'effective'");
  for (const id of scoreOf.keys())
    if (!(m.conceptScoreByStatus?.[id] >= 0 && m.conceptScoreByStatus[id] <= 100)) errors.push(`mastery.conceptScoreByStatus['${id}'] missing or out of range`);
  if (!Array.isArray(m.levels) || !m.levels.length) errors.push('mastery.levels must be a non-empty array');
  if (errors.length) throw new Error(`Invalid progress config:\n - ${errors.join('\n - ')}`);

  const levels = [...m.levels].sort((a, b) => a.min - b.min);
  const compiled = {
    raw: config,
    statuses,
    statusIds: [...scoreOf.keys()],
    isStatus: (id) => scoreOf.has(id),
    score: (id) => scoreOf.get(id) ?? 0,
    statusAtOrBelow(score) {
      let best = 'not-started';
      for (const s of statuses) if (s.score <= score) best = s.id;
      return best;
    },
    classification: config.classification,
    sharedLearning: { enabled: !!sl.enabled, maxSharedStatus: sl.maxSharedStatus, capScore: sl.enabled ? scoreOf.get(sl.maxSharedStatus) : 0 },
    mastery: {
      ...m,
      weightSum: wSum,
      levels,
      conceptScore: (statusId) => m.conceptScoreByStatus[statusId] ?? 0,
      levelFor(score, assessed) {
        if (!assessed) return m.notAssessedLevel?.id ?? 'not-assessed';
        let id = levels[0].id;
        for (const l of levels) if (score >= l.min) id = l.id;
        return id;
      },
    },
  };
  cache.set(config, compiled);
  return compiled;
}

/** Whole days between two dates (UTC calendar days); null if either is missing. */
export function daysBetween(a, b) {
  if (!a || !b) return null;
  const d1 = Date.UTC(...ymd(a)), d2 = Date.UTC(...ymd(b));
  return Math.round((d2 - d1) / 86400000);
}
function ymd(d) {
  const x = d instanceof Date ? d : new Date(d);
  return [x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()];
}
export const isoDate = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
export const isoTime = (d) => (d instanceof Date ? d : new Date(d)).toISOString();
export const maxDate = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));

/** Node kind from a stable library ID: "subject.topic" = topic, "subject.topic.sub" = subtopic. */
export function nodeKind(id) {
  const parts = String(id).split('.');
  return parts.length === 2 ? 'topic' : parts.length === 3 ? 'subtopic' : null;
}
export const topicOf = (subtopicId) => subtopicId.split('.').slice(0, 2).join('.');
