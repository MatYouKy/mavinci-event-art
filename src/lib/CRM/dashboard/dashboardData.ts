import 'server-only';
import { cookies } from 'next/headers';
import { CookieStoreLike, createSupabaseServerClient } from '@/lib/supabase/server.app';
import type { DashboardPreferences } from './dashboardConfig';

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

export async function fetchStatsServer(): Promise<DashboardStats> {
  const supabase = createSupabaseServerClient(getCookieStore());

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

  const paidRevenue = (paidInvoicesRes.data ?? []).reduce(
    (sum, invoice) => sum + Number(invoice.total_gross ?? 0),
    0,
  );

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
  const supabase = createSupabaseServerClient(getCookieStore());
  const months = createMonthBuckets();
  const startIso = `${months[0].key}-01T00:00:00.000Z`;
  const now = new Date();
  const endOfCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const next30Days = new Date(now);
  next30Days.setDate(next30Days.getDate() + 30);

  const [inquiriesRes, offersRes, eventsRes, overdueTasksRes, overdueInquiriesRes, overdueInvoicesRes, nextEventsRes, unownedContactsRes, unownedOrganizationsRes, neglectedInquiriesRes, workflowRisksRes] =
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
  const supabase = createSupabaseServerClient(getCookieStore());
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) return {};

  const { data, error } = await supabase
    .from('employees')
    .select('preferences')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (error) throw error;
  return (data?.preferences?.dashboard ?? {}) as DashboardPreferences;
}

export async function fetchRecentActivityServer(): Promise<RecentActivityDTO[]> {
  const supabase = createSupabaseServerClient(getCookieStore());

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
