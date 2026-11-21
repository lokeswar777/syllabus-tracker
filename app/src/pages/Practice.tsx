import { useMemo, useState } from 'react';
import { BarChart3, CheckCircle2, XCircle, Target, Timer, ListOrdered, Trash2, Plus, TrendingUp, LayoutGrid } from 'lucide-react';
import type { PageProps } from '../App';
import { useApp } from '../lib/hooks';
import { useExam } from '../lib/useExam';
import { practiceBySection, practiceByTopic, practiceTotals, practiceTrend, scopedSessions, topicOf } from '../lib/selectors';
import { num, pct, secs, shortDate } from '../lib/format';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, FIVE_STAT_GRID, FIVE_STAT_SPANS, IconButton, PageHeader, Progress, ResponsiveTable, Segmented, Select, Stat, cn } from '../components/ui';
import { PercentTrend, VolumeBars } from '../components/charts';
import { PracticeForm } from '../components/PracticeForm';

type TopicSort = 'attempted' | 'accuracy' | 'time' | 'name';

export function PracticePage(_: PageProps) {
  const { store } = useApp();
  const ctx = useExam()!;
  const { report } = ctx;
  const sessions = useMemo(() => scopedSessions(report, ctx.sessions), [report, ctx.sessions]);
  const totals = practiceTotals(sessions);
  const [by, setBy] = useState<'week' | 'day'>('week');
  const trend = practiceTrend(sessions, by);
  const sections = practiceBySection(report, sessions);
  const [sort, setSort] = useState<TopicSort>('attempted');
  const topics = useMemo(() => {
    const rows = practiceByTopic(report, sessions);
    const s = { attempted: (a: typeof rows[0], b: typeof rows[0]) => b.attempted - a.attempted, accuracy: (a: typeof rows[0], b: typeof rows[0]) => (a.accuracy ?? 101) - (b.accuracy ?? 101), time: (a: typeof rows[0], b: typeof rows[0]) => (b.avgTimeSeconds ?? -1) - (a.avgTimeSeconds ?? -1), name: (a: typeof rows[0], b: typeof rows[0]) => a.name.localeCompare(b.name) }[sort];
    return rows.sort(s);
  }, [report, sessions, sort]);
  const [showForm, setShowForm] = useState(false);
  const recent = [...sessions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 15);
  const nameOf = (nodeId: string) => (nodeId === topicOf(nodeId) ? report.topics[nodeId]?.name : `${report.topics[topicOf(nodeId)]?.name} › ${report.subtopics[nodeId]?.name ?? nodeId}`) ?? nodeId;
  const fmtLabel = (d: string | number) => (by === 'week' ? `wk ${shortDate(String(d))}` : shortDate(String(d)));

  return (
    <div className="space-y-4" data-testid="page-practice">
      <PageHeader title="Practice analytics" description={`${report.shortName} · ${report.scope.stageId ? report.stages.find((s) => s.stageId === report.scope.stageId)?.name : 'All stages'} · from ${num(totals.sessions)} logged sessions`}
        action={<Button variant="primary" icon={Plus} onClick={() => setShowForm(!showForm)}>{showForm ? 'Close' : 'Log practice'}</Button>} />
      {showForm && <Card><CardHeader title="Log a practice session" description={`Saved to ${report.shortName} only`} /><CardBody><PracticeForm report={report} onDone={() => setShowForm(false)} compact /></CardBody></Card>}

      <div className={FIVE_STAT_GRID}>
        <Stat className={FIVE_STAT_SPANS[0]} label="Questions attempted" value={num(totals.attempted)} icon={ListOrdered} testId="pa-attempted" />
        <Stat className={FIVE_STAT_SPANS[1]} label="Correct" value={num(totals.correct)} icon={CheckCircle2} testId="pa-correct" />
        <Stat className={FIVE_STAT_SPANS[2]} label="Incorrect" value={num(totals.incorrect)} icon={XCircle} testId="pa-incorrect" />
        <Stat className={FIVE_STAT_SPANS[3]} progress={totals.accuracy ?? undefined} label="Accuracy" value={pct(totals.accuracy)} icon={Target} testId="pa-accuracy" />
        <Stat className={FIVE_STAT_SPANS[4]} label="Avg time / question" value={secs(totals.avgTimeSeconds)} icon={Timer} sub="sessions with time recorded" testId="pa-time" />
      </div>

      {sessions.length === 0 ? (
        <Card><EmptyState icon={BarChart3} title="No practice logged in this scope" description="Log questions you solve, from here or from a topic in the Syllabus Tracker. Accuracy, speed and weak areas are calculated from these sessions." action={!showForm && <Button variant="primary" icon={Plus} onClick={() => setShowForm(true)}>Log practice</Button>} /></Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Questions practised" icon={BarChart3} action={<Segmented label="Group by" value={by} onChange={setBy} options={[{ value: 'week', label: 'Weekly' }, { value: 'day', label: 'Daily' }]} />} />
              <CardBody><VolumeBars data={trend} dataKey="attempted" name="Questions" labelFormatter={fmtLabel} /></CardBody>
            </Card>
            <Card>
              <CardHeader title="Accuracy trend" icon={TrendingUp} description={by === 'week' ? 'Per week' : 'Per day'} />
              <CardBody>{trend.length < 2 ? <EmptyState icon={TrendingUp} title="Not enough data yet" description="The trend appears once practice spans two periods." /> : <PercentTrend data={trend.map((t) => ({ date: t.date, accuracy: t.accuracy }))} series={[{ key: 'accuracy', name: 'Accuracy', color: 'completion' }]} labelFormatter={fmtLabel} />}</CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Section-wise performance" icon={LayoutGrid} />
            <div className="scroll-x px-2 pb-2">
              <ResponsiveTable className="table-base min-w-[40rem]" data-testid="section-perf">
                <thead><tr><th>Section</th><th className="text-right">Attempted</th><th className="text-right">Correct</th><th className="text-right">Incorrect</th><th className="w-48">Accuracy</th><th className="text-right">Avg time</th></tr></thead>
                <tbody>
                  {sections.map((s) => (
                    <tr key={s.key}>
                      <td className="max-w-[16rem] truncate font-medium" title={s.name}>{s.name}</td>
                      <td className="tabular text-right">{num(s.attempted)}</td>
                      <td className="tabular text-right">{num(s.correct)}</td>
                      <td className="tabular text-right">{num(s.incorrect)}</td>
                      <td><div className="flex flex-1 items-center gap-2 max-sm:max-w-[60%]"><Progress value={s.accuracy ?? 0} size="sm" label={`${s.name} accuracy`} /><span className="tabular w-10 text-right text-xs">{pct(s.accuracy, 0)}</span></div></td>
                      <td className="tabular text-right">{secs(s.avgTimeSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
          </Card>

          <Card>
            <CardHeader title="Topic-wise performance" icon={ListOrdered} description="Compared with this exam’s accuracy and speed targets (Phase 4 requirements)"
              action={<Select value={sort} onChange={(e) => setSort(e.target.value as TopicSort)} className="h-8 w-44 text-xs" aria-label="Sort topics">
                <option value="attempted">Most practised</option><option value="accuracy">Lowest accuracy</option><option value="time">Slowest</option><option value="name">Name</option>
              </Select>} />
            <div className="scroll-x px-2 pb-2">
              <ResponsiveTable className="table-base min-w-[44rem]" data-testid="topic-perf">
                <thead><tr><th>Topic</th><th className="text-right">Attempted</th><th className="text-right">Accuracy</th><th className="text-right">Target</th><th className="text-right">Avg time</th><th className="text-right">Target</th><th className="text-right">Mastery</th></tr></thead>
                <tbody>
                  {topics.map((t) => {
                    const tr = report.topics[t.key];
                    const req = tr?.requirement;
                    const accOk = req?.accuracyTarget == null || t.accuracy === null ? null : t.accuracy >= req.accuracyTarget;
                    const speedOk = req?.speedTargetSec == null || t.avgTimeSeconds === null ? null : t.avgTimeSeconds <= req.speedTargetSec;
                    return (
                      <tr key={t.key}>
                        <td className="max-w-[16rem] truncate font-medium" title={t.name}>{t.name}</td>
                        <td className="tabular text-right">{num(t.attempted)}{req?.questionTarget ? <span className="text-2xs text-muted"> / {req.questionTarget}</span> : null}</td>
                        <td className={cn('tabular text-right', accOk === false && 'text-critical')}>{pct(t.accuracy, 0)}</td>
                        <td className="tabular text-right text-muted">{req?.accuracyTarget ? `≥${req.accuracyTarget}%` : '–'}</td>
                        <td className={cn('tabular text-right', speedOk === false && 'text-critical')}>{secs(t.avgTimeSeconds)}</td>
                        <td className="tabular text-right text-muted">{req?.speedTargetSec ? `≤${req.speedTargetSec} s` : '–'}</td>
                        <td className="tabular text-right">{pct(tr?.mastery, 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </ResponsiveTable>
            </div>
            <p className="px-5 pb-4 text-2xs text-muted">Values below target are shown in red text.</p>
          </Card>

          <Card>
            <CardHeader title="Recent sessions" icon={ListOrdered} description="Delete a session if it was logged by mistake: all figures recalculate" />
            <ul className="divide-y divide-line/70 border-t border-line" data-testid="recent-sessions">
              {recent.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm sm:px-5">
                  <span className="tabular w-14 text-xs text-muted">{shortDate(s.date)}</span>
                  <span className="min-w-0 flex-1 truncate">{nameOf(s.nodeId)}</span>
                  {s.revision && <Badge tone="accent">revision</Badge>}
                  {s.stageId && <Badge>{report.stages.find((x) => x.stageId === s.stageId)?.name ?? s.stageId}</Badge>}
                  <span className="tabular text-xs">{s.correct}/{s.attempted} · {pct((s.correct / s.attempted) * 100, 0)}</span>
                  <span className="tabular w-14 text-right text-xs text-muted">{s.timeSeconds ? secs(s.timeSeconds / s.attempted) : '–'}</span>
                  <IconButton icon={Trash2} label="Delete session" onClick={() => { if (window.confirm('Delete this practice session? Accuracy and mastery will be recalculated.')) void store.run(() => store.engine.deletePractice(s.id), 'Session deleted'); }} />
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
