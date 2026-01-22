'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Calendar, FileText, Users, TrendingUp, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

export default function SellerDashboard() {
  const [stats, setStats] = useState({
    myOffers: 0,
    pendingOffers: 0,
    acceptedOffers: 0,
    monthRevenue: 0,
  });
  const [salesperson, setSalesperson] = useState<any>(null);
  const [recentOffers, setRecentOffers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: salesData } = await supabase
        .from('salespeople')
        .select('*')
        .eq('auth_user_id', user.id)
        .single();

      if (salesData) {
        setSalesperson(salesData);

        const { data: offersData, count } = await supabase
          .from('offers')
          .select('*, clients(company_name, first_name, last_name)', { count: 'exact' })
          .eq('salesperson_id', salesData.id)
          .order('created_at', { ascending: false })
          .limit(5);

        if (offersData) {
          setRecentOffers(offersData);

          const pending = offersData.filter(
            (o) => o.status === 'draft' || o.status === 'sent',
          ).length;
          const accepted = offersData.filter((o) => o.status === 'accepted').length;

          const revenue = offersData
            .filter((o) => o.status === 'accepted')
            .reduce((sum, o) => sum + (parseFloat(o.total_final_price) || 0), 0);

          setStats({
            myOffers: count || 0,
            pendingOffers: pending,
            acceptedOffers: accepted,
            monthRevenue: revenue,
          });
        }
      }
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      draft: 'Roboczy',
      sent: 'Wysłana',
      viewed: 'Wyświetlona',
      accepted: 'Zaakceptowana',
      rejected: 'Odrzucona',
      expired: 'Wygasła',
    };
    return labels[status] || status;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'text-gray-400',
      sent: 'text-blue-400',
      viewed: 'text-cyan-400',
      accepted: 'text-green-400',
      rejected: 'text-red-400',
      expired: 'text-gray-500',
    };
    return colors[status] || 'text-gray-400';
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
        <div className="text-[#d3bb73]">Ładowanie...</div>
      </div>
    );
  }

  if (!salesperson) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119] p-6">
        <div className="max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-8 text-center">
          <h2 className="mb-4 text-xl text-[#e5e4e2]">Brak dostępu</h2>
          <p className="mb-6 text-[#e5e4e2]/60">
            Twoje konto nie jest powiązane ze sprzedawcą. Skontaktuj się z administratorem.
          </p>
          <Link
            href="/crm"
            className="inline-block rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
          >
            Wróć do CRM
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-light text-[#e5e4e2]">Witaj, {salesperson.first_name}!</h1>
            <p className="mt-1 text-[#e5e4e2]/60">Panel sprzedawcy - Twoje oferty i kalendarz</p>
          </div>
          <Link
            href="/seller/offers/new"
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-5 w-5" />
            Nowa oferta
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-lg bg-blue-400/10 p-3">
                <FileText className="h-6 w-6 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-[#e5e4e2]/60">Wszystkie oferty</p>
                <p className="text-2xl font-light text-[#e5e4e2]">{stats.myOffers}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-lg bg-orange-400/10 p-3">
                <Calendar className="h-6 w-6 text-orange-400" />
              </div>
              <div>
                <p className="text-sm text-[#e5e4e2]/60">Oczekujące</p>
                <p className="text-2xl font-light text-[#e5e4e2]">{stats.pendingOffers}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-lg bg-green-400/10 p-3">
                <Users className="h-6 w-6 text-green-400" />
              </div>
              <div>
                <p className="text-sm text-[#e5e4e2]/60">Zaakceptowane</p>
                <p className="text-2xl font-light text-[#e5e4e2]">{stats.acceptedOffers}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-lg bg-[#d3bb73]/10 p-3">
                <TrendingUp className="h-6 w-6 text-[#d3bb73]" />
              </div>
              <div>
                <p className="text-sm text-[#e5e4e2]/60">Przychód</p>
                <p className="text-2xl font-light text-[#d3bb73]">
                  {stats.monthRevenue.toLocaleString('pl-PL')} zł
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 lg:col-span-2">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-light text-[#e5e4e2]">Ostatnie oferty</h2>
              <Link
                href="/seller/offers"
                className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
              >
                Zobacz wszystkie
              </Link>
            </div>

            {recentOffers.length === 0 ? (
              <div className="py-8 text-center text-[#e5e4e2]/40">Brak ofert. Utwórz pierwszą!</div>
            ) : (
              <div className="space-y-3">
                {recentOffers.map((offer) => (
                  <Link
                    key={offer.id}
                    href={`/seller/offers/${offer.id}`}
                    className="block rounded-lg bg-[#0f1119] p-4 transition-colors hover:bg-[#0f1119]/50"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-medium text-[#e5e4e2]">
                          {offer.title || offer.offer_number}
                        </p>
                        <p className="mt-1 text-sm text-[#e5e4e2]/60">
                          {offer.clients?.company_name ||
                            `${offer.clients?.first_name} ${offer.clients?.last_name}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-medium ${getStatusColor(offer.status)}`}>
                          {getStatusLabel(offer.status)}
                        </p>
                        <p className="mt-1 text-sm text-[#e5e4e2]/60">
                          {(offer.total_final_price || 0).toLocaleString('pl-PL')} zł
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h2 className="mb-6 text-lg font-light text-[#e5e4e2]">Szybkie akcje</h2>
            <div className="space-y-3">
              <Link
                href="/seller/offers/new"
                className="block w-full rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-3 text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
              >
                + Nowa oferta
              </Link>
              <Link
                href="/seller/calendar"
                className="block w-full rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-3 text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
              >
                📅 Mój kalendarz
              </Link>
              <Link
                href="/seller/clients"
                className="block w-full rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-3 text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
              >
                👥 Klienci
              </Link>
              <Link
                href="/seller/attractions"
                className="block w-full rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-3 text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
              >
                🎭 Katalog atrakcji
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
