/**
 * Progress database: four independent collections, each persisted separately.
 *
 *   progress        exam-specific progress (status, notes, dates, settings) per exam
 *   sharedLearning  conceptual learning shared across exams, keyed by stable library IDs
 *   practice        practice sessions per exam (questions, accuracy, time, difficulty, revision)
 *   weightOverrides user custom weights per exam (weightage layer; never mixed into progress)
 *
 * All functions are pure: they return a new db and never mutate the input (React-friendly).
 * Syllabus and weightage data are never stored here; only their stable IDs are referenced.
 */
import { isoTime, isoDate, nodeKind, topicOf, clampPct } from './config.js';

export const SCHEMA_VERSION = 1;
export const COLLECTIONS = ['progress', 'sharedLearning', 'practice', 'weightOverrides'];

export function createEmptyDb(now = new Date()) {
  const t = isoTime(now);
  return {
    progress: { schemaVersion: SCHEMA_VERSION, kind: 'progress', updatedAt: t, settings: { activeExamId: null, sharedLearning: true }, exams: {} },
    sharedLearning: { schemaVersion: SCHEMA_VERSION, kind: 'shared-learning', updatedAt: t, topics: {}, subtopics: {} },
    practice: { schemaVersion: SCHEMA_VERSION, kind: 'practice', updatedAt: t, exams: {} },
    weightOverrides: { schemaVersion: SCHEMA_VERSION, kind: 'weight-overrides', updatedAt: t, exams: {} },
  };
}

export function createExamProgress(examId, now = new Date()) {
  const t = isoTime(now);
  return { examId, trackId: null, stageId: null, choices: {}, createdAt: t, updatedAt: t, topics: {}, subtopics: {} };
}

/** Default shape of a topic/subtopic record (exam-specific). Absent fields mean "not set". */
export function createNodeRecord() {
  return {
    status: null,               // status id from config; null = not set (inherits topic status for subtopics)
    completionOverride: null,   // manual syllabus-completion score 0–100 (overrides the status score)
    masteryOverride: null,      // manual mastery score 0–100 (overrides the computed mastery)
    difficulty: null,           // exam-specific target difficulty: easy | medium | hard
    notes: '',
    startDate: null,            // YYYY-MM-DD (set automatically when the status first leaves not-started)
    completionDate: null,       // YYYY-MM-DD (set automatically on reaching the completed threshold)
    lastUpdated: null,          // ISO timestamp of the last change to this record
    shareLearning: true,        // false = this exam neither reads nor writes shared learning for the node
    revisions: [],              // manual revision log [{ date, note }] (revisions done without a question set)
    manualStats: null,          // manual practice totals added to logged sessions (see setPracticeTotals)
  };
}

/**
 * Normalise a loaded (possibly partial/old/corrupted) db: fills missing collections and drops
 * malformed entries instead of throwing, so a bad record never wipes the rest of the progress.
 */
export function normalizeDb(raw, now = new Date()) {
  const base = createEmptyDb(now);
  const db = { ...base };
  const issues = [];
  for (const key of COLLECTIONS) {
    const c = raw?.[key];
    if (!c || typeof c !== 'object') { if (raw && raw[key] !== undefined) issues.push(`${key}: invalid collection replaced with an empty one`); continue; }
    if (c.schemaVersion > SCHEMA_VERSION) issues.push(`${key}: schemaVersion ${c.schemaVersion} is newer than supported ${SCHEMA_VERSION}; loading read-compatible fields`);
    db[key] = { ...base[key], ...c, schemaVersion: SCHEMA_VERSION };
  }
  // progress
  const exams = {};
  for (const [id, e] of Object.entries(db.progress.exams ?? {})) {
    if (!e || typeof e !== 'object') { issues.push(`progress.exams.${id}: dropped (not an object)`); continue; }
    exams[id] = { ...createExamProgress(id, now), ...e, examId: id, topics: cleanRecords(e.topics, `progress.${id}.topics`, issues), subtopics: cleanRecords(e.subtopics, `progress.${id}.subtopics`, issues) };
  }
  db.progress = { ...db.progress, settings: { ...base.progress.settings, ...(db.progress.settings ?? {}) }, exams };
  // practice
  const pe = {};
  for (const [id, e] of Object.entries(db.practice.exams ?? {})) {
    const sessions = Array.isArray(e?.sessions) ? e.sessions.filter((s) => {
      const ok = s && typeof s.nodeId === 'string' && Number.isFinite(s.attempted) && Number.isFinite(s.correct) && s.correct <= s.attempted && s.attempted >= 0;
      if (!ok) issues.push(`practice.${id}: dropped malformed session ${s?.id ?? ''}`);
      return ok;
    }) : [];
    pe[id] = { sessions };
  }
  db.practice = { ...db.practice, exams: pe };
  db.sharedLearning = { ...db.sharedLearning, topics: { ...(db.sharedLearning.topics ?? {}) }, subtopics: { ...(db.sharedLearning.subtopics ?? {}) } };
  db.weightOverrides = { ...db.weightOverrides, exams: { ...(db.weightOverrides.exams ?? {}) } };
  return { db, issues };
}
function cleanRecords(recs, label, issues) {
  const out = {};
  for (const [id, r] of Object.entries(recs ?? {})) {
    if (!r || typeof r !== 'object') { issues.push(`${label}.${id}: dropped (not an object)`); continue; }
    out[id] = { ...createNodeRecord(), ...r };
  }
  return out;
}

// ───────────────────────── update helpers ─────────────────────────

const EDITABLE = ['status', 'completionOverride', 'masteryOverride', 'difficulty', 'notes', 'startDate', 'completionDate', 'shareLearning'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];

function withExam(db, examId, now, fn) {
  const exam = db.progress.exams[examId] ?? createExamProgress(examId, now);
  const next = fn(exam);
  return { ...db, progress: { ...db.progress, updatedAt: isoTime(now), exams: { ...db.progress.exams, [examId]: { ...next, updatedAt: isoTime(now) } } } };
}

/**
 * Update any subset of a topic/subtopic record's fields independently.
 * Automatic bookkeeping (only when not provided in the same patch):
 *   startDate      ← today, when the status first moves above not-started
 *   completionDate ← today, when the status reaches the completed threshold; cleared when it drops below
 *   lastUpdated    ← now, on every change
 * Shared learning: when the status changes and sharing is enabled for the node, the conceptual part of the
 * status (capped at sharedLearning.maxSharedStatus) is merged into the shared store, and it only ever increases.
 */
export function updateNode(db, { examId, nodeId, patch, cfg, now = new Date() }) {
  const kind = nodeKind(nodeId);
  if (!kind) throw new TypeError(`'${nodeId}' is not a topic or subtopic id`);
  for (const k of Object.keys(patch)) if (!EDITABLE.includes(k)) throw new TypeError(`field '${k}' is not editable (editable: ${EDITABLE.join(', ')})`);
  if (patch.status !== undefined && patch.status !== null && !cfg.isStatus(patch.status)) throw new TypeError(`unknown status '${patch.status}'`);
  for (const k of ['completionOverride', 'masteryOverride'])
    if (patch[k] !== undefined && patch[k] !== null && !(Number.isFinite(patch[k]) && patch[k] >= 0 && patch[k] <= 100)) throw new RangeError(`${k} must be null or 0–100`);
  if (patch.difficulty !== undefined && patch.difficulty !== null && !DIFFICULTIES.includes(patch.difficulty)) throw new TypeError(`difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  for (const k of ['startDate', 'completionDate'])
    if (patch[k] != null && !/^\d{4}-\d{2}-\d{2}$/.test(patch[k])) throw new TypeError(`${k} must be YYYY-MM-DD or null`);

  const bucket = kind === 'topic' ? 'topics' : 'subtopics';
  let sharedWrite = null;
  let next = withExam(db, examId, now, (exam) => {
    const prev = exam[bucket][nodeId] ?? createNodeRecord();
    const rec = { ...prev, ...patch, lastUpdated: isoTime(now) };
    if (patch.status !== undefined) {
      const score = cfg.score(patch.status ?? 'not-started');
      if (score > 0 && !rec.startDate && patch.startDate === undefined) rec.startDate = isoDate(now);
      const done = score >= cfg.classification.completedAtOrAbove;
      if (done && !rec.completionDate && patch.completionDate === undefined) rec.completionDate = isoDate(now);
      if (!done && patch.completionDate === undefined) rec.completionDate = null;
      const topicShare = kind === 'subtopic' ? exam.topics[topicOf(nodeId)]?.shareLearning !== false : true;
      if (rec.shareLearning !== false && topicShare && patch.status) sharedWrite = patch.status;
    }
    return { ...exam, [bucket]: { ...exam[bucket], [nodeId]: rec } };
  });
  if (sharedWrite && cfg.sharedLearning.enabled && next.progress.settings.sharedLearning !== false)
    next = mergeShared(next, { nodeId, status: sharedWrite, examId, cfg, now });
  return next;
}

/** Monotonic merge of conceptual learning into the shared store (never lowers what another exam recorded). */
function mergeShared(db, { nodeId, status, examId, cfg, now }) {
  const kind = nodeKind(nodeId);
  const bucket = kind === 'topic' ? 'topics' : 'subtopics';
  const capped = cfg.score(status) > cfg.sharedLearning.capScore ? cfg.sharedLearning.maxSharedStatus : status;
  const prev = db.sharedLearning[bucket][nodeId];
  if (prev && cfg.score(prev.status) >= cfg.score(capped)) return db;
  if (cfg.score(capped) === 0) return db;
  return {
    ...db,
    sharedLearning: {
      ...db.sharedLearning, updatedAt: isoTime(now),
      [bucket]: { ...db.sharedLearning[bucket], [nodeId]: { status: capped, updatedAt: isoTime(now), sourceExamId: examId } },
    },
  };
}

/** Explicitly set (or clear with null) a shared conceptual status. This is the only way to lower it. */
export function setSharedStatus(db, { nodeId, status, cfg, now = new Date() }) {
  const kind = nodeKind(nodeId);
  if (!kind) throw new TypeError(`'${nodeId}' is not a topic or subtopic id`);
  if (status !== null && !cfg.isStatus(status)) throw new TypeError(`unknown status '${status}'`);
  if (status !== null && cfg.score(status) > cfg.sharedLearning.capScore) throw new RangeError(`shared status cannot exceed '${cfg.sharedLearning.maxSharedStatus}'`);
  const bucket = kind === 'topic' ? 'topics' : 'subtopics';
  const map = { ...db.sharedLearning[bucket] };
  if (status === null) delete map[nodeId];
  else map[nodeId] = { status, updatedAt: isoTime(now), sourceExamId: null };
  return { ...db, sharedLearning: { ...db.sharedLearning, updatedAt: isoTime(now), [bucket]: map } };
}

export function addRevision(db, { examId, nodeId, date, note = '', now = new Date() }) {
  if (!nodeKind(nodeId)) throw new TypeError(`'${nodeId}' is not a topic or subtopic id`);
  const d = date ?? isoDate(now);
  const bucket = nodeKind(nodeId) === 'topic' ? 'topics' : 'subtopics';
  return withExam(db, examId, now, (exam) => {
    const prev = exam[bucket][nodeId] ?? createNodeRecord();
    return { ...exam, [bucket]: { ...exam[bucket], [nodeId]: { ...prev, revisions: [...(prev.revisions ?? []), { date: d, note }], lastUpdated: isoTime(now) } } };
  });
}

/** Append a practice session (exam-specific; never shared). */
export function recordPractice(db, { examId, nodeId, session, newId, now = new Date() }) {
  if (!nodeKind(nodeId)) throw new TypeError(`'${nodeId}' is not a topic or subtopic id`);
  const { attempted, correct } = session;
  if (!(Number.isInteger(attempted) && attempted >= 0)) throw new RangeError('attempted must be an integer ≥ 0');
  if (!(Number.isInteger(correct) && correct >= 0 && correct <= attempted)) throw new RangeError('correct must be an integer between 0 and attempted');
  if (session.incorrect != null && !(Number.isInteger(session.incorrect) && session.incorrect >= 0 && correct + session.incorrect <= attempted)) throw new RangeError('incorrect must be an integer and correct + incorrect ≤ attempted');
  if (session.timeSeconds != null && !(Number.isFinite(session.timeSeconds) && session.timeSeconds >= 0)) throw new RangeError('timeSeconds must be ≥ 0');
  if (session.difficulty != null && !DIFFICULTIES.includes(session.difficulty)) throw new TypeError(`difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  const s = {
    id: session.id ?? newId(),
    nodeId,
    date: session.date ?? isoDate(now),
    attempted,
    correct,
    incorrect: session.incorrect ?? attempted - correct,
    timeSeconds: session.timeSeconds ?? null,
    difficulty: session.difficulty ?? null,
    practiceSet: session.practiceSet !== false,
    revision: !!session.revision,
    note: session.note ?? '',
    createdAt: isoTime(now),
  };
  const exam = db.practice.exams[examId] ?? { sessions: [] };
  const touched = withExam(db, examId, now, (e) => e); // keep exam progress timestamp in sync
  return { ...touched, practice: { ...db.practice, updatedAt: isoTime(now), exams: { ...db.practice.exams, [examId]: { sessions: [...exam.sessions, s] } } } };
}

export function deletePractice(db, { examId, sessionId, now = new Date() }) {
  const exam = db.practice.exams[examId];
  if (!exam) return db;
  return { ...db, practice: { ...db.practice, updatedAt: isoTime(now), exams: { ...db.practice.exams, [examId]: { sessions: exam.sessions.filter((s) => s.id !== sessionId) } } } };
}

/**
 * Set the displayed totals for a node directly (questions attempted/correct/etc.), independently of logged sessions.
 * Stored as `manualStats` = desired totals − totals of the node's own logged sessions, so later sessions still add on.
 */
export function setPracticeTotals(db, { examId, nodeId, totals, now = new Date() }) {
  const kind = nodeKind(nodeId);
  if (!kind) throw new TypeError(`'${nodeId}' is not a topic or subtopic id`);
  const own = (db.practice.exams[examId]?.sessions ?? []).filter((s) => s.nodeId === nodeId);
  const sum = (k, f = (s) => s[k] ?? 0) => own.reduce((a, s) => a + f(s), 0);
  const base = {
    attempted: sum('attempted'), correct: sum('correct'), incorrect: sum('incorrect'),
    practiceSets: own.filter((s) => s.practiceSet !== false).length, revisionCount: own.filter((s) => s.revision).length,
    totalTimeSeconds: sum('timeSeconds'),
  };
  const m = {};
  for (const [k, v] of Object.entries(totals)) {
    if (k === 'lastPracticed') { m.lastPracticed = v; continue; }
    if (!(k in base)) throw new TypeError(`unknown total '${k}'`);
    if (!(Number.isFinite(v) && v >= 0)) throw new RangeError(`${k} must be ≥ 0`);
    if (v < base[k]) throw new RangeError(`${k} (${v}) cannot be lower than the logged sessions' total (${base[k]}); delete sessions instead`);
    m[k] = v - base[k];
  }
  const att = (base.attempted + (m.attempted ?? 0)), cor = (base.correct + (m.correct ?? 0));
  if (cor > att) throw new RangeError('correct cannot exceed attempted');
  const bucket = kind === 'topic' ? 'topics' : 'subtopics';
  return withExam(db, examId, now, (exam) => {
    const prev = exam[bucket][nodeId] ?? createNodeRecord();
    return { ...exam, [bucket]: { ...exam[bucket], [nodeId]: { ...prev, manualStats: { ...(prev.manualStats ?? {}), ...m }, lastUpdated: isoTime(now) } } };
  });
}

export function setExamSettings(db, { examId, settings, now = new Date() }) {
  const allowed = ['trackId', 'stageId', 'choices'];
  for (const k of Object.keys(settings)) if (!allowed.includes(k)) throw new TypeError(`unknown exam setting '${k}'`);
  return withExam(db, examId, now, (exam) => ({ ...exam, ...settings, choices: settings.choices ? { ...exam.choices, ...settings.choices } : exam.choices }));
}

export function setWeightOverride(db, { examId, key, value, now = new Date() }) {
  if (value !== null && !(Number.isFinite(value) && value >= 0)) throw new RangeError('weight override must be null or a number ≥ 0');
  const cur = { ...(db.weightOverrides.exams[examId] ?? {}) };
  if (value === null) delete cur[key]; else cur[key] = value;
  return { ...db, weightOverrides: { ...db.weightOverrides, updatedAt: isoTime(now), exams: { ...db.weightOverrides.exams, [examId]: cur } } };
}

export const clampScore = clampPct;
