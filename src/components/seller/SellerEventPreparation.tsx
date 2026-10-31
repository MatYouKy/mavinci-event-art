'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Loader2, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { sellerOfferRequest } from '@/lib/seller/offerRequest.browser';
import type { SellerDeliveryState } from '@/lib/seller/delivery';
import CreateSellerEventModal from './CreateSellerEventModal';

type State = SellerDeliveryState & {
  can_manage: boolean;
  realization?: NonNullable<SellerDeliveryState['realization']> & {
    can_create_event: boolean; can_view_event: boolean; auto_event_ready: boolean;
  };
};
const button = 'inline-flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:opacity-40';
const sections = [
  ['phases', 'Timeline', 'Godziny i etapy pracy'],
  ['team', 'Zespół', 'Pracownicy i zaproszenia'],
  ['equipment', 'Sprzęt', 'Plan, braki i rezerwacje'],
  ['agenda', 'Agenda', 'Program wydarzenia'],
  ['logistics', 'Logistyka', 'Transport, kierowcy i przejazdy'],
  ['finances', 'Finanse i prowizje', 'Planowane rozliczenia i wypłaty'],
] as const;

export default function SellerEventPreparation({ offerId, eventId }: { offerId: string; eventId: string }) {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const api = useCallback((payload: Record<string, unknown>) => sellerOfferRequest(offerId, payload), [offerId]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setState(null);
    void sellerOfferRequest(offerId).then(result => {
      if (active) setState(result as State);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Nie udało się wczytać stanu przygotowania.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [offerId, eventId, refresh]);
  const matching = state?.realization?.event_id === eventId && state.realization.can_view_event;
  const pending = matching && state?.realization?.stage === 'awaiting_crm_confirmation';
  return <section className="space-y-4 rounded-xl bg-white/[0.035] p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base uppercase"><CalendarDays className="h-4 w-4 text-[#d3bb73]"/>Przygotowanie wydarzenia z oferty</h2>
      <button type="button" className={button} disabled={loading} onClick={() => setRefresh(value => value + 1)} aria-label="Odśwież przygotowanie wydarzenia"><RefreshCw className="h-4 w-4"/></button>
    </div>
    {loading && <p role="status" className="flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin"/>Wczytywanie stanu realizacji…</p>}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {matching && <>
      <p className={pending ? 'text-sm text-amber-200' : 'text-sm text-white/65'}>{pending
        ? 'Oferta przyjęta — wydarzenie istnieje i oczekuje na potwierdzenie realizacji. Możesz już przygotować plan.'
        : state?.realization?.stage === 'cancelled' ? 'Wydarzenie anulowane. Zachowano dokumenty i historię przygotowań.'
        : 'Wydarzenie jest powiązane z ofertą. Dalsze przygotowanie prowadzisz w standardowych sekcjach CRM.'}</p>
      {state?.offer_summary && <p className="text-sm text-white/60">{[state.offer_summary.seller_name, state.offer_summary.seller_organization].filter(Boolean).join(' · ')}</p>}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{sections.map(([tab, label, description]) => <Link key={tab} href={`/crm/events/${eventId}?tab=${tab}`} className="rounded-lg bg-black/15 p-3 hover:bg-white/5">
        <span className="block text-sm text-[#d3bb73]">{label}</span><span className="mt-1 block text-xs text-white/45">{description}</span>
      </Link>)}</div>
      <p className="text-xs leading-5 text-white/50">Zakres sprzętu pochodzi z produktów i konfiguracji oferty. Linie planowane nie rezerwują egzemplarzy. Zespół i pojazdy wybierasz w CRM; nie wysyłamy zaproszeń przy samej akceptacji. Prowizja jest planowana tylko przy włączonym modelu prowizyjnym — nie jest wypłatą.</p>
      {pending && state?.can_manage && state.realization?.can_create_event && <button type="button" className={button} disabled={!state.realization.auto_event_ready} onClick={() => setOpen(true)}>Sprawdź dane i potwierdź realizację</button>}
      {pending && !state?.realization?.auto_event_ready && <p className="text-xs text-amber-200">Potwierdzenie wymaga migracji 20261028170000_seller_acceptance_event_handoff.sql.</p>}
    </>}
    {!loading && !error && !matching && <p className="text-sm text-white/50">Nie potwierdzono dostępu do tej relacji oferty i wydarzenia. Odśwież dane lub wróć do oferty źródłowej.</p>}
    {open && matching && <CreateSellerEventModal offerId={offerId} api={api} onClose={() => setOpen(false)} onCreated={() => {
      setOpen(false); setRefresh(value => value + 1);
      window.dispatchEvent(new Event('seller-workspace-changed')); router.refresh();
    }}/>}
  </section>;
}
