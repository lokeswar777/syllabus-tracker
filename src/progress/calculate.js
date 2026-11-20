/**
 * Progress calculation (pure function).
 *
 * SYLLABUS COMPLETION
 *   completion(subtopic) = statusScore (own exam status → inherited topic status → not-started),
 *                          raised to the shared conceptual score when shared learning is enabled
 *   completion(topic@occurrence) = Σ subW × completion(sub)                       (subW sums to 1)
 *   completion(section) = Σ topicW × completion(topic@occurrence)                 (topicW sums to 1)
 *   completion(stage)   = Σ sectionW × completion(section)                        (active, non-gate sections)
 *   completion(exam)    = Σ stageW × completion(stage)
 *                       ≡ Σ over leaves (stageW·sectionW·topicW·subW) × completion(sub)
 *   Progress is only scored at subtopic (leaf) level. A topic's own status is used as the default for its
 *   subtopics, never added on top of them, so parents and children are not double-counted.
 *
 * EXAM MASTERY (independent of completion; see mastery.js)
 *   mastery(topic) from all practice in the topic's subtree, rolled up with the same weights.
 */
import { compileConfig, clampPct, round2, topicOf } from './config.js';
import { aggregateStats, scoreMastery } from './mastery.js';
import { conceptPctOf } from './progress-db.js';

/**
 * @param {object} p
 * @param {object} p.model   buildExamModel(...) result
 * @param {object} p.db      progress db (see progress-db.js); missing collections are tolerated
 * @param {object} p.config  scoring config (data/progress/config.json)
 * @param {Date}   [p.now]
 * @param {string|null} [p.stageId] scope: null/undefined = whole exam (track); a stage id = that stage only
 * @param {object} [p.sync]         Phase 4: { modeFor(topicId) → 'full'|'partial'|'independent', masterOf(topicId) → id|null }.
 *                                   Omitted → every topic behaves as 'full' (Phase 3 behaviour).
 * @param {object} [p.requirements]  Phase 4: cross-exam-mapping byExam[examId] → per-topic exam requirements
 */
export function calculateProgress({ model, db, config, now = new Date(), stageId = null, sync = null, requirements = null }) {
  const cfg = compileConfig(config);
  const examId = model.examId;
  const ep = db?.progress?.exams?.[examId];
  const topicRecs = ep?.topics ?? {};
  const subRecs = ep?.subtopics ?? {};
  const sharedOn = cfg.sharedLearning.enabled && db?.progress?.settings?.sharedLearning !== false && db?.syncSettings?.enabled !== false;
  const modeOf = (topicId) => (sharedOn ? (sync?.modeFor(topicId) ?? 'full') : 'independent');
  const cap = cfg.sharedLearning.capScore;
  const shared = db?.sharedLearning ?? { topics: {}, subtopics: {} };
  const sessions = db?.practice?.exams?.[examId]?.sessions ?? [];
  const diagnostics = { warnings: [...model.warnings], orphanRecords: [], ignoredSessions: [] };

  if (stageId && !model.stages.some((s) => s.id === stageId)) {
    diagnostics.warnings.push(`stage '${stageId}' is not part of track '${model.trackId}'; showing the whole exam`);
    stageId = null;
  }
  if (stageId && !model.stages.find((s) => s.id === stageId).sections.length)
    diagnostics.warnings.push(`stage '${stageId}' has no syllabus (e.g. medical/document verification); completion is reported as 0`);

  // Index practice sessions by node; sessions for nodes outside this exam are ignored (reported).
  const byNode = new Map();
  for (const s of sessions) {
    if (!model.topics[s.nodeId] && !model.subtopics[s.nodeId]) { diagnostics.ignoredSessions.push(s.id); continue; }
    if (!byNode.has(s.nodeId)) byNode.set(s.nodeId, []);
    byNode.get(s.nodeId).push(s);
  }
  for (const id of Object.keys(topicRecs)) if (!model.topics[id]) diagnostics.orphanRecords.push(id);
  for (const id of Object.keys(subRecs)) if (!model.subtopics[id]) diagnostics.orphanRecords.push(id);

  // ── 1. Subtopic level ──
  const subs = {};
  for (const [subId, meta] of Object.entries(model.subtopics)) {
    const tRec = topicRecs[meta.topicId];
    const sRec = subRecs[subId];
    let ownStatus = 'not-started', source = 'default';
    if (sRec?.status) { ownStatus = sRec.status; source = 'subtopic'; }
    else if (tRec?.status) { ownStatus = tRec.status; source = 'topic'; }
    if (!cfg.isStatus(ownStatus)) { diagnostics.warnings.push(`${subId}: unknown status '${ownStatus}' treated as not-started`); ownStatus = 'not-started'; }
    let ownScore = cfg.score(ownStatus);
    if (Number.isFinite(sRec?.completionOverride)) { ownScore = clampPct(sRec.completionOverride); source = 'override'; }
    else if (!sRec?.status && Number.isFinite(tRec?.completionOverride)) { ownScore = clampPct(tRec.completionOverride); source = 'topic-override'; }

    // sync mode: per-exam opt-out (shareLearning=false) always wins, then the topic's mode
    const syncMode = tRec?.shareLearning === false || sRec?.shareLearning === false ? 'independent' : modeOf(meta.topicId);
    const shareEnabled = syncMode !== 'independent';
    // shared conceptual score = max(subtopic concept status, topic concept completion), capped at the concept level
    const subShared = shared.subtopics?.[subId];
    const subScore = subShared && cfg.isStatus(subShared.status) ? cfg.score(subShared.status) : 0;
    const topicScore = (conceptPctOf(shared.topics?.[meta.topicId], cfg) * cap) / 100;
    const sharedScore = Math.min(cap, Math.max(subScore, topicScore));
    const sharedStatus = sharedScore > 0 ? cfg.statusAtOrBelow(sharedScore) : null;
    const useShared = shareEnabled && sharedScore > ownScore;
    const completion = clampPct(useShared ? sharedScore : ownScore);
    // full: the shared concept status is shown; partial: completion is shared but the exam keeps its own status
    const effectiveStatus = useShared && syncMode === 'full' ? cfg.statusAtOrBelow(sharedScore) : ownStatus;

    const stats = aggregateStats({ sessions: byNode.get(subId) ?? [], records: [sRec], cfg });
    const concept = cfg.mastery.conceptScore(cfg.mastery.conceptSource === 'effective' ? effectiveStatus : ownStatus);
    const ms = scoreMastery({ concept, stats, level: 'subtopic', cfg, now });
    const mastery = Number.isFinite(sRec?.masteryOverride) ? clampPct(sRec.masteryOverride) : ms.score;
    subs[subId] = {
      id: subId, topicId: meta.topicId, name: meta.name,
      status: sRec?.status ?? null, inheritedStatus: source === 'topic' ? ownStatus : null, effectiveStatus, completionSource: useShared ? 'shared' : source,
      completion, ownCompletion: clampPct(ownScore), mastery, masteryLevel: cfg.mastery.levelFor(mastery, stats.attempted > 0 || Number.isFinite(sRec?.masteryOverride)),
      masteryComponents: ms.components, masteryOverridden: Number.isFinite(sRec?.masteryOverride),
      concept, sharedLearning: { enabled: shareEnabled, syncMode, status: sharedStatus, score: sharedScore, applied: useShared },
      ...practiceFields(stats), ...recordFields(sRec),
    };
  }

  // ── 2. Tree rollup (per occurrence) ──
  const inScope = (st) => !stageId || st.stageId === stageId;
  const stages = model.stages.map((st) => {
    const sections = st.sections.map((sec) => {
      const topics = sec.topics.map((tp) => {
        let c = 0, m = 0;
        const subtopics = tp.subtopics.map((s) => {
          c += s.w * subs[s.id].completion;
          return { id: s.id, weightInTopic: s.w * 100 };
        });
        return { topicId: tp.topicId, name: tp.name, w: tp.w, completion: clampPct(c), subtopics };
      });
      const completion = clampPct(topics.reduce((a, t) => a + t.w * t.completion, 0));
      return { sectionId: sec.id, key: sec.key, name: sec.name, gate: sec.gate, active: sec.active, choiceGroup: sec.choiceGroup, w: sec.w, completion, topics };
    });
    const completion = clampPct(sections.reduce((a, s) => a + s.w * s.completion, 0));
    return { stageId: st.id, name: st.name, gate: st.gate, w: st.w, completion, sections };
  });

  // ── 3. Topic level (exam-specific aggregates) ──
  const topics = {};
  for (const [topicId, T] of Object.entries(model.topics)) {
    const tRec = topicRecs[topicId];
    const occ = T.occurrences.filter((o) => !stageId || o.stageId === stageId);
    const weightOf = (o) => (stageId ? o.stageW : o.examW);
    const effectiveWeight = occ.reduce((a, o) => a + weightOf(o), 0);
    // completion of the topic = weight-averaged over its occurrences (relative weights when the topic only sits in gates)
    const occW = occ.map((o) => weightOf(o));
    const occSum = occW.reduce((a, b) => a + b, 0);
    const occCompletion = occ.map((o) => o.node.subtopics.reduce((a, s) => a + s.w * subs[s.id].completion, 0));
    const occOwn = occ.map((o) => o.node.subtopics.reduce((a, s) => a + s.w * subs[s.id].ownCompletion, 0));
    const avgOcc = (vals) => (occ.length ? clampPct(occSum > 0 ? occW.reduce((a, w, i) => a + w * vals[i], 0) / occSum : vals.reduce((a, b) => a + b, 0) / occ.length) : 0);
    const completion = avgOcc(occCompletion);
    const ownCompletion = avgOcc(occOwn);
    // concept understanding of the topic: subtopic concept scores weighted like completion (all occurrences)
    const subW = {};
    const anyWeighted = T.occurrences.some((o) => o.examW > 0);
    for (const o of T.occurrences)
      for (const s of o.node.subtopics) subW[s.id] = (subW[s.id] ?? 0) + (anyWeighted ? o.examW * s.w : s.w); // gate-only topics: relative weights
    const subWSum = Object.values(subW).reduce((a, b) => a + b, 0);
    const concept = subWSum > 0 ? Object.entries(subW).reduce((a, [id, w]) => a + w * subs[id].concept, 0) / subWSum : 0;
    // practice: every session in the topic subtree, counted once
    const topicSessions = [...(byNode.get(topicId) ?? []), ...T.subtopicIds.flatMap((id) => byNode.get(id) ?? [])];
    const stats = aggregateStats({ sessions: topicSessions, records: [tRec, ...T.subtopicIds.map((id) => subRecs[id])], cfg });
    // exam-specific requirement: mapping default (Phase 4) overridden by the record's own targets
    const mappedReq = requirements?.[topicId]?.requirement ?? null;
    const requirement = mappedReq || tRec?.targets ? { ...(mappedReq ?? {}), ...(tRec?.targets ?? {}), source: tRec?.targets ? 'user-override' : mappedReq?.source ?? null } : null;
    const ms = scoreMastery({ concept, stats, level: 'topic', cfg, now, targets: requirement });
    const masteryOverridden = Number.isFinite(tRec?.masteryOverride);
    const mastery = masteryOverridden ? clampPct(tRec.masteryOverride) : ms.score;
    const syncMode = tRec?.shareLearning === false ? 'independent' : modeOf(topicId);
    const subList = T.subtopicIds.map((id) => subs[id]);
    const sharedTopicRec = shared.topics?.[topicId];
    topics[topicId] = {
      topicId, name: T.name, subject: T.subject, priority: T.priority,
      trend: T.trend ?? null, weightageConfidence: T.weightageConfidence ?? null,
      masterTopicId: sync?.masterOf?.(topicId) ?? null,
      inScope: occ.length > 0, isGateOnly: occ.length > 0 && occSum === 0,
      effectiveWeight: effectiveWeight * 100,
      status: tRec?.status ?? null,
      completion, ownCompletion, sharedUplift: completion - ownCompletion, mastery, masteryOverridden,
      masteryLevel: cfg.mastery.levelFor(mastery, stats.attempted > 0 || masteryOverridden),
      masteryComponents: ms.components, concept,
      contribution: effectiveWeight * completion, // percentage points of the scope (weight fraction × 0–100)
      remaining: effectiveWeight * (100 - completion), // percentage points still to cover
      category: categoryOf(completion, cfg),
      sharedLearning: {
        enabled: syncMode !== 'independent', syncMode, subtopicsUsingShared: subList.filter((s) => s.sharedLearning.applied).length,
        conceptStatus: sharedTopicRec?.status ?? null, conceptCompletion: round2(conceptPctOf(sharedTopicRec, cfg)),
      },
      requirement,
      targetsMet: targetsMet(stats, requirement),
      practiceByStage: practiceByStage(topicSessions, cfg),
      stagePreparation: stagePreparation(requirements?.[topicId]?.stageRequirements, tRec?.targets, topicSessions, cfg),
      subtopicIds: T.subtopicIds,
      occurrences: T.occurrences.map((o) => ({ stageId: o.stageId, sectionKey: o.sectionKey, weightInExam: o.examW * 100, weightInStage: o.stageW * 100 })),
      ...practiceFields(stats), ...recordFields(tRec),
    };
  }

  // ── 4. Mastery rollups (same weights as completion) ──
  for (const st of stages) {
    for (const sec of st.sections) {
      for (const tp of sec.topics) tp.mastery = topics[tp.topicId].mastery;
      sec.mastery = clampPct(sec.topics.reduce((a, t) => a + t.w * t.mastery, 0));
    }
    st.mastery = clampPct(st.sections.reduce((a, s) => a + s.w * s.mastery, 0));
  }

  // ── 5. Scope summary ──
  const scoped = stages.filter(inScope);
  const scopeW = (st) => (stageId ? 1 : st.w);
  const completion = clampPct(scoped.reduce((a, st) => a + scopeW(st) * st.completion, 0));
  const mastery = clampPct(scoped.reduce((a, st) => a + scopeW(st) * st.mastery, 0));
  // own (exam-only) completion over the same scope = completion without any shared concept uplift
  let ownCompletion = 0;
  for (const st of model.stages) {
    if (stageId && st.id !== stageId) continue;
    const sw = stageId ? 1 : st.w;
    for (const sec of st.sections) for (const tp of sec.topics) for (const s of tp.subtopics) ownCompletion += sw * sec.w * tp.w * s.w * subs[s.id].ownCompletion;
  }
  ownCompletion = clampPct(ownCompletion);
  const scopeTopics = Object.values(topics).filter((t) => t.inScope);
  const C = cfg.classification;
  const isMastered = (t) => t.mastery >= C.masteredMasteryAtOrAbove && (t.attempted >= C.masteredMinQuestions || t.masteryOverridden);
  const highWeightIncomplete = scopeTopics
    .filter((t) => !t.isGateOnly && C.highWeightPriorities.includes(t.priority) && t.completion < C.highWeightIncompleteBelow)
    .sort((a, b) => b.remaining - a.remaining)
    .slice(0, C.highWeightLimit)
    .map((t) => ({ topicId: t.topicId, name: t.name, priority: t.priority, effectiveWeight: round2(t.effectiveWeight), completion: round2(t.completion), mastery: round2(t.mastery), remainingWeight: round2(t.remaining) }));
  const gates = [];
  for (const st of scoped) for (const sec of st.sections) if (st.gate || sec.gate) gates.push({ stageId: st.stageId, sectionId: sec.sectionId, name: sec.name, completion: round2(sec.completion), passFail: true });

  const sectionWise = scoped.flatMap((st) => st.sections.filter((s) => s.active).map((s) => ({
    stageId: st.stageId, sectionId: s.sectionId, key: s.key, name: s.name, gate: st.gate || s.gate,
    weightInStage: round2(s.w * 100), weightInScope: round2(scopeW(st) * s.w * 100),
    completion: round2(s.completion), mastery: round2(s.mastery),
  })));

  const allStats = aggregateStats({ sessions: [...byNode.values()].flat(), records: [...Object.values(topicRecs), ...Object.values(subRecs)].filter(Boolean), cfg });

  return {
    examId, shortName: model.shortName, category: model.category, trackId: model.trackId, trackName: model.trackName,
    scope: stageId ? { type: 'stage', stageId } : { type: 'exam' },
    calculatedAt: now.toISOString(),
    summary: {
      syllabusCompletion: round2(completion),
      ownSyllabusCompletion: round2(ownCompletion),
      sharedLearningUplift: round2(completion - ownCompletion),
      examMastery: round2(mastery),
      remainingWeightedSyllabus: round2(100 - completion),
      topicCounts: {
        total: scopeTopics.length,
        completed: scopeTopics.filter((t) => t.category === 'completed').length,
        inProgress: scopeTopics.filter((t) => t.category === 'in-progress').length,
        pending: scopeTopics.filter((t) => t.category === 'pending').length,
        mastered: scopeTopics.filter(isMastered).length,
        markedMasteredStatus: scopeTopics.filter((t) => t.status === 'mastered').length,
      },
      practice: practiceFields(allStats),
    },
    analytics: {
      sectionWise,
      completedTopics: scopeTopics.filter((t) => t.category === 'completed').map((t) => t.topicId),
      inProgressTopics: scopeTopics.filter((t) => t.category === 'in-progress').map((t) => t.topicId),
      pendingTopics: scopeTopics.filter((t) => t.category === 'pending').map((t) => t.topicId),
      masteredTopics: scopeTopics.filter(isMastered).map((t) => t.topicId),
      highWeightIncomplete,
      gates,
    },
    stages: stages.map((st) => ({
      stageId: st.stageId, name: st.name, gate: st.gate, inScope: inScope(st),
      weightInExam: round2(st.w * 100), completion: round2(st.completion), mastery: round2(st.mastery),
      sections: st.sections.map((s) => ({
        sectionId: s.sectionId, key: s.key, name: s.name, gate: s.gate, active: s.active, choiceGroup: s.choiceGroup,
        weightInStage: round2(s.w * 100), weightInExam: round2(st.w * s.w * 100), completion: round2(s.completion), mastery: round2(s.mastery),
        topics: s.topics.map((t) => ({
          topicId: t.topicId, name: t.name, weightInSection: round2(t.w * 100), weightInExam: round2(st.w * s.w * t.w * 100),
          completion: round2(t.completion), mastery: round2(t.mastery), contribution: round2((st.w * s.w * t.w) * t.completion), subtopics: t.subtopics,
        })),
      })),
    })),
    topics: mapValues(topics, roundRecord),
    subtopics: mapValues(subs, roundRecord),
    diagnostics,
  };
}

/** Exam-specific targets check (null when the requirement sets no targets, e.g. skill/descriptive). */
function targetsMet(stats, req) {
  if (!req || (req.questionTarget == null && req.accuracyTarget == null && req.speedTargetSec == null)) return null;
  const questions = req.questionTarget == null ? null : stats.attempted >= req.questionTarget;
  const accuracy = req.accuracyTarget == null ? null : stats.accuracy !== null && stats.accuracy >= req.accuracyTarget;
  const speed = req.speedTargetSec == null ? null : stats.avgTimeSeconds !== null && stats.avgTimeSeconds <= req.speedTargetSec;
  const gaps = [];
  if (questions === false) gaps.push({ target: 'questions', have: stats.attempted, need: req.questionTarget });
  if (accuracy === false) gaps.push({ target: 'accuracy', have: stats.accuracy === null ? null : round2(stats.accuracy), need: req.accuracyTarget });
  if (speed === false) gaps.push({ target: 'speed', have: stats.avgTimeSeconds === null ? null : round2(stats.avgTimeSeconds), need: req.speedTargetSec });
  return { questions, accuracy, speed, all: gaps.length === 0, gaps };
}

/** Practice split by the stage it was done for (prelims / mains …); 'unspecified' when not recorded. */
function practiceByStage(sessions, cfg) {
  const groups = {};
  for (const s of sessions) (groups[s.stageId ?? 'unspecified'] ??= []).push(s);
  return Object.fromEntries(Object.entries(groups).map(([k, list]) => {
    const st = aggregateStats({ sessions: list, cfg });
    return [k, { attempted: st.attempted, correct: st.correct, accuracy: st.accuracy === null ? null : round2(st.accuracy), avgTimeSeconds: st.avgTimeSeconds === null ? null : round2(st.avgTimeSeconds), practiceSets: st.practiceSets, revisionCount: st.revisionCount }];
  }));
}

/**
 * Prelims vs mains (per stage) readiness: each stage's own requirement checked against the practice
 * logged for that stage only. Practice without a stage counts toward the exam-level check, not here.
 */
function stagePreparation(stageReqs, userTargets, sessions, cfg) {
  if (!stageReqs) return null;
  const byStage = {};
  for (const [key, req] of Object.entries(stageReqs)) { const sid = key.split('/')[0]; byStage[sid] ??= req; }
  return Object.fromEntries(Object.entries(byStage).map(([sid, req]) => {
    const merged = { ...req, ...(userTargets ?? {}) };
    const st = aggregateStats({ sessions: sessions.filter((s) => s.stageId === sid), cfg });
    return [sid, { stageClass: req.stageClass, requirement: merged, attempted: st.attempted, accuracy: st.accuracy === null ? null : round2(st.accuracy), avgTimeSeconds: st.avgTimeSeconds === null ? null : round2(st.avgTimeSeconds), targetsMet: targetsMet(st, merged) }];
  }));
}

function categoryOf(completion, cfg) {
  if (completion >= cfg.classification.completedAtOrAbove) return 'completed';
  if (completion > 0) return 'in-progress';
  return 'pending';
}
function practiceFields(st) {
  return {
    attempted: st.attempted, correct: st.correct, incorrect: st.incorrect, accuracy: st.accuracy,
    practiceSets: st.practiceSets, avgTimeSeconds: st.avgTimeSeconds, revisionCount: st.revisionCount,
    revisionAccuracy: st.revisionAccuracy, lastPracticed: st.lastPracticed, lastRevised: st.lastRevised,
    practiceDifficulty: st.practiceDifficulty,
  };
}
function recordFields(r) {
  return {
    targetDifficulty: r?.difficulty ?? null, notes: r?.notes ?? '', startDate: r?.startDate ?? null,
    completionDate: r?.completionDate ?? null, lastUpdated: r?.lastUpdated ?? null,
  };
}
const NUMERIC_KEYS = ['completion', 'ownCompletion', 'sharedUplift', 'mastery', 'concept', 'effectiveWeight', 'contribution', 'remaining', 'accuracy', 'avgTimeSeconds', 'revisionAccuracy'];
function roundRecord(r) {
  const o = { ...r };
  for (const k of NUMERIC_KEYS) if (typeof o[k] === 'number') o[k] = round2(o[k]);
  if (o.masteryComponents) o.masteryComponents = mapValues(o.masteryComponents, round2);
  return o;
}
const mapValues = (obj, f) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, f(v)]));
export { topicOf };
