import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Clock, Scale, Gauge, ListChecks, Palette, RotateCcw, SlidersHorizontal, Link2, Save } from 'lucide-react';
import { DataManagement } from '../components/DataManagement';
import { AccountCard } from '../components/Account';
import type { PageProps } from '../App';
import { useApp, useTheme } from '../lib/hooks';
import { progress } from '../lib/engines';
import type { ProgressConfig } from '../lib/engines';
import { isDate, pct } from '../lib/format';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader, ResponsiveTable, Segmented, Select, cn } from '../components/ui';

const NAV = [
  { id: 'targets', label: 'Target exams' }, { id: 'time', label: 'Study time & revision' }, { id: 'priority', label: 'Priority scoring' },
  { id: 'weightage', label: 'Topic weightage' }, { id: 'statuses', label: 'Status scores' }, { id: 'mastery', label: 'Mastery' },
  { id: 'appearance', label: 'Appearance' }, { id: 'data', label: 'Data & backups' },
];

const ActiveSection = createContext('targets');

export function SettingsPage({ params }: PageProps) {
  const { store } = useApp();
  const nav = store.account ? [{ id: 'account', label: 'Account & sync' }, ...NAV] : NAV;
  const section = params.get('section');
  const active = nav.some((n) => n.id === section) ? section! : nav[0].id;
  const tabs = useRef<HTMLElement>(null);
  useEffect(() => { if (section) document.getElementById(`settings-${section}`)?.scrollIntoView({ block: 'start' }); }, [section]);
  useEffect(() => {
    const bar = tabs.current;
    const tab = bar?.querySelector<HTMLElement>('[aria-current="true"]');
    if (bar && tab) bar.scrollLeft = tab.offsetLeft - (bar.clientWidth - tab.offsetWidth) / 2;
  }, [active]);
  return (
    <div data-testid="page-settings">
      <PageHeader title="Settings" description="Every change is validated and saved immediately; calculations update everywhere." />
      <nav ref={tabs} className="sticky top-[calc(3.8125rem+env(safe-area-inset-top))] z-20 -mx-4 mb-3 overflow-x-auto bg-page/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden" aria-label="Settings tabs">
        <ul className="flex w-max gap-1.5">
          {nav.map((n) => (
            <li key={n.id}>
              <a href={`#/settings?section=${n.id}`} aria-current={n.id === active ? 'true' : undefined}
                className={cn('flex items-center whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors', n.id === active ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line bg-surface text-ink2')}>{n.label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav className="hidden lg:block" aria-label="Settings sections">
          <ul className="sticky top-20 space-y-0.5 text-sm">
            {nav.map((n) => <li key={n.id}><a href={`#/settings?section=${n.id}`} aria-current={n.id === active ? 'true' : undefined} className={cn('block rounded-md px-2 py-1.5 transition-colors hover:bg-subtle hover:text-ink', n.id === active ? 'bg-subtle font-medium text-ink' : 'text-ink2')}>{n.label}</a></li>)}
          </ul>
        </nav>
        <ActiveSection.Provider value={active}>
          <div className="min-w-0 space-y-5">
            {store.account && <Section id="account"><AccountCard /></Section>}
            <TargetsCard />
            <TimeCard />
            <PriorityCard />
            <WeightageCard />
            <StatusScoresCard />
            <MasteryCard />
            <AppearanceCard />
            <Section id="data"><DataManagement /></Section>
          </div>
        </ActiveSection.Provider>
      </div>
    </div>
  );
}

function Section({ id, children }: { id: string; children: React.ReactNode }) {
  const active = useContext(ActiveSection);
  return <section id={`settings-${id}`} className={cn('scroll-mt-36 lg:scroll-mt-24', id !== active && 'hidden lg:block')}>{children}</section>;
}

function TargetsCard() {
  const { store } = useApp();
  const current = store.planner.settings.targets;
  const [rows, setRows] = useState(() => store.exams.map((e) => {
    const t = current.find((x) => x.examId === e.examId);
    return { examId: e.examId, on: !!t, importance: String(t?.importance ?? 50), examDate: t?.examDate ?? '' };
  }));
  const chosen = rows.filter((r) => r.on);
  const errors = chosen.flatMap((r) => {
    const n = Number(r.importance);
    return [!(n > 0 && n <= 100) ? `${store.examName(r.examId)}: importance must be 1–100` : null, r.examDate && !isDate(r.examDate) ? `${store.examName(r.examId)}: invalid date` : null].filter(Boolean) as string[];
  });
  const total = chosen.reduce((a, r) => a + (Number(r.importance) || 0), 0);
  const set = (id: string, patch: Partial<(typeof rows)[0]>) => setRows(rows.map((r) => (r.examId === id ? { ...r, ...patch } : r)));
  return (
    <Section id="targets">
      <Card>
        <CardHeader title="Target exams and exam priority" icon={Crosshair} description="Smart priorities, the planner and revisions plan across these exams. Importance sets each exam’s share; a nearer exam date raises it." />
        <CardBody>
          <div className="scroll-x">
            <ResponsiveTable className="table-base min-w-[34rem]" data-testid="targets-table">
              <thead><tr><th>Exam</th><th>Importance (1–100)</th><th>Share</th><th>Exam date</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.examId}>
                    <td><Checkbox checked={r.on} onChange={(v) => set(r.examId, { on: v })} label={<span className="font-medium text-ink">{store.examName(r.examId)}</span>} /></td>
                    <td><Input className="h-8 w-24" inputMode="numeric" disabled={!r.on} value={r.importance} onChange={(e) => set(r.examId, { importance: e.target.value.replace(/[^\d.]/g, '') })} aria-label={`Importance of ${store.examName(r.examId)}`} /></td>
                    <td className="tabular text-xs text-muted">{r.on && total ? pct((Number(r.importance) / total) * 100, 0) : '–'}</td>
                    <td><Input className="h-8 w-40" type="date" disabled={!r.on} value={r.examDate} onChange={(e) => set(r.examId, { examDate: e.target.value })} aria-label={`Exam date of ${store.examName(r.examId)}`} /></td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          </div>
          <p className="mt-2 text-2xs text-muted">Share shown before date urgency; the planner adds urgency as an exam approaches (within 180 days).</p>
          {errors.length > 0 && <ul className="mt-2 text-xs text-critical">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          <div className="mt-3 flex justify-end">
            <Button variant="primary" icon={Save} disabled={!chosen.length || errors.length > 0} data-testid="save-targets"
              onClick={() => store.run(() => store.planner.setTargets(chosen.map((r) => ({ examId: r.examId, importance: Number(r.importance), examDate: r.examDate || null }))), 'Target exams saved')}>
              Save targets
            </Button>
          </div>
        </CardBody>
      </Card>
    </Section>
  );
}

function TimeCard() {
  const { store } = useApp();
  const s = store.planner.settings;
  const cfg = store.planner.config();
  const [hours, setHours] = useState(String(s.dailyHours ?? cfg.dailyPlan.defaultHours));
  const [intervals, setIntervals] = useState(cfg.revision.intervalsDays.join(', '));
  const parsed = intervals.split(/[\s,]+/).filter(Boolean).map(Number);
  const ivError = !parsed.length || parsed.some((n) => !Number.isInteger(n) || n < 1 || n > 3650) ? 'Enter whole numbers of days (1–3650), e.g. 1, 3, 7, 15, 30' : null;
  const h = Number(hours);
  return (
    <Section id="time">
      <Card>
        <CardHeader title="Study time and revision intervals" icon={Clock} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div>
            <Field label="Daily study hours" hint={`Used for new daily plans (default ${cfg.dailyPlan.defaultHours} h)`}>
              <div className="flex gap-2"><Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Daily study hours" /><Button disabled={!(h >= 0 && h <= 24)} onClick={() => store.run(() => store.planner.setDailyHours(h), `Daily study time set to ${h} h`)}>Save</Button></div>
            </Field>
          </div>
          <div>
            <Field label="Revision intervals (days)" hint="Revision 1 after the first interval, then the next … the last repeats">
              <div className="flex gap-2"><Input value={intervals} onChange={(e) => setIntervals(e.target.value)} aria-label="Revision intervals" data-testid="intervals" /><Button disabled={!!ivError} onClick={() => store.run(() => store.planner.setRevisionIntervals(parsed), 'Revision intervals saved')}>Save</Button></div>
            </Field>
            {ivError && <p className="mt-1 text-xs text-critical">{ivError}</p>}
          </div>
        </CardBody>
      </Card>
    </Section>
  );
}

const W_LABEL: Record<string, string> = { learningGap: 'Learning gap', masteryGap: 'Mastery gap', untouched: 'Not started', revisionDue: 'Revision due', accuracyGap: 'Accuracy gap', difficulty: 'Difficulty' };

function PriorityCard() {
  const { store } = useApp();
  const cfg = store.planner.config();
  const [w, setW] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(cfg.priority.weights).map(([k, v]) => [k, String(v)])));
  const th = cfg.priority.classification.thresholds;
  const [t, setT] = useState({ Critical: String(th.Critical), High: String(th.High), Medium: String(th.Medium) });
  const save = () => {
    const overrides = structuredClone(store.planner.settings.configOverrides) as Record<string, Record<string, unknown>>;
    overrides.priority = { ...(overrides.priority ?? {}), weights: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Number(v)])), classification: { thresholds: { Critical: Number(t.Critical), High: Number(t.High), Medium: Number(t.Medium), Low: 0 } } };
    return store.run(() => store.planner.setConfigOverrides(overrides), 'Priority scoring saved');
  };
  const reset = () => {
    const overrides = structuredClone(store.planner.settings.configOverrides) as Record<string, unknown>;
    delete overrides.priority;
    return store.run(() => store.planner.setConfigOverrides(overrides), 'Priority scoring reset to defaults').then(() => {
      const d = store.planner.config();
      setW(Object.fromEntries(Object.entries(d.priority.weights).map(([k, v]) => [k, String(v)])));
      const dt = d.priority.classification.thresholds;
      setT({ Critical: String(dt.Critical), High: String(dt.High), Medium: String(dt.Medium) });
    });
  };
  return (
    <Section id="priority">
      <Card>
        <CardHeader title="Priority scoring" icon={SlidersHorizontal} description="How much each factor counts, and the score needed for each priority class (0–100)" />
        <CardBody>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Object.keys(w).map((k) => <Field key={k} label={W_LABEL[k] ?? k}><Input inputMode="decimal" value={w[k]} onChange={(e) => setW({ ...w, [k]: e.target.value.replace(/[^\d.]/g, '') })} /></Field>)}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {(['Critical', 'High', 'Medium'] as const).map((k) => <Field key={k} label={`${k} from score`}><Input inputMode="decimal" value={t[k]} onChange={(e) => setT({ ...t, [k]: e.target.value.replace(/[^\d.]/g, '') })} /></Field>)}
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2"><Button icon={RotateCcw} onClick={reset}>Reset to defaults</Button><Button variant="primary" icon={Save} onClick={save}>Save scoring</Button></div>
        </CardBody>
      </Card>
    </Section>
  );
}

function WeightageCard() {
  const { store } = useApp();
  const examId = store.activeExamId;
  const report = examId ? store.engine.getReport({ stageId: null }) : null;
  const overrides = examId ? store.engine.getWeightOverrides(examId) : {};
  const sections = report ? report.stages.filter((s) => !s.gate).flatMap((st) => st.sections.filter((s) => !s.gate).map((sec) => ({ st, sec }))) : [];
  const [key, setKey] = useState(sections[0]?.sec.key ?? '');
  const cur = sections.find((x) => x.sec.key === key) ?? sections[0];
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (!report || !cur) return <Section id="weightage"><Card><CardHeader title="Topic weightage" icon={Scale} description="Select an exam to customise its topic weightage." /><CardBody><span /></CardBody></Card></Section>;
  const k = (topicId: string) => progress.weightKey.topic(cur.st.stageId, cur.sec.sectionId, topicId);
  const save = (topicId: string, value: number | null) => store.run(() => store.engine.setWeightOverride({ kind: 'topic', stageId: cur.st.stageId, sectionId: cur.sec.sectionId, topicId }, value), value === null ? 'Custom weight removed' : 'Custom weight saved; sibling topics were rescaled');
  return (
    <Section id="weightage">
      <Card>
        <CardHeader title={`Topic weightage: ${report.shortName}`} icon={Scale} description="Custom weights are relative within the section; the other topics are rescaled so the section still totals 100%. Defaults come from the built-in weightage data." />
        <CardBody>
          <Select value={cur.sec.key} onChange={(e) => { setKey(e.target.value); setDraft({}); }} aria-label="Section" className="mb-3 sm:w-96">
            {sections.map(({ st, sec }) => <option key={sec.key} value={sec.key}>{report.stages.length > 1 ? `${st.name}: ` : ''}{sec.name}</option>)}
          </Select>
          <div className="scroll-x">
            <ResponsiveTable className="table-base min-w-[36rem]" data-testid="weight-table">
              <thead><tr><th>Topic</th><th className="text-right">Weight in section</th><th className="text-right">Of exam</th><th>Custom (relative)</th><th /></tr></thead>
              <tbody>
                {cur.sec.topics.map((t) => {
                  const ov = overrides[k(t.topicId)];
                  const d = draft[t.topicId] ?? (ov !== undefined ? String(ov) : '');
                  const n = Number(d);
                  return (
                    <tr key={t.topicId}>
                      <td className="font-medium">{t.name}{ov !== undefined && <Badge tone="accent" className="ml-2">custom</Badge>}</td>
                      <td className="tabular text-right">{pct(t.weightInSection)}</td>
                      <td className="tabular text-right text-muted">{pct(t.weightInExam, 2)}</td>
                      <td><Input className="h-8 w-24" inputMode="decimal" value={d} placeholder="default" onChange={(e) => setDraft({ ...draft, [t.topicId]: e.target.value.replace(/[^\d.]/g, '') })} aria-label={`Custom weight of ${t.name}`} /></td>
                      <td className="whitespace-nowrap text-right">
                        <Button size="sm" disabled={d === '' || !(n >= 0) || (ov !== undefined && n === ov)} onClick={() => save(t.topicId, n).then(() => setDraft((x) => { const c = { ...x }; delete c[t.topicId]; return c; }))}>Apply</Button>
                        {ov !== undefined && <Button size="sm" variant="ghost" onClick={() => save(t.topicId, null)}>Reset</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </ResponsiveTable>
          </div>
        </CardBody>
      </Card>
    </Section>
  );
}

function useConfigDraft() {
  const { store } = useApp();
  const [draft, setDraft] = useState<ProgressConfig>(() => structuredClone(store.engine.config));
  const save = (msg: string) => store.run(() => store.setProgressConfig(draft), msg);
  const reset = () => store.run(() => store.setProgressConfig(null), 'Scoring reset to the default configuration').then(() => setDraft(structuredClone(store.engine.config)));
  return { store, draft, setDraft, save, reset };
}

function StatusScoresCard() {
  const { store, draft, setDraft, save, reset } = useConfigDraft();
  const errors = useMemo(() => { try { progress.compileConfig(draft); return null; } catch (e) { return (e as Error).message.replace('Invalid progress config:', '').trim(); } }, [draft]);
  return (
    <Section id="statuses">
      <Card>
        <CardHeader title="Completion status scores" icon={ListChecks} description="Syllabus completion of a topic or subtopic = the score of its status. Scores must not decrease down the list." action={store.customConfig && <Badge tone="accent">customised</Badge>} />
        <CardBody>
          <div className="grid gap-2 sm:grid-cols-2">
            {draft.statuses.map((s, i) => (
              <label key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                <span className="text-sm">{s.label}</span>
                <span className="flex items-center gap-1"><Input className="h-8 w-20 text-right" inputMode="numeric" value={String(s.score)} aria-label={`Score for ${s.label}`} data-testid={`score-${s.id}`}
                  onChange={(e) => { const next = structuredClone(draft); next.statuses[i].score = Number(e.target.value.replace(/[^\d]/g, '') || 0); setDraft(next); }} /><span className="text-xs text-muted">%</span></span>
              </label>
            ))}
          </div>
          {errors && <pre className="mt-2 whitespace-pre-wrap text-xs text-critical">{errors}</pre>}
          <div className="mt-3 flex flex-wrap justify-end gap-2"><Button icon={RotateCcw} onClick={reset}>Reset all scoring to defaults</Button><Button variant="primary" icon={Save} disabled={!!errors} onClick={() => save('Status scores saved')} data-testid="save-scores">Save scores</Button></div>
        </CardBody>
      </Card>
    </Section>
  );
}

function MasteryCard() {
  const { store, draft, setDraft, save } = useConfigDraft();
  const m = draft.mastery;
  const upd = (fn: (c: ProgressConfig) => void) => { const n = structuredClone(draft); fn(n); setDraft(n); };
  const val = (s: string) => Number(s.replace(/[^\d.]/g, '') || 0);
  const errors = useMemo(() => { try { progress.compileConfig(draft); return null; } catch (e) { return (e as Error).message.replace('Invalid progress config:', '').trim(); } }, [draft]);
  const wSum = Object.values(m.weights).reduce((a, b) => a + b, 0);
  return (
    <Section id="mastery">
      <Card>
        <CardHeader title="Mastery calculation" icon={Gauge} description="Exam mastery = weighted mix of concept, accuracy, consistency, revision and speed. Weights are relative." />
        <CardBody>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(Object.keys(m.weights) as (keyof typeof m.weights)[]).map((k) => (
              <Field key={k} label={`${k[0].toUpperCase()}${k.slice(1)} weight`} hint={wSum ? pct((m.weights[k] / wSum) * 100, 0) : undefined}>
                <Input inputMode="decimal" value={String(m.weights[k])} onChange={(e) => upd((c) => { c.mastery.weights[k] = val(e.target.value); })} aria-label={`${k} weight`} />
              </Field>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Questions for full accuracy credit" hint="per topic"><Input inputMode="numeric" value={String(m.accuracy.targetQuestions.topic)} onChange={(e) => upd((c) => { c.mastery.accuracy.targetQuestions.topic = val(e.target.value); })} /></Field>
            <Field label="Practice sets for consistency" hint="per topic"><Input inputMode="numeric" value={String(m.consistency.targetPracticeSets.topic)} onChange={(e) => upd((c) => { c.mastery.consistency.targetPracticeSets.topic = val(e.target.value); })} /></Field>
            <Field label="Revisions for full credit"><Input inputMode="numeric" value={String(m.revision.targetRevisions)} onChange={(e) => upd((c) => { c.mastery.revision.targetRevisions = val(e.target.value); })} /></Field>
            <Field label="Target seconds / question" hint="used when no exam target"><Input inputMode="numeric" value={String(m.speed.targetSecondsPerQuestion)} onChange={(e) => upd((c) => { c.mastery.speed.targetSecondsPerQuestion = val(e.target.value); })} /></Field>
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <Checkbox checked={store.engine.db.progress.settings.sharedLearning !== false} onChange={(v) => store.run(() => store.engine.setSharedLearningEnabled(v), v ? 'Shared concept learning enabled' : 'Shared concept learning disabled: each exam is independent')}
              label={<span className="inline-flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" /> Share concept learning between exams</span>} />
          </div>
          {errors && <pre className="mt-2 whitespace-pre-wrap text-xs text-critical">{errors}</pre>}
          <div className="mt-3 flex justify-end"><Button variant="primary" icon={Save} disabled={!!errors} onClick={() => save('Mastery settings saved')}>Save mastery settings</Button></div>
        </CardBody>
      </Card>
    </Section>
  );
}

function AppearanceCard() {
  const { pref, setPref } = useTheme();
  return (
    <Section id="appearance">
      <Card>
        <CardHeader title="Appearance" icon={Palette} />
        <CardBody><Segmented label="Theme" value={pref} onChange={setPref} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} /></CardBody>
      </Card>
    </Section>
  );
}
