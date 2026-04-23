/* eslint-disable @next/next/no-assign-module-variable */
'use client';

import Link from 'next/link';
import { Calendar, Users, Clock, CheckCircle } from 'lucide-react';
import { canView, canCreate, isAdmin, type Employee } from '@/lib/permissions';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { RecentActivityDTO } from '@/lib/CRM/dashboard/dashboardData';
import { IEmployee } from './employees/type';
import { useRouter } from 'next/navigation';

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
  const { employee, loading } = useCurrentEmployee();
  const router = useRouter();
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-light text-[#e5e4e2]">Witaj w systemie CRM</h2>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Przegląd działalności agencji eventowej Mavinci
          </p>
        </div>
        {canView(employee, 'calendar') && (
          <Link
            href="/crm/calendar"
            className="rounded-lg bg-[#d3bb73] px-6 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            Otwórz kalendarz
          </Link>
        )}
      </div>

      {statCards.length > 0 && (
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
      )}

      <div className="grid gap-6 lg:grid-cols-3">
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
      </div>
    </div>
  );
}
