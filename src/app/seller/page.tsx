'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Calendar, FileText, Users, TrendingUp, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';

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
      const { data: { user } } = await supabase.auth.getUser();
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

          const pending = offersData.filter(o => o.status === 'draft' || o.status === 'sent').length;
          const accepted = offersData.filter(o => o.status === 'accepted').length;

          const revenue = offersData
            .filter(o => o.status === 'accepted')
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
      <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
        <div className="text-[#d3bb73]">Ładowanie...</div>
      </div>
    );
  }

  if (!salesperson) {
    return (
      <div className="min-h-screen bg-[#0f1119] flex items-center justify-center p-6">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-8 max-w-md text-center">
          <h2 className="text-xl text-[#e5e4e2] mb-4">Brak dostępu</h2>
          <p className="text-[#e5e4e2]/60 mb-6">
            Twoje konto nie jest powiązane ze sprzedawcą. Skontaktuj się z administratorem.
          </p>
          <Link
            href="/crm"
            className="inline-block px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
          >
            Wróć do CRM
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-light text-[#e5e4e2]">
              Witaj, {salesperson.first_name}!
            </h1>
            <p className="text-[#e5e4e2]/60 mt-1">
              Panel sprzedawcy - Twoje oferty i kalendarz
            </p>
          </div>
          <Link
            href="/seller/offers/new"
            className="flex items-center gap-2 px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Nowa oferta
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-blue-400/10 rounded-lg">
                <FileText className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <p className="text-[#e5e4e2]/60 text-sm">Wszystkie oferty</p>
                <p className="text-2xl font-light text-[#e5e4e2]">{stats.myOffers}</p>
              </div>
            </div>
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-orange-400/10 rounded-lg">
                <Calendar className="w-6 h-6 text-orange-400" />
              </div>
              <div>
                <p className="text-[#e5e4e2]/60 text-sm">Oczekujące</p>
                <p className="text-2xl font-light text-[#e5e4e2]">{stats.pendingOffers}</p>
              </div>
            </div>
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-green-400/10 rounded-lg">
                <Users className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <p className="text-[#e5e4e2]/60 text-sm">Zaakceptowane</p>
                <p className="text-2xl font-light text-[#e5e4e2]">{stats.acceptedOffers}</p>
              </div>
            </div>
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-[#d3bb73]/10 rounded-lg">
                <TrendingUp className="w-6 h-6 text-[#d3bb73]" />
              </div>
              <div>
                <p className="text-[#e5e4e2]/60 text-sm">Przychód</p>
                <p className="text-2xl font-light text-[#d3bb73]">
                  {stats.monthRevenue.toLocaleString('pl-PL')} zł
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-light text-[#e5e4e2]">Ostatnie oferty</h2>
              <Link
                href="/seller/offers"
                className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
              >
                Zobacz wszystkie
              </Link>
            </div>

            {recentOffers.length === 0 ? (
              <div className="text-center py-8 text-[#e5e4e2]/40">
                Brak ofert. Utwórz pierwszą!
              </div>
            ) : (
              <div className="space-y-3">
                {recentOffers.map((offer) => (
                  <Link
                    key={offer.id}
                    href={`/seller/offers/${offer.id}`}
                    className="block p-4 bg-[#0f1119] rounded-lg hover:bg-[#0f1119]/50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-[#e5e4e2] font-medium">{offer.title || offer.offer_number}</p>
                        <p className="text-sm text-[#e5e4e2]/60 mt-1">
                          {offer.clients?.company_name || `${offer.clients?.first_name} ${offer.clients?.last_name}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-medium ${getStatusColor(offer.status)}`}>
                          {getStatusLabel(offer.status)}
                        </p>
                        <p className="text-sm text-[#e5e4e2]/60 mt-1">
                          {(offer.total_final_price || 0).toLocaleString('pl-PL')} zł
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h2 className="text-lg font-light text-[#e5e4e2] mb-6">Szybkie akcje</h2>
            <div className="space-y-3">
              <Link
                href="/seller/offers/new"
                className="block w-full bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-3 rounded-lg text-sm hover:bg-[#d3bb73]/20 transition-colors"
              >
                + Nowa oferta
              </Link>
              <Link
                href="/seller/calendar"
                className="block w-full bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-3 rounded-lg text-sm hover:bg-[#d3bb73]/20 transition-colors"
              >
                📅 Mój kalendarz
              </Link>
              <Link
                href="/seller/clients"
                className="block w-full bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-3 rounded-lg text-sm hover:bg-[#d3bb73]/20 transition-colors"
              >
                👥 Klienci
              </Link>
              <Link
                href="/seller/attractions"
                className="block w-full bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-3 rounded-lg text-sm hover:bg-[#d3bb73]/20 transition-colors"
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
