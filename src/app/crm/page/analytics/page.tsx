'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useGetPageStatsQuery } from '@/store/api/analyticsApi';
import { ArrowLeft, BarChart3, Users, Clock, TrendUp, Globe, MonitorSmartphone, Mail } from 'lucide-react';
import Link from 'next/link';

function PageAnalyticsContent() {
  const searchParams = useSearchParams();
  const pageUrl = searchParams?.get('url') || '/';
  const [dateRange, setDateRange] = useState(30);

  const { data: stats, isLoading, error } = useGetPageStatsQuery({ pageUrl, dateRange });

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const maxVisits = stats?.daily_visits && stats.daily_visits.length > 0
    ? Math.max.apply(null, stats.daily_visits.map(d => d.visits))
    : 1;

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <Link
            href="/crm/page"
            className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Powrót do listy stron
          </Link>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-light text-[#e5e4e2]">Analityka podstrony</h1>
              <p className="text-[#e5e4e2]/60 mt-1">{pageUrl}</p>
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
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-[#e5e4e2]/50">Ładowanie danych...</div>
        ) : error ? (
          <div className="text-center py-12 text-red-400">Błąd ładowania danych</div>
        ) : stats ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                    <BarChart3 className="w-5 h-5 text-[#d3bb73]" />
                  </div>
                  <span className="text-sm text-[#e5e4e2]/60">Wizyty</span>
                </div>
                <div className="text-3xl font-light text-[#d3bb73]">{stats.visits}</div>
                <div className="text-xs text-[#e5e4e2]/40 mt-1">Ostatnie {dateRange} dni</div>
              </div>

              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                    <Users className="w-5 h-5 text-[#d3bb73]" />
                  </div>
                  <span className="text-sm text-[#e5e4e2]/60">Unikalni</span>
                </div>
                <div className="text-3xl font-light text-[#d3bb73]">{stats.unique_visitors}</div>
                <div className="text-xs text-[#e5e4e2]/40 mt-1">Unikalnych odwiedzających</div>
              </div>

              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                    <Clock className="w-5 h-5 text-[#d3bb73]" />
                  </div>
                  <span className="text-sm text-[#e5e4e2]/60">Śr. czas</span>
                </div>
                <div className="text-3xl font-light text-[#d3bb73]">{formatTime(stats.avg_time)}</div>
                <div className="text-xs text-[#e5e4e2]/40 mt-1">Średni czas na stronie</div>
              </div>

              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                    <TrendUp className="w-5 h-5 text-[#d3bb73]" />
                  </div>
                  <span className="text-sm text-[#e5e4e2]/60">Konwersja</span>
                </div>
                <div className="text-3xl font-light text-[#d3bb73]">{stats.conversion_rate}%</div>
                <div className="text-xs text-[#e5e4e2]/40 mt-1">Współczynnik konwersji</div>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                <h2 className="text-xl font-light text-[#e5e4e2] mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-[#d3bb73]" />
                  Wizyty w czasie
                </h2>
                <div className="space-y-2">
                  {stats.daily_visits.slice(-14).map((day) => (
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
                  {stats.top_referrers.map((ref) => (
                    <div key={ref.referrer} className="flex items-center justify-between">
                      <span className="text-[#e5e4e2]/70 text-sm truncate max-w-[200px]">
                        {ref.referrer === 'Direct' ? 'Bezpośrednie' : ref.referrer}
                      </span>
                      <span className="text-[#d3bb73] font-medium">{ref.count}</span>
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
                  {stats.device_breakdown.map((device) => (
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

              <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                <h2 className="text-xl font-light text-[#e5e4e2] mb-4 flex items-center gap-2">
                  <Mail className="w-5 h-5 text-[#d3bb73]" />
                  Formularze kontaktowe
                </h2>
                {stats.contact_forms.length > 0 ? (
                  <div className="space-y-2">
                    {stats.contact_forms.slice(0, 5).map((form) => (
                      <div key={form.id} className="text-sm text-[#e5e4e2]/70 py-2 border-b border-[#d3bb73]/10 last:border-0">
                        <div className="flex justify-between">
                          <span className="font-medium text-[#e5e4e2]">{form.name}</span>
                          <span className="text-xs text-[#e5e4e2]/50">
                            {new Date(form.created_at).toLocaleDateString('pl-PL')}
                          </span>
                        </div>
                        {form.city_interest && (
                          <div className="text-xs text-[#d3bb73] mt-1">{form.city_interest}</div>
                        )}
                      </div>
                    ))}
                    {stats.contact_forms.length > 5 && (
                      <p className="text-xs text-center text-[#e5e4e2]/40 mt-3">
                        + {stats.contact_forms.length - 5} więcej
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[#e5e4e2]/50 text-sm">Brak formularzy z tej strony</p>
                )}
              </div>
            </div>

            <div className="bg-[#1c1f33]/60 border border-[#d3bb73]/10 rounded-xl p-6">
              <h2 className="text-lg font-light text-[#e5e4e2] mb-4">Metryki wydajności</h2>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <div className="text-sm text-[#e5e4e2]/60 mb-1">Bounce Rate</div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-[#0f1119] rounded-full h-2">
                      <div
                        className="bg-[#d3bb73] h-full rounded-full"
                        style={{ width: `${stats.bounce_rate}%` }}
                      />
                    </div>
                    <span className="text-[#d3bb73] font-medium">{stats.bounce_rate}%</span>
                  </div>
                  <p className="text-xs text-[#e5e4e2]/40 mt-1">
                    Procent odwiedzin trwających krócej niż 10s
                  </p>
                </div>

                <div>
                  <div className="text-sm text-[#e5e4e2]/60 mb-1">Conversion Rate</div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-[#0f1119] rounded-full h-2">
                      <div
                        className="bg-[#d3bb73] h-full rounded-full"
                        style={{ width: `${Math.min(stats.conversion_rate * 10, 100)}%` }}
                      />
                    </div>
                    <span className="text-[#d3bb73] font-medium">{stats.conversion_rate}%</span>
                  </div>
                  <p className="text-xs text-[#e5e4e2]/40 mt-1">
                    Procent odwiedzających którzy wysłali formularz
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function PageAnalyticsDetailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0f1119] p-6 flex items-center justify-center text-[#e5e4e2]/50">Ładowanie...</div>}>
      <PageAnalyticsContent />
    </Suspense>
  );
}
