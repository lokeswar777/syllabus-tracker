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
  constructor({ loader, storage, config, clock = () => new Date(), idGenerator = defaultId }) {
    this.loader = loader;
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
      this.cache.set(key, calculateProgress({ model: this.getModel(), db: this.db, config: this.config, now: this.clock(), stageId: scope }));
    }
    return this.cache.get(key);
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
  recordPractice(nodeId, session) {
    const examId = this.#requireNode(nodeId);
    this.#commit(P.recordPractice(this.db, { examId, nodeId, session, newId: this.newId, now: this.clock() }), ['practice', 'progress']);
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
    this.#commit(P.updateNode(this.db, { examId, nodeId, patch, cfg: this.cfg, now: this.clock() }), ['progress', 'sharedLearning']);
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
