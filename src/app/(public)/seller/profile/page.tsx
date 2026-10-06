'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Settings } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { SellerBranding, useSellerPortalContext } from '@/lib/seller/portal';
import { identityAssetPatch, OfferVisualIdentityFields, OrganizationIdentitySummary, SellerPersonalIdentityFields, uploadIdentityAssets, type IdentityAssetKind } from '@/components/seller/OfferIdentityFields';
import { sellerUploadedFonts } from '@/components/seller/OfferHeadingFontPicker';
import HotelVenueSettings from '@/components/seller/HotelVenueSettings';
import SearchCombobox from '@/components/crm/SearchCombobox';

const fieldClass = 'w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/55';

export default function SellerBrandProfilePage() {
  const { context, loading, reload } = useSellerPortalContext();
  const [brandId, setBrandId] = useState('');
  const [form, setForm] = useState<SellerBranding>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<IdentityAssetKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [defaultOrganizationId, setDefaultOrganizationId] = useState('');
  const [savingOrganization, setSavingOrganization] = useState(false);
  const [savedForm, setSavedForm] = useState('');
  const uploadLock = useRef(false);

  const selectedBrand = context?.brands.find((brand) => brand.my_company_id === brandId);
  const organizationDirectoryReady = Boolean(context && Array.isArray(context.organizations)
    && context.default_offer_organization_id !== undefined);
  const organizations = context?.organizations || [];
  const organizationLinked = organizations.length > 0;
  const defaultOrganization = organizations.find((item) => item.id === context?.default_offer_organization_id);
  const change = (patch: Partial<SellerBranding>) => setForm((current) => ({ ...current, ...patch }));

  useEffect(() => { setDefaultOrganizationId(context?.default_offer_organization_id || ''); }, [context]);

  useEffect(() => {
    if (!context || brandId) return;
    const requestedBrand = new URLSearchParams(window.location.search).get('brand');
    setBrandId(context.brands.find((brand) => brand.my_company_id === requestedBrand)?.my_company_id || context.brands[0]?.my_company_id || '');
  }, [brandId, context]);

  useEffect(() => {
    if (!selectedBrand || !context) return;
    const nextForm: SellerBranding = {
      ...selectedBrand.branding,
      default_commercial_model: selectedBrand.commission_enabled === true
        ? selectedBrand.branding?.default_commercial_model || 'markup'
        : 'markup',
      display_name: selectedBrand.branding?.display_name || context.profile.person.name,
      position_title: selectedBrand.branding?.position_title || context.profile.person.position || '',
      contact_email: selectedBrand.branding?.contact_email || context.profile.person.email || '',
      contact_phone: selectedBrand.branding?.contact_phone || context.profile.person.phone || '',
      portrait_url: selectedBrand.branding?.portrait_url || context.profile.person.photo_url || '',
      hotel_logo_url: selectedBrand.branding?.hotel_logo_url || '',
      hotel_cover_image_url: selectedBrand.branding?.hotel_cover_image_url || '',
      brandbook_url: selectedBrand.branding?.brandbook_url || '',
      venue_image_urls: selectedBrand.branding?.venue_image_urls || [],
      brand_primary_color: selectedBrand.branding?.brand_primary_color || '#1c1f33',
      brand_secondary_color: selectedBrand.branding?.brand_secondary_color || '#d3bb73',
      brandbook_notes: selectedBrand.branding?.brandbook_notes || '',
      footer_text: selectedBrand.branding?.footer_text || '',
      disclosure_text: selectedBrand.branding?.disclosure_text || '',
    };
    setForm(nextForm);
    setSavedForm(JSON.stringify(nextForm));
  }, [context, selectedBrand]);

  const saveDefaultOrganization = async () => {
    if (!organizationDirectoryReady || !defaultOrganizationId || savingOrganization || saving || uploadLock.current) return;
    if (JSON.stringify(form) !== savedForm && !window.confirm('Zmiana domyślnej organizacji wczyta jej branding. Porzucić niezapisane zmiany ustawień i wizytówki?')) return;
    setSavingOrganization(true); setMessage(null);
    try {
      const { error: failed } = await supabase.rpc('save_seller_default_offer_organization', { p_organization: defaultOrganizationId });
      if (failed) throw failed;
      await reload();
      setMessage('Zapisano domyślną organizację dla nowych ofert. Istniejące oferty pozostają przypisane do swoich organizacji.');
    } catch (cause) {
      const failed = cause as { code?: string; message?: string };
      setMessage(['PGRST202', '42883'].includes(failed.code || '') ? 'Wybór organizacji wymaga migracji 20260928160000_seller_offer_organization_selection.sql.' : failed.message || 'Nie udało się zapisać domyślnej organizacji.');
    } finally { setSavingOrganization(false); }
  };

  const uploadAssets = async (files: File[], kind: IdentityAssetKind) => {
    if (!organizationDirectoryReady || !files.length || !context || !brandId || saving || uploadLock.current) return;
    if (organizationLinked && kind !== 'portrait') { setMessage('Branding organizacji uzupełnia opiekun w CRM.'); return; }
    uploadLock.current = true;
    setUploading(kind);
    setMessage(null);
    try {
      const paths = await uploadIdentityAssets({ files, kind, companyId: brandId, partnerId: context.profile.id, galleryCount: form.venue_image_urls?.length || 0, fontCount: sellerUploadedFonts(form).length });
      setForm((current) => ({ ...current, ...identityAssetPatch(kind, paths, current, files) }));
      setMessage('Plik wgrany. Zapisz ustawienia, aby zastosować go w ofercie.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się wgrać pliku.'); }
    finally { uploadLock.current = false; setUploading(null); }
  };

  const save = async () => {
    if (!organizationDirectoryReady || !brandId || saving || uploadLock.current) return;
    setSaving(true);
    setMessage(null);
    const { error } = await supabase.rpc('save_seller_portal_settings', {
      p_branding: { ...form, my_company_id: brandId, default_commercial_model: selectedBrand?.commission_enabled === true ? form.default_commercial_model || 'markup' : 'markup' },
    });
    setSaving(false);
    if (error) { setMessage(error.code === 'PGRST202' ? 'Zapis ustawień wymaga aktualizacji bazy przez opiekuna.' : error.message); return; }
    setMessage('Zapisano. Nowo generowane PDF-y użyją aktualnej wizytówki i brandingu. Poprzednie pliki pozostają bez zmian.');
    await reload();
  };

  if (loading) return <div className="p-10 text-center text-[#d3bb73]">Ładowanie profilu...</div>;
  if (!context) return <div className="p-10 text-center text-white/40">Brak dostępu do portalu sprzedawcy.</div>;

  return (
    <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header><div className="flex items-center gap-3"><span className="rounded-xl bg-[#d3bb73]/10 p-3"><Settings className="h-5 w-5 text-[#d3bb73]" /></span><div><h1 className="text-2xl font-light">Ustawienia</h1><p className="mt-1 text-sm text-white/40">Ogólne warunki oraz wygląd ofert przygotowywanych dla klientów.</p></div></div></header>
        {message && <div className="rounded-lg border border-sky-300/20 bg-sky-300/10 p-3 text-sm text-sky-100">{message}</div>}

        <section id="offer-organization" className="scroll-mt-4 space-y-3 rounded-xl bg-[#1c1f33] p-5">
          <h2 className="text-sm uppercase">Organizacja, w imieniu której tworzysz oferty</h2>
          <p className="text-xs leading-5 text-white/50">Ten wybór określa logo, kolory, branding PDF oraz podpowiedzi sal i kontaktów. Nie zmienia marki realizującej ani cennika. Dotyczy domyślnie nowych ofert — w kreatorze możesz wybrać inną przypisaną organizację.</p>
          {!organizationDirectoryReady ? <p role="alert" className="rounded-lg bg-amber-300/10 p-3 text-sm leading-6 text-amber-100">Baza danych nie udostępnia jeszcze listy powiązanych organizacji. Nie oznacza to braku przypisań. Wymagane są migracje 20260928143000_seller_hotel_contact_organizations.sql i 20260928160000_seller_offer_organization_selection.sql. Po ich wdrożeniu odśwież tę stronę.</p> : organizations.length > 0 ? <>
            <div className="max-w-lg"><SearchCombobox value={defaultOrganizationId} options={organizations.map((item) => ({ id: item.id, label: item.name }))}
              onChange={setDefaultOrganizationId} allowClear={false} disabled={savingOrganization || saving || Boolean(uploading)} ariaLabel="Domyślna organizacja ofert" placeholder="Wybierz domyślną organizację…"/></div>
            <p className="text-xs text-white/50">{organizations.length === 1 ? 'To jedyna aktualnie przypisana organizacja — została wybrana automatycznie.' : `Liczba powiązanych organizacji: ${organizations.length}. Wybierz z listy domyślną dla nowych ofert.`}</p>
            {organizations.length > 1 &&
            <button type="button" disabled={!defaultOrganizationId || defaultOrganizationId === context.default_offer_organization_id || savingOrganization || saving || Boolean(uploading)} onClick={() => void saveDefaultOrganization()} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2.5 text-sm text-[#d3bb73] disabled:opacity-40">{savingOrganization && <Loader2 className="h-4 w-4 animate-spin"/>}Zapisz domyślną organizację</button>
            }
          </> : <p className="text-sm text-white/60">Nie masz przypisanej organizacji. Oferty korzystają z Twojej własnej identyfikacji.</p>}
        </section>

        <fieldset disabled={savingOrganization || !organizationDirectoryReady} className="min-w-0 space-y-5">

        <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
          <label className="block max-w-md text-xs text-white/50">Marka Mavinci<select value={brandId} disabled={saving || Boolean(uploading)} onChange={(event) => setBrandId(event.target.value)} className={`${fieldClass} mt-1.5`}>{context.brands.map((brand) => <option key={brand.my_company_id} value={brand.my_company_id}>{brand.name}</option>)}</select></label>
        </section>

        <section id="general-terms" className="scroll-mt-4 rounded-xl bg-[#1c1f33] p-5">
          <h2 className="text-sm font-medium">Ogólne warunki</h2>
          <p className="mt-1 text-xs text-white/45">Sposób rozliczenia nowych ofert dla marki {selectedBrand?.name}. Zmiana nie przelicza istniejących ofert.</p>
          <div className={`mt-4 grid gap-3 ${selectedBrand?.commission_enabled === true ? 'md:grid-cols-2' : ''}`}>
            <button type="button" aria-pressed={form.default_commercial_model !== 'commission'} onClick={() => setForm({ ...form, default_commercial_model: 'markup' })}
              className={`rounded-lg p-4 text-left transition ${form.default_commercial_model !== 'commission' ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/[0.03] text-white/70 hover:bg-white/5'}`}>
              <span className="text-sm">Własna cena hotelu</span>
              <span className="mt-1 block text-xs text-white/50">Podajesz cenę klienta. Różnica względem Twojego cennika MAVINCI stanowi marżę hotelu.</span>
            </button>
            {selectedBrand?.commission_enabled === true && <button type="button" aria-pressed={form.default_commercial_model === 'commission'} onClick={() => setForm({ ...form, default_commercial_model: 'commission' })}
              className={`rounded-lg p-4 text-left transition ${form.default_commercial_model === 'commission' ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/[0.03] text-white/70 hover:bg-white/5'}`}>
              <span className="text-sm">Prowizja procentowa</span>
              <span className="mt-1 block text-xs text-white/50">Stawka ustalona w CRM: {Number(selectedBrand.default_commission_rate || 0)}%. Klient otrzymuje ceny z Twojego cennika.</span>
            </button>}
          </div>
        </section>

        <SellerPersonalIdentityFields value={form} onChange={change} onUpload={uploadAssets} uploading={uploading} disabled={saving || Boolean(uploading)} />
        {!organizationDirectoryReady ? null : organizationLinked
          ? defaultOrganization ? <OrganizationIdentitySummary value={selectedBrand?.branding || {}} name={defaultOrganization.name} /> : <p className="rounded-xl bg-white/[0.035] p-5 text-sm text-white/60">Wybierz i zapisz domyślną organizację powyżej, aby zobaczyć jej branding. Branding wspólny uzupełnia CRM.</p>
          : <OfferVisualIdentityFields companyId={brandId} value={form} onChange={change} onUpload={uploadAssets} uploading={uploading} disabled={saving || Boolean(uploading)} />}

        <div className="flex justify-end"><button type="button" disabled={saving || Boolean(uploading)} onClick={save} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-3 text-sm font-medium text-[#111522] disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Zapisz ustawienia</button></div>
        </fieldset>
        {defaultOrganization && (defaultOrganization.business_type === 'hotel' || (context.profile.partner_type === 'hotel_employee' && defaultOrganization.id === context.profile.organization_id)) && <HotelVenueSettings key={defaultOrganization.id} organizationId={defaultOrganization.id} />}
      </div>
    </div>
  );
}
