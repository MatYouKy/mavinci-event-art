'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlarmClock, FileText, Gavel, Inbox, Loader2, RefreshCw, TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { systemLabel } from '@/lib/ui/systemLabels';
import { sellerInboxCounts, useSellerInbox } from '@/lib/seller/inbox';

type Followup = {
  id: string;
  title: string;
  stage: string | null;
  next_action_at: string;
  estimated_value: number | null;
  overdue: boolean;
  tender_id: string | null;
};

type WaitingOffer = {
  id: string;
  title: string | null;
  offer_number: string | null;
  sent_at: string;
  viewed_at: string | null;
  total_amount: number | null;
  valid_until: string | null;
  inquiry_id: string | null;
  days_waiting: number;
};

type DayTender = {
  id: string;
  title: string;
  submission_deadline: string;
  status: string;
  inquiry_id: string | null;
  mine: boolean;
};

type PipelineStage = { stage: string; count: number; value: number; weighted_value: number };

type SalesDay = {
  followups: Followup[];
  unscheduled_inquiries: number;
  waiting_offers: WaitingOffer[];
  tenders: DayTender[];
  pipeline: PipelineStage[];
};

const panelClass = 'rounded-xl bg-[var(--brand-burgundy-900,#3c1324)] p-5';
const rowClass = 'flex items-start justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-white/5';

const money = (value: number | null | undefined) =>
  `${Number(value || 0).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} zł`;

const dateTime = (value: string) =>
  new Date(value).toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Warsaw',
  });

const daysUntil = (value: string) => Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);

/** Lista działań sprzedawcy na dziś. Dane wyłącznie bieżącego pracownika (get_my_sales_day). */
export default function SalesDayPanel() {
  const [day, setDay] = useState<SalesDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inbox = useSellerInbox(true);
  const sellerReviews = sellerInboxCounts(inbox.items || []).reviews;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('get_my_sales_day');
    if (rpcError || !data) {
      setError(
        rpcError?.code === 'PGRST202'
          ? 'Lista „Mój dzień” wymaga aktualizacji bazy.'
          : 'Nie udało się pobrać listy zadań sprzedaży.',
      );
    } else {
      setDay(data as SalesDay);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const overdueCount = day?.followups.filter((item) => item.overdue).length ?? 0;
  const pipelineTotal = (day?.pipeline || []).reduce((sum, stage) => sum + Number(stage.weighted_value || 0), 0);

  return (
    <section className="space-y-4" aria-labelledby="sales-day-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="sales-day-heading" className="text-xl font-medium">
            Mój dzień
          </h2>
          <p className="mt-1 text-sm text-[#e5e4e2]/55">
            Kontakty do wykonania, oferty czekające na odpowiedź i zbliżające się terminy przetargów.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Odśwież mój dzień"
          className="rounded-lg bg-white/5 p-2 hover:bg-white/10 disabled:opacity-40"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl bg-white/5 p-4 text-sm text-amber-200">
          {error}
        </div>
      )}

      {loading && !day ? (
        <div className={`${panelClass} flex items-center gap-2 text-sm text-[#e5e4e2]/60`}>
          <Loader2 className="h-4 w-4 animate-spin" /> Ładowanie…
        </div>
      ) : day ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Kontakty na dziś', value: day.followups.length, helper: overdueCount ? `${overdueCount} zaległych` : 'Brak zaległości', href: '/crm/inquiries' },
              { label: 'Oferty bez odpowiedzi', value: day.waiting_offers.length, helper: 'Wysłane ponad 3 dni temu', href: '/crm/offers' },
              { label: 'Przetargi — termin w 7 dni', value: day.tenders.length, helper: `${day.tenders.filter((t) => t.mine).length} Twoich`, href: '/crm/tenders' },
              { label: 'Oferty sprzedawców do decyzji', value: sellerReviews, helper: 'Portal sprzedawców', href: '/crm/salespeople' },
            ].map((card) => (
              <Link key={card.label} href={card.href} className={`${panelClass} block hover:bg-white/5`}>
                <p className="text-xs text-[#e5e4e2]/60">{card.label}</p>
                <p className="mt-2 text-2xl font-medium">{card.value}</p>
                <p className="mt-1 text-xs text-[#e5e4e2]/45">{card.helper}</p>
              </Link>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <article className={panelClass}>
              <h3 className="mb-3 flex items-center gap-2 text-base font-medium">
                <AlarmClock className="h-4 w-4 text-[#d3bb73]" /> Do zrobienia dziś
              </h3>
              {day.followups.length === 0 ? (
                <p className="text-sm text-[#e5e4e2]/50">Brak zaplanowanych kontaktów na dziś.</p>
              ) : (
                <ul className="space-y-1">
                  {day.followups.map((item) => (
                    <li key={item.id}>
                      <Link href={`/crm/inquiries/${item.id}`} className={rowClass}>
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{item.title}</span>
                          <span className="text-xs text-[#e5e4e2]/45">
                            {systemLabel(item.stage || 'new')}
                            {item.tender_id ? ' · przetarg' : ''}
                            {item.estimated_value ? ` · ${money(item.estimated_value)}` : ''}
                          </span>
                        </span>
                        <span className={`shrink-0 text-xs ${item.overdue ? 'text-red-300' : 'text-[#e5e4e2]/60'}`}>
                          {item.overdue ? 'Zaległe · ' : ''}
                          {dateTime(item.next_action_at)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {day.unscheduled_inquiries > 0 && (
                <p className="mt-3 text-xs text-amber-200/80">
                  {day.unscheduled_inquiries} otwartych zapytań nie ma zaplanowanego kolejnego kontaktu.
                </p>
              )}
            </article>

            <article className={panelClass}>
              <h3 className="mb-3 flex items-center gap-2 text-base font-medium">
                <FileText className="h-4 w-4 text-[#d3bb73]" /> Oferty czekające na odpowiedź
              </h3>
              {day.waiting_offers.length === 0 ? (
                <p className="text-sm text-[#e5e4e2]/50">Wszystkie wysłane oferty mają reakcję albo są świeże.</p>
              ) : (
                <ul className="space-y-1">
                  {day.waiting_offers.map((offer) => (
                    <li key={offer.id}>
                      <Link
                        href={offer.inquiry_id ? `/crm/inquiries/${offer.inquiry_id}` : `/crm/offers/${offer.id}`}
                        className={rowClass}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{offer.title || offer.offer_number || 'Oferta'}</span>
                          <span className="text-xs text-[#e5e4e2]/45">
                            {offer.viewed_at ? 'Klient otworzył ofertę' : 'Nieotwarta'} · {money(offer.total_amount)}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-[#e5e4e2]/60">{offer.days_waiting} dni</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className={panelClass}>
              <h3 className="mb-3 flex items-center gap-2 text-base font-medium">
                <Gavel className="h-4 w-4 text-[#d3bb73]" /> Przetargi z bliskim terminem
              </h3>
              {day.tenders.length === 0 ? (
                <p className="text-sm text-[#e5e4e2]/50">Brak przetargów z terminem w najbliższych 7 dniach.</p>
              ) : (
                <ul className="space-y-1">
                  {day.tenders.map((tender) => (
                    <li key={tender.id}>
                      <Link
                        href={tender.inquiry_id ? `/crm/inquiries/${tender.inquiry_id}` : `/crm/tenders?tender=${tender.id}`}
                        className={rowClass}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{tender.title}</span>
                          <span className="text-xs text-[#e5e4e2]/45">
                            {tender.mine ? 'Twój' : 'Bez opiekuna'}
                            {tender.inquiry_id ? ' · zapytanie utworzone' : ''}
                          </span>
                        </span>
                        <span className={`shrink-0 text-xs ${daysUntil(tender.submission_deadline) <= 2 ? 'text-red-300' : 'text-[#e5e4e2]/60'}`}>
                          {dateTime(tender.submission_deadline)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className={panelClass}>
              <h3 className="mb-3 flex items-center gap-2 text-base font-medium">
                <TrendingUp className="h-4 w-4 text-[#d3bb73]" /> Mój lejek
              </h3>
              {day.pipeline.length === 0 ? (
                <p className="text-sm text-[#e5e4e2]/50">Brak otwartych zapytań.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[#e5e4e2]/50">
                      <th className="pb-2 font-normal">Etap</th>
                      <th className="pb-2 text-right font-normal">Zapytania</th>
                      <th className="pb-2 text-right font-normal">Wartość</th>
                      <th className="pb-2 text-right font-normal">Ważona</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.pipeline.map((stage) => (
                      <tr key={stage.stage}>
                        <td className="py-1.5">{systemLabel(stage.stage)}</td>
                        <td className="py-1.5 text-right">{stage.count}</td>
                        <td className="py-1.5 text-right">{money(stage.value)}</td>
                        <td className="py-1.5 text-right text-[#e5e4e2]/70">{money(stage.weighted_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-3 flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                <Inbox className="h-3.5 w-3.5" /> Wartość ważona prawdopodobieństwem wygranej: {money(pipelineTotal)}
              </p>
            </article>
          </div>
        </>
      ) : null}
    </section>
  );
}
