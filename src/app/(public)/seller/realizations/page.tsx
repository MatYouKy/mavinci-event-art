'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, ChevronRight, Loader2, MapPin, MessageSquare, RefreshCw, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { sellerMoney, useSellerPortalContext } from '@/lib/seller/portal';
import { sellerArrangementError } from '@/lib/seller/arrangements';
import { useOfferRefresh } from '@/lib/seller/useOfferRefresh';
import { deliveryStage } from '@/lib/seller/delivery';
import SellerInboxPanel from '@/components/seller/SellerInboxPanel';

type Realization = {
  id: string;
  event_id: string | null;
  offer_id: string;
  offer_number: string | null;
  name: string;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  status: string;
  brand_name: string;
  client_name: string | null;
  client_net: number | null;
  is_past: boolean;
};
type Result = { items: Realization[]; total: number; has_more: boolean };
const pageSize = 50;
const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:cursor-not-allowed disabled:opacity-40';
const nextAction = (status: string) => {
  const stage = deliveryStage(status);
  if (stage.cancelled) return 'Historia i rozmowa pozostają dostępne.';
  if (stage.index < 0) return 'Dalsze działania ustal z opiekunem.';
  if (stage.index === 0) return 'Czekamy na osobne potwierdzenie wydarzenia przez MAVINCI.';
  if (stage.index < 3) return 'Sprawdź przygotowania i przekaż brakujące informacje.';
  if (stage.index < 5) return 'Harmonogram i kontakty do zespołu znajdziesz w realizacji.';
  return 'Możesz przekazać podsumowanie i wrócić do dokumentów.';
};
const date = (value: string | null) => {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Warsaw' });
};
function dates(row: Realization) {
  const start = date(row.starts_at), end = date(row.ends_at);
  return start ? start + (end && end !== start ? ` – ${end}` : '') : 'Termin do ustalenia';
}

export default function SellerRealizationsPage() {
  const { context, loading: contextLoading, error: contextError, reload: reloadContext } = useSellerPortalContext();
  const partnerId = context?.profile.id;
  const revision = useOfferRefresh(partnerId ? `sales_partner_id=eq.${partnerId}` : undefined);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [includePast, setIncludePast] = useState(false);
  const [offset, setOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [items, setItems] = useState<Realization[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const scopeRef = useRef('');
  useEffect(() => { setOffset(0); }, [revision]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search.trim()); setOffset(0); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const request = ++requestRef.current;
    if (!partnerId) { setItems([]); setTotal(0); setHasMore(false); setLoading(false); return; }
    setLoading(true); setError('');
    const scope = `${partnerId}:${query}:${includePast}`;
    if (scopeRef.current !== scope) { setItems([]); setTotal(0); setHasMore(false); scopeRef.current = scope; }
    void (async () => {
      try {
        const result = await supabase.rpc('get_seller_realizations', { p_include_past: includePast, p_search: query, p_offset: offset, p_limit: pageSize });
        if (result.error) throw result.error;
        if (!result.data) throw new Error('Nie otrzymano listy realizacji.');
        if (request !== requestRef.current) return;
        const data = result.data as Result;
        setItems((current) => offset === 0 ? data.items : Array.from(new Map([...current, ...data.items].map((item) => [item.id, item])).values()));
        setTotal(data.total); setHasMore(data.has_more);
      } catch (cause) {
        if (request === requestRef.current) setError(sellerArrangementError(cause));
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    })();
    return () => { requestRef.current += 1; };
  }, [partnerId, query, includePast, offset, refreshKey, revision]);

  const searchPending = search.trim() !== query;
  const busy = loading || searchPending;
  const refresh = () => { setOffset(0); setRefreshKey((current) => current + 1); };
  if (contextLoading) return <p role="status" className="p-10 text-center text-[#d3bb73]">Wczytywanie portalu…</p>;
  if (!context) return <div className="space-y-3 p-10 text-center text-[#e5e4e2]/60"><p>{contextError || 'Brak dostępu do realizacji sprzedawcy.'}</p><button type="button" className={button} onClick={() => void reloadContext()}>Spróbuj ponownie</button></div>;

  return <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-light uppercase">Realizacje</h1><p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/50">Nadchodzące i trwające realizacje z Twoich zaakceptowanych ofert. Tutaj wrócisz do ustaleń, kontaktów i całej rozmowy o ofercie.</p></div>
        <button type="button" className={button} disabled={busy} onClick={refresh}><RefreshCw className="h-4 w-4"/>Odśwież</button>
      </header>
      <SellerInboxPanel partnerId={context.profile.id} scope="realizations" />
      <section className="rounded-xl bg-[#1c1f33] p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-4">
          <label className="relative min-w-0 flex-1 basis-72"><span className="sr-only">Szukaj realizacji</span><Search className="absolute left-3 top-3 h-4 w-4 text-white/35"/><input type="search" maxLength={200} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj realizacji, klienta, hotelu lub marki…" className="min-h-11 w-full rounded-lg border border-white/10 bg-[#0f1119] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#d3bb73]/30"/></label>
          <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[#d3bb73]" checked={includePast} onChange={(event) => { setIncludePast(event.target.checked); setOffset(0); }}/><span>Pokaż również przeszłe i anulowane</span></label>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-white/40">Po akceptacji oferty zlecenie trafia tutaj jako oczekujące na potwierdzenie MAVINCI. Osobna decyzja opiekuna potwierdza wydarzenie — dostaniesz o niej powiadomienie. Przygotowania, dokumenty, kontakty i rozmowa pozostają w jednym miejscu. Przeszły termin sam nie oznacza zakończenia realizacji.</p>
      </section>
      {error && <div role="alert" className="space-y-3 rounded-xl bg-rose-300/10 p-4 text-sm text-rose-200"><p>{error}</p><button type="button" className={button} disabled={busy} onClick={() => setRefreshKey((value) => value + 1)}>Ponów wczytanie</button></div>}
      {busy && <p role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin"/>{offset > 0 && !searchPending ? 'Wczytywanie kolejnych realizacji…' : 'Wczytywanie realizacji…'}</p>}
      {!searchPending && ([false, true] as const).map((past) => {
        if (past && !includePast) return null;
        const rows = items.filter((item) => item.is_past === past);
        if (!rows.length) return null;
        return <section key={String(past)} className="space-y-3">
          <h2 className="text-sm uppercase text-white/65">{past ? 'Przeszłe i anulowane realizacje' : 'Nadchodzące i w trakcie'}</h2>
          <div className="divide-y divide-white/5 overflow-hidden rounded-xl bg-[#1c1f33]">
            {rows.map((item) => <article key={item.id} className="p-4 sm:p-5">
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,0.5fr)_auto]">
                <div className="min-w-0">
                  <Link href={`/seller/realizations/${item.offer_id}`} className="group flex items-start gap-2 text-sm hover:text-[#d3bb73]"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]"/><span className="break-words">{item.name}</span><ChevronRight className="mt-0.5 h-4 w-4 shrink-0 opacity-40 group-hover:opacity-100"/></Link>
                  <p className="mt-2 break-words text-xs text-white/45">{[item.client_name, item.offer_number, item.brand_name].filter(Boolean).join(' · ')}</p>
                  {item.location && <p className="mt-2 flex items-start gap-1.5 text-xs text-white/60"><MapPin className="h-3.5 w-3.5 shrink-0"/><span className="break-words">{item.location}</span></p>}
                </div>
                <div><p className="text-sm">{dates(item)}</p><p className={`mt-2 text-xs ${item.status === 'in_progress' ? 'text-emerald-300' : 'text-[#d3bb73]'}`}>{deliveryStage(item.status).label}</p></div>
                <div className="lg:text-right"><p className="text-[10px] uppercase text-white/40">Wartość dla klienta netto</p><p className="mt-1 text-sm">{item.client_net == null ? '—' : sellerMoney(item.client_net)}</p></div>
              </div>
              <p className="mt-3 text-xs leading-5 text-white/50">{nextAction(item.status)}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link className={button} href={`/seller/realizations/${item.offer_id}`}>Otwórz realizację</Link>
                <Link className={button} href={`/seller/realizations/${item.offer_id}#seller-offer-conversation`}><MessageSquare className="h-4 w-4"/>Rozmowa o realizacji</Link>
              </div>
            </article>)}
          </div>
        </section>;
      })}
      {!busy && !error && items.length === 0 && <div className="rounded-xl bg-[#1c1f33] px-5 py-12 text-center"><CalendarDays className="mx-auto h-8 w-8 text-white/25"/><p className="mt-4 text-sm text-white/60">{query ? 'Brak realizacji pasujących do wyszukiwania.' : includePast ? 'Nie masz jeszcze zaakceptowanych realizacji.' : 'Nie masz obecnie nadchodzących realizacji.'}</p>{!includePast && !query && <p className="mt-2 text-xs text-white/40">Zaznacz „Pokaż również przeszłe i anulowane”, aby zobaczyć wcześniejsze wydarzenia.</p>}</div>}
      {!searchPending && items.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3"><p aria-live="polite" className="text-xs text-white/40">Pokazano {items.length} z {total} realizacji.</p>{hasMore && !error && <button type="button" className={button} disabled={busy} onClick={() => setOffset((value) => value + pageSize)}>Pokaż kolejne realizacje</button>}</div>}
    </div>
  </div>;
}
