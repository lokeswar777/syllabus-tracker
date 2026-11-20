/**
 * Backup file format, validation and safe merge (Phase 7). Pure functions: no storage access.
 *
 * File (formatVersion 2; formatVersion 1 = Phase 6 export, still accepted):
 *   { format, formatVersion, app, exportedAt, schema: { collections }, mapping, summary, collections, checksum }
 *   checksum = "sha256:<hex>" of JSON.stringify(collections), when the browser offers SubtleCrypto.
 */
export const BACKUP_FORMAT = 'syllabus-tracker-export';
export const BACKUP_FORMAT_VERSION = 2;
export const SUPPORTED_FORMAT_VERSIONS = [1, 2];
export const APP_VERSION = '0.7.0';

/** Collection → expected `kind` and highest schemaVersion this app understands. */
export const COLLECTION_RULES: Record<string, { kind?: string; maxSchema: number; required?: boolean }> = {
  progress: { kind: 'progress', maxSchema: 2, required: true },
  sharedLearning: { kind: 'shared-learning', maxSchema: 2 },
  practice: { kind: 'practice', maxSchema: 2 },
  weightOverrides: { kind: 'weight-overrides', maxSchema: 2 },
  syncSettings: { kind: 'sync-settings', maxSchema: 2 },
  planner: { kind: 'planner', maxSchema: 1 },
  history: { kind: 'history', maxSchema: 1 },
  progressConfig: { maxSchema: 1 },
};
export const BACKUP_KEYS = Object.keys(COLLECTION_RULES);

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NODE = /^[a-z0-9-]+\.[a-z0-9-]+(\.[a-z0-9-]+)?$/;
const topicOf = (id: string) => id.split('.').slice(0, 2).join('.');

// ───────── checksum ─────────
export async function checksumOf(collections: unknown): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(collections));
  const hash = await subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// ───────── summary ─────────
export interface BackupSummary {
  exams: Record<string, { topicRecords: number; subtopicRecords: number; sessions: number; questions: number; revisions: number; notes: number }>;
  sharedConcepts: number;
  plans: number;
  tasks: number;
  targets: string[];
  historyDays: number;
  customWeights: number;
  syncPreferences: number;
}
export function summarize(collections: Obj): BackupSummary {
  const exams: BackupSummary['exams'] = {};
  const ex = (id: string) => (exams[id] ??= { topicRecords: 0, subtopicRecords: 0, sessions: 0, questions: 0, revisions: 0, notes: 0 });
  for (const [id, e] of Object.entries<Obj>(collections.progress?.exams ?? {})) {
    const x = ex(id);
    for (const [bucket, key] of [['topics', 'topicRecords'], ['subtopics', 'subtopicRecords']] as const) {
      for (const r of Object.values<Obj>(e?.[bucket] ?? {})) {
        x[key]++;
        x.revisions += Array.isArray(r?.revisions) ? r.revisions.length : 0;
        if (typeof r?.notes === 'string' && r.notes.trim()) x.notes++;
      }
    }
  }
  for (const [id, e] of Object.entries<Obj>(collections.practice?.exams ?? {})) {
    const x = ex(id);
    const list = Array.isArray(e?.sessions) ? e.sessions : [];
    x.sessions += list.length;
    x.questions += list.reduce((a: number, s: Obj) => a + (Number(s?.attempted) || 0), 0);
  }
  const plans = Object.values<Obj>(collections.planner?.plans ?? {});
  return {
    exams,
    sharedConcepts: Object.keys(collections.sharedLearning?.topics ?? {}).length + Object.keys(collections.sharedLearning?.subtopics ?? {}).length,
    plans: plans.length,
    tasks: plans.reduce((a, p) => a + (Array.isArray(p?.tasks) ? p.tasks.length : 0), 0),
    targets: (collections.planner?.settings?.targets ?? []).map((t: Obj) => t?.examId),
    historyDays: Object.values<Obj>(collections.history?.exams ?? {}).reduce((a, d) => a + Object.keys(d ?? {}).length, 0),
    customWeights: Object.values<Obj>(collections.weightOverrides?.exams ?? {}).reduce((a, d) => a + Object.keys(d ?? {}).length, 0),
    syncPreferences: Object.keys(collections.syncSettings?.modes ?? {}).length,
  };
}

// ───────── build ─────────
export async function buildBackup({ collections, exportedAt, mapping }: { collections: Obj; exportedAt: string; mapping?: Obj | null }) {
  const clean: Obj = {};
  for (const k of BACKUP_KEYS) clean[k] = collections[k] ?? null;
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    app: { name: 'syllabus-tracker', version: APP_VERSION },
    exportedAt,
    schema: { collections: Object.fromEntries(BACKUP_KEYS.map((k) => [k, clean[k]?.schemaVersion ?? null])) },
    mapping: mapping ?? null,
    summary: summarize(clean),
    collections: clean,
    checksum: await checksumOf(clean),
  };
}

// ───────── validation ─────────
export interface ValidationContext {
  knownExams: string[];
  /** true when the topic/subtopic belongs to the exam's syllabus; null when unknown (not checked). */
  nodeInExam?: (examId: string, nodeId: string) => boolean | null;
  knownStatuses?: string[];
  validateConfig?: (cfg: unknown) => void;
}
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  formatVersion: number | null;
  exportedAt: string | null;
  checksum: 'valid' | 'invalid' | 'absent' | 'unverifiable';
  summary: BackupSummary | null;
  missing: string[];
}

export async function validateBackup(data: unknown, ctx: ValidationContext): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const res = (extra: Partial<ValidationResult> = {}): ValidationResult => ({ ok: errors.length === 0, errors, warnings, formatVersion: null, exportedAt: null, checksum: 'absent', summary: null, missing: [], ...extra });
  if (!isObj(data)) { errors.push('The file is not a JSON object.'); return res(); }
  if (data.format !== BACKUP_FORMAT) { errors.push('This is not a Syllabus Tracker backup file.'); return res(); }
  const fv = data.formatVersion;
  if (!Number.isInteger(fv)) errors.push('formatVersion is missing.');
  else if (fv > BACKUP_FORMAT_VERSION) errors.push(`The backup was made by a newer version of the app (format ${fv}); this version reads formats ${SUPPORTED_FORMAT_VERSIONS.join(' and ')}.`);
  else if (!SUPPORTED_FORMAT_VERSIONS.includes(fv)) errors.push(`Unsupported backup format ${fv}.`);
  const exportedAt = typeof data.exportedAt === 'string' && !Number.isNaN(Date.parse(data.exportedAt)) ? data.exportedAt : null;
  if (!exportedAt) warnings.push('The export date is missing or invalid.');
  if (!isObj(data.collections)) { errors.push('The file has no collections.'); return res({ formatVersion: fv ?? null, exportedAt }); }
  const C = data.collections;

  // checksum
  let checksum: ValidationResult['checksum'] = 'absent';
  if (typeof data.checksum === 'string') {
    const actual = await checksumOf(C);
    checksum = actual === null ? 'unverifiable' : actual === data.checksum ? 'valid' : 'invalid';
    if (checksum === 'invalid') errors.push('Checksum mismatch: the file was modified or damaged after export.');
  }

  // collections: names, kinds, schema versions
  const missing: string[] = [];
  for (const k of Object.keys(C)) if (!COLLECTION_RULES[k]) errors.push(`Unknown collection '${k}'.`);
  for (const [k, rule] of Object.entries(COLLECTION_RULES)) {
    const v = C[k];
    if (v === undefined || v === null) { missing.push(k); if (rule.required) errors.push(`Required collection '${k}' is missing.`); continue; }
    if (!isObj(v)) { errors.push(`Collection '${k}' is not an object.`); continue; }
    if (rule.kind && v.kind !== rule.kind) errors.push(`Collection '${k}' has an unexpected format (kind '${v.kind ?? 'none'}').`);
    if (rule.kind) {
      if (!Number.isInteger(v.schemaVersion)) errors.push(`Collection '${k}' has no schemaVersion.`);
      else if (v.schemaVersion > rule.maxSchema) errors.push(`Collection '${k}' uses schema ${v.schemaVersion}, newer than this app supports (${rule.maxSchema}).`);
    }
  }
  const known = new Set(ctx.knownExams);
  const examCheck = (where: string, id: string) => { if (!known.has(id)) errors.push(`${where} refers to unknown exam '${id}'.`); };
  let notInSyllabus = 0;
  const nodeCheck = (examId: string, nodeId: string, where: string) => {
    if (!NODE.test(nodeId)) { errors.push(`${where}: invalid topic id '${nodeId}'.`); return; }
    if (ctx.nodeInExam && known.has(examId) && ctx.nodeInExam(examId, nodeId) === false) notInSyllabus++;
  };

  // progress
  const P = C.progress;
  if (isObj(P)) {
    if (!isObj(P.settings)) errors.push("progress.settings is missing.");
    if (!isObj(P.exams)) errors.push('progress.exams is missing.');
    else for (const [examId, e] of Object.entries<Obj>(P.exams)) {
      examCheck('progress', examId);
      if (!isObj(e) || !isObj(e.topics) || !isObj(e.subtopics)) { errors.push(`progress.exams.${examId} must have topics and subtopics.`); continue; }
      for (const bucket of ['topics', 'subtopics'] as const) for (const [id, r] of Object.entries<Obj>(e[bucket])) {
        nodeCheck(examId, id, `progress.${examId}`);
        if (!isObj(r)) { errors.push(`progress.${examId}.${id} is not a record.`); continue; }
        if (r.status != null && ctx.knownStatuses && !ctx.knownStatuses.includes(r.status)) warnings.push(`${examId} ${id}: unknown status '${r.status}' (shown as not started).`);
        if (r.revisions !== undefined && !Array.isArray(r.revisions)) errors.push(`progress.${examId}.${id}.revisions must be a list.`);
        else for (const rv of r.revisions ?? []) if (!isObj(rv) || !DATE.test(rv.date ?? '')) { errors.push(`progress.${examId}.${id}: a revision has no valid date.`); break; }
      }
    }
  }

  // practice: required fields, duplicate ids
  const seenSessions = new Set<string>();
  if (isObj(C.practice)) {
    if (!isObj(C.practice.exams)) errors.push('practice.exams is missing.');
    else for (const [examId, e] of Object.entries<Obj>(C.practice.exams)) {
      examCheck('practice', examId);
      if (!Array.isArray(e?.sessions)) { errors.push(`practice.exams.${examId}.sessions must be a list.`); continue; }
      let bad = 0;
      for (const s of e.sessions as Obj[]) {
        if (!isObj(s) || typeof s.id !== 'string' || typeof s.nodeId !== 'string' || !DATE.test(s.date ?? '')
          || !Number.isInteger(s.attempted) || s.attempted < 0 || !Number.isInteger(s.correct) || s.correct < 0 || s.correct > s.attempted) { bad++; continue; }
        if (seenSessions.has(s.id)) errors.push(`Duplicate practice session id '${s.id}'.`);
        seenSessions.add(s.id);
        nodeCheck(examId, s.nodeId, `practice.${examId}`);
      }
      if (bad) errors.push(`practice.${examId}: ${bad} session(s) are missing required fields (id, topic, date, attempted, correct ≤ attempted).`);
    }
  }

  // planner
  const PL = C.planner;
  if (isObj(PL)) {
    if (!isObj(PL.settings) || !Array.isArray(PL.settings.targets)) errors.push('planner.settings.targets is missing.');
    else {
      const seen = new Set<string>();
      for (const t of PL.settings.targets as Obj[]) {
        if (!isObj(t) || typeof t.examId !== 'string') { errors.push('planner: a target exam has no examId.'); continue; }
        examCheck('planner targets', t.examId);
        if (seen.has(t.examId)) errors.push(`planner: exam '${t.examId}' is listed twice as a target.`);
        seen.add(t.examId);
        if (!(Number.isFinite(t.importance) && t.importance > 0 && t.importance <= 100)) errors.push(`planner: importance of '${t.examId}' must be in (0, 100].`);
      }
    }
    if (!isObj(PL.plans)) errors.push('planner.plans is missing.');
    else for (const [date, p] of Object.entries<Obj>(PL.plans)) {
      if (!DATE.test(date) || !isObj(p) || !Array.isArray(p.tasks)) { errors.push(`planner.plans.${date} is not a valid day plan.`); continue; }
      const ids = new Set<string>();
      for (const t of p.tasks as Obj[]) {
        if (!isObj(t) || typeof t.taskId !== 'string') { errors.push(`planner.plans.${date}: a task has no taskId.`); continue; }
        if (ids.has(t.taskId)) errors.push(`planner.plans.${date}: duplicate task id '${t.taskId}'.`);
        ids.add(t.taskId);
      }
    }
  }

  // other collections
  if (isObj(C.sharedLearning) && (!isObj(C.sharedLearning.topics) || !isObj(C.sharedLearning.subtopics))) errors.push('sharedLearning must have topics and subtopics.');
  if (isObj(C.weightOverrides)) {
    if (!isObj(C.weightOverrides.exams)) errors.push('weightOverrides.exams is missing.');
    else for (const [examId, w] of Object.entries<Obj>(C.weightOverrides.exams)) {
      examCheck('weightOverrides', examId);
      for (const [k, v] of Object.entries(w ?? {})) if (!(typeof v === 'number' && v >= 0)) errors.push(`weightOverrides.${examId}.${k} must be a number ≥ 0.`);
    }
  }
  if (isObj(C.syncSettings) && isObj(C.syncSettings.modes))
    for (const [k, v] of Object.entries(C.syncSettings.modes)) if (!['full', 'partial', 'independent'].includes(v as string)) errors.push(`syncSettings.modes.${k} has invalid mode '${v}'.`);
  if (isObj(C.history) && !isObj(C.history.exams)) errors.push('history.exams is missing.');
  if (C.progressConfig != null && ctx.validateConfig) {
    try { ctx.validateConfig(C.progressConfig); } catch (e) { errors.push(`Scoring settings are invalid: ${(e as Error).message}`); }
  }
  if (notInSyllabus) warnings.push(`${notInSyllabus} record(s) refer to topics that are not in the current syllabus of that exam. They are kept and reported, not counted.`);
  for (const k of missing) if (!COLLECTION_RULES[k].required) warnings.push(`The backup has no '${k}' data.`);

  return res({ formatVersion: fv ?? null, exportedAt, checksum, summary: summarize(C), missing });
}

// ───────── merge ─────────
export interface MergeReport { added: Record<string, number>; updated: Record<string, number>; keptCurrent: Record<string, number>; notes: string[] }
const later = (a?: string | null, b?: string | null) => (b ?? '') > (a ?? '');
const uniqBy = <T>(list: T[], key: (x: T) => string) => { const m = new Map<string, T>(); for (const x of list) if (!m.has(key(x))) m.set(key(x), x); return [...m.values()]; };
const revKey = (r: Obj) => `${r?.date}|${r?.note ?? ''}`;

/**
 * Safe merge: nothing in the current data is deleted. For records present in both, the newer one (by its own timestamp)
 * wins while history lists (revisions, practice sessions, learning dates, resources) are combined without duplicates.
 * Settings without timestamps (exam settings, targets, custom weights, sync modes, scoring config) keep the current value.
 */
export function mergeCollections(current: Obj, incoming: Obj, now: string): { collections: Obj; report: MergeReport } {
  const report: MergeReport = { added: {}, updated: {}, keptCurrent: {}, notes: [] };
  const inc = (m: Record<string, number>, k: string, n = 1) => { m[k] = (m[k] ?? 0) + n; };
  const out: Obj = {};
  for (const k of BACKUP_KEYS) out[k] = current[k] != null ? structuredClone(current[k]) : incoming[k] != null ? structuredClone(incoming[k]) : null;
  const both = (k: string) => current[k] != null && incoming[k] != null;

  if (both('progress')) {
    const P = out.progress;
    for (const [examId, e] of Object.entries<Obj>(incoming.progress.exams ?? {})) {
      if (!P.exams[examId]) { P.exams[examId] = structuredClone(e); inc(report.added, 'exams'); continue; }
      const cur = P.exams[examId];
      for (const bucket of ['topics', 'subtopics'] as const) {
        cur[bucket] ??= {};
        for (const [id, r] of Object.entries<Obj>(e[bucket] ?? {})) {
          const c = cur[bucket][id];
          if (!c) { cur[bucket][id] = structuredClone(r); inc(report.added, 'topic records'); continue; }
          const revisions = uniqBy([...(c.revisions ?? []), ...(r.revisions ?? [])], revKey).sort((a, b) => String(a.date).localeCompare(String(b.date)));
          const addedRevs = revisions.length - (c.revisions ?? []).length;
          if (later(c.lastUpdated, r.lastUpdated)) { cur[bucket][id] = { ...structuredClone(r), revisions }; inc(report.updated, 'topic records'); }
          else { cur[bucket][id] = { ...c, revisions }; if (JSON.stringify(c) !== JSON.stringify(r)) inc(report.keptCurrent, 'topic records'); }
          if (addedRevs) inc(report.added, 'revisions', addedRevs);
        }
      }
    }
    P.settings = { ...(incoming.progress.settings ?? {}), ...(current.progress.settings ?? {}) };
    if (!P.settings.activeExamId) P.settings.activeExamId = incoming.progress.settings?.activeExamId ?? null;
    P.updatedAt = now;
  }

  if (both('practice')) {
    for (const [examId, e] of Object.entries<Obj>(incoming.practice.exams ?? {})) {
      const cur = (out.practice.exams[examId] ??= { sessions: [] });
      const ids = new Set((cur.sessions ?? []).map((s: Obj) => s.id));
      const add = (e.sessions ?? []).filter((s: Obj) => !ids.has(s.id));
      cur.sessions = [...(cur.sessions ?? []), ...structuredClone(add)].sort((a: Obj, b: Obj) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
      if (add.length) inc(report.added, 'practice sessions', add.length);
    }
    out.practice.updatedAt = now;
  }

  if (both('sharedLearning')) {
    for (const bucket of ['topics', 'subtopics'] as const) {
      out.sharedLearning[bucket] ??= {};
      for (const [id, r] of Object.entries<Obj>(incoming.sharedLearning[bucket] ?? {})) {
        const c = out.sharedLearning[bucket][id];
        if (!c) { out.sharedLearning[bucket][id] = structuredClone(r); inc(report.added, 'shared concepts'); continue; }
        const lists = {
          learningDates: [...new Set([...(c.learningDates ?? []), ...(r.learningDates ?? [])])].sort(),
          resources: uniqBy([...(c.resources ?? []), ...(r.resources ?? [])], (x: Obj) => String(x?.id ?? JSON.stringify(x))),
          revisions: uniqBy([...(c.revisions ?? []), ...(r.revisions ?? [])], revKey),
        };
        const base = later(c.updatedAt, r.updatedAt) ? (inc(report.updated, 'shared concepts'), structuredClone(r)) : c;
        out.sharedLearning[bucket][id] = { ...base, ...Object.fromEntries(Object.entries(lists).filter(([k]) => k in c || k in r)) };
      }
    }
    out.sharedLearning.updatedAt = now;
  }

  if (both('weightOverrides')) {
    for (const [examId, w] of Object.entries<Obj>(incoming.weightOverrides.exams ?? {})) {
      const cur = (out.weightOverrides.exams[examId] ??= {});
      for (const [k, v] of Object.entries(w ?? {})) {
        if (!(k in cur)) { cur[k] = v; inc(report.added, 'custom weights'); } else if (cur[k] !== v) inc(report.keptCurrent, 'custom weights');
      }
    }
    out.weightOverrides.updatedAt = now;
  }

  if (both('syncSettings')) {
    for (const [k, v] of Object.entries(incoming.syncSettings.modes ?? {})) {
      if (!(k in (out.syncSettings.modes ??= {}))) { out.syncSettings.modes[k] = v; inc(report.added, 'sync preferences'); } else if (out.syncSettings.modes[k] !== v) inc(report.keptCurrent, 'sync preferences');
    }
    out.syncSettings.updatedAt = now;
  }

  if (both('planner')) {
    const PL = out.planner;
    if (!(current.planner.settings?.targets ?? []).length && (incoming.planner.settings?.targets ?? []).length) { PL.settings = structuredClone(incoming.planner.settings); report.notes.push('Target exams and planner settings taken from the backup (you had none).'); }
    else if (JSON.stringify(current.planner.settings) !== JSON.stringify(incoming.planner.settings)) inc(report.keptCurrent, 'planner settings');
    for (const [k, d] of Object.entries<Obj>(incoming.planner.dismissed ?? {})) if (!(k in (PL.dismissed ??= {}))) { PL.dismissed[k] = d; inc(report.added, 'dismissals'); }
    for (const [date, p] of Object.entries<Obj>(incoming.planner.plans ?? {})) {
      const cur = PL.plans[date];
      if (!cur) { PL.plans[date] = structuredClone(p); inc(report.added, 'day plans'); continue; }
      const byId = new Map<string, Obj>(cur.tasks.map((t: Obj) => [t.taskId, t]));
      const topics = new Set(cur.tasks.filter((t: Obj) => t.topicId).map((t: Obj) => `${t.topicId}|${t.action}`));
      for (const t of p.tasks ?? []) {
        const c = byId.get(t.taskId);
        if (c) { if (c.status !== 'completed' && t.status === 'completed') { Object.assign(c, { status: 'completed', completedAt: t.completedAt, note: t.note, progressUpdates: t.progressUpdates }); inc(report.updated, 'tasks'); } continue; }
        if (t.topicId && topics.has(`${t.topicId}|${t.action}`)) continue; // same topic + action already planned that day
        cur.tasks.push({ ...structuredClone(t), order: cur.tasks.length + 1 });
        inc(report.added, 'tasks');
      }
      cur.plannedMinutes = cur.tasks.reduce((a: number, t: Obj) => a + (t.minutes ?? 0), 0);
      cur.removed = [...new Set([...(cur.removed ?? []), ...(p.removed ?? [])])];
    }
    PL.updatedAt = now;
  }

  if (both('history')) {
    for (const [examId, days] of Object.entries<Obj>(incoming.history.exams ?? {})) {
      const cur = (out.history.exams[examId] ??= {});
      for (const [d, v] of Object.entries(days ?? {})) if (!(d in cur)) { cur[d] = v; inc(report.added, 'history days'); }
    }
  }
  if (both('progressConfig') && JSON.stringify(current.progressConfig) !== JSON.stringify(incoming.progressConfig)) inc(report.keptCurrent, 'scoring settings');
  for (const k of BACKUP_KEYS) if (current[k] == null && incoming[k] != null) report.notes.push(`'${k}' taken from the backup (you had none).`);
  return { collections: out, report };
}

export const describeCounts = (m: Record<string, number>) => Object.entries(m).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing';
export { topicOf as backupTopicOf };
