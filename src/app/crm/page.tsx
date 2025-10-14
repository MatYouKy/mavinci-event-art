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
      const { data: { session } } = await supabase.auth.getSession();
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

      const [
        eventsResult,
        clientsResult,
        employeesResult,
        tasksResult,
      ] = await Promise.all([
        supabase.from('events').select('id, event_date, status', { count: 'exact' }),
        supabase.from('clients').select('id', { count: 'exact' }),
        supabase.from('employees').select('id, is_active', { count: 'exact' }),
        supabase.from('tasks').select('id, status', { count: 'exact' }),
      ]);

      const now = new Date();
      const upcomingEvents = eventsResult.data?.filter(
        (e) => new Date(e.event_date) >= now && e.status !== 'cancelled'
      ).length || 0;

      const activeEmployees = employeesResult.data?.filter(
        (e) => e.is_active
      ).length || 0;

      const pendingTasks = tasksResult.data?.filter(
        (t) => t.status === 'todo' || t.status === 'in_progress'
      ).length || 0;

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
          const name = client.client_type === 'company'
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

  const statCards = allStatCards.filter(card => {
    if (!employee || !card.module) return true;
    return isAdmin(employee) || canView(employee, card.module);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[#d3bb73] text-lg">Ładowanie dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-light text-[#e5e4e2]">
            Witaj w systemie CRM
          </h2>
          <p className="text-[#e5e4e2]/60 text-sm mt-1">
            Przegląd działalności agencji eventowej Mavinci
          </p>
        </div>
        <Link
          href="/crm/calendar"
          className="bg-[#d3bb73] text-[#1c1f33] px-6 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
        >
          Otwórz kalendarz
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat) => (
          <Link
            key={stat.name}
            href={stat.href}
            className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all duration-200 group"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`${stat.bgColor} p-3 rounded-lg`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[#e5e4e2]/60 text-sm font-light">{stat.name}</p>
              <div className="flex items-baseline gap-2">
                <p className="text-3xl font-light text-[#e5e4e2]">{stat.value}</p>
                {stat.total && (
                  <span className="text-sm text-[#e5e4e2]/40">/ {stat.total}</span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-light text-[#e5e4e2]">
              Ostatnia aktywność
            </h3>
            <Link
              href="/crm/events"
              className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors"
            >
              Zobacz wszystkie
            </Link>
          </div>
          {recentActivity.length === 0 ? (
            <div className="text-center py-8 text-[#e5e4e2]/40">
              Brak aktywności
            </div>
          ) : (
            <div className="space-y-4">
              {recentActivity.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-4 p-4 bg-[#0f1119] rounded-lg hover:bg-[#0f1119]/50 transition-colors"
                >
                  <div className={`${activity.color} mt-1`}>
                    <activity.icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#e5e4e2] font-light">
                      {activity.title}
                    </p>
                    <p className="text-xs text-[#e5e4e2]/40 mt-1">
                      {activity.time}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h3 className="text-lg font-light text-[#e5e4e2] mb-6">
            Szybkie akcje
          </h3>
          <div className="space-y-3">
            <Link
              href="/crm/events"
              className="block w-full bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-3 rounded-lg text-sm font-light hover:bg-[#d3bb73]/20 transition-colors"
            >
              + Nowy event
            </Link>
            <Link
              href="/crm/clients"
              className="block w-full bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-3 rounded-lg text-sm font-light hover:bg-[#d3bb73]/20 transition-colors"
            >
              + Nowy klient
            </Link>
            <Link
              href="/crm/employees"
              className="block w-full bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-3 rounded-lg text-sm font-light hover:bg-[#d3bb73]/20 transition-colors"
            >
              + Nowy pracownik
            </Link>
            <Link
              href="/crm/tasks"
              className="block w-full bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-3 rounded-lg text-sm font-light hover:bg-[#d3bb73]/20 transition-colors"
            >
              + Nowe zadanie
            </Link>
          </div>

          <div className="mt-8 pt-6 border-t border-[#d3bb73]/10">
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle className="w-5 h-5 text-[#d3bb73]" />
              <h4 className="text-sm font-light text-[#e5e4e2]">
                Podsumowanie
              </h4>
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
