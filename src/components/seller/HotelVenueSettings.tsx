'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { hotelContextError, type SellerHotelContext } from '@/lib/seller/hotel';
import { LocationRooms } from '@/components/crm/locations/LocationRooms';
import { LocationTechnicalDetails, TechnicalDetailsView } from '@/components/crm/locations/LocationTechnicalDetails';
import SearchCombobox from '@/components/crm/SearchCombobox';

export default function HotelVenueSettings({ organizationId, crm = false }: { organizationId?: string; crm?: boolean }) {
  const [data, setData] = useState<SellerHotelContext | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedHotelId, setSelectedHotelId] = useState('');
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const load = async () => {
      try {
        const { data: next, error: failed } = await supabase.rpc('get_seller_hotel_context', { p_organization: organizationId || selectedHotelId || null });
        if (failed) throw failed;
        if (active) setData(next as SellerHotelContext);
      } catch (cause) {
        if (active) setError(hotelContextError(cause as { code?: string; message?: string }));
      } finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [organizationId, selectedHotelId, refreshKey]);
  const hotels = data?.organizations || (data?.organization ? [data.organization] : []);
  if (!loading && !error && !data?.available) return null;
  return <section id="hotel-directory" className="scroll-mt-6 space-y-4 rounded-xl bg-[#1c1f33] p-5 text-[#e5e4e2]">
    <header className="flex flex-wrap items-start justify-between gap-3"><div>
      <h2 className="flex items-center gap-2 text-sm uppercase"><Building2 className="h-4 w-4 text-[#d3bb73]"/>Przestrzenie i kontakty hotelu{data?.organization ? ` · ${data.organization.name}` : ''}</h2>
      <p className="mt-2 max-w-3xl text-xs leading-5 text-white/55">Wspólna baza hotelu, niezależna od marki oferty. W ofercie wybierasz salę i potrzebne osoby z listy. Edycja bazy należy do CRM; sprzedawcy korzystają z podglądu.</p>
    </div><button type="button" disabled={loading} onClick={refresh} className="rounded-lg bg-white/5 p-2 text-[#d3bb73]" aria-label="Odśwież bazę hotelu"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}/></button></header>
    {loading && <p role="status" className="text-sm text-white/50">Wczytywanie bazy hotelu…</p>}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {!organizationId && hotels.length > 1 && <div className="max-w-lg space-y-2"><p className="text-xs text-white/50">Hotel</p><SearchCombobox value={selectedHotelId || data?.organization?.id || ''} options={hotels.map((hotel) => ({ id: hotel.id, label: hotel.name }))} onChange={setSelectedHotelId} allowClear={false} disabled={loading} ariaLabel="Wybierz hotel do podglądu" placeholder="Wybierz hotel…"/></div>}
    {!loading && !error && data?.available && !data.organization && <p className="text-sm text-white/60">Wybierz hotel, aby zobaczyć jego przestrzenie, plany i kontakty.</p>}
    {!loading && !error && data?.available && data.organization && <>
      {!data.location ? <div className="rounded-lg bg-white/[0.035] p-4 text-sm text-white/60">
        <p>Hotel nie ma jeszcze powiązanej lokalizacji. Opiekun CRM powinien wybrać lub utworzyć lokalizację w szczegółach organizacji. Sale i materiały zapisujemy w tej samej bazie co wydarzenia.</p>
        {crm && <Link href={`/crm/contacts/${data.organization?.id}?tab=details`} className="mt-3 inline-block text-[#d3bb73] hover:underline">Powiąż lokalizację hotelu</Link>}
      </div> : crm && data.can_edit ? <>
        <p className="text-xs text-white/50">Dodane tutaj sale, plany i informacje będą widoczne sprzedawcom hotelu. Nie dodawaj wewnętrznych notatek CRM.</p>
        <LocationRooms key={`rooms:${data.location.id}:${refreshKey}`} locationId={data.location.id}/>
        <LocationTechnicalDetails key={`technical:${data.location.id}:${refreshKey}`} locationId={data.location.id}/>
      </> : <div className="space-y-3">
        <h3 className="text-xs uppercase">Sale i przestrzenie</h3>
        {data.location.rooms.map((room) => <details key={room.id} className="rounded-lg bg-white/[0.035] p-3"><summary className="cursor-pointer text-sm text-[#d3bb73]">{room.name}</summary><div className="mt-3 space-y-3"><p className="whitespace-pre-wrap text-sm text-white/60">{room.notes}</p><TechnicalDetailsView value={room.technical}/></div></details>)}
        {!data.location.rooms.length && <p className="text-sm text-white/45">Nie dodano jeszcze przestrzeni. Poproś opiekuna o uzupełnienie bazy hotelu.</p>}
        <details className="rounded-lg bg-white/[0.035] p-3"><summary className="cursor-pointer text-sm text-[#d3bb73]">Plany i informacje o obiekcie</summary><div className="mt-3"><TechnicalDetailsView value={data.location.technical_details}/></div></details>
      </div>}
      <div className="space-y-3"><h3 className="text-xs uppercase">Kontakty hotelowe</h3>
        <p className="text-xs text-white/45">Aktualne osoby powiązane z hotelem w CRM, np. technik, recepcja i dział sprzedaży. Do konkretnej oferty dodajesz tylko potrzebne kontakty.</p>
        <div className="grid gap-3 sm:grid-cols-2">{data.contacts.map((person) => <article key={person.id} className="rounded-lg bg-white/[0.035] p-3 text-sm"><p>{person.name}</p><p className="mt-1 text-xs text-white/50">{person.role}</p><p className="mt-2 break-words text-white/65">{[person.phone, person.email].filter(Boolean).join(' · ') || 'Kontakt do uzupełnienia w CRM'}</p></article>)}</div>
        {!data.contacts.length && <p className="text-sm text-white/45">Brak aktualnych kontaktów hotelowych.</p>}
        {crm && <Link href={`/crm/contacts/${data.organization?.id}?tab=contacts`} className="inline-block text-xs text-[#d3bb73] hover:underline">Dodaj lub uporządkuj kontakty organizacji w CRM</Link>}
      </div>
    </>}
  </section>;
}
