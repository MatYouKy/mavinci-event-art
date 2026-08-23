/* eslint-disable @next/next/no-assign-module-variable */
'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  Calendar,
  CheckCircle,
  Clock,
  FileText,
  Inbox,
  Package,
  Settings2,
  Users,
  WalletCards,
} from 'lucide-react';
import { canView, canCreate, isAdmin, type Employee } from '@/lib/permissions';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import type {
  DashboardAnalytics,
  DashboardMonth,
  RecentActivityDTO,
} from '@/lib/CRM/dashboard/dashboardData';
import {
  DEFAULT_DASHBOARD_RANGE,
  isDashboardWidgetEnabled,
  type DashboardPreferences,
  type DashboardWidgetId,
} from '@/lib/CRM/dashboard/dashboardConfig';
import {
  formatDashboardMoney,
  OperationalAttention,
  SalesFunnel,
  TrendChart,
} from '@/components/crm/dashboard/DashboardCharts';
import { IEmployee } from './employees/type';
import { useRouter } from 'next/navigation';

interface DashboardStats {
  totalEvents: number;
  upcomingEvents: number;
  openInquiries: number;
  activeOffers: number;
  totalClients: number;
  activeEmployees: number;
  equipmentItems: number;
  pendingTasks: number;
  revenue: number;
  overdueInvoices: number;
}

// export interface RecentActivity {
//   id: string;
//   type: 'event' | 'client' | 'task' | 'offer';
//   title: string;
//   time: string;
//   icon: any;
//   color: string;
// }

export default function CRMDashboard({
  stats,
  recentActivity,
  analytics,
  dashboardPreferences,
}: {
  stats: DashboardStats;
  recentActivity: RecentActivityDTO[];
  analytics: DashboardAnalytics;
  dashboardPreferences: DashboardPreferences;
}) {
  const { employee, loading } = useCurrentEmployee();
  const router = useRouter();
  const dashboardRange = dashboardPreferences.range ?? DEFAULT_DASHBOARD_RANGE;
  const visibleMonths = dashboardRange === '12m' ? analytics.months : analytics.months.slice(-6);
  const widgetEnabled = (widgetId: DashboardWidgetId) =>
    isDashboardWidgetEnabled(dashboardPreferences, widgetId);

  const getTrend = (
    key: keyof Pick<DashboardMonth, 'inquiries' | 'offers' | 'events' | 'revenue'>,
  ) => {
    const current = Number(visibleMonths.at(-1)?.[key] ?? 0);
    const previous = Number(visibleMonths.at(-2)?.[key] ?? 0);
    if (previous === 0) return current === 0 ? 0 : 100;
    return Math.round(((current - previous) / previous) * 100);
  };
  const getTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return 'przed chwilą';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minut temu`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} godzin temu`;
    if (seconds < 172800) return 'wczoraj';
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} dni temu`;
    return date.toLocaleDateString('pl-PL');
  };

  const parseTimeAgo = (timeAgo: string): number => {
    if (timeAgo === 'przed chwilą') return 0;
    if (timeAgo.includes('minut')) return parseInt(timeAgo) * 60;
    if (timeAgo.includes('godzin')) return parseInt(timeAgo) * 3600;
    if (timeAgo === 'wczoraj') return 86400;
    if (timeAgo.includes('dni')) return parseInt(timeAgo) * 86400;
    return 999999;
  };

  const allStatCards = [
    {
      name: 'Zapytania do obsługi',
      value: stats.openInquiries,
      icon: Inbox,
      color: 'text-amber-300',
      bgColor: 'bg-amber-400/10',
      href: '/crm/inquiries',
      module: 'tasks',
      trendKey: 'inquiries' as const,
    },
    {
      name: 'Aktywne oferty',
      value: stats.activeOffers,
      icon: FileText,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-400/10',
      href: '/crm/offers',
      module: 'offers',
      trendKey: 'offers' as const,
    },
    {
      name: 'Nadchodzące eventy',
      value: stats.upcomingEvents,
      total: stats.totalEvents,
      icon: Calendar,
      color: 'text-blue-400',
      bgColor: 'bg-blue-400/10',
      href: '/crm/events',
      module: 'events',
      trendKey: 'events' as const,
    },
    {
      name: 'Faktury po terminie',
      value: stats.overdueInvoices,
      icon: AlertTriangle,
      color: 'text-red-400',
      bgColor: 'bg-red-400/10',
      href: '/crm/invoices',
      module: 'invoices',
    },
    {
      name: 'Klienci',
      value: stats.totalClients,
      icon: Users,
      color: 'text-purple-400',
      bgColor: 'bg-purple-400/10',
      href: '/crm/clients',
      module: 'clients',
    },
    {
      name: 'Pracownicy',
      value: stats.activeEmployees,
      icon: Users,
      color: 'text-orange-400',
      bgColor: 'bg-orange-400/10',
      href: '/crm/employees',
      module: 'employees',
    },
    {
      name: 'Oczekujące zadania',
      value: stats.pendingTasks,
      icon: Clock,
      color: 'text-red-400',
      bgColor: 'bg-red-400/10',
      href: '/crm/tasks',
      module: 'tasks',
    },
    {
      name: 'Jednostki sprzętu',
      value: stats.equipmentItems,
      icon: Package,
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-400/10',
      href: '/crm/equipment',
      module: 'equipment',
    },
    {
      name: 'Wpływy z opłaconych faktur',
      value: stats.revenue,
      displayValue: `${stats.revenue.toLocaleString('pl-PL', {
        maximumFractionDigits: 0,
      })} zł`,
      helper: `od początku ${new Date().getFullYear()} roku`,
      icon: WalletCards,
      color: 'text-[#d3bb73]',
      bgColor: 'bg-[#d3bb73]/10',
      href: '/crm/invoices',
      module: 'invoices',
      trendKey: 'revenue' as const,
    },
  ];

  const statCards = allStatCards.filter((card) => {
    if (!employee || !card.module) return false;
    return canView(employee, card.module);
  });

  // Mapowanie modułów aktywności na uprawnienia
  const activityModuleMap: Record<string, string> = {
    event: 'events',
    client: 'clients',
    task: 'tasks',
    offer: 'offers',
    contract: 'contracts',
    employee: 'employees',
    equipment: 'equipment',
    message: 'messages',
  };

  // Filtrowanie aktywności na podstawie uprawnień
  const filteredActivity = recentActivity.filter((activity) => {
    const module = activityModuleMap[activity.type];
    if (!module || !employee) return false;
    return canView(employee, module);
  });

  // Definicja szybkich akcji z wymaganymi uprawnieniami
  const quickActions = [
    {
      href: '/crm/events',
      label: '+ Nowy event',
      module: 'events',
    },
    {
      href: '/crm/contacts',
      label: '+ Nowy klient',
      module: 'clients',
    },
    {
      href: '/crm/employees',
      label: '+ Nowy pracownik',
      module: 'employees',
    },
    {
      href: '/crm/tasks',
      label: '+ Nowe zadanie',
      module: 'tasks',
    },
  ].filter((action) => {
    if (!employee) return false;
    return canCreate(employee, action.module);
  });

  // Filtrowanie sekcji podsumowania
  const summaryItems = [
    {
      label: 'Wszystkie eventy',
      value: stats.totalEvents,
      module: 'events',
    },
    {
      label: 'Aktywni pracownicy',
      value: stats.activeEmployees,
      module: 'employees',
    },
    {
      label: 'Baza klientów',
      value: stats.totalClients,
      module: 'clients',
    },
  ].filter((item) => {
    if (!employee) return false;
    return canView(employee, item.module);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  // Sprawdź czy użytkownik ma jakiekolwiek uprawnienia
  const hasAnyPermissions = statCards.length > 0 || quickActions.length > 0;

  if (!hasAnyPermissions && !loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-6xl">🔒</div>
          <h2 className="mb-2 text-xl font-light text-[#e5e4e2]">Brak uprawnień</h2>
          <p className="text-sm text-[#e5e4e2]/60">
            Nie masz przypisanych żadnych uprawnień do systemu CRM.
            <br />
            Skontaktuj się z administratorem w celu nadania dostępu.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-light text-[#e5e4e2]">Witaj w systemie CRM</h2>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Przegląd działalności agencji eventowej Mavinci
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/crm/settings?tab=dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-sm text-[#e5e4e2]/70 transition-colors hover:border-[#d3bb73]/40 hover:text-[#e5e4e2]"
          >
            <Settings2 className="h-4 w-4" />
            Dostosuj dashboard
          </Link>
          {canView(employee, 'calendar') && (
            <Link
              href="/crm/calendar"
              className="rounded-lg bg-[#d3bb73] px-6 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              Otwórz kalendarz
            </Link>
          )}
        </div>
      </div>

      {widgetEnabled('kpi-overview') && statCards.length > 0 && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => {
            const trend = 'trendKey' in stat && stat.trendKey ? getTrend(stat.trendKey) : null;
            return (
              <Link
                key={stat.name}
                href={stat.href}
                className="group rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 transition-all duration-200 hover:border-[#d3bb73]/30"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className={`${stat.bgColor} rounded-lg p-3`}>
                    <stat.icon className={`h-6 w-6 ${stat.color}`} />
                  </div>
                  {trend !== null && (
                    <span className={`rounded-full px-2 py-1 text-xs ${trend >= 0 ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400'}`}>
                      {trend > 0 ? '+' : ''}{trend}%
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-light text-[#e5e4e2]/60">{stat.name}</p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-3xl font-light text-[#e5e4e2]">
                      {'displayValue' in stat ? stat.displayValue : stat.value}
                    </p>
                    {'total' in stat && stat.total && <span className="text-sm text-[#e5e4e2]/40">/ {stat.total}</span>}
                  </div>
                  {'helper' in stat && stat.helper && (
                    <p className="text-xs text-[#e5e4e2]/40">{stat.helper}</p>
                  )}
                  {trend !== null && (
                    <p className="text-[11px] text-[#e5e4e2]/35">względem poprzedniego miesiąca</p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {(widgetEnabled('sales-trends') || widgetEnabled('sales-funnel')) && (
        <div className="grid gap-6 lg:grid-cols-3">
          {widgetEnabled('sales-trends') && (
            <div className={widgetEnabled('sales-funnel') ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <TrendChart
                title="Trend sprzedażowy"
                description={`Nowe rekordy · zakres ${dashboardRange === '12m' ? '12 miesięcy' : '6 miesięcy'}`}
                months={visibleMonths}
                series={[
                  { key: 'inquiries', label: 'Zapytania', color: '#f59e0b' },
                  { key: 'offers', label: 'Oferty', color: '#60a5fa' },
                  { key: 'events', label: 'Wydarzenia', color: '#d3bb73' },
                ]}
              />
            </div>
          )}
          {widgetEnabled('sales-funnel') && <SalesFunnel funnel={analytics.funnel} />}
        </div>
      )}

      {widgetEnabled('financial-trends') && canView(employee, 'invoices') && (
        <TrendChart
          title="Przychód, koszty i marża"
          description={`Rentowność wydarzeń według terminu realizacji · zakres ${dashboardRange === '12m' ? '12 miesięcy' : '6 miesięcy'}`}
          months={visibleMonths}
          series={[
            { key: 'revenue', label: 'Przychód', color: '#34d399' },
            { key: 'costs', label: 'Koszty', color: '#f87171' },
            { key: 'margin', label: 'Marża', color: '#d3bb73' },
          ]}
          formatValue={formatDashboardMoney}
        />
      )}

      {(widgetEnabled('recent-activity') || widgetEnabled('quick-actions') || widgetEnabled('operational-attention')) && (
      <div className="grid gap-6 lg:grid-cols-3">
        {widgetEnabled('recent-activity') && (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 lg:col-span-2">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-lg font-light text-[#e5e4e2]">Ostatnia aktywność</h3>
            {canView(employee, 'events') && (
              <Link
                href="/crm/events"
                className="text-sm text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80"
              >
                Zobacz wszystkie wydarzenia
              </Link>
            )}
          </div>
          {filteredActivity.length === 0 ? (
            <div className="py-8 text-center text-[#e5e4e2]/40">Brak aktywności</div>
          ) : (
            <div className="space-y-4">
              {filteredActivity.map((activity) => {
                const href = `/crm/${activity.type}s/${activity.id}`;
              return (  
                <div
                  key={activity.id}
                  onClick={() => {
                    router.push(href);
                  }}
                  title={activity.title}
                  className="flex items-start gap-4 rounded-lg bg-[#0f1119] p-4 transition-colors hover:bg-[#0f1119]/50 cursor-pointer"
                >
                  <div className={`${activity.color} mt-1`}>
                    <activity.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-light text-[#e5e4e2]">{activity.title}</p>
                    <p className="mt-1 text-xs text-[#e5e4e2]/40">{activity.time}</p>
                  </div>
                </div>
              );
            })}
            </div>
          )}
        </div>
        )}

        <div className={`space-y-6 ${!widgetEnabled('recent-activity') ? 'lg:col-span-3 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0' : ''}`}>
        {widgetEnabled('operational-attention') && (
          <OperationalAttention attention={analytics.attention} />
        )}
        {widgetEnabled('quick-actions') && (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h3 className="mb-6 text-lg font-light text-[#e5e4e2]">Szybkie akcje</h3>
          {quickActions.length === 0 ? (
            <div className="py-8 text-center text-sm text-[#e5e4e2]/40">
              Brak dostępnych akcji
            </div>
          ) : (
            <div className="space-y-3">
              {quickActions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="block w-full rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-3 text-sm font-light text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
                >
                  {action.label}
                </Link>
              ))}
            </div>
          )}

          {summaryItems.length > 0 && (
            <div className="mt-8 border-t border-[#d3bb73]/10 pt-6">
              <div className="mb-4 flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-[#d3bb73]" />
                <h4 className="text-sm font-light text-[#e5e4e2]">Podsumowanie</h4>
              </div>
              <div className="space-y-3 text-sm">
                {summaryItems.map((item) => (
                  <div key={item.label} className="flex justify-between">
                    <span className="text-[#e5e4e2]/60">{item.label}</span>
                    <span className="text-[#e5e4e2]">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        )}
        </div>
      </div>
      )}
    </div>
  );
}
