'use client';

import { Suspense, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Building2, Check, Loader2, Palette, Settings, User } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { SellerBranding, useSellerPortalContext } from '@/lib/seller/portal';
import { identityAssetPatch, OfferVisualIdentityFields, SellerPersonalIdentityFields, uploadIdentityAssets, type IdentityAssetKind } from '@/components/seller/OfferIdentityFields';
import { sellerUploadedFonts } from '@/components/seller/OfferHeadingFontPicker';
import HotelVenueSettings from '@/components/seller/HotelVenueSettings';
import SellerOrganizationBrandingEditor from '@/components/seller/SellerOrganizationBrandingEditor';

const fieldClass = 'w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/55';

const profileTabs = [
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'business-card', label: 'Wizytówka sprzedawcy', icon: User },
  { id: 'spaces', label: 'Przestrzenie i kontakty', icon: Building2 },
  { id: 'general', label: 'Ogólne', icon: Settings },
] as const;
type ProfileTab = typeof profileTabs[number]['id'];
const isProfileTab = (value: string | null): value is ProfileTab => profileTabs.some((tab) => tab.id === value);
const legacyProfileTabs: Record<string, ProfileTab> = {
  '#organization-branding': 'branding',
  '#hotel-directory': 'spaces',
  '#general-terms': 'general',
  '#offer-organization': 'general',
};

function ProfileLoading() {
  return <div role="status" className="flex items-center justify-center gap-2 p-10 text-[#d3bb73]"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Ładowanie ustawień…</div>;
}

function SellerProfileSettings() {
  const { context, loading } = useSellerPortalContext();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requestedTab = searchParams.get('tab');
  const requestedBrand = searchParams.get('brand');
  const activeTab: ProfileTab = isProfileTab(requestedTab) ? requestedTab : 'branding';
  const [brandId, setBrandId] = useState('');
  const [form, setForm] = useState<SellerBranding>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<IdentityAssetKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savedForm, setSavedForm] = useState('');
  const [sharedDirty, setSharedDirty] = useState(false);
  const [sharedBusy, setSharedBusy] = useState(false);
  const uploadLock = useRef(false);

  const selectedBrand = context?.brands.find((brand) => brand.my_company_id === brandId);
  const organizationDirectoryReady = Boolean(context && Array.isArray(context.organizations)
    && context.default_offer_organization_id !== undefined);
  const organizations = context?.organizations || [];
  const organizationLinked = organizations.length > 0;
  const defaultOrganization = organizations.find((item) => item.id === context?.profile.organization_id);
  const hotelOrganization = defaultOrganization && (defaultOrganization.business_type === 'hotel'
    || context?.profile.partner_type === 'hotel_employee') ? defaultOrganization : null;
  const change = (patch: Partial<SellerBranding>) => setForm((current) => ({ ...current, ...patch }));
  const personalDirty = Boolean(savedForm) && JSON.stringify(form) !== savedForm;
  const personalFieldsDisabled = sharedBusy || !organizationDirectoryReady || saving || Boolean(uploading);
  const showPersonalSave = activeTab === 'business-card' || activeTab === 'general'
    || (activeTab === 'branding' && !organizationLinked);

  // Keep older bookmarks working now that their sections live in separate tabs.
  useEffect(() => {
    if (isProfileTab(requestedTab)) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', legacyProfileTabs[window.location.hash] || 'branding');
    router.replace(`${pathname}?${next}${window.location.hash}`, { scroll: false });
  }, [pathname, requestedTab, router, searchParams]);

  const openTab = (tab: ProfileTab) => {
    if (tab === activeTab) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', tab);
    if (brandId) next.set('brand', brandId);
    router.push(`${pathname}?${next}`, { scroll: false });
  };

  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = event.key === 'ArrowRight' ? (index + 1) % profileTabs.length
      : event.key === 'ArrowLeft' ? (index + profileTabs.length - 1) % profileTabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? profileTabs.length - 1 : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = profileTabs[nextIndex];
    document.getElementById(`seller-profile-tab-${nextTab.id}`)?.focus();
    openTab(nextTab.id);
  };

  useEffect(() => {
    if (!personalDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [personalDirty]);

  useEffect(() => {
    if (!context) return;
    setBrandId(context.brands.find((brand) => brand.my_company_id === requestedBrand)?.my_company_id || context.brands[0]?.my_company_id || '');
  }, [context, requestedBrand]);

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

  const uploadAssets = async (files: File[], kind: IdentityAssetKind) => {
    if (!organizationDirectoryReady || !files.length || !context || !brandId || saving || sharedBusy || uploadLock.current) return;
    if (organizationLinked && kind !== 'portrait') { setMessage('Pliki organizacji wgraj w zakładce „Branding”.'); return; }
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
    if (!organizationDirectoryReady || !brandId || saving || sharedBusy || uploadLock.current) return;
    setSaving(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc('save_seller_portal_settings', {
        p_branding: { ...form, my_company_id: brandId, default_commercial_model: selectedBrand?.commission_enabled === true ? form.default_commercial_model || 'markup' : 'markup' },
      });
      if (error) throw error;
      setSavedForm(JSON.stringify(form));
      setMessage(organizationLinked
        ? 'Zapisano Twoją wizytówkę i warunki nowych ofert. Wspólny branding organizacji zapisujesz osobno w zakładce „Branding”.'
        : 'Zapisano Twoje ustawienia. Istniejące oferty i zapisane PDF-y pozostają bez zmian.');
    } catch (cause) {
      const error = cause as { code?: string; message?: string };
      setMessage(error.code === 'PGRST202' ? 'Nie udało się zapisać ustawień. Spróbuj ponownie później lub napisz do opiekuna MAVINCI.' : error.message || 'Nie udało się zapisać ustawień. Spróbuj ponownie.');
    } finally { setSaving(false); }
  };

  // Commission terms stay hidden until MAVINCI reveals them for this brand.
  const commissionVisible = selectedBrand?.commission_enabled === true && selectedBrand.commissions_visible === true;
  // A saved catalog-price model remains selectable silently, without rates.
  const showCatalogModel = selectedBrand?.commission_enabled === true && (commissionVisible || selectedBrand.branding?.default_commercial_model === 'commission');

  if (loading && !context) return <ProfileLoading />;
  if (!context) return <div className="p-10 text-center text-white/40">Brak dostępu do portalu sprzedawcy.</div>;

  return (
    <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header><div className="flex items-center gap-3"><span className="rounded-xl bg-[#d3bb73]/10 p-3"><Settings className="h-5 w-5 text-[#d3bb73]" /></span><div><h1 className="text-2xl font-light">Ustawienia</h1><p className="mt-1 text-sm text-white/40">Wygląd ofert, Twoja wizytówka oraz baza przestrzeni.</p></div></div></header>

        <div role="tablist" aria-label="Ustawienia sprzedawcy" className="flex gap-2 overflow-x-auto pb-1">
          {profileTabs.map((tab, index) => <button key={tab.id} id={`seller-profile-tab-${tab.id}`} type="button" role="tab"
            aria-selected={activeTab === tab.id} aria-controls={`seller-profile-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => openTab(tab.id)} onKeyDown={(event) => navigateTabs(event, index)}
            className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-3 text-sm transition focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#d3bb73]/50 ${activeTab === tab.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/[0.03] text-white/55 hover:bg-white/5 hover:text-white/80'}`}>
            <tab.icon aria-hidden="true" className="h-4 w-4" />{tab.label}
          </button>)}
        </div>
        {message && <div role="status" className="rounded-lg bg-sky-300/10 p-3 text-sm text-sky-100">{message}</div>}

        <section hidden={activeTab === 'spaces'} className="rounded-xl bg-[#1c1f33] p-5">
          <label className="block max-w-md text-xs text-white/50">Marka Mavinci<select value={brandId} disabled={saving || sharedBusy || Boolean(uploading)} onChange={(event) => {
            if (event.target.value !== brandId && (!(personalDirty || sharedDirty) || window.confirm('Porzucić niezapisane ustawienia osobiste i branding organizacji przed zmianą marki?'))) {
              setBrandId(event.target.value); setMessage('');
              const next = new URLSearchParams(searchParams.toString());
              next.set('brand', event.target.value); next.set('tab', activeTab);
              router.replace(`${pathname}?${next}`, { scroll: false });
            }
          }} className={`${fieldClass} mt-1.5`}>{context.brands.map((brand) => <option key={brand.my_company_id} value={brand.my_company_id}>{brand.name}</option>)}</select></label>
        </section>

        {/* Keep editors mounted: switching tabs must not discard pending edits or uploads. */}
        <section id="seller-profile-panel-branding" role="tabpanel" aria-labelledby="seller-profile-tab-branding" tabIndex={0} hidden={activeTab !== 'branding'} className="space-y-5">
          {organizationDirectoryReady && organizationLinked && brandId && <SellerOrganizationBrandingEditor
            companyId={brandId} companyName={selectedBrand?.name || ''} partnerId={context.profile.id}
            organizations={organizations} initialOrganizationId={context.profile.organization_id}
            disabled={saving || Boolean(uploading)} onDirtyChange={setSharedDirty} onBusyChange={setSharedBusy} />}
          {organizationDirectoryReady && !organizationLinked && <fieldset disabled={personalFieldsDisabled} className="min-w-0 space-y-5">
            <OfferVisualIdentityFields companyId={brandId} value={form} onChange={change} onUpload={uploadAssets} uploading={uploading} disabled={personalFieldsDisabled} />
          </fieldset>}
          {!organizationDirectoryReady && <p role="alert" className="rounded-xl bg-amber-300/10 p-5 text-sm text-amber-200">Brak aktualnych danych organizacji. Poproś opiekuna o sprawdzenie dostępu do ustawień.</p>}
        </section>

        <section id="seller-profile-panel-business-card" role="tabpanel" aria-labelledby="seller-profile-tab-business-card" tabIndex={0} hidden={activeTab !== 'business-card'}>
          <fieldset disabled={personalFieldsDisabled} className="min-w-0 space-y-5">
            <SellerPersonalIdentityFields value={form} onChange={change} onUpload={uploadAssets} uploading={uploading} disabled={personalFieldsDisabled} />
          </fieldset>
        </section>

        <section id="seller-profile-panel-spaces" role="tabpanel" aria-labelledby="seller-profile-tab-spaces" tabIndex={0} hidden={activeTab !== 'spaces'}>
          {hotelOrganization ? <HotelVenueSettings key={hotelOrganization.id} organizationId={hotelOrganization.id} /> : <div className="space-y-2 rounded-xl bg-[#1c1f33] p-5">
            <h2 className="text-sm font-medium">Przestrzenie i kontakty</h2>
            <p className="text-sm leading-6 text-white/55">{defaultOrganization
              ? 'Baza przestrzeni jest dostępna dla organizacji hotelowych. Typ organizacji i powiązanie z lokalizacją ustawia opiekun w CRM.'
              : 'Opiekun musi przypisać hotel do Twojego profilu w CRM, aby udostępnić jego sale, plany i kontakty.'}</p>
          </div>}
        </section>

        <section id="seller-profile-panel-general" role="tabpanel" aria-labelledby="seller-profile-tab-general" tabIndex={0} hidden={activeTab !== 'general'} className="space-y-5">
          <section id="offer-organization" className="scroll-mt-4 space-y-3 rounded-xl bg-[#1c1f33] p-5">
            <h2 className="text-sm uppercase">Organizacja, w imieniu której tworzysz oferty</h2>
            <p className="text-sm">{defaultOrganization?.name || 'Brak aktualnej organizacji przypisanej przez CRM'}</p>
            <p className="text-xs leading-5 text-white/50">Organizację nowych ofert przypisuje opiekun w CRM. Branding i wizytówkę zmienisz w osobnych zakładkach. Dotychczasowe oferty zachowują wcześniejsze powiązania.</p>
          </section>
          <fieldset disabled={personalFieldsDisabled} className="min-w-0">
          <section id="general-terms" className="scroll-mt-4 rounded-xl bg-[#1c1f33] p-5">
          <h2 className="text-sm font-medium">Ogólne warunki</h2>
          <p className="mt-1 text-xs text-white/45">Sposób rozliczenia nowych ofert dla marki {selectedBrand?.name}. Zmiana nie przelicza istniejących ofert.</p>
          <div className={`mt-4 grid gap-3 ${showCatalogModel ? 'md:grid-cols-2' : ''}`}>
            <button type="button" aria-pressed={form.default_commercial_model !== 'commission'} onClick={() => setForm({ ...form, default_commercial_model: 'markup' })}
              className={`rounded-lg p-4 text-left transition ${form.default_commercial_model !== 'commission' ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/[0.03] text-white/70 hover:bg-white/5'}`}>
              <span className="text-sm">Własna cena hotelu</span>
              <span className="mt-1 block text-xs text-white/50">Podajesz cenę klienta. Różnica względem Twojego cennika MAVINCI stanowi marżę hotelu.</span>
            </button>
            {showCatalogModel && <button type="button" aria-pressed={form.default_commercial_model === 'commission'} onClick={() => setForm({ ...form, default_commercial_model: 'commission' })}
              className={`rounded-lg p-4 text-left transition ${form.default_commercial_model === 'commission' ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/[0.03] text-white/70 hover:bg-white/5'}`}>
              {commissionVisible ? <>
                <span className="text-sm">Prowizja procentowa</span>
                <span className="mt-1 block text-xs text-white/50">Stawka ustalona z MAVINCI: {Number(selectedBrand?.default_commission_rate || 0)}%. Klient otrzymuje ceny z Twojego cennika.</span>
              </> : <>
                <span className="text-sm">Ceny z cennika MAVINCI</span>
                <span className="mt-1 block text-xs text-white/50">Klient otrzymuje ceny z Twojego cennika MAVINCI. Warunki współpracy ustalasz z opiekunem.</span>
              </>}
            </button>}
          </div>
          </section>
          </fieldset>
        </section>

        {showPersonalSave && <div className="flex flex-wrap items-center justify-end gap-3">
          {personalDirty && <span className="text-xs text-amber-200">Niezapisane zmiany ustawień osobistych</span>}
          <button type="button" disabled={personalFieldsDisabled || !brandId || !personalDirty} onClick={save} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-3 text-sm font-medium text-[#111522] disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {organizationLinked ? 'Zapisz ustawienia osobiste' : 'Zapisz ustawienia'}</button>
        </div>}
      </div>
    </div>
  );
}

export default function SellerBrandProfilePage() {
  return <Suspense fallback={<ProfileLoading />}><SellerProfileSettings /></Suspense>;
}
