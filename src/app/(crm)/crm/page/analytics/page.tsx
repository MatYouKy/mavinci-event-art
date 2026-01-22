'use client';

import { useState, useEffect } from 'react';
import { useGetAnalyticsStatsQuery, useGetOnlineUsersQuery } from '@/store/api/analyticsApi';
import {
  BarChart3,
  TrendingUp,
  Users,
  Clock,
  Mail,
  Globe,
  MonitorSmartphone,
  ExternalLink,
  Activity,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/browser';
import { ResetAnalyticsModal } from '@/components/crm/ResetAnalyticsModal';
import { useSnackbar } from '@/contexts/SnackbarContext';

export default function AnalyticsPage() {
  const [dateRange, setDateRange] = useState(30);
  const [onlineUsers, setOnlineUsers] = useState(0);
  const [customDateMode, setCustomDateMode] = useState(false);
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const { showSnackbar } = useSnackbar();

  const {
    data: stats,
    isLoading,
    error,
  } = useGetAnalyticsStatsQuery({
    dateRange,
    startDate: customDateMode ? customStartDate : undefined,
    endDate: customDateMode ? customEndDate : undefined,
  });
  const { data: initialOnlineUsers } = useGetOnlineUsersQuery();

  useEffect(() => {
    if (initialOnlineUsers !== undefined) {
      setOnlineUsers(initialOnlineUsers);
    }

    const updateCount = async () => {
      await supabase.rpc('cleanup_stale_sessions');

      const { count } = await supabase
        .from('active_sessions')
        .select('*', { count: 'exact', head: true })
        .not('page_url', 'like', '%/crm%');

      setOnlineUsers(count || 0);
    };

    const channel = supabase
      .channel('online-users-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'active_sessions',
        },
        (payload: any) => {
          if (!payload.new.page_url?.includes('/crm')) {
            setOnlineUsers((prev) => prev + 1);
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'active_sessions',
        },
        (payload: any) => {
          if (!payload.old.page_url?.includes('/crm')) {
            setOnlineUsers((prev) => Math.max(0, prev - 1));
          }
        },
      )
      .subscribe();

    const cleanupInterval = setInterval(updateCount, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(cleanupInterval);
    };
  }, [initialOnlineUsers]);

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  let maxVisits = 1;
  if (stats?.dailyVisits && stats.dailyVisits.length > 0) {
    stats.dailyVisits.forEach((d) => {
      if (d.visits > maxVisits) maxVisits = d.visits;
    });
  }

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-light text-[#e5e4e2]">Analytics Dashboard</h1>
            <p className="mt-1 text-[#e5e4e2]/60">Statystyki odwiedzin strony</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setCustomDateMode(false);
                setDateRange(1);
              }}
              className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                !customDateMode && dateRange === 1
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
              }`}
            >
              Dzisiaj
            </button>
            <button
              onClick={() => {
                setCustomDateMode(false);
                setDateRange(7);
              }}
              className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                !customDateMode && dateRange === 7
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
              }`}
            >
              7 dni
            </button>
            <button
              onClick={() => {
                setCustomDateMode(false);
                setDateRange(30);
              }}
              className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                !customDateMode && dateRange === 30
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
              }`}
            >
              30 dni
            </button>
            <button
              onClick={() => {
                setCustomDateMode(false);
                setDateRange(90);
              }}
              className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                !customDateMode && dateRange === 90
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
              }`}
            >
              90 dni
            </button>
            <button
              onClick={() => setCustomDateMode(!customDateMode)}
              className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                customDateMode
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
              }`}
            >
              Zakres dat
            </button>
            <button
              onClick={() => setIsResetModalOpen(true)}
              className="flex items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/20 px-4 py-2 text-sm text-red-300 transition-colors hover:bg-red-500/30"
            >
              <Trash2 className="h-4 w-4" />
              Resetuj statystyki
            </button>
          </div>
        </div>

        {customDateMode && (
          <div className="flex items-end gap-4 rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <div className="flex-1">
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data od</label>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
            <div className="flex-1">
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data do</label>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
            <button
              onClick={() => {
                if (customStartDate && customEndDate) {
                  setDateRange(0);
                }
              }}
              disabled={!customStartDate || !customEndDate}
              className="rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:bg-[#d3bb73]/50"
            >
              Zastosuj
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="py-12 text-center text-[#e5e4e2]/50">Ładowanie danych...</div>
        ) : error ? (
          <div className="py-12 text-center text-red-400">Błąd ładowania danych</div>
        ) : stats ? (
          <>
            <div className="relative mb-6 overflow-hidden rounded-xl border-2 border-[#d3bb73] bg-[#1c1f33] p-6">
              <div className="absolute right-0 top-0 -mr-16 -mt-16 h-32 w-32 rounded-full bg-[#d3bb73]/10" />
              <div className="relative">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-12 w-12 animate-pulse items-center justify-center rounded-full bg-[#d3bb73]">
                    <Activity className="h-6 w-6 text-[#1c1f33]" />
                  </div>
                  <div>
                    <span className="block text-sm text-[#e5e4e2]/60">Online teraz</span>
                    <span className="text-xs text-[#e5e4e2]/40">
                      Heartbeat co 10s • Auto-cleanup 30s
                    </span>
                  </div>
                </div>
                <div className="text-5xl font-light text-[#d3bb73]">{onlineUsers}</div>
                <div className="mt-2 flex items-center gap-2 text-xs text-[#e5e4e2]/40">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" />
                  Realtime WebSocket • Aktualizacja co 5s
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73]/10">
                    <BarChart3 className="h-5 w-5 text-[#d3bb73]" />
                  </div>
                  <span className="text-sm text-[#e5e4e2]/60">Wizyty</span>
                </div>
                <div className="text-3xl font-light text-[#d3bb73]">{stats.totalVisits}</div>
                <div className="mt-1 text-xs text-[#e5e4e2]/40">Ostatnie {dateRange} dni</div>
              </div>

              <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73]/10">
                    <Users className="h-5 w-5 text-[#d3bb73]" />
                  </div>
                  <span className="text-sm text-[#e5e4e2]/60">Unikalni</span>
                </div>
                <div className="text-3xl font-light text-[#d3bb73]">{stats.uniqueVisitors}</div>
                <div className="mt-1 text-xs text-[#e5e4e2]/40">Unikalnych sesji</div>
              </div>

              <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73]/10">
                    <Clock className="h-5 w-5 text-[#d3bb73]" />
                  </div>
                  <span className="text-sm text-[#e5e4e2]/60">Śr. czas</span>
                </div>
                <div className="text-3xl font-light text-[#d3bb73]">
                  {formatTime(stats.avgTimeOnPage)}
                </div>
                <div className="mt-1 text-xs text-[#e5e4e2]/40">Na stronie</div>
              </div>

              <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73]/10">
                    <Mail className="h-5 w-5 text-[#d3bb73]" />
                  </div>
                  <span className="text-sm text-[#e5e4e2]/60">Formularze</span>
                </div>
                <div className="text-3xl font-light text-[#d3bb73]">{stats.contactForms}</div>
                <div className="mt-1 text-xs text-[#e5e4e2]/40">Wysłanych zapytań</div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                <h2 className="mb-4 flex items-center gap-2 text-xl font-light text-[#e5e4e2]">
                  <TrendingUp className="h-5 w-5 text-[#d3bb73]" />
                  Wizyty w czasie
                </h2>
                <div className="space-y-2">
                  {stats.dailyVisits.slice(-14).map((day) => (
                    <div key={day.date} className="flex items-center gap-3">
                      <span className="w-20 text-xs text-[#e5e4e2]/60">
                        {new Date(day.date).toLocaleDateString('pl-PL', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      <div className="relative h-6 flex-1 overflow-hidden rounded-full bg-[#0f1119]">
                        <div
                          className="absolute inset-y-0 left-0 flex items-center justify-end rounded-full bg-gradient-to-r from-[#d3bb73] to-[#d3bb73]/60 pr-2"
                          style={{ width: `${(day.visits / maxVisits) * 100}%` }}
                        >
                          <span className="text-xs font-medium text-[#1c1f33]">{day.visits}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                <h2 className="mb-4 flex items-center gap-2 text-xl font-light text-[#e5e4e2]">
                  <Globe className="h-5 w-5 text-[#d3bb73]" />
                  Źródła ruchu
                </h2>
                <div className="space-y-3">
                  {stats.trafficSources.map((source) => (
                    <div key={source.source} className="flex items-center justify-between">
                      <span className="text-[#e5e4e2]/70">{source.source}</span>
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-32 rounded-full bg-[#0f1119]">
                          <div
                            className="h-full rounded-full bg-[#d3bb73]"
                            style={{ width: `${(source.visits / stats.totalVisits) * 100}%` }}
                          />
                        </div>
                        <span className="w-12 text-right font-medium text-[#d3bb73]">
                          {source.visits}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                <h2 className="mb-4 flex items-center gap-2 text-xl font-light text-[#e5e4e2]">
                  <MonitorSmartphone className="h-5 w-5 text-[#d3bb73]" />
                  Urządzenia
                </h2>
                <div className="space-y-3">
                  {stats.deviceBreakdown.map((device) => (
                    <div key={device.device_type} className="flex items-center justify-between">
                      <span className="capitalize text-[#e5e4e2]/70">{device.device_type}</span>
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-32 rounded-full bg-[#0f1119]">
                          <div
                            className="h-full rounded-full bg-[#d3bb73]"
                            style={{ width: `${device.percentage}%` }}
                          />
                        </div>
                        <span className="w-16 text-right font-medium text-[#d3bb73]">
                          {device.percentage}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {stats.topCities.length > 0 && (
                <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                  <h2 className="mb-4 text-xl font-light text-[#e5e4e2]">
                    Najpopularniejsze miasta
                  </h2>
                  <div className="space-y-3">
                    {stats.topCities.map((city) => (
                      <div key={city.city_interest} className="flex items-center justify-between">
                        <span className="text-[#e5e4e2]/70">{city.city_interest}</span>
                        <span className="font-medium text-[#d3bb73]">
                          {city.submissions} zapytań
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-light text-[#e5e4e2]">Top 10 podstron</h2>
                <Link
                  href="/crm/page"
                  className="flex items-center gap-1 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                >
                  Struktura strony <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#d3bb73]/10">
                      <th className="px-4 py-3 text-left text-sm font-medium text-[#e5e4e2]/60">
                        Strona
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-[#e5e4e2]/60">
                        Wizyty
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-[#e5e4e2]/60">
                        Unikalni
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-[#e5e4e2]/60">
                        Śr. czas
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topPages.map((page) => (
                      <tr
                        key={page.page_url}
                        className="border-b border-[#d3bb73]/5 hover:bg-[#d3bb73]/5"
                      >
                        <td className="px-4 py-3 text-sm text-[#e5e4e2]/70">{page.page_url}</td>
                        <td className="px-4 py-3 text-right font-medium text-[#d3bb73]">
                          {page.visits}
                        </td>
                        <td className="px-4 py-3 text-right text-[#e5e4e2]/70">
                          {page.unique_visitors}
                        </td>
                        <td className="px-4 py-3 text-right text-[#e5e4e2]/70">
                          {formatTime(page.avg_time)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <ResetAnalyticsModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        onSuccess={() => {
          showSnackbar('Statystyki zostały zresetowane pomyślnie', 'success');
          window.location.reload();
        }}
      />
    </div>
  );
}
