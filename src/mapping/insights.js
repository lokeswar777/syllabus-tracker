/**
 * Shared-topic dashboard data and cross-exam insights (pure; no I/O, no UI).
 * Inputs are the engine's per-exam reports (calculateProgress with sync + requirements), the mapping
 * and the shared-learning collection. Nothing here writes progress.
 */

const HIGH = ['Very High', 'High'];
const describe = (d) => (d ? d.replace(/\.\s*$/, '').replace(/^./, (c) => c.toLowerCase()) : 'exam-level questions');
const round2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : 0);

function indexReports(reports, examIds) {
  const exams = examIds.filter((e) => reports[e]);
  const category = Object.fromEntries(exams.map((e) => [e, reports[e].category]));
  const topicsOf = Object.fromEntries(exams.map((e) => [e, new Set(Object.keys(reports[e].topics))]));
  return { exams, category, topicsOf };
}
/** Stage-level preparation entries of an exam topic; falls back to the exam-level requirement. */
function stagesOf(x) {
  if (x.stagePreparation && Object.keys(x.stagePreparation).length)
    return Object.entries(x.stagePreparation).map(([stageId, s]) => ({ stageId, stageClass: s.stageClass, requirement: s.requirement, targetsMet: s.targetsMet }));
  return [{ stageId: null, stageClass: x.requirement?.stageClass ?? null, requirement: x.requirement, targetsMet: x.targetsMet }];
}
const gapText = (gaps = []) => gaps.map((g) => g.target === 'questions' ? `${Math.max(0, g.need - (g.have ?? 0))} more questions (target ${g.need})`
  : g.target === 'accuracy' ? `accuracy ${g.have ?? '–'}% → ${g.need}%` : `speed ${g.have ?? '–'} s → ≤ ${g.need} s per question`);
const conceptPct = (topicId, reports, exams) => {
  for (const e of exams) { const t = reports[e].topics[topicId]; if (t) return t.sharedLearning?.conceptCompletion ?? 0; }
  return 0;
};

/**
 * Data for the shared-topic dashboard.
 * @param {object} p
 * @param {object} p.reports        { examId: report }
 * @param {string[]} p.examIds      selected exams
 * @param {object} p.mapping        { masterTopics, crossExamMapping }
 * @param {object} [p.thresholds]   { conceptCompleted: 100 }
 */
export function buildSharedTopicDashboard({ reports, examIds, mapping, thresholds = {} }) {
  const conceptDone = thresholds.conceptCompleted ?? 100;
  const { exams, category, topicsOf } = indexReports(reports, examIds);
  const ssc = exams.filter((e) => category[e] === 'ssc');
  const banking = exams.filter((e) => category[e] === 'banking');
  const all = new Set(exams.flatMap((e) => [...topicsOf[e]]));
  const inAll = (list, t) => list.length > 0 && list.every((e) => topicsOf[e].has(t));
  const inAny = (list, t) => list.some((e) => topicsOf[e].has(t));
  const masterOf = (t) => exams.map((e) => reports[e].topics[t]?.masterTopicId).find(Boolean) ?? null;
  const nameOf = (t) => exams.map((e) => reports[e].topics[t]?.name).find(Boolean) ?? t;
  const item = (t) => ({ topicId: t, masterTopicId: masterOf(t), name: nameOf(t) });
  const sorted = (ids) => [...ids].sort().map(item);

  const groups = {
    commonToAllSelected: sorted([...all].filter((t) => inAll(exams, t))),
    commonToSSC: ssc.length >= 2 ? sorted([...all].filter((t) => inAll(ssc, t))) : [],
    commonToBanking: banking.length >= 2 ? sorted([...all].filter((t) => inAll(banking, t))) : [],
    uniqueToSSC: sorted([...all].filter((t) => inAny(ssc, t) && !inAny(banking, t))),
    uniqueToBanking: sorted([...all].filter((t) => inAny(banking, t) && !inAny(ssc, t))),
  };

  const masters = new Map(mapping.masterTopics.masters.map((m) => [m.masterTopicId, m]));
  const cards = {};
  for (const t of all) {
    const mid = masterOf(t);
    if (!mid) continue;
    const linked = exams.filter((e) => topicsOf[e].has(t));
    if (linked.length < 2) continue;
    const m = masters.get(mid);
    cards[mid] = {
      masterTopicId: mid, topicId: t, name: m?.name ?? nameOf(t), subject: m?.subject ?? null,
      similarity: m?.similarity.level ?? null, verification: m?.verification.status ?? null,
      concept: { completion: round2(conceptPct(t, reports, linked)), status: reports[linked[0]].topics[t].sharedLearning.conceptStatus },
      exams: Object.fromEntries(linked.map((e) => {
        const r = reports[e].topics[t];
        return [e, {
          category: category[e], syncMode: r.sharedLearning.syncMode, status: r.status, completion: r.completion, ownCompletion: r.ownCompletion,
          mastery: r.mastery, masteryLevel: r.masteryLevel, attempted: r.attempted, accuracy: r.accuracy, avgTimeSeconds: r.avgTimeSeconds,
          effectiveWeight: r.effectiveWeight, priority: r.priority, requirement: r.requirement, targetsMet: r.targetsMet, practiceByStage: r.practiceByStage,
          stagePreparation: r.stagePreparation,
        }];
      })),
    };
  }

  const sharedConceptsCompleted = Object.values(cards).filter((c) => c.concept.completion >= conceptDone)
    .map((c) => ({ masterTopicId: c.masterTopicId, name: c.name, exams: Object.keys(c.exams) }));
  // pending exam-specific practice, per stage (prelims and mains have different targets)
  const examSpecificPracticePending = [];
  for (const c of Object.values(cards)) {
    if (c.concept.completion < conceptDone) continue;
    for (const [e, x] of Object.entries(c.exams)) {
      if (x.syncMode === 'independent') continue;
      for (const s of stagesOf(x)) if (s.targetsMet && !s.targetsMet.all) examSpecificPracticePending.push({ masterTopicId: c.masterTopicId, name: c.name, examId: e, stageId: s.stageId, stageClass: s.stageClass, gaps: s.targetsMet.gaps, requirement: s.requirement });
    }
  }
  return {
    selectedExams: exams,
    examsByCategory: { ssc, banking },
    groups,
    counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
    sharedConceptsCompleted,
    examSpecificPracticePending,
    topicCards: cards,
  };
}

/**
 * Cross-exam insights: where shared learning saves preparation time and what exam-specific work remains.
 * No time is estimated in hours (no reliable data): savings are expressed as concept-learning repetitions
 * avoided and as weighted completion points contributed by shared learning.
 */
export function buildCrossExamInsights({ reports, examIds, mapping, thresholds = {} }) {
  const dash = buildSharedTopicDashboard({ reports, examIds, mapping, thresholds });
  const conceptDone = thresholds.conceptCompleted ?? 100;
  const completedAt = thresholds.examCompleted ?? 90;
  const cards = Object.values(dash.topicCards);

  const recommendations = [];
  for (const c of cards) {
    const linked = Object.entries(c.exams).filter(([, x]) => x.syncMode !== 'independent');
    if (c.concept.completion >= conceptDone) {
      for (const [e, x] of linked) {
        for (const s of stagesOf(x)) {
          if (s.targetsMet?.all !== false && x.completion >= completedAt) continue;
          if (s.targetsMet?.all === true) continue;
          const req = s.requirement ?? {};
          const gaps = gapText(s.targetsMet?.gaps);
          const where = s.stageId ? `${reports[e].shortName} ${s.stageClass === 'prelims' || s.stageClass === 'mains' ? s.stageClass : s.stageId}` : reports[e].shortName;
          recommendations.push({
            type: 'practice-exam-pattern', masterTopicId: c.masterTopicId, topicId: c.topicId, examId: e, stageId: s.stageId, stageClass: s.stageClass,
            priority: x.priority, effectiveWeight: x.effectiveWeight,
            message: `${c.name}: concept already completed, so skip basic concept learning for ${where}. Practise ${describe(req.depthDescription)}${gaps.length ? ` (${gaps.join('; ')})` : ''}.`,
            requirement: req, gaps: s.targetsMet?.gaps ?? [],
          });
        }
      }
    } else if (linked.length >= 2) {
      const weight = linked.reduce((a, [, x]) => a + (x.effectiveWeight ?? 0), 0);
      recommendations.push({
        type: 'finish-shared-concept', masterTopicId: c.masterTopicId, topicId: c.topicId, examId: null, priority: null, effectiveWeight: weight,
        message: `${c.name}: concept ${c.concept.completion}% complete. Finishing it once benefits ${linked.length} exams (${linked.map(([e]) => reports[e].shortName).join(', ')}).`,
        benefitsExams: linked.map(([e]) => e),
      });
    }
  }
  const prio = (p) => (p === 'Very High' ? 0 : p === 'High' ? 1 : p === 'Medium' ? 2 : 3);
  recommendations.sort((a, b) => (a.type === b.type ? 0 : a.type === 'practice-exam-pattern' ? -1 : 1) || prio(a.priority) - prio(b.priority) || b.effectiveWeight - a.effectiveWeight);

  const remainingExamSpecific = {};
  for (const e of dash.selectedExams) {
    const list = cards.filter((c) => c.exams[e] && c.concept.completion >= conceptDone && c.exams[e].syncMode !== 'independent' && (c.exams[e].completion < completedAt || c.exams[e].targetsMet?.all === false))
      .map((c) => ({ masterTopicId: c.masterTopicId, name: c.name, completion: c.exams[e].completion, effectiveWeight: c.exams[e].effectiveWeight, gaps: c.exams[e].targetsMet?.gaps ?? [] }))
      .sort((a, b) => b.effectiveWeight - a.effectiveWeight);
    remainingExamSpecific[e] = { topics: list.length, remainingWeight: round2(list.reduce((a, x) => a + x.effectiveWeight * (100 - x.completion) / 100, 0)), list };
  }

  const examsBenefiting = dash.selectedExams.map((e) => ({
    examId: e, shortName: reports[e].shortName,
    sharedLearningUplift: reports[e].summary.sharedLearningUplift,
    topicsUsingShared: Object.values(reports[e].topics).filter((t) => t.sharedUplift > 0).length,
  })).filter((x) => x.sharedLearningUplift > 0).sort((a, b) => b.sharedLearningUplift - a.sharedLearningUplift);

  const commonHighWeightage = cards.map((c) => {
    const highIn = Object.entries(c.exams).filter(([, x]) => HIGH.includes(x.priority)).map(([e]) => e);
    return { masterTopicId: c.masterTopicId, name: c.name, highIn, combinedWeight: round2(Object.values(c.exams).reduce((a, x) => a + (x.effectiveWeight ?? 0), 0)), conceptCompletion: c.concept.completion,
      exams: Object.fromEntries(Object.entries(c.exams).map(([e, x]) => [e, { priority: x.priority, effectiveWeight: x.effectiveWeight, completion: x.completion }])) };
  }).filter((x) => x.highIn.length >= 2).sort((a, b) => b.highIn.length - a.highIn.length || b.combinedWeight - a.combinedWeight);

  const done = cards.filter((c) => c.concept.completion >= conceptDone);
  return {
    selectedExams: dash.selectedExams,
    sharedConceptsCompleted: dash.sharedConceptsCompleted,
    conceptReuse: {
      conceptsCompleted: done.length,
      repetitionsAvoided: done.reduce((a, c) => a + Math.max(0, Object.values(c.exams).filter((x) => x.syncMode !== 'independent').length - 1), 0),
      note: 'Each completed shared concept is learned once instead of once per linked exam. No hours are estimated (no reliable data).',
    },
    remainingExamSpecific,
    examsBenefiting,
    commonHighWeightage,
    recommendations,
  };
}
