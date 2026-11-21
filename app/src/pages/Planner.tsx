import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Sparkles, Plus, Check, X, RotateCcw, GripVertical, Clock, ArrowUp, ArrowDown, Target, Wand2 } from 'lucide-react';
import type { PageProps } from '../App';
import { useApp, useAsync } from '../lib/hooks';
import { planner as plannerApi } from '../lib/engines';
import { addDays, daysBetween, dayName, isDate, longDate, mins, monthName, monthStart, shortDate, weekStart, weekday } from '../lib/format';
import type { DailyPlan, PlannerAction, Task } from '../lib/types';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, ClassBadge, EmptyState, Field, IconButton, Input, Modal, PageHeader, Progress, Select, ACTION_LABEL, cn } from '../components/ui';
import { TargetsGate } from '../components/TargetsGate';

export function PlannerPage({ navigate, params }: PageProps) {
  return <TargetsGate onSettings={() => navigate('settings')}><Planner initialDate={params.get('date')} /></TargetsGate>;
}

const doneMinutes = (p: DailyPlan | null) => (p?.tasks ?? []).filter((t) => t.status === 'completed').reduce((a, t) => a + t.minutes, 0);

function Planner({ initialDate }: { initialDate: string | null }) {
  const { store } = useApp();
  const today = store.today();
  const [selected, setSelected] = useState(initialDate && isDate(initialDate) ? initialDate : today);
  const [busy, setBusy] = useState<string | null>(null);
  const [completing, setCompleting] = useState<{ date: string; task: Task } | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const settings = store.planner.settings;
  const hoursDefault = settings.dailyHours ?? store.planner.config().dailyPlan.defaultHours;
  const [hours, setHours] = useState(String(hoursDefault));
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart(selected), i));
  const plans = store.planner.data.plans;
  const plan = (d: string) => plans[d] ?? null;
  const boardRef = useRef<HTMLDivElement>(null);
  // Below the seven-column layout the week is a swipeable strip: keep the selected day in view.
  useEffect(() => {
    const board = boardRef.current;
    const day = board?.querySelector<HTMLElement>('[data-selected="true"]');
    if (board && day && board.scrollWidth > board.clientWidth) board.scrollLeft = day.offsetLeft - (board.clientWidth - day.offsetWidth) / 2;
  }, [selected]);

  const weekStats = useMemo(() => {
    const ps = week.map(plan).filter(Boolean) as DailyPlan[];
    const tasks = ps.flatMap((p) => p.tasks);
    return {
      planned: ps.reduce((a, p) => a + p.plannedMinutes, 0), budget: week.reduce((a, d) => a + (plan(d)?.budgetMinutes ?? Math.round(hoursDefault * 60)), 0),
      done: ps.reduce((a, p) => a + doneMinutes(p), 0), tasks: tasks.length, completed: tasks.filter((t) => t.status === 'completed').length,
      topics: new Set(tasks.filter((t) => t.topicId).map((t) => t.topicId)).size,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, selected, hoursDefault]);

  const generate = async (d: string) => {
    setBusy(d);
    const others = week.filter((x) => x !== d).flatMap((x) => (plan(x)?.tasks ?? []).filter((t) => t.status === 'pending' && t.topicId).map((t) => t.topicId!));
    await store.run(() => store.planner.generateDailyPlan(d, { excludeTopicIds: others }), `Plan for ${shortDate(d)} generated`);
    setBusy(null);
  };
  const planWeek = async () => {
    setBusy('week');
    await store.run(async () => {
      for (const d of week) {
        if (d < today || plan(d)) continue;
        const others = week.filter((x) => x !== d).flatMap((x) => (store.planner.getDailyPlan(x)?.tasks ?? []).filter((t) => t.status === 'pending' && t.topicId).map((t) => t.topicId!));
        await store.planner.generateDailyPlan(d, { excludeTopicIds: others });
      }
    }, 'Week planned: topics are spread across the days without repeats');
    setBusy(null);
  };
  const saveHours = () => {
    const h = Number(hours);
    if (Number.isFinite(h) && h >= 0 && h <= 24 && h !== settings.dailyHours) void store.run(() => store.planner.setDailyHours(h), `Daily study time set to ${h} h`);
  };

  const onDrop = async (e: DragEvent, to: string, index: number | null) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const { taskId, from } = JSON.parse(e.dataTransfer.getData('application/x-task') || e.dataTransfer.getData('text/plain')) as { taskId: string; from: string };
      if (!taskId) return;
      if (to < today && from !== to) { store.toast('error', 'Tasks cannot be moved to a past day.'); return; }
      await store.run(() => store.planner.moveTask(from, taskId, to, { index }), from === to ? undefined : `Moved to ${shortDate(to)}`);
    } catch { /* not a task drag */ }
  };

  return (
    <div className="space-y-4" data-testid="page-planner">
      <PageHeader title="Study planner" description="Built from your priorities and available hours. Nothing is marked complete automatically."
        action={<Button variant="primary" icon={Wand2} loading={busy === 'week'} onClick={planWeek}>Plan this week</Button>} />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <IconButton icon={ChevronLeft} label="Previous week" onClick={() => setSelected(addDays(selected, -7))} />
              <IconButton icon={ChevronRight} label="Next week" onClick={() => setSelected(addDays(selected, 7))} />
              <Button size="sm" variant="ghost" onClick={() => setSelected(today)}>Today</Button>
              <span className="ml-2 text-sm font-medium">{shortDate(week[0])} – {shortDate(week[6])}</span>
            </div>
          </div>
          <div ref={boardRef} className="relative -mx-4 flex snap-x gap-2 overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6 xl:mx-0 xl:grid xl:grid-cols-7 xl:overflow-visible xl:px-0 xl:py-0" data-testid="week-board">
            {week.map((d) => {
              const p = plan(d);
              const past = d < today;
              return (
                <div key={d} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, d, null)} data-testid={`day-${d}`} data-selected={d === selected}
                  className={cn('card flex w-[4.5rem] shrink-0 snap-center flex-col p-1 xl:min-h-[11rem] xl:w-auto xl:p-2', d === selected && 'ring-2 ring-accent/60 xl:ring-1', past && 'opacity-70')}>
                  <button type="button" onClick={() => setSelected(d)} aria-pressed={d === selected} aria-label={`${longDate(d)}${p ? `, ${p.tasks.length} task${p.tasks.length === 1 ? '' : 's'}` : ''}`}
                    className="flex min-h-[4.25rem] w-full flex-col items-center justify-center rounded-lg px-1 xl:mb-1.5 xl:min-h-0 xl:flex-row xl:items-baseline xl:justify-between xl:text-left">
                    <span className="text-2xs font-medium text-muted xl:hidden">{dayName(d)}</span>
                    <span className={cn('tabular text-lg font-semibold leading-6 xl:hidden', d === today && 'text-accent')}>{Number(d.slice(8))}</span>
                    <span className="tabular min-h-4 text-2xs text-muted xl:hidden">{p ? `${p.tasks.length} task${p.tasks.length === 1 ? '' : 's'}` : ''}</span>
                    <span className={cn('hidden text-xs font-semibold xl:inline', d === today && 'text-accent')}>{dayName(d)} {shortDate(d)}</span>
                    {p && <span className="tabular hidden text-2xs text-muted xl:inline">{mins(p.plannedMinutes)}</span>}
                  </button>
                  {p && <Progress value={p.budgetMinutes ? (p.plannedMinutes / p.budgetMinutes) * 100 : 0} size="sm" className="mb-2 hidden xl:block" label={`Planned time ${d}`} />}
                  <ul className="hidden flex-1 space-y-1.5 xl:block">
                    {(p?.tasks ?? []).map((t, i) => (
                      <li key={t.taskId} draggable={t.status !== 'completed'} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, d, i)}
                        onDragStart={(e) => { const v = JSON.stringify({ taskId: t.taskId, from: d }); e.dataTransfer.setData('application/x-task', v); e.dataTransfer.setData('text/plain', v); e.dataTransfer.effectAllowed = 'move'; }}
                        className={cn('group rounded-md border border-line bg-surface px-2 py-1.5 text-xs', t.status === 'completed' ? 'opacity-60' : 'cursor-grab active:cursor-grabbing hover:border-ink2/30')}>
                        <div className="flex items-start gap-1">
                          {t.status !== 'completed' && <GripVertical className="mt-0.5 h-3 w-3 shrink-0 text-muted" aria-hidden />}
                          <span className={cn('min-w-0 flex-1 truncate font-medium', t.status === 'completed' && 'line-through')} title={t.name}>{t.name}</span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-1 text-2xs text-muted"><span className="truncate">{ACTION_LABEL[t.action]}</span><span className="tabular shrink-0">{t.minutes}m</span></div>
                      </li>
                    ))}
                  </ul>
                  {!p && !past && <Button size="sm" variant="ghost" icon={Sparkles} loading={busy === d} onClick={() => generate(d)} className="mt-1 hidden xl:inline-flex">Generate</Button>}
                </div>
              );
            })}
          </div>

      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <DayDetail date={selected} plan={plan(selected)} today={today} busy={busy === selected} onGenerate={() => generate(selected)} onComplete={(task) => setCompleting({ date: selected, task })} onAdd={() => setAddingFor(selected)} />
        </div>
        <div className="space-y-4">
          <MonthCalendar selected={selected} onSelect={setSelected} today={today} />
          <Card>
            <CardHeader title="Weekly targets" icon={Target} description={`${shortDate(week[0])} – ${shortDate(week[6])}`} />
            <CardBody className="space-y-3 text-sm">
              <div>
                <div className="flex justify-between text-xs"><span className="text-muted">Planned</span><span className="tabular">{mins(weekStats.planned)} / {mins(weekStats.budget)}</span></div>
                <Progress value={weekStats.budget ? (weekStats.planned / weekStats.budget) * 100 : 0} className="mt-1" label="Planned time this week" />
              </div>
              <div>
                <div className="flex justify-between text-xs"><span className="text-muted">Completed</span><span className="tabular" data-testid="week-done">{mins(weekStats.done)} · {weekStats.completed}/{weekStats.tasks} tasks</span></div>
                <Progress value={weekStats.planned ? (weekStats.done / weekStats.planned) * 100 : 0} tone="good" className="mt-1" label="Completed time this week" />
              </div>
              <p className="text-xs text-muted">{weekStats.topics} topics assigned this week</p>
              <div className="flex items-end gap-2 border-t border-line pt-3">
                <Field label="Available hours per day" className="flex-1"><Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, ''))} onBlur={saveHours} onKeyDown={(e) => e.key === 'Enter' && saveHours()} aria-label="Available hours per day" data-testid="daily-hours" /></Field>
                <Button onClick={saveHours}>Save</Button>
              </div>
              <p className="text-2xs text-muted">Changing hours affects plans you generate or regenerate; tasks already completed or added by you are kept.</p>
            </CardBody>
          </Card>
        </div>

      </div>
      {completing && <CompleteModal date={completing.date} task={completing.task} onClose={() => setCompleting(null)} />}
      {addingFor && <AddTaskModal date={addingFor} onClose={() => setAddingFor(null)} />}
    </div>
  );
}

function MonthCalendar({ selected, onSelect, today }: { selected: string; onSelect: (d: string) => void; today: string }) {
  const { store } = useApp();
  const [month, setMonth] = useState(monthStart(selected));
  const first = month;
  const startPad = (weekday(first) + 6) % 7;
  const nextMonth = monthStart(addDays(first, 32));
  const days = daysBetween(first, nextMonth);
  const cells = [...Array.from({ length: startPad }, () => null), ...Array.from({ length: days }, (_, i) => addDays(first, i))];
  const examDates = new Map(store.planner.settings.targets.filter((t) => t.examDate).map((t) => [t.examDate!, store.examName(t.examId)]));
  const plans = store.planner.data.plans;
  return (
    <Card data-testid="calendar">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="text-sm font-semibold">{monthName(first)}</span>
        <div className="flex">
          <IconButton icon={ChevronLeft} label="Previous month" onClick={() => setMonth(monthStart(addDays(first, -1)))} />
          <IconButton icon={ChevronRight} label="Next month" onClick={() => setMonth(nextMonth)} />
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5 px-3 pb-3 pt-2 text-center">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="py-1 text-2xs font-medium text-muted">{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`p${i}`} />;
          const p = plans[d];
          const n = p?.tasks.length ?? 0;
          const allDone = n > 0 && p!.tasks.every((t) => t.status === 'completed');
          const exam = examDates.get(d);
          return (
            <button key={d} type="button" onClick={() => onSelect(d)} title={exam ? `${exam} exam` : n ? `${n} tasks` : undefined} aria-label={`${longDate(d)}${n ? `, ${n} tasks` : ''}${exam ? `, ${exam} exam` : ''}`}
              className={cn('tap-narrow relative flex h-9 flex-col items-center justify-center rounded-md text-xs transition-colors hover:bg-subtle',
                d === selected && 'bg-accent-fill text-accent-ink hover:bg-accent-fill', d === today && d !== selected && 'font-semibold text-accent', exam && d !== selected && 'ring-1 ring-critical/60')}>
              {Number(d.slice(8))}
              {n > 0 && <span className={cn('absolute bottom-1 h-1 w-1 rounded-full', d === selected ? 'bg-accent-ink' : allDone ? 'bg-good' : 'bg-accent')} />}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-2xs text-muted">
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-accent" />planned</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-good" />all done</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded ring-1 ring-critical/60" />exam date</span>
      </div>
    </Card>
  );
}

function DayDetail({ date, plan, today, busy, onGenerate, onComplete, onAdd }: { date: string; plan: DailyPlan | null; today: string; busy: boolean; onGenerate: () => void; onComplete: (t: Task) => void; onAdd: () => void }) {
  const { store } = useApp();
  const past = date < today;
  const tasks = plan?.tasks ?? [];
  const done = doneMinutes(plan);
  const move = (i: number, dir: -1 | 1) => {
    const ids = tasks.map((t) => t.taskId);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void store.run(() => store.planner.reorderTasks(date, ids));
  };
  return (
    <Card data-testid="day-detail">
      <CardHeader title={longDate(date)} icon={CalendarDays}
        description={plan ? `Daily target ${mins(plan.budgetMinutes)} · planned ${mins(plan.plannedMinutes)} · done ${mins(done)}` : past ? 'No plan was made for this day' : 'No plan yet for this day'}
        action={!past && <>
          <Button size="sm" icon={Plus} onClick={onAdd}>Add task</Button>
          <Button size="sm" variant={plan ? 'secondary' : 'primary'} icon={Sparkles} loading={busy} onClick={onGenerate}>{plan ? 'Regenerate' : 'Generate plan'}</Button>
        </>} />
      <CardBody>
        {!plan || tasks.length === 0 ? (
          <EmptyState icon={CalendarDays} title={plan ? 'No tasks for this day' : 'Nothing planned'} description={past ? undefined : 'Generate a plan from your priorities, or add tasks yourself.'} />
        ) : (
          <>
            {plan && <div className="mb-3 flex items-center gap-2"><Progress value={plan.plannedMinutes ? (done / plan.plannedMinutes) * 100 : 0} tone="good" label="Completed today" /><span className="tabular w-24 shrink-0 text-right text-xs text-muted">{mins(done)} done</span></div>}
            <ol className="space-y-2" data-testid="day-tasks">
              {tasks.map((t, i) => (
                <li key={t.taskId} className={cn('rounded-lg border border-line p-3', t.status === 'completed' && 'bg-subtle/50')} data-testid={`task-${i}`}>
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="order-2 flex lg:order-none lg:flex-col">
                      <IconButton icon={ArrowUp} label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="h-6 w-6" />
                      <IconButton icon={ArrowDown} label="Move down" disabled={i === tasks.length - 1} onClick={() => move(i, 1)} className="h-6 w-6" />
                    </div>
                    <div className="order-1 min-w-0 basis-full lg:order-none lg:flex-1 lg:basis-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('text-sm font-medium', t.status === 'completed' && 'text-muted line-through')}>{t.name}</span>
                        <Badge tone="accent">{ACTION_LABEL[t.action]}</Badge>
                        {t.classification && <ClassBadge value={t.classification} />}
                        {t.source === 'manual' && <Badge>Added by you</Badge>}
                        {t.status === 'completed' && <Badge tone="good" icon={Check}>Completed</Badge>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{mins(t.minutes)}</span>
                        <span>{t.examIds.map((e) => store.examName(e)).join(' + ')}</span>
                        {t.section && <span className="truncate">{t.section}</span>}
                      </div>
                      {t.detail && <p className="mt-1 text-sm text-ink2">{t.detail}</p>}
                      {t.status === 'completed' && t.progressUpdates && <p className="mt-1 text-2xs text-muted">{t.progressUpdates.length ? `Progress updated via ${t.progressUpdates.map((u) => u.via.replace('engine.', '')).join(', ')}` : 'Marked done without changing progress'}{t.note ? ` · “${t.note}”` : ''}</p>}
                    </div>
                    <div className="order-3 flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5 lg:order-none lg:flex-none">
                      {t.status === 'pending' ? (
                        <>
                          <Select className="h-8 min-w-[7.5rem] flex-1 text-xs lg:w-32 lg:flex-none" value="" aria-label={`Move ${t.name} to another day`} onChange={(e) => e.target.value && store.run(() => store.planner.moveTask(date, t.taskId, e.target.value), `Moved to ${shortDate(e.target.value)}`)}>
                            <option value="">Move to…</option>
                            {Array.from({ length: 7 }, (_, k) => addDays(today, k)).filter((d) => d !== date).map((d) => <option key={d} value={d}>{dayName(d)} {shortDate(d)}</option>)}
                          </Select>
                          <Button size="sm" variant="primary" icon={Check} onClick={() => onComplete(t)}>Complete</Button>
                          <IconButton icon={X} label={`Remove ${t.name}`} onClick={() => store.run(() => store.planner.removeTask(date, t.taskId), 'Task removed')} />
                        </>
                      ) : <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => store.run(() => store.planner.reopenTask(date, t.taskId), 'Task reopened (progress already recorded is kept)')}>Reopen</Button>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/** Completing a task never changes progress by itself; the optional outcome is applied through the progress engine. */
function CompleteModal({ date, task, onClose }: { date: string; task: Task; onClose: () => void }) {
  const { store } = useApp();
  const statuses = store.engine.config.statuses;
  const [setStatus, setSetStatus] = useState(false);
  const [status, setStatusV] = useState(task.action === 'learn-concept' ? 'concept-completed' : 'practicing');
  const [logPractice, setLogPractice] = useState(task.action === 'practice-questions' || task.action === 'sectional-test');
  const [attempted, setAttempted] = useState('');
  const [correct, setCorrect] = useState('');
  const [minutes, setMinutes] = useState(String(task.minutes));
  const [revision, setRevision] = useState(task.action === 'revise-notes');
  const [note, setNote] = useState('');
  const a = Number(attempted), c = Number(correct);
  const practiceError = logPractice && (!(Number.isInteger(a) && a > 0) || !(Number.isInteger(c) && c >= 0 && c <= a));
  const isTopic = !!task.topicId;
  const submit = async () => {
    const outcome: Record<string, unknown> = {};
    if (isTopic && setStatus) outcome.status = status;
    if (isTopic && logPractice) outcome.practice = { attempted: a, correct: c, timeSeconds: minutes ? Math.round(Number(minutes) * 60) : null, date, revision: task.action === 'revise-notes' && revision };
    if (isTopic && revision && !(logPractice && task.action === 'revise-notes')) outcome.revision = { date, note: note || 'Completed from study plan' };
    const r = await store.run(() => store.planner.completeTask(date, task.taskId, { outcome: Object.keys(outcome).length ? outcome : null, note }),
      Object.keys(outcome).length ? 'Task completed and progress updated' : 'Task completed');
    if (r !== undefined) onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Complete “${task.name}”`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Check} disabled={!!practiceError} onClick={submit}>Mark completed</Button></>}>
      <p className="mb-3 text-xs text-muted">Marking a task done does not change your progress by itself. Tick what you actually did; it is recorded for {store.examName(task.primaryExamId)} through the progress engine.</p>
      {isTopic ? (
        <div className="space-y-3">
          <div>
            <Checkbox checked={setStatus} onChange={setSetStatus} label="Update syllabus status" />
            {setStatus && <Select className="mt-2" value={status} onChange={(e) => setStatusV(e.target.value)} aria-label="New status">{statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>}
          </div>
          <div>
            <Checkbox checked={logPractice} onChange={setLogPractice} label="Log the questions I practised" />
            {logPractice && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Field label="Attempted"><Input inputMode="numeric" value={attempted} onChange={(e) => setAttempted(e.target.value.replace(/[^\d]/g, ''))} /></Field>
                <Field label="Correct"><Input inputMode="numeric" value={correct} onChange={(e) => setCorrect(e.target.value.replace(/[^\d]/g, ''))} /></Field>
                <Field label="Minutes"><Input inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
              </div>
            )}
            {practiceError && (attempted || correct) && <p className="mt-1 text-xs text-critical">Correct answers must be between 0 and the questions attempted.</p>}
          </div>
          <Checkbox checked={revision} onChange={setRevision} label="I revised this topic (confirms a revision)" />
        </div>
      ) : <p className="text-sm text-ink2">Mock tests are exam-level tasks: completing one records the date, so the next mock is suggested after the minimum gap.</p>}
      <Field label="Note (optional)" className="mt-3"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. scored 142/200" /></Field>
    </Modal>
  );
}

function AddTaskModal({ date, onClose }: { date: string; onClose: () => void }) {
  const { store } = useApp();
  const targets = store.planner.settings.targets;
  const pr = useAsync(() => store.planner.compute(), [store.engine.getVersion()]);
  const [examId, setExamId] = useState(targets[0]?.examId ?? '');
  const topics = useMemo(() => (pr.data?.priorities.topics ?? []).filter((t) => t.perExam[examId]).sort((a, b) => a.name.localeCompare(b.name)), [pr.data, examId]);
  const [topicId, setTopicId] = useState('');
  const [action, setAction] = useState<PlannerAction>('practice-questions');
  const [minutes, setMinutes] = useState('');
  const tid = topicId || topics[0]?.topicId || '';
  const row = pr.data?.priorities.topics.find((t) => t.topicId === tid)?.perExam[examId];
  const suggested = action === 'mock-test' ? 120 : plannerApi.estimateMinutes(action, row ?? null, store.planner.config());
  const m = Number(minutes || suggested);
  return (
    <Modal open onClose={onClose} title={`Add a task for ${shortDate(date)}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Plus} disabled={!(m > 0) || (action !== 'mock-test' && !tid)} onClick={async () => {
        const r = await store.run(() => store.planner.addTask(date, action === 'mock-test'
          ? { examId, action, minutes: m, name: `${store.examName(examId)} full mock test` }
          : { topicId: tid, examId, action, minutes: m }), 'Task added');
        if (r !== undefined) onClose();
      }}>Add</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Exam"><Select value={examId} onChange={(e) => { setExamId(e.target.value); setTopicId(''); }}>{targets.map((t) => <option key={t.examId} value={t.examId}>{store.examName(t.examId)}</option>)}</Select></Field>
        <Field label="Action"><Select value={action} onChange={(e) => setAction(e.target.value as PlannerAction)}>{plannerApi.ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}</Select></Field>
        {action !== 'mock-test' && (
          <Field label="Topic" className="sm:col-span-2">
            <Select value={tid} onChange={(e) => setTopicId(e.target.value)} disabled={!topics.length} aria-label="Topic">
              {topics.map((t) => <option key={t.topicId} value={t.topicId}>{t.name} ({t.classification})</option>)}
            </Select>
          </Field>
        )}
        <Field label="Minutes" hint={`Suggested ${suggested} min`}><Input inputMode="numeric" value={minutes} placeholder={String(suggested)} onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ''))} /></Field>
      </div>
    </Modal>
  );
}
