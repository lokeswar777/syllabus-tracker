/**
 * Chart building blocks (Recharts) following the reference data-viz palette:
 * blue = syllabus completion, orange = exam mastery (fixed by entity, never by rank); thin marks, 4px rounded
 * data ends, 2px lines, recessive grid, hover tooltips; one axis per chart; text stays in ink tokens.
 */
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import type { ReactNode } from 'react';
import { useTheme } from '../lib/hooks';

export function usePalette() {
  const { resolved } = useTheme();
  const dark = resolved === 'dark';
  return {
    dark,
    completion: dark ? '#3987e5' : '#2a78d6',
    mastery: dark ? '#d95926' : '#eb6834',
    third: dark ? '#199e70' : '#1baf7a',
    track: dark ? '#2c2c2a' : '#ecebe6',
    grid: dark ? '#2c2c2a' : '#e1e0d9',
    axis: dark ? '#383835' : '#c3c2b7',
    ink: dark ? '#f0efec' : '#0b0b0b',
    ink2: dark ? '#c3c2b7' : '#52514e',
    muted: dark ? '#a3a19a' : '#6b6964',
    surface: dark ? '#1a1a19' : '#fcfcfb',
    seq: dark ? ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4'] : ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#1c5cab'],
  };
}

export function ChartTooltip({ active, payload, label, unit = '%', labelFormatter }: { active?: boolean; payload?: { name: string; value: number; color: string; dataKey: string }[]; label?: string | number; unit?: string; labelFormatter?: (l: string | number) => ReactNode }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
      {label !== undefined && <div className="mb-1 font-medium text-ink">{labelFormatter ? labelFormatter(label) : label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-ink2">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />
          <span>{p.name}</span>
          <span className="tabular ml-auto pl-3 font-medium text-ink">{typeof p.value === 'number' ? `${Number(p.value.toFixed(1))}${unit}` : p.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Completion donut with the value as the hero number in the middle. */
export function CompletionDonut({ value, label, size = 168 }: { value: number; label: string; size?: number }) {
  const p = usePalette();
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${v.toFixed(1)}%`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={[{ v }, { v: 100 - v }]} dataKey="v" innerRadius="74%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
            <Cell fill={p.completion} />
            <Cell fill={p.track} />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-3xl font-semibold tracking-tight text-ink">{v.toFixed(1)}%</span>
        <span className="text-2xs text-muted">{label}</span>
      </div>
    </div>
  );
}

/** Horizontal grouped bars: completion and mastery per category (sections, exams …). */
export function CompletionMasteryBars({ data, height }: { data: { name: string; completion: number; mastery: number }[]; height?: number }) {
  const p = usePalette();
  const h = height ?? Math.max(160, data.length * 44 + 40);
  return (
    <div style={{ height: h }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid horizontal={false} stroke={p.grid} strokeDasharray="0" />
          <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} stroke={p.axis} tickLine={false} />
          <YAxis type="category" dataKey="name" width={128} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: p.ink2 }} tickFormatter={(s: string) => (s.length > 20 ? `${s.slice(0, 19)}…` : s)} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: p.track, opacity: 0.5 }} />
          <Legend verticalAlign="top" align="right" height={24} iconType="square" iconSize={8} />
          <Bar dataKey="completion" name="Syllabus completion" fill={p.completion} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
          <Bar dataKey="mastery" name="Exam mastery" fill={p.mastery} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Single-series vertical bars (counts). */
export function CountBars({ data, height = 200, name = 'Topics', unit = '' }: { data: { label: string; count: number }[]; height?: number; name?: string; unit?: string }) {
  const p = usePalette();
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke={p.grid} />
          <XAxis dataKey="label" tickLine={false} stroke={p.axis} interval={0} tick={{ fontSize: 12, fill: p.muted }} tickFormatter={(s: string) => (s.length > 10 ? `${s.slice(0, 9)}…` : s)} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: p.track, opacity: 0.5 }} />
          <Bar dataKey="count" name={name} fill={p.completion} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Line chart of percentages over time (one axis, 0–100). */
export function PercentTrend({ data, series, height = 220, labelFormatter }: { data: Record<string, number | string | null>[]; series: { key: string; name: string; color: 'completion' | 'mastery' | 'third' }[]; height?: number; labelFormatter?: (l: string | number) => ReactNode }) {
  const p = usePalette();
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke={p.grid} />
          <XAxis dataKey="date" tickLine={false} stroke={p.axis} tickFormatter={(d: string) => (labelFormatter ? String(labelFormatter(d)) : d)} minTickGap={24} />
          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip labelFormatter={labelFormatter} />} cursor={{ stroke: p.axis }} />
          {series.length > 1 && <Legend verticalAlign="top" align="right" height={24} iconType="plainline" />}
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={p[s.color]} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: p[s.color] }} activeDot={{ r: 5, stroke: p.surface, strokeWidth: 2 }} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Count bars over time (e.g. questions per week). */
export function VolumeBars({ data, dataKey, name, height = 200, labelFormatter }: { data: Record<string, number | string | null>[]; dataKey: string; name: string; height?: number; labelFormatter?: (l: string | number) => ReactNode }) {
  const p = usePalette();
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke={p.grid} />
          <XAxis dataKey="date" tickLine={false} stroke={p.axis} tickFormatter={(d: string) => (labelFormatter ? String(labelFormatter(d)) : d)} minTickGap={16} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip unit="" labelFormatter={labelFormatter} />} cursor={{ fill: p.track, opacity: 0.5 }} />
          <Bar dataKey={dataKey} name={name} fill={p.completion} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Legend chip used next to charts/tables (identity is never colour-only: always labelled). */
export function LegendChip({ color, label }: { color: 'completion' | 'mastery'; label: string }) {
  const p = usePalette();
  return <span className="inline-flex items-center gap-1.5 text-xs text-ink2"><span className="h-2 w-2 rounded-sm" style={{ background: p[color] }} />{label}</span>;
}

/** Sequential-blue cell for heatmap tables (value 0–100). */
export function HeatCell({ value, children }: { value: number | null; children?: ReactNode }) {
  const p = usePalette();
  if (value === null) return <td className="px-3 py-2 text-center text-xs text-muted">–</td>;
  const idx = Math.min(4, Math.floor(Math.max(0, value) / 20.0001));
  const bg = p.seq[idx];
  const lightBg = p.dark ? idx >= 3 : idx <= 1;
  return (
    <td className="px-1 py-1 text-center">
      <div className="tabular rounded-md px-2 py-1.5 text-xs font-medium" style={{ background: bg, color: lightBg ? '#0b0b0b' : '#ffffff' }}>
        {children ?? `${value.toFixed(0)}%`}
      </div>
    </td>
  );
}
