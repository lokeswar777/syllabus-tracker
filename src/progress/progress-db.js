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

/**
 * Schema history
 *   1  Phase 3: progress, sharedLearning, practice, weightOverrides
 *   2  Phase 4: + syncSettings collection; shared topic records gain concept fields (conceptCompletion, notes,
 *      learningDates, resources, revisions); node records gain `targets`; sessions gain `stageId`, `level`.
 *      Migration 1 → 2 only adds; no existing field is changed or removed.
 */
export const SCHEMA_VERSION = 2;
export const COLLECTIONS = ['progress', 'sharedLearning', 'practice', 'weightOverrides', 'syncSettings'];
export const SYNC_MODES = ['full', 'partial', 'independent'];

export function createEmptyDb(now = new Date()) {
  const t = isoTime(now);
  return {
    progress: { schemaVersion: SCHEMA_VERSION, kind: 'progress', updatedAt: t, settings: { activeExamId: null, sharedLearning: true }, exams: {} },
    sharedLearning: { schemaVersion: SCHEMA_VERSION, kind: 'shared-learning', updatedAt: t, topics: {}, subtopics: {} },
    practice: { schemaVersion: SCHEMA_VERSION, kind: 'practice', updatedAt: t, exams: {} },
    weightOverrides: { schemaVersion: SCHEMA_VERSION, kind: 'weight-overrides', updatedAt: t, exams: {} },
    syncSettings: { schemaVersion: SCHEMA_VERSION, kind: 'sync-settings', updatedAt: t, enabled: true, modes: {} },
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
    targets: null,              // exam-specific preparation targets overriding the mapping defaults:
                                // { depth, depthDescription, difficulty, questionTarget, accuracyTarget, speedTargetSec }
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
  // syncSettings (v2): drop invalid modes instead of failing
  const modes = {};
  for (const [mid, m] of Object.entries(db.syncSettings.modes ?? {})) {
    if (SYNC_MODES.includes(m)) modes[mid] = m; else issues.push(`syncSettings.modes.${mid}: invalid mode '${m}' dropped`);
  }
  db.syncSettings = { ...db.syncSettings, enabled: db.syncSettings.enabled !== false, modes };
  return { db, issues };
}
/** Keeps stored records exactly as saved (no defaults injected); missing fields are treated as defaults when read. */
function cleanRecords(recs, label, issues) {
  const out = {};
  for (const [id, r] of Object.entries(recs ?? {})) {
    if (!r || typeof r !== 'object') { issues.push(`${label}.${id}: dropped (not an object)`); continue; }
    out[id] = { ...r };
  }
  return out;
}

// ───────────────────────── update helpers ─────────────────────────

const EDITABLE = ['status', 'completionOverride', 'masteryOverride', 'difficulty', 'notes', 'startDate', 'completionDate', 'shareLearning', 'targets'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const TARGET_KEYS = ['depth', 'depthDescription', 'difficulty', 'questionTarget', 'accuracyTarget', 'speedTargetSec'];

function checkTargets(t) {
  if (t === null) return;
  if (typeof t !== 'object') throw new TypeError('targets must be an object or null');
  for (const [k, v] of Object.entries(t)) {
    if (!TARGET_KEYS.includes(k)) throw new TypeError(`unknown target '${k}' (allowed: ${TARGET_KEYS.join(', ')})`);
    if (v === null) continue;
    if (k === 'difficulty' && !DIFFICULTIES.includes(v)) throw new TypeError(`targets.difficulty must be one of ${DIFFICULTIES.join(', ')}`);
    if (['questionTarget', 'speedTargetSec'].includes(k) && !(Number.isFinite(v) && v > 0)) throw new RangeError(`targets.${k} must be a positive number`);
    if (k === 'accuracyTarget' && !(Number.isFinite(v) && v >= 0 && v <= 100)) throw new RangeError('targets.accuracyTarget must be 0–100');
    if (['depth', 'depthDescription'].includes(k) && typeof v !== 'string') throw new TypeError(`targets.${k} must be a string`);
  }
}

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
 * Phase 4: this write-back happens only when the topic's sync mode is 'full' (syncModeFor). In 'partial' and
 * 'independent' modes an exam status change never touches shared learning.
 */
export function updateNode(db, { examId, nodeId, patch, cfg, now = new Date(), syncModeFor = () => 'full' }) {
  const kind = nodeKind(nodeId);
  if (!kind) throw new TypeError(`'${nodeId}' is not a topic or subtopic id`);
  for (const k of Object.keys(patch)) if (!EDITABLE.includes(k)) throw new TypeError(`field '${k}' is not editable (editable: ${EDITABLE.join(', ')})`);
  if (patch.status !== undefined && patch.status !== null && !cfg.isStatus(patch.status)) throw new TypeError(`unknown status '${patch.status}'`);
  for (const k of ['completionOverride', 'masteryOverride'])
    if (patch[k] !== undefined && patch[k] !== null && !(Number.isFinite(patch[k]) && patch[k] >= 0 && patch[k] <= 100)) throw new RangeError(`${k} must be null or 0–100`);
  if (patch.difficulty !== undefined && patch.difficulty !== null && !DIFFICULTIES.includes(patch.difficulty)) throw new TypeError(`difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  for (const k of ['startDate', 'completionDate'])
    if (patch[k] != null && !/^\d{4}-\d{2}-\d{2}$/.test(patch[k])) throw new TypeError(`${k} must be YYYY-MM-DD or null`);
  if (patch.targets !== undefined) checkTargets(patch.targets);

  const bucket = kind === 'topic' ? 'topics' : 'subtopics';
  let sharedWrite = null;
  let next = withExam(db, examId, now, (exam) => {
    const prev = exam[bucket][nodeId] ?? createNodeRecord();
    const rec = { ...prev, ...patch, lastUpdated: isoTime(now) };
    if (patch.targets) rec.targets = { ...(prev.targets ?? {}), ...patch.targets };
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
  if (sharedWrite && cfg.sharedLearning.enabled && next.progress.settings.sharedLearning !== false
    && next.syncSettings?.enabled !== false && syncModeFor(topicOf(nodeId)) === 'full')
    next = mergeShared(next, { nodeId, status: sharedWrite, examId, cfg, now });
  return next;
}

/** Concept completion (0–100) a shared record stands for. */
export function conceptPctOf(rec, cfg) {
  if (!rec) return 0;
  if (Number.isFinite(rec.conceptCompletion)) return clampPct(rec.conceptCompletion);
  const cap = cfg.sharedLearning.capScore || 1;
  return rec.status && cfg.isStatus(rec.status) ? clampPct(Math.min(cfg.score(rec.status), cap) / cap * 100) : 0;
}

/**
 * Monotonic merge of conceptual learning into the shared store (never lowers what another exam recorded).
 * Existing concept fields (notes, resources, dates, revisions) are always kept.
 */
function mergeShared(db, { nodeId, status, examId, cfg, now }) {
  const kind = nodeKind(nodeId);
  const bucket = kind === 'topic' ? 'topics' : 'subtopics';
  const capped = cfg.score(status) > cfg.sharedLearning.capScore ? cfg.sharedLearning.maxSharedStatus : status;
  const prev = db.sharedLearning[bucket][nodeId];
  if (cfg.score(capped) === 0) return db;
  if (prev && cfg.score(prev.status) >= cfg.score(capped)) return db;
  const rec = { ...(prev ?? {}), status: capped, updatedAt: isoTime(now), sourceExamId: examId };
  if (kind === 'topic') {
    rec.conceptCompletion = Math.max(conceptPctOf(prev, cfg), conceptPctOf({ status: capped }, cfg));
    rec.learningDates = addDate(prev?.learningDates, isoDate(now));
  }
  return { ...db, sharedLearning: { ...db.sharedLearning, updatedAt: isoTime(now), [bucket]: { ...db.sharedLearning[bucket], [nodeId]: rec } } };
}
const addDate = (list = [], d) => (list.includes(d) ? list : [...list, d].sort());

// ───────────────────────── shared concept learning (Phase 4) ─────────────────────────
const CONCEPT_FIELDS = ['status', 'conceptCompletion', 'notes', 'learningDate'];
const RESOURCE_TYPES = ['book', 'video', 'course', 'notes', 'website', 'test-series', 'other'];

/**
 * Explicit update of a shared concept record (topic level, keyed by the library topic ID of the master topic).
 * Unlike exam-driven writes this may lower values: it is the learner's own record of conceptual learning.
 *   status            concept-phase status (≤ sharedLearning.maxSharedStatus)
 *   conceptCompletion 0–100 (derived from status when omitted, and vice versa)
 *   notes             string
 *   learningDate      YYYY-MM-DD, appended to learningDates
 */
export function updateConcept(db, { topicId, patch, cfg, now = new Date(), examId = null }) {
  if (nodeKind(topicId) !== 'topic') throw new TypeError(`'${topicId}' is not a topic id`);
  for (const k of Object.keys(patch)) if (!CONCEPT_FIELDS.includes(k)) throw new TypeError(`concept field '${k}' is not editable (editable: ${CONCEPT_FIELDS.join(', ')})`);
  const cap = cfg.sharedLearning.capScore;
  if (patch.status != null) {
    if (!cfg.isStatus(patch.status)) throw new TypeError(`unknown status '${patch.status}'`);
    if (cfg.score(patch.status) > cap) throw new RangeError(`concept status cannot exceed '${cfg.sharedLearning.maxSharedStatus}': practising and mastery are exam-specific`);
  }
  if (patch.conceptCompletion != null && !(Number.isFinite(patch.conceptCompletion) && patch.conceptCompletion >= 0 && patch.conceptCompletion <= 100)) throw new RangeError('conceptCompletion must be 0–100');
  if (patch.learningDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(patch.learningDate)) throw new TypeError('learningDate must be YYYY-MM-DD');
  const prev = db.sharedLearning.topics[topicId] ?? {};
  const rec = { ...prev, updatedAt: isoTime(now), sourceExamId: examId ?? prev.sourceExamId ?? null };
  if (patch.status !== undefined) {
    rec.status = patch.status;
    if (patch.conceptCompletion === undefined) rec.conceptCompletion = conceptPctOf({ status: patch.status ?? 'not-started' }, cfg);
  }
  if (patch.conceptCompletion !== undefined) {
    rec.conceptCompletion = patch.conceptCompletion;
    if (patch.status === undefined) rec.status = cfg.statusAtOrBelow((patch.conceptCompletion ?? 0) * cap / 100);
  }
  if (patch.notes !== undefined) rec.notes = String(patch.notes ?? '');
  const scoreNow = conceptPctOf(rec, cfg);
  if (patch.learningDate || (scoreNow > conceptPctOf(prev, cfg))) rec.learningDates = addDate(prev.learningDates, patch.learningDate ?? isoDate(now));
  return { ...db, sharedLearning: { ...db.sharedLearning, updatedAt: isoTime(now), topics: { ...db.sharedLearning.topics, [topicId]: rec } } };
}

export function addConceptResource(db, { topicId, resource, newId, now = new Date() }) {
  if (nodeKind(topicId) !== 'topic') throw new TypeError(`'${topicId}' is not a topic id`);
  if (!resource?.title) throw new TypeError('resource.title is required');
  if (resource.type && !RESOURCE_TYPES.includes(resource.type)) throw new TypeError(`resource.type must be one of ${RESOURCE_TYPES.join(', ')}`);
  const prev = db.sharedLearning.topics[topicId] ?? {};
  const r = { id: resource.id ?? newId(), title: resource.title, type: resource.type ?? 'other', url: resource.url ?? null, note: resource.note ?? '', addedOn: isoDate(now) };
  const rec = { ...prev, resources: [...(prev.resources ?? []), r], updatedAt: isoTime(now) };
  return { ...db, sharedLearning: { ...db.sharedLearning, updatedAt: isoTime(now), topics: { ...db.sharedLearning.topics, [topicId]: rec } } };
}

export function removeConceptResource(db, { topicId, resourceId, now = new Date() }) {
  const prev = db.sharedLearning.topics[topicId];
  if (!prev?.resources?.some((r) => r.id === resourceId)) return db;
  const rec = { ...prev, resources: prev.resources.filter((r) => r.id !== resourceId), updatedAt: isoTime(now) };
  return { ...db, sharedLearning: { ...db.sharedLearning, updatedAt: isoTime(now), topics: { ...db.sharedLearning.topics, [topicId]: rec } } };
}

/** Concept revision (shared): counts toward the concept's revision count, not toward any exam's revision score. */
export function addConceptRevision(db, { topicId, date, note = '', now = new Date() }) {
  if (nodeKind(topicId) !== 'topic') throw new TypeError(`'${topicId}' is not a topic id`);
  const d = date ?? isoDate(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new TypeError('date must be YYYY-MM-DD');
  const prev = db.sharedLearning.topics[topicId] ?? {};
  const rec = { ...prev, revisions: [...(prev.revisions ?? []), { date: d, note }], updatedAt: isoTime(now) };
  return { ...db, sharedLearning: { ...db.sharedLearning, updatedAt: isoTime(now), topics: { ...db.sharedLearning.topics, [topicId]: rec } } };
}

// ───────────────────────── synchronization settings (Phase 4) ─────────────────────────
/** Per master topic sync mode; null removes the user choice (back to the mapping default). */
export function setSyncMode(db, { masterTopicId, mode, now = new Date() }) {
  if (mode !== null && !SYNC_MODES.includes(mode)) throw new TypeError(`sync mode must be one of ${SYNC_MODES.join(', ')} or null`);
  const modes = { ...db.syncSettings.modes };
  if (mode === null) delete modes[masterTopicId]; else modes[masterTopicId] = mode;
  return { ...db, syncSettings: { ...db.syncSettings, updatedAt: isoTime(now), modes } };
}
export function setSyncEnabled(db, { enabled, now = new Date() }) {
  return { ...db, syncSettings: { ...db.syncSettings, updatedAt: isoTime(now), enabled: !!enabled } };
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
    stageId: session.stageId ?? null,   // e.g. prelims / mains / tier1: separates prelims and mains practice
    level: session.level ?? null,       // exam category (ssc / banking): SSC-level vs banking-level practice
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
