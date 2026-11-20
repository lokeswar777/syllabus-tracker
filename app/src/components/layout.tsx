import { useEffect, useState } from 'react';
import {
  LayoutDashboard, ListTree, GitCompareArrows, Network, Flame, CalendarDays, RotateCcw, BarChart3, Settings as SettingsIcon,
  PanelLeftClose, PanelLeftOpen, Menu, X, Sun, Moon, Monitor, CheckCircle2, Loader2, AlertTriangle, GraduationCap, Info,
} from 'lucide-react';
import { useApp, useLocalPref, useTheme, type Route } from '../lib/hooks';
import { cn, IconButton, Select } from './ui';

export const NAV: { route: Route; label: string; icon: typeof LayoutDashboard }[] = [
  { route: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { route: 'syllabus', label: 'Syllabus Tracker', icon: ListTree },
  { route: 'compare', label: 'Exam Comparison', icon: GitCompareArrows },
  { route: 'common', label: 'Common Topics', icon: Network },
  { route: 'priorities', label: 'Smart Priorities', icon: Flame },
  { route: 'planner', label: 'Study Planner', icon: CalendarDays },
  { route: 'revision', label: 'Revision Tracker', icon: RotateCcw },
  { route: 'practice', label: 'Practice Analytics', icon: BarChart3 },
  { route: 'settings', label: 'Settings', icon: SettingsIcon },
];

function NavList({ route, onNavigate, collapsed }: { route: Route; onNavigate: (r: Route) => void; collapsed: boolean }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-2">
      {NAV.map(({ route: r, label, icon: I }) => {
        const active = r === route;
        return (
          <a key={r} href={`#/${r}`} onClick={(e) => { e.preventDefault(); onNavigate(r); }} aria-current={active ? 'page' : undefined} title={collapsed ? label : undefined}
            className={cn('group flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm transition-colors',
              active ? 'bg-subtle font-medium text-ink' : 'text-ink2 hover:bg-subtle/70 hover:text-ink', collapsed && 'justify-center px-0')}>
            <I className={cn('h-4 w-4 shrink-0', active ? 'text-accent' : 'text-muted group-hover:text-ink2')} aria-hidden />
            {!collapsed && <span className="truncate">{label}</span>}
            {collapsed && <span className="sr-only">{label}</span>}
          </a>
        );
      })}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn('flex h-14 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-ink"><GraduationCap className="h-4 w-4" aria-hidden /></div>
      {!collapsed && <div className="min-w-0 leading-tight"><div className="truncate text-sm font-semibold">Syllabus Tracker</div><div className="truncate text-2xs text-muted">SSC & Banking</div></div>}
    </div>
  );
}

export function Sidebar({ route, onNavigate, mobileOpen, onCloseMobile }: { route: Route; onNavigate: (r: Route) => void; mobileOpen: boolean; onCloseMobile: () => void }) {
  const [collapsed, setCollapsed] = useLocalPref('sidebarCollapsed', false);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseMobile(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, onCloseMobile]);
  return (
    <>
      <aside data-testid="sidebar" className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex', collapsed ? 'w-16' : 'w-60')}>
        <Brand collapsed={collapsed} />
        <div className="flex-1 overflow-y-auto py-2"><NavList route={route} onNavigate={onNavigate} collapsed={collapsed} /></div>
        <div className={cn('border-t border-line p-2', collapsed && 'flex justify-center')}>
          <button type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn('flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs text-muted hover:bg-subtle hover:text-ink', collapsed ? 'w-8 justify-center px-0' : 'w-full')}>
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /> Collapse</>}
          </button>
        </div>
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={onCloseMobile} />
          <aside data-testid="mobile-sidebar" className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-line bg-surface shadow-xl">
            <div className="flex items-center justify-between pr-2"><Brand collapsed={false} /><IconButton icon={X} label="Close navigation" onClick={onCloseMobile} /></div>
            <div className="flex-1 overflow-y-auto py-2"><NavList route={route} onNavigate={(r) => { onNavigate(r); onCloseMobile(); }} collapsed={false} /></div>
          </aside>
        </div>
      )}
    </>
  );
}

function SaveIndicator() {
  const { store } = useApp();
  const s = store.saveState;
  const meta = { saved: { I: CheckCircle2, t: 'Saved', c: 'text-muted' }, saving: { I: Loader2, t: 'Saving…', c: 'text-muted' }, error: { I: AlertTriangle, t: 'Not saved', c: 'text-critical' } }[s];
  return (
    <span className={cn('hidden items-center gap-1.5 text-xs sm:inline-flex', meta.c)} role="status" aria-live="polite" data-testid="save-state">
      <meta.I className={cn('h-3.5 w-3.5', s === 'saving' && 'animate-spin')} aria-hidden />{meta.t}
    </span>
  );
}

export function ThemeToggle() {
  const { pref, setPref } = useTheme();
  const next = pref === 'light' ? 'dark' : pref === 'dark' ? 'system' : 'light';
  const I = pref === 'light' ? Sun : pref === 'dark' ? Moon : Monitor;
  return <IconButton icon={I} label={`Theme: ${pref} (switch to ${next})`} onClick={() => setPref(next)} />;
}

/** Exam selector + stage/track/choice selectors: everything on screen follows this selection. */
export function Topbar({ onOpenMobile }: { onOpenMobile: () => void }) {
  const { store } = useApp();
  const examId = store.activeExamId;
  const model = examId ? store.engine.getModel() : null;
  const records = examId ? store.engine.getExamRecords(examId) : null;
  const stageId = records?.stageId ?? '';
  const ssc = store.exams.filter((e) => e.category === 'ssc');
  const bank = store.exams.filter((e) => e.category !== 'ssc');
  const choiceGroups = model ? Object.entries(model.choiceGroups as Record<string, { sectionId: string; name: string; active: boolean }[]>) : [];
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/75">
      <div className="flex items-start gap-2 px-4 py-2.5 sm:items-center sm:px-6">
        <IconButton icon={Menu} label="Open navigation" onClick={onOpenMobile} className="mt-1 lg:hidden sm:mt-0" />
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
          <label className="sr-only" htmlFor="exam-select">Exam</label>
          <Select id="exam-select" data-testid="exam-select" value={examId ?? ''} onChange={(e) => e.target.value && store.selectExam(e.target.value)}
            className="col-span-2 h-10 border-ink2/30 text-[15px] font-semibold md:w-56">
            {!examId && <option value="">Select an exam…</option>}
            <optgroup label="SSC">{ssc.map((e) => <option key={e.examId} value={e.examId}>{e.shortName}</option>)}</optgroup>
            <optgroup label="Banking">{bank.map((e) => <option key={e.examId} value={e.examId}>{e.shortName}</option>)}</optgroup>
          </Select>
          {model && (
            <>
              <label className="sr-only" htmlFor="stage-select">Stage</label>
              <Select id="stage-select" data-testid="stage-select" value={stageId} onChange={(e) => store.setStage(e.target.value || null)}
                className={cn('h-9 text-xs md:h-10 md:w-auto md:max-w-[17rem] md:text-sm', model.tracks.length <= 1 && !choiceGroups.length && 'col-span-2')}>
                <option value="">All stages</option>
                {model.stages.map((s) => {
                  const st = s as { id: string; name: string; gate?: boolean };
                  return <option key={st.id} value={st.id}>{st.name}{st.gate ? ' (qualifying)' : ''}</option>;
                })}
              </Select>
              {model.tracks.length > 1 && (
                <>
                  <label className="sr-only" htmlFor="track-select">Track</label>
                  <Select id="track-select" value={model.trackId} onChange={(e) => store.setTrack(e.target.value)} className="h-9 text-xs md:h-10 md:w-auto md:max-w-[17rem] md:text-sm" title="Post track (optional papers)">
                    {model.tracks.map((t) => <option key={t.trackId} value={t.trackId}>{t.name.length > 48 ? `${t.name.slice(0, 46)}…` : t.name}</option>)}
                  </Select>
                </>
              )}
              {choiceGroups.map(([group, opts]) => (
                <Select key={group} aria-label={`${group} choice`} value={opts.find((o) => o.active)?.sectionId ?? opts[0]?.sectionId} onChange={(e) => store.setChoice(group, e.target.value)} className="h-9 text-xs md:h-10 md:w-auto md:max-w-[12rem] md:text-sm">
                  {opts.map((o) => <option key={o.sectionId} value={o.sectionId}>{o.name}</option>)}
                </Select>
              ))}
            </>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 sm:mt-0">
          <SaveIndicator />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function Toasts() {
  const { store } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {store.toasts.map((t) => (
        <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className="card pointer-events-auto flex items-start gap-2.5 px-3.5 py-3 text-sm shadow-lg">
          {t.kind === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical" /> : t.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />}
          <span className="min-w-0 flex-1 break-words text-ink2">{t.message}</span>
          <button type="button" className="text-muted hover:text-ink" aria-label="Dismiss" onClick={() => store.dismissToast(t.id)}><X className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}

export function useMobileNav() {
  const [open, setOpen] = useState(false);
  return { open, openNav: () => setOpen(true), closeNav: () => setOpen(false) };
}
