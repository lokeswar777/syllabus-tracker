/**
 * Daily study plan (pure).
 *   budget        = available hours × 60 (completed and manual tasks already in today's plan count against it)
 *   1. revisions  : topics with a revision overdue / due today, by priority, up to revisionMaxShare of the budget
 *   2. mock test  : one exam-level mock when the exam is mock-ready and the gap since the last mock ≥ minGapDays
 *   3. topics     : remaining recommendations by combined priority score
 *   Constraints   : one task per topic per day, ≤ maxTasksPerSubject per subject, ≤ maxTasks, task must fit the time left
 *   User edits    : manual tasks, removals and custom order are kept on regeneration; nothing is auto-completed.
 */

export function estimateMinutes(action, row, cfg, pendingCount = 1) {
  const M = cfg.dailyPlan.minutes;
  const d = row?.requirement?.difficulty ?? 'medium';
  switch (action) {
    case 'learn-concept': return M['learn-concept'][d] ?? M['learn-concept'].medium;
    case 'complete-subtopics': return Math.min(M['complete-subtopics'].max, M['complete-subtopics'].perSubtopic * Math.max(1, pendingCount));
    case 'practice-questions': {
      const P = M['practice-questions'];
      const sec = row?.requirement?.speedTargetSec ?? P.defaultSecondsPerQuestion;
      return Math.min(P.max, Math.max(P.min, Math.ceil((P.questionsPerSession * sec * P.overheadFactor) / 60)));
    }
    case 'revise-notes': return M['revise-notes'][d] ?? M['revise-notes'].medium;
    case 'sectional-test': return M['sectional-test'];
    case 'mock-test': return M['mock-test'];
    default: return 30;
  }
}

export const taskIdOf = (date, kind, key, action) => `${date}:${kind}:${key}:${action}`;

function topicTask(date, topic, cfg, { revisionFirst = false } = {}) {
  const row = topic.perExam[topic.primaryExamId];
  const revExams = Object.values(topic.perExam).filter((r) => ['overdue', 'due-today'].includes(r.revision.status));
  const action = revisionFirst ? { action: 'revise-notes', detail: revExams[0].action.detail } : row.action;
  const minutes = estimateMinutes(action.action, row, cfg, action.pendingSubtopics?.length ?? 1);
  return {
    taskId: taskIdOf(date, 'topic', topic.topicId, action.action),
    kind: 'topic', topicId: topic.topicId, name: topic.name, subject: topic.subject,
    examIds: revisionFirst ? revExams.map((r) => r.examId) : topic.exams, primaryExamId: revisionFirst ? revExams[0].examId : topic.primaryExamId,
    section: row.section?.name ?? null,
    action: action.action, detail: action.detail, minutes,
    priorityScore: topic.score, classification: topic.classification,
    reason: (revisionFirst ? revExams[0].reasons : row.reasons)[0] ?? null,
    source: 'auto', status: 'pending',
  };
}

export function buildDailyPlan({ date, hours, topics, mockCandidates = [], existing = null, cfg, now }) {
  const D = cfg.dailyPlan;
  const budget = Math.round(hours * 60);
  const removed = new Set(existing?.removed ?? []);
  const kept = (existing?.tasks ?? []).filter((t) => t.source === 'manual' || t.status === 'completed');
  const tasks = [...kept];
  const usedTopics = new Set(kept.filter((t) => t.topicId).map((t) => t.topicId));
  const perSubject = {};
  for (const t of kept) if (t.subject) perSubject[t.subject] = (perSubject[t.subject] ?? 0) + 1;
  let used = kept.reduce((a, t) => a + (t.minutes ?? 0), 0);
  const fits = (t) => used + t.minutes <= budget && tasks.length < D.maxTasks;
  const allowed = (t) => !removed.has(t.taskId) && !removed.has(`topic:${t.topicId}`) && !(t.topicId && usedTopics.has(t.topicId)) && (!t.subject || (perSubject[t.subject] ?? 0) < D.maxTasksPerSubject);
  const add = (t) => { tasks.push(t); used += t.minutes; if (t.topicId) usedTopics.add(t.topicId); if (t.subject) perSubject[t.subject] = (perSubject[t.subject] ?? 0) + 1; };
  const live = topics.filter((t) => !t.done);

  // 1. revisions first (capped share of the day)
  let revMinutes = 0;
  for (const topic of live) {
    if (!Object.values(topic.perExam).some((r) => ['overdue', 'due-today'].includes(r.revision.status))) continue;
    const t = topicTask(date, topic, cfg, { revisionFirst: true });
    if (revMinutes + t.minutes > budget * D.revisionMaxShare) continue;
    if (allowed(t) && fits(t)) { add(t); revMinutes += t.minutes; }
  }
  // 2. one mock test when due
  for (const m of mockCandidates) {
    const t = { taskId: taskIdOf(date, 'exam', m.examId, 'mock-test'), kind: 'exam', topicId: null, name: `${m.examName} full mock test`, subject: null, examIds: [m.examId], primaryExamId: m.examId, section: null, action: 'mock-test', detail: m.reason, minutes: estimateMinutes('mock-test', null, cfg), priorityScore: null, classification: null, reason: m.reason, source: 'auto', status: 'pending' };
    if (allowed(t) && fits(t) && !tasks.some((x) => x.action === 'mock-test')) { add(t); break; }
  }
  // 3. topics by priority
  for (const topic of live) {
    if (tasks.length >= D.maxTasks) break;
    const t = topicTask(date, topic, cfg);
    if (allowed(t) && fits(t)) add(t);
  }
  // order: custom order from the user is kept; new tasks go to the end
  let ordered = tasks;
  if (existing?.customOrder?.length) {
    const pos = new Map(existing.customOrder.map((id, i) => [id, i]));
    ordered = [...tasks].sort((a, b) => (pos.get(a.taskId) ?? 1e6) - (pos.get(b.taskId) ?? 1e6));
  }
  return {
    date, hours, budgetMinutes: budget, plannedMinutes: used, generatedAt: now.toISOString(),
    tasks: ordered.map((t, i) => ({ ...t, order: i + 1 })),
    removed: [...removed], customOrder: existing?.customOrder ?? null,
  };
}
