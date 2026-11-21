import { useMemo, useState } from 'react';
import { RotateCcw, AlertTriangle, Clock, CalendarClock, History, Check, Settings2 } from 'lucide-react';
import type { PageProps } from '../App';
import { useApp, useAsync } from '../lib/hooks';
import { revisionHistory, topicOf } from '../lib/selectors';
import { pct, shortDate, isDate, relativeDays, daysBetween } from '../lib/format';
import type { Report, RevisionTracker } from '../lib/types';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal, PageHeader, ResponsiveTable, RevisionBadge, Segmented, Stat, cn } from '../components/ui';
import { TargetsGate } from '../components/TargetsGate';

type Item = RevisionTracker['items'][number];

export function RevisionPage({ navigate }: PageProps) {
  return <TargetsGate onSettings={() => navigate('settings')}><Revision navigate={navigate} /></TargetsGate>;
}

function Revision({ navigate }: { navigate: PageProps['navigate'] }) {
  const { store } = useApp();
  const key = [store.engine.getVersion(), JSON.stringify(store.planner.settings), store.today()];
  const res = useAsync(async () => {
    const [tracker, computed] = await Promise.all([store.planner.getRevisionTracker(), store.planner.compute()]);
    return { tracker, reports: (computed as unknown as { reports: Record<string, Report> }).reports };
  }, key);
  const [confirming, setConfirming] = useState<Item | null>(null);
  const [tab, setTab] = useState<'due' | 'upcoming' | 'history'>('due');

  const history = useMemo(() => {
    if (!res.data) return [];
    const { reports } = res.data;
    return store.planner.settings.targets.flatMap(({ examId }) => {
      const rep = reports[examId];
      if (!rep) return [];
      const nameOf = (id: string) => {
        const t = rep.topics[topicOf(id)];
        const s = rep.subtopics[id];
        return s && id !== topicOf(id) ? `${t?.name ?? topicOf(id)} › ${s.name}` : t?.name ?? id;
      };
      return revisionHistory(store.engine.getExamRecords(examId), store.engine.getExamSessions(examId), nameOf)
        .map((h) => ({ ...h, examId, masteryNow: rep.topics[topicOf(h.nodeId)]?.mastery ?? null }));
    }).sort((a, b) => b.date.localeCompare(a.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.data]);

  if (res.error) return <Card><ErrorState error={res.error} /></Card>;
  const t = res.data?.tracker;
  const overdue = t?.items.filter((i) => i.status === 'overdue') ?? [];
  const dueToday = t?.items.filter((i) => i.status === 'due-today') ?? [];
  const upcoming = t?.items.filter((i) => i.status === 'due-soon' || i.status === 'scheduled') ?? [];

  return (
    <div className="space-y-4" data-testid="page-revision">
      <PageHeader title="Revision tracker" description="Spaced revision for studied topics. A topic counts only after you confirm it or log a revision session."
        action={<Button icon={Settings2} onClick={() => navigate('settings', { section: 'time' })}>Intervals: {t?.intervalsDays.join(' / ') ?? '…'} days</Button>} />
      {!t ? <Card><LoadingBlock rows={6} /></Card> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Overdue" value={t.summary.overdue} icon={AlertTriangle} testId="rev-overdue" />
            <Stat label="Due today" value={t.summary.dueToday} icon={Clock} testId="rev-today" />
            <Stat label="Due in 2 days" value={t.summary.dueSoon} icon={CalendarClock} />
            <Stat label="Topics tracked" value={t.summary.tracked} icon={RotateCcw} sub="studied topics with a schedule" />
          </div>
          <Segmented label="View" value={tab} onChange={setTab} options={[{ value: 'due', label: `Due now (${overdue.length + dueToday.length})` }, { value: 'upcoming', label: `Upcoming (${upcoming.length})` }, { value: 'history', label: `History (${history.length})` }]} />

          {tab === 'due' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <RevisionList title="Overdue revisions" icon={AlertTriangle} items={overdue} today={t.today} onConfirm={setConfirming} empty="Nothing overdue. Well kept!" testId="list-overdue" />
              <RevisionList title="Due today" icon={Clock} items={dueToday} today={t.today} onConfirm={setConfirming} empty="No revisions due today." testId="list-today" />
            </div>
          )}
          {tab === 'upcoming' && <RevisionList title="Upcoming revisions" icon={CalendarClock} items={upcoming} today={t.today} onConfirm={setConfirming} empty="No upcoming revisions. Study a topic to schedule its first revision." testId="list-upcoming" />}
          {tab === 'history' && (
            <Card>
              <CardHeader title="Revision history" icon={History} description="Confirmed revisions and revision practice sessions, with the topic’s current exam mastery" />
              {history.length === 0 ? <EmptyState icon={History} title="No revisions recorded yet" /> : (
                <div className="scroll-x px-2 pb-2">
                  <ResponsiveTable className="table-base min-w-[40rem]" data-testid="revision-history">
                    <thead><tr><th>Date</th><th>Topic</th><th>Exam</th><th>Type</th><th className="text-right">Session accuracy</th><th className="text-right">Mastery now</th></tr></thead>
                    <tbody>
                      {history.slice(0, 200).map((h, i) => (
                        <tr key={`${h.examId}-${h.nodeId}-${h.date}-${i}`}>
                          <td className="tabular whitespace-nowrap">{shortDate(h.date)}</td>
                          <td className="max-w-[18rem] truncate" title={h.name}>{h.name}{h.note && <span className="block truncate text-2xs text-muted">{h.note}</span>}</td>
                          <td>{store.examName(h.examId)}</td>
                          <td><Badge tone={h.kind === 'confirmed' ? 'good' : 'accent'}>{h.kind === 'confirmed' ? 'Confirmed' : 'Revision session'}</Badge></td>
                          <td className="tabular text-right">{h.accuracy === null ? '–' : `${pct(h.accuracy, 0)} of ${h.attempted}`}</td>
                          <td className="tabular text-right">{pct(h.masteryNow, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </ResponsiveTable>
                </div>
              )}
            </Card>
          )}
        </>
      )}
      {confirming && <ConfirmModal item={confirming} onClose={() => setConfirming(null)} />}
    </div>
  );
}

function RevisionList({ title, icon, items, today, onConfirm, empty, testId }: { title: string; icon: typeof Clock; items: Item[]; today: string; onConfirm: (i: Item) => void; empty: string; testId: string }) {
  const { store } = useApp();
  return (
    <Card>
      <CardHeader title={title} icon={icon} description={`${items.length} topic${items.length === 1 ? '' : 's'}`} />
      {items.length === 0 ? <EmptyState icon={Check} title={empty} /> : (
        <ul className="divide-y divide-line/70 border-t border-line" data-testid={testId}>
          {items.map((i) => (
            <li key={`${i.examId}-${i.topicId}`} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{i.name}</span><Badge>{store.examName(i.examId)}</Badge><RevisionBadge rev={i} /></div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                  <span>revision #{i.revisionNumber ?? i.revisionCount + 1} · due {i.nextDue ? `${shortDate(i.nextDue)} (${relativeDays(daysBetween(today, i.nextDue))})` : '–'}</span>
                  <span>last studied {shortDate(i.lastStudied)}</span>
                  <span>{i.revisionCount} revision{i.revisionCount === 1 ? '' : 's'}</span>
                  <span>last accuracy {pct(i.previousAccuracy, 0)}</span>
                  <span>mastery {pct(i.mastery, 0)}</span>
                  {i.intervalShortenedForLowAccuracy && <span className={cn('text-serious')}>interval shortened (low accuracy)</span>}
                </div>
              </div>
              <Button size="sm" variant={i.status === 'overdue' || i.status === 'due-today' ? 'primary' : 'secondary'} icon={Check} onClick={() => onConfirm(i)}>Confirm revision</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ConfirmModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const { store } = useApp();
  const [date, setDate] = useState(store.today());
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState('');
  const [correct, setCorrect] = useState('');
  const a = Number(attempted), c = Number(correct);
  const withQuestions = attempted !== '' || correct !== '';
  const invalid = !isDate(date) || (withQuestions && !(Number.isInteger(a) && a > 0 && Number.isInteger(c) && c >= 0 && c <= a));
  const submit = async () => {
    const r = await store.run(() => store.withExam(item.examId, () => (withQuestions
      ? store.engine.recordPractice(item.topicId, { attempted: a, correct: c, date, revision: true, note })
      : store.engine.addRevision(item.topicId, { date, note }))), `Revision of ${item.name} confirmed for ${store.examName(item.examId)}`);
    if (r !== undefined) onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Confirm revision: ${item.name}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Check} disabled={invalid} onClick={submit}>Confirm</Button></>}>
      <p className="mb-3 text-xs text-muted">Recorded for {store.examName(item.examId)} only. If you solved questions while revising, add them: the accuracy shortens or keeps the next interval.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Revised on"><Input type="date" value={date} max={store.today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. formula sheet" /></Field>
        <Field label="Questions attempted (optional)"><Input inputMode="numeric" value={attempted} onChange={(e) => setAttempted(e.target.value.replace(/[^\d]/g, ''))} /></Field>
        <Field label="Correct"><Input inputMode="numeric" value={correct} onChange={(e) => setCorrect(e.target.value.replace(/[^\d]/g, ''))} /></Field>
      </div>
    </Modal>
  );
}
