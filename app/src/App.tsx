import { Component, lazy, Suspense, type ReactNode } from 'react';
import { GraduationCap, Loader2, Database } from 'lucide-react';
import { StoreProvider, useApp, useRoute, type Route } from './lib/hooks';
import type { AppStore } from './lib/store';
import { BottomNav, Sidebar, Topbar, Toasts, useMobileNav } from './components/layout';
import { Card, ErrorState } from './components/ui';
import { LoadingBlock } from './components/ui';

// Pages are loaded on demand (smaller first download; charts load with the pages that use them).
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const SyllabusPage = lazy(() => import('./pages/Syllabus').then((m) => ({ default: m.SyllabusPage })));
const ComparePage = lazy(() => import('./pages/Compare').then((m) => ({ default: m.ComparePage })));
const CommonTopicsPage = lazy(() => import('./pages/CommonTopics').then((m) => ({ default: m.CommonTopicsPage })));
const PrioritiesPage = lazy(() => import('./pages/Priorities').then((m) => ({ default: m.PrioritiesPage })));
const PlannerPage = lazy(() => import('./pages/Planner').then((m) => ({ default: m.PlannerPage })));
const RevisionPage = lazy(() => import('./pages/Revision').then((m) => ({ default: m.RevisionPage })));
const PracticePage = lazy(() => import('./pages/Practice').then((m) => ({ default: m.PracticePage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

export type PageProps = { params: URLSearchParams; navigate: (r: Route, p?: Record<string, string>) => void };
const PAGES: Record<Route, (p: PageProps) => ReactNode> = {
  dashboard: Dashboard, syllabus: SyllabusPage, compare: ComparePage, common: CommonTopicsPage, priorities: PrioritiesPage,
  planner: PlannerPage, revision: RevisionPage, practice: PracticePage, settings: SettingsPage,
};
const NEEDS_EXAM: Route[] = ['dashboard', 'syllabus', 'practice'];

export default function App({ store }: { store: AppStore }) {
  return <StoreProvider store={store}><Shell /></StoreProvider>;
}

function Shell() {
  const { store } = useApp();
  const { route, params, navigate } = useRoute();
  const nav = useMobileNav();
  if (store.status === 'idle' || store.status === 'loading') return <LoadingScreen />;
  if (store.status === 'error') return <FatalError message={store.error ?? 'Unknown error'} onRetry={() => void store.init()} />;
  const Page = PAGES[route];
  return (
    <div className="flex min-h-screen">
      <Sidebar route={route} onNavigate={(r) => navigate(r)} mobileOpen={nav.open} onCloseMobile={nav.closeNav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:pt-6 lg:pb-6" id="main">
          <PageBoundary key={route}>
            <Suspense fallback={<LoadingBlock label="Loading page…" rows={6} />}>
              {NEEDS_EXAM.includes(route) && !store.activeExamId ? <Welcome /> : <Page params={params} navigate={navigate} />}
            </Suspense>
          </PageBoundary>
        </main>
      </div>
      <BottomNav route={route} onNavigate={(r) => navigate(r)} onMore={nav.openNav} />
      <Toasts />
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted" role="status" aria-live="polite" data-testid="app-loading">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      <p className="text-sm">Loading syllabus, weightage and your progress…</p>
    </div>
  );
}

function FatalError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4" data-testid="app-error">
      <Card className="w-full max-w-md">
        <ErrorState error={message} onRetry={onRetry} />
        <p className="px-6 pb-6 text-center text-xs text-muted">The app reads the built data from <code>public/data</code>. Run <code>npm run sync-data</code> in <code>app/</code> (or <code>npm run build</code> in the project root) and reload.</p>
      </Card>
    </div>
  );
}

/** First run: no exam selected yet. */
export function Welcome() {
  const { store } = useApp();
  const groups = [{ label: 'SSC', list: store.exams.filter((e) => e.category === 'ssc') }, { label: 'Banking', list: store.exams.filter((e) => e.category !== 'ssc') }];
  return (
    <div className="mx-auto max-w-3xl py-6" data-testid="welcome">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl hero-card text-white"><GraduationCap className="h-5 w-5" /></div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Choose your exam</h1>
          <p className="text-sm text-muted">Each exam keeps its own progress. Concepts you learn are shared across exams that test them.</p>
        </div>
      </div>
      {groups.map((g) => (
        <div key={g.label} className="mb-6">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{g.label}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {g.list.map((e) => (
              <button key={e.examId} type="button" onClick={() => store.selectExam(e.examId)} className="card flex flex-col items-start p-4 text-left transition-colors hover:border-accent/50 hover:bg-subtle/50">
                <span className="text-sm font-semibold">{e.shortName}</span>
                <span className="mt-0.5 line-clamp-2 text-xs text-muted">{e.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="flex items-center gap-2 text-xs text-muted"><Database className="h-3.5 w-3.5" /> Progress is saved automatically in this browser. Use Settings → Export to back it up.</p>
    </div>
  );
}

class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return <Card><ErrorState error={this.state.error} onRetry={() => this.setState({ error: null })} /></Card>;
    return this.props.children;
  }
}

