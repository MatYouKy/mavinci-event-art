'use client';

import { useState, useEffect } from 'react';
import { useGetAnalyticsStatsQuery, useGetOnlineUsersQuery } from '@/store/api/analyticsApi';
import { BarChart3, TrendingUp, Users, Clock, Mail, Globe, MonitorSmartphone, ExternalLink, Activity } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function AnalyticsPage() {
  const [dateRange, setDateRange] = useState(30);
  const [onlineUsers, setOnlineUsers] = useState(0);

  const { data: stats, isLoading, error } = useGetAnalyticsStatsQuery({ dateRange });
  const { data: initialOnlineUsers } = useGetOnlineUsersQuery();

  useEffect(() => {
    if (initialOnlineUsers !== undefined) {
      setOnlineUsers(initialOnlineUsers);
    }

    const channel = supabase
      .channel('online-users')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'page_analytics',
          filter: 'page_url=not.like.%/crm%',
        },
        async () => {
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          const { data } = await supabase
            .from('page_analytics')
            .select('session_id')
            .gte('created_at', fiveMinutesAgo)
            .not('page_url', 'like', '%/crm%');

          const uniqueSessions = new Set(data?.map(d => d.session_id) || []);
          setOnlineUsers(uniqueSessions.size);
        }
      )
      .subscribe();

    const interval = setInterval(async () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('page_analytics')
        .select('session_id')
        .gte('created_at', fiveMinutesAgo)
        .not('page_url', 'like', '%/crm%');

      const uniqueSessions = new Set(data?.map(d => d.session_id) || []);
      setOnlineUsers(uniqueSessions.size);
    }, 10000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
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
    stats.dailyVisits.forEach(d => {
      if (d.visits > maxVisits) maxVisits = d.visits;
    });
  }

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-light text-[#e5e4e2]">Analytics Dashboard</h1>
            <p className="text-[#e5e4e2]/60 mt-1">Statystyki odwiedzin strony</p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setDateRange(7)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                dateRange === 7
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
              }`}
            >
              7 dni
            </button>
            <button
              onClick={() => setDateRange(30)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                dateRange === 30
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
              }`}
            >
              30 dni
            </button>
            <button
              onClick={() => setDateRange(90)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                dateRange === 90
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#1c1f33] text-[#e5e4e2] hover:bg-[#1c1f33]/80'
              }`}
            >
              90 dni
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-[#e5e4e2]/50">Ładowanie danych...</div>
        ) : error ? (
          <div className="text-center py-12 text-red-400">Błąd ładowania danych</div>
        ) : stats ? (
          <>
            <div className="bg-[#1c1f33] border-2 border-[#d3bb73] rounded-xl p-6 mb-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#d3bb73]/10 rounded-full -mr-16 -mt-16" />
              <div className="relative">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-[#d3bb73] rounded-full flex items-center justify-center animate-pulse">
                    <Activity className="w-6 h-6 text-[#1c1f33]" />
                  </div>
                  <div>
                    <span className="text-sm text-[#e5e4e2]/60 block">Online teraz</span>
                    <span className="text-xs text-[#e5e4e2]/40">Użytkownicy poza CRM (ostatnie 5 min)</span>
                  </div>
                </div>
                <div className="text-5xl font-light text-[#d3bb73]">{onlineUsers}</div>
                <div className="text-xs text-[#e5e4e2]/40 mt-2">
                  Realtime WebSocket • Odświeżanie co 10s
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                    <BarChart3 className="w-5 h-5 text-[#d3bb73]" />
                  </div>
                  <span className="text-sm text-[#e5e4e2]/60">Wizyty</span>
                </div>
                <div className="text-3xl font-light text-[#d3bb73]">{stats.totalVisits}</div>
                <div className="text-xs text-[#e5e4e2]/40 mt-1">Ostatnie {dateRange} dni</div>
              </div>

              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                    <Users className="w-5 h-5 text-[#d3bb73]" />
                  </div>
                  <span className="text-sm text-[#e5e4e2]/60">Unikalni</span>
                </div>
                <div className="text-3xl font-light text-[#d3bb73]">{stats.uniqueVisitors}</div>
                <div className="text-xs text-[#e5e4e2]/40 mt-1">Unikalnych sesji</div>
              </div>

              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                    <Clock className="w-5 h-5 text-[#d3bb73]" />
                  </div>
                  <span className="text-sm text-[#e5e4e2]/60">Śr. czas</span>
                </div>
                <div className="text-3xl font-light text-[#d3bb73]">{formatTime(stats.avgTimeOnPage)}</div>
                <div className="text-xs text-[#e5e4e2]/40 mt-1">Na stronie</div>
              </div>

              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                    <Mail className="w-5 h-5 text-[#d3bb73]" />
                  </div>
                  <span className="text-sm text-[#e5e4e2]/60">Formularze</span>
                </div>
                <div className="text-3xl font-light text-[#d3bb73]">{stats.contactForms}</div>
                <div className="text-xs text-[#e5e4e2]/40 mt-1">Wysłanych zapytań</div>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                <h2 className="text-xl font-light text-[#e5e4e2] mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-[#d3bb73]" />
                  Wizyty w czasie
                </h2>
                <div className="space-y-2">
                  {stats.dailyVisits.slice(-14).map((day) => (
                    <div key={day.date} className="flex items-center gap-3">
                      <span className="text-xs text-[#e5e4e2]/60 w-20">
                        {new Date(day.date).toLocaleDateString('pl-PL', { month: 'short', day: 'numeric' })}
                      </span>
                      <div className="flex-1 bg-[#0f1119] rounded-full h-6 relative overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#d3bb73] to-[#d3bb73]/60 rounded-full flex items-center justify-end pr-2"
                          style={{ width: `${(day.visits / maxVisits) * 100}%` }}
                        >
                          <span className="text-xs font-medium text-[#1c1f33]">{day.visits}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                <h2 className="text-xl font-light text-[#e5e4e2] mb-4 flex items-center gap-2">
                  <Globe className="w-5 h-5 text-[#d3bb73]" />
                  Źródła ruchu
                </h2>
                <div className="space-y-3">
                  {stats.trafficSources.map((source) => (
                    <div key={source.source} className="flex items-center justify-between">
                      <span className="text-[#e5e4e2]/70">{source.source}</span>
                      <div className="flex items-center gap-3">
                        <div className="w-32 bg-[#0f1119] rounded-full h-2">
                          <div
                            className="bg-[#d3bb73] h-full rounded-full"
                            style={{ width: `${(source.visits / stats.totalVisits) * 100}%` }}
                          />
                        </div>
                        <span className="text-[#d3bb73] font-medium w-12 text-right">{source.visits}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                <h2 className="text-xl font-light text-[#e5e4e2] mb-4 flex items-center gap-2">
                  <MonitorSmartphone className="w-5 h-5 text-[#d3bb73]" />
                  Urządzenia
                </h2>
                <div className="space-y-3">
                  {stats.deviceBreakdown.map((device) => (
                    <div key={device.device_type} className="flex items-center justify-between">
                      <span className="text-[#e5e4e2]/70 capitalize">{device.device_type}</span>
                      <div className="flex items-center gap-3">
                        <div className="w-32 bg-[#0f1119] rounded-full h-2">
                          <div
                            className="bg-[#d3bb73] h-full rounded-full"
                            style={{ width: `${device.percentage}%` }}
                          />
                        </div>
                        <span className="text-[#d3bb73] font-medium w-16 text-right">{device.percentage}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {stats.topCities.length > 0 && (
                <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                  <h2 className="text-xl font-light text-[#e5e4e2] mb-4">Najpopularniejsze miasta</h2>
                  <div className="space-y-3">
                    {stats.topCities.map((city) => (
                      <div key={city.city_interest} className="flex items-center justify-between">
                        <span className="text-[#e5e4e2]/70">{city.city_interest}</span>
                        <span className="text-[#d3bb73] font-medium">{city.submissions} zapytań</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-light text-[#e5e4e2]">Top 10 podstron</h2>
                <Link
                  href="/crm/page"
                  className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80 flex items-center gap-1"
                >
                  Struktura strony <ExternalLink className="w-4 h-4" />
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#d3bb73]/10">
                      <th className="text-left py-3 px-4 text-sm font-medium text-[#e5e4e2]/60">Strona</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-[#e5e4e2]/60">Wizyty</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-[#e5e4e2]/60">Unikalni</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-[#e5e4e2]/60">Śr. czas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topPages.map((page) => (
                      <tr key={page.page_url} className="border-b border-[#d3bb73]/5 hover:bg-[#d3bb73]/5">
                        <td className="py-3 px-4 text-[#e5e4e2]/70 text-sm">{page.page_url}</td>
                        <td className="py-3 px-4 text-right text-[#d3bb73] font-medium">{page.visits}</td>
                        <td className="py-3 px-4 text-right text-[#e5e4e2]/70">{page.unique_visitors}</td>
                        <td className="py-3 px-4 text-right text-[#e5e4e2]/70">{formatTime(page.avg_time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
