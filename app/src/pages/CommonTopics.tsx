import { useMemo, useState } from 'react';
import { Network, Link2, Unlink, Search, ChevronRight, BadgeCheck, HelpCircle } from 'lucide-react';
import type { PageProps } from '../App';
import { useApp, useAsync, useLocalPref } from '../lib/hooks';
import { pct, subjectLabel } from '../lib/format';
import type { TopicCard } from '../lib/types';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingBlock, PageHeader, Progress, ResponsiveTable, Select, cn } from '../components/ui';

const SYNC: Record<string, { label: string; tone: 'accent' | 'neutral'; icon: typeof Link2; help: string }> = {
  full: { label: 'Fully shared', tone: 'accent', icon: Link2, help: 'Concept learning counts for every linked exam' },
  partial: { label: 'Partially shared', tone: 'neutral', icon: Link2, help: 'Concept counts partially; exam depth differs' },
  independent: { label: 'Independent', tone: 'neutral', icon: Unlink, help: 'Tracked separately in each exam' },
};

export function CommonTopicsPage({ navigate }: PageProps) {
  const { store } = useApp();
  const [saved, setSaved] = useLocalPref<string[]>('commonExams', store.exams.map((e) => e.examId));
  const selected = saved.filter((id) => store.exams.some((e) => e.examId === id));
  const toggle = (id: string) => setSaved(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const res = useAsync(() => (selected.length >= 2 ? store.engine.getSharedTopicDashboard(selected) : Promise.resolve(null)), [store.engine.getVersion(), selected.join(',')]);
  const [q, setQ] = useState('');
  const [subject, setSubject] = useState('all');
  const [show, setShow] = useState<'all' | 'learned' | 'not-learned' | 'practice-pending'>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(30);
  const cfg = store.engine.config;
  const maxShared = cfg.statuses.find((s) => s.id === (cfg.sharedLearning as { maxSharedStatus?: string }).maxSharedStatus)?.score ?? 50;
  const conceptStatuses = cfg.statuses.filter((s) => s.score <= maxShared);

  const cards = useMemo(() => {
    const list = Object.values(res.data?.topicCards ?? {}).filter((c) => Object.keys(c.exams).length >= 2);
    const n = q.trim().toLowerCase();
    return list.filter((c) => (!n || c.name.toLowerCase().includes(n)) && (subject === 'all' || c.subject === subject)
      && (show === 'all' || (show === 'learned' ? c.concept.completion >= 100 : show === 'not-learned' ? c.concept.completion < 100
        : Object.values(c.exams).some((e) => e.targetsMet && !e.targetsMet.all))))
      .sort((a, b) => Object.keys(b.exams).length - Object.keys(a.exams).length || a.name.localeCompare(b.name));
  }, [res.data, q, subject, show]);
  const subjects = [...new Set(Object.values(res.data?.topicCards ?? {}).map((c) => c.subject))];

  return (
    <div className="space-y-4" data-testid="page-common">
      <PageHeader title="Common topics" description="Topics shared across exams. Learn once; practice and mastery stay exam-specific." />
      <Card className="p-3">
        <div className="mb-2 text-xs font-medium text-muted">Exams</div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Exams">
          {store.exams.map((e) => {
            const on = selected.includes(e.examId);
            return <button key={e.examId} type="button" aria-pressed={on} onClick={() => toggle(e.examId)} className={cn('h-8 rounded-lg border px-3 text-xs font-medium transition-colors', on ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-ink2 hover:bg-subtle')}>{e.shortName}</button>;
          })}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1.5fr)_1fr_1fr]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search master topics…" className="pl-9" aria-label="Search master topics" />
          </div>
          <Select value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject"><option value="all">All subjects</option>{subjects.map((s) => <option key={s} value={s}>{subjectLabel(s)}</option>)}</Select>
          <Select value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Show">
            <option value="all">All mapped topics</option>
            <option value="learned">Concept learned</option>
            <option value="not-learned">Concept not yet learned</option>
            <option value="practice-pending">Exam practice pending</option>
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
          <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3 text-accent" /> Shared concept progress: learned once, counts in every linked exam</span>
          <span className="inline-flex items-center gap-1"><Unlink className="h-3 w-3" /> Exam-specific: practice, mastery and targets per exam</span>
        </div>
      </Card>

      {selected.length < 2 ? <Card><EmptyState icon={Network} title="Select two or more exams" description="Common topics are the ones that appear in at least two of the selected exams." /></Card>
        : res.error ? <Card><ErrorState error={res.error} /></Card>
          : res.loading && !res.data ? <Card><LoadingBlock rows={8} /></Card> : (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5 text-xs text-muted sm:px-5">
                <span data-testid="common-count">{cards.length} master topics</span>
                {res.data && <span>{res.data.counts.commonToAllSelected} common to all selected exams</span>}
              </div>
              {cards.length === 0 ? <EmptyState icon={Network} title="No master topics match" /> : (
                <ul data-testid="common-list">
                  {cards.slice(0, limit).map((c) => (
                    <CommonRow key={c.masterTopicId} c={c} selectedCount={selected.length} open={open.has(c.masterTopicId)} conceptStatuses={conceptStatuses}
                      onToggle={() => setOpen((s) => { const n = new Set(s); if (n.has(c.masterTopicId)) n.delete(c.masterTopicId); else n.add(c.masterTopicId); return n; })}
                      onOpenTopic={(examId) => { void store.selectExam(examId).then(() => navigate('syllabus', { topic: c.topicId, q: c.name })); }} />
                  ))}
                </ul>
              )}
              {cards.length > limit && <div className="border-t border-line p-3 text-center"><Button size="sm" onClick={() => setLimit(limit + 30)}>Show more ({cards.length - limit} remaining)</Button></div>}
            </Card>
          )}
    </div>
  );
}

function CommonRow({ c, open, onToggle, conceptStatuses, onOpenTopic, selectedCount }: { c: TopicCard; open: boolean; onToggle: () => void; conceptStatuses: { id: string; label: string }[]; onOpenTopic: (examId: string) => void; selectedCount: number }) {
  const { store } = useApp();
  const exams = Object.entries(c.exams);
  const modes = [...new Set(exams.map(([, e]) => e.syncMode))];
  const mode = modes.length === 1 ? modes[0] : 'partial';
  const S = SYNC[mode];
  const pending = exams.filter(([, e]) => e.targetsMet && !e.targetsMet.all).length;
  return (
    <li className="border-b border-line/70 last:border-b-0" data-testid={`common-${c.masterTopicId}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_12rem_9rem]">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 items-start gap-2 text-left">
          <ChevronRight className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-muted transition-transform', open && 'rotate-90')} aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{c.name}</span>
            <span className="mt-0.5 flex flex-wrap gap-1">
              <Badge>{subjectLabel(c.subject)}</Badge>
              <Badge tone={c.verification === 'verified' ? 'good' : 'warn'} icon={c.verification === 'verified' ? BadgeCheck : HelpCircle} title="Mapping verification">{c.verification === 'verified' ? 'Verified' : 'Needs review'}</Badge>
              <Badge title="Subtopic similarity between exams">{c.similarity} match</Badge>
            </span>
          </span>
        </button>
        <span className="col-span-2 lg:hidden"><Badge tone={S.tone} icon={S.icon} title={S.help}>{S.label}</Badge></span>
        <div className="col-span-2 flex flex-wrap gap-1 lg:col-span-1">
          {exams.length === selectedCount && selectedCount > 2
            ? <Badge tone="accent" title={exams.map(([id]) => store.examName(id)).join(', ')}>All {selectedCount} selected exams</Badge>
            : exams.map(([id]) => <Badge key={id}>{store.examName(id)}</Badge>)}
        </div>
        <div className="col-span-2 lg:col-span-1">
          <div className="mb-1 flex items-center justify-between text-2xs text-muted"><span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3 text-accent" />Shared concept</span><span className="tabular">{pct(c.concept.completion, 0)}</span></div>
          <Progress value={c.concept.completion} size="sm" label={`${c.name} shared concept`} />
        </div>
        <div className="col-span-2 hidden flex-col items-end gap-1 lg:col-span-1 lg:flex">
          <Badge tone={S.tone} icon={S.icon} title={S.help}>{S.label}</Badge>
          <span className="text-2xs text-muted">{pending ? `practice pending in ${pending} exam${pending > 1 ? 's' : ''}` : 'targets met'}</span>
        </div>
      </div>
      {open && (
        <div className="space-y-3 bg-subtle/40 px-4 pb-4 pt-2 sm:px-5 sm:pl-11">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="label inline-flex items-center gap-1"><Link2 className="h-3 w-3 text-accent" /> Shared concept status</span>
              <Select className="h-8 w-56 text-xs" value={c.concept.status ?? 'not-started'} aria-label={`Shared concept status of ${c.name}`}
                onChange={(e) => store.run(() => store.engine.updateConcept(c.masterTopicId, { status: e.target.value }), 'Shared concept updated for all linked exams')}>
                {conceptStatuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </label>
            <label className="block">
              <span className="label">Synchronisation</span>
              <Select className="h-8 w-48 text-xs" value={modes.length === 1 ? mode : ''} aria-label={`Sync mode of ${c.name}`}
                onChange={(e) => store.run(() => store.engine.setSyncMode(c.masterTopicId, e.target.value || null), 'Sync mode updated')}>
                {modes.length > 1 && <option value="">Mixed (mapping default)</option>}
                <option value="full">Fully shared</option>
                <option value="partial">Partially shared</option>
                <option value="independent">Independent</option>
              </Select>
            </label>
          </div>
          <div className="scroll-x rounded-lg border border-line bg-surface">
            <ResponsiveTable className="table-base min-w-[40rem]">
              <thead><tr><th>Exam</th><th>Sync</th><th className="text-right">Exam completion</th><th className="text-right">Exam mastery</th><th className="text-right">Questions</th><th>Remaining practice</th><th /></tr></thead>
              <tbody>
                {exams.map(([id, e]) => {
                  const M = SYNC[e.syncMode];
                  return (
                    <tr key={id}>
                      <td className="font-medium">{store.examName(id)}</td>
                      <td><Badge tone={M.tone} icon={M.icon}>{M.label}</Badge></td>
                      <td className="tabular text-right"><span>{pct(e.completion)}{e.completion !== e.ownCompletion && <span className="block text-2xs text-muted">own {pct(e.ownCompletion)}</span>}</span></td>
                      <td className="tabular text-right">{pct(e.mastery)}</td>
                      <td className="tabular text-right"><span>{e.attempted}{e.accuracy !== null && <span className="block text-2xs text-muted">{pct(e.accuracy, 0)} acc.</span>}</span></td>
                      <td className="text-xs">
                        <div>{!e.targetsMet ? '–' : e.targetsMet.all ? <span className="text-good">All targets met</span>
                          : e.targetsMet.gaps.map((g) => <div key={g.target} className="whitespace-nowrap text-ink2">{g.target}: {g.have ?? '–'} → {g.need}{g.target === 'speed' ? ' s' : g.target === 'accuracy' ? '%' : ''}</div>)}</div>
                      </td>
                      <td><Button size="sm" variant="ghost" onClick={() => onOpenTopic(id)}>Open</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </ResponsiveTable>
          </div>
        </div>
      )}
    </li>
  );
}
