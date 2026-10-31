'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Palette, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import type { SellerBranding } from '@/lib/seller/portal';
import { IdentityAssetPreview, OrganizationIdentitySummary } from './OfferIdentityFields';
import HotelVenueSettings from './HotelVenueSettings';
import SearchCombobox from '@/components/crm/SearchCombobox';

type BrandingContext = {
  organization_id: string | null;
  organization_name: string | null;
  organizations?: { id: string; name: string }[];
  brands: { id: string; name: string; branding: SellerBranding }[];
};

export default function CrmOfferBrandingPanel({ partnerId, organizationId, hotelSpacesHref }: { partnerId?: string; organizationId?: string; hotelSpacesHref?: string }) {
  const [data, setData] = useState<BrandingContext | null>(null);
  const [brandId, setBrandId] = useState('');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const selectedBrand = data?.brands.find((brand) => brand.id === brandId);

  useEffect(() => { setSelectedOrganizationId(''); }, [partnerId, organizationId]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setData(null);
    void (async () => {
      try {
        const { data: loaded, error: failed } = await supabase.rpc('get_crm_offer_branding', {
          p_partner: partnerId || null, p_organization: selectedOrganizationId || organizationId || null,
        });
        if (failed) throw failed;
        if (!active) return;
        const next = loaded as BrandingContext;
        setData(next);
        setBrandId((current) => next.brands.some((brand) => brand.id === current) ? current : next.brands[0]?.id || '');
      } catch (cause) {
        if (active) setError((cause as { message?: string }).message || 'Nie udało się pobrać brandingu.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [partnerId, organizationId, selectedOrganizationId, attempt]);

  if (loading) return <p role="status" className="flex items-center gap-2 p-5 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" />Wczytywanie brandingu…</p>;
  if (!data) return <div role="alert" className="space-y-3 rounded-xl bg-amber-300/5 p-5 text-sm text-amber-200">
    <p>{error || 'Brak dostępnych ustawień.'}</p>
    <button type="button" onClick={() => setAttempt((value) => value + 1)} className="rounded-lg bg-white/5 px-4 py-2">Spróbuj ponownie</button>
  </div>;
  const branding = selectedBrand?.branding || {};
  return <div className="space-y-5 text-[#e5e4e2]">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-lg"><Palette className="h-5 w-5 text-[#d3bb73]" />Podgląd brandingu ofert</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/50">Logo, kolory, wygląd ofert i wizytówkę sprzedawca ustawia wyłącznie w swoim portalu. CRM pokazuje te same zapisane dane, bez możliwości ich edycji.</p></div>
      <button type="button" onClick={() => setAttempt((value) => value + 1)} className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-[#d3bb73]"><RefreshCw className="h-4 w-4" />Odśwież podgląd</button>
    </header>
    {partnerId && (data.organizations?.length || 0) > 1 && <div className="max-w-lg space-y-2">
      <p className="text-xs text-white/50">Organizacja powiązana ze sprzedawcą</p>
      <SearchCombobox value={data.organization_id || ''} options={(data.organizations || []).map((item) => ({ id: item.id, label: item.name }))}
        onChange={setSelectedOrganizationId} allowClear={false} ariaLabel="Organizacja podglądu brandingu" placeholder="Wybierz organizację…" />
    </div>}
    <div className="flex flex-wrap gap-2" role="group" aria-label="Marka realizująca">{data.brands.map((brand) => <button type="button" key={brand.id} aria-pressed={brandId === brand.id} onClick={() => setBrandId(brand.id)} className={`rounded-lg px-4 py-2.5 text-sm ${brandId === brand.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/5 text-white/50'}`}>{brand.name}</button>)}</div>
    {data.organization_id ? <div className="rounded-xl bg-[#d3bb73]/[0.07] p-4 text-sm leading-6 text-white/65">
      <p>Branding organizacji jest wspólny dla wszystkich przypisanych do niej sprzedawców w marce {selectedBrand?.name}. Każdy z nich może go edytować w portalu. Wizytówka dotyczy wyłącznie wybranej osoby.</p>
      {partnerId && <Link href={`/crm/contacts/${data.organization_id}?tab=branding`} className="mt-2 inline-block text-xs text-[#d3bb73] hover:underline">Otwórz kartę organizacji</Link>}
    </div> : <p className="rounded-xl bg-white/[0.03] p-4 text-sm text-white/50">Sprzedawca niezależny — ustawienia dotyczą tylko jego ofert. Edytuje je w swoim portalu.</p>}
    {partnerId && <section className="grid gap-5 rounded-xl bg-[#1c1f33] p-5 md:grid-cols-[1fr_220px]">
      <div className="space-y-3"><h2 className="text-sm font-medium">Wizytówka sprzedawcy · podgląd</h2>
        <dl className="space-y-3">{([{ key: 'display_name', label: 'Imię i nazwisko' }, { key: 'position_title', label: 'Stanowisko' },
          { key: 'contact_email', label: 'E-mail' }, { key: 'contact_phone', label: 'Telefon' }] as const).map((field) =>
          <div key={field.key}><dt className="text-xs text-white/45">{field.label}</dt><dd className="mt-1 break-words text-sm">{branding[field.key] || 'Nie uzupełniono'}</dd></div>)}</dl>
      </div>
      <IdentityAssetPreview path={branding.portrait_url} alt="Zdjęcie sprzedawcy" className="h-48" />
    </section>}
    <OrganizationIdentitySummary value={branding} name={data.organization_name} shared={Boolean(data.organization_id)} />
    {hotelSpacesHref ? <Link href={hotelSpacesHref} className="block rounded-xl bg-white/5 p-4 text-sm text-[#d3bb73] hover:bg-white/10">Sale, rzuty i informacje techniczne edytujesz w zakładce „Sale i przestrzenie” →</Link>
      : data.organization_id && <HotelVenueSettings key={data.organization_id} organizationId={data.organization_id} crm />}
  </div>;
}
