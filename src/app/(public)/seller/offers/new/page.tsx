'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, Loader2, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { sellerCommissionsVisible, sellerMoney, useSellerPortalContext } from '@/lib/seller/portal';
import SellerDatePicker from '../../_components/SellerDatePicker';
import SellerClientPicker from '../../_components/SellerClientPicker';
import SellerEventSchedule from '@/components/seller/SellerEventSchedule';
import { buildSellerEventSchedule, hasLegacySellerEventRange, sellerEventDaysFrom, validSellerDay, type SellerEventDay } from '@/lib/seller/eventSchedule';
import SearchCombobox from '@/components/crm/SearchCombobox';
import { TechnicalDetailsView } from '@/components/crm/locations/LocationTechnicalDetails';
import type { SellerHotelContext } from '@/lib/seller/hotel';
import type { SellerArrangements } from '@/lib/seller/arrangements';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import SellerProductConfigurator from '@/components/seller/SellerProductConfigurator';
import SellerOfferItems, { type SellerDraftItem as DraftItem } from '@/components/seller/SellerOfferItems';
import { sellerItemLayout } from '@/lib/seller/offerPresentation';
import type { OfferConfiguration } from '@/lib/CRM/Offers/offerAddons';
import type { SellerConfigurationQuote } from '@/lib/seller/productConfiguration';
import { useSnackbar } from '@/contexts/SnackbarContext';
import type { OfferRecommendation } from '@/app/(crm)/crm/offers/[id]/components/offerRecommendation';
import SellerOfferCatalog, { catalogItemKey, useSellerCatalogImages, type CatalogProduct, type ProductVariant } from '@/components/seller/SellerOfferCatalog';

const offerErrorMessage = (error: { code?: string; message?: string } | null | undefined, fallback: string) => {
  if (error?.code === '42703' && /\b(sent_at|viewed_at)\b/.test(error.message || '')) {
    return 'Błąd funkcji zapisu edytowanej oferty (OFERTA-ZAPIS-01). Dane formularza pozostają zachowane. To problem systemu, nie wpisanej daty — poproś opiekuna o poprawkę zapisu.';
  }
  if (['42703', '42P01', '42883', 'PGRST202', 'PGRST204'].includes(error?.code || '')) {
    return 'Nie można teraz zapisać lub odczytać oferty. Dane formularza pozostają zachowane — spróbuj ponownie później lub napisz do opiekuna MAVINCI.';
  }
  if (['42501', 'PGRST301', 'PGRST303'].includes(error?.code || '')) {
    return 'Brak uprawnień lub sesja wygasła. Zaloguj się ponownie i spróbuj jeszcze raz.';
  }
  if (error?.code === 'P0001') {
    if (/Opiekun musi|opiekun|Ustalenia|Przestrzeń|przestrze|Hotel nie ma/.test(error.message || '')) return error.message!;
    if (/układ|konfiguracj|wycen|liczbę dni|harmonogram|godzin|Dzień|Dni wydarzenia|Data oferty/i.test(error.message || '')) return error.message!;
    if (/organizacj|Najpierw usuń salę/.test(error.message || '')) return error.message!;
    if (/Produkt nie jest dostępny/.test(error.message || '')) return 'Jedna z usług nie jest już dostępna w Twoim cenniku. Odśwież katalog i popraw ofertę.';
    if (/Brak dost[eę]pu|Marka nie jest przypisana/.test(error.message || '')) return 'Nie masz dostępu do tej oferty lub marki. Skontaktuj się z opiekunem Mavinci.';
    return 'Nie można zapisać oferty z tymi danymi. Sprawdź pozycje i ustawienia oferty lub skontaktuj się z opiekunem Mavinci.';
  }
  return fallback;
};

const fieldClass = 'min-h-11 w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/55';
const wizardSteps = [
  { id: 'guest', label: 'Gość i termin', hint: 'Klient, data, liczba gości i miejsce' },
  { id: 'services', label: 'Usługi', hint: 'Katalog MAVINCI i wybrane pozycje' },
  { id: 'summary', label: 'Podsumowanie', hint: 'Ceny, opis i zapis oferty' },
] as const;
const FORECAST_NOTE = 'szacunek przed kosztami wykonawców zewnętrznych';
const LEAVE_MESSAGE = 'Masz niezapisane zmiany w ofercie. Opuścić kreator bez zapisu?';

export default function NewSellerOfferPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { context, loading: contextLoading } = useSellerPortalContext();
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [configuring, setConfiguring] = useState<{ productId: string; itemKey?: string; initial?: OfferConfiguration } | null>(null);
  const [recommendations, setRecommendations] = useState<OfferRecommendation[]>([]);
  const [recommendationAlert, setRecommendationAlert] = useState<string | null>(null);
  const [brandId, setBrandId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [editorLoading, setEditorLoading] = useState(true);
  const [editorError, setEditorError] = useState('');
  const [editorRetry, setEditorRetry] = useState(0);
  const [editorBranding, setEditorBranding] = useState<{ id?: string; default_commercial_model?: 'markup' | 'commission' } | null>(null);
  const [hotel, setHotel] = useState<SellerHotelContext | null>(null);
  const [arrangements, setArrangements] = useState<SellerArrangements | null>(null);
  const [roomId, setRoomId] = useState('');
  const [roomChanged, setRoomChanged] = useState(false);
  const [editingCommercialModel, setEditingCommercialModel] = useState<'markup' | 'commission'>('markup');
  const [catalogAlert, setCatalogAlert] = useState<string | null>(null);
  const [title, setTitle] = useState('Oferta obsługi wydarzenia');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventDateValid, setEventDateValid] = useState(true);
  const [eventDays, setEventDays] = useState<SellerEventDay[] | null>(null);
  const [scheduleChanged, setScheduleChanged] = useState(false);
  const scheduledDays = useMemo(() => eventDays ?? sellerEventDaysFrom(arrangements?.values, eventDate), [eventDays, arrangements, eventDate]);
  const eventSchedule = buildSellerEventSchedule(scheduledDays);
  const hasEventDate = validSellerDay(scheduledDays[0]?.date || '');
  const [validUntilValid, setValidUntilValid] = useState(true);
  const [eventLocation, setEventLocation] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientCompany, setClientCompany] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [guestCount, setGuestCount] = useState('');
  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [customError, setCustomError] = useState('');
  const customTriggerRef = useRef<HTMLElement | null>(null);
  const customNameRef = useRef<HTMLInputElement>(null);
  const wizardTopRef = useRef<HTMLDivElement>(null);
  const leavingRef = useRef(false);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStage, setSaveStage] = useState('Zapisywanie oferty');
  const pendingPdfRef = useRef<{ offerId: string; requestId: string; contentKey: string } | null>(null);
  const saveLockRef = useRef(false);
  const saveRequestRef = useRef<string | null>(null);
  const saveErrorRef = useRef<HTMLDivElement>(null);
  const [error, setErrorState] = useState<string | null>(null);
  const setError = useCallback((message: string | null) => {
    setErrorState(message);
    if (message) showSnackbar(message, 'error', 8000);
  }, [showSnackbar]);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [editingLoading, setEditingLoading] = useState(false);

  useEffect(() => {
    const offerId = new URLSearchParams(window.location.search).get('offer');
    if (!offerId) return;
    setEditingLoading(true);
    setEditingOfferId(offerId);
    void (async () => {
      const { data, error: offerError } = await supabase
        .from('offers')
        .select('id,my_company_id,partner_organization_id,partner_branding_snapshot,partner_branding_profile_id,commercial_model,partner_commission_rate,title,description,event_date,event_location,valid_until,portal_client_name,portal_client_company,portal_client_email,portal_client_phone,guest_count,recommended_items,offer_items(id,product_id,product_variant_id,name,description,quantity,unit,base_partner_unit_price,client_unit_price,is_partner_custom,display_order,partner_source_snapshot,pricing_configuration,seller_configuration_quote_id,days,offer_page_variant_override)')
        .eq('id', offerId)
        .eq('sales_channel', 'seller_portal')
        .maybeSingle();
      if (offerError || !data) {
        setError(offerErrorMessage(offerError, 'Nie znaleziono oferty do edycji.'));
        setEditingLoading(false);
        return;
      }
      const offer = data as any;
      setBrandId(offer.my_company_id || '');
      setOrganizationId(offer.partner_organization_id || '');
      setEditingCommercialModel(offer.commercial_model === 'commission' ? 'commission' : 'markup');
      setTitle(offer.title || 'Oferta obsługi wydarzenia');
      setDescription(offer.description || '');
      setRecommendations(Array.isArray(offer.recommended_items) ? offer.recommended_items : []);
      setEventDate(offer.event_date ? String(offer.event_date).slice(0, 10) : '');
      setEventLocation(offer.event_location || '');
      setValidUntil(offer.valid_until ? String(offer.valid_until).slice(0, 10) : '');
      setClientName(offer.portal_client_name || '');
      setClientCompany(offer.portal_client_company || '');
      setClientEmail(offer.portal_client_email || '');
      setClientPhone(offer.portal_client_phone || '');
      setGuestCount(offer.guest_count ? String(offer.guest_count) : '');
      setItems([...(offer.offer_items || [])]
        .sort((left: any, right: any) => Number(left.display_order || 0) - Number(right.display_order || 0))
        .map((item: any) => ({
          key: item.id,
          days: Number(item.days || 1),
          pageLayout: sellerItemLayout(item.pricing_configuration, item.offer_page_variant_override),
          configurationQuoteId: item.seller_configuration_quote_id,
          configuration: item.pricing_configuration || undefined,
          product_id: item.product_id,
          product_variant_id: item.product_variant_id,
          name: item.name,
          description: item.description || '',
          unit: item.unit || 'szt.',
          quantity: Number(item.quantity || 1),
          // A custom item has no MAVINCI catalog price: its entered price is the
          // price in both commercial models (commission totals use baseUnitPrice).
          baseUnitPrice: Number((item.is_partner_custom ? item.client_unit_price : item.base_partner_unit_price) || 0),
          clientUnitPrice: Number(item.client_unit_price || 0),
          imagePath: item.partner_source_snapshot?.image_path || null,
          isCustom: Boolean(item.is_partner_custom),
        })));
      setEditingLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!context) return;
    let active = true;
    const offerId = new URLSearchParams(window.location.search).get('offer');
    setEditorLoading(true); setEditorError('');
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('get_seller_offer_editor_context', { p_offer: offerId });
        if (error) throw error;
        if (!data?.company_id) throw new Error('Brak ustawień cennika. Skontaktuj się z opiekunem.');
        if (!active) return;
        setBrandId(data.company_id); setOrganizationId(data.organization_id || '');
        setEditorBranding(data.branding); setHotel(data.hotel); setArrangements(data.arrangements);
        setRoomId(data.arrangements?.values?.venue_snapshot?.room?.id || ''); setRoomChanged(false);
        if (!offerId && data.hotel?.location?.name) setEventLocation(data.hotel.location.name);
      } catch (error: any) {
        if (active) setEditorError(offerErrorMessage(error, error?.message || 'Nie udało się pobrać ustawień oferty.'));
      } finally { if (active) setEditorLoading(false); }
    })();
    return () => { active = false; };
  }, [context, editorRetry]);

  useEffect(() => {
    if (!brandId) {
      setCatalog([]);
      setCatalogLoading(false);
      return;
    }
    let cancelled = false;
    setCatalog([]);
    setCatalogLoading(true);
    void (async () => {
      const { data, error: catalogError } = await supabase.rpc('get_seller_portal_catalog_v2', {
        p_company_id: brandId,
      });
      if (cancelled) return;
      if (catalogError) {
        console.error('Seller catalog error:', catalogError);
        setError(offerErrorMessage(catalogError, 'Nie udało się pobrać katalogu usług. Spróbuj ponownie.'));
      }
      setCatalog(((data || []) as any[]).map((product) => ({
        ...product,
        category: Array.isArray(product.category) ? product.category[0] : product.category,
        variants: product.variants || [],
      })) as CatalogProduct[]);
      setCatalogLoading(false);
    })();
    return () => { cancelled = true; };
  }, [brandId]);

  const itemImagePaths = useMemo(() => items.map(item => item.imagePath).filter((path): path is string => Boolean(path)), [items]);
  const catalogImages = useSellerCatalogImages(catalog, brandId, itemImagePaths);
  const configurableProductIds = useMemo(() => new Set(catalog.filter(product => product.configurable).map(product => product.id)), [catalog]);

  const selectedCatalogKeys = useMemo(() => new Set(items
    .filter((item) => Boolean(item.product_id) && !item.configurationQuoteId)
    .map((item) => catalogItemKey(item.product_id!, item.product_variant_id))), [items]);
  // A product already quoted is not an upsell, regardless of its variant.
  // Derive the list from current items so removing an item makes it available again.
  const mainOfferProductIds = useMemo(() => new Set(items
    .map((item) => item.product_id).filter((id): id is string => Boolean(id))), [items]);
  const recommendationCatalog = useMemo(() => catalog.filter((product) => !product.configurable && !mainOfferProductIds.has(product.id)), [catalog, mainOfferProductIds]);

  const duplicateCatalogItems = useMemo(() => {
    const occurrences = new Map<string, { name: string; count: number }>();
    items.forEach((item) => {
      if (!item.product_id || item.configurationQuoteId) return;
      const key = catalogItemKey(item.product_id, item.product_variant_id);
      const current = occurrences.get(key);
      occurrences.set(key, { name: item.name, count: (current?.count || 0) + 1 });
    });
    return [...occurrences.values()].filter((item) => item.count > 1);
  }, [items]);

  const selectedBrand = context?.brands.find((brand) => brand.my_company_id === brandId);
  const brandingId = editorBranding?.id || null;
  const commissionEnabled = selectedBrand?.commission_enabled === true;
  const commercialModel = commissionEnabled
    ? (editingOfferId ? editingCommercialModel : editorBranding?.default_commercial_model || 'markup')
    : 'markup';
  const commissionRate = Number(selectedBrand?.default_commission_rate || 0);
  // Commission accrues silently until MAVINCI reveals it for this brand.
  const commissionVisible = sellerCommissionsVisible(context, brandId);

  const catalogKeys = useMemo(() => new Set(catalog.flatMap((product) => product.variants.length
    ? product.variants.map((variant) => catalogItemKey(product.id, variant.id))
    : [catalogItemKey(product.id)])), [catalog]);
  const recommendationKeys = useMemo(() => new Set(recommendations.map((item) => catalogItemKey(item.product_id, item.product_variant_id))), [recommendations]);
  const unavailableRecommendationKeys = useMemo(() => new Set([...selectedCatalogKeys, ...recommendationKeys]), [selectedCatalogKeys, recommendationKeys]);
  const addRecommendation = (product: CatalogProduct, variant?: ProductVariant) => {
    if (saving) return;
    const key = catalogItemKey(product.id, variant?.id);
    const name = variant ? `${product.name} — ${variant.name}` : product.name;
    if (mainOfferProductIds.has(product.id) || unavailableRecommendationKeys.has(key)) {
      setRecommendationAlert(`Usługa „${name}” jest już w ofercie lub propozycjach. Nie można dodać jej ponownie.`);
      return;
    }
    if (recommendations.length >= 24) { setRecommendationAlert('Możesz dodać maksymalnie 24 propozycje. Usuń jedną, aby dobrać inną usługę.'); return; }
    const recommendation: OfferRecommendation = {
      id: crypto.randomUUID(), product_id: product.id, product_variant_id: variant?.id || null,
      name, unit: product.unit || 'szt.', quantity: 1,
      unit_price: Number(variant?.price_net ?? product.base_price ?? 0),
      description: '', image_path: variant?.offer_image_path || product.offer_image_path || null,
    };
    setRecommendationAlert(null);
    // The state-level guard also handles rapid double clicks before repaint.
    setRecommendations((current) => current.length >= 24 || current.some((item) => catalogItemKey(item.product_id, item.product_variant_id) === key)
      ? current : [...current, recommendation]);
  };
  const updateRecommendation = (id: string, patch: Partial<OfferRecommendation>) =>
    setRecommendations((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));

  const addCatalogItem = (product: CatalogProduct, variant?: ProductVariant) => {
    if (product.configurable) { setConfiguring({ productId: product.id }); return; }
    const selectionKey = catalogItemKey(product.id, variant?.id);
    const itemName = variant ? `${product.name} — ${variant.name}` : product.name;
    if (selectedCatalogKeys.has(selectionKey)) {
      setCatalogAlert(`Pozycja „${itemName}” jest już dodana do oferty. Nie można dodać jej drugi raz.`);
      return;
    }
    setRecommendations((current) => current.filter((item) => item.product_id !== product.id));
    const basePrice = Number(variant?.price_net ?? product.base_price ?? 0);
    setCatalogAlert(null);
    setItems((current) => {
      const duplicate = current.some((item) => item.product_id === product.id && (item.product_variant_id || null) === (variant?.id || null));
      if (duplicate) {
        setCatalogAlert(`Pozycja „${itemName}” jest już dodana do oferty. Nie można dodać jej drugi raz.`);
        return current;
      }
      return [...current, {
        key: `${product.id}-${variant?.id || 'base'}-${Date.now()}`,
        product_id: product.id,
        product_variant_id: variant?.id || null,
        name: itemName,
        description: variant?.description || variant?.short_description || product.offer_description || product.description || '',
        unit: product.unit || 'szt.',
        quantity: 1,
        days: 1,
        baseUnitPrice: basePrice,
        clientUnitPrice: basePrice,
        imagePath: variant?.offer_image_path || product.offer_image_path,
        isCustom: false,
        pageLayout: 'default',
      }];
    });
  };

  const openCustomItem = () => {
    customTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCustomError('');
    setCustomOpen(true);
  };
  const closeCustomItem = () => {
    setCustomOpen(false);
    setCustomError('');
    window.requestAnimationFrame(() => customTriggerRef.current?.focus());
  };
  const addCustomItem = () => {
    if (!customName.trim()) { setCustomError('Podaj nazwę pozycji.'); customNameRef.current?.focus(); return; }
    const price = Number(customPrice.replace(/\s/g, '').replace(',', '.') || 0);
    if (!Number.isFinite(price) || price < 0) { setCustomError('Podaj cenę netto większą lub równą zero.'); return; }
    setItems((current) => [...current, {
      key: `custom-${Date.now()}`,
      product_id: null,
      product_variant_id: null,
      name: customName.trim(),
      description: customDescription.trim(),
      unit: 'szt.',
      quantity: 1,
      days: 1,
      // The entered price is used in both models (commission totals and payload use baseUnitPrice).
      baseUnitPrice: price,
      clientUnitPrice: price,
      isCustom: true,
      pageLayout: 'default',
    }]);
    setCustomName('');
    setCustomDescription('');
    setCustomPrice('');
    closeCustomItem();
  };

  const updateItem = (key: string, patch: Partial<DraftItem>) => setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  const removeItem = (key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
    setCatalogAlert(null);
  };

  const totals = useMemo(() => {
    // Like the database, a custom item has no MAVINCI catalog price (base 0).
    const base = items.reduce((sum, item) => sum + (item.isCustom ? 0 : item.baseUnitPrice * item.quantity * item.days), 0);
    const client = items.reduce((sum, item) => sum + (commercialModel === 'commission' ? item.baseUnitPrice : item.clientUnitPrice) * item.quantity * item.days, 0);
    const earnings = commercialModel === 'commission' ? client * Number(commissionRate || 0) / 100 : client - base;
    return { base, client, gross: client * 1.23, earnings };
  }, [commercialModel, commissionRate, items]);

  useEffect(() => { if (error) saveErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [error]);

  const saveOffer = async (generatePdf = true) => {
    if (saveLockRef.current) return;
    if (generatePdf && !hasEventDate) {
      setError('Wybierz datę wydarzenia przed wygenerowaniem PDF. Bez terminu możesz zapisać szkic.'); return;
    }
    if (!eventDateValid || !validUntilValid || (scheduleChanged && eventSchedule.error)) {
      setError(eventSchedule.error || 'Popraw daty i godziny wydarzenia lub datę ważności oferty. Daty wpisz w formacie DD.MM.RRRR.'); return;
    }
    if (!context || !brandId) { setError('Wybierz markę Mavinci dla tej oferty.'); return; }
    if (editorLoading || editorError) { setError('Nie pobrano ustawień oferty. Wczytaj kreator ponownie.'); return; }
    if (!editingOfferId && !organizationId) { setError('Poproś opiekuna o przypisanie organizacji w CRM.'); return; }
    if (!clientName.trim() && !clientCompany.trim()) { setError('Podaj nazwę klienta lub firmy.'); return; }
    if (items.length === 0) { setError('Dodaj co najmniej jedną pozycję do oferty.'); return; }
    if (items.some((item) => !Number.isFinite(item.clientUnitPrice) || item.clientUnitPrice < 0 || !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isInteger(item.days) || item.days < 1 || item.days > 3650)) {
      setError('Podaj poprawne ceny usług (zero lub więcej) i całkowite ilości większe od zera.'); return;
    }
    if (duplicateCatalogItems.length > 0) {
      const names = duplicateCatalogItems.map((item) => `„${item.name}”`).join(', ');
      setCatalogAlert(`Oferta zawiera powtórzone pozycje: ${names}. Usuń duplikaty przed zapisaniem.`);
      setError('Nie można zapisać oferty zawierającej dwie takie same pozycje katalogowe.');
      return;
    }
    if (recommendations.length > 24 || recommendationKeys.size !== recommendations.length) {
      setError('Lista propozycji może zawierać maksymalnie 24 różne usługi. Usuń powtórzone lub nadmiarowe pozycje.'); return;
    }
    if (recommendations.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unit_price) || item.unit_price < 0
      || mainOfferProductIds.has(item.product_id)
      || !catalogKeys.has(catalogItemKey(item.product_id, item.product_variant_id)))) {
      setError('Sprawdź propozycje: ceny i ilości muszą być poprawne, a usługi dostępne w Twoim katalogu i nieobecne w głównej wycenie.'); return;
    }
    const payload = {
      p_offer: {
        id: pendingPdfRef.current?.offerId || editingOfferId,
        my_company_id: brandId,
        organization_id: organizationId || null,
        branding_profile_id: brandingId,
        commercial_model: commissionEnabled ? commercialModel : 'markup',
        // Persisted by save_seller_portal_offer_v5 once the RPC accepts it; ignored otherwise.
        guest_count: guestCount.trim() ? Number(guestCount) : null,
        commission_rate: commissionEnabled && commercialModel === 'commission' ? Number(commissionRate || 0) : 0,
        title,
        description,
        event_date: scheduledDays[0]?.date || null,
        event_location: eventLocation,
        valid_until: validUntil || null,
        client_name: clientName,
        client_company: clientCompany,
        client_email: clientEmail,
        client_phone: clientPhone,
        recommended_items: recommendations,
        ...(roomChanged ? { venue_selection: { room_id: roomId || null, revision: arrangements?.values.revision || 0 } } : {}),
        ...(scheduleChanged ? { event_schedule: { days: eventSchedule.days, revision: arrangements?.values.revision || 0 } } : {}),
      },
      p_items: items.map((item, index) => ({
        product_id: item.product_id,
        product_variant_id: item.product_variant_id,
        name: item.name,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        days: item.days,
        configuration_quote_id: item.configurationQuoteId || null,
        client_unit_price: commercialModel === 'commission' ? item.baseUnitPrice : item.clientUnitPrice,
        is_custom: item.isCustom,
        display_order: index + 1,
        page_layout: sellerItemLayout(item.configuration, item.pageLayout),
      })),
    };
    // Revisions and server-assigned IDs are transport metadata, not changed content.
    const contentKey = JSON.stringify({ ...payload, p_offer: {
      ...payload.p_offer, id: null,
      ...(payload.p_offer.venue_selection ? { venue_selection: { room_id: payload.p_offer.venue_selection.room_id } } : {}),
      ...(payload.p_offer.event_schedule ? { event_schedule: { days: payload.p_offer.event_schedule.days } } : {}),
    } });
    saveLockRef.current = true;
    flushSync(() => { setSaving(true); setSaveStage('Zapisywanie oferty'); });
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 300000);
    let redirected = false;
    try {
      // Let the overlay paint before beginning network work.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      let pending = pendingPdfRef.current;
      if (!pending || pending.contentKey !== contentKey) {
        saveRequestRef.current ||= crypto.randomUUID();
        const { data, error: saveError } = await supabase.rpc('save_seller_portal_offer_v5', {
          ...payload, p_request_id: saveRequestRef.current,
        }).abortSignal(controller.signal);
        if (saveError) throw saveError;
        if (typeof data?.offer_id !== 'string' || !data.offer_id) throw new Error('Brak identyfikatora oferty.');
        if (data.arrangements) setArrangements(data.arrangements as SellerArrangements);
        pending = { offerId: data.offer_id, requestId: crypto.randomUUID(), contentKey };
        pendingPdfRef.current = pending;
        saveRequestRef.current = null;
      }
      if (!generatePdf) { leavingRef.current = true; router.push('/seller/offers/' + pending.offerId); redirected = true; return; }
      setSaveStage('Generowanie oferty PDF');
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error('Sesja wygasła.');
      const response = await fetch('/bridge/seller/offers/' + pending.offerId, {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + sessionData.session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate', requestId: pending.requestId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.documentId !== 'string') {
        console.error('Seller offer generation error:', result);
        if (result.code === 'SELLER_EVENT_DATE_REQUIRED') {
          throw Object.assign(new Error('Uzupełnij datę wydarzenia i zapisz ofertę przed wygenerowaniem PDF.'), { code: result.code });
        }
        throw new Error('Generowanie PDF nie powiodło się.');
      }
      setSaveStage('Otwieranie gotowej oferty');
      leavingRef.current = true;
      router.push('/seller/offers/' + pending.offerId + '?document=' + encodeURIComponent(result.documentId) + '&preview=1');
      redirected = true;
      // Keep the overlay until this page unmounts; do not flash the form again.
    } catch (saveError: any) {
      console.error('Seller offer save/generate error:', saveError);
      setError(controller.signal.aborted
        ? 'Operacja trwała zbyt długo. Kliknij ponownie — system sprawdzi zapis i nie utworzy drugiej oferty.'
        : saveError?.code === 'SELLER_EVENT_DATE_REQUIRED'
          ? saveError.message
          : pendingPdfRef.current?.contentKey === contentKey
          ? 'Oferta została zapisana, ale PDF nie został wygenerowany. Kliknij ponownie, aby ponowić generowanie. Jeśli problem się powtarza, skontaktuj się z opiekunem Mavinci.'
          : offerErrorMessage(saveError, 'Nie udało się zapisać oferty. Spróbuj ponownie.'));
    } finally {
      window.clearTimeout(timeout);
      if (!redirected) { saveLockRef.current = false; setSaving(false); }
    }
  };

  const ready = !contextLoading && !catalogLoading && !editingLoading && !(context && editorLoading);
  // Everything the seller can type or choose; used only to detect unsaved work.
  const formKey = JSON.stringify([title, description, scheduledDays, validUntil, eventLocation, clientName, clientCompany, clientEmail, clientPhone, guestCount, roomId, items, recommendations]);
  useEffect(() => { if (ready && baseline === null) setBaseline(formKey); }, [ready, baseline, formKey]);
  const dirty = baseline !== null && formKey !== baseline;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current || leavingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    // In-app links (menu, settings) would silently discard the editor state.
    const beforeNavigation = (event: MouseEvent) => {
      if (!dirtyRef.current || leavingRef.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest('a[href]');
      if (!anchor || anchor.getAttribute('target') === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.getAttribute('href') || '', window.location.href);
      if (url.origin === window.location.origin && url.pathname === window.location.pathname) return;
      if (!window.confirm(LEAVE_MESSAGE)) { event.preventDefault(); event.stopPropagation(); return; }
      leavingRef.current = true;
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', beforeNavigation, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', beforeNavigation, true); };
  }, []);

  useEffect(() => {
    if (!customOpen) return;
    window.requestAnimationFrame(() => customNameRef.current?.focus());
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeCustomItem(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [customOpen]);

  const invalidItems = items.some((item) => !Number.isFinite(item.clientUnitPrice) || item.clientUnitPrice < 0 || !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isInteger(item.days) || item.days < 1 || item.days > 3650);
  const stepProblem = (index: number): string | null => {
    if (index === 0) {
      if (!clientName.trim() && !clientCompany.trim()) return 'Podaj imię i nazwisko gościa lub nazwę firmy.';
      if (!eventDateValid || (scheduleChanged && eventSchedule.error)) return eventSchedule.error || 'Popraw datę i godziny wydarzenia. Datę wpisz w formacie DD.MM.RRRR.';
      if (guestCount.trim()) {
        const count = Number(guestCount);
        if (!Number.isInteger(count) || count < 1 || count > 100000) return 'Liczba gości musi być liczbą całkowitą od 1 do 100 000.';
      }
      return null;
    }
    if (index === 1) {
      if (!items.length) return 'Dodaj co najmniej jedną usługę z katalogu lub własną pozycję.';
      if (duplicateCatalogItems.length) return 'Oferta zawiera powtórzone pozycje. Usuń duplikaty.';
      if (invalidItems) return 'Podaj poprawne ceny usług (zero lub więcej) i całkowite ilości większe od zera.';
      return null;
    }
    if (!validUntilValid) return 'Popraw datę ważności oferty (DD.MM.RRRR).';
    return null;
  };
  const scrollToWizard = () => window.requestAnimationFrame(() => wizardTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  const goToStep = (target: number) => {
    if (saving || target === step) return;
    if (target > step) {
      for (let index = step; index < target; index += 1) {
        const problem = stepProblem(index);
        if (problem) { setStep(index); setStepError(problem); scrollToWizard(); return; }
      }
    }
    setStepError('');
    setStep(target);
    scrollToWizard();
  };
  const submit = (generatePdf: boolean) => {
    for (const index of [0, 1, 2]) {
      const problem = stepProblem(index);
      if (problem) { setStep(index); setStepError(problem); scrollToWizard(); return; }
    }
    setStepError('');
    void saveOffer(generatePdf);
  };

  if (!ready) return <div role="status" className="flex items-center justify-center gap-3 p-10 text-[#d3bb73]"><Loader2 className="h-6 w-6 animate-spin" aria-hidden="true"/>Ładowanie kreatora…</div>;
  if (!context) return <div className="p-10 text-center text-[#e5e4e2]/50">Brak dostępu do portalu sprzedawcy.</div>;
  if (editorError) return <div role="alert" className="m-6 space-y-4 rounded-xl bg-white/5 p-6 text-amber-100"><p>{editorError}</p><button type="button" onClick={() => setEditorRetry(n => n + 1)} className="min-h-10 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-[#d3bb73]">Spróbuj ponownie</button></div>;

  const itemCount = items.length;
  const earningsLabel = commercialModel === 'commission'
    ? (commissionVisible ? `Prowizja ${commissionRate}% · ${FORECAST_NOTE}` : null)
    : 'Marża hotelu';
  const pdfDisabled = saving || items.length === 0 || duplicateCatalogItems.length > 0 || !hasEventDate || !eventDateValid || !validUntilValid;
  const scheduleLabel = hasEventDate ? scheduledDays.filter(day => validSellerDay(day.date)).map(day => `${day.date.split('-').reverse().join('.')}${day.start_time ? ` ${day.start_time}${day.end_time ? `–${day.end_time}` : ''}` : ''}`).join(', ') : 'Termin do ustalenia';
  const commercialNote = <p className="text-xs leading-5 text-white/50">
    {commercialModel === 'commission'
      ? (commissionVisible ? 'Ceny dla gościa pochodzą z Twojego cennika MAVINCI; prowizja liczona jest automatycznie.' : 'Ceny dla gościa pochodzą z Twojego cennika MAVINCI.')
      : 'Cenę dla gościa ustalasz sam. Różnica względem cennika MAVINCI to marża hotelu.'}{' '}
    {editingOfferId ? 'Oferta zachowuje zapisany sposób rozliczenia.' : 'Sposób rozliczenia nowych ofert ustawisz w ustawieniach.'}{' '}
    <Link href={`/seller/profile?brand=${brandId}&tab=general`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center text-[#d3bb73] underline-offset-4 hover:underline">Otwórz ustawienia (nowa karta)</Link>
  </p>;

  return (
    <div className="min-h-screen p-4 pb-28 text-[#e5e4e2] md:p-6 lg:pb-6">
      <FullScreenLoader show={saving} title={saveStage} description="Przygotowujemy dokument. Gotowa oferta otworzy się automatycznie — nie zamykaj tego okna." />
      <div ref={wizardTopRef} className="mx-auto max-w-7xl scroll-mt-4 space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div><h1 className="text-2xl font-light">{editingOfferId ? 'Edycja oferty' : 'Nowa oferta'}</h1><p className="mt-1 text-sm text-white/55">Trzy krótkie kroki: gość, usługi, podsumowanie. Oferta otrzyma identyfikację Twojego hotelu.</p></div>
          {dirty && <p className="text-xs text-amber-200" role="status">Niezapisane zmiany</p>}
        </header>

        <nav aria-label="Kroki kreatora oferty">
          <p className="mb-2 text-xs text-white/50 sm:hidden">Krok {step + 1} z {wizardSteps.length} · {wizardSteps[step].label}</p>
          <ol className="grid grid-cols-3 gap-2">{wizardSteps.map((item, index) => {
            const current = index === step, done = index < step;
            return <li key={item.id}>
              <button type="button" onClick={() => goToStep(index)} disabled={saving} aria-current={current ? 'step' : undefined}
                className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition sm:px-3 ${current ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : done ? 'bg-white/[0.04] text-emerald-200/90 hover:bg-white/[0.07]' : 'bg-white/[0.03] text-white/50 hover:bg-white/[0.06]'}`}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${current ? 'bg-[#d3bb73] text-[#111522]' : done ? 'bg-emerald-300/15' : 'bg-white/5'}`}>{done ? <Check className="h-4 w-4" aria-hidden="true" /> : index + 1}</span>
                <span className="hidden min-w-0 sm:block"><span className="block truncate text-sm">{item.label}</span><span className="block truncate text-[11px] text-white/40">{item.hint}</span></span>
                <span className="sr-only sm:hidden">{item.label}</span>
              </button>
            </li>;
          })}</ol>
        </nav>

        {(stepError || error) && <div ref={saveErrorRef} role="alert" className="rounded-lg bg-red-300/10 p-4 text-sm text-red-100">{stepError || error}</div>}

        {step === 0 && <section aria-labelledby="wizard-step-guest" className="space-y-5 rounded-xl bg-[#1c1f33] p-4 sm:p-5">
          <div><h2 id="wizard-step-guest" className="text-lg uppercase">Gość i termin</h2><p className="mt-1 text-xs text-white/50">Kto zamawia, kiedy i gdzie. Termin jest potrzebny do PDF — szkic zapiszesz bez niego.</p></div>
          <div>
            <SellerClientPicker key={`${context.profile.id}:${brandId}`} companyId={brandId}
              client={{ name: clientName, company: clientCompany, email: clientEmail, phone: clientPhone }}
              onSelect={(client) => { setClientName(client.name); setClientCompany(client.company); setClientEmail(client.email); setClientPhone(client.phone); setStepError(''); }} />
            <p className="mt-2 text-xs text-white/50">Wybierz zapisany kontakt albo wpisz dane nowego gościa poniżej.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs text-white/55">Gość — imię i nazwisko<input autoComplete="off" value={clientName} onChange={(event) => { setClientName(event.target.value); setStepError(''); }} className={`${fieldClass} mt-1.5`} placeholder="np. Anna Kowalska" /></label>
            <label className="text-xs text-white/55">Firma gościa<input autoComplete="off" value={clientCompany} onChange={(event) => { setClientCompany(event.target.value); setStepError(''); }} className={`${fieldClass} mt-1.5`} placeholder="Opcjonalnie" /></label>
            <label className="text-xs text-white/55">E-mail<input type="email" inputMode="email" autoComplete="off" value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} className={`${fieldClass} mt-1.5`} /></label>
            <label className="text-xs text-white/55">Telefon<input type="tel" inputMode="tel" autoComplete="off" value={clientPhone} onChange={(event) => setClientPhone(event.target.value)} className={`${fieldClass} mt-1.5`} /></label>
          </div>
          <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
            <div id="seller-offer-event-schedule" className="min-w-0 scroll-mt-24">
              <SellerEventSchedule compact requiredForPdf value={scheduledDays} onValidityChange={setEventDateValid}
                disabled={saving || arrangements?.can_edit === false}
                notice={hasLegacySellerEventRange(arrangements?.values) && !scheduleChanged ? 'Zachowamy wcześniejsze ustalenia początku i końca. Jeśli zmieniasz termin, uzupełnij wszystkie dni i godziny — zastąpią poprzedni zakres.' : undefined}
                onChange={days => { setEventDays(days); setEventDate(days[0]?.date || ''); setScheduleChanged(true); setStepError(''); }} />
            </div>
            <label className="text-xs text-white/55">Liczba gości<input type="number" inputMode="numeric" min={1} max={100000} step={1} value={guestCount} onChange={(event) => { setGuestCount(event.target.value); setStepError(''); }} className={`${fieldClass} mt-1.5`} placeholder="np. 120" /></label>
          </div>
          {hotel?.location && <div className="space-y-3 rounded-lg bg-white/[0.03] p-3">
            <p className="text-sm font-medium">Sala lub teren na zewnątrz · {hotel.location.name}</p>
            <SearchCombobox value={roomId} disabled={saving || arrangements?.can_edit === false}
              options={[
                ...hotel.location.rooms.map(room => ({ id: room.id, label: `${room.name}${room.kind === 'outdoor' ? ' · teren na zewnątrz' : ''}` })),
                ...(roomId && !hotel.location.rooms.some(room => room.id === roomId) ? [{ id: roomId, label: `${arrangements?.values.room || 'Zapisana przestrzeń'} — archiwalna` }] : []),
              ]}
              onChange={id => { setRoomId(id); setRoomChanged(true); const room = hotel.location!.rooms.find(r => r.id === id); setEventLocation([hotel.location!.name, room?.name].filter(Boolean).join(' — ')); }}
              ariaLabel="Sala lub teren hotelu" placeholder="Wybierz przestrzeń z bazy hotelu…" emptyLabel="Brak przestrzeni — poproś opiekuna o uzupełnienie lokalizacji" />
            {roomId && <details><summary className="flex min-h-10 cursor-pointer items-center text-xs text-[#d3bb73]">Szczegóły i materiały przestrzeni</summary><div className="mt-3"><p className="mb-3 whitespace-pre-wrap text-sm text-white/60">{hotel.location.rooms.find(room => room.id === roomId)?.notes}</p><TechnicalDetailsView value={hotel.location.rooms.find(room => room.id === roomId)?.technical}/></div></details>}
            <p className="text-xs text-white/50">Wybrana przestrzeń trafi też do ustaleń realizacji. Bez wyboru pozostanie do uzgodnienia.</p>
          </div>}
          <label className="block text-xs text-white/55">Miejsce wydarzenia<input value={eventLocation} onChange={(event) => setEventLocation(event.target.value)} className={`${fieldClass} mt-1.5`} placeholder={context.profile.organization?.name || 'Hotel / adres'} /></label>
        </section>}

        {step === 1 && <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="min-w-0 space-y-5">
            <section aria-labelledby="wizard-step-services" className="rounded-xl bg-[#1c1f33] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="wizard-step-services" className="text-lg uppercase">Usługi z katalogu MAVINCI</h2><p className="mt-1 text-xs leading-5 text-white/50">Dodaj usługi do wyceny. Dotknij zdjęcia, aby je powiększyć. Nazwa usługi otwiera opis w nowej karcie.</p></div><button type="button" onClick={openCustomItem} disabled={saving} className="flex min-h-10 items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs text-[#d3bb73]"><Plus className="h-3.5 w-3.5" /> Własna pozycja</button></div>
              {(catalogAlert || duplicateCatalogItems.length > 0) && <div role="alert" className="mt-4 flex items-start gap-3 rounded-lg bg-amber-300/10 px-4 py-3 text-sm leading-5 text-amber-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /><span>{catalogAlert || `Oferta zawiera powtórzone pozycje: ${duplicateCatalogItems.map((item) => item.name).join(', ')}. Usuń duplikaty przed zapisaniem.`}</span></div>}
              <SellerOfferCatalog key={`main-${brandId}`} products={catalog} brandId={brandId} imageUrls={catalogImages} selectedKeys={selectedCatalogKeys} onAdd={addCatalogItem} disabled={saving} label="Katalog główny" />
            </section>

            <details className="group rounded-xl bg-[#1c1f33] p-4 sm:p-5" open={recommendations.length > 0}>
              <summary className="flex min-h-10 cursor-pointer list-none items-start justify-between gap-3">
                <span className="flex items-start gap-2 font-medium"><Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-[#d3bb73]" />Propozycje dodatkowe dla gościa <span className="text-xs font-normal text-[#d3bb73]">({recommendations.length} / 24)</span></span>
                <ChevronDown className="mt-0.5 h-5 w-5 shrink-0 text-white/50 transition group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="mt-2 text-sm leading-6 text-white/55">Opcjonalne usługi pojawią się osobno w PDF — poza sumą oferty i rezerwacją sprzętu.</p>
              {recommendations.length >= 24 && <p className="mt-2 text-xs text-[#d3bb73]">Osiągnięto limit. Usuń propozycję, aby dodać inną.</p>}
              {recommendationAlert && <p role="alert" className="mt-3 rounded-lg bg-amber-300/10 px-4 py-3 text-sm text-amber-100">{recommendationAlert}</p>}
              {recommendationCatalog.length > 0 ? <SellerOfferCatalog key={`recommendations-${brandId}`} products={recommendationCatalog} brandId={brandId} imageUrls={catalogImages} selectedKeys={unavailableRecommendationKeys} mainOfferKeys={selectedCatalogKeys} onAdd={addRecommendation} disabled={saving || recommendations.length >= 24} actionLabel="Dobierz" label="Katalog propozycji dodatkowych" /> : <p className="mt-4 rounded-lg bg-white/[0.03] p-4 text-sm text-white/50">Brak dodatkowych produktów do zaproponowania. Produkty z głównej oferty są ukryte w tej liście.</p>}
              <div className="mt-5 rounded-xl bg-black/10 p-4">
                <h3 className="text-sm font-medium">Wybrane propozycje dodatkowe</h3>
                {!recommendations.length && <p className="mt-3 text-xs leading-5 text-white/45">Kliknij „Dobierz” przy produkcie powyżej. Pusta sekcja nie pojawi się w PDF.</p>}
                <div className="mt-4 space-y-3">{recommendations.map((item) => <div key={item.id} className="rounded-lg bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3"><Link href={`/seller/products/${item.product_id}?brand=${encodeURIComponent(brandId)}`} target="_blank" rel="noopener noreferrer" className="text-sm hover:text-[#d3bb73] hover:underline">{item.name}</Link><button type="button" disabled={saving} aria-label={'Usuń propozycję '+item.name} onClick={() => { setRecommendations((current) => current.filter((row) => row.id !== item.id)); setRecommendationAlert(null); }} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/40 hover:bg-red-300/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button></div>
                  <label className="mt-2 block text-xs text-white/50">Dlaczego warto dobrać tę usługę?<textarea rows={2} maxLength={500} value={item.description} disabled={saving} onChange={(event) => updateRecommendation(item.id,{description:event.target.value})} className={fieldClass+' mt-1.5'} placeholder="Krótka korzyść dla klienta" /></label>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="text-xs text-white/50">Ilość ({item.unit})<input type="number" inputMode="decimal" min="0.01" max="100000" step="0.01" value={Number.isFinite(item.quantity) ? item.quantity : ''} disabled={saving} onChange={(event) => updateRecommendation(item.id,{quantity:event.target.valueAsNumber})} className={fieldClass+' mt-1.5'} /></label>
                    <label className="text-xs text-white/50">Cena dla klienta netto / szt.<input type="number" inputMode="decimal" min="0" max="1000000000" step="0.01" value={Number.isFinite(item.unit_price) ? item.unit_price : ''} disabled={saving || commercialModel==='commission'} onChange={(event) => updateRecommendation(item.id,{unit_price:event.target.valueAsNumber})} className={fieldClass+' mt-1.5'} /></label>
                    <p className="self-end py-3 text-sm text-[#d3bb73]">{Number.isFinite(item.quantity*item.unit_price) ? sellerMoney(item.quantity*item.unit_price) : 'Uzupełnij cenę i ilość'} netto · opcjonalnie</p>
                  </div>
                </div>)}</div>
              </div>
              <p className="mt-3 text-xs leading-5 text-white/45">Dodanie produktu do głównej wyceny usuwa jego propozycję; po usunięciu z wyceny produkt znów można dobrać.</p>
            </details>
          </div>

          <section aria-label="Wybrane usługi" className="h-fit min-w-0 rounded-xl bg-[#1c1f33] p-4 sm:p-5 xl:sticky xl:top-4">
            <SellerOfferItems items={items} brandId={brandId} imageUrls={catalogImages} commission={commercialModel === 'commission'} disabled={saving}
              configurableProductIds={configurableProductIds} onUpdate={updateItem} onRemove={removeItem} onReorder={setItems}
              onConfigure={item => { if (item.product_id) setConfiguring({ productId: item.product_id, itemKey: item.key, initial: item.configuration }); }} />
            <div className="mt-4 flex justify-between border-t border-white/5 pt-4 text-sm"><span className="text-white/55">Razem dla gościa netto</span><span>{sellerMoney(totals.client)}</span></div>
          </section>
        </div>}

        {step === 2 && <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="min-w-0 space-y-5">
            <section aria-labelledby="wizard-step-summary" className="space-y-4 rounded-xl bg-[#1c1f33] p-4 sm:p-5">
              <h2 id="wizard-step-summary" className="text-lg uppercase">Podsumowanie</h2>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg bg-white/[0.03] p-3"><dt className="text-xs text-white/50">Gość</dt><dd className="mt-1 break-words">{[clientName, clientCompany].filter(Boolean).join(' · ') || '—'}</dd></div>
                <div className="rounded-lg bg-white/[0.03] p-3"><dt className="text-xs text-white/50">Termin</dt><dd className={`mt-1 ${hasEventDate ? '' : 'text-amber-200'}`}>{scheduleLabel}</dd></div>
                <div className="rounded-lg bg-white/[0.03] p-3"><dt className="text-xs text-white/50">Liczba gości</dt><dd className="mt-1">{guestCount || 'Nie podano'}</dd></div>
                <div className="rounded-lg bg-white/[0.03] p-3"><dt className="text-xs text-white/50">Miejsce</dt><dd className="mt-1 break-words">{eventLocation || 'Do ustalenia'}</dd></div>
              </dl>
              <button type="button" onClick={() => goToStep(0)} className="inline-flex min-h-10 items-center gap-2 text-sm text-[#d3bb73]"><Pencil className="h-4 w-4" />Zmień dane gościa lub termin</button>
              <div>
                <div className="flex items-center justify-between gap-3"><h3 className="text-sm uppercase text-white/70">Usługi ({itemCount})</h3><button type="button" onClick={() => goToStep(1)} className="inline-flex min-h-10 items-center gap-2 text-sm text-[#d3bb73]"><Pencil className="h-4 w-4" />Zmień usługi</button></div>
                <ul className="mt-2 divide-y divide-white/5">{items.map((item) => {
                  const unit = commercialModel === 'commission' && !item.isCustom ? item.baseUnitPrice : item.clientUnitPrice;
                  return <li key={item.key} className="flex items-start justify-between gap-3 py-2.5 text-sm"><span className="min-w-0 break-words">{item.name}<span className="block text-xs text-white/45">{item.quantity} {item.unit}{item.days > 1 ? ` × ${item.days} dni` : ''}{item.isCustom ? ' · pozycja własna' : ''}</span></span><span className="shrink-0">{sellerMoney(unit * item.quantity * item.days)}</span></li>;
                })}</ul>
                {recommendations.length > 0 && <p className="mt-2 text-xs text-white/50">Propozycje dodatkowe poza sumą: {recommendations.length}</p>}
              </div>
            </section>
            <section className="grid gap-4 rounded-xl bg-[#1c1f33] p-4 sm:p-5 md:grid-cols-2">
              <label className="text-xs text-white/55 md:col-span-2">Tytuł oferty<input value={title} onChange={(event) => setTitle(event.target.value)} className={`${fieldClass} mt-1.5`} /></label>
              <SellerDatePicker label="Oferta ważna do" value={validUntil} onChange={setValidUntil} onValidityChange={setValidUntilValid} />
              <div className="hidden md:block" />
              <label className="text-xs text-white/55 md:col-span-2">Wprowadzenie / notatka dla gościa<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className={`${fieldClass} mt-1.5 resize-y`} placeholder="Krótki opis potrzeb gościa lub wydarzenia" /></label>
            </section>
          </div>
          <section aria-label="Ceny i zapis" className="h-fit min-w-0 space-y-4 rounded-xl bg-[#1c1f33] p-4 sm:p-5 lg:sticky lg:top-4">
            <div className="space-y-2 text-sm">
              {commercialModel !== 'commission' && <div className="flex justify-between text-white/55"><span>Twój cennik MAVINCI</span><span>{sellerMoney(totals.base)}</span></div>}
              <div className="flex justify-between"><span>Cena dla gościa netto</span><span>{sellerMoney(totals.client)}</span></div>
              <div className="flex justify-between text-white/55"><span>VAT 23%</span><span>{sellerMoney(totals.gross - totals.client)}</span></div>
              <div className="flex justify-between text-white/55"><span>Gość brutto</span><span>{sellerMoney(totals.gross)}</span></div>
              {earningsLabel && <div className="flex justify-between gap-3 border-t border-white/5 pt-3 text-[#d3bb73]"><span>{earningsLabel}</span><span className="shrink-0">{sellerMoney(totals.earnings)}</span></div>}
            </div>
            {commercialNote}
            <button type="button" disabled={saving || items.length === 0 || duplicateCatalogItems.length > 0} onClick={() => submit(false)} className="min-h-11 w-full rounded-lg bg-white/5 px-4 py-3 text-sm hover:bg-white/10 disabled:opacity-40">Zapisz szkic bez PDF</button>
            {!hasEventDate && <p className="text-xs leading-5 text-[#d3bb73]">Przed wygenerowaniem PDF <button type="button" onClick={() => goToStep(0)} className="underline underline-offset-2">wybierz datę wydarzenia</button>. Szkic możesz zapisać bez terminu.</p>}
            <button type="button" disabled={pdfDisabled} onClick={() => submit(true)} className="hidden min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-3 text-sm font-medium text-[#111522] disabled:cursor-not-allowed disabled:opacity-40 lg:flex">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {saving ? 'Zapisywanie…' : editingOfferId ? 'Zapisz i wygeneruj PDF' : 'Zapisz i wygeneruj ofertę'}</button>
          </section>
        </div>}

        <div className="hidden items-center justify-between gap-3 lg:flex">
          <button type="button" onClick={() => goToStep(step - 1)} disabled={step === 0 || saving} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-white/5 px-4 py-2.5 text-sm disabled:invisible"><ArrowLeft className="h-4 w-4" />Wstecz</button>
          <p className="text-sm text-white/55">{itemCount} {itemCount === 1 ? 'pozycja' : itemCount >= 2 && itemCount <= 4 ? 'pozycje' : 'pozycji'} · {sellerMoney(totals.client)} netto</p>
          {step < 2 ? <button type="button" onClick={() => goToStep(step + 1)} disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-2.5 text-sm font-medium text-[#111522]">Dalej: {wizardSteps[step + 1].label}<ArrowRight className="h-4 w-4" /></button> : <span />}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 bg-[#141726]/95 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] backdrop-blur lg:hidden" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          {step > 0 && <button type="button" onClick={() => goToStep(step - 1)} disabled={saving} aria-label="Wstecz" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/5"><ArrowLeft className="h-5 w-5" /></button>}
          <p className="min-w-0 flex-1 truncate text-sm"><span className="text-white/60">{itemCount} {itemCount === 1 ? 'pozycja' : itemCount >= 2 && itemCount <= 4 ? 'pozycje' : 'pozycji'} · </span>{sellerMoney(totals.client)} <span className="text-white/50">netto</span></p>
          {step < 2
            ? <button type="button" onClick={() => goToStep(step + 1)} disabled={saving} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-[#d3bb73] px-4 text-sm font-medium text-[#111522]">Dalej<ArrowRight className="h-4 w-4" /></button>
            : <button type="button" onClick={() => submit(true)} disabled={pdfDisabled} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-[#d3bb73] px-4 text-sm font-medium text-[#111522] disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Generuj PDF</button>}
        </div>
      </div>

      {configuring && <SellerProductConfigurator key={configuring.itemKey || configuring.productId} productId={configuring.productId} brandId={brandId} initial={configuring.initial} onCancel={() => setConfiguring(null)} onAdd={(quote: SellerConfigurationQuote) => {
        const product = catalog.find(p => p.id === configuring.productId);
        setItems(current => {
          const previous = current.find(row => row.key === configuring.itemKey);
          const item: DraftItem = { key: previous?.key || crypto.randomUUID(), product_id: configuring.productId, product_variant_id: null,
            name: quote.name, description: quote.description, unit: 'zestaw', quantity: previous?.quantity || 1, days: previous?.days || 1,
            baseUnitPrice: quote.price, clientUnitPrice: previous?.clientUnitPrice ?? quote.price, isCustom: false,
            imagePath: product?.offer_image_path, configurationQuoteId: quote.id, configuration: quote.configuration,
            pageLayout: sellerItemLayout(quote.configuration, previous?.pageLayout) };
          return previous ? current.map(row => row.key === previous.key ? item : row) : [...current, item];
        });
        setRecommendations(current => current.filter(row => row.product_id !== configuring.productId));
        setConfiguring(null);
      }} />}
      {customOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCustomItem(); }}>
        <div role="dialog" aria-modal="true" aria-labelledby="custom-item-title" aria-describedby="custom-item-description" className="w-full max-w-lg rounded-t-2xl bg-[#1c1f33] p-5 shadow-2xl sm:rounded-xl">
          <div className="flex items-start justify-between gap-3"><h2 id="custom-item-title" className="text-lg">Własna pozycja hotelu</h2><button type="button" onClick={closeCustomItem} aria-label="Zamknij okno własnej pozycji" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/55 hover:bg-white/5"><X className="h-5 w-5" /></button></div>
          <p id="custom-item-description" className="mt-1 text-xs leading-5 text-white/50">Możesz rozbudować ofertę o własną usługę. Cena trafi do oferty bez zmian; opiekun MAVINCI ją zatwierdzi lub zaproponuje zmianę.</p>
          <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); addCustomItem(); }}>
            <label className="block text-xs text-white/55">Nazwa<input ref={customNameRef} value={customName} onChange={(event) => { setCustomName(event.target.value); setCustomError(''); }} className={`${fieldClass} mt-1.5`} /></label>
            <label className="block text-xs text-white/55">Opis<textarea value={customDescription} onChange={(event) => setCustomDescription(event.target.value)} rows={3} className={`${fieldClass} mt-1.5 resize-y`} /></label>
            <label className="block text-xs text-white/55">Cena dla gościa netto (zł)<input inputMode="decimal" value={customPrice} onChange={(event) => { setCustomPrice(event.target.value); setCustomError(''); }} className={`${fieldClass} mt-1.5`} placeholder="0,00" /></label>
            {customError && <p role="alert" className="text-sm text-rose-200">{customError}</p>}
            <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={closeCustomItem} className="min-h-11 rounded-lg bg-white/5 px-4 py-2 text-sm text-white/65">Anuluj</button><button type="submit" className="min-h-11 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#111522]">Dodaj do oferty</button></div>
          </form>
        </div>
      </div>}
    </div>
  );
}
