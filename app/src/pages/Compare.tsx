import { useMemo, useState } from 'react';
import { GitCompareArrows, CheckCircle2, ListTodo, Table2 } from 'lucide-react';
import type { PageProps } from '../App';
import { useApp, useAsync, useLocalPref } from '../lib/hooks';
import { isDone, subjectSummary } from '../lib/selectors';
import { num, pct, subjectLabel } from '../lib/format';
import type { Report } from '../lib/types';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingBlock, PageHeader, Progress, Segmented, cn } from '../components/ui';
import { CompletionMasteryBars, HeatCell, LegendChip } from '../components/charts';

export function ComparePage(_: PageProps) {
  const { store } = useApp();
  const targets = store.planner.settings.targets.map((t) => t.examId);
  const fallback = targets.length >= 2 ? targets : [...new Set([store.activeExamId, ...store.exams.map((e) => e.examId)].filter(Boolean) as string[])].slice(0, 2);
  const [saved, setSaved] = useLocalPref<string[]>('compareExams', fallback);
  const selected = saved.filter((id) => store.exams.some((e) => e.examId === id));
  const toggle = (id: string) => setSaved(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const res = useAsync(() => (selected.length ? store.engine.getCrossExamReports(selected) : Promise.resolve({} as Record<string, Report>)), [store.engine.getVersion(), selected.join(',')]);
  const [metric, setMetric] = useState<'completion' | 'mastery'>('completion');
  const [view, setView] = useState<'subject' | 'section'>('subject');
  const reports = res.data;

  const derived = useMemo(() => {
    if (!reports) return null;
    const ids = selected.filter((id) => reports[id]);
    const overview = ids.map((id) => ({ id, name: reports[id].shortName, completion: reports[id].summary.syllabusCompletion, mastery: reports[id].summary.examMastery, r: reports[id] }));
    const subjects = new Map<string, Record<string, { completion: number; mastery: number }>>();
    for (const id of ids) for (const s of subjectSummary(reports[id])) {
      if (!subjects.has(s.subject)) subjects.set(s.subject, {});
      subjects.get(s.subject)![id] = { completion: s.completion, mastery: s.mastery };
    }
    // topics in ≥ 2 selected exams
    const presence = new Map<string, string[]>();
    for (const id of ids) for (const t of Object.values(reports[id].topics)) if (t.inScope && !t.isGateOnly) presence.set(t.topicId, [...(presence.get(t.topicId) ?? []), id]);
    const sharedCompleted = [...presence.entries()].filter(([, ex]) => ex.length >= 2)
      .filter(([tid, ex]) => ex.every((e) => isDone(reports[e].topics[tid].category)))
      .map(([tid, ex]) => ({ topicId: tid, name: reports[ex[0]].topics[tid].name, exams: ex }));
    const sharedTotal = [...presence.values()].filter((ex) => ex.length >= 2).length;
    const specificPending = Object.fromEntries(ids.map((id) => [id, Object.values(reports[id].topics)
      .filter((t) => t.inScope && !t.isGateOnly && (presence.get(t.topicId)?.length ?? 0) === 1 && !isDone(t.category))
      .sort((a, b) => b.effectiveWeight - a.effectiveWeight)]));
    return { ids, overview, subjects: [...subjects.entries()], sharedCompleted, sharedTotal, specificPending };
  }, [reports, selected]);

  return (
    <div className="space-y-5" data-testid="page-compare">
      <PageHeader title="Exam comparison" description="Each exam is calculated from its own progress and weightage; shared concept learning is counted where it applies." />
      <Card className="p-3">
        <div className="mb-2 text-xs font-medium text-muted">Exams to compare</div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Exams to compare">
          {store.exams.map((e) => {
            const on = selected.includes(e.examId);
            return (
              <button key={e.examId} type="button" aria-pressed={on} onClick={() => toggle(e.examId)}
                className={cn('h-8 rounded-lg border px-3 text-xs font-medium transition-colors', on ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-ink2 hover:bg-subtle')}>
                {e.shortName}
              </button>
            );
          })}
        </div>
      </Card>

      {selected.length === 0 ? <Card><EmptyState icon={GitCompareArrows} title="Select at least one exam" description="Pick two or more exams to compare their preparation." /></Card>
        : res.error ? <Card><ErrorState error={res.error} /></Card>
          : !derived ? <Card><LoadingBlock rows={6} /></Card> : (
            <>
              <div className="grid gap-4 lg:grid-cols-5">
                <Card className="lg:col-span-3">
                  <CardHeader title="Overall completion and mastery" description="Whole exam, all stages" icon={GitCompareArrows} />
                  <CardBody><CompletionMasteryBars data={derived.overview} /></CardBody>
                </Card>
                <Card className="lg:col-span-2">
                  <CardHeader title="Summary" icon={Table2} />
                  <div className="scroll-x px-2 pb-3">
                    <table className="table-base" data-testid="compare-table">
                      <thead><tr><th>Exam</th><th className="text-right">Complete</th><th className="text-right">Mastery</th><th className="text-right">Topics done</th><th className="text-right">Questions</th></tr></thead>
                      <tbody>
                        {derived.overview.map((o) => (
                          <tr key={o.id}>
                            <td className="font-medium">{o.name}</td>
                            <td className="tabular text-right">{pct(o.completion)}</td>
                            <td className="tabular text-right">{pct(o.mastery)}</td>
                            <td className="tabular text-right">{o.r.summary.topicCounts.completed}/{o.r.summary.topicCounts.total}</td>
                            <td className="tabular text-right">{num(o.r.summary.practice.attempted)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>

              <Card>
                <CardHeader title={view === 'subject' ? 'Subject-wise comparison' : 'Section-wise comparison'}
                  description={view === 'subject' ? 'Sections differ between exams, so they are compared by subject, each using its own exam weightage' : 'Each exam’s own sections'}
                  action={<div className="flex flex-wrap gap-2">
                    <Segmented label="Group by" value={view} onChange={setView} options={[{ value: 'subject', label: 'Subjects' }, { value: 'section', label: 'Sections' }]} />
                    <Segmented label="Metric" value={metric} onChange={setMetric} options={[{ value: 'completion', label: 'Completion' }, { value: 'mastery', label: 'Mastery' }]} />
                  </div>} />
                <CardBody>
                  {view === 'subject' ? (
                    <div className="scroll-x">
                      <table className="w-full min-w-[32rem] text-sm" data-testid="subject-heatmap">
                        <thead><tr><th className="px-3 py-2 text-left text-xs font-medium text-muted">Subject</th>{derived.ids.map((id) => <th key={id} className="px-3 py-2 text-center text-xs font-medium text-muted">{store.examName(id)}</th>)}</tr></thead>
                        <tbody>
                          {derived.subjects.map(([subject, byExam]) => (
                            <tr key={subject}>
                              <td className="whitespace-nowrap px-3 py-1 text-sm">{subjectLabel(subject)}</td>
                              {derived.ids.map((id) => <HeatCell key={id} value={byExam[id] ? byExam[id][metric] : null} />)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="mt-2 text-2xs text-muted">Darker = higher {metric}. “–” = subject not in that exam.</p>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {derived.overview.map((o) => (
                        <div key={o.id} className="rounded-lg border border-line p-3">
                          <div className="mb-2 text-sm font-semibold">{o.name}</div>
                          <ul className="space-y-2">
                            {o.r.analytics.sectionWise.filter((s) => !s.gate && s.weightInScope > 0).map((s) => (
                              <li key={s.key}>
                                <div className="flex justify-between gap-2 text-sm"><span className="truncate" title={s.name}>{s.name}</span><span className="tabular text-muted">{pct(s[metric])}</span></div>
                                <Progress value={s[metric]} size="sm" tone={metric === 'mastery' ? 'mastery' : 'accent'} className="mt-1" label={`${o.name} ${s.name} ${metric}`} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex gap-3"><LegendChip color={metric === 'mastery' ? 'mastery' : 'completion'} label={metric === 'mastery' ? 'Exam mastery' : 'Syllabus completion'} /></div>
                </CardBody>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Shared topics completed" description={`${derived.sharedCompleted.length} of ${derived.sharedTotal} topics common to 2+ selected exams are completed in each of them`} icon={CheckCircle2} />
                  <CardBody>
                    {derived.sharedCompleted.length === 0 ? <EmptyState icon={CheckCircle2} title="No shared topics completed yet" description="A shared topic counts here once it is completed in every selected exam that includes it." /> : (
                      <ul className="divide-y divide-line/70" data-testid="shared-completed">
                        {derived.sharedCompleted.map((t) => (
                          <li key={t.topicId} className="flex items-center justify-between gap-2 py-2 text-sm"><span className="truncate">{t.name}</span><span className="flex flex-wrap justify-end gap-1">{t.exams.map((e) => <Badge key={e}>{store.examName(e)}</Badge>)}</span></li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Exam-specific pending topics" description="Topics only in one of the selected exams, not yet completed (highest weight first)" icon={ListTodo} />
                  <CardBody>
                    {derived.ids.length < 2 ? <EmptyState icon={ListTodo} title="Select two or more exams" /> : (
                      <div className="grid gap-4 sm:grid-cols-2" data-testid="specific-pending">
                        {derived.ids.map((id) => (
                          <div key={id}>
                            <div className="mb-1.5 flex items-baseline justify-between text-xs font-medium"><span>{store.examName(id)}</span><span className="text-muted">{derived.specificPending[id].length}</span></div>
                            {derived.specificPending[id].length === 0 ? <p className="text-xs text-muted">None</p> : (
                              <ul className="space-y-1">
                                {derived.specificPending[id].slice(0, 8).map((t) => (
                                  <li key={t.topicId} className="flex justify-between gap-2 text-sm"><span className="truncate">{t.name}</span><span className="tabular shrink-0 text-muted">{pct(t.effectiveWeight)}</span></li>
                                ))}
                                {derived.specificPending[id].length > 8 && <li className="text-2xs text-muted">+{derived.specificPending[id].length - 8} more</li>}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardBody>
                </Card>
              </div>
            </>
          )}
    </div>
  );
}
