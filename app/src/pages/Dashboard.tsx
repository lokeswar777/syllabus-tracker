import { useMemo, useState } from 'react';
import { BookOpenCheck, Gauge, CheckCircle2, ListTodo, RotateCcw, TrendingUp, Target, AlertTriangle, CalendarCheck, ArrowRight, ShieldCheck, Activity } from 'lucide-react';
import type { PageProps } from '../App';
import { useApp, useAsync } from '../lib/hooks';
import { useExam, WEAK_LABEL } from '../lib/useExam';
import { historySeries, practiceTrend, scopedSessions, statusDistribution } from '../lib/selectors';
import { num, pct, shortDate } from '../lib/format';
import { Badge, Button, Card, CardBody, CardHeader, ClassBadge, EmptyState, PageHeader, Progress, RevisionBadge, Segmented, Stat, ACTION_LABEL, LoadingBlock } from '../components/ui';
import { CompletionDonut, CountBars, LegendChip, PercentTrend, VolumeBars } from '../components/charts';

export function Dashboard({ navigate }: PageProps) {
  const { store } = useApp();
  const ctx = useExam()!;
  const { report, analysis, statuses, today, examId } = ctx;
  const s = report.summary;
  const scopeLabel = report.scope.stageId ? report.stages.find((x) => x.stageId === report.scope.stageId)?.name ?? report.scope.stageId : 'All stages';
  const revisionRows = useMemo(() => Object.values(analysis.rows).filter((r) => ['overdue', 'due-today'].includes(r.revision.status)).sort((a, b) => b.revision.daysOverdue - a.revision.daysOverdue), [analysis]);
  const overdue = revisionRows.filter((r) => r.revision.status === 'overdue').length;
  const sections = report.analytics.sectionWise.filter((x) => !x.gate && x.weightInScope > 0);
  const dist = statusDistribution(report, statuses);
  const [trendMode, setTrendMode] = useState<'progress' | 'practice'>('progress');
  const history = historySeries(store.history, examId);
  const weekly = practiceTrend(scopedSessions(report, ctx.sessions), 'week');
  const hasTargets = store.planner.settings.targets.length > 0;
  const todayPlan = store.planner.getDailyPlan(today);
  const recs = useAsync(() => (hasTargets ? store.planner.getRecommendations({ limit: 6 }) : null), [store.engine.getVersion(), JSON.stringify(store.planner.settings), hasTargets]);
  const multiStage = report.stages.length > 1 && !report.scope.stageId;

  return (
    <div className="space-y-5" data-testid="page-dashboard">
      <PageHeader title={`${report.shortName} dashboard`} description={<>{scopeLabel} · {report.trackName} · weighted by exam weightage</>}
        action={<Button icon={ListTodo} onClick={() => navigate('syllabus')}>Update progress</Button>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Syllabus completion" value={pct(s.syllabusCompletion)} testId="stat-completion" icon={BookOpenCheck}
          sub={s.sharedLearningUplift > 0 ? `incl. ${pct(s.sharedLearningUplift)} from shared concepts` : 'weighted by weightage'} />
        <Stat label="Exam mastery" value={pct(s.examMastery)} testId="stat-mastery" icon={Gauge} sub={s.practice.attempted ? `${num(s.practice.attempted)} questions practised` : 'no practice recorded yet'} />
        <Stat label="Topics completed" value={num(s.topicCounts.completed)} testId="stat-completed" icon={CheckCircle2} sub={`of ${s.topicCounts.total} topics · ${s.topicCounts.mastered} mastered`} />
        <Stat label="Topics remaining" value={num(s.topicCounts.total - s.topicCounts.completed)} testId="stat-remaining" icon={ListTodo} sub={`${s.topicCounts.inProgress} in progress`} />
        <Stat label="Need revision" value={num(revisionRows.length)} testId="stat-revision" icon={RotateCcw} sub={revisionRows.length ? `${overdue} overdue · ${revisionRows.length - overdue} due today` : 'nothing due today'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Overall completion" description={`${report.shortName} · ${scopeLabel}`} icon={Target} />
          <CardBody>
            <CompletionDonut value={s.syllabusCompletion} label="syllabus covered" />
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-muted">Own progress</dt><dd className="tabular mt-0.5 font-medium">{pct(s.ownSyllabusCompletion)}</dd></div>
              <div><dt className="text-muted">Shared concepts</dt><dd className="tabular mt-0.5 font-medium">+{pct(s.sharedLearningUplift)}</dd></div>
              <div><dt className="text-muted">Remaining (weighted)</dt><dd className="tabular mt-0.5 font-medium">{pct(s.remainingWeightedSyllabus)}</dd></div>
              <div><dt className="text-muted">Accuracy</dt><dd className="tabular mt-0.5 font-medium">{pct(s.practice.accuracy)}</dd></div>
            </dl>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Section-wise progress" description="Completion and mastery of each section, weighted by topic weightage" icon={Activity}
            action={<div className="flex gap-3"><LegendChip color="completion" label="Completion" /><LegendChip color="mastery" label="Mastery" /></div>} />
          <CardBody>
            {sections.length === 0 ? <EmptyState icon={Activity} title="No weighted sections in this scope" /> : (
              <ul className="space-y-3" data-testid="section-progress">
                {sections.map((x) => (
                  <li key={x.key} className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-center sm:gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium" title={x.name}>{x.name}</div>
                      <div className="text-2xs text-muted">{multiStage ? `${report.stages.find((st) => st.stageId === x.stageId)?.name} · ` : ''}{pct(x.weightInScope)} of scope</div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2"><Progress value={x.completion} label={`${x.name} completion`} /><span className="tabular w-12 text-right text-xs">{pct(x.completion)}</span></div>
                      <div className="flex items-center gap-2"><Progress value={x.mastery} tone="mastery" size="sm" label={`${x.name} mastery`} /><span className="tabular w-12 text-right text-xs text-muted">{pct(x.mastery)}</span></div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {report.analytics.gates.length > 0 && (
              <p className="mt-4 flex items-start gap-2 text-xs text-muted"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Qualifying (pass/fail) parts are tracked but not weighted: {report.analytics.gates.map((g) => `${g.name} (${pct(g.completion)})`).join(', ')}.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Topic completion distribution" description="In-scope topics by current status" icon={ListTodo} />
          <CardBody><CountBars data={dist.map((d) => ({ label: d.label, count: d.count }))} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Preparation trend" icon={TrendingUp}
            description={trendMode === 'progress' ? 'Whole-exam completion and mastery, recorded daily as you update progress' : 'Questions practised per week in this scope'}
            action={<Segmented label="Trend" value={trendMode} onChange={setTrendMode} options={[{ value: 'progress', label: 'Progress' }, { value: 'practice', label: 'Practice' }]} />} />
          <CardBody>
            {trendMode === 'progress' ? (history.length < 2
              ? <EmptyState icon={TrendingUp} title={history.length ? 'One day recorded so far' : 'No history yet'} description="A point is saved for each day you update this exam. The trend appears from the second day." />
              : <PercentTrend data={history} labelFormatter={(d) => shortDate(String(d))} series={[{ key: 'completion', name: 'Completion', color: 'completion' }, { key: 'mastery', name: 'Mastery', color: 'mastery' }]} />)
              : weekly.length === 0
                ? <EmptyState icon={Activity} title="No practice recorded" description="Log question practice from the Syllabus Tracker or Practice Analytics page." />
                : <VolumeBars data={weekly} dataKey="attempted" name="Questions" labelFormatter={(d) => `wk ${shortDate(String(d))}`} />}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader title="High-weightage incomplete" icon={Target} />
          <CardBody>
            {report.analytics.highWeightIncomplete.length === 0 ? <EmptyState icon={CheckCircle2} title="All high-weightage topics done" /> : (
              <ul className="space-y-2.5" data-testid="hw-incomplete">
                {report.analytics.highWeightIncomplete.slice(0, 6).map((t) => (
                  <li key={t.topicId}>
                    <div className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate">{t.name}</span><span className="tabular shrink-0 text-xs text-muted">{pct(t.effectiveWeight)}</span></div>
                    <div className="mt-1 flex items-center gap-2"><Progress value={t.completion} size="sm" label={`${t.name} completion`} /><span className="tabular w-10 text-right text-2xs text-muted">{pct(t.completion, 0)}</span></div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Weakest topics" icon={AlertTriangle} />
          <CardBody>
            {analysis.weak.weakTopics.length === 0 ? <EmptyState icon={Activity} title="No weak topics detected" description="Weak areas appear once you log practice (10+ questions)." /> : (
              <ul className="space-y-2.5" data-testid="weak-topics">
                {analysis.weak.weakTopics.slice(0, 6).map((t) => (
                  <li key={t.topicId} className="text-sm">
                    <div className="flex items-baseline justify-between gap-2"><span className="truncate">{t.name}</span><span className="tabular shrink-0 text-xs text-muted">{pct(t.evidence.accuracy as number | null, 0)}</span></div>
                    <div className="text-2xs text-muted">{WEAK_LABEL[t.category] ?? t.category}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Pending revisions" icon={RotateCcw} action={<Button size="sm" variant="ghost" onClick={() => navigate('revision')}>All <ArrowRight className="h-3 w-3" /></Button>} />
          <CardBody>
            {revisionRows.length === 0 ? <EmptyState icon={CalendarCheck} title="No revisions due" description="Topics are scheduled for revision after you study them." /> : (
              <ul className="space-y-2" data-testid="pending-revisions">
                {revisionRows.slice(0, 6).map((r) => (
                  <li key={r.topicId} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{r.name}</span><RevisionBadge rev={r.revision} /></li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Today's priorities" icon={CalendarCheck} action={<Button size="sm" variant="ghost" onClick={() => navigate(todayPlan ? 'planner' : 'priorities')}>{todayPlan ? 'Plan' : 'All'} <ArrowRight className="h-3 w-3" /></Button>} />
          <CardBody>
            {todayPlan && todayPlan.tasks.length > 0 ? (
              <ul className="space-y-2" data-testid="today-priorities">
                {todayPlan.tasks.slice(0, 6).map((t) => (
                  <li key={t.taskId} className="flex items-center justify-between gap-2 text-sm">
                    <span className={t.status === 'completed' ? 'truncate text-muted line-through' : 'truncate'}>{t.name}</span>
                    <Badge>{ACTION_LABEL[t.action]}</Badge>
                  </li>
                ))}
              </ul>
            ) : hasTargets ? (recs.loading ? <LoadingBlock rows={4} /> : (
              <ul className="space-y-2" data-testid="today-priorities">
                {(recs.data?.recommendations ?? []).map((r) => (
                  <li key={r.topicId} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{r.name}</span><ClassBadge value={r.classification} /></li>
                ))}
              </ul>
            )) : (
              <ul className="space-y-2" data-testid="today-priorities">
                {analysis.priorities.filter((p) => !p.done).slice(0, 6).map((p) => (
                  <li key={p.topicId} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{p.name}</span><ClassBadge value={p.classification} /></li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
