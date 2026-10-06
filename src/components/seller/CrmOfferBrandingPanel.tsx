'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Palette } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import type { SellerBranding } from '@/lib/seller/portal';
import { identityAssetPatch, OfferVisualIdentityFields, SellerPersonalIdentityFields, uploadIdentityAssets, type IdentityAssetKind } from './OfferIdentityFields';
import { sellerUploadedFonts } from './OfferHeadingFontPicker';
import HotelVenueSettings from './HotelVenueSettings';

type BrandingContext = {
  organization_id: string | null;
  organization_name: string | null;
  brands: { id: string; name: string; can_manage: boolean; branding: SellerBranding }[];
};

export default function CrmOfferBrandingPanel({ partnerId, organizationId, hotelSpacesHref }: { partnerId?: string; organizationId?: string; hotelSpacesHref?: string }) {
  const [data, setData] = useState<BrandingContext | null>(null);
  const [brandId, setBrandId] = useState('');
  const [form, setForm] = useState<SellerBranding>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<IdentityAssetKind | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const selectedBrand = data?.brands.find((brand) => brand.id === brandId);
  const canEdit = selectedBrand?.can_manage === true;

  const reload = useCallback(async () => {
    const { data: loaded, error: failed } = await supabase.rpc('get_crm_offer_branding', { p_partner: partnerId || null, p_organization: organizationId || null });
    if (!alive.current) return;
    setLoading(false);
    if (failed) {
      setError(['PGRST202', '42883', '42P01'].includes(failed.code) ? 'Ustawienia wymagają migracji 20260909120000_organization_seller_offer_branding.sql.' : failed.message);
      return;
    }
    const next = loaded as BrandingContext;
    setData(next);
    setBrandId((current) => next.brands.some((brand) => brand.id === current) ? current : next.brands[0]?.id || '');
    setError('');
  }, [partnerId, organizationId]);
  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; }; }, [reload]);
  useEffect(() => { if (selectedBrand) { setForm(selectedBrand.branding); setDirty(false); } }, [selectedBrand]);

  const change = (patch: Partial<SellerBranding>) => { setForm((current) => ({ ...current, ...patch })); setDirty(true); setMessage(''); };
  const upload = async (files: File[], kind: IdentityAssetKind) => {
    if (!canEdit || lock.current || !data) return;
    lock.current = true; setUploading(kind); setError('');
    try {
      const paths = await uploadIdentityAssets({ files, kind, partnerId, companyId: brandId, organizationId: data.organization_id, galleryCount: form.venue_image_urls?.length || 0, fontCount: sellerUploadedFonts(form).length });
      if (alive.current) { setForm((current) => ({ ...current, ...identityAssetPatch(kind, paths, current, files) })); setDirty(true); setMessage('Plik wgrany. Zapisz ustawienia, aby zastosować go w ofertach.'); }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Nie udało się wgrać pliku.'); }
    finally { lock.current = false; if (alive.current) setUploading(null); }
  };
  const save = async () => {
    if (!canEdit || lock.current || !data) return;
    lock.current = true; setSaving(true); setError(''); setMessage('');
    try {
      const { error: failed } = await supabase.rpc('save_crm_offer_branding', {
        p_company: brandId, p_partner: partnerId || null, p_organization: data.organization_id, p_branding: form,
      });
      if (failed) throw new Error(failed.message);
      if (!alive.current) return;
      setDirty(false);
      await reload();
      if (alive.current) setMessage('Zapisano. Nowo generowane wersje ofert użyją aktualnego brandingu i wizytówki. Istniejące pliki PDF pozostają bez zmian.');
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać ustawień.'); }
    finally { lock.current = false; if (alive.current) setSaving(false); }
  };

  if (loading) return <p className="flex items-center gap-2 p-5 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" />Wczytywanie brandingu…</p>;
  if (!data) return <p role="alert" className="rounded-xl bg-amber-300/5 p-5 text-sm text-amber-200">{error || 'Brak dostępnych ustawień.'}</p>;
  return <div className="space-y-5 text-[#e5e4e2]">
    <header><h2 className="flex items-center gap-2 text-lg"><Palette className="h-5 w-5 text-[#d3bb73]" />Branding ofert{data.organization_name ? ` · ${data.organization_name}` : ''}</h2><p className="mt-2 text-sm leading-6 text-white/50">Ten sam układ PDF co w ofertach CRM, z własnym logo, paletą i czcionką nagłówków.</p></header>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Marka realizująca">{data.brands.map((brand) => <button type="button" key={brand.id} disabled={saving || Boolean(uploading)} aria-pressed={brandId === brand.id} onClick={() => { if (brand.id !== brandId && (!dirty || window.confirm('Porzucić niezapisane zmiany tej marki?'))) { setBrandId(brand.id); setError(''); setMessage(''); } }} className={`rounded-lg px-4 py-2.5 text-sm ${brandId === brand.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/5 text-white/50'}`}>{brand.name}</button>)}</div>
    {data.organization_id ? <div className="rounded-xl bg-[#d3bb73]/[0.07] p-4 text-sm leading-6 text-white/65"><p>Logo, zdjęcia obiektu, kolory, czcionka i tekst organizacji są wspólne dla wszystkich jej sprzedawców w marce {selectedBrand?.name}. Wizytówka dotyczy tylko wybranej osoby.</p>{partnerId && <Link href={`/crm/contacts/${data.organization_id}?tab=branding`} className="mt-2 inline-block text-xs text-[#d3bb73] hover:underline">Otwórz branding w karcie organizacji</Link>}</div> : <p className="rounded-xl bg-white/[0.03] p-4 text-sm text-white/50">Sprzedawca niezależny — wszystkie ustawienia dotyczą wyłącznie jego ofert. Może również edytować je w swoim portalu.</p>}
    {!canEdit && <p className="text-sm text-amber-200">Masz dostęp tylko do odczytu ustawień tej marki.</p>}
    {error && <p role="alert" className="rounded-lg bg-amber-300/10 p-4 text-sm text-amber-200">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-emerald-300/10 p-4 text-sm text-emerald-200">{message}</p>}
    {partnerId && <SellerPersonalIdentityFields value={form} onChange={change} onUpload={upload} disabled={!canEdit || saving || Boolean(uploading)} uploading={uploading} />}
    <OfferVisualIdentityFields companyId={brandId} value={form} onChange={change} onUpload={upload} disabled={!canEdit || saving || Boolean(uploading)} uploading={uploading} />
    {canEdit && <div className="flex justify-end"><button type="button" disabled={saving || Boolean(uploading) || !dirty} onClick={() => void save()} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-3 text-sm font-medium text-[#210811] disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{saving ? 'Zapisywanie…' : partnerId ? 'Zapisz branding i wizytówkę' : 'Zapisz branding organizacji'}</button></div>}
    {hotelSpacesHref ? <Link href={hotelSpacesHref} className="block rounded-xl bg-white/5 p-4 text-sm text-[#d3bb73] hover:bg-white/10">Sale, rzuty i informacje techniczne edytujesz w zakładce „Sale i przestrzenie” →</Link>
      : data.organization_id && <HotelVenueSettings key={data.organization_id} organizationId={data.organization_id} crm />}
  </div>;
}
