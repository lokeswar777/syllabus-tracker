/** Planner configuration: deep-merge of user overrides onto data/planner/config.json, then validation. */

export const CLASSES = ['Critical', 'High', 'Medium', 'Low'];
export const ACTIONS = ['learn-concept', 'complete-subtopics', 'practice-questions', 'sectional-test', 'revise-notes', 'mock-test'];

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
export function deepMerge(base, over) {
  if (!isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base?.[k]) ? deepMerge(base[k], v) : v;
  return out;
}

/** Returns the effective config or throws with every problem listed. */
export function resolvePlannerConfig(defaults, overrides = {}) {
  const c = deepMerge(defaults, overrides ?? {});
  const errors = [];
  const num = (v, path, { min = -Infinity, max = Infinity, int = false } = {}) => {
    if (!(typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!int || Number.isInteger(v)))) errors.push(`${path} must be a${int ? 'n integer' : ' number'} in [${min}, ${max}] (got ${JSON.stringify(v)})`);
  };
  const w = c.priority?.weights ?? {};
  for (const k of ['learningGap', 'masteryGap', 'untouched', 'revisionDue', 'accuracyGap', 'difficulty']) num(w[k], `priority.weights.${k}`, { min: 0 });
  if (!(Object.values(w).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) > 0)) errors.push('priority.weights must not all be 0');
  const th = c.priority?.classification?.thresholds ?? {};
  let prev = Infinity;
  for (const cls of CLASSES) {
    num(th[cls], `priority.classification.thresholds.${cls}`, { min: 0, max: 100 });
    if (th[cls] > prev) errors.push(`thresholds must decrease from Critical to Low (${cls} = ${th[cls]} > ${prev})`);
    prev = th[cls];
  }
  if (th.Low !== 0) errors.push('priority.classification.thresholds.Low must be 0 so every score gets a class');
  for (const [k, v] of Object.entries(c.priority?.historicalFrequency?.trendScore ?? {})) num(v, `priority.historicalFrequency.trendScore.${k}`, { min: 0, max: 1 });
  num(c.priority?.historicalFrequency?.base, 'priority.historicalFrequency.base', { min: 0, max: 1 });
  num(c.priority?.importance?.gateTopicImportance, 'priority.importance.gateTopicImportance', { min: 0, max: 1 });
  const iv = c.revision?.intervalsDays;
  if (!Array.isArray(iv) || !iv.length) errors.push('revision.intervalsDays must be a non-empty array');
  else iv.forEach((d, i) => num(d, `revision.intervalsDays[${i}]`, { min: 1, max: 3650, int: true }));
  num(c.revision?.studiedAtOrAbove, 'revision.studiedAtOrAbove', { min: 0, max: 100 });
  num(c.dailyPlan?.defaultHours, 'dailyPlan.defaultHours', { min: 0, max: 24 });
  num(c.dailyPlan?.maxTasks, 'dailyPlan.maxTasks', { min: 1, max: 100, int: true });
  num(c.dailyPlan?.revisionMaxShare, 'dailyPlan.revisionMaxShare', { min: 0, max: 1 });
  num(c.priority?.examUrgency?.horizonDays, 'priority.examUrgency.horizonDays', { min: 1 });
  if (errors.length) throw new Error(`Invalid planner config:\n - ${errors.join('\n - ')}`);
  return c;
}

export const classify = (score, cfg) => CLASSES.find((cls) => score >= cfg.priority.classification.thresholds[cls]) ?? 'Low';
export const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
export const round2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : 0);
export const isoDate = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
export const addDays = (date, n) => isoDate(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000));
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const maxDate = (...ds) => ds.filter(Boolean).sort().at(-1) ?? null;
