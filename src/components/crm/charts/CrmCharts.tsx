'use client';

import { useEffect, useId, useState } from 'react';
import {
  Area, Bar, CartesianGrid, Cell, ComposedChart, Legend, Line,
  Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

export type CrmChartDatum = Record<string, string | number | null | undefined>;
export type CrmChartSeries = { key: string; label: string; color?: string };
const palette = ['#d3bb73', '#6ee7b7', '#93c5fd', '#fda4af', '#c4b5fd', '#67e8f9', '#fdba74'];
const number = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });
const compactNumber = new Intl.NumberFormat('pl-PL', { notation: 'compact', maximumFractionDigits: 1 });
const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const tooltipStyle = {
  background: 'var(--brand-burgundy-950, #200711)',
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 12,
  boxShadow: '0 12px 36px rgba(0,0,0,0.3)',
  padding: '10px 14px',
  fontSize: 12,
};

function ChartDataTable({ data, series, categoryKey, valueFormatter, ariaLabel }: {
  data: CrmChartDatum[]; series: CrmChartSeries[]; categoryKey: string;
  valueFormatter: (value: number) => string; ariaLabel: string;
}) {
  return <details className="mt-3 text-xs text-[#e5e4e2]/55">
    <summary className="w-fit cursor-pointer rounded-md px-1 py-1 outline-none hover:text-[#d3bb73] focus-visible:bg-white/10">Pokaż dane wykresu</summary>
    <div className="mt-2 max-h-80 overflow-auto rounded-lg bg-white/[0.025]">
      <table className="w-full text-left"><caption className="sr-only">{ariaLabel}</caption>
        <thead className="sticky top-0 bg-[var(--brand-burgundy-950,#200711)]"><tr><th scope="col" className="px-3 py-2 font-medium">Okres / kategoria</th>{series.map(item => <th key={item.key} scope="col" className="px-3 py-2 text-right font-medium">{item.label}</th>)}</tr></thead>
        <tbody className="divide-y divide-white/5">{data.map((row, index) => <tr key={index}><th scope="row" className="px-3 py-2 font-normal">{String(row[categoryKey] ?? '—')}</th>{series.map(item => {
          const value = asNumber(row[item.key]);
          return <td key={item.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{value === null ? 'Brak danych' : valueFormatter(value)}</td>;
        })}</tr>)}</tbody>
      </table>
    </div>
  </details>;
}

export function CrmCartesianChart({
  data, series, categoryKey, kind = 'bar', horizontal = false, stacked = false,
  height = 280, valueFormatter = value => number.format(value), axisFormatter,
  ariaLabel, showLegend = true, emptyMessage = 'Brak danych w wybranym zakresie.',
}: {
  data: CrmChartDatum[];
  series: CrmChartSeries[];
  categoryKey: string;
  kind?: 'bar' | 'line' | 'area';
  horizontal?: boolean;
  stacked?: boolean;
  height?: number;
  valueFormatter?: (value: number) => string;
  axisFormatter?: (value: number) => string;
  ariaLabel: string;
  showLegend?: boolean;
  emptyMessage?: string;
}) {
  const descriptionId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const rows = data.map(row => {
    const normalized = { ...row };
    for (const item of series) normalized[item.key] = asNumber(row[item.key]);
    return normalized;
  });
  const hasData = rows.some(row => series.some(item => row[item.key] !== null));
  const axisValue = (value: number) => (axisFormatter || valueFormatter)(value);
  const categoryTick = (value: unknown) => {
    const label = String(value ?? '');
    return horizontal && label.length > 23 ? `${label.slice(0, 22)}…` : label;
  };
  const numericDomain: [(minimum: number) => number, (maximum: number) => number] = [minimum => Math.min(0, minimum), maximum => Math.max(1, maximum)];

  return <div className="min-w-0 max-w-full">
    <p id={descriptionId} className="sr-only">{ariaLabel}. Wykres obsługuje klawiaturę. Dokładne wartości są dostępne także w tabeli pod wykresem. Brak danych nie jest zastępowany zerem.</p>
    {!hasData ? <p className="flex min-h-40 items-center justify-center rounded-lg bg-white/[0.025] p-6 text-center text-sm text-[#e5e4e2]/40">{emptyMessage}</p> : <div className="min-w-0 w-full [&_.recharts-wrapper]:outline-none [&_.recharts-surface:focus-visible]:outline [&_.recharts-surface:focus-visible]:outline-1 [&_.recharts-surface:focus-visible]:outline-white/20" style={{ height }} role="group" aria-label={ariaLabel} aria-describedby={descriptionId}>
      {mounted && <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={80}>
        <ComposedChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'} accessibilityLayer margin={{ top: 12, right: 16, left: 0, bottom: 8 }} barGap={4} barCategoryGap="24%">
          <CartesianGrid stroke="rgba(229,228,226,0.075)" strokeDasharray="3 5" vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? <>
            <XAxis type="number" domain={numericDomain} tickFormatter={axisValue} tick={{ fill: 'rgba(229,228,226,0.48)', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={18} />
            <YAxis type="category" dataKey={categoryKey} width={155} tickFormatter={categoryTick} tick={{ fill: 'rgba(229,228,226,0.62)', fontSize: 11 }} tickLine={false} axisLine={false} interval={0} />
            <ReferenceLine x={0} stroke="rgba(229,228,226,0.2)" />
          </> : <>
            <XAxis type="category" dataKey={categoryKey} tick={{ fill: 'rgba(229,228,226,0.52)', fontSize: 11 }} tickLine={false} axisLine={false} tickMargin={10} minTickGap={20} interval="preserveStartEnd" />
            <YAxis type="number" domain={numericDomain} width={96} tickFormatter={axisValue} tick={{ fill: 'rgba(229,228,226,0.48)', fontSize: 11 }} tickLine={false} axisLine={false} />
            <ReferenceLine y={0} stroke="rgba(229,228,226,0.2)" />
          </>}
          <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#e5e4e2', marginBottom: 5 }} itemStyle={{ padding: '2px 0' }} cursor={kind === 'bar' ? { fill: 'rgba(255,255,255,0.035)' } : { stroke: 'rgba(229,228,226,0.2)', strokeDasharray: '4 4' }}
            formatter={(value, name) => [asNumber(value) === null ? 'Brak danych' : valueFormatter(asNumber(value)!), String(name)]} />
          {showLegend && <Legend iconType="circle" iconSize={8} wrapperStyle={{ paddingTop: 12, fontSize: 12 }} formatter={value => <span style={{ color: 'rgba(229,228,226,0.65)' }}>{value}</span>} />}
          {series.map((item, index) => {
            const color = item.color || palette[index % palette.length];
            if (kind === 'line') return <Line key={item.key} dataKey={item.key} name={item.label} stroke={color} strokeWidth={2.5} type="linear" dot={{ r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />;
            if (kind === 'area') return <Area key={item.key} dataKey={item.key} name={item.label} stroke={color} fill={color} fillOpacity={0.13} strokeWidth={2.5} type="linear" connectNulls={false} stackId={stacked ? 'total' : undefined} isAnimationActive={false} />;
            return <Bar key={item.key} dataKey={item.key} name={item.label} fill={color} maxBarSize={36} radius={stacked ? 0 : 4} stackId={stacked ? 'total' : undefined} isAnimationActive={false} />;
          })}
        </ComposedChart>
      </ResponsiveContainer>}
    </div>}
    {!!data.length && <ChartDataTable data={rows} series={series} categoryKey={categoryKey} valueFormatter={valueFormatter} ariaLabel={ariaLabel} />}
  </div>;
}

export function CrmDonutChart({ data, categoryKey, valueKey, ariaLabel, valueFormatter = value => number.format(value), height = 290, showLegend = true, emptyMessage = 'Brak danych do przedstawienia udziałów.' }: {
  data: CrmChartDatum[]; categoryKey: string; valueKey: string; ariaLabel: string;
  valueFormatter?: (value: number) => string; height?: number; showLegend?: boolean; emptyMessage?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const rows = data.map((row, index) => ({ ...row, [valueKey]: asNumber(row[valueKey]), color: typeof row.color === 'string' ? row.color : palette[index % palette.length] }));
  const hasNegative = rows.some(row => Number(row[valueKey]) < 0);
  const positive = rows.filter(row => Number(row[valueKey]) > 0);
  const total = positive.reduce((sum, row) => sum + Number(row[valueKey]), 0);
  return <div className="min-w-0 max-w-full">
    {hasNegative || !positive.length ? <p className="flex min-h-40 items-center justify-center rounded-lg bg-white/[0.025] p-5 text-center text-sm text-[#e5e4e2]/45">{hasNegative ? 'Wykres udziałów nie przedstawia kwot ujemnych. Pełne wartości znajdziesz w tabeli poniżej.' : emptyMessage}</p> : <div className="w-full min-w-0" style={{ height }} role="group" aria-label={ariaLabel}>
      {mounted && <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={80}>
        <PieChart accessibilityLayer>
          <Pie data={positive} dataKey={valueKey} nameKey={categoryKey} innerRadius="53%" outerRadius="78%" paddingAngle={positive.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
            {positive.map((row, index) => <Cell key={index} fill={row.color} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: '#e5e4e2' }} formatter={(value, name) => {
            const numeric = asNumber(value) || 0;
            return [`${valueFormatter(numeric)} · ${number.format(total ? numeric / total * 100 : 0)}%`, String(name)];
          }} />
          {showLegend && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, lineHeight: '24px' }} formatter={value => <span style={{ color: 'rgba(229,228,226,0.65)' }}>{value}</span>} />}
        </PieChart>
      </ResponsiveContainer>}
    </div>}
    {!!data.length && <ChartDataTable data={rows} series={[{ key: valueKey, label: 'Wartość' }]} categoryKey={categoryKey} valueFormatter={valueFormatter} ariaLabel={ariaLabel} />}
  </div>;
}

export const formatCrmChartCompactNumber = (value: number) => compactNumber.format(value);
