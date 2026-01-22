import 'server-only';
import { cookies } from 'next/headers';
import { CookieStoreLike, createSupabaseServerClient } from '@/lib/supabase/server.app';

export type DashboardStats = {
  totalEvents: number;
  upcomingEvents: number;
  activeOffers: number;
  totalClients: number;
  activeEmployees: number;
  equipmentItems: number;
  pendingTasks: number;
  revenue: number;
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

  // Wszystko na COUNT + head:true => minimalny koszt i brak pobierania danych
  const [
    totalEventsRes,
    upcomingEventsRes,
    totalClientsRes,
    activeEmployeesRes,
    pendingTasksRes,
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
      .in('status', ['todo', 'in_progress']),
  ]);

  // Jeśli RLS blokuje - dostaniesz error i od razu go zobaczysz (zamiast pętli)
  if (totalEventsRes.error) throw totalEventsRes.error;
  if (upcomingEventsRes.error) throw upcomingEventsRes.error;
  if (totalClientsRes.error) throw totalClientsRes.error;
  if (activeEmployeesRes.error) throw activeEmployeesRes.error;
  if (pendingTasksRes.error) throw pendingTasksRes.error;

  return {
    totalEvents: totalEventsRes.count ?? 0,
    upcomingEvents: upcomingEventsRes.count ?? 0,
    activeOffers: 0,
    totalClients: totalClientsRes.count ?? 0,
    activeEmployees: activeEmployeesRes.count ?? 0,
    equipmentItems: 0,
    pendingTasks: pendingTasksRes.count ?? 0,
    revenue: 0,
  };
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