'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Activity, AlertTriangle, CalendarClock, CheckCircle2, Inbox, ReceiptText, UserRoundX, Workflow } from 'lucide-react';
import type { DashboardAnalytics, DashboardMonth } from '@/lib/CRM/dashboard/dashboardData';

type Series = {
  key: keyof Pick<DashboardMonth, 'inquiries' | 'offers' | 'events' | 'revenue' | 'costs' | 'margin'>;
  label: string;
  color: string;
};

const money = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
});

function linePoints(values: number[], width: number, height: number, min: number, max: number, offsetX = 0) {
  const range = Math.max(max - min, 1);
  return values
    .map((value, index) => {
      const x = offsetX + (values.length === 1 ? width / 2 : (index / (values.length - 1)) * width);
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');
}

export function TrendChart({
  title,
  description,
  months,
  series,
  formatValue = (value) => String(Math.round(value)),
}: {
  title: string;
  description: string;
  months: DashboardMonth[];
  series: Series[];
  formatValue?: (value: number) => string;
}) {
  const [hoveredPoint, setHoveredPoint] = useState<{
    x: number;
    y: number;
    month: string;
    label: string;
    value: number;
    color: string;
  } | null>(null);
  const values = series.flatMap((item) => months.map((month) => Number(month[item.key] ?? 0)));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const valueRange = Math.max(max - min, 1);
  const plotLeft = 96;
  const chartWidth = 760;
  const chartHeight = 210;
  const svgWidth = plotLeft + chartWidth + 16;
  const svgHeight = chartHeight + 40;
  const gridSteps = [0, 0.25, 0.5, 0.75, 1];

  return (
    <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 sm:p-6">
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h3 className="text-lg font-light text-[#e5e4e2]">{title}</h3>
          <p className="mt-1 text-xs text-[#e5e4e2]/45">{description}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {series.map((item) => (
            <div key={item.key} className="flex items-center gap-1.5 text-xs text-[#e5e4e2]/60">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[620px]">
          <svg
            viewBox={`0 -8 ${svgWidth} ${svgHeight + 8}`}
            className="h-[250px] w-full"
            role="img"
            onMouseLeave={() => setHoveredPoint(null)}
          >
            {gridSteps.map((step) => {
              const y = chartHeight - chartHeight * step;
              const tickValue = min + valueRange * step;
              return (
                <g key={step}>
                  <line
                    x1={plotLeft}
                    x2={plotLeft + chartWidth}
                    y1={y}
                    y2={y}
                    stroke="rgba(229,228,226,0.10)"
                    strokeWidth="1"
                  />
                  <text
                    x={plotLeft - 12}
                    y={y + 4}
                    textAnchor="end"
                    fill="rgba(229,228,226,0.48)"
                    fontSize="11"
                  >
                    {formatValue(tickValue)}
                  </text>
                </g>
              );
            })}
            {series.map((item) => {
              const itemValues = months.map((month) => Number(month[item.key] ?? 0));
              return (
                <g key={item.key}>
                  <polyline
                    points={linePoints(itemValues, chartWidth, chartHeight, min, max, plotLeft)}
                    fill="none"
                    stroke={item.color}
                    strokeWidth="3"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {itemValues.map((value, index) => {
                    const x = plotLeft + (itemValues.length === 1 ? chartWidth / 2 : (index / (itemValues.length - 1)) * chartWidth);
                    const y = chartHeight - ((value - min) / valueRange) * chartHeight;
                    return (
                      <circle
                        key={`${item.key}-${months[index].key}`}
                        cx={x}
                        cy={y}
                        r="5"
                        fill={item.color}
                        stroke="#1c1f33"
                        strokeWidth="2"
                        className="cursor-pointer outline-none"
                        tabIndex={0}
                        aria-label={`${months[index].label}, ${item.label}: ${formatValue(value)}`}
                        onMouseEnter={() => setHoveredPoint({
                          x,
                          y,
                          month: months[index].label,
                          label: item.label,
                          value,
                          color: item.color,
                        })}
                        onMouseLeave={() => setHoveredPoint(null)}
                        onFocus={() => setHoveredPoint({
                          x,
                          y,
                          month: months[index].label,
                          label: item.label,
                          value,
                          color: item.color,
                        })}
                        onBlur={() => setHoveredPoint(null)}
                      >
                        <title>{`${months[index].label}: ${formatValue(value)}`}</title>
                      </circle>
                    );
                  })}
                </g>
              );
            })}
            {months.map((month, index) => {
              const x = plotLeft + (months.length === 1 ? chartWidth / 2 : (index / (months.length - 1)) * chartWidth);
              return (
                <text key={month.key} x={x} y={chartHeight + 28} textAnchor="middle" fill="rgba(229,228,226,0.45)" fontSize="12">
                  {month.label}
                </text>
              );
            })}
            {hoveredPoint && (() => {
              const tooltipWidth = 210;
              const tooltipHeight = 54;
              const tooltipX = Math.min(
                Math.max(hoveredPoint.x + 12, plotLeft),
                plotLeft + chartWidth - tooltipWidth,
              );
              const tooltipY = hoveredPoint.y > 68
                ? hoveredPoint.y - tooltipHeight - 10
                : hoveredPoint.y + 12;
              return (
                <g pointerEvents="none">
                  <line
                    x1={hoveredPoint.x}
                    x2={hoveredPoint.x}
                    y1="0"
                    y2={chartHeight}
                    stroke="rgba(229,228,226,0.18)"
                    strokeDasharray="4 4"
                  />
                  <rect
                    x={tooltipX}
                    y={tooltipY}
                    width={tooltipWidth}
                    height={tooltipHeight}
                    rx="8"
                    fill="#0f1119"
                    stroke="rgba(211,187,115,0.35)"
                  />
                  <circle cx={tooltipX + 14} cy={tooltipY + 18} r="4" fill={hoveredPoint.color} />
                  <text x={tooltipX + 26} y={tooltipY + 21} fill="rgba(229,228,226,0.72)" fontSize="11">
                    {hoveredPoint.month} • {hoveredPoint.label}
                  </text>
                  <text x={tooltipX + 14} y={tooltipY + 42} fill="#e5e4e2" fontSize="13" fontWeight="600">
                    {formatValue(hoveredPoint.value)}
                  </text>
                </g>
              );
            })()}
          </svg>
        </div>
      </div>
    </section>
  );
}

export function SalesFunnel({ funnel }: { funnel: DashboardAnalytics['funnel'] }) {
  const steps = [
    { label: 'Zapytania', value: funnel.inquiries, color: '#f59e0b' },
    { label: 'Oferty', value: funnel.offers, color: '#60a5fa' },
    { label: 'Wygrane zapytania', value: funnel.acceptedOffers, color: '#34d399' },
    { label: 'Powiązane wydarzenia', value: funnel.events, color: '#d3bb73' },
  ];
  const max = Math.max(...steps.map((step) => step.value), 1);

  return (
    <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 sm:p-6">
      <h3 className="text-lg font-light text-[#e5e4e2]">Lejek sprzedaży</h3>
      <p className="mt-1 text-xs text-[#e5e4e2]/45">Aktywność z ostatnich 12 miesięcy</p>
      <div className="mt-6 space-y-4">
        {steps.map((step, index) => {
          const previous = index > 0 ? steps[index - 1].value : null;
          const conversion = previous && step.value <= previous
            ? Math.round((step.value / previous) * 100)
            : null;
          return (
            <div key={step.label}>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="text-[#e5e4e2]/70">{step.label}</span>
                <span className="font-medium text-[#e5e4e2]">
                  {step.value}
                  {conversion !== null && <span className="ml-2 text-xs text-[#e5e4e2]/35">{conversion}%</span>}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-[#0f1119]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.max((step.value / max) * 100, step.value ? 4 : 0)}%`, backgroundColor: step.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function OperationalAttention({ attention }: { attention: DashboardAnalytics['attention'] }) {
  const items = [
    {
      label: 'Procesy wydarzeń po terminie',
      value: attention.workflowRisks,
      href: '/crm/events',
      icon: Workflow,
      color: 'text-red-300',
    },
    {
      label: 'Klienci bez opiekuna',
      value: attention.unownedCustomers,
      href: '/crm/contacts',
      icon: UserRoundX,
      color: 'text-fuchsia-300',
    },
    {
      label: 'Zaniedbane szanse sprzedażowe',
      value: attention.neglectedOpportunities,
      href: '/crm/inquiries',
      icon: Activity,
      color: 'text-violet-300',
    },
    {
      label: 'Zaległe kontakty z zapytań',
      value: attention.overdueInquiries,
      href: '/crm/inquiries',
      icon: Inbox,
      color: 'text-amber-300',
    },
    {
      label: 'Zadania po terminie',
      value: attention.overdueTasks,
      href: '/crm/tasks',
      icon: AlertTriangle,
      color: 'text-red-400',
    },
    {
      label: 'Faktury po terminie',
      value: attention.overdueInvoices,
      href: '/crm/invoices',
      icon: ReceiptText,
      color: 'text-orange-400',
    },
    {
      label: 'Wydarzenia w ciągu 30 dni',
      value: attention.eventsNext30Days,
      href: '/crm/events',
      icon: CalendarClock,
      color: 'text-[#d3bb73]',
    },
  ];

  return (
    <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-[#d3bb73]" />
        <div>
          <h3 className="text-lg font-light text-[#e5e4e2]">Wymaga działania</h3>
          <p className="text-xs text-[#e5e4e2]/45">Najważniejsze sprawy operacyjne</p>
        </div>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <Link key={item.label} href={item.href} className="flex items-center gap-3 rounded-lg bg-[#0f1119] p-3 transition-colors hover:bg-[#0f1119]/60">
            <item.icon className={`h-5 w-5 ${item.color}`} />
            <span className="min-w-0 flex-1 text-sm text-[#e5e4e2]/70">{item.label}</span>
            <span className="text-xl font-light text-[#e5e4e2]">{item.value}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export const formatDashboardMoney = (value: number) => money.format(value);
