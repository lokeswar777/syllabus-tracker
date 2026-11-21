import { forwardRef, useEffect, useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes, type TableHTMLAttributes } from 'react';
import { type LucideIcon, AlertOctagon, ArrowDownCircle, ArrowUpCircle, CircleDot, Loader2, X, Clock, CheckCircle2, CalendarClock, AlertTriangle, MinusCircle } from 'lucide-react';
import type { PriorityClass, RevisionInfo } from '../lib/types';
import { useMediaQuery } from '../lib/hooks';

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
type Icon = LucideIcon;

// ───────── buttons ─────────
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; icon?: Icon; loading?: boolean };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', icon: I, loading, className, children, disabled, ...rest }, ref) {
  const v = {
    primary: 'bg-accent-fill text-accent-ink hover:bg-accent-fill/90 border border-transparent',
    secondary: 'bg-surface text-ink border border-line hover:bg-subtle',
    ghost: 'text-ink2 hover:bg-subtle hover:text-ink border border-transparent',
    danger: 'bg-critical-fill text-white hover:bg-critical-fill/90 border border-transparent',
  }[variant];
  const s = size === 'sm' ? 'h-8 px-2.5 text-xs gap-1.5' : 'h-9 px-3.5 text-sm gap-2';
  return (
    <button ref={ref} type="button" disabled={disabled || loading} className={cn('inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-xl font-medium transition-colors disabled:pointer-events-none disabled:opacity-50', v, s, className)} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : I ? <I className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden /> : null}
      {children}
    </button>
  );
});

export function IconButton({ icon: I, label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: Icon; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-ink2 transition-colors hover:bg-subtle hover:text-ink disabled:opacity-40', className)} {...rest}>
      <I className="h-4 w-4" aria-hidden />
    </button>
  );
}

// ───────── surfaces ─────────
export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card', className)} {...rest}>{children}</div>;
}
export function CardHeader({ title, description, action, icon: I }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: Icon }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 sm:px-5">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">{I && <I className="h-4 w-4 text-muted" aria-hidden />}{title}</h3>
        {description && <p className="mt-0.5 text-[13px] leading-5 text-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
export const CardBody = ({ className, children }: { className?: string; children: ReactNode }) => <div className={cn('px-4 pb-4 pt-3 sm:px-5', className)}>{children}</div>;

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

// ───────── data display ─────────
export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'serious' | 'critical';
const toneCls: Record<Tone, string> = {
  neutral: 'bg-subtle text-ink2 border-line',
  accent: 'bg-accent/10 text-accent border-accent/20',
  good: 'bg-good/10 text-good border-good/20',
  warn: 'bg-warn/10 text-ink2 border-warn/30',
  serious: 'bg-serious/10 text-ink2 border-serious/30',
  critical: 'bg-critical/10 text-critical border-critical/20',
};
export function Badge({ tone = 'neutral', children, className, icon: I, title }: { tone?: Tone; children: ReactNode; className?: string; icon?: Icon; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex max-w-full items-center gap-1 truncate whitespace-nowrap rounded-md border px-1.5 py-0.5 text-2xs font-medium', toneCls[tone], className)}>
      {I && <I className="h-3 w-3 shrink-0" aria-hidden />}
      {children}
    </span>
  );
}

export function Progress({ value, tone = 'accent', className, label, size = 'md' }: { value: number; tone?: 'accent' | 'mastery' | 'good' | 'muted'; className?: string; label?: string; size?: 'sm' | 'md' }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const bar = { accent: 'bg-[#2a78d6] dark:bg-[#3987e5]', mastery: 'bg-[#eb6834] dark:bg-[#d95926]', good: 'bg-good', muted: 'bg-muted' }[tone];
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-subtle', size === 'sm' ? 'h-1.5' : 'h-2', className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn('h-full rounded-full transition-[width] duration-300', bar)} style={{ width: `${v}%` }} />
    </div>
  );
}

/** Circular progress with the value in the middle; colors come from the surrounding hero or card. */
export function ProgressRing({ value, label, size = 104, stroke = 9, trackClassName = 'stroke-white/25', barClassName = 'stroke-white', caption }: { value: number; label: string; size?: number; stroke?: number; trackClassName?: string; barClassName?: string; caption?: string }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${Math.round(v)}%`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className={trackClassName} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} className={cn('transition-[stroke-dashoffset] duration-500', barClassName)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-xl font-semibold leading-6">{Math.round(v)}%</span>
        {caption && <span className="text-2xs opacity-90">{caption}</span>}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, icon: I, testId }: { label: string; value: ReactNode; sub?: ReactNode; icon?: Icon; testId?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        {I && <I className="h-4 w-4 text-muted" aria-hidden />}
      </div>
      <div className="tabular mt-2 text-2xl font-semibold tracking-tight text-ink" data-testid={testId}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

/** A table on wider screens and labelled cards on phones: each cell takes its label from the column header. */
export function ResponsiveTable({ className, children, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  const ref = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return;
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
    table.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => {
      if (heads[i]) td.setAttribute('data-label', heads[i]); else td.removeAttribute('data-label');
    }));
  });
  return <table ref={ref} className={cn('table-cards', className)} {...rest}>{children}</table>;
}

// ───────── form controls ─────────
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return <select ref={ref} className={cn('input cursor-pointer pr-8', className)} {...rest}>{children}</select>;
});
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn('input', className)} {...rest} />;
});
export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-2xs text-muted">{hint}</span>}
    </label>
  );
}
export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; className?: string }) {
  return (
    <label className={cn('tap-row inline-flex cursor-pointer select-none items-center gap-2 text-sm text-ink2', className)}>
      <input type="checkbox" className="h-4 w-4 cursor-pointer rounded border-line accent-[rgb(var(--accent))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-line/70 bg-subtle p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn('h-7 rounded-[0.625rem] px-2.5 text-xs font-medium transition-colors', value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ───────── overlays & states ─────────
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cn('card max-h-[90dvh] w-full overflow-y-auto rounded-b-none shadow-float sm:rounded-2xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} data-close />
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

const SHEET_BREAKPOINT = {
  md: { closed: 'hidden md:contents', open: 'fixed inset-0 z-50 flex items-end md:contents', hide: 'md:hidden', inline: 'md:contents', query: '(max-width: 767.98px)' },
  xl: { closed: 'hidden xl:contents', open: 'fixed inset-0 z-50 flex items-end xl:contents', hide: 'xl:hidden', inline: 'xl:contents', query: '(max-width: 1279.98px)' },
};

/** The same controls render inline from the breakpoint up, and as a bottom sheet below it. */
export function InlineSheet({ open, onClose, title, breakpoint, children }: { open: boolean; onClose: () => void; title: string; breakpoint: keyof typeof SHEET_BREAKPOINT; children: ReactNode }) {
  const m = SHEET_BREAKPOINT[breakpoint];
  const isSheet = useMediaQuery(m.query);
  const active = open && isSheet;
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!active) return;
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('select, input, textarea, button:not([data-close])')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [active]);
  return (
    <div className={open ? m.open : m.closed}>
      <div className={cn('absolute inset-0 bg-black/40', m.hide)} onClick={onClose} aria-hidden />
      <div ref={ref} role={active ? 'dialog' : undefined} aria-modal={active || undefined} aria-label={active ? title : undefined}
        className={cn('relative max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-float', m.inline)}>
        <div className={cn('mb-3 flex items-center justify-between', m.hide)}>
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} data-close />
        </div>
        <div className={cn('grid gap-3', m.inline)}>{children}</div>
        <Button variant="primary" className={cn('mt-4 w-full', m.hide)} onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

export function EmptyState({ icon: I, title, description, action, className }: { icon: Icon; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-4 py-10 text-center', className)}>
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-subtle"><I className="h-5 w-5 text-muted" aria-hidden /></div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function ErrorState({ error, onRetry }: { error: Error | string; onRetry?: () => void }) {
  return <EmptyState icon={AlertTriangle} title="Something went wrong" description={typeof error === 'string' ? error : error.message} action={onRetry && <Button onClick={onRetry}>Try again</Button>} />;
}
export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cn('h-4 w-4 animate-spin text-muted', className)} aria-label="Loading" />;
export const Skeleton = ({ className }: { className?: string }) => <div className={cn('animate-pulse rounded-md bg-subtle', className)} />;
export function LoadingBlock({ label = 'Calculating…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
    </div>
  );
}

// ───────── domain badges (always icon + label, never colour alone) ─────────
export const CLASS_META: Record<PriorityClass, { tone: Tone; icon: Icon; dot: string }> = {
  Critical: { tone: 'critical', icon: AlertOctagon, dot: 'bg-critical' },
  High: { tone: 'serious', icon: ArrowUpCircle, dot: 'bg-serious' },
  Medium: { tone: 'warn', icon: CircleDot, dot: 'bg-warn' },
  Low: { tone: 'neutral', icon: ArrowDownCircle, dot: 'bg-muted' },
};
export function ClassBadge({ value }: { value: PriorityClass }) {
  const m = CLASS_META[value];
  return <Badge tone={m.tone} icon={m.icon}>{value}</Badge>;
}

const REV: Record<RevisionInfo['status'], { tone: Tone; icon: Icon; label: string }> = {
  overdue: { tone: 'critical', icon: AlertTriangle, label: 'Overdue' },
  'due-today': { tone: 'serious', icon: Clock, label: 'Due today' },
  'due-soon': { tone: 'warn', icon: CalendarClock, label: 'Due soon' },
  scheduled: { tone: 'good', icon: CheckCircle2, label: 'Scheduled' },
  'not-studied': { tone: 'neutral', icon: MinusCircle, label: 'Not studied' },
  unscheduled: { tone: 'neutral', icon: MinusCircle, label: 'Unscheduled' },
};
export function RevisionBadge({ rev, compact }: { rev: Pick<RevisionInfo, 'status' | 'daysOverdue' | 'nextDue'> | null | undefined; compact?: boolean }) {
  if (!rev) return <span className="text-xs text-muted">–</span>;
  const m = REV[rev.status];
  const extra = rev.status === 'overdue' && !compact ? ` · ${rev.daysOverdue} d` : '';
  return <Badge tone={m.tone} icon={m.icon} title={rev.nextDue ? `Next revision ${rev.nextDue}` : undefined}>{m.label}{extra}</Badge>;
}

export const ACTION_LABEL: Record<string, string> = {
  'learn-concept': 'Learn concept', 'complete-subtopics': 'Complete subtopics', 'practice-questions': 'Practice questions',
  'sectional-test': 'Sectional test', 'revise-notes': 'Revise notes', 'mock-test': 'Mock test',
};
