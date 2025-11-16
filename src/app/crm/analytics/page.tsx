'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { BarChart3, TrendingUp, Users, Clock, Mail, Globe, MonitorSmartphone, ExternalLink } from 'lucide-react';
import Link from 'next/link';

interface AnalyticsStats {
  totalVisits: number;
  uniqueVisitors: number;
  avgTimeOnPage: number;
  contactForms: number;
  topPages: Array<{
    page_url: string;
    visits: number;
    unique_visitors: number;
    avg_time: number;
  }>;
  trafficSources: Array<{
    source: string;
    visits: number;
  }>;
  deviceBreakdown: Array<{
    device_type: string;
    visits: number;
    percentage: number;
  }>;
  topCities: Array<{
    city_interest: string;
    submissions: number;
  }>;
  dailyVisits: Array<{
    date: string;
    visits: number;
  }>;
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<AnalyticsStats>({
    totalVisits: 0,
    uniqueVisitors: 0,
    avgTimeOnPage: 0,
    contactForms: 0,
    topPages: [],
    trafficSources: [],
    deviceBreakdown: [],
    topCities: [],
    dailyVisits: [],
  });

  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState(30);

  useEffect(() => {
    fetchAnalytics();
  }, [dateRange]);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - dateRange);

      const { data: analytics } = await supabase
        .from('page_analytics')
        .select('*')
        .gte('created_at', startDate.toISOString());

      const { data: forms } = await supabase
        .from('contact_form_submissions')
        .select('*')
        .gte('created_at', startDate.toISOString());

      if (analytics) {
        const uniqueVisitors = new Set(analytics.map(a => a.session_id)).size;
        const avgTime = analytics
          .filter(a => a.time_on_page > 0)
          .reduce((acc, a) => acc + a.time_on_page, 0) /
          (analytics.filter(a => a.time_on_page > 0).length || 1);

        const pageStats = analytics.reduce((acc: any, curr) => {
          if (!acc[curr.page_url]) {
            acc[curr.page_url] = { visits: 0, sessions: new Set(), totalTime: 0, timeCount: 0 };
          }
          acc[curr.page_url].visits++;
          acc[curr.page_url].sessions.add(curr.session_id);
          if (curr.time_on_page > 0) {
            acc[curr.page_url].totalTime += curr.time_on_page;
            acc[curr.page_url].timeCount++;
          }
          return acc;
        }, {});

        const topPages = Object.entries(pageStats)
          .map(([url, data]: [string, any]) => ({
            page_url: url,
            visits: data.visits,
            unique_visitors: data.sessions.size,
            avg_time: data.timeCount > 0 ? Math.round(data.totalTime / data.timeCount) : 0,
          }))
          .sort((a, b) => b.visits - a.visits)
          .slice(0, 10);

        const sourceStats = analytics.reduce((acc: any, curr) => {
          let source = 'Direct';
          if (curr.referrer?.includes('google')) source = 'Google';
          else if (curr.referrer?.includes('facebook')) source = 'Facebook';
          else if (curr.referrer?.includes('linkedin')) source = 'LinkedIn';
          else if (curr.referrer && curr.referrer !== '') source = 'Other';

          acc[source] = (acc[source] || 0) + 1;
          return acc;
        }, {});

        const trafficSources = Object.entries(sourceStats)
          .map(([source, visits]) => ({ source, visits: visits as number }))
          .sort((a, b) => b.visits - a.visits);

        const deviceStats = analytics.reduce((acc: any, curr) => {
          const device = curr.device_type || 'unknown';
          acc[device] = (acc[device] || 0) + 1;
          return acc;
        }, {});

        const totalDevices = analytics.length;
        const deviceBreakdown = Object.entries(deviceStats)
          .map(([device_type, visits]) => ({
            device_type,
            visits: visits as number,
            percentage: Math.round(((visits as number) / totalDevices) * 100),
          }))
          .sort((a, b) => b.visits - a.visits);

        const dailyStats = analytics.reduce((acc: any, curr) => {
          const date = new Date(curr.created_at).toISOString().split('T')[0];
          acc[date] = (acc[date] || 0) + 1;
          return acc;
        }, {});

        const dailyVisits = Object.entries(dailyStats)
          .map(([date, visits]) => ({ date, visits: visits as number }))
          .sort((a, b) => a.date.localeCompare(b.date));

        setStats({
          totalVisits: analytics.length,
          uniqueVisitors,
          avgTimeOnPage: Math.round(avgTime),
          contactForms: forms?.length || 0,
          topPages,
          trafficSources,
          deviceBreakdown,
          topCities: [],
          dailyVisits,
        });
      }

      if (forms) {
        const cityStats = forms.reduce((acc: any, curr) => {
          if (curr.city_interest) {
            acc[curr.city_interest] = (acc[curr.city_interest] || 0) + 1;
          }
          return acc;
        }, {});

        const topCities = Object.entries(cityStats)
          .map(([city_interest, submissions]) => ({ city_interest, submissions: submissions as number }))
          .sort((a, b) => b.submissions - a.submissions)
          .slice(0, 5);

        setStats(prev => ({ ...prev, topCities }));
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const maxVisits = Math.max(...stats.dailyVisits.map(d => d.visits), 1);

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

        {loading ? (
          <div className="text-center py-12 text-[#e5e4e2]/50">Ładowanie danych...</div>
        ) : (
          <>
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
                  Zarządzaj stroną <ExternalLink className="w-4 h-4" />
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
                      <th className="text-center py-3 px-4 text-sm font-medium text-[#e5e4e2]/60">Akcje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topPages.map((page) => (
                      <tr key={page.page_url} className="border-b border-[#d3bb73]/5 hover:bg-[#d3bb73]/5">
                        <td className="py-3 px-4 text-[#e5e4e2]/70 text-sm">{page.page_url}</td>
                        <td className="py-3 px-4 text-right text-[#d3bb73] font-medium">{page.visits}</td>
                        <td className="py-3 px-4 text-right text-[#e5e4e2]/70">{page.unique_visitors}</td>
                        <td className="py-3 px-4 text-right text-[#e5e4e2]/70">{formatTime(page.avg_time)}</td>
                        <td className="py-3 px-4 text-center">
                          <Link
                            href={`/crm/page/analytics?url=${encodeURIComponent(page.page_url)}`}
                            className="text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
                          >
                            Szczegóły →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
