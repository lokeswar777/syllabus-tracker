// Formatting and date helpers. Dates are 'YYYY-MM-DD' strings handled in UTC, exactly like the planner (src/planner/config.js).

export const pct = (x: number | null | undefined, digits = 1) => (x === null || x === undefined || Number.isNaN(x) ? '–' : `${Number(x).toFixed(digits).replace(/\.0+$/, '')}%`);
export const num = (x: number | null | undefined, digits = 0) => (x === null || x === undefined || Number.isNaN(x) ? '–' : Number(x).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 }));
export const secs = (x: number | null | undefined) => (x === null || x === undefined ? '–' : `${Math.round(x)} s`);
export const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
export const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
export const weekStart = (date: string) => addDays(date, -((weekday(date) + 6) % 7)); // Monday
export const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const fmt = (date: string, o: Intl.DateTimeFormatOptions) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
export const shortDate = (date: string | null | undefined) => (date ? fmt(date, { day: 'numeric', month: 'short' }) : '–');
export const longDate = (date: string | null | undefined) => (date ? fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '–');
export const dayName = (date: string) => fmt(date, { weekday: 'short' });
export const monthName = (date: string) => fmt(date, { month: 'long', year: 'numeric' });

export const relativeDays = (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`);

export const SUBJECT_LABEL: Record<string, string> = {
  quant: 'Quantitative Aptitude', reasoning: 'Reasoning', english: 'English', ga: 'General Awareness', computer: 'Computer',
  fin: 'Banking & Finance', hindi: 'Hindi', stats: 'Statistics', econ: 'Economics', descriptive: 'Descriptive Writing',
  skill: 'Skill Tests', accounts: 'Accounts', physical: 'Physical Tests', personality: 'Interview & Personality', 'language-test': 'Language Test',
};
export const subjectLabel = (s: string) => SUBJECT_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
export const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
/** Engine reasons are stable data; only their internal build-phase wording is reworded for display. */
export const reasonText = (s: string) => s.replace(/Phase-\d priority/g, 'weightage priority');
