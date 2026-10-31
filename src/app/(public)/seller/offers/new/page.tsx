'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { AlertTriangle, Check, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { sellerMoney, useSellerPortalContext } from '@/lib/seller/portal';
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
    return 'Nie można zapisać lub odczytać oferty, ponieważ system wymaga aktualizacji bazy danych. Skontaktuj się z opiekunem Mavinci.';
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
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customPrice, setCustomPrice] = useState(0);
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
        .select('id,my_company_id,partner_organization_id,partner_branding_snapshot,partner_branding_profile_id,commercial_model,partner_commission_rate,title,description,event_date,event_location,valid_until,portal_client_name,portal_client_company,portal_client_email,portal_client_phone,recommended_items,offer_items(id,product_id,product_variant_id,name,description,quantity,unit,base_partner_unit_price,client_unit_price,is_partner_custom,display_order,partner_source_snapshot,pricing_configuration,seller_configuration_quote_id,days,offer_page_variant_override)')
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
          baseUnitPrice: Number(item.base_partner_unit_price || 0),
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

  const addCustomItem = () => {
    if (!customName.trim()) return;
    setItems((current) => [...current, {
      key: `custom-${Date.now()}`,
      product_id: null,
      product_variant_id: null,
      name: customName.trim(),
      description: customDescription.trim(),
      unit: 'szt.',
      quantity: 1,
      days: 1,
      baseUnitPrice: 0,
      clientUnitPrice: Number(customPrice || 0),
      isCustom: true,
      pageLayout: 'default',
    }]);
    setCustomName('');
    setCustomDescription('');
    setCustomPrice(0);
    setCustomOpen(false);
  };

  const updateItem = (key: string, patch: Partial<DraftItem>) => setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  const removeItem = (key: string) => {
    setItems((current) => current.filter((item) => item.key !== key));
    setCatalogAlert(null);
  };

  const totals = useMemo(() => {
    const base = items.reduce((sum, item) => sum + item.baseUnitPrice * item.quantity * item.days, 0);
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
      if (!generatePdf) { router.push('/seller/offers/' + pending.offerId); redirected = true; return; }
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

  if (contextLoading || catalogLoading || editingLoading || (context && editorLoading)) return <div role="status" className="flex items-center justify-center gap-3 p-10 text-[#d3bb73]"><Loader2 className="h-6 w-6 animate-spin" aria-hidden="true"/>Ładowanie kreatora…</div>;
  if (!context) return <div className="p-10 text-center text-[#e5e4e2]/50">Brak dostępu do portalu sprzedawcy.</div>;
  if (editorError) return <div role="alert" className="m-6 space-y-4 rounded-xl bg-white/5 p-6 text-amber-100"><p>{editorError}</p><button type="button" onClick={() => setEditorRetry(n => n + 1)} className="rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-[#d3bb73]">Spróbuj ponownie</button></div>;

  return (
    <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6">
      <FullScreenLoader show={saving} title={saveStage} description="Przygotowujemy dokument. Gotowa oferta otworzy się automatycznie — nie zamykaj tego okna." />
      <div className="mx-auto max-w-7xl space-y-5">
        <header><h1 className="text-2xl font-light">{editingOfferId ? 'Edycja oferty' : 'Nowa oferta'}</h1><p className="mt-1 text-sm text-[#e5e4e2]/60">Wybierz klienta, miejsce i usługi. Oferta otrzyma identyfikację Twojej organizacji.</p></header>

        {error && <div ref={saveErrorRef} role="alert" className="rounded-lg border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">{error}</div>}

        <section className="grid gap-4 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs text-[#e5e4e2]/50 md:col-span-2">Tytuł oferty<input value={title} onChange={(event) => setTitle(event.target.value)} className={`${fieldClass} mt-1.5`} /></label>
          <div id="seller-offer-event-schedule" className="min-w-0 scroll-mt-24">
          <SellerEventSchedule compact requiredForPdf value={scheduledDays} onValidityChange={setEventDateValid}
            disabled={saving || arrangements?.can_edit === false}
            notice={hasLegacySellerEventRange(arrangements?.values) && !scheduleChanged ? 'Zachowamy wcześniejsze ustalenia początku i końca. Jeśli zmieniasz termin, uzupełnij wszystkie dni i godziny — zastąpią poprzedni zakres.' : undefined}
            onChange={days => { setEventDays(days); setEventDate(days[0]?.date || ''); setScheduleChanged(true); }} />
          </div>
          <SellerDatePicker label="Oferta ważna do" value={validUntil} onChange={setValidUntil} onValidityChange={setValidUntilValid} />
          <div className="md:col-span-2 xl:col-span-4">
            <SellerClientPicker key={`${context.profile.id}:${brandId}`} companyId={brandId}
              client={{ name: clientName, company: clientCompany, email: clientEmail, phone: clientPhone }}
              onSelect={(client) => { setClientName(client.name); setClientCompany(client.company); setClientEmail(client.email); setClientPhone(client.phone); }} />
            <p className="mt-3 text-xs text-white/50">Wybierz zapisany kontakt powyżej lub uzupełnij dane nowego klienta poniżej.</p>
          </div>
          <label className="text-xs text-[#e5e4e2]/50">Klient / osoba<input value={clientName} onChange={(event) => setClientName(event.target.value)} className={`${fieldClass} mt-1.5`} placeholder="Imię i nazwisko" /></label>
          <label className="text-xs text-[#e5e4e2]/50">Firma klienta<input value={clientCompany} onChange={(event) => setClientCompany(event.target.value)} className={`${fieldClass} mt-1.5`} placeholder="Opcjonalnie" /></label>
          <label className="text-xs text-[#e5e4e2]/50">E-mail<input type="email" value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} className={`${fieldClass} mt-1.5`} /></label>
          <label className="text-xs text-[#e5e4e2]/50">Telefon<input value={clientPhone} onChange={(event) => setClientPhone(event.target.value)} className={`${fieldClass} mt-1.5`} /></label>
          {hotel?.location && <div className="space-y-3 rounded-lg bg-white/[0.025] p-3 md:col-span-2 xl:col-span-4">
            <p className="text-sm font-medium">Sala lub teren na zewnątrz · {hotel.location.name}</p>
            <SearchCombobox value={roomId} disabled={saving || arrangements?.can_edit === false}
              options={[
                ...hotel.location.rooms.map(room => ({ id: room.id, label: `${room.name}${room.kind === 'outdoor' ? ' · teren na zewnątrz' : ''}` })),
                ...(roomId && !hotel.location.rooms.some(room => room.id === roomId) ? [{ id: roomId, label: `${arrangements?.values.room || 'Zapisana przestrzeń'} — archiwalna` }] : []),
              ]}
              onChange={id => { setRoomId(id); setRoomChanged(true); const room = hotel.location!.rooms.find(r => r.id === id); setEventLocation([hotel.location!.name, room?.name].filter(Boolean).join(' — ')); }}
              ariaLabel="Sala lub teren hotelu" placeholder="Wybierz przestrzeń z bazy hotelu…" emptyLabel="Brak przestrzeni — poproś opiekuna o uzupełnienie lokalizacji" />
            {roomId && <details><summary className="cursor-pointer text-xs text-[#d3bb73]">Szczegóły i materiały przestrzeni</summary><div className="mt-3"><p className="mb-3 whitespace-pre-wrap text-sm text-white/60">{hotel.location.rooms.find(room => room.id === roomId)?.notes}</p><TechnicalDetailsView value={hotel.location.rooms.find(room => room.id === roomId)?.technical}/></div></details>}
            <p className="text-xs text-white/50">Baza hotelu jest zarządzana w CRM. Wybrana przestrzeń zostanie zapisana także w ustaleniach realizacji. Bez wyboru pozostanie do uzgodnienia.</p>
          </div>}
          <label className="text-xs text-[#e5e4e2]/50 md:col-span-2">Miejsce wydarzenia<input value={eventLocation} onChange={(event) => setEventLocation(event.target.value)} className={`${fieldClass} mt-1.5`} placeholder={context.profile.organization?.name || 'Hotel / adres'} /></label>
          <label className="text-xs text-[#e5e4e2]/50 md:col-span-2">Wprowadzenie<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} className={`${fieldClass} mt-1.5 resize-y`} placeholder="Krótki opis potrzeb klienta lub wydarzenia" /></label>
        </section>

        <p className="text-xs text-white/45">
          {editingOfferId ? 'Oferta zachowuje zapisany sposób rozliczenia.' : 'Sposób rozliczenia nowych ofert pochodzi z ogólnych warunków.'}{' '}
          <Link href={`/seller/profile?brand=${brandId}#general-terms`} className="text-[#d3bb73] hover:underline">Otwórz ustawienia</Link>
        </p>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
          <div className="min-w-0 space-y-5">
            <section className="rounded-xl bg-[#1c1f33] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-medium">Katalog Mavinci</h2><p className="mt-1 text-xs text-[#e5e4e2]/40">Wybierz usługi do głównej wyceny. Najedź na zdjęcie, aby je powiększyć; tytuł otwiera podgląd w nowej karcie.</p></div><button type="button" onClick={() => setCustomOpen(true)} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs text-[#d3bb73]"><Plus className="h-3.5 w-3.5" /> Własna pozycja</button></div>
              {(catalogAlert || duplicateCatalogItems.length > 0) && <div role="alert" className="mt-4 flex items-start gap-3 rounded-lg bg-amber-300/10 px-4 py-3 text-sm leading-5 text-amber-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /><span>{catalogAlert || `Oferta zawiera powtórzone pozycje: ${duplicateCatalogItems.map((item) => item.name).join(', ')}. Usuń duplikaty przed zapisaniem.`}</span></div>}
              <SellerOfferCatalog key={`main-${brandId}`} products={catalog} brandId={brandId} imageUrls={catalogImages} selectedKeys={selectedCatalogKeys} onAdd={addCatalogItem} disabled={saving} label="Katalog główny" />
            </section>

            <section className="rounded-xl bg-[#1c1f33] p-5">
              <h2 className="flex items-start gap-2 font-medium"><Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-[#d3bb73]" />Zobacz, co warto dobrać do takiego wydarzenia</h2>
              <p className="mt-2 text-sm leading-6 text-white/50">Dobierz opcjonalne usługi z tej samej listy produktów. Pojawią się osobno w PDF — poza sumą oferty i rezerwacją sprzętu. Cenę dla klienta ustalasz przy każdej propozycji zgodnie ze sposobem rozliczenia oferty.</p>
              <p aria-live="polite" className="mt-3 text-xs text-[#d3bb73]">Wybrane propozycje: {recommendations.length} / 24{recommendations.length >= 24 ? ' · Osiągnięto limit. Usuń propozycję, aby dodać inną.' : ''}</p>
              {recommendationAlert && <p role="alert" className="mt-3 rounded-lg bg-amber-300/10 px-4 py-3 text-sm text-amber-100">{recommendationAlert}</p>}
              {recommendationCatalog.length > 0 ? <SellerOfferCatalog key={`recommendations-${brandId}`} products={recommendationCatalog} brandId={brandId} imageUrls={catalogImages} selectedKeys={unavailableRecommendationKeys} mainOfferKeys={selectedCatalogKeys} onAdd={addRecommendation} disabled={saving || recommendations.length >= 24} actionLabel="Dobierz" label="Katalog propozycji dodatkowych" /> : <p className="mt-4 rounded-lg bg-white/[0.03] p-4 text-sm text-white/50">Brak dodatkowych produktów do zaproponowania. Produkty z głównej oferty są ukryte w tej liście.</p>}
              <div className="mt-5 rounded-xl bg-black/10 p-4">
                <h3 className="text-sm font-medium">Wybrane propozycje dodatkowe</h3>
                {!recommendations.length && <p className="mt-3 text-xs leading-5 text-white/40">Kliknij „Dobierz” przy produkcie powyżej. Pusta sekcja nie pojawi się w PDF.</p>}
                <div className="mt-4 space-y-3">{recommendations.map((item) => <div key={item.id} className="rounded-lg bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3"><Link href={`/seller/products/${item.product_id}?brand=${encodeURIComponent(brandId)}`} target="_blank" rel="noopener noreferrer" className="text-sm hover:text-[#d3bb73] hover:underline">{item.name}</Link><button type="button" disabled={saving} aria-label={'Usuń propozycję '+item.name} onClick={() => { setRecommendations((current) => current.filter((row) => row.id !== item.id)); setRecommendationAlert(null); }} className="rounded-lg p-2 text-white/40 hover:bg-red-300/10 hover:text-red-300"><Trash2 className="h-4 w-4" /></button></div>
                  <label className="mt-2 block text-xs text-white/50">Dlaczego warto dobrać tę usługę?<textarea rows={2} maxLength={500} value={item.description} disabled={saving} onChange={(event) => updateRecommendation(item.id,{description:event.target.value})} className={fieldClass+' mt-1.5'} placeholder="Krótka korzyść dla klienta" /></label>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="text-xs text-white/50">Ilość ({item.unit})<input type="number" min="0.01" max="100000" step="0.01" value={Number.isFinite(item.quantity) ? item.quantity : ''} disabled={saving} onChange={(event) => updateRecommendation(item.id,{quantity:event.target.valueAsNumber})} className={fieldClass+' mt-1.5'} /></label>
                    <label className="text-xs text-white/50">Cena dla klienta netto / szt.<input type="number" min="0" max="1000000000" step="0.01" value={Number.isFinite(item.unit_price) ? item.unit_price : ''} disabled={saving || commercialModel==='commission'} onChange={(event) => updateRecommendation(item.id,{unit_price:event.target.valueAsNumber})} className={fieldClass+' mt-1.5'} /></label>
                    <p className="self-end py-3 text-sm text-[#d3bb73]">{Number.isFinite(item.quantity*item.unit_price) ? sellerMoney(item.quantity*item.unit_price) : 'Uzupełnij cenę i ilość'} netto · opcjonalnie</p>
                  </div>
                </div>)}</div>
              </div>
              <p className="mt-3 text-xs leading-5 text-white/40">Produkty z głównej oferty są ukryte wraz z wariantami. Wybrane propozycje są oznaczone i przesunięte na koniec listy. Dodanie produktu do głównej wyceny usuwa jego propozycje; po usunięciu z wyceny produkt znów można dobrać.</p>
            </section>
          </div>

          <section className="h-fit min-w-0 rounded-xl bg-[#1c1f33] p-4 sm:p-5">
            <SellerOfferItems items={items} brandId={brandId} imageUrls={catalogImages} commission={commercialModel === 'commission'} disabled={saving}
              configurableProductIds={configurableProductIds} onUpdate={updateItem} onRemove={removeItem} onReorder={setItems}
              onConfigure={item => { if (item.product_id) setConfiguring({ productId: item.product_id, itemKey: item.key, initial: item.configuration }); }} />
            <div className="mt-5 space-y-2 border-t border-white/8 pt-4 text-sm"><div className="flex justify-between text-white/50"><span>Twój cennik Mavinci</span><span>{sellerMoney(totals.base)}</span></div><div className="flex justify-between"><span>Cena dla klienta netto</span><span>{sellerMoney(totals.client)}</span></div><div className="flex justify-between text-white/50"><span>Klient brutto</span><span>{sellerMoney(totals.gross)}</span></div><div className="flex justify-between border-t border-white/8 pt-3 text-[#d3bb73]"><span>{commercialModel === 'commission' ? `Prowizja ${commissionRate}%` : 'Marża hotelu'}</span><span>{sellerMoney(totals.earnings)}</span></div></div>
            <button type="button" disabled={saving || items.length === 0 || duplicateCatalogItems.length > 0} onClick={() => void saveOffer(false)} className="mt-5 w-full rounded-lg bg-white/5 px-4 py-3 text-sm disabled:opacity-40">Zapisz szkic bez PDF</button>
            {!hasEventDate && <p className="mt-3 text-xs leading-5 text-[#d3bb73]">Przed wygenerowaniem PDF <a href="#seller-offer-event-schedule" className="underline underline-offset-2">wybierz datę wydarzenia</a>. Szkic możesz zapisać bez terminu.</p>}
            <button type="button" disabled={saving || items.length === 0 || duplicateCatalogItems.length > 0 || !hasEventDate || !eventDateValid || !validUntilValid} onClick={() => void saveOffer(true)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-3 text-sm font-medium text-[#111522] disabled:cursor-not-allowed disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {saving ? 'Zapisywanie…' : editingOfferId ? 'Zapisz i wygeneruj PDF' : 'Zapisz i wygeneruj ofertę'}</button>
          </section>
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
      {customOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><div className="w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-5"><h2 className="text-lg">Własna pozycja hotelu</h2><p className="mt-1 text-xs text-white/40">Możesz rozbudować ofertę. Mavinci zobaczy tę pozycję i będzie mogło ją zatwierdzić lub wycenić.</p><div className="mt-4 space-y-3"><label className="block text-xs text-white/50">Nazwa<input value={customName} onChange={(event) => setCustomName(event.target.value)} className={`${fieldClass} mt-1.5`} /></label><label className="block text-xs text-white/50">Opis<textarea value={customDescription} onChange={(event) => setCustomDescription(event.target.value)} rows={3} className={`${fieldClass} mt-1.5 resize-y`} /></label><label className="block text-xs text-white/50">Cena dla klienta netto<input type="number" min="0" step="0.01" value={customPrice} onChange={(event) => setCustomPrice(Number(event.target.value || 0))} className={`${fieldClass} mt-1.5`} /></label></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setCustomOpen(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/50">Anuluj</button><button type="button" onClick={addCustomItem} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#111522]">Dodaj do oferty</button></div></div></div>}
    </div>
  );
}
