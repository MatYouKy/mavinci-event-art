'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Users,
  Package,
  FileText,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { canView, isAdmin, type Employee } from '@/lib/permissions';

interface DashboardStats {
  totalEvents: number;
  upcomingEvents: number;
  activeOffers: number;
  totalClients: number;
  activeEmployees: number;
  equipmentItems: number;
  pendingTasks: number;
  revenue: number;
}

interface RecentActivity {
  id: string;
  type: 'event' | 'client' | 'task' | 'offer';
  title: string;
  time: string;
  icon: any;
  color: string;
}

export default function CRMDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalEvents: 0,
    upcomingEvents: 0,
    activeOffers: 0,
    totalClients: 0,
    activeEmployees: 0,
    equipmentItems: 0,
    pendingTasks: 0,
    revenue: 0,
  });
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState<Employee | null>(null);

  useEffect(() => {
    fetchEmployee();
    fetchStats();
    fetchRecentActivity();
  }, []);

  const fetchEmployee = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const { data } = await supabase
        .from('employees')
        .select('id, role, access_level, permissions')
        .eq('email', session.user.email)
        .maybeSingle();

      if (data) {
        setEmployee(data);
      }
    } catch (error) {
      console.error('Error fetching employee:', error);
    }
  };

  const fetchStats = async () => {
    try {
      setLoading(true);

      const [eventsResult, clientsResult, employeesResult, tasksResult] = await Promise.all([
        supabase.from('events').select('id, event_date, status', { count: 'exact' }),
        supabase.from('clients').select('id', { count: 'exact' }),
        supabase.from('employees').select('id, is_active', { count: 'exact' }),
        supabase.from('tasks').select('id, status', { count: 'exact' }),
      ]);

      const now = new Date();
      const upcomingEvents =
        eventsResult.data?.filter((e) => new Date(e.event_date) >= now && e.status !== 'cancelled')
          .length || 0;

      const activeEmployees = employeesResult.data?.filter((e) => e.is_active).length || 0;

      const pendingTasks =
        tasksResult.data?.filter((t) => t.status === 'todo' || t.status === 'in_progress').length ||
        0;

      setStats({
        totalEvents: eventsResult.count || 0,
        upcomingEvents,
        activeOffers: 0,
        totalClients: clientsResult.count || 0,
        activeEmployees,
        equipmentItems: 0,
        pendingTasks,
        revenue: 0,
      });
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRecentActivity = async () => {
    try {
      const activities: RecentActivity[] = [];

      const { data: recentEvents } = await supabase
        .from('events')
        .select('id, name, created_at')
        .order('created_at', { ascending: false })
        .limit(2);

      const { data: recentClients } = await supabase
        .from('clients')
        .select('id, company_name, first_name, last_name, created_at, client_type')
        .order('created_at', { ascending: false })
        .limit(2);

      const { data: recentTasks } = await supabase
        .from('tasks')
        .select('id, title, created_at')
        .order('created_at', { ascending: false })
        .limit(2);

      if (recentEvents) {
        recentEvents.forEach((event) => {
          activities.push({
            id: event.id,
            type: 'event',
            title: `Nowy event: ${event.name}`,
            time: getTimeAgo(event.created_at),
            icon: Calendar,
            color: 'text-blue-400',
          });
        });
      }

      if (recentClients) {
        recentClients.forEach((client) => {
          const name =
            client.client_type === 'company'
              ? client.company_name
              : `${client.first_name} ${client.last_name}`;
          activities.push({
            id: client.id,
            type: 'client',
            title: `Nowy klient: ${name}`,
            time: getTimeAgo(client.created_at),
            icon: Users,
            color: 'text-purple-400',
          });
        });
      }

      if (recentTasks) {
        recentTasks.forEach((task) => {
          activities.push({
            id: task.id,
            type: 'task',
            title: `Nowe zadanie: ${task.title}`,
            time: getTimeAgo(task.created_at),
            icon: AlertCircle,
            color: 'text-orange-400',
          });
        });
      }

      activities.sort((a, b) => {
        const timeA = parseTimeAgo(a.time);
        const timeB = parseTimeAgo(b.time);
        return timeA - timeB;
      });

      setRecentActivity(activities.slice(0, 5));
    } catch (err) {
      console.error('Error fetching recent activity:', err);
    }
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
      name: 'Nadchodzące eventy',
      value: stats.upcomingEvents,
      total: stats.totalEvents,
      icon: Calendar,
      color: 'text-blue-400',
      bgColor: 'bg-blue-400/10',
      href: '/crm/events',
      module: 'events',
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
  ];

  const statCards = allStatCards.filter((card) => {
    if (!employee || !card.module) return true;
    return isAdmin(employee) || canView(employee, card.module);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-light text-[#e5e4e2]">Witaj w systemie CRM</h2>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Przegląd działalności agencji eventowej Mavinci
          </p>
        </div>
        <Link
          href="/crm/calendar"
          className="rounded-lg bg-[#d3bb73] px-6 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
        >
          Otwórz kalendarz
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Link
            key={stat.name}
            href={stat.href}
            className="group rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 transition-all duration-200 hover:border-[#d3bb73]/30"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className={`${stat.bgColor} rounded-lg p-3`}>
                <stat.icon className={`h-6 w-6 ${stat.color}`} />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-light text-[#e5e4e2]/60">{stat.name}</p>
              <div className="flex items-baseline gap-2">
                <p className="text-3xl font-light text-[#e5e4e2]">{stat.value}</p>
                {stat.total && <span className="text-sm text-[#e5e4e2]/40">/ {stat.total}</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 lg:col-span-2">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-lg font-light text-[#e5e4e2]">Ostatnia aktywność</h3>
            <Link
              href="/crm/events"
              className="text-sm text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80"
            >
              Zobacz wszystkie
            </Link>
          </div>
          {recentActivity.length === 0 ? (
            <div className="py-8 text-center text-[#e5e4e2]/40">Brak aktywności</div>
          ) : (
            <div className="space-y-4">
              {recentActivity.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-4 rounded-lg bg-[#0f1119] p-4 transition-colors hover:bg-[#0f1119]/50"
                >
                  <div className={`${activity.color} mt-1`}>
                    <activity.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-light text-[#e5e4e2]">{activity.title}</p>
                    <p className="mt-1 text-xs text-[#e5e4e2]/40">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h3 className="mb-6 text-lg font-light text-[#e5e4e2]">Szybkie akcje</h3>
          <div className="space-y-3">
            <Link
              href="/crm/events"
              className="block w-full rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-3 text-sm font-light text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
            >
              + Nowy event
            </Link>
            <Link
              href="/crm/clients"
              className="block w-full rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-3 text-sm font-light text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
            >
              + Nowy klient
            </Link>
            <Link
              href="/crm/employees"
              className="block w-full rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-3 text-sm font-light text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
            >
              + Nowy pracownik
            </Link>
            <Link
              href="/crm/tasks"
              className="block w-full rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-3 text-sm font-light text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
            >
              + Nowe zadanie
            </Link>
          </div>

          <div className="mt-8 border-t border-[#d3bb73]/10 pt-6">
            <div className="mb-4 flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-[#d3bb73]" />
              <h4 className="text-sm font-light text-[#e5e4e2]">Podsumowanie</h4>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[#e5e4e2]/60">Wszystkie eventy</span>
                <span className="text-[#e5e4e2]">{stats.totalEvents}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#e5e4e2]/60">Aktywni pracownicy</span>
                <span className="text-[#e5e4e2]">{stats.activeEmployees}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#e5e4e2]/60">Baza klientów</span>
                <span className="text-[#e5e4e2]">{stats.totalClients}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
