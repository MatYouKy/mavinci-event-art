import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { CookieStoreLike, createSupabaseServerClient } from '@/lib/supabase/server.app';
import { loadInvoiceFinanceAccess } from '@/lib/invoices/financeAccess';
import { canView } from '@/lib/permissions';
import type { DashboardPreferences } from './dashboardConfig';
import type { SellerFinancialReport } from './sellerDashboardTypes';
import { createDashboardReadFetch } from './dashboardReadFetch.server';

export type DashboardStats = {
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
};

export type RecentActivityDTO = {
  id: string;
  type: 'event' | 'client' | 'task' | 'offer';
  title: string;
  time: string;
  icon: any;
  color: string;
  created_at: string;
};

export type DashboardMonth = {
  key: string;
  label: string;
  inquiries: number;
  offers: number;
  events: number;
  revenue: number;
  costs: number;
  margin: number;
};

export type DashboardAnalytics = {
  scope?: 'company' | 'sales' | 'none';
  accessError?: string | null;
  sellerReport?: SellerFinancialReport | null;
  months: DashboardMonth[];
  funnel: {
    inquiries: number;
    offers: number;
    acceptedOffers: number;
    events: number;
  };
  attention: {
    overdueTasks: number;
    overdueInquiries: number;
    overdueInvoices: number;
    eventsNext30Days: number;
    unownedCustomers: number;
    neglectedOpportunities: number;
    workflowRisks: number;
  };
};

function getCookieStore(): CookieStoreLike {
  const cookieStore = cookies();
  return {
    getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
    set: (name, value, options) => {
      // Next cookies().set wspiera (name, value, options)
      cookieStore.set(name, value, options);
    },
  };
}

// Reuse one request-scoped client and read queue for all dashboard sections.
// React cache is per server request; employee data is never globally cached.
const getDashboardClient = cache(() => createSupabaseServerClient(getCookieStore(), {
  fetch: createDashboardReadFetch(),
}));

const fetchDashboardAccess = cache(async () => {
  try {
    const supabase = getDashboardClient();
    return { access: await loadInvoiceFinanceAccess(supabase), error: null };
  } catch (error) {
    console.error('[CRM dashboard] access lookup failed:', error);
    // A missing migration/session must never restore the old company-wide data path.
    return { access: null, error: 'Nie udało się potwierdzić zakresu dostępu do dashboardu.' };
  }
});

const emptyStats = (): DashboardStats => ({
  totalEvents: 0, upcomingEvents: 0, openInquiries: 0, activeOffers: 0,
  totalClients: 0, activeEmployees: 0, equipmentItems: 0, pendingTasks: 0,
  revenue: 0, overdueInvoices: 0,
});

function emptyAnalytics(): DashboardAnalytics {
  return {
    scope: 'none', months: createMonthBuckets(),
    funnel: { inquiries: 0, offers: 0, acceptedOffers: 0, events: 0 },
    attention: { overdueTasks: 0, overdueInquiries: 0, overdueInvoices: 0, eventsNext30Days: 0, unownedCustomers: 0, neglectedOpportunities: 0, workflowRisks: 0 },
  };
}

// Operational staff keep their own tasks and assigned events, but never receive
// finance/employee/client aggregates merely because they can open /crm.
const fetchOperationalDashboard = cache(async () => {
  const result = { stats: emptyStats(), analytics: emptyAnalytics(), recentActivity: [] as RecentActivityDTO[] };
  const { access } = await fetchDashboardAccess();
  if (!access?.employeeId || access.scope !== 'none') return result;
  const supabase = getDashboardClient();
  const { data: employee, error: employeeError } = await supabase.from('employees')
    .select('role,access_level,permissions').eq('id', access.employeeId).eq('is_active', true).maybeSingle();
  if (employeeError) throw employeeError;
  if (!employee) return result;
  const identities = Array.from(new Set([access.employeeId, access.authUserId].filter((id): id is string => Boolean(id))));
  const idList = identities.join(',');
  const viewEvents = canView(employee, 'events');
  const viewTasks = canView(employee, 'tasks') || canView(employee, 'inquiries');
  const [eventAssignments, taskAssignments] = await Promise.all([
    viewEvents ? supabase.from('employee_assignments').select('event_id').in('employee_id', identities).eq('status', 'accepted') : Promise.resolve({ data: [], error: null }),
    viewTasks ? supabase.from('task_assignees').select('task_id').in('employee_id', identities) : Promise.resolve({ data: [], error: null }),
  ]);
  if (eventAssignments.error) throw eventAssignments.error;
  if (taskAssignments.error) throw taskAssignments.error;
  const eventIds = (eventAssignments.data || []).map((row) => row.event_id).filter(Boolean);
  const taskIds = (taskAssignments.data || []).map((row) => row.task_id).filter(Boolean);
  const eventFilter = [`created_by.in.(${idList})`, ...(eventIds.length ? [`id.in.(${eventIds.join(',')})`] : [])].join(',');
  const taskFilter = [`created_by.in.(${idList})`, `inquiry_owner_id.in.(${idList})`, ...(taskIds.length ? [`id.in.(${taskIds.join(',')})`] : [])].join(',');
  const [eventsResult, tasksResult, offersResult] = await Promise.all([
    viewEvents ? supabase.from('events').select('id,name,event_date,status,created_at').or(eventFilter) : Promise.resolve({ data: [], error: null }),
    viewTasks ? supabase.from('tasks').select('id,title,status,is_inquiry,inquiry_stage,event_id,created_at,due_date,next_action_at').or(taskFilter) : Promise.resolve({ data: [], error: null }),
    canView(employee, 'offers') ? supabase.from('offers').select('id,status,created_at').in('created_by', identities) : Promise.resolve({ data: [], error: null }),
  ]);
  if (eventsResult.error) throw eventsResult.error;
  if (tasksResult.error) throw tasksResult.error;
  if (offersResult.error) throw offersResult.error;
  const events = eventsResult.data || [];
  const tasks = tasksResult.data || [];
  const offers = offersResult.data || [];
  const now = new Date();
  const next30 = new Date(now);
  next30.setDate(next30.getDate() + 30);
  const openTasks = tasks.filter((task) => !['done', 'completed', 'cancelled', 'archived'].includes(task.status));
  const inquiries = tasks.filter((task) => task.is_inquiry);
  result.stats.totalEvents = events.length;
  result.stats.upcomingEvents = events.filter((event) => event.status !== 'cancelled' && new Date(event.event_date) >= now).length;
  result.stats.pendingTasks = openTasks.filter((task) => !task.is_inquiry).length;
  result.stats.openInquiries = inquiries.filter((task) => !['won', 'lost'].includes(task.inquiry_stage || '')).length;
  result.stats.activeOffers = offers.filter((offer) => ['draft', 'sent'].includes(offer.status)).length;
  const buckets = new Map(result.analytics.months.map((month) => [month.key, month]));
  for (const event of events) {
    const bucket = buckets.get(monthKey(event.event_date));
    if (bucket && event.status !== 'cancelled') bucket.events += 1;
  }
  for (const inquiry of inquiries) {
    const bucket = buckets.get(monthKey(inquiry.created_at));
    if (bucket) bucket.inquiries += 1;
  }
  for (const offer of offers) {
    const bucket = buckets.get(monthKey(offer.created_at));
    if (bucket) bucket.offers += 1;
  }
  result.analytics.funnel = {
    inquiries: inquiries.length,
    offers: inquiries.filter((task) => ['proposal', 'negotiation', 'won'].includes(task.inquiry_stage || '')).length,
    acceptedOffers: inquiries.filter((task) => task.inquiry_stage === 'won').length,
    events: inquiries.filter((task) => task.inquiry_stage === 'won' && task.event_id).length,
  };
  result.analytics.attention.overdueTasks = openTasks.filter((task) => !task.is_inquiry && task.due_date && new Date(task.due_date) < now).length;
  result.analytics.attention.overdueInquiries = inquiries.filter((task) => !['won', 'lost'].includes(task.inquiry_stage || '') && task.next_action_at && new Date(task.next_action_at) < now).length;
  result.analytics.attention.eventsNext30Days = events.filter((event) => event.status !== 'cancelled' && new Date(event.event_date) >= now && new Date(event.event_date) <= next30).length;
  result.recentActivity = [
    ...events.map((event) => ({ id: event.id, type: 'event' as const, title: `Wydarzenie: ${event.name}`, created_at: event.created_at, time: new Date(event.created_at).toLocaleDateString('pl-PL'), icon: 'Calendar', color: 'text-[#d3bb73]' })),
    ...tasks.map((task) => ({ id: task.id, type: 'task' as const, title: task.title, created_at: task.created_at, time: new Date(task.created_at).toLocaleDateString('pl-PL'), icon: 'Clock', color: 'text-[#d3bb73]' })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5);
  return result;
});

export async function fetchStatsServer(): Promise<DashboardStats> {
  const { access } = await fetchDashboardAccess();
  if (!access || access.scope === 'sales') return emptyStats();
  if (access.scope === 'none') return (await fetchOperationalDashboard()).stats;
  const supabase = getDashboardClient();

  const nowIso = new Date().toISOString();
  const yearStartIso = `${new Date().getFullYear()}-01-01`;

  // Wszystko na COUNT + head:true => minimalny koszt i brak pobierania danych
  const [
    totalEventsRes,
    upcomingEventsRes,
    totalClientsRes,
    activeEmployeesRes,
    pendingTasksRes,
    openInquiriesRes,
    activeOffersRes,
    equipmentItemsRes,
    paidInvoicesRes,
    overdueInvoicesRes,
    financialReportRes,
  ] = await Promise.all([
    supabase.from('events').select('id', { count: 'exact', head: true }),
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .gte('event_date', nowIso)
      .neq('status', 'cancelled'),
    supabase.from('clients').select('id', { count: 'exact', head: true }),
    supabase.from('employees').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('is_inquiry', false)
      .in('status', ['todo', 'in_progress']),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('is_inquiry', true)
      .in('board_column', ['todo', 'in_progress', 'review']),
    supabase
      .from('offers')
      .select('id', { count: 'exact', head: true })
      .in('status', ['draft', 'sent']),
    supabase.from('equipment_units').select('id', { count: 'exact', head: true }),
    supabase
      .from('invoices')
      .select('total_gross')
      .eq('status', 'paid')
      .eq('is_proforma', false)
      .gte('issue_date', yearStartIso),
    supabase
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'overdue')
      .eq('is_proforma', false),
    supabase.rpc('get_financial_report', {
      p_date_from: yearStartIso,
      p_date_to: new Date().toISOString().slice(0, 10),
      p_company_ids: null,
    }),
  ]);

  // Jeśli RLS blokuje - dostaniesz error i od razu go zobaczysz (zamiast pętli)
  if (totalEventsRes.error) throw totalEventsRes.error;
  if (upcomingEventsRes.error) throw upcomingEventsRes.error;
  if (totalClientsRes.error) throw totalClientsRes.error;
  if (activeEmployeesRes.error) throw activeEmployeesRes.error;
  if (pendingTasksRes.error) throw pendingTasksRes.error;
  if (openInquiriesRes.error) throw openInquiriesRes.error;
  if (activeOffersRes.error) throw activeOffersRes.error;
  if (equipmentItemsRes.error) throw equipmentItemsRes.error;
  if (paidInvoicesRes.error) throw paidInvoicesRes.error;
  if (overdueInvoicesRes.error) throw overdueInvoicesRes.error;

  const legacyPaidRevenue = (paidInvoicesRes.data ?? []).reduce(
    (sum, invoice) => sum + Number(invoice.total_gross ?? 0),
    0,
  );
  const paidRevenue = financialReportRes.error
    ? legacyPaidRevenue
    : Number((financialReportRes.data as any)?.totals?.cash_revenue ?? legacyPaidRevenue);

  return {
    totalEvents: totalEventsRes.count ?? 0,
    upcomingEvents: upcomingEventsRes.count ?? 0,
    openInquiries: openInquiriesRes.count ?? 0,
    activeOffers: activeOffersRes.count ?? 0,
    totalClients: totalClientsRes.count ?? 0,
    activeEmployees: activeEmployeesRes.count ?? 0,
    equipmentItems: equipmentItemsRes.count ?? 0,
    pendingTasks: pendingTasksRes.count ?? 0,
    revenue: paidRevenue,
    overdueInvoices: overdueInvoicesRes.count ?? 0,
  };
}

function monthKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function createMonthBuckets(): DashboardMonth[] {
  const formatter = new Intl.DateTimeFormat('pl-PL', { month: 'short' });
  const now = new Date();

  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1);
    return {
      key: monthKey(date),
      label: formatter.format(date).replace('.', ''),
      inquiries: 0,
      offers: 0,
      events: 0,
      revenue: 0,
      costs: 0,
      margin: 0,
    };
  });
}

export async function fetchDashboardAnalyticsServer(): Promise<DashboardAnalytics> {
  const { access, error: accessError } = await fetchDashboardAccess();
  if (!access) return { ...emptyAnalytics(), accessError };
  if (access.scope === 'none') return (await fetchOperationalDashboard()).analytics;
  const supabase = getDashboardClient();
  if (access.scope === 'sales') {
    const year = new Date().getFullYear();
    const { data, error } = await supabase.rpc('get_my_sales_financial_report', {
      p_date_from: `${year}-01-01`, p_date_to: `${year}-12-31`, p_company_ids: null,
    });
    return {
      ...emptyAnalytics(), scope: 'sales',
      sellerReport: !error && data?.scope === 'own_sales' ? data as SellerFinancialReport : null,
    };
  }
  const months = createMonthBuckets();
  const startIso = `${months[0].key}-01T00:00:00.000Z`;
  const now = new Date();
  const endOfCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const next30Days = new Date(now);
  next30Days.setDate(next30Days.getDate() + 30);

  const [inquiriesRes, offersRes, eventsRes, overdueTasksRes, overdueInquiriesRes, overdueInvoicesRes, nextEventsRes, unownedContactsRes, unownedOrganizationsRes, neglectedInquiriesRes, workflowRisksRes, financialReportRes] =
    await Promise.all([
      supabase
        .from('tasks')
        .select('created_at, inquiry_stage, event_id, next_action_at, last_contact_at')
        .eq('is_inquiry', true)
        .gte('created_at', startIso),
      supabase
        .from('offers')
        .select('created_at, status')
        .gte('created_at', startIso),
      supabase
        .from('events')
        .select('created_at, event_date, status, actual_revenue, actual_costs')
        .gte('event_date', startIso)
        .lte('event_date', endOfCurrentMonth.toISOString()),
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('is_inquiry', false)
        .lt('due_date', now.toISOString())
        .in('status', ['todo', 'in_progress', 'review']),
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('is_inquiry', true)
        .lt('next_action_at', now.toISOString())
        .not('inquiry_stage', 'in', '(won,lost)'),
      supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'overdue')
        .eq('is_proforma', false),
      supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .gte('event_date', now.toISOString())
        .lte('event_date', next30Days.toISOString())
        .neq('status', 'cancelled'),
      supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .is('owner_id', null),
      supabase
        .from('organizations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .is('owner_id', null),
      supabase
        .from('tasks')
        .select('id, created_at, inquiry_stage, next_action_at, last_contact_at')
        .eq('is_inquiry', true)
        .not('inquiry_stage', 'in', '(won,lost)'),
      supabase.rpc('get_event_workflow_attention_count'),
      supabase.rpc('get_financial_report', {
        p_date_from: months[0].key + '-01',
        p_date_to: endOfCurrentMonth.toISOString().slice(0, 10),
        p_company_ids: null,
      }),
    ]);

  if (inquiriesRes.error) throw inquiriesRes.error;
  if (offersRes.error) throw offersRes.error;
  if (eventsRes.error) throw eventsRes.error;
  if (overdueTasksRes.error) throw overdueTasksRes.error;
  if (overdueInquiriesRes.error) throw overdueInquiriesRes.error;
  if (overdueInvoicesRes.error) throw overdueInvoicesRes.error;
  if (nextEventsRes.error) throw nextEventsRes.error;
  if (unownedContactsRes.error) throw unownedContactsRes.error;
  if (unownedOrganizationsRes.error) throw unownedOrganizationsRes.error;
  if (neglectedInquiriesRes.error) throw neglectedInquiriesRes.error;

  const buckets = new Map(months.map((month) => [month.key, month]));

  (inquiriesRes.data ?? []).forEach((item) => {
    const bucket = buckets.get(monthKey(item.created_at));
    if (bucket) bucket.inquiries += 1;
  });

  (offersRes.data ?? []).forEach((item) => {
    const bucket = buckets.get(monthKey(item.created_at));
    if (bucket) bucket.offers += 1;
  });

  (eventsRes.data ?? []).forEach((item) => {
    const bucket = buckets.get(monthKey(item.event_date));
    if (!bucket || item.status === 'cancelled') return;
    bucket.events += 1;
    bucket.revenue += Number(item.actual_revenue ?? 0);
    bucket.costs += Number(item.actual_costs ?? 0);
    bucket.margin = bucket.revenue - bucket.costs;
  });

  if (!financialReportRes.error && Array.isArray((financialReportRes.data as any)?.months)) {
    for (const month of (financialReportRes.data as any).months) {
      const bucket = buckets.get(month.key);
      if (!bucket) continue;
      bucket.revenue = Number(month.cash_revenue ?? 0);
      bucket.costs = Number(month.cash_costs ?? 0);
      bucket.margin = Number(month.cash_result ?? bucket.revenue - bucket.costs);
    }
  }

  const pipelineInquiries = inquiriesRes.data ?? [];
  const offerStages = new Set(['proposal', 'negotiation', 'won']);
  const pipelineOffers = pipelineInquiries.filter((inquiry) =>
    offerStages.has(inquiry.inquiry_stage ?? 'new'),
  ).length;
  const wonInquiries = pipelineInquiries.filter((inquiry) => inquiry.inquiry_stage === 'won');
  const staleThreshold = new Date(now);
  staleThreshold.setDate(staleThreshold.getDate() - 7);
  const neglectedOpportunities = (neglectedInquiriesRes.data ?? []).filter((inquiry) => {
    if (['won', 'lost'].includes(inquiry.inquiry_stage ?? 'new')) return false;
    const lastActivity = inquiry.last_contact_at || inquiry.created_at;
    return !inquiry.next_action_at
      || new Date(inquiry.next_action_at).getTime() < now.getTime()
      || new Date(lastActivity).getTime() < staleThreshold.getTime();
  }).length;

  return {
    scope: 'company',
    months,
    funnel: {
      inquiries: inquiriesRes.data?.length ?? 0,
      offers: pipelineOffers,
      acceptedOffers: wonInquiries.length,
      events: wonInquiries.filter((inquiry) => Boolean(inquiry.event_id)).length,
    },
    attention: {
      overdueTasks: overdueTasksRes.count ?? 0,
      overdueInquiries: overdueInquiriesRes.count ?? 0,
      overdueInvoices: overdueInvoicesRes.count ?? 0,
      eventsNext30Days: nextEventsRes.count ?? 0,
      unownedCustomers: (unownedContactsRes.count ?? 0) + (unownedOrganizationsRes.count ?? 0),
      neglectedOpportunities,
      workflowRisks: workflowRisksRes.error ? 0 : Number(workflowRisksRes.data ?? 0),
    },
  };
}

export async function fetchDashboardPreferencesServer(): Promise<DashboardPreferences> {
  const { access } = await fetchDashboardAccess();
  if (!access?.employeeId || access.scope === 'sales') return {};
  const supabase = getDashboardClient();

  const { data, error } = await supabase
    .from('employees')
    .select('preferences')
    .eq('id', access.employeeId)
    .maybeSingle();

  if (error) throw error;
  return (data?.preferences?.dashboard ?? {}) as DashboardPreferences;
}

export async function fetchRecentActivityServer(): Promise<RecentActivityDTO[]> {
  const { access } = await fetchDashboardAccess();
  if (!access || access.scope === 'sales') return [];
  if (access.scope === 'none') return (await fetchOperationalDashboard()).recentActivity;
  const supabase = getDashboardClient();

  const [eventsRes, clientsRes, tasksRes] = await Promise.all([
    supabase
      .from('events')
      .select('id, name, created_at')
      .order('created_at', { ascending: false })
      .limit(2),
    supabase
      .from('clients')
      .select('id, company_name, first_name, last_name, created_at, client_type')
      .order('created_at', { ascending: false })
      .limit(2),
    supabase
      .from('tasks')
      .select('id, title, created_at')
      .order('created_at', { ascending: false })
      .limit(2),
  ]);

  if (eventsRes.error) throw eventsRes.error;
  if (clientsRes.error) throw clientsRes.error;
  if (tasksRes.error) throw tasksRes.error;

  const activities: RecentActivityDTO[] = [];

  (eventsRes.data ?? []).forEach((e) => {
    activities.push({
      id: e.id,
      type: 'event',
      title: `Nowy event: ${e.name}`,
      created_at: e.created_at,
      time: new Date(e.created_at).toLocaleTimeString(),
      icon:  'Calendar',
      color: 'bg-[#007bff]',
    });
  });

  (clientsRes.data ?? []).forEach((c) => {
    const name =
      c.client_type === 'company'
        ? (c.company_name ?? 'Firma')
        : `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Klient';
    activities.push({
      id: c.id,
      type: 'client',
      title: `Nowy klient: ${name}`,
      created_at: c.created_at,
      time: new Date(c.created_at).toLocaleTimeString(),
      icon: 'Users',
      color: 'bg-[#6c7ae0]',
    });
  });

  (tasksRes.data ?? []).forEach((t) => {
    activities.push({
      id: t.id,
      type: 'task',
      title: `Nowe zadanie: ${t.title}`,
      created_at: t.created_at,
      time: new Date(t.created_at).toLocaleTimeString(),
      icon: 'Clock',
      color: 'bg-[#007bff]',
    });
  });

  // najnowsze pierwsze
  activities.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return activities.slice(0, 5);
}
