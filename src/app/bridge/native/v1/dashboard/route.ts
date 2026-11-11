import { createClient } from '@supabase/supabase-js';
import { nativeContext, nativeJson, nativeUnauthorized } from '@/lib/native/auth';
import { usesOperationalStages } from '@/lib/CRM/events/operationalStages';
import { createDashboardReadFetch } from '@/lib/CRM/dashboard/dashboardReadFetch.server';
import { DEFAULT_DASHBOARD_RANGE, isDashboardWidgetEnabled, type DashboardWidgetId } from '@/lib/CRM/dashboard/dashboardConfig';
import { canCreate, canView } from '@/lib/permissions';
import {
  fetchDashboardAnalyticsServer,
  fetchDashboardPreferencesServer,
  fetchRecentActivityServer,
  fetchStatsServer,
  withNativeDashboardClient,
} from '@/lib/CRM/dashboard/dashboardData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Dashboard CRM dla aplikacji na Maca — te same dane i te same reguły widoczności co strona `/crm` (`CRMDashboard.tsx`):
 * kafelki wskaźników, szybkie akcje, podsumowanie i ostatnia aktywność filtrowane tu, na serwerze, funkcjami `canView` / `canCreate`.
 * Liczone tokenem pracownika (RLS), bez klucza serwisowego.
 */
export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: createDashboardReadFetch() },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: employee } = await client.from('employees').select('id,permissions,role,access_level,is_active').eq('id', ctx.employee.id).maybeSingle();
  if (!employee?.is_active) return nativeUnauthorized();
  if (Array.isArray(employee.permissions) && employee.permissions.includes('equipment_manage') && usesOperationalStages(employee)) {
    return nativeJson({ variant: 'warehouse' });
  }
  const [stats, recentActivity, analytics, preferences] = await withNativeDashboardClient(client, () =>
    Promise.all([fetchStatsServer(), fetchRecentActivityServer(), fetchDashboardAnalyticsServer(), fetchDashboardPreferencesServer()]),
  );
  const company = analytics.scope === 'company';
  const range = preferences.range ?? DEFAULT_DASHBOARD_RANGE;
  const months = range === '12m' ? analytics.months : analytics.months.slice(-6);
  const widgets = Object.fromEntries(
    (['kpi-overview', 'sales-trends', 'sales-funnel', 'financial-trends', 'operational-attention', 'recent-activity', 'quick-actions'] as DashboardWidgetId[])
      .map((id) => [id, isDashboardWidgetEnabled(preferences, id)]),
  );
  const cards = [
    { name: 'Zapytania do obsługi', value: stats.openInquiries, icon: 'tray', color: 'amber', href: '/crm/inquiries', module: 'tasks', trendKey: 'inquiries' },
    { name: 'Aktywne oferty', value: stats.activeOffers, icon: 'doc.text', color: 'green', href: '/crm/offers', module: 'offers', trendKey: 'offers' },
    { name: 'Nadchodzące eventy', value: stats.upcomingEvents, total: stats.totalEvents, icon: 'calendar', color: 'blue', href: '/crm/events', module: 'events', trendKey: 'events' },
    { name: 'Faktury po terminie', value: stats.overdueInvoices, icon: 'exclamationmark.triangle', color: 'red', href: '/crm/invoices', module: 'invoices' },
    { name: 'Klienci', value: stats.totalClients, icon: 'person.2', color: 'purple', href: '/crm/clients', module: 'clients' },
    { name: 'Pracownicy', value: stats.activeEmployees, icon: 'person.2', color: 'orange', href: '/crm/employees', module: 'employees' },
    { name: 'Oczekujące zadania', value: stats.pendingTasks, icon: 'clock', color: 'red', href: '/crm/tasks', module: 'tasks' },
    { name: 'Jednostki sprzętu', value: stats.equipmentItems, icon: 'shippingbox', color: 'cyan', href: '/crm/equipment', module: 'equipment' },
    {
      name: 'Wpływy faktyczne', value: stats.revenue, displayValue: `${stats.revenue.toLocaleString('pl-PL', { maximumFractionDigits: 0 })} zł`,
      helper: `bank, potwierdzone płatności i gotówka od początku ${new Date().getFullYear()} roku`, icon: 'creditcard', color: 'gold', href: '/crm/invoices', module: 'invoices', trendKey: 'revenue',
    },
  ].filter((card) => (company || ['events', 'tasks', 'offers'].includes(card.module)) && canView(employee, card.module));
  const activityModules: Record<string, string> = { event: 'events', client: 'clients', task: 'tasks', offer: 'offers', contract: 'contracts', employee: 'employees', equipment: 'equipment', message: 'messages' };
  const activity = recentActivity
    .filter((a) => activityModules[a.type] && canView(employee, activityModules[a.type]))
    .map((a) => ({ id: a.id, type: a.type, title: a.title, time: a.time, createdAt: a.created_at, href: `/crm/${a.type}s/${a.id}` }));
  const quickActions = [
    { href: '/crm/events', label: '+ Nowy event', module: 'events' },
    { href: '/crm/contacts', label: '+ Nowy klient', module: 'clients' },
    { href: '/crm/employees', label: '+ Nowy pracownik', module: 'employees' },
    { href: '/crm/tasks', label: '+ Nowe zadanie', module: 'tasks' },
  ].filter((a) => canCreate(employee, a.module));
  const summary = [
    { label: 'Wszystkie eventy', value: stats.totalEvents, module: 'events' },
    { label: 'Aktywni pracownicy', value: stats.activeEmployees, module: 'employees' },
    { label: 'Baza klientów', value: stats.totalClients, module: 'clients' },
  ].filter((i) => (company || i.module === 'events') && canView(employee, i.module));
  return nativeJson({
    variant: 'company',
    scope: analytics.scope ?? 'none',
    accessError: analytics.accessError ?? null,
    subtitle: company ? 'Przegląd działalności agencji eventowej Mavinci' : 'Twoje zadania, oferty i wydarzenia, do których jesteś przypisany',
    range,
    months,
    funnel: analytics.funnel,
    attention: analytics.attention,
    sellerReport: analytics.sellerReport ?? null,
    widgets,
    showFinancialTrends: company && canView(employee, 'invoices'),
    showCalendar: canView(employee, 'calendar'),
    cards,
    activity,
    quickActions,
    summary,
    noPermissions: cards.length === 0 && quickActions.length === 0,
  });
}
