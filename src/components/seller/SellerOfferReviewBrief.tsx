'use client';

import Link from 'next/link';
import { TechnicalDetailsView } from '@/components/crm/locations/LocationTechnicalDetails';
import { arrangementLocalDate } from '@/lib/seller/arrangements';
import type { SellerDeliveryState } from '@/lib/seller/delivery';
import { hasLegacySellerEventRange, sellerEventDaysFrom, sellerEventDayLabel } from '@/lib/seller/eventSchedule';
import { sellerMoney } from '@/lib/seller/portal';

export default function SellerOfferReviewBrief({ state, sellerHref, managerName }: {
  state: SellerDeliveryState; sellerHref?: string; managerName?: string | null;
}) {
  const summary = state.offer_summary;
  const arrangements = state.seller_arrangements;
  const values = arrangements?.values;
  const venue = values?.venue_snapshot;
  const days = sellerEventDaysFrom(values, String(summary?.event_date || '').slice(0, 10));
  return <section aria-label="Podsumowanie zapytania sprzedawcy" className="space-y-4 rounded-lg bg-white/[0.035] p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h3 className="text-sm uppercase">Zapytanie sprzedawcy</h3>
      <a href="#seller-offer-review" className="text-sm text-[#d3bb73] underline underline-offset-4">Przejdź do decyzji</a>
    </div>
    {!summary ? <p role="alert" className="text-sm text-amber-200">{state.offer_summary_error || 'Nie udało się wczytać podsumowania. Odśwież status.'}</p> : <>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-white/50">Sprzedawca / organizacja tej oferty</dt><dd className="mt-1 break-words">
          {sellerHref ? <Link href={sellerHref} className="text-[#d3bb73] hover:underline">{summary.seller_name}</Link> : summary.seller_name}
          <span className="block text-white/65">{summary.seller_organization || 'Nie zapisano organizacji'}</span>
        </dd></div>
        <div><dt className="text-xs text-white/50">Klient</dt><dd className="mt-1 break-words">{[summary.client_company, summary.client_name].filter(Boolean).join(' · ') || 'Nie podano klienta'}</dd></div>
        <div><dt className="text-xs text-white/50">Termin · czas polski</dt><dd className="mt-1 space-y-1">
          {hasLegacySellerEventRange(values) ? <p>{arrangementLocalDate(values?.starts_at)} — {arrangementLocalDate(values?.ends_at)}</p>
            : days.map((day, index) => <p key={index}>{sellerEventDayLabel(day)}</p>)}
        </dd></div>
        <div><dt className="text-xs text-white/50">Miejsce / przestrzeń</dt><dd className="mt-1 break-words">{summary.event_location || 'Nie podano miejsca'}
          {values?.room && <span className="block text-white/65">{values.room}</span>}
          {values?.participant_count != null && <span className="block text-white/65">Uczestnicy: {values.participant_count}</span>}
        </dd></div>
      </dl>
      <div>
        <h4 className="text-xs uppercase text-white/50">Zakres do oceny</h4>
        {summary.items.length ? <ul className="mt-1 divide-y divide-white/5">{summary.items.map(item => {
          const product = state.seller_progress?.items.find(row => row.id === item.id);
          const details = [product?.configuration_scope, product?.requirements, product?.accommodation, product?.logistics].filter(Boolean).join('\n');
          return <li key={item.id} className="flex items-start justify-between gap-3 py-2 text-sm">
            <div className="min-w-0 break-words">{item.name}
              {details && <details className="mt-1 text-xs text-white/65"><summary className="cursor-pointer text-[#d3bb73]">Konfiguracja i wymagania</summary><p className="mt-2 whitespace-pre-wrap leading-5">{details}</p></details>}
            </div>
            <span className="shrink-0 text-white/65">{item.quantity} {item.unit}{item.days > 1 ? ` × ${item.days} dni` : ''}</span>
          </li>;
        })}</ul> : <p className="mt-2 text-sm text-amber-200">Brak pozycji — wyjaśnij zakres ze sprzedawcą.</p>}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-black/15 p-3 text-sm">
        <p>Kwota bazowa Mavinci: <span className="font-medium text-[#d3bb73]">{arrangements?.offer.base_net != null ? sellerMoney(arrangements.offer.base_net) + ' netto' : 'Nie udało się odczytać'}</span></p>
        <p className="text-white/65">Cena dla klienta: {arrangements?.offer.client_net != null ? sellerMoney(arrangements.offer.client_net) + ' netto' : 'Nie udało się odczytać'}</p>
      </div>
    </>}
    {venue && <details className="rounded-lg bg-black/10 p-3 text-sm">
      <summary className="cursor-pointer text-[#d3bb73]">Sala: {venue.room.name} — parametry, zasilanie i plany</summary>
      <div className="mt-3 space-y-3">{venue.room.notes && <p className="whitespace-pre-wrap text-white/65">{venue.room.notes}</p>}<TechnicalDetailsView value={venue.room.technical}/><TechnicalDetailsView value={venue.technical_details}/></div>
    </details>}
    {(values?.technical_requirements || values?.logistics_requirements) && <details className="rounded-lg bg-black/10 p-3 text-sm">
      <summary className="cursor-pointer text-[#d3bb73]">Dodatkowe informacje od sprzedawcy</summary>
      {values.technical_requirements && <p className="mt-3 whitespace-pre-wrap text-white/65">{values.technical_requirements}</p>}
      {values.logistics_requirements && <p className="mt-3 whitespace-pre-wrap text-white/65">{values.logistics_requirements}</p>}
    </details>}
    {state.seller_arrangements_error && <p role="alert" className="text-sm text-amber-200">{state.seller_arrangements_error}</p>}
    {state.seller_progress_error && <p role="alert" className="text-sm text-amber-200">{state.seller_progress_error}</p>}
    <p className="text-xs leading-5 text-white/50">Opiekun: {managerName || 'Nie przypisano'}. Podsumowanie pokazuje bieżące dane; zapisany PDF zachowuje treść swojej wersji. Zmiany zakresu i ceny uzgodnij ze sprzedawcą w rozmowie.</p>
  </section>;
}
