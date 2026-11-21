import { useState } from 'react';
import { Flame, CalendarPlus, EyeOff, HelpCircle, Undo2, ChevronDown, Trophy, AlertTriangle } from 'lucide-react';
import type { PageProps } from '../App';
import { useApp, useAsync } from '../lib/hooks';
import { planner as plannerApi } from '../lib/engines';
import { pct, reasonText, shortDate, addDays, isDate } from '../lib/format';
import type { PriorityClass, Recommendation } from '../lib/types';
import { Badge, Button, Card, CardBody, CardHeader, ClassBadge, CLASS_META, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal, PageHeader, Select, ACTION_LABEL, cn } from '../components/ui';
import { TargetsGate } from '../components/TargetsGate';

const CLASSES: PriorityClass[] = ['Critical', 'High', 'Medium', 'Low'];

export function PrioritiesPage({ navigate }: PageProps) {
  return <TargetsGate onSettings={() => navigate('settings')}><Priorities navigate={navigate} /></TargetsGate>;
}

function Priorities({ navigate }: { navigate: PageProps['navigate'] }) {
  const { store } = useApp();
  const key = [store.engine.getVersion(), JSON.stringify(store.planner.settings), JSON.stringify(store.planner.data.dismissed), store.today()];
  const res = useAsync(() => store.planner.getRecommendations({ limit: 1000 }), key);
  const [shown, setShown] = useState<Record<PriorityClass, number>>({ Critical: 10, High: 10, Medium: 8, Low: 5 });
  const [openGroups, setOpenGroups] = useState<Record<PriorityClass, boolean>>({ Critical: true, High: true, Medium: true, Low: false });
  const [adding, setAdding] = useState<Recommendation | null>(null);
  const [dismissing, setDismissing] = useState<Recommendation | null>(null);
  const [explaining, setExplaining] = useState<string | null>(null);
  const dismissed = Object.values(store.planner.data.dismissed);

  if (res.error) return <Card><ErrorState error={res.error} /></Card>;
  const data = res.data;
  return (
    <div className="space-y-4" data-testid="page-priorities">
      <PageHeader title="Smart priorities" description="The most valuable topics to study next across your target exams."
        action={<Button icon={CalendarPlus} onClick={() => navigate('planner')}>Open study planner</Button>} />
      {!data ? <Card><LoadingBlock rows={8} /></Card> : (
        <>
          <div className="flex flex-wrap gap-2" data-testid="shares">
            {data.shares.map((s) => (
              <span key={s.examId} className="card inline-flex items-center gap-2 px-3 py-1.5 text-xs">
                <span className="font-semibold">{store.examName(s.examId)}</span>
                <span className="text-muted">importance {s.importance}</span>
                <span className="tabular text-ink2">share {pct(s.share * 100, 0)}</span>
                {s.examDate && <span className="text-muted">{s.past ? 'exam date passed' : `${s.daysLeft} days left`}</span>}
              </span>
            ))}
          </div>
          {data.shares.some((s) => s.past) && <p className="flex items-center gap-2 text-xs text-critical"><AlertTriangle className="h-3.5 w-3.5" /> An exam date has passed and that exam is excluded from planning. Update it in Settings.</p>}

          {data.examRecommendations.length > 0 && (
            <Card>
              <CardHeader title="Mock tests" icon={Trophy} description="Recommended because the exam is mock-ready" />
              <CardBody className="space-y-2">
                {data.examRecommendations.map((m) => (
                  <div key={m.examId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>{m.reason}</span>
                    <Button size="sm" icon={CalendarPlus} onClick={() => store.run(() => store.planner.addTask(store.today(), { examId: m.examId, action: 'mock-test', minutes: 120, name: `${m.examName} full mock test`, detail: m.reason }), 'Mock test added to today’s plan')}>Add to today</Button>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          {data.recommendations.length === 0 ? <Card><EmptyState icon={Flame} title="Nothing to recommend" description="Every topic is completed and mastered, or dismissed." /></Card> : CLASSES.map((cls) => {
            const list = data.recommendations.filter((r) => r.classification === cls);
            const M = CLASS_META[cls];
            return (
              <Card key={cls} data-testid={`group-${cls}`}>
                <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5" aria-expanded={openGroups[cls]} onClick={() => setOpenGroups({ ...openGroups, [cls]: !openGroups[cls] })}>
                  <span className={cn('h-2.5 w-2.5 rounded-full', M.dot)} aria-hidden />
                  <span className="text-sm font-semibold">{cls}</span>
                  <Badge>{list.length}</Badge>
                  <span className="hidden text-xs text-muted sm:inline">score {cls === 'Low' ? `< ${store.planner.config().priority.classification.thresholds.Medium}` : `≥ ${store.planner.config().priority.classification.thresholds[cls]}`}</span>
                  <ChevronDown className={cn('ml-auto h-4 w-4 text-muted transition-transform', !openGroups[cls] && '-rotate-90')} aria-hidden />
                </button>
                {openGroups[cls] && (list.length === 0 ? <p className="border-t border-line px-5 py-4 text-xs text-muted">No {cls.toLowerCase()} priority topics.</p> : (
                  <ul className="border-t border-line">
                    {list.slice(0, shown[cls]).map((r) => <RecRow key={r.topicId} r={r} onAdd={() => setAdding(r)} onDismiss={() => setDismissing(r)} onExplain={() => setExplaining(r.topicId)} />)}
                    {list.length > shown[cls] && <li className="p-3 text-center"><Button size="sm" onClick={() => setShown({ ...shown, [cls]: shown[cls] + 20 })}>Show more ({list.length - shown[cls]})</Button></li>}
                  </ul>
                ))}
              </Card>
            );
          })}

          {dismissed.length > 0 && (
            <Card>
              <CardHeader title="Dismissed" icon={EyeOff} description="Hidden from recommendations. Your progress for these topics is unchanged." />
              <CardBody>
                <ul className="divide-y divide-line/70">
                  {dismissed.map((d) => (
                    <li key={`${d.topicId}@${d.examId}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span>{store.planner.topicNames.get(d.topicId) ?? d.topicId}{d.examId ? <span className="text-muted"> · {store.examName(d.examId)} only</span> : ''}{d.until ? <span className="text-muted"> · until {shortDate(d.until)}</span> : ''}{d.reason ? <span className="text-muted"> · “{d.reason}”</span> : ''}</span>
                      <Button size="sm" variant="ghost" icon={Undo2} onClick={() => store.run(() => store.planner.undismissRecommendation(d.topicId, { examId: d.examId }), 'Recommendation restored')}>Restore</Button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </>
      )}
      {adding && <AddToPlanModal r={adding} onClose={() => setAdding(null)} />}
      {dismissing && <DismissModal r={dismissing} onClose={() => setDismissing(null)} />}
      {explaining && <ExplainModal topicId={explaining} onClose={() => setExplaining(null)} />}
    </div>
  );
}

function RecRow({ r, onAdd, onDismiss, onExplain }: { r: Recommendation; onAdd: () => void; onDismiss: () => void; onExplain: () => void }) {
  return (
    <li className="border-b border-line/70 px-4 py-3 last:border-b-0 sm:px-5" data-testid={`rec-${r.topicId}`}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <span className="tabular w-6 pt-0.5 text-xs text-muted">#{r.rank}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{r.name}</span>
            <ClassBadge value={r.classification} />
            <span className="tabular text-xs text-muted">score {r.priorityScore.toFixed(1)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
            <span>{r.relevantExam.name}{r.relevantExams.length > 1 ? ` (+${r.relevantExams.length - 1})` : ''}</span>
            {r.section && <span className="truncate">{r.section}</span>}
            <span>weightage {pct(r.topicWeightage, 2)}</span>
            <span>completion {pct(r.syllabusCompletion, 0)}</span>
            <span>mastery {pct(r.examMastery, 0)}</span>
          </div>
          <ul className="mt-2 space-y-0.5 text-sm text-ink2">
            {r.reasons.slice(0, 4).map((x) => <li key={x} className="flex gap-1.5"><span className="text-muted">•</span>{reasonText(x)}</li>)}
          </ul>
          <p className="mt-2 text-sm"><Badge tone="accent">{r.suggestedAction.label}</Badge> <span className="text-ink2">{r.suggestedAction.detail}</span></p>
        </div>
        <div className="flex w-full flex-wrap gap-1.5 sm:w-auto sm:flex-col sm:items-end">
          <Button size="sm" variant="primary" icon={CalendarPlus} onClick={onAdd}>Add to plan</Button>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" icon={HelpCircle} onClick={onExplain}>Why?</Button>
            <Button size="sm" variant="ghost" icon={EyeOff} onClick={onDismiss}>Dismiss</Button>
          </div>
        </div>
      </div>
    </li>
  );
}

function AddToPlanModal({ r, onClose }: { r: Recommendation; onClose: () => void }) {
  const { store } = useApp();
  const today = store.today();
  const [date, setDate] = useState(today);
  const [examId, setExamId] = useState(r.relevantExam.examId);
  const [action, setAction] = useState(r.suggestedAction.action);
  const def = useAsync(async () => {
    const { priorities } = await store.planner.compute();
    const row = priorities.topics.find((t) => t.topicId === r.topicId)?.perExam[examId];
    return plannerApi.estimateMinutes(action, row ?? null, store.planner.config());
  }, [examId, action]);
  const [minutes, setMinutes] = useState<string>('');
  const m = Number(minutes || def.data || 30);
  const valid = isDate(date) && m > 0 && m <= 600;
  return (
    <Modal open onClose={onClose} title={`Add “${r.name}” to the study plan`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!valid} onClick={async () => {
        const ok = await store.run(() => store.planner.addTask(date, { topicId: r.topicId, examId, action, minutes: m, detail: r.suggestedAction.detail }), `Added to the plan for ${shortDate(date)}`);
        if (ok !== undefined) onClose();
      }}>Add task</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Day"><Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Quick pick">
          <Select value="" onChange={(e) => e.target.value && setDate(addDays(today, Number(e.target.value)))}>
            <option value="">Choose…</option><option value="0">Today</option><option value="1">Tomorrow</option><option value="2">In 2 days</option><option value="7">Next week</option>
          </Select>
        </Field>
        <Field label="For exam"><Select value={examId} onChange={(e) => setExamId(e.target.value)}>{r.relevantExams.map((e) => <option key={e.examId} value={e.examId}>{e.name}</option>)}</Select></Field>
        <Field label="Action"><Select value={action} onChange={(e) => setAction(e.target.value as typeof action)}>{plannerApi.ACTIONS.filter((a) => a !== 'mock-test').map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}</Select></Field>
        <Field label="Minutes" hint={def.data ? `Suggested ${def.data} min for this action` : undefined}><Input inputMode="numeric" value={minutes} placeholder={String(def.data ?? 30)} onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ''))} /></Field>
      </div>
    </Modal>
  );
}

function DismissModal({ r, onClose }: { r: Recommendation; onClose: () => void }) {
  const { store } = useApp();
  const [scope, setScope] = useState<string>('all');
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} title={`Dismiss “${r.name}”`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={async () => {
        await store.run(() => store.planner.dismissRecommendation(r.topicId, { examId: scope === 'all' ? null : scope, until: until || null, reason }), 'Recommendation dismissed. Progress is unchanged.');
        onClose();
      }}>Dismiss</Button></>}>
      <p className="mb-3 text-xs text-muted">This only hides the recommendation. Syllabus progress, practice and mastery are not changed.</p>
      <div className="grid gap-3">
        <Field label="Hide for"><Select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">All target exams</option>
          {r.relevantExams.map((e) => <option key={e.examId} value={e.examId}>{e.name} only</option>)}
        </Select></Field>
        <Field label="Until (optional)" hint="Leave empty to hide until you restore it"><Input type="date" value={until} min={store.today()} onChange={(e) => setUntil(e.target.value)} /></Field>
        <Field label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. covering this in coaching" /></Field>
      </div>
    </Modal>
  );
}

const FACTOR_LABEL: Record<string, string> = {
  learningGap: 'Learning gap (1 − completion)', masteryGap: 'Mastery gap (1 − mastery)', untouched: 'Not started yet', revisionDue: 'Revision due',
  accuracyGap: 'Recent accuracy gap', difficulty: 'Difficulty for this exam',
};

function ExplainModal({ topicId, onClose }: { topicId: string; onClose: () => void }) {
  const { store } = useApp();
  const res = useAsync(() => store.planner.explain(topicId), [topicId]);
  const ex = res.data;
  return (
    <Modal open wide onClose={onClose} title={ex ? `Why “${ex.name}” scored ${ex.score.toFixed(1)}` : 'Priority explanation'}>
      {res.error ? <ErrorState error={res.error} /> : !ex ? <LoadingBlock /> : (
        <div className="space-y-4 text-sm">
          <p className="text-xs text-muted">Combined score = Σ (exam share × exam score). Each exam score = 100 × Σ weight × factor ÷ Σ weights; the factor table shows each term’s contribution in points.</p>
          {ex.perExam.map((x) => (
            <div key={x.examId} className="rounded-lg border border-line">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
                <span className="font-medium">{store.examName(x.examId)}</span>
                <span className="tabular text-xs text-muted">share {x.share} × score {x.score} = <span className="font-semibold text-ink">{x.contribution}</span></span>
              </div>
              <div className="scroll-x">
                <table className="table-base">
                  <thead><tr><th>Factor</th><th className="text-right">Value</th><th className="text-right">Weight</th><th className="text-right">Points</th></tr></thead>
                  <tbody>
                    {Object.entries(x.contributions).map(([k, v]) => (
                      <tr key={k}><td>{FACTOR_LABEL[k] ?? k}</td><td className="tabular text-right">{(x.factors[k] ?? 0).toFixed(2)}</td><td className="tabular text-right">{ex.weights[k]}</td><td className="tabular text-right font-medium">{v.toFixed(1)}</td></tr>
                    ))}
                    <tr><td className="text-muted">Importance (√ weightage) × history</td><td className="tabular text-right">{(x.factors.adjustedImportance ?? 0).toFixed(2)}</td><td /><td /></tr>
                  </tbody>
                </table>
              </div>
              <ul className="space-y-0.5 px-3 py-2 text-xs text-ink2">{x.reasons.map((r) => <li key={r}>• {reasonText(r)}</li>)}</ul>
            </div>
          ))}
          <p className="text-xs text-muted">Classes: Critical ≥ {ex.thresholds.Critical}, High ≥ {ex.thresholds.High}, Medium ≥ {ex.thresholds.Medium}. Weights and thresholds can be changed in Settings.</p>
        </div>
      )}
    </Modal>
  );
}
