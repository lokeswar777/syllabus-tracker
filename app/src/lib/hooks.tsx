import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AppStore } from './store';

const StoreContext = createContext<AppStore | null>(null);
export function StoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
export function useStore() {
  const s = useContext(StoreContext);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}
/** Re-renders on every store change; returns the store and its version (use the version as a dependency). */
export function useApp() {
  const store = useStore();
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  return { store, version };
}

/** Toasts and save status only: re-renders the header/toasts without re-rendering pages. */
export function useUi() {
  const store = useStore();
  useSyncExternalStore(store.subscribeUi, store.getUiVersion, store.getUiVersion);
  return store;
}

const noSubscribe = () => () => {};
const noVersion = () => 0;
/** The cloud account, or null when sync is not configured. Re-renders on sign-in and sync changes. */
export function useAccount() {
  const account = useStore().account;
  useSyncExternalStore(account?.subscribe ?? noSubscribe, account?.getVersion ?? noVersion, account?.getVersion ?? noVersion);
  return account;
}

/** Runs an async computation (e.g. planner.getRecommendations) whenever deps change; stale results are dropped. */
export function useAsync<T>(fn: () => Promise<T> | T, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | undefined; error: Error | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(fn)
      .then((data) => { if (id === seq.current) setState({ data, error: null, loading: false }); })
      .catch((error: Error) => { if (id === seq.current) setState({ data: undefined, error, loading: false }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

// ───────── routing (hash based, no dependency) ─────────
export const ROUTES = ['dashboard', 'syllabus', 'compare', 'common', 'priorities', 'planner', 'revision', 'practice', 'settings'] as const;
export type Route = (typeof ROUTES)[number];
const parse = (): { route: Route; params: URLSearchParams } => {
  const raw = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  return { route: (ROUTES as readonly string[]).includes(path) ? (path as Route) : 'dashboard', params: new URLSearchParams(query ?? '') };
};
export function useRoute() {
  const [state, setState] = useState(parse);
  useEffect(() => {
    const on = () => setState(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = useCallback((route: Route, params?: Record<string, string>) => {
    const q = params ? `?${new URLSearchParams(params)}` : '';
    window.location.hash = `/${route}${q}`;
  }, []);
  return { ...state, navigate };
}

// ───────── theme (per-viewer preference, browser storage) ─────────
export type ThemePref = 'light' | 'dark' | 'system';
const THEME_KEY = 'syllabus-tracker:theme';
const readPref = (): ThemePref => { try { return (localStorage.getItem(THEME_KEY) as ThemePref) || 'system'; } catch { return 'system'; } };
const systemDark = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
const listeners = new Set<() => void>();
let pref: ThemePref = typeof window !== 'undefined' ? readPref() : 'system';
const apply = () => { if (typeof document !== 'undefined') document.documentElement.classList.toggle('dark', pref === 'dark' || (pref === 'system' && systemDark())); };
export function setThemePref(p: ThemePref) {
  pref = p;
  try { localStorage.setItem(THEME_KEY, p); } catch { /* preference not persisted */ }
  apply();
  for (const l of listeners) l();
}
export function useTheme() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSys = () => { apply(); l(); };
    mq?.addEventListener?.('change', onSys);
    return () => { listeners.delete(l); mq?.removeEventListener?.('change', onSys); };
  }, []);
  const resolved: 'light' | 'dark' = pref === 'dark' || (pref === 'system' && systemDark()) ? 'dark' : 'light';
  return { pref, resolved, setPref: setThemePref };
}

/** Per-viewer UI convenience stored in the browser (never progress data). */
export function useLocalPref<T>(key: string, initial: T) {
  const full = `syllabus-tracker:ui:${key}`;
  const [v, setV] = useState<T>(() => { try { const raw = localStorage.getItem(full); return raw ? (JSON.parse(raw) as T) : initial; } catch { return initial; } });
  const set = useCallback((next: T) => { setV(next); try { localStorage.setItem(full, JSON.stringify(next)); } catch { /* ignore */ } }, [full]);
  return [v, set] as const;
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [q]);
  return m;
}
