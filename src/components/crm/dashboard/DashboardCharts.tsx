'use client';

import Link from 'next/link';
import { Activity, AlertTriangle, CalendarClock, CheckCircle2, Inbox, ReceiptText, UserRoundX, Workflow } from 'lucide-react';
import type { DashboardAnalytics, DashboardMonth } from '@/lib/CRM/dashboard/dashboardData';
import { CrmCartesianChart } from '@/components/crm/charts/CrmCharts';

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
  return (
    <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 sm:p-6">
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h3 className="text-lg font-light text-[#e5e4e2]">{title}</h3>
          <p className="mt-1 text-xs text-[#e5e4e2]/45">{description}</p>
        </div>
      </div>
      <CrmCartesianChart
        data={months.map((month) => ({ ...month }))}
        series={series}
        categoryKey="label"
        kind="line"
        height={280}
        valueFormatter={formatValue}
        axisFormatter={formatValue}
        ariaLabel={`${title}. ${description}`}
        emptyMessage="Brak danych miesięcznych dla wybranego zakresu."
      />
    </section>
  );
}

export function SalesFunnel({ funnel }: { funnel: DashboardAnalytics['funnel'] }) {
  const steps = [
    { label: 'Zapytania', value: funnel.inquiries, color: '#f59e0b' },
    { label: 'Zapytania z ofertą', value: funnel.offers, color: '#60a5fa' },
    { label: 'Wygrane zapytania', value: funnel.acceptedOffers, color: '#34d399' },
    { label: 'Powiązane wydarzenia', value: funnel.events, color: '#d3bb73' },
  ];

  return (
    <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 sm:p-6">
      <h3 className="text-lg font-light text-[#e5e4e2]">Lejek sprzedaży</h3>
      <p className="mt-1 text-xs leading-relaxed text-[#e5e4e2]/45">Zapytania utworzone w ostatnich 12 miesiącach: od etapu oferty do wygranej i powiązanego wydarzenia. Liczby dotyczą zapytań, nie liczby dokumentów ofertowych.</p>
      <div className="mt-5">
        <CrmCartesianChart
          data={steps.map((step) => ({ label: step.label, count: step.value }))}
          series={[{ key: 'count', label: 'Liczba zapytań', color: '#d3bb73' }]}
          categoryKey="label"
          kind="bar"
          horizontal
          height={260}
          valueFormatter={(value) => String(Math.round(value))}
          axisFormatter={(value) => String(Math.round(value))}
          ariaLabel="Lejek sprzedaży: liczba zapytań na kolejnych etapach."
          showLegend={false}
        />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {steps.map((step, index) => {
          const previous = index > 0 ? steps[index - 1].value : null;
          const conversion = previous && step.value <= previous
            ? Math.round((step.value / previous) * 100)
            : null;
          return (
            <div key={step.label} className="rounded-lg bg-black/10 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-[#e5e4e2]/70">{step.label}</span>
                <span className="font-medium text-[#e5e4e2]">
                  {step.value}
                </span>
              </div>
              {conversion !== null && <p className="mt-1 text-[11px] text-[#e5e4e2]/40">{conversion}% poprzedniego etapu</p>}
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
