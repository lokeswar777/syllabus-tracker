/** Smart preparation insights (pure). */
import { round2 } from './config.js';

const HIGH = ['Very High', 'High'];

export function buildPlannerInsights({ priorities, weakAreas, shares, sharedInsights = null, limit = 10 }) {
  const rows = Object.values(priorities.perExam).flatMap((r) => Object.values(r));
  const name = Object.fromEntries(shares.map((s) => [s.examId, s.examId]));

  const untouchedHighWeight = priorities.topics
    .map((t) => ({ t, rows: Object.values(t.perExam).filter((r) => r.completion === 0 && HIGH.includes(r.priorityClassPhase2)) }))
    .filter((x) => x.rows.length)
    .map(({ t, rows: rs }) => ({ topicId: t.topicId, name: t.name, score: t.score, exams: rs.map((r) => ({ examId: r.examId, effectiveWeight: r.effectiveWeight, phase2Priority: r.priorityClassPhase2 })) }))
    .slice(0, limit);

  const commonAcrossTargets = priorities.topics.filter((t) => t.examCount >= 2)
    .map((t) => ({ topicId: t.topicId, name: t.name, score: t.score, examCount: t.examCount, combinedWeight: round2(Object.values(t.perExam).reduce((a, r) => a + r.share * r.effectiveWeight, 0)), exams: t.exams }))
    .sort((a, b) => b.combinedWeight - a.combinedWeight).slice(0, limit);

  const lowestMasterySections = Object.entries(weakAreas).flatMap(([examId, w]) => w.weakestSections.map((s) => ({ examId, ...s })))
    .sort((a, b) => a.mastery - b.mastery || b.weightInExam - a.weightInExam).slice(0, limit);

  const overdue = rows.filter((r) => r.revision.status === 'overdue');
  const revisionBacklog = {
    overdue: overdue.length,
    dueToday: rows.filter((r) => r.revision.status === 'due-today').length,
    dueSoon: rows.filter((r) => r.revision.status === 'due-soon').length,
    oldestOverdue: overdue.sort((a, b) => b.revision.daysOverdue - a.revision.daysOverdue).slice(0, limit)
      .map((r) => ({ examId: r.examId, topicId: r.topicId, name: r.name, daysOverdue: r.revision.daysOverdue, nextDue: r.revision.nextDue, revisionNumber: r.revision.revisionNumber })),
  };

  const allWeak = Object.entries(weakAreas).flatMap(([examId, w]) => Object.values(w.all).map((x) => ({ examId, ...x })));
  const decliningAccuracy = allWeak.filter((x) => x.flags.includes('declining-accuracy'))
    .map((x) => ({ examId: x.examId, topicId: x.topicId, name: x.name, earlierAccuracy: x.evidence.earlierAccuracy, recentAccuracy: x.evidence.recentAccuracy })).slice(0, limit);
  const morePracticeWouldHelp = allWeak.filter((x) => ['good-accuracy-insufficient-practice', 'studied-not-practised', 'good-concept-poor-speed', 'below-target'].includes(x.category))
    .sort((a, b) => b.effectiveWeight - a.effectiveWeight)
    .map((x) => ({ examId: x.examId, topicId: x.topicId, name: x.name, category: x.category, attempted: x.evidence.attempted, questionTarget: x.evidence.questionTarget, accuracy: x.evidence.accuracy, effectiveWeight: x.effectiveWeight })).slice(0, limit);

  const sharedLearningSavings = sharedInsights ? {
    conceptReuse: sharedInsights.conceptReuse,
    examsBenefiting: sharedInsights.examsBenefiting,
    finishOnceBenefitsMany: sharedInsights.recommendations.filter((r) => r.type === 'finish-shared-concept').slice(0, limit).map((r) => ({ topicId: r.topicId, message: r.message, benefitsExams: r.benefitsExams })),
  } : null;

  return { untouchedHighWeight, commonAcrossTargets, lowestMasterySections, revisionBacklog, decliningAccuracy, morePracticeWouldHelp, sharedLearningSavings, examNames: name };
}
