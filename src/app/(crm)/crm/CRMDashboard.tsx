'use client';

import Link from 'next/link';
import { Calendar, Users, Clock, CheckCircle } from 'lucide-react';
import { canView, isAdmin, type Employee } from '@/lib/permissions';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { RecentActivityDTO } from '@/lib/CRM/dashboard/dashboardData';
import { IEmployee } from './employees/type';

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
}: {
  stats: DashboardStats;
  recentActivity: RecentActivityDTO[];
}) {
  // const { employee } = useCurrentEmployee();
  // console.log(employee);

  const employee: IEmployee = {
    id: '1',
    name: 'John',
    surname: 'Doe',
    email: 'john.doe@example.com',
    nickname: 'john.doe',
    personal_email: 'john.doe@example.com',
    notification_email_preference: 'work',
    phone_number: '1234567890',
    phone_private: '1234567890',
    avatar_url: 'https://example.com/avatar.jpg',
    avatar_metadata: null,
    background_image_url: null,
    background_metadata: null,
    role: 'admin',
    access_level: 'admin',
    access_level_id: '1',
    occupation: 'admin',
    region: 'admin',
    address_street: 'admin',
    address_city: 'admin',
    address_postal_code: 'admin',
    nip: 'admin',
    company_name: 'admin',
    skills: ['admin'],
    qualifications: ['admin'],
    is_active: true,
    notes: 'admin',
    created_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
    permissions: undefined,
    show_on_website: false,
    website_bio: '',
    linkedin_url: '',
    instagram_url: '',
    facebook_url: '',
    order_index: 0,
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

  // if (loading) {
  //   return (
  //     <div className="flex items-center justify-center p-8">
  //       <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
  //     </div>
  //   );
  // }

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
