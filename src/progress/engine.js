/**
 * ProgressEngine: stateful facade over the pure modules.
 *   - loads/saves the four collections through a storage adapter (auto-save after every change)
 *   - switches exams without touching other exams' progress
 *   - recalculates lazily: any change bumps a version, and the next getReport() recomputes
 *   - notifies subscribers (works with React's useSyncExternalStore)
 */
import { compileConfig } from './config.js';
import { buildExamModel, weightKey } from './model.js';
import { calculateProgress } from './calculate.js';
import * as P from './progress-db.js';
import { loadDb, saveCollections } from './storage.js';
import { buildSharedTopicDashboard, buildCrossExamInsights } from '../mapping/insights.js';

let counter = 0;
const defaultId = () => (globalThis.crypto?.randomUUID?.() ?? `ps-${Date.now().toString(36)}-${(counter++).toString(36)}`);

export class ProgressEngine {
  /**
   * @param {object} o
   * @param {{loadExam(id):Promise<{syllabusExam,weightageExam}>, listExams?():Promise<any[]>}} o.loader
   * @param {{read(key):Promise<any>, write(key,val):Promise<void>}} o.storage
   * @param {object} o.config      scoring config (data/progress/config.json)
   * @param {() => Date} [o.clock] injectable clock (tests)
   * @param {() => string} [o.idGenerator]
   */
  constructor({ loader, storage, config, clock = () => new Date(), idGenerator = defaultId, mapping = null }) {
    this.loader = loader;
    this.mapping = mapping; // Phase 4: { masterTopics, crossExamMapping }; loaded from loader.loadMapping() when omitted
    this.masterIndex = null;
    this.storage = storage;
    this.config = config;
    this.cfg = compileConfig(config);
    this.clock = clock;
    this.newId = idGenerator;
    this.db = null;
    this.examData = new Map();
    this.active = null; // { examId, model }
    this.version = 0;
    this.cache = new Map();
    this.listeners = new Set();
    this.saveChain = Promise.resolve();
    this.loadIssues = [];
  }

  async init() {
    const { db, issues } = await loadDb(this.storage, this.clock());
    this.db = db;
    this.loadIssues = issues;
    if (!this.mapping && typeof this.loader.loadMapping === 'function') this.mapping = await this.loader.loadMapping();
    if (this.mapping) this.masterIndex = new Map(this.mapping.masterTopics.masters.map((m) => [m.masterTopicId, m]));
    const last = db.progress.settings.activeExamId;
    if (last) {
      try { await this.switchExam(last); } catch (e) { this.loadIssues.push(`could not reopen last exam '${last}': ${e.message}`); }
    }
    return this;
  }

  // ───────────── exam selection ─────────────
  /** Load an exam's syllabus, weightage and independent progress. Other exams' progress is never modified. */
  async switchExam(examId, { trackId, stageId } = {}) {
    this.#requireDb();
    if (!this.examData.has(examId)) this.examData.set(examId, await this.loader.loadExam(examId));
    const now = this.clock();
    const settings = {};
    if (trackId !== undefined) settings.trackId = trackId;
    if (stageId !== undefined) settings.stageId = stageId;
    let db = this.db;
    const changed = !db.progress.exams[examId] || Object.keys(settings).length > 0 || db.progress.settings.activeExamId !== examId;
    if (!db.progress.exams[examId] || Object.keys(settings).length) db = P.setExamSettings(db, { examId, settings, now });
    db = { ...db, progress: { ...db.progress, settings: { ...db.progress.settings, activeExamId: examId } } };
    this.active = { examId, model: null };
    if (changed) this.#commit(db, ['progress']);
    else { this.db = db; this.version++; this.cache.clear(); } // reopening: nothing to save
    return this.getReport();
  }

  get activeExamId() { return this.active?.examId ?? null; }

  /** Model for the active exam (rebuilt when track/choices/weight overrides change). */
  getModel() {
    const examId = this.#requireExam();
    const ep = this.db.progress.exams[examId];
    const inputs = { trackId: ep?.trackId ?? undefined, choices: ep?.choices ?? {}, weightOverrides: this.db.weightOverrides.exams[examId] ?? {} };
    const signature = JSON.stringify(inputs);
    if (!this.active.model || this.active.signature !== signature) {
      const { syllabusExam, weightageExam } = this.examData.get(examId);
      this.active.model = buildExamModel({ syllabusExam, weightageExam, ...inputs });
      this.active.signature = signature;
    }
    return this.active.model;
  }

  /** Full progress report for the active exam; scope = exam's selected stage unless overridden ({stageId: null} = whole exam). */
  getReport({ stageId } = {}) {
    const examId = this.#requireExam();
    const scope = stageId !== undefined ? stageId : (this.db.progress.exams[examId]?.stageId ?? null);
    const key = `${examId}|${scope}|${this.version}`;
    if (!this.cache.has(key)) {
      this.cache.clear();
      this.cache.set(key, this.#calculate(examId, this.getModel(), scope));
    }
    return this.cache.get(key);
  }

  #calculate(examId, model, stageId) {
    return calculateProgress({
      model, db: this.db, config: this.config, now: this.clock(), stageId,
      sync: this.mapping ? this.syncResolver(examId) : null,
      requirements: this.mapping?.crossExamMapping.byExam[examId] ?? null,
    });
  }

  // ───────────── Phase 4: mapping & synchronization ─────────────
  /** Master topic for a library topic ID or master ID (null when the topic is not mapped). */
  getMasterTopic(id) {
    if (!this.masterIndex) return null;
    return this.masterIndex.get(id) ?? this.masterIndex.get(`mt.${id}`) ?? null;
  }
  /**
   * Effective sync mode of a topic in an exam:
   *   global sync off → independent; topic not mapped in this exam (single-exam / excluded) → independent;
   *   mapping rejected → independent; otherwise the user's per-topic choice, else the mapping default.
   */
  syncModeFor(examId, topicId) {
    if (!this.mapping) return 'full'; // Phase 3 behaviour
    if (this.db.syncSettings.enabled === false || this.db.progress.settings.sharedLearning === false) return 'independent';
    const mid = this.mapping.crossExamMapping.byExam[examId]?.[topicId]?.masterTopicId;
    if (!mid) return 'independent';
    const m = this.masterIndex.get(mid);
    if (!m || m.verification.status === 'rejected') return 'independent';
    return this.db.syncSettings.modes[mid] ?? m.defaultSyncMode;
  }
  syncResolver(examId) {
    const byExam = this.mapping?.crossExamMapping.byExam[examId] ?? {};
    return { modeFor: (topicId) => this.syncModeFor(examId, topicId), masterOf: (topicId) => byExam[topicId]?.masterTopicId ?? null };
  }
  /** Set the sync mode of a master topic for all linked exams ('full' | 'partial' | 'independent'); null = mapping default. */
  setSyncMode(masterOrTopicId, mode) {
    const m = this.#requireMaster(masterOrTopicId);
    this.#commit(P.setSyncMode(this.db, { masterTopicId: m.masterTopicId, mode, now: this.clock() }), ['syncSettings']);
    return this.active ? this.getReport() : null;
  }
  setSyncEnabled(enabled) {
    this.#requireDb();
    this.#commit(P.setSyncEnabled(this.db, { enabled, now: this.clock() }), ['syncSettings']);
    return this.active ? this.getReport() : null;
  }

  /** Shared concept learning (status, conceptCompletion, notes, learningDate) for a mapped master topic. */
  updateConcept(masterOrTopicId, patch) {
    const m = this.#requireMaster(masterOrTopicId);
    this.#commit(P.updateConcept(this.db, { topicId: m.libraryTopicId, patch, cfg: this.cfg, now: this.clock(), examId: this.active?.examId ?? null }), ['sharedLearning']);
    return this.getConcept(m.masterTopicId);
  }
  addConceptResource(masterOrTopicId, resource) {
    const m = this.#requireMaster(masterOrTopicId);
    this.#commit(P.addConceptResource(this.db, { topicId: m.libraryTopicId, resource, newId: this.newId, now: this.clock() }), ['sharedLearning']);
    return this.getConcept(m.masterTopicId);
  }
  removeConceptResource(masterOrTopicId, resourceId) {
    const m = this.#requireMaster(masterOrTopicId);
    this.#commit(P.removeConceptResource(this.db, { topicId: m.libraryTopicId, resourceId, now: this.clock() }), ['sharedLearning']);
    return this.getConcept(m.masterTopicId);
  }
  addConceptRevision(masterOrTopicId, { date, note } = {}) {
    const m = this.#requireMaster(masterOrTopicId);
    this.#commit(P.addConceptRevision(this.db, { topicId: m.libraryTopicId, date, note, now: this.clock() }), ['sharedLearning']);
    return this.getConcept(m.masterTopicId);
  }
  /** Shared concept record + how it applies to each linked exam (without switching the active exam). */
  getConcept(masterOrTopicId) {
    const m = this.#requireMaster(masterOrTopicId);
    const rec = this.db.sharedLearning.topics[m.libraryTopicId] ?? {};
    return {
      masterTopicId: m.masterTopicId, libraryTopicId: m.libraryTopicId, name: m.name,
      status: rec.status ?? 'not-started', conceptCompletion: P.conceptPctOf(rec, this.cfg),
      notes: rec.notes ?? '', learningDates: rec.learningDates ?? [], resources: rec.resources ?? [],
      conceptRevisionCount: (rec.revisions ?? []).length, revisions: rec.revisions ?? [], updatedAt: rec.updatedAt ?? null,
      verification: m.verification, similarity: m.similarity, defaultSyncMode: m.defaultSyncMode,
      linkedExams: m.exams.map((examId) => ({ examId, syncMode: this.syncModeFor(examId, m.libraryTopicId) })),
    };
  }

  /** Reports for several exams (each with its own settings and progress) without changing the active exam. */
  async getCrossExamReports(examIds) {
    this.#requireDb();
    const out = {};
    for (const examId of examIds) {
      if (!this.examData.has(examId)) this.examData.set(examId, await this.loader.loadExam(examId));
      const ep = this.db.progress.exams[examId];
      const { syllabusExam, weightageExam } = this.examData.get(examId);
      const model = examId === this.active?.examId ? this.getModel() : buildExamModel({
        syllabusExam, weightageExam, trackId: ep?.trackId ?? undefined, choices: ep?.choices ?? {}, weightOverrides: this.db.weightOverrides.exams[examId] ?? {},
      });
      out[examId] = this.#calculate(examId, model, null);
    }
    return out;
  }

  async getSharedTopicDashboard(examIds) {
    return buildSharedTopicDashboard({ reports: await this.getCrossExamReports(examIds), examIds, mapping: this.#requireMapping() });
  }
  async getCrossExamInsights(examIds) {
    return buildCrossExamInsights({ reports: await this.getCrossExamReports(examIds), examIds, mapping: this.#requireMapping(), thresholds: { examCompleted: this.cfg.classification.completedAtOrAbove } });
  }
  #requireMapping() {
    if (!this.mapping) throw new Error('no cross-exam mapping loaded');
    return this.mapping;
  }

  #requireMaster(id) {
    this.#requireDb();
    if (!this.mapping) throw new Error('no cross-exam mapping loaded (loader.loadMapping or the `mapping` option)');
    const m = this.getMasterTopic(id);
    if (!m) throw new RangeError(`'${id}' is not a mapped common topic: unmapped (single-exam) topics stay independent`);
    return m;
  }

  // ───────────── progress updates (active exam) ─────────────
  updateTopic(topicId, patch) { return this.#updateNode(topicId, patch, 'topic'); }
  updateSubtopic(subtopicId, patch) { return this.#updateNode(subtopicId, patch, 'subtopic'); }
  setStatus(nodeId, status) { return this.#updateNode(nodeId, { status }); }
  setShareLearning(topicId, enabled) { return this.#updateNode(topicId, { shareLearning: !!enabled }, 'topic'); }

  addRevision(nodeId, { date, note } = {}) {
    const examId = this.#requireNode(nodeId);
    this.#commit(P.addRevision(this.db, { examId, nodeId, date, note, now: this.clock() }), ['progress']);
    return this.getReport();
  }
  /**
   * Log a practice session for the active exam. Phase 4: the session is tagged with
   *   level   = the exam's category (SSC-level vs banking-level practice)
   *   stageId = the given stage, else the only stage the topic appears in, else the selected stage if it contains the topic
   */
  recordPractice(nodeId, session) {
    const examId = this.#requireNode(nodeId);
    const m = this.getModel();
    const topicId = nodeId.split('.').slice(0, 2).join('.');
    const stages = [...new Set((m.topics[topicId]?.occurrences ?? []).map((o) => o.stageId))];
    const selected = this.db.progress.exams[examId]?.stageId;
    if (session.stageId != null && !stages.includes(session.stageId)) throw new RangeError(`'${nodeId}' is not part of stage '${session.stageId}' (stages: ${stages.join(', ')})`);
    const stageId = session.stageId ?? (stages.length === 1 ? stages[0] : stages.includes(selected) ? selected : null);
    const tagged = { ...session, stageId, level: session.level ?? m.category ?? null };
    this.#commit(P.recordPractice(this.db, { examId, nodeId, session: tagged, newId: this.newId, now: this.clock() }), ['practice', 'progress']);
    return this.getReport();
  }
  deletePractice(sessionId) {
    const examId = this.#requireExam();
    this.#commit(P.deletePractice(this.db, { examId, sessionId, now: this.clock() }), ['practice']);
    return this.getReport();
  }
  setPracticeTotals(nodeId, totals) {
    const examId = this.#requireNode(nodeId);
    this.#commit(P.setPracticeTotals(this.db, { examId, nodeId, totals, now: this.clock() }), ['progress']);
    return this.getReport();
  }
  /** Read-only practice sessions of any exam (Phase 5 planner: recent accuracy, accuracy trend). */
  getExamSessions(examId) {
    this.#requireDb();
    return Object.freeze([...(this.db.practice.exams[examId]?.sessions ?? [])]);
  }
  practiceSessions(nodeId = null) {
    const examId = this.#requireExam();
    const all = this.db.practice.exams[examId]?.sessions ?? [];
    return nodeId ? all.filter((s) => s.nodeId === nodeId || (nodeId.split('.').length === 2 && s.nodeId.startsWith(`${nodeId}.`))) : all;
  }

  // ───────────── shared learning ─────────────
  setSharedStatus(nodeId, status) {
    this.#requireDb();
    this.#commit(P.setSharedStatus(this.db, { nodeId, status, cfg: this.cfg, now: this.clock() }), ['sharedLearning']);
    return this.active ? this.getReport() : null;
  }
  setSharedLearningEnabled(enabled) {
    this.#requireDb();
    this.#commit({ ...this.db, progress: { ...this.db.progress, settings: { ...this.db.progress.settings, sharedLearning: !!enabled } } }, ['progress']);
    return this.active ? this.getReport() : null;
  }

  // ───────────── exam settings & weightage ─────────────
  setTrack(trackId) { return this.#setting({ trackId }); }
  setStage(stageId) { return this.#setting({ stageId }); }
  setChoice(choiceGroup, sectionId) { return this.#setting({ choices: { [choiceGroup]: sectionId } }); }
  /** User custom weight (relative; siblings are re-normalised). kind: stage|section|topic|subtopic. value null = remove. */
  setWeightOverride({ kind, stageId, sectionId, topicId, slug, trackId }, value) {
    const examId = this.#requireExam();
    const tk = trackId ?? this.getModel().trackId;
    const key = kind === 'stage' ? weightKey.stage(tk, stageId)
      : kind === 'section' ? weightKey.section(stageId, sectionId)
        : kind === 'topic' ? weightKey.topic(stageId, sectionId, topicId)
          : kind === 'subtopic' ? weightKey.subtopic(stageId, sectionId, topicId, slug) : null;
    if (!key) throw new TypeError(`unknown weight kind '${kind}'`);
    this.#commit(P.setWeightOverride(this.db, { examId, key, value, now: this.clock() }), ['weightOverrides']);
    return this.getReport();
  }

  // ───────────── configuration & read-only views (Phase 6 UI) ─────────────
  /** Replace the scoring config (status scores, mastery parameters …). Validated first; stored records are untouched. */
  setConfig(config) {
    const compiled = compileConfig(config); // throws on invalid config, leaving the current one active
    this.config = config;
    this.cfg = compiled;
    this.version++;
    this.cache.clear();
    for (const l of this.listeners) l(this.version);
    return this.active ? this.getReport() : null;
  }
  /** Read-only copy of one exam's progress record (topics, subtopics, revisions, notes, settings). */
  getExamRecords(examId) {
    this.#requireDb();
    const ep = this.db.progress.exams[examId];
    return ep ? structuredClone(ep) : null;
  }
  /** Read-only copy of one exam's custom weight overrides ({ weightKey: value }). */
  getWeightOverrides(examId) {
    this.#requireDb();
    return structuredClone(this.db.weightOverrides.exams[examId] ?? {});
  }

  // ───────────── plumbing ─────────────
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getVersion() { return this.version; }
  /** Resolves when every pending save has been written. */
  flush() { return this.saveChain; }
  snapshot() { return structuredClone(this.db); }

  #setting(settings) {
    const examId = this.#requireExam();
    this.#commit(P.setExamSettings(this.db, { examId, settings, now: this.clock() }), ['progress']);
    return this.getReport();
  }
  #updateNode(nodeId, patch, expectKind) {
    const examId = this.#requireNode(nodeId, expectKind);
    const syncModeFor = (topicId) => this.syncModeFor(examId, topicId);
    this.#commit(P.updateNode(this.db, { examId, nodeId, patch, cfg: this.cfg, now: this.clock(), syncModeFor }), ['progress', 'sharedLearning']);
    return this.getReport();
  }
  #commit(db, keys) {
    this.db = db;
    this.version++;
    this.cache.clear();
    const snapshot = db;
    this.saveChain = this.saveChain.then(() => saveCollections(this.storage, snapshot, keys));
    for (const l of this.listeners) l(this.version);
  }
  #requireDb() { if (!this.db) throw new Error('call init() first'); }
  #requireExam() {
    this.#requireDb();
    if (!this.active) throw new Error('no exam selected: call switchExam(examId)');
    return this.active.examId;
  }
  #requireNode(nodeId, expectKind) {
    const examId = this.#requireExam();
    const m = this.getModel();
    const kind = m.topics[nodeId] ? 'topic' : m.subtopics[nodeId] ? 'subtopic' : null;
    if (!kind) throw new RangeError(`'${nodeId}' is not part of ${m.shortName} (track ${m.trackId})`);
    if (expectKind && kind !== expectKind) throw new TypeError(`'${nodeId}' is a ${kind}, not a ${expectKind}`);
    return examId;
  }
}
