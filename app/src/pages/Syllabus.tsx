import { memo, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search, ChevronsDownUp, ChevronsUpDown, Link2, Unlink, ShieldCheck, NotebookPen, RotateCcw, Filter, ListTree, SlidersHorizontal } from 'lucide-react';
import type { PageProps } from '../App';
import { useApp, useMediaQuery } from '../lib/hooks';
import { useExam, type ExamCtx } from '../lib/useExam';
import { pct, num, secs, shortDate, titleCase } from '../lib/format';
import { isDone } from '../lib/selectors';
import type { SectionReport, TopicReport } from '../lib/types';
import { Badge, Button, Card, Checkbox, EmptyState, InlineSheet, Input, PageHeader, Progress, RevisionBadge, Select, cn } from '../components/ui';
import { PracticeForm } from '../components/PracticeForm';

type Sort = 'syllabus' | 'weight' | 'completion' | 'mastery' | 'priority';
const PHONE = '(max-width: 767.98px)';
const sectionKeys = (report: { stages: { inScope: boolean; sections: { key: string }[] }[] }) => report.stages.filter((s) => s.inScope).flatMap((s) => s.sections.map((x) => x.key));

export function SyllabusPage({ params }: PageProps) {
  const ctx = useExam()!;
  const { report, analysis, statuses } = ctx;
  const [q, setQ] = useState(params.get('q') ?? '');
  const [section, setSection] = useState('all');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<Sort>('syllabus');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [highOnly, setHighOnly] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set(params.get('topic') ? [params.get('topic')!] : []));
  const isPhone = useMediaQuery(PHONE);
  // Phones start with sections folded so the whole syllabus is scannable.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set(window.matchMedia?.(PHONE).matches ? sectionKeys(report) : []));
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (isPhone) setCollapsedSections(new Set(sectionKeys(report)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.examId, report.scope.stageId, isPhone]);

  const stages = report.stages.filter((s) => s.inScope);
  const allSections = stages.flatMap((s) => s.sections.map((sec) => ({ stage: s, sec })));
  const needle = q.trim().toLowerCase();

  const matches = useMemo(() => {
    const m = new Map<string, { hit: boolean; subHit: boolean }>();
    for (const t of Object.values(report.topics)) {
      if (!t.inScope) continue;
      const subHit = !!needle && t.subtopicIds.some((id) => report.subtopics[id]?.name.toLowerCase().includes(needle));
      const nameHit = !needle || t.name.toLowerCase().includes(needle);
      const st = t.status ?? 'not-started';
      const statusOk = status === 'all' || (status === 'pending' ? !isDone(t.category) : st === status);
      const pendOk = !pendingOnly || !isDone(t.category);
      const cls = analysis.rows[t.topicId]?.classification;
      const highOk = !highOnly || cls === 'Critical' || cls === 'High' || t.priority === 'Very High';
      m.set(t.topicId, { hit: (nameHit || subHit) && statusOk && pendOk && highOk, subHit });
    }
    return m;
  }, [report, needle, status, pendingOnly, highOnly, analysis]);

  const sortTopics = (list: SectionReport['topics']) => {
    const arr = [...list];
    const T = (id: string) => report.topics[id];
    if (sort === 'weight') arr.sort((a, b) => b.weightInExam - a.weightInExam);
    if (sort === 'completion') arr.sort((a, b) => T(a.topicId).completion - T(b.topicId).completion);
    if (sort === 'mastery') arr.sort((a, b) => T(a.topicId).mastery - T(b.topicId).mastery);
    if (sort === 'priority') arr.sort((a, b) => (analysis.rows[b.topicId]?.score ?? 0) - (analysis.rows[a.topicId]?.score ?? 0));
    return arr;
  };

  const visibleCount = [...matches.values()].filter((x) => x.hit).length;
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const anyFilter = !!needle || section !== 'all' || status !== 'all' || pendingOnly || highOnly;
  const activeFilters = [section !== 'all', status !== 'all', sort !== 'syllabus', pendingOnly, highOnly].filter(Boolean).length;

  return (
    <div data-testid="page-syllabus">
      <PageHeader title="Syllabus tracker" description={`${report.shortName} · ${report.summary.topicCounts.total} topics · ${pct(report.summary.syllabusCompletion)} complete`}
        action={<>
          <Button size="sm" variant="ghost" icon={ChevronsUpDown} onClick={() => { setCollapsedSections(new Set()); setOpen(new Set([...matches.entries()].filter(([, v]) => v.hit).map(([k]) => k))); }}>Expand all</Button>
          <Button size="sm" variant="ghost" icon={ChevronsDownUp} onClick={() => { setOpen(new Set()); setCollapsedSections(new Set(isPhone ? sectionKeys(report) : [])); }}>Collapse all</Button>
        </>} />

      <Card className={cn('sticky top-[calc(3.8125rem+env(safe-area-inset-top))] mb-4 p-2.5 shadow-sm md:relative md:top-0 md:p-3 md:shadow-none', filtersOpen ? 'z-50' : 'z-20 md:z-auto')}>
        <div className="flex gap-2 md:grid md:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_1fr_1fr_1fr]">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics and subtopics…" className="pl-9" aria-label="Search topics" data-testid="syllabus-search" />
          </div>
          <Button icon={SlidersHorizontal} aria-label={`Filters${activeFilters ? ` (${activeFilters} active)` : ''}`} aria-haspopup="dialog" className="md:hidden" onClick={() => setFiltersOpen(true)}>
            {activeFilters > 0 && <span className="tabular">{activeFilters}</span>}
          </Button>
          <InlineSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter and sort" breakpoint="md">
            <Select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Filter by section" data-testid="filter-section">
              <option value="all">All sections</option>
              {allSections.map(({ stage, sec }) => <option key={sec.key} value={sec.key}>{stages.length > 1 ? `${stage.name}: ` : ''}{sec.name}</option>)}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" data-testid="filter-status">
              <option value="all">Any status</option>
              <option value="pending">Pending (not completed)</option>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
            <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort topics" data-testid="sort">
              <option value="syllabus">Syllabus order</option>
              <option value="weight">Weightage (highest first)</option>
              <option value="priority">Priority (highest first)</option>
              <option value="completion">Completion (lowest first)</option>
              <option value="mastery">Mastery (lowest first)</option>
            </Select>
            <div className="flex flex-col md:col-span-2 md:min-h-6 md:flex-row md:flex-wrap md:items-center md:gap-x-5 md:pr-36 lg:col-span-4">
              <Checkbox checked={pendingOnly} onChange={setPendingOnly} label="Pending topics only" />
              <Checkbox checked={highOnly} onChange={setHighOnly} label="High-priority topics only" />
            </div>
          </InlineSheet>
        </div>
        <span className="mt-1.5 flex items-center justify-end gap-1.5 text-xs text-muted md:absolute md:bottom-3.5 md:right-3 md:mt-0" data-testid="visible-count"><Filter className="h-3.5 w-3.5" aria-hidden />{visibleCount} of {matches.size} topics</span>
      </Card>

      {visibleCount === 0 ? (
        <Card><EmptyState icon={ListTree} title="No topics match" description="Change the search or filters." action={anyFilter && <Button onClick={() => { setQ(''); setSection('all'); setStatus('all'); setPendingOnly(false); setHighOnly(false); }}>Clear filters</Button>} /></Card>
      ) : (
        <div className="space-y-6">
          {stages.map((st) => {
            const secs = st.sections.filter((sec) => (section === 'all' || sec.key === section) && sec.topics.some((t) => matches.get(t.topicId)?.hit));
            if (!secs.length) return null;
            return (
              <section key={st.stageId} aria-label={st.name}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">{st.name}{st.gate && <Badge className="ml-2" icon={ShieldCheck}>Qualifying</Badge>}</h2>
                  <span className="tabular text-xs text-muted">{pct(st.weightInExam)} of exam · {pct(st.completion)} complete · mastery {pct(st.mastery)}</span>
                </div>
                <div className="space-y-3">
                  {secs.map((sec) => {
                    const collapsed = collapsedSections.has(sec.key) && !needle;
                    const topics = sortTopics(sec.topics).filter((t) => matches.get(t.topicId)?.hit);
                    return (
                      <Card key={sec.key} className={cn(!sec.active && 'opacity-60')}>
                        <button type="button" className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left sm:px-5" aria-expanded={!collapsed}
                          onClick={() => setCollapsedSections((s) => { const n = new Set(s); if (n.has(sec.key)) n.delete(sec.key); else n.add(sec.key); return n; })}>
                          <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted transition-transform', !collapsed && 'rotate-90')} aria-hidden />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{sec.name}</div>
                            <div className="text-2xs text-muted">{sec.gate ? 'Qualifying · not weighted' : `${pct(sec.weightInStage)} of stage · ${pct(sec.weightInExam)} of exam`} · {sec.topics.length} topics{!sec.active ? ' · not selected (choice)' : ''}</div>
                          </div>
                          <div className="flex w-full items-center gap-3 sm:w-64">
                            <Progress value={sec.completion} label={`${sec.name} completion`} />
                            <span className="tabular w-12 shrink-0 text-right text-xs">{pct(sec.completion)}</span>
                          </div>
                        </button>
                        {!collapsed && (
                          <div className="border-t border-line">
                            <div className="hidden grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_8rem_4.5rem_10rem_7rem] gap-3 px-5 py-2 text-2xs font-medium uppercase tracking-wide text-muted xl:grid">
                              <span>Topic</span><span className="text-right">In section</span><span className="text-right">Of exam</span><span>Completion</span><span className="text-right">Mastery</span><span>Status</span><span>Revision</span>
                            </div>
                            <ul>
                              {topics.map((t) => (
                                <TopicRow key={t.topicId} ctx={ctx} topic={report.topics[t.topicId]} weightInSection={t.weightInSection} weightInExam={t.weightInExam}
                                  open={open.has(t.topicId) || (!!needle && !!matches.get(t.topicId)?.subHit)} onToggle={() => toggle(t.topicId)} gate={sec.gate} />
                              ))}
                            </ul>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusSelect({ value, onChange, statuses, label, inheritLabel }: { value: string; onChange: (v: string) => void; statuses: { id: string; label: string }[]; label: string; inheritLabel?: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="h-8 text-xs" onClick={(e) => e.stopPropagation()}>
      {inheritLabel !== undefined && <option value="">{inheritLabel}</option>}
      {statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
    </Select>
  );
}

const TopicRow = memo(function TopicRow({ ctx, topic: t, weightInSection, weightInExam, open, onToggle, gate }: { ctx: ExamCtx; topic: TopicReport; weightInSection: number; weightInExam: number; open: boolean; onToggle: () => void; gate: boolean }) {
  const { store } = useApp();
  const row = ctx.analysis.rows[t.topicId];
  const sync = t.sharedLearning;
  return (
    <li className="border-b border-line/70 last:border-b-0" data-testid={`topic-${t.topicId}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-5 xl:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_8rem_4.5rem_10rem_7rem]">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 items-center gap-2 text-left">
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted transition-transform', open && 'rotate-90')} aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{t.name}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1">
              {t.priority && <Badge tone={t.priority === 'Very High' ? 'accent' : 'neutral'} title="Weightage class from the built-in weightage data">{t.priority} weightage</Badge>}
              {row && !row.done && (row.classification === 'Critical' || row.classification === 'High') && <Badge tone={row.classification === 'Critical' ? 'critical' : 'serious'} title="Preparation priority">{row.classification} priority</Badge>}
              {sync && t.masterTopicId && (sync.syncMode === 'independent'
                ? <Badge icon={Unlink} title="Progress for this topic is independent in each exam">Independent</Badge>
                : <Badge tone="accent" icon={Link2} title={`Concept learning is shared across exams (${sync.syncMode} sync)`}>Shared concept</Badge>)}
              {t.sharedUplift > 0 && <Badge tone="good" title="Completion includes concept learning done for another exam">+{pct(t.sharedUplift, 0)} shared</Badge>}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-2 xl:hidden">
          <span className="tabular text-xs text-muted">{pct(t.completion, 0)}</span>
        </div>
        <span className="tabular hidden text-right text-xs xl:block" title="Weight within its section">{gate ? '–' : pct(weightInSection)}</span>
        <span className="tabular hidden text-right text-xs text-muted xl:block" title="Effective weight in the whole exam">{gate ? '–' : pct(weightInExam, 2)}</span>
        <div className="col-span-2 flex items-center gap-2 xl:col-span-1">
          <Progress value={t.completion} size="sm" label={`${t.name} completion`} />
          <span className="tabular shrink-0 whitespace-nowrap text-right text-2xs text-muted xl:hidden">mastery {pct(t.mastery, 0)}</span>
        </div>
        <span className="tabular hidden text-right text-xs xl:block" title={`Mastery level: ${t.masteryLevel}`}>{pct(t.mastery, 0)}</span>
        <div className="col-span-2 grid grid-cols-2 gap-2 xl:col-span-1 xl:block">
          <StatusSelect value={t.status ?? 'not-started'} statuses={ctx.statuses} label={`Status of ${t.name}`}
            onChange={(v) => store.run(() => store.engine.setStatus(t.topicId, v))} />
          <div className="flex items-center xl:hidden"><RevisionBadge rev={row?.revision} compact /></div>
        </div>
        <div className="hidden xl:block"><RevisionBadge rev={row?.revision} compact /></div>
      </div>
      {open && <TopicDetail ctx={ctx} t={t} />}
    </li>
  );
});

function TopicDetail({ ctx, t }: { ctx: ExamCtx; t: TopicReport }) {
  const { store } = useApp();
  const { report } = ctx;
  const row = ctx.analysis.rows[t.topicId];
  const [notes, setNotes] = useState(t.notes ?? '');
  const dirty = notes !== (t.notes ?? '');
  const req = t.requirement;
  return (
    <div className="space-y-4 bg-subtle/40 px-4 pb-4 pt-2 sm:px-5 sm:pl-11">
      {t.subtopicIds.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-medium text-muted">Subtopics</h4>
          <ul className="divide-y divide-line/70 rounded-lg border border-line bg-surface">
            {t.subtopicIds.map((id) => {
              const s = report.subtopics[id];
              if (!s) return null;
              const inheritLabel = `↳ ${ctx.statuses.find((x) => x.id === s.effectiveStatus)?.label ?? titleCase(s.effectiveStatus)}`;
              return (
                <li key={id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_7rem_4rem_10rem]" data-testid={`subtopic-${id}`}>
                  <span className="min-w-0 truncate text-sm" title={s.name}>{s.name}</span>
                  <span className="tabular text-right text-2xs text-muted sm:hidden">{pct(s.completion, 0)}</span>
                  <div className="hidden items-center gap-2 sm:flex"><Progress value={s.completion} size="sm" label={`${s.name} completion`} /><span className="tabular w-9 text-right text-2xs text-muted">{pct(s.completion, 0)}</span></div>
                  <span className="tabular hidden text-right text-2xs text-muted sm:block" title="Mastery">{pct(s.mastery, 0)}</span>
                  <div className="col-span-2 sm:col-span-1">
                    <StatusSelect value={s.status ?? ''} inheritLabel={inheritLabel} statuses={ctx.statuses} label={`Status of ${s.name}`}
                      onChange={(v) => store.run(() => store.engine.updateSubtopic(id, { status: v || null }))} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <h4 className="text-xs font-medium text-muted">Performance in {report.shortName}</h4>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <Metric label="Questions" value={num(t.attempted)} />
            <Metric label="Accuracy" value={pct(t.accuracy)} />
            <Metric label="Avg time" value={secs(t.avgTimeSeconds)} />
            <Metric label="Revisions" value={num(t.revisionCount)} />
            <Metric label="Last practised" value={shortDate(t.lastPracticed)} />
            <Metric label="Next revision" value={row?.revision.nextDue ? shortDate(row.revision.nextDue) : '–'} />
          </dl>
          {req && (
            <p className="text-xs text-muted">
              Target for this exam: <span className="text-ink2">{req.questionTarget ?? '–'} questions · ≥{req.accuracyTarget ?? '–'}% accuracy · ≤{req.speedTargetSec ?? '–'} s/question</span>
              {req.depthDescription ? ` · ${req.depthDescription}` : ''}
            </p>
          )}
          {t.targetsMet && t.targetsMet.gaps.length > 0 && (
            <div className="flex flex-wrap gap-1">{t.targetsMet.gaps.map((g) => <Badge key={g.target} tone="warn">{g.target}: {g.have ?? '–'} → {g.need}</Badge>)}</div>
          )}
          {row && <p className="text-xs text-muted">Priority score <span className="tabular font-medium text-ink2">{row.score.toFixed(1)}</span> · next step: <span className="text-ink2">{row.action.detail}</span></p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={RotateCcw} onClick={() => store.run(() => store.engine.addRevision(t.topicId, { date: store.today(), note: 'Confirmed from syllabus tracker' }), `Revision of ${t.name} recorded`)}>Confirm revision today</Button>
          </div>
          <OverrideEditor t={t} />
          <div>
            <label className="label flex items-center gap-1.5" htmlFor={`notes-${t.topicId}`}><NotebookPen className="h-3.5 w-3.5" /> Notes</label>
            <textarea id={`notes-${t.topicId}`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Formulas, weak points, sources…"
              className="input h-auto min-h-[4.5rem] py-2" onBlur={() => { if (dirty) void store.run(() => store.engine.updateTopic(t.topicId, { notes }), 'Notes saved'); }} />
            <p className="mt-1 text-2xs text-muted">{dirty ? 'Unsaved: click outside the box to save' : 'Saved with this exam’s progress'}</p>
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-medium text-muted">Log question practice</h4>
          <PracticeForm report={report} topicId={t.topicId} />
        </div>
      </div>
    </div>
  );
}

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-line bg-surface px-2.5 py-2"><dt className="text-2xs text-muted">{label}</dt><dd className="tabular mt-0.5 text-sm font-medium">{value}</dd></div>
);

/** Manual completion / mastery overrides (engine fields completionOverride / masteryOverride); empty = calculated value. */
function OverrideEditor({ t }: { t: TopicReport }) {
  const { store } = useApp();
  const rec = store.engine.getExamRecords(store.activeExamId!)?.topics[t.topicId] as { completionOverride?: number | null; masteryOverride?: number | null } | undefined;
  const [c, setC] = useState(rec?.completionOverride != null ? String(rec.completionOverride) : '');
  const [m, setM] = useState(rec?.masteryOverride != null ? String(rec.masteryOverride) : '');
  const parse = (v: string) => (v.trim() === '' ? null : Number(v));
  const valid = (v: number | null) => v === null || (Number.isFinite(v) && v >= 0 && v <= 100);
  const pc = parse(c), pm = parse(m);
  const dirty = pc !== (rec?.completionOverride ?? null) || pm !== (rec?.masteryOverride ?? null);
  return (
    <details className="rounded-lg border border-line bg-surface px-3 py-2 text-xs" open={rec?.completionOverride != null || rec?.masteryOverride != null}>
      <summary className="cursor-pointer select-none text-muted">Manual overrides {t.masteryOverridden ? '(mastery overridden)' : ''}</summary>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block"><span className="label">Completion % (empty = from status)</span><Input inputMode="decimal" value={c} onChange={(e) => setC(e.target.value.replace(/[^\d.]/g, ''))} aria-label={`Completion override of ${t.name}`} /></label>
        <label className="block"><span className="label">Mastery % (empty = calculated)</span><Input inputMode="decimal" value={m} onChange={(e) => setM(e.target.value.replace(/[^\d.]/g, ''))} aria-label={`Mastery override of ${t.name}`} /></label>
        <Button size="sm" className="col-span-2 sm:col-span-1" disabled={!dirty || !valid(pc) || !valid(pm)}
          onClick={() => store.run(() => store.engine.updateTopic(t.topicId, { completionOverride: pc, masteryOverride: pm }), 'Overrides saved')}>Save overrides</Button>
      </div>
      {(!valid(pc) || !valid(pm)) && <p className="mt-1 text-critical">Values must be between 0 and 100.</p>}
    </details>
  );
}
