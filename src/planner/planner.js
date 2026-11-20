/**
 * StudyPlanner: the Phase 5 preparation priority engine.
 *
 * Composes the existing ProgressEngine (Phase 3/4) and never edits its records directly:
 *   - reads   : engine.getCrossExamReports (syllabus + weightage + progress + mapping), engine.getExamSessions
 *   - writes  : only when YOU complete a task with an outcome, through engine.updateTopic / recordPractice /
 *               addRevision / updateConcept (the appropriate progress-engine methods)
 * Planner data lives in its own `planner` collection (settings, dismissals, daily plans).
 */
import { resolvePlannerConfig, isoDate, daysBetween, maxDate, round2, ACTIONS, classify as cfgClassify } from './config.js';
import { examShares, computePriorities } from './priority.js';
import { detectWeakAreas } from './weak-areas.js';
import { buildDailyPlan } from './daily-plan.js';
import { buildPlannerInsights } from './insights.js';
import { buildCrossExamInsights } from '../mapping/insights.js';

export const PLANNER_KEY = 'planner';
const ACTION_LABEL = {
  'learn-concept': 'Learn the concept', 'complete-subtopics': 'Complete pending subtopics', 'practice-questions': 'Practice questions',
  'sectional-test': 'Take a sectional test', 'revise-notes': 'Revise notes', 'mock-test': 'Attempt a mock test',
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function createEmptyPlanner(now) {
  return { schemaVersion: 1, kind: 'planner', updatedAt: now.toISOString(), settings: { targets: [], dailyHours: null, configOverrides: {} }, dismissed: {}, plans: {} };
}

export class StudyPlanner {
  /**
   * @param {object} o
   * @param {import('../progress/engine.js').ProgressEngine} o.engine  initialised progress engine
   * @param {object} o.storage   same storage adapter (planner data is stored under its own key)
   * @param {object} o.config    data/planner/config.json (defaults)
   * @param {() => Date} [o.clock]
   */
  constructor({ engine, storage, config, clock = () => new Date() }) {
    this.engine = engine;
    this.storage = storage;
    this.defaults = config;
    this.clock = clock;
    this.data = null;
    this.version = 0;
    this.cache = null;
    this.saveChain = Promise.resolve();
    this.loadIssues = [];
    this.topicNames = new Map();
  }

  async init() {
    let raw = null;
    try { raw = await this.storage.read(PLANNER_KEY); } catch (e) { this.loadIssues.push(`planner: ${e.message}`); }
    const base = createEmptyPlanner(this.clock());
    this.data = raw && typeof raw === 'object' ? { ...base, ...raw, settings: { ...base.settings, ...(raw.settings ?? {}) }, dismissed: { ...(raw.dismissed ?? {}) }, plans: { ...(raw.plans ?? {}) } } : base;
    try { this.config(); } catch (e) { this.loadIssues.push(`stored config overrides invalid, ignored: ${e.message}`); this.data.settings.configOverrides = {}; }
    return this;
  }

  // ───────────── settings (user controls) ─────────────
  config() { return resolvePlannerConfig(this.defaults, this.data.settings.configOverrides); }
  get settings() { return structuredClone(this.data.settings); }
  today() { return isoDate(this.clock()); }

  /** targets: [{ examId, importance (0–100], examDate? 'YYYY-MM-DD' }] */
  async setTargets(targets) {
    if (!Array.isArray(targets) || !targets.length) throw new TypeError('select at least one target exam');
    const known = new Set((await this.engine.loader.listExams()).map((e) => e.examId));
    const seen = new Set();
    for (const t of targets) {
      if (!known.has(t.examId)) throw new RangeError(`unknown exam '${t.examId}'`);
      if (seen.has(t.examId)) throw new RangeError(`exam '${t.examId}' listed twice`);
      seen.add(t.examId);
      if (!(Number.isFinite(t.importance) && t.importance > 0 && t.importance <= 100)) throw new RangeError(`importance of '${t.examId}' must be in (0, 100]`);
      if (t.examDate != null && !DATE.test(t.examDate)) throw new TypeError(`examDate of '${t.examId}' must be YYYY-MM-DD`);
    }
    return this.#set((d) => { d.settings.targets = targets.map((t) => ({ examId: t.examId, importance: t.importance, examDate: t.examDate ?? null })); });
  }
  setExamImportance(examId, importance) {
    if (!(Number.isFinite(importance) && importance > 0 && importance <= 100)) throw new RangeError('importance must be in (0, 100]');
    return this.#set((d) => { this.#target(d, examId).importance = importance; });
  }
  setExamDate(examId, examDate) {
    if (examDate !== null && !DATE.test(examDate)) throw new TypeError('examDate must be YYYY-MM-DD or null');
    return this.#set((d) => { this.#target(d, examId).examDate = examDate; });
  }
  setDailyHours(hours) {
    if (!(Number.isFinite(hours) && hours >= 0 && hours <= 24)) throw new RangeError('daily hours must be within 0–24');
    return this.#set((d) => { d.settings.dailyHours = hours; });
  }
  /** Partial config overrides (scoring weights, thresholds, revision, daily plan …); validated before saving. */
  setConfigOverrides(overrides) {
    resolvePlannerConfig(this.defaults, overrides);
    return this.#set((d) => { d.settings.configOverrides = overrides ?? {}; });
  }
  setRevisionIntervals(intervalsDays) {
    const next = { ...this.data.settings.configOverrides, revision: { ...(this.data.settings.configOverrides.revision ?? {}), intervalsDays } };
    resolvePlannerConfig(this.defaults, next);
    return this.#set((d) => { d.settings.configOverrides = next; });
  }

  // ───────────── dismissals ─────────────
  /** Hide a topic (all exams) or one exam's part of it, optionally until a date. Never touches progress. */
  dismissRecommendation(topicId, { examId = null, until = null, reason = '' } = {}) {
    if (until !== null && !DATE.test(until)) throw new TypeError('until must be YYYY-MM-DD or null');
    return this.#set((d) => { d.dismissed[examId ? `${topicId}@${examId}` : topicId] = { topicId, examId, until, reason, dismissedAt: this.clock().toISOString() }; });
  }
  undismissRecommendation(topicId, { examId = null } = {}) {
    return this.#set((d) => { delete d.dismissed[examId ? `${topicId}@${examId}` : topicId]; });
  }
  #isDismissed(topicId, examId = null) {
    const rec = this.data.dismissed[examId ? `${topicId}@${examId}` : topicId];
    return !!rec && (!rec.until || rec.until > this.today());
  }

  // ───────────── calculations ─────────────
  async compute() {
    const targets = this.data.settings.targets;
    if (!targets.length) throw new Error('no target exams selected: call setTargets([...])');
    const key = `${this.engine.getVersion()}|${this.version}|${this.today()}`;
    if (this.cache?.key === key) return this.cache.value;
    const cfg = this.config();
    const today = this.today();
    const shares = examShares(targets, today, cfg);
    const examIds = shares.filter((s) => s.share > 0).map((s) => s.examId);
    const reports = await this.engine.getCrossExamReports(examIds);
    const sessions = Object.fromEntries(examIds.map((e) => [e, this.engine.getExamSessions(e)]));
    const priorities = computePriorities({ reports, sessions, shares: shares.filter((s) => s.share > 0), cfg, today });
    for (const t of priorities.topics) this.topicNames.set(t.topicId, t.name);
    const weakAreas = detectWeakAreas({ perExam: priorities.perExam, reports, sessions, cfg });
    const value = { cfg, today, shares, reports, sessions, priorities, weakAreas, warnings: shares.filter((s) => s.past).map((s) => `${s.examId}: exam date ${s.examDate} has passed; excluded from planning`) };
    this.cache = { key, value };
    return value;
  }

  /** All topics with combined score, class and per-exam breakdown (dismissed ones flagged, not removed). */
  async getPriorities() {
    const { priorities, shares, warnings } = await this.compute();
    return { shares, warnings, topics: priorities.topics.map((t) => ({ ...t, dismissed: this.#isDismissed(t.topicId) })) };
  }

  /** Ranked recommendations (one per topic) with the fields needed for display. */
  async getRecommendations({ limit = 20 } = {}) {
    const { priorities, shares, reports, cfg } = await this.compute();
    const live = this.#liveTopics(priorities.topics, cfg);
    const name = (e) => reports[e]?.shortName ?? e;
    const items = live.slice(0, limit).map((t, i) => {
      const p = t.perExam[t.primaryExamId];
      const reasons = [...p.reasons];
      if (t.examCount >= 2) reasons.push(`Relevant to ${t.examCount} target exams (${t.exams.map(name).join(', ')}), counted by its weight in each`);
      return {
        rank: i + 1, topicId: t.topicId, name: t.name, subject: t.subject, masterTopicId: t.masterTopicId,
        priorityScore: t.score, classification: t.classification,
        relevantExam: { examId: t.primaryExamId, name: name(t.primaryExamId) },
        section: p.section?.name ?? null,
        topicWeightage: round2(p.effectiveWeight), syllabusCompletion: round2(p.completion), examMastery: round2(p.mastery),
        reasons,
        suggestedAction: { action: p.action.action, label: ACTION_LABEL[p.action.action], detail: p.action.detail },
        relevantExams: Object.values(t.perExam).map((r) => ({ examId: r.examId, name: name(r.examId), share: r.share, score: r.score, contribution: r.contribution, section: r.section?.name ?? null, topicWeightage: round2(r.effectiveWeight), syllabusCompletion: round2(r.completion), examMastery: round2(r.mastery), action: r.action.action, revisionStatus: r.revision.status })),
      };
    });
    return { generatedFor: this.today(), shares, recommendations: items, examRecommendations: this.#mockCandidates(reports, shares, cfg).map((m) => ({ ...m, action: 'mock-test', label: ACTION_LABEL['mock-test'] })) };
  }

  /** Why a topic got its priority: formula, factor values, contributions per exam. */
  async explain(topicId) {
    const { priorities, cfg } = await this.compute();
    const t = priorities.topics.find((x) => x.topicId === topicId);
    if (!t) throw new RangeError(`'${topicId}' is not in any target exam`);
    const w = cfg.priority.weights;
    return {
      topicId, name: t.name, score: t.score, classification: t.classification,
      formula: 'combined = Σ_exam share × score_exam; score_exam = 100 × Σ_k w_k·f_k / Σ w_k (see docs/PRIORITY_ENGINE.md)',
      thresholds: cfg.priority.classification.thresholds, weights: w,
      perExam: Object.values(t.perExam).map((r) => ({
        examId: r.examId, share: r.share, score: r.score, contribution: r.contribution, classification: r.classification,
        factors: r.factors, contributions: r.contributions, context: r.context, reasons: r.reasons, action: r.action,
        arithmetic: `${r.share} × ${r.score} = ${r.contribution}`,
      })),
    };
  }

  /** Revision tracker for every studied topic of the target exams (exam-specific records). */
  async getRevisionTracker() {
    const { priorities } = await this.compute();
    const rows = Object.values(priorities.perExam).flatMap((r) => Object.values(r)).filter((r) => r.revision.studied);
    const items = rows.map((r) => ({ examId: r.examId, topicId: r.topicId, name: r.name, section: r.section?.name ?? null, ...r.revision }))
      .sort((a, b) => (a.nextDue ?? '9999').localeCompare(b.nextDue ?? '9999'));
    const count = (s) => items.filter((i) => i.status === s).length;
    return { today: this.today(), intervalsDays: this.config().revision.intervalsDays, summary: { tracked: items.length, overdue: count('overdue'), dueToday: count('due-today'), dueSoon: count('due-soon'), scheduled: count('scheduled') }, items };
  }

  async getWeakAreas() { return (await this.compute()).weakAreas; }

  async getInsights() {
    const { priorities, weakAreas, shares, reports } = await this.compute();
    const examIds = shares.filter((s) => s.share > 0).map((s) => s.examId);
    const sharedInsights = this.engine.mapping && examIds.length ? buildCrossExamInsights({ reports, examIds, mapping: this.engine.mapping }) : null;
    return buildPlannerInsights({ priorities, weakAreas, shares, sharedInsights });
  }

  // ───────────── daily plan ─────────────
  async generateDailyPlan(date = this.today(), { hours } = {}) {
    if (!DATE.test(date)) throw new TypeError('date must be YYYY-MM-DD');
    const { priorities, reports, shares, cfg } = await this.compute();
    const h = hours ?? this.data.settings.dailyHours ?? cfg.dailyPlan.defaultHours;
    if (!(Number.isFinite(h) && h >= 0 && h <= 24)) throw new RangeError('hours must be within 0–24');
    const plan = buildDailyPlan({ date, hours: h, topics: this.#liveTopics(priorities.topics, cfg), mockCandidates: this.#mockCandidates(reports, shares, cfg, date), existing: this.data.plans[date] ?? null, cfg, now: this.clock() });
    await this.#set((d) => { d.plans[date] = plan; }, { invalidate: false });
    return structuredClone(plan);
  }
  getDailyPlan(date = this.today()) { return this.data.plans[date] ? structuredClone(this.data.plans[date]) : null; }

  /** Manually add a task (kept on regeneration). */
  addTask(date, { topicId = null, examId, action, minutes, detail = '', name = null }) {
    if (!ACTIONS.includes(action)) throw new TypeError(`action must be one of ${ACTIONS.join(', ')}`);
    if (!(Number.isFinite(minutes) && minutes > 0 && minutes <= 24 * 60)) throw new RangeError('minutes must be > 0');
    if (!this.data.settings.targets.some((t) => t.examId === examId)) throw new RangeError(`'${examId}' is not a target exam`);
    const plan = this.#plan(date);
    const taskId = `${date}:manual:${topicId ?? examId}:${action}:${plan.tasks.length + 1}`;
    return this.#set((d) => {
      const p = d.plans[date];
      p.tasks.push({ taskId, kind: topicId ? 'topic' : 'exam', topicId, name: name ?? this.topicNames.get(topicId) ?? topicId ?? examId, subject: topicId ? topicId.split('.')[0] : null, examIds: [examId], primaryExamId: examId, section: null, action, detail, minutes, priorityScore: null, classification: null, reason: 'Added manually', source: 'manual', status: 'pending', order: p.tasks.length + 1 });
      p.plannedMinutes = p.tasks.reduce((a, t) => a + t.minutes, 0);
    }).then(() => taskId);
  }
  /** Remove a task; the topic is not re-added to that day's plan on regeneration. */
  removeTask(date, taskId) {
    const plan = this.#plan(date);
    const task = plan.tasks.find((t) => t.taskId === taskId);
    if (!task) throw new RangeError(`no task '${taskId}' on ${date}`);
    return this.#set((d) => {
      const p = d.plans[date];
      p.tasks = p.tasks.filter((t) => t.taskId !== taskId).map((t, i) => ({ ...t, order: i + 1 }));
      p.removed = [...new Set([...(p.removed ?? []), taskId, ...(task.topicId ? [`topic:${task.topicId}`] : [])])];
      p.plannedMinutes = p.tasks.reduce((a, t) => a + t.minutes, 0);
    });
  }
  reorderTasks(date, taskIds) {
    const plan = this.#plan(date);
    const ids = plan.tasks.map((t) => t.taskId);
    if (taskIds.length !== ids.length || !ids.every((id) => taskIds.includes(id))) throw new RangeError('reorder must list every task of the day exactly once');
    return this.#set((d) => {
      const p = d.plans[date];
      const byId = new Map(p.tasks.map((t) => [t.taskId, t]));
      p.tasks = taskIds.map((id, i) => ({ ...byId.get(id), order: i + 1 }));
      p.customOrder = [...taskIds];
    });
  }
  /**
   * Mark a task completed (manual only). Progress changes ONLY if you pass an outcome, applied through the
   * progress engine for the given exams (default: the task's primary exam):
   *   outcome.status   → engine.updateTopic(topic, { status })
   *   outcome.practice → engine.recordPractice(topic, practice)         ({ attempted, correct, timeSeconds, revision, stageId })
   *   outcome.revision → engine.addRevision(topic, { date, note })      (confirmed revision)
   *   outcome.concept  → engine.updateConcept(topic, concept)           (shared concept record, applied once)
   */
  async completeTask(date, taskId, { outcome = null, note = '' } = {}) {
    const plan = this.#plan(date);
    const task = plan.tasks.find((t) => t.taskId === taskId);
    if (!task) throw new RangeError(`no task '${taskId}' on ${date}`);
    if (task.status === 'completed') throw new Error(`task '${taskId}' is already completed`);
    const applied = [];
    if (outcome) {
      if (!task.topicId && (outcome.status || outcome.practice || outcome.revision || outcome.concept)) throw new TypeError('exam-level tasks (mock tests) take no topic outcome');
      const examIds = outcome.examIds ?? [task.primaryExamId];
      for (const e of examIds) if (!task.examIds.includes(e) && !this.data.settings.targets.some((t) => t.examId === e)) throw new RangeError(`'${e}' is not a target exam`);
      if (outcome.concept) { this.engine.updateConcept(task.topicId, outcome.concept); applied.push({ via: 'engine.updateConcept', topicId: task.topicId }); }
      const prev = this.engine.activeExamId;
      try {
        for (const e of examIds) {
          if (this.engine.activeExamId !== e) await this.engine.switchExam(e);
          if (outcome.status) { this.engine.updateTopic(task.topicId, { status: outcome.status }); applied.push({ via: 'engine.updateTopic', examId: e, status: outcome.status }); }
          if (outcome.practice) { this.engine.recordPractice(task.topicId, outcome.practice); applied.push({ via: 'engine.recordPractice', examId: e }); }
          if (outcome.revision) { this.engine.addRevision(task.topicId, outcome.revision); applied.push({ via: 'engine.addRevision', examId: e }); }
        }
      } finally {
        if (prev && this.engine.activeExamId !== prev) await this.engine.switchExam(prev);
      }
      await this.engine.flush();
    }
    await this.#set((d) => {
      const t = d.plans[date].tasks.find((x) => x.taskId === taskId);
      Object.assign(t, { status: 'completed', completedAt: this.clock().toISOString(), note, progressUpdates: applied });
    });
    return structuredClone(this.data.plans[date].tasks.find((x) => x.taskId === taskId));
  }
  /** Undo the "completed" mark of a task (does not undo progress updates already recorded). */
  reopenTask(date, taskId) {
    this.#plan(date);
    return this.#set((d) => { const t = d.plans[date].tasks.find((x) => x.taskId === taskId); if (t) { t.status = 'pending'; delete t.completedAt; } });
  }

  flush() { return this.saveChain; }

  // ───────────── internals ─────────────
  #liveTopics(topics, cfg) {
    return topics.filter((t) => !this.#isDismissed(t.topicId) && !t.done).map((t) => {
      const entries = Object.entries(t.perExam).filter(([e]) => !this.#isDismissed(t.topicId, e));
      if (entries.length === Object.keys(t.perExam).length) return t;
      if (!entries.length) return null;
      const perExam = Object.fromEntries(entries);
      const score = round2(entries.reduce((a, [, r]) => a + r.contribution, 0));
      const primary = entries.sort((a, b) => b[1].contribution - a[1].contribution)[0][0];
      return { ...t, perExam, exams: Object.keys(perExam), examCount: entries.length, primaryExamId: primary, score, classification: cfgClassify(score, cfg) };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.topicId.localeCompare(b.topicId));
  }
  #mockCandidates(reports, shares, cfg, date = this.today()) {
    const A = cfg.actions.mockTest;
    const out = [];
    for (const s of shares) {
      const rep = reports[s.examId];
      if (!rep || s.share === 0) continue;
      const c = rep.summary.syllabusCompletion;
      const ready = c >= A.examCompletionAtOrAbove || (s.daysLeft !== null && s.daysLeft <= A.orDaysLeftAtOrBelow && c >= A.withCompletionAtOrAbove);
      if (!ready) continue;
      const last = maxDate(...Object.values(this.data.plans).flatMap((p) => p.tasks.filter((t) => t.action === 'mock-test' && t.status === 'completed' && t.examIds.includes(s.examId)).map((t) => t.completedAt?.slice(0, 10))));
      if (last && daysBetween(last, date) < A.minGapDays) continue;
      out.push({ examId: s.examId, examName: rep.shortName, syllabusCompletion: c, daysLeft: s.daysLeft, lastMock: last ?? null, reason: `${rep.shortName} syllabus ${c}% complete${s.daysLeft !== null ? `, ${s.daysLeft} days to the exam` : ''}${last ? `, last mock ${last}` : ', no mock yet'}.` });
    }
    return out;
  }
  #target(d, examId) {
    const t = d.settings.targets.find((x) => x.examId === examId);
    if (!t) throw new RangeError(`'${examId}' is not a target exam`);
    return t;
  }
  #plan(date) {
    if (!this.data.plans[date]) throw new RangeError(`no plan for ${date}: call generateDailyPlan('${date}') first`);
    return this.data.plans[date];
  }
  #set(mutate, { invalidate = true } = {}) {
    const next = structuredClone(this.data);
    mutate(next);
    next.updatedAt = this.clock().toISOString();
    this.data = next;
    if (invalidate) { this.version++; this.cache = null; }
    const snapshot = next;
    this.saveChain = this.saveChain.then(() => this.storage.write(PLANNER_KEY, snapshot));
    return this.saveChain;
  }
}
