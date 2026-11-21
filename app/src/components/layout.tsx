import { useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, ListTree, GitCompareArrows, Network, Flame, CalendarDays, RotateCcw, BarChart3, Settings as SettingsIcon,
  PanelLeftClose, PanelLeftOpen, MoreHorizontal, X, Sun, Moon, Monitor, CheckCircle2, Loader2, AlertTriangle, GraduationCap, Info, SlidersHorizontal, Check,
} from 'lucide-react';
import { useApp, useLocalPref, useTheme, useUi, type Route } from '../lib/hooks';
import { Button, cn, IconButton, InlineSheet, Select } from './ui';
import { AccountButton } from './Account';

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
            className={cn('group flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors',
              active ? 'bg-accent/10 font-semibold text-accent' : 'text-ink2 hover:bg-subtle hover:text-ink', collapsed && 'justify-center px-0')}>
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
      <div className="hero-card flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white"><GraduationCap className="h-[1.125rem] w-[1.125rem]" aria-hidden /></div>
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
      <aside data-testid="sidebar" className={cn('sticky top-0 hidden h-[100dvh] shrink-0 flex-col border-r border-line/70 bg-surface transition-[width] duration-200 lg:flex', collapsed ? 'w-16' : 'w-60')}>
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
          <div className="absolute inset-0 animate-fade bg-black/40" onClick={onCloseMobile} />
          <aside data-testid="mobile-sidebar" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] animate-drawer flex-col rounded-r-2xl bg-surface pt-[env(safe-area-inset-top)] shadow-float">
            <div className="flex items-center justify-between pr-2"><Brand collapsed={false} /><IconButton icon={X} label="Close navigation" onClick={onCloseMobile} /></div>
            <div className="flex-1 overflow-y-auto py-2"><NavList route={route} onNavigate={(r) => { onNavigate(r); onCloseMobile(); }} collapsed={false} /></div>
          </aside>
        </div>
      )}
    </>
  );
}

const BOTTOM_NAV: { route: Route; label: string; icon: typeof LayoutDashboard }[] = [
  { route: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { route: 'syllabus', label: 'Syllabus', icon: ListTree },
  { route: 'planner', label: 'Planner', icon: CalendarDays },
  { route: 'revision', label: 'Revision', icon: RotateCcw },
];

/** Phone and tablet navigation: the four daily destinations, with everything else under More. */
export function BottomNav({ route, onNavigate, onMore }: { route: Route; onNavigate: (r: Route) => void; onMore: () => void }) {
  const inMore = !BOTTOM_NAV.some((n) => n.route === route);
  const item = (active: boolean) => cn('flex h-14 w-full flex-col items-center justify-center gap-0.5 text-2xs font-medium transition-colors', active ? 'text-accent' : 'text-muted hover:text-ink');
  return (
    <nav aria-label="Quick navigation" data-testid="bottom-nav" className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-xl grid-cols-5">
        {BOTTOM_NAV.map(({ route: r, label, icon: I }) => (
          <a key={r} href={`#/${r}`} onClick={(e) => { e.preventDefault(); onNavigate(r); }} aria-current={r === route ? 'page' : undefined} className={item(r === route)}>
            <I className="h-5 w-5" aria-hidden />{label}
          </a>
        ))}
        <button type="button" onClick={onMore} aria-haspopup="dialog" aria-label="More: open navigation" className={item(inMore)}>
          <MoreHorizontal className="h-5 w-5" aria-hidden />More
        </button>
      </div>
    </nav>
  );
}

function SaveIndicator() {
  const store = useUi();
  const s = store.saveState;
  if (s === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-critical" role="alert" data-testid="save-state" title={store.saveError ?? undefined}>
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />Save failed
        <button type="button" onClick={() => void store.retrySave()} className="rounded-md border border-critical/40 px-1.5 py-0.5 font-medium hover:bg-critical/10" data-testid="save-retry">Retry</button>
      </span>
    );
  }
  const meta = s === 'saving' ? { I: Loader2, t: 'Saving…' } : { I: CheckCircle2, t: 'Saved' };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status" aria-live="polite" data-testid="save-state">
      <meta.I className={cn('h-3.5 w-3.5', s === 'saving' && 'animate-spin')} aria-hidden /><span className="hidden sm:inline">{meta.t}</span>
    </span>
  );
}

export function ThemeToggle() {
  const { pref, setPref } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const options = [{ value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon }, { value: 'system', label: 'System', icon: Monitor }] as const;
  const I = options.find((o) => o.value === pref)?.icon ?? Monitor;
  return (
    <div ref={ref} className="relative">
      <IconButton icon={I} label={`Theme: ${pref}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <div role="menu" aria-label="Theme" className="card absolute right-0 top-full z-50 mt-1.5 w-40 p-1 shadow-float">
          {options.map(({ value, label, icon: O }) => (
            <button key={value} type="button" role="menuitemradio" aria-checked={pref === value} onClick={() => { setPref(value); setOpen(false); }}
              className={cn('flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-sm transition-colors hover:bg-subtle', pref === value ? 'font-medium text-accent' : 'text-ink2')}>
              <O className="h-4 w-4" aria-hidden />{label}{pref === value && <Check className="ml-auto h-4 w-4" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Exam selector + stage/track/choice selectors: everything on screen follows this selection. */
export function Topbar() {
  const { store } = useApp();
  const examId = store.activeExamId;
  const model = examId ? store.engine.getModel() : null;
  const records = examId ? store.engine.getExamRecords(examId) : null;
  const stageId = records?.stageId ?? '';
  const ssc = store.exams.filter((e) => e.category === 'ssc');
  const bank = store.exams.filter((e) => e.category !== 'ssc');
  const choiceGroups = model ? Object.entries(model.choiceGroups as Record<string, { sectionId: string; name: string; active: boolean }[]>) : [];
  const [optionsOpen, setOptionsOpen] = useState(false);
  const stageLabel = stageId ? (model?.stages.find((s) => (s as { id: string }).id === stageId) as { name: string } | undefined)?.name ?? 'Stage' : 'All stages';
  const optionCls = 'h-10 xl:w-auto xl:max-w-[17rem]';
  return (
    <header className={cn('sticky top-0 border-b border-line/70 pt-[env(safe-area-inset-top)]', optionsOpen ? 'z-50' : 'z-30')}>
      {/* The blur sits on its own layer so the options sheet can be fixed to the viewport. */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/75" />
      <div className="flex items-center gap-2 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <label className="sr-only" htmlFor="exam-select">Exam</label>
          <Select id="exam-select" data-testid="exam-select" value={examId ?? ''} onChange={(e) => e.target.value && store.selectExam(e.target.value)}
            className="h-10 min-w-0 flex-1 border-ink2/30 text-[15px] font-semibold sm:max-w-xs xl:w-56 xl:flex-none">
            {!examId && <option value="">Select an exam…</option>}
            <optgroup label="SSC">{ssc.map((e) => <option key={e.examId} value={e.examId}>{e.shortName}</option>)}</optgroup>
            <optgroup label="Banking">{bank.map((e) => <option key={e.examId} value={e.examId}>{e.shortName}</option>)}</optgroup>
          </Select>
          {model && (
            <>
              <Button icon={SlidersHorizontal} aria-label={`Exam options: ${stageLabel}`} aria-haspopup="dialog" className="h-10 xl:hidden" onClick={() => setOptionsOpen(true)}>
                <span className="hidden max-w-[11rem] truncate sm:inline">{stageLabel}</span>
              </Button>
              <InlineSheet open={optionsOpen} onClose={() => setOptionsOpen(false)} title="Exam options" breakpoint="xl">
                <div className="xl:contents">
                  <label className="label xl:sr-only" htmlFor="stage-select">Stage</label>
                  <Select id="stage-select" data-testid="stage-select" value={stageId} onChange={(e) => store.setStage(e.target.value || null)} className={optionCls}>
                    <option value="">All stages</option>
                    {model.stages.map((s) => {
                      const st = s as { id: string; name: string; gate?: boolean };
                      return <option key={st.id} value={st.id}>{st.name}{st.gate ? ' (qualifying)' : ''}</option>;
                    })}
                  </Select>
                </div>
                {model.tracks.length > 1 && (
                  <div className="xl:contents">
                    <label className="label xl:sr-only" htmlFor="track-select">Post track</label>
                    <Select id="track-select" value={model.trackId} onChange={(e) => store.setTrack(e.target.value)} className={optionCls} title="Post track (optional papers)">
                      {model.tracks.map((t) => <option key={t.trackId} value={t.trackId}>{t.name.length > 48 ? `${t.name.slice(0, 46)}…` : t.name}</option>)}
                    </Select>
                  </div>
                )}
                {choiceGroups.map(([group, opts]) => (
                  <div key={group} className="xl:contents">
                    <label className="label xl:sr-only" htmlFor={`choice-${group}`}>{group} choice</label>
                    <Select id={`choice-${group}`} value={opts.find((o) => o.active)?.sectionId ?? opts[0]?.sectionId} onChange={(e) => store.setChoice(group, e.target.value)} className="h-10 xl:w-auto xl:max-w-[12rem]">
                      {opts.map((o) => <option key={o.sectionId} value={o.sectionId}>{o.name}</option>)}
                    </Select>
                  </div>
                ))}
              </InlineSheet>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <SaveIndicator />
          <ThemeToggle />
          <AccountButton />
        </div>
      </div>
    </header>
  );
}

export function Toasts() {
  const store = useUi();
  return (
    <div className="pointer-events-none fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-[60] lg:bottom-4 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {store.toasts.map((t) => (
        <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className="card pointer-events-auto flex animate-toast items-start gap-2.5 px-3.5 py-3 text-sm shadow-float">
          {t.kind === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical" /> : t.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />}
          <span className="min-w-0 flex-1 break-words text-ink2">{t.message}</span>
          {t.action && <button type="button" className="shrink-0 rounded-lg px-1.5 font-semibold text-accent hover:bg-accent/10" onClick={() => { store.dismissToast(t.id); void t.action!.run(); }}>{t.action.label}</button>}
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
