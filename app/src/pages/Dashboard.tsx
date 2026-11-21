import { useMemo, useState } from 'react';
import { BookOpenCheck, Gauge, CheckCircle2, ListTodo, RotateCcw, TrendingUp, Target, AlertTriangle, CalendarCheck, ArrowRight, ShieldCheck, Activity } from 'lucide-react';
import type { PageProps } from '../App';
import { useApp, useAsync } from '../lib/hooks';
import { useExam, WEAK_LABEL } from '../lib/useExam';
import { historySeries, practiceTrend, scopedSessions, statusDistribution } from '../lib/selectors';
import { longDate, mins, num, pct, shortDate } from '../lib/format';
import { Button, Card, CardBody, CardHeader, EmptyState, FIVE_STAT_GRID, FIVE_STAT_SPANS, PageHeader, Progress, ProgressRing, RevisionBadge, Segmented, Stat, ACTION_LABEL, cn } from '../components/ui';
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
  const todayTasks = todayPlan?.tasks ?? [];
  const pendingTasks = todayTasks.filter((t) => t.status === 'pending');
  const doneCount = todayTasks.length - pendingTasks.length;
  const pendingMinutes = pendingTasks.reduce((a, t) => a + t.minutes, 0);
  const hasPlan = todayTasks.length > 0;
  const heroItems = hasPlan
    ? [...pendingTasks, ...todayTasks.filter((t) => t.status !== 'pending')].slice(0, 4).map((t) => ({ id: t.taskId, name: t.name, meta: ACTION_LABEL[t.action], done: t.status === 'completed' }))
    : hasTargets
      ? (recs.data?.recommendations ?? []).slice(0, 4).map((r) => ({ id: r.topicId, name: r.name, meta: `${r.classification} priority`, done: false }))
      : analysis.priorities.filter((p) => !p.done).slice(0, 4).map((p) => ({ id: p.topicId, name: p.name, meta: `${p.classification} priority`, done: false }));
  const heroTitle = pendingTasks.length ? `${pendingTasks.length} task${pendingTasks.length === 1 ? '' : 's'} left today`
    : hasPlan ? 'Today’s plan is complete'
      : revisionRows.length ? `${revisionRows.length} revision${revisionRows.length === 1 ? '' : 's'} due` : 'Pick up your next topic';
  const heroSub = pendingTasks.length ? `${mins(pendingMinutes)} planned · ${doneCount} of ${todayTasks.length} done`
    : hasPlan ? `${todayTasks.length} task${todayTasks.length === 1 ? '' : 's'} finished` : 'No plan for today yet';
  const continueTo = pendingTasks.length ? 'planner' : revisionRows.length ? 'revision' : hasTargets ? 'priorities' : 'syllabus';

  return (
    <div className="space-y-5" data-testid="page-dashboard">
      <PageHeader title={`${report.shortName} dashboard`} description={<>{scopeLabel} · {report.trackName} · weighted by exam weightage</>}
        action={<Button icon={ListTodo} onClick={() => navigate('syllabus')}>Update progress</Button>} />

      <section aria-label="Today" data-testid="today-hero" className="hero-card rounded-2xl p-5 text-white sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-8">
          <div className="flex items-center gap-4 sm:gap-6">
            <ProgressRing value={hasPlan ? (doneCount / todayTasks.length) * 100 : s.syllabusCompletion} label={hasPlan ? 'Today’s tasks done' : 'Syllabus completion'} caption={hasPlan ? 'today' : 'syllabus'} />
            <div className="min-w-0">
              <p className="text-xs font-medium text-white/90">{longDate(today)}</p>
              <h2 className="mt-0.5 text-xl font-semibold tracking-tight sm:text-2xl">{heroTitle}</h2>
              <p className="mt-0.5 text-sm text-white/90">{heroSub}{revisionRows.length > 0 && (pendingTasks.length > 0 || hasPlan) ? ` · ${revisionRows.length} revision${revisionRows.length === 1 ? '' : 's'} due` : ''}</p>
              <button type="button" onClick={() => navigate(continueTo)} className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-[rgb(var(--hero-to))] transition-colors hover:bg-white/90">
                Continue studying <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
          <div className="min-w-0">
            <h3 className="mb-2 text-xs font-medium text-white/90">{hasPlan ? 'Today’s priorities' : 'Recommended next'}</h3>
            {heroItems.length === 0 ? <p className="text-sm text-white/90">{hasTargets && recs.loading ? 'Finding your next topics…' : 'Nothing to recommend right now.'}</p> : (
              <ul className="grid gap-1.5 sm:grid-cols-2" data-testid="today-priorities">
                {heroItems.map((t) => (
                  <li key={t.id} className="min-w-0 rounded-lg bg-white/10 px-3 py-2">
                    <div className={cn('truncate text-sm font-medium', t.done && 'line-through opacity-80')} title={t.name}>{t.name}</div>
                    <div className="truncate text-2xs text-white/90">{t.meta}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <div className={FIVE_STAT_GRID}>
        <Stat className={FIVE_STAT_SPANS[0]} progress={s.syllabusCompletion} label="Syllabus completion" value={pct(s.syllabusCompletion)} testId="stat-completion" icon={BookOpenCheck}
          sub={s.sharedLearningUplift > 0 ? `incl. ${pct(s.sharedLearningUplift)} from shared concepts` : 'weighted by weightage'} />
        <Stat className={FIVE_STAT_SPANS[1]} progress={s.examMastery} progressTone="mastery" label="Exam mastery" value={pct(s.examMastery)} testId="stat-mastery" icon={Gauge} sub={s.practice.attempted ? `${num(s.practice.attempted)} questions practised` : 'no practice recorded yet'} />
        <Stat className={FIVE_STAT_SPANS[2]} progress={s.topicCounts.total ? (s.topicCounts.completed / s.topicCounts.total) * 100 : 0} progressTone="good" label="Topics completed" value={num(s.topicCounts.completed)} testId="stat-completed" icon={CheckCircle2} sub={`of ${s.topicCounts.total} topics · ${s.topicCounts.mastered} mastered`} />
        <Stat className={FIVE_STAT_SPANS[3]} label="Topics remaining" value={num(s.topicCounts.total - s.topicCounts.completed)} testId="stat-remaining" icon={ListTodo} sub={`${s.topicCounts.inProgress} in progress`} />
        <Stat className={FIVE_STAT_SPANS[4]} label="Need revision" value={num(revisionRows.length)} testId="stat-revision" icon={RotateCcw} sub={revisionRows.length ? `${overdue} overdue · ${revisionRows.length - overdue} due today` : 'nothing due today'} />
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
      </div>
    </div>
  );
}
