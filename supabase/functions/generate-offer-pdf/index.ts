import { compactProductBlockReason, compactProductDescription } from '../_shared/productPresentation.ts';
import { paginateProductVariants } from '../_shared/productVariantPages.ts';
import { PACKAGE_LAYOUT as packageLayout, PACKAGE_COPY as packageCopy, validateSalesPackages, packageExtensionLabel, type ProductSalesPackage } from '../_shared/productSalesPackages.ts';
import { expandConfiguredItems, hasOfferAddons, configurationPrice, validateConfiguration, addonMoney, createConfiguration, addonQuantity } from '../_shared/offerAddons.ts';
import { offerPdfFileName } from '../_shared/offerPdfFileName.ts';
import { publicProductUrl } from '../_shared/publicProductUrl.ts';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, rgb, pushGraphicsState, popGraphicsState, moveTo, lineTo, appendBezierCurve, closePath, clip, endPath, PDFName, PDFDict, PDFString, PDFArray, PDFNumber } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

import { drawPaginatedOfferPricingTable } from './offerPricingTable.ts';

import { createSellerDemoOffer } from '../_shared/sellerDemoOffer.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const sellerFontError = (message: string) => Object.assign(new Error(message), { code: 'SELLER_FONT_ERROR' });

interface GenerateOfferPdfRequest {
  offerId: string;
  employeeId?: string;
  outputMode?: 'crm' | 'seller_binary' | 'demo_binary' | 'demo_cover';
  demo?: unknown;
  expectedSourceKey?: string;
  resourceMode?: 'standard' | 'compact';
}

interface TextFieldConfig {
  field_name: string;
  label: string;
  x: number;
  y: number;
  type?: 'text' | 'image' | 'email' | 'phone' | 'url';
  font_size?: number;
  font_color?: string;
  max_width?: number;
  align?: 'left' | 'center' | 'right';
  width?: number;
  height?: number;
  border_radius?: number;
  is_circular?: boolean;
  icon_id?: string;
  clickable?: boolean;
  line_height?: number;
  font_role?: 'heading' | 'body';
  cta_button?: boolean;
  image_fit?: 'cover' | 'contain';
  image_position_x?: number;
  image_position_y?: number;
  image_zoom?: number;
  show_icon?: boolean;
  link_url?: string;
}

type OfferAssumptionItem = {
  key: string;
  label: string;
  value: string;
  badge_value?: string;
};

const offerAssumptionLabels: Record<string, string> = {
  guest_count: 'Liczba gości',
  event_hours: 'Godziny wydarzenia',
  client_needs: 'Przebieg i potrzeby klienta',
  event_format: 'Format wydarzenia',
  agenda: 'Agenda i kluczowe momenty',
  venue: 'Miejsce i warunki',
  audience: 'Grupa odbiorców',
  engagement: 'Zaangażowanie uczestników',
  brand_visibility: 'Widoczność marki',
  guest_experience: 'Doświadczenie uczestników',
  online_participants: 'Uczestnicy online',
  technical_scope: 'Zakres techniczny',
  special_requirements: 'Wymagania szczególne',
  custom: 'Własne założenie',
};

const normalizeOfferAssumptionItems = (rawValue: unknown): OfferAssumptionItem[] => {
  let parsed = rawValue;
  if (typeof rawValue === 'string') {
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      parsed = [];
    }
  }

  if (!Array.isArray(parsed)) return [];
  const used = new Set<string>();
  return parsed
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object') return null;
      const key = String((candidate as Record<string, unknown>).key || '');
      const isCustom = key === 'custom';
      if (!offerAssumptionLabels[key] || (!isCustom && used.has(key))) return null;
      if (!isCustom) used.add(key);
      const customLabel = String((candidate as Record<string, unknown>).label || '').trim();
      return {
        key,
        label: isCustom
          ? customLabel.slice(0, 80) || offerAssumptionLabels[key]
          : offerAssumptionLabels[key],
        value: String((candidate as Record<string, unknown>).value || '').trim(),
        badge_value: String((candidate as Record<string, unknown>).badge_value || '').trim().slice(0, 7),
      };
    })
    .filter((item): item is OfferAssumptionItem => Boolean(item))
    .slice(0, 3);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: { ...corsHeaders, 'X-Offer-Renderer': 'seller-v1', 'X-Offer-Identity': 'organization-v1', 'X-Offer-Fonts': 'catalog-v1', 'X-Offer-Demo': 'demo-v2', 'X-Offer-Demo-Cover': 'cover-v1' },
    });
  }

  const startedAt = performance.now();
  const timings: Record<string, number> = {};
  const assetStats = { images: 0, imageCacheHits: 0, png: 0, jpeg: 0, maxImagePixels: 0, templates: 0, templateCacheHits: 0 };
  const timed = async <T>(stage: string, task: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try { return await task(); }
    finally { timings[stage] = (timings[stage] || 0) + performance.now() - start; }
  };
  const reportStage = (stage: string, extra: Record<string, unknown> = {}) => {
    const memory = Deno.memoryUsage();
    console.info(JSON.stringify({ event: 'offer_pdf_performance', stage,
      elapsed_ms: Math.round(performance.now() - startedAt),
      heap_mb: Math.round(memory.heapUsed / 1048576), external_mb: Math.round(memory.external / 1048576),
      timings_ms: Object.fromEntries(Object.entries(timings).map(([key,value]) => [key,Math.round(value)])),
      assets: assetStats, ...extra }));
  };

  try {
    const {
      offerId,
      employeeId,
      resourceMode = 'standard',
      outputMode = 'crm',
      expectedSourceKey,
      demo,
    }: GenerateOfferPdfRequest = await req.json();
    const compactResourceMode = resourceMode === 'compact';

    if (!offerId) {
      throw new Error("offerId is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!['crm','seller_binary','demo_binary','demo_cover'].includes(outputMode)) throw new Error('Nieprawidłowy tryb dokumentu.');
    const demoCoverOnly = outputMode === 'demo_cover';
    const demoMode = outputMode === 'demo_binary' || demoCoverOnly;
    const sellerMode = outputMode === 'seller_binary' || demoMode;
    // Only the authorized Next.js bridge may request a private seller PDF.
    // Never accept branding, prices, storage paths or employee overrides from a seller.
    if (sellerMode && req.headers.get('Authorization') !== 'Bearer ' + supabaseKey) {
      return new Response(JSON.stringify({ error: 'Brak uprawnień' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: offer, error: offerError } = demoMode
      ? { data: await createSellerDemoOffer(supabase, demo, offerId), error: null }
      : await supabase
      .from("offers")
      .select(`
        *,
        organization:organizations!offers_organization_id_fkey(*, location:locations(*), primary_contact:contacts!organizations_primary_contact_id_fkey(*)),
        contact:contacts!contact_id(*),
        contact_person:contacts!contact_id(*),
        inquiry:tasks!inquiry_id(id, title, description, due_date, inquiry_details),
        event:events(*, location:locations(*), category:event_categories(id, name, default_offer_template_category_id)),
        created_by_employee:employees!created_by(
          id,
          name,
          surname,
          email,
          phone_number,
          avatar_url,
          signature_thumb,
          avatar_metadata,
          linkedin_url,
          instagram_url,
          facebook_url
        ),
        offer_items(
          *,
          selected_variant:offer_product_variants!product_variant_id(*),
          product:offer_products(
            *,
            variants:offer_product_variants(*)
          )
        ),
        packages:offer_packages!offer_id(
          id,
          name,
          description,
          list_price_net,
          discount_percent,
          discount_amount,
          price_net,
          is_recommended,
          display_order,
          items:offer_package_items(
            id,
            product_id,
            product_variant_id,
            quantity,
            display_order,
            product:offer_products(id, name, unit, offer_requirements),
            selected_variant:offer_product_variants!product_variant_id(id, name)
          )
        )
      `)
      .eq("id", offerId)
      .maybeSingle();

    if (offerError || !offer) {
      throw new Error("Offer not found: " + offerError?.message);
    }

    if ((offer.sales_channel === 'seller_portal') !== sellerMode) {
      return new Response(JSON.stringify({ error: 'Oferta sprzedawcy wymaga prywatnego generatora portalu.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    // Drafts may be incomplete; a customer document requires a deliberate logistics estimate.
    // Historical accepted offers remain reproducible without editing their frozen content.
    if (!sellerMode && offer.status !== 'accepted' && offer.logistics_cost_net == null) {
      return new Response(JSON.stringify({ error: 'Oszacuj koszt logistyki w sekcji „Pakiety oferty”. Wpisz 0, jeśli nie ma dodatkowego kosztu.' }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const ensureSellerSource = async () => {
      if (!sellerMode || demoMode) return;
      const { data, error } = await supabase.rpc('seller_offer_source_key', { p_offer_id: offerId });
      if (error || !expectedSourceKey || data !== expectedSourceKey) throw new Error('Oferta zmieniła się podczas generowania. Ponów generowanie.');
    };
    await ensureSellerSource();
    const sellerBranding = sellerMode ? offer.partner_branding_snapshot || {} : {};
    let sellerCoverUrl = '';
    let sellerOrganizationName = '';
    if (sellerMode) {
      // Separate portal data from CRM relationships, calculations and base-price variants.
      offer.event = null;
      offer.event_id = null;
      offer.inquiry = null;
      offer.inquiry_id = null;
      offer.organization = null;
      offer.contact = null;
      offer.contact_person = null;
      offer.created_by_employee = {};
      offer.packages = [];
      offer.package_mode = false;
      offer.logistics_enabled = false;
      offer.hero_image_path = null;
      offer.discount_amount = 0;
      offer.discount_percent = 0;
      offer.client_type = offer.portal_client_company ? 'business' : 'individual';
      offer.offer_items = (offer.offer_items || []).map((item: any) => {
        const price = Number(item.client_unit_price);
        const quantity = Number(item.quantity);
        if (!Number.isFinite(price) || price < 0 || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Nieprawidłowa cena lub ilość w ofercie.');
        return {
          ...item, unit_price: price, final_price: price,
          subtotal: price * quantity, total: price * quantity,
          vat_rate: Number(offer.tax_percent ?? 23),
          show_product_variants_in_pdf: false,
          product: {
            ...(item.product || {}), name: item.name,
            description: item.description, variants: [], pdf_page_url: null,
            offer_page_enabled: true, vat_rate: Number(offer.tax_percent ?? 23),
            offer_image_path: item.partner_source_snapshot?.image_path || item.product?.offer_image_path,
          },
        };
      });
      const net = offer.offer_items.reduce((sum: number, item: any) => sum + item.subtotal, 0);
      offer.subtotal = net;
      offer.tax_amount = Math.round(net * Number(offer.tax_percent ?? 23)) / 100;
      offer.total_amount = Math.round((net + offer.tax_amount) * 100) / 100;
      offer.total_price = offer.total_amount;
      if (sellerBranding.identity_version === 2) {
        sellerOrganizationName = String(sellerBranding.organization_name || '');
      } else {
        const { data: profile } = await supabase.from('sales_partner_profiles').select('organization_id').eq('id', offer.sales_partner_id).single();
        if (profile?.organization_id) {
          const { data: organization } = await supabase.from('organizations').select('name,alias').eq('id', profile.organization_id).single();
          sellerOrganizationName = organization?.alias || organization?.name || '';
        }
      }
    }

    const acceptedCalculation = offer.pricing_source === 'calculation' ? offer.calculation_snapshot : null;

    const getCalculationNumber = (calculationId?: string | null, createdAt?: string | null) => {
      if (!calculationId) return '';
      const parsedDate = createdAt ? new Date(createdAt) : null;
      const year = parsedDate && Number.isFinite(parsedDate.getTime())
        ? parsedDate.getFullYear()
        : new Date().getFullYear();
      return `KAL/${year}/${calculationId.replace(/-/g, '').slice(0, 8).toLocaleUpperCase('pl-PL')}`;
    };
    const acceptedCalculationNumber = getCalculationNumber(
      acceptedCalculation?.id,
      acceptedCalculation?.created_at,
    );

    let currentEmployee: any = null;
    if (employeeId && !sellerMode) {
      const { data: empData } = await supabase
        .from("employees")
        .select("id, name, surname, email, phone_number, avatar_url, signature_thumb, avatar_metadata, linkedin_url, instagram_url, facebook_url")
        .eq("id", employeeId)
        .maybeSingle();

      currentEmployee = empData;
    }

    if (!currentEmployee) {
      currentEmployee = offer.created_by_employee || {};

    } else {

    }

    const getPdfAvatarUrl = (rawValue: unknown, targetWidth = 640) => {
      const value = String(rawValue || '').trim();
      if (!value) return '';
      try {
        const url = new URL(value);
        const publicObjectPath = '/storage/v1/object/public/';
        if (!url.pathname.includes(publicObjectPath)) return value;
        url.pathname = url.pathname.replace(publicObjectPath, '/storage/v1/render/image/public/');
        url.searchParams.set('width', String(targetWidth));
        url.searchParams.set('height', String(targetWidth));
        url.searchParams.set('resize', 'contain');
        url.searchParams.set('quality', '90');
        url.searchParams.set('format', 'origin');
        imageFallbackUrls.set(url.toString(), value);
        return url.toString();
      } catch {
        return value;
      }
    };

    const prepareOfferData = (offer: any, employee: any) => {
      const org = offer.organization;
      const contact = offer.client_type === 'business'
        ? offer.contact_person || offer.contact || offer.organization?.primary_contact
        : offer.contact;
      const inquiry = offer.inquiry;
      const event = offer.event;
      const location = org?.location || {};
      const eventLocation = event?.location || {};
      const inquiryDetails = inquiry?.inquiry_details && typeof inquiry.inquiry_details === 'object'
        ? inquiry.inquiry_details
        : {};
      const inquiryDetailsText = typeof inquiry?.inquiry_details === 'string'
        ? inquiry.inquiry_details
        : JSON.stringify(inquiry?.inquiry_details || {});
      const inquiryText = [inquiry?.description || '', inquiryDetailsText]
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const stationaryMatch = inquiryText.match(/(?:około|ok\.?|dla)?\s*(\d+)\s*(?:os(?:ób|oby)?|uczestnik(?:ów|i)?)\s*stacjon/i);
      const onlineMatch = inquiryText.match(/(?:do|około|ok\.?)\s*(\d+)\s*(?:os(?:ób|oby)?|uczestnik(?:ów|i)?)[^.]{0,45}(?:zoom|online|zdaln)/i);
      const timeMatch = inquiryText.match(/(\d{1,2}):?(\d{2})?\s*[-–]\s*(\d{1,2}):?(\d{2})?/);
      const durationHours = timeMatch
        ? Math.max(0, Number(timeMatch[3]) - Number(timeMatch[1]))
        : 0;
      const inquiryClientName = String(inquiryDetails.client_text || '')
        .split('<')[0]
        .replace(/["']/g, '')
        .trim();
      const organizationName = String(org?.alias || org?.name || '').trim();
      const organizationLegalName = String(org?.name || '').trim();
      const contactPersonName = String(
        contact?.full_name || `${contact?.first_name || ''} ${contact?.last_name || ''}`.trim(),
      ).trim();
      const rawClientName = (offer.client_type === 'business' ? organizationName : contactPersonName)
        || contact?.full_name
        || `${contact?.first_name || ''} ${contact?.last_name || ''}`.trim()
        || inquiryClientName
        || '';
      const clientName = String(rawClientName)
        .split('<')[0]
        .replace(/["']/g, '')
        .trim();
      const firstLocationValue = (...values: unknown[]) => values
        .map((value) => String(value || '').trim())
        .find(Boolean) || '';
      const eventLocationText = typeof event?.location === 'string'
        ? event.location.trim()
        : firstLocationValue(
            eventLocation.name,
            eventLocation.formatted_address,
            eventLocation.address,
            [eventLocation.street, eventLocation.postal_code, eventLocation.city]
              .filter(Boolean)
              .join(' '),
            eventLocation.city,
          );
      const inquiryLocationText = firstLocationValue(
        inquiryDetails.location_text,
        inquiryDetails.event_location,
        inquiryDetails.venue,
        inquiryDetails.place,
        inquiryDetails.miejsce,
      );

      const data = {
        client_name: clientName,
        organization_name: organizationName,
        organization_legal_name: organizationLegalName,
        contact_person_name: contactPersonName,
        contact_person_email: contact?.email || '',
        contact_person_phone: contact?.mobile || contact?.phone || '',
        client_address: location.address || `${location.street || ''} ${location.city || ''}`.trim() || contact?.address || '',
        client_nip: org?.nip || '',
        client_city: location.city || '',
        client_postal_code: location.postal_code || '',
        client_street: location.street || '',

        offer_number: offer.offer_number || '',
        offer_name: offer.name || '',
        offer_date: offer.created_at ? new Date(offer.created_at).toLocaleDateString('pl-PL') : '',
        offer_valid_until: offer.valid_until
          ? new Date(offer.valid_until).toLocaleDateString('pl-PL')
          : '',

        event_name: offer.title || event?.name || inquiryDetails.event_name || inquiry?.title?.replace(/^Zapytanie:\s*/i, '') || '',
        event_category_id: event?.category?.id || event?.category_id || '',
        event_category_name: event?.category?.name || '',
        event_date: (offer.event_date || event?.event_date || inquiry?.inquiry_details?.termin || inquiry?.due_date)
          ? new Date(offer.event_date || event?.event_date || inquiry?.inquiry_details?.termin || inquiry?.due_date).toLocaleDateString('pl-PL')
          : '',
        event_location: firstLocationValue(offer.event_location, eventLocationText, inquiryLocationText),
        event_brief: inquiry?.description || inquiry?.inquiry_details?.description || inquiryText || '',
        event_assumptions: offer.event_assumptions || inquiryDetails.event_assumptions || inquiryDetails.scope || inquiry?.description || '',
        event_assumption_items: normalizeOfferAssumptionItems(
          normalizeOfferAssumptionItems(offer.event_assumption_items).some((item) => item.value)
            ? offer.event_assumption_items
            : offer.inquiry?.inquiry_details?.event_assumption_items,
        ),
        event_goal: offer.event_goal || inquiryDetails.event_goal || '',
        event_participants_stationary: stationaryMatch?.[1] || '',
        event_participants_online: onlineMatch?.[1] || '',
        event_duration: durationHours ? `${durationHours} h` : '',

        total_price: Number(offer.total_price || offer.total_amount || 0)
          ? `${Number(offer.total_price || offer.total_amount || 0).toFixed(2)} PLN`
          : '',
        total_price_numeric: Number(offer.total_price || offer.total_amount || 0),
        subtotal: Number(offer.subtotal || 0),
        discount_percent: Number(offer.discount_percent || 0),
        discount_amount: Number(offer.discount_amount || 0),
        tax_percent: Number(offer.tax_percent || 23),
        tax_amount: Number(offer.tax_amount || 0),

        employee_first_name: employee.name || '',
        employee_last_name: employee.surname || '',
        employee_full_name: employee.name && employee.surname
          ? `${employee.name} ${employee.surname}`
          : '',
        employee_email: employee.email || '',
        employee_phone: employee.phone_number || '',
        employee_avatar_url: getPdfAvatarUrl(employee.signature_thumb || employee.avatar_url),
        employee_avatar_metadata: employee.avatar_metadata || null,
        employee_linkedin_url: employee.linkedin_url || '',
        employee_instagram_url: employee.instagram_url || '',
        employee_facebook_url: employee.facebook_url || '',

        seller_name: 'Mavinci Event & Entertainment',
        seller_address: '',
        seller_nip: '',

        offer_items: offer.offer_items || [],
        offer_packages: offer.packages || [],
        package_mode: offer.package_mode === true,
        logistics_enabled: offer.logistics_enabled === true,
        logistics_price_net: Number(offer.logistics_price_net || 0),
        logistics_description: offer.logistics_description || '',
      };

      return data;
    };

    const wrappedTextCache = new WeakMap<object, Map<string, string[]>>();
    const wrapText = (text: string, font: any, fontSize: number, maxWidth: number): string[] => {
      let cache = wrappedTextCache.get(font);
      if (!cache) { cache = new Map(); wrappedTextCache.set(font, cache); }
      const key = JSON.stringify([text,fontSize,maxWidth]);
      const hit = cache.get(key);
      if (hit) return [...hit];
      const lines: string[] = [];
      const paragraphs = String(text).split(/\r?\n/);

      paragraphs.forEach((paragraph, paragraphIndex) => {
        const words = paragraph.split(/\s+/).filter(Boolean);
        let currentLine = '';

        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const width = font.widthOfTextAtSize(testLine, fontSize);

          if (width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }

        if (currentLine) lines.push(currentLine);
        if (!paragraph && paragraphIndex < paragraphs.length - 1) lines.push('');
      });

      if (cache.size >= 512) cache.clear();
      cache.set(key, [...lines]);
      return lines;
    };

    const drawOfferItemsTable = async (
      pdfDoc: PDFDocument,
      pageIndex: number,
      offerItems: any[],
      totalPrice: number,
      config: any = {}
    ) => {
      if (!offerItems || offerItems.length === 0) return;

      const { regularFont, boldFont } = await ensureFonts(pdfDoc);

      drawPaginatedOfferPricingTable(pdfDoc, pageIndex, offerItems, totalPrice, regularFont, boldFont, config);
    };

    let overlayFontCache: {
      pdfDoc: PDFDocument;
      regularFont: any;
      boldFont: any;
      symbolsFont: any;
      headingFont: any;
    } | null = null;
    let embeddedImageCache: {
      pdfDoc: PDFDocument;
      images: Map<string, any>;
    } | null = null;
    const imageFallbackUrls = new Map<string, string>();
    let brandHeadingFontUrl = '';
    let brandHeadingFontFamily = '';
    let brandLogoUrl = '';
    let brandCompanyName = 'MAVINCI';

    const cacheFontWidths = (font: any) => {
      const measure = font.widthOfTextAtSize.bind(font);
      const widths = new Map<string, number>();
      font.widthOfTextAtSize = (text: string, size: number) => {
        const key = JSON.stringify([text,size]);
        const cached = widths.get(key);
        if (cached !== undefined) return cached;
        const result = measure(text,size);
        if (widths.size >= 2048) widths.clear();
        widths.set(key,result);
        return result;
      };
      return font;
    };
    const fetchFont = async (url: string, required: boolean, restrictRedirects = false) => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(20000), ...(restrictRedirects ? { redirect: 'error' as const } : {}) });
        if (!response.ok) throw new Error('Nie udało się pobrać czcionki PDF.');
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Plik czcionki przekracza 10 MB.');
        return bytes;
      } catch (error) {
        if (required) throw error;
        return null;
      }
    };
    const ensureFonts = async (pdfDoc: PDFDocument) => {
      if (overlayFontCache?.pdfDoc === pdfDoc) return overlayFontCache;
      pdfDoc.registerFontkit(fontkit);
      const base = 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/';
      const [regularBytes, boldBytes, headingBytes] = await timed('font_fetch', () => Promise.all([
        fetchFont(base + 'NotoSans/hinted/ttf/NotoSans-Regular.ttf', true),
        fetchFont(base + 'NotoSans/hinted/ttf/NotoSans-Bold.ttf', true),
        brandHeadingFontUrl ? fetchFont(brandHeadingFontUrl, false, sellerMode) : Promise.resolve(null),
      ]));
      if (sellerMode && brandHeadingFontUrl && !headingBytes) {
        throw sellerFontError('Nie udało się pobrać wybranej czcionki marki. Sprawdź plik w brandbooku.');
      }
      const embed = (bytes: ArrayBuffer) => timed('font_embed', async () => cacheFontWidths(await pdfDoc.embedFont(bytes, { subset: true })));
      const regularFont = await embed(regularBytes!);
      const boldFont = await embed(boldBytes!);
      let headingFont = regularFont;
      if (headingBytes) {
        try { headingFont = await embed(headingBytes); }
        catch (error) {
          if (sellerMode) throw sellerFontError('Nie można osadzić wybranej czcionki w PDF. Wgraj prawidłowy font lub wybierz inny z biblioteki.');
          throw error;
        }
      }
      overlayFontCache = { pdfDoc, regularFont, boldFont, headingFont, symbolsFont: null };
      reportStage('fonts_ready');
      return overlayFontCache;
    };
    const ensureSymbolsFont = async (pdfDoc: PDFDocument) => {
      const fonts = await ensureFonts(pdfDoc);
      if (fonts.symbolsFont) return fonts.symbolsFont;
      const bytes = await timed('font_fetch', () => fetchFont('https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansSymbols2/hinted/ttf/NotoSansSymbols2-Regular.ttf', false));
      fonts.symbolsFont = bytes
        ? await timed('font_embed', async () => cacheFontWidths(await pdfDoc.embedFont(bytes, { subset: true })))
        : fonts.regularFont;
      return fonts.symbolsFont;
    };


    const embedImageFromUrl = async (pdfDoc: PDFDocument, imageUrl: string) => {
      if (!embeddedImageCache || embeddedImageCache.pdfDoc !== pdfDoc) {
        embeddedImageCache = { pdfDoc, images: new Map() };
      }

      let cacheKey = imageUrl;
      try {
        const cacheUrl = new URL(imageUrl);
        cacheUrl.searchParams.delete('token');
        cacheUrl.searchParams.sort();
        cacheKey = cacheUrl.toString();
      } catch { /* Validated inline demo assets are keyed by their complete data URL. */ }
      const cached = embeddedImageCache.images.get(cacheKey);
      if (cached) { assetStats.imageCacheHits += 1; return cached; }

      const fetchStarted = performance.now();
      let resolvedUrl = imageUrl;
      let imageResponse = await fetch(resolvedUrl);
      let imageType = imageResponse.headers.get('content-type') || '';
      const unsupportedOptimizedFormat = imageType.includes('webp') || imageType.includes('avif');
      if (!imageResponse.ok || unsupportedOptimizedFormat) {
        const fallbackUrl = imageFallbackUrls.get(imageUrl);
        if (!fallbackUrl) throw new Error(`Failed to fetch supported image: ${imageResponse.status}`);
        resolvedUrl = fallbackUrl;
        imageResponse = await fetch(resolvedUrl);
        imageType = imageResponse.headers.get('content-type') || '';
      }
      if (!imageResponse.ok) throw new Error(`Failed to fetch image: ${imageResponse.status}`);
      const imageBytes = await imageResponse.arrayBuffer();
      timings.image_fetch = (timings.image_fetch || 0) + performance.now() - fetchStarted;
      const resolvedPath = resolvedUrl.split('?')[0];
      const isPng = imageType.includes('png') || resolvedPath.toLowerCase().endsWith('.png');
      const image = await timed('image_embed', () => isPng
        ? pdfDoc.embedPng(imageBytes)
        : pdfDoc.embedJpg(imageBytes));
      assetStats.images += 1;
      if (isPng) assetStats.png += 1; else assetStats.jpeg += 1;
      assetStats.maxImagePixels = Math.max(assetStats.maxImagePixels, image.width * image.height);
      embeddedImageCache.images.set(cacheKey, image);
      return image;
    };

    const createOptimizedSignedImageUrl = async (
      bucket: string,
      path: string,
      width = 1440,
    ) => {
      const storage = supabase.storage.from(bucket);
      const [optimizedResult, originalResult] = await Promise.all([
        storage.createSignedUrl(path, 600, {
          transform: {
            width,
            height: width,
            resize: 'contain',
            quality: 88,
            format: 'origin',
          },
        } as any),
        storage.createSignedUrl(path, 600),
      ]);
      const originalUrl = originalResult.data?.signedUrl || '';
      const optimizedUrl = optimizedResult.data?.signedUrl || '';
      if (optimizedUrl && originalUrl) imageFallbackUrls.set(optimizedUrl, originalUrl);
      return optimizedUrl || originalUrl;
    };

    // Key by page object: calculation pagination can insert pages in the middle.
    // Store layout preferences, then draw document furniture only after assembly.
    const documentFurniture = new Map<ReturnType<PDFDocument['getPage']>, {
      number?: TextFieldConfig;
      footer?: { field: TextFieldConfig; value: string };
    }>();
    const isPageNumberField = (name: string) => /(?:^|_)(?:page_number|page_num|page_no|page)$/.test(name);

    const overlayTextOnPages = async (
      pdfDoc: PDFDocument,
      startPageIndex: number,
      pageCount: number,
      textFields: TextFieldConfig[],
      data: Record<string, any>,
      renderDocumentFurniture = false,
    ) => {
      if (!textFields || textFields.length === 0) return;

      const { regularFont, boldFont, headingFont } = await ensureFonts(pdfDoc);
      let symbolsFont = overlayFontCache!.symbolsFont;

      // Keep the product CTA with its main copy, including custom template layouts.
      let displayFields = textFields;
      let displayData = data;
      const descriptionField = textFields.find(field => field.field_name === 'product_description' || field.field_name === 'variant_page_description');
      const productUrl = typeof data.product_page_url === 'string' ? data.product_page_url : '';
      if (descriptionField && productUrl) {
        const descriptionSize = descriptionField.font_size || 12;
        const descriptionLineHeight = descriptionField.line_height || descriptionSize * 1.2;
        const descriptionWidth = descriptionField.max_width || 245;
        const descriptionFont = descriptionField.font_role === 'heading' ? headingFont : regularFont;
        const nextFieldY = Math.min(750, ...textFields.filter(field =>
          field !== descriptionField && !/more|footer|page_number/.test(field.field_name)
          && field.y > descriptionField.y
          && field.x < descriptionField.x + descriptionWidth
          && field.x + (field.max_width || field.width || 1) > descriptionField.x
        ).map(field => field.y - 10));
        const layoutBottom = descriptionField.field_name === 'variant_page_description' ? 295
          : descriptionField.y === 210 ? 420 : descriptionField.y === 158 ? 225
          : descriptionField.y === 455 ? 575 : 750;
        const bottom = Math.min(nextFieldY, layoutBottom);
        const originalLines = wrapText(String(data[descriptionField.field_name] || ''), descriptionFont, descriptionSize, descriptionWidth);
        const availableLines = Math.max(1, Math.floor((bottom - descriptionField.y - 37) / descriptionLineHeight));
        const fittedLines = originalLines.slice(0, availableLines);
        if (originalLines.length > availableLines && fittedLines.length) {
          let last = fittedLines[fittedLines.length - 1].trimEnd();
          while (last && descriptionFont.widthOfTextAtSize(last + '…', descriptionSize) > descriptionWidth) last = last.slice(0, -1).trimEnd();
          fittedLines[fittedLines.length - 1] = last + '…';
        }
        const ctaTop = descriptionField.y + fittedLines.length * descriptionLineHeight + 8;
        displayFields = textFields.filter(field => !['product_more_link', 'variant_more_link'].includes(field.field_name));
        displayFields = [...displayFields, {
          field_name: 'product_description_cta', label: 'Czytaj więcej i zobacz zdjęcia',
          type: 'url', show_icon: false, link_url: productUrl, cta_button: true,
          x: descriptionField.x + 10, y: ctaTop + 7, font_size: 8.5,
          font_color: '#ffffff', max_width: 130,
        }];
        displayData = { ...data, [descriptionField.field_name]: fittedLines.join('\n'), product_description_cta: 'CZYTAJ WIĘCEJ' };
      }

      // Visual titles have one reserved line; truncate the presentation, not the product name in the catalog.
      if (data.product_visual_layout) {
        const title = textFields.find(field => field.field_name === 'product_name');
        if (title) {
          const font = title.font_role === 'heading' ? headingFont : boldFont;
          const size = title.font_size || 24;
          const width = title.max_width || 505;
          let value = String(displayData.product_name || '').toLocaleUpperCase('pl-PL').replace(/\s+/g, ' ').trim();
          if (font.widthOfTextAtSize(value, size) > width) {
            value = value.replace(/…$/, '').trimEnd();
            while (value && font.widthOfTextAtSize(value + '…', size) > width) value = value.slice(0, -1).trimEnd();
            value += '…';
          }
          displayData = { ...displayData, product_name: value };
        }
      }

      // Fit compact copy using the actual font, leaving a separate row for its CTA.
      for (const field of textFields) {
        const match = /^product_([1-3])_description$/.exec(field.field_name);
        if (!match) continue;
        const slot = Number(match[1]);
        const prefix = `product_${slot}`;
        const url = data[`${prefix}_page_url`];
        if (typeof url !== 'string' || !url) continue;
        const top = 145 + (slot - 1) * 215;
        const size = field.font_size || 9.3;
        const lineHeight = field.line_height || size * 1.2;
        const width = field.max_width || 315;
        const font = field.font_role === 'heading' ? headingFont : regularFont;
        const requirements = textFields.find(candidate => candidate.field_name === `${prefix}_requirements` && data[candidate.field_name]);
        const bottom = Math.min(top + 146, requirements ? requirements.y - 5 : Infinity);
        const maxLines = Math.max(0, Math.floor((bottom - field.y - size) / lineHeight) + 1);
        const lines = wrapText(String(data[field.field_name] || ''), font, size, width);
        const fitted = lines.slice(0, maxLines);
        if (lines.length > maxLines && fitted.length) {
          let last = fitted[fitted.length - 1].trimEnd();
          while (last && font.widthOfTextAtSize(last + '…', size) > width) last = last.slice(0, -1).trimEnd();
          fitted[fitted.length - 1] = last + '…';
        }
        const linkField = `${prefix}_more`;
        displayFields = displayFields.filter(candidate => ![linkField, `${prefix}_more_link`].includes(candidate.field_name));
        displayFields.push({
          field_name: linkField, label: 'Czytaj więcej', type: 'url', cta_button: true,
          show_icon: false, link_url: url, x: field.x + width - 100, y: top + 160,
          font_size: 7.5, font_color: '#ffffff', max_width: 90, align: 'center',
        });
        displayData = { ...displayData, [field.field_name]: fitted.join('\n'), [linkField]: 'CZYTAJ WIĘCEJ' };
      }

      const pages = pdfDoc.getPages();

      for (let i = startPageIndex; i < startPageIndex + pageCount && i < pages.length; i++) {
        const page = pages[i];
        const { height } = page.getSize();

        for (const field of displayFields) {
          const rawValue = displayData[field.field_name] || '';
          if (!renderDocumentFurniture && field.type !== 'image') {
            const number = isPageNumberField(field.field_name);
            const footer = /(?:^|_)footer$/.test(field.field_name);
            if (number || footer) {
              const saved = documentFurniture.get(page) || {};
              if (number) saved.number = field;
              if (footer && rawValue) saved.footer = { field, value: String(rawValue) };
              documentFurniture.set(page, saved);
              continue;
            }
          }
          // Brand rule: Atom always uses uppercase, before measuring/wrapping.
          const usesAtom = field.type !== 'image' && field.font_role === 'heading'
            && /atom/i.test(`${brandHeadingFontFamily} ${headingFont?.name || ''}`);
          const value = usesAtom ? String(rawValue).toLocaleUpperCase('pl-PL') : rawValue;


          if (!value) {

            continue;
          }

          if (field.type === 'image') {
            try {
              const image = await embedImageFromUrl(pdfDoc, String(value));

              const imgWidth = field.width || 100;
              const imgHeight = field.height || 100;
              const y = height - field.y - imgHeight;

              // O kształcie zdjęcia decyduje wyłącznie konfiguracja pola.
              // Avatar opiekuna na stronie końcowej jest gotowym PNG i nie może
              // być automatycznie przycinany do koła tylko ze względu na nazwę.
              const isCircular = field.is_circular === true;


              if (isCircular) {
                const size = Math.min(imgWidth, imgHeight);
                const radius = size / 2;
                const centerX = field.x + radius;
                const centerY = y + radius;

                const imgDims = image.scale(1);
                const imgAspect = imgDims.width / imgDims.height;

                let metadata = null;
                if (field.field_name.includes('avatar')) {
                  const metadataValue = data['employee_avatar_metadata'];
                  if (metadataValue && typeof metadataValue === 'object') {
                    metadata = metadataValue;
                  } else if (typeof metadataValue === 'string') {
                    try {
                      metadata = JSON.parse(metadataValue);
                    } catch (e) {
                      console.error('Failed to parse avatar metadata:', e);
                    }
                  }

                }

                const positionData = metadata?.desktop?.position;
                const baseScale = positionData?.scale !== undefined ? positionData.scale : 1;
                const scale = baseScale * 0.85;
                const posXPercent = positionData?.posX !== undefined ? positionData.posX : 0;
                const posYPercent = positionData?.posY !== undefined ? positionData.posY : 0;


                let drawWidth = size * scale;
                let drawHeight = size * scale;

                if (imgAspect > 1) {
                  drawWidth = size * imgAspect * scale;
                  drawHeight = size * scale;
                } else if (imgAspect < 1) {
                  drawWidth = size * scale;
                  drawHeight = (size / imgAspect) * scale;
                }

                const maxOffsetX = (drawWidth - size) / 2;
                const maxOffsetY = (drawHeight - size) / 2;

                const offsetX = (posXPercent / 50) * maxOffsetX;
                const offsetY = -(posYPercent / 50) * maxOffsetY;

                const imageX = centerX - drawWidth / 2 + offsetX;
                const imageY = centerY - drawHeight / 2 + offsetY;

                console.log(`Avatar calculations:
  - Image size: ${imgDims.width} x ${imgDims.height} (aspect: ${imgAspect.toFixed(2)})
  - Circle size: ${size}px, radius: ${radius}px
  - Circle center: X=${centerX.toFixed(1)}, Y=${centerY.toFixed(1)}
  - Draw size: ${drawWidth.toFixed(1)} x ${drawHeight.toFixed(1)}
  - Max offset: X=${maxOffsetX.toFixed(1)}, Y=${maxOffsetY.toFixed(1)}
  - Position %: X=${posXPercent}, Y=${posYPercent}
  - Final offset: X=${offsetX.toFixed(1)}, Y=${offsetY.toFixed(1)}
  - Image draw position: X=${imageX.toFixed(1)}, Y=${imageY.toFixed(1)}`);

                const kappa = 0.5522847498;
                const ox = radius * kappa;
                const oy = radius * kappa;

                page.pushOperators(
                  pushGraphicsState(),
                  moveTo(centerX, centerY + radius),
                  appendBezierCurve(centerX + ox, centerY + radius, centerX + radius, centerY + oy, centerX + radius, centerY),
                  appendBezierCurve(centerX + radius, centerY - oy, centerX + ox, centerY - radius, centerX, centerY - radius),
                  appendBezierCurve(centerX - ox, centerY - radius, centerX - radius, centerY - oy, centerX - radius, centerY),
                  appendBezierCurve(centerX - radius, centerY + oy, centerX - ox, centerY + radius, centerX, centerY + radius),
                  closePath(),
                  clip(),
                  endPath()
                );

                page.drawImage(image, {
                  x: imageX,
                  y: imageY,
                  width: drawWidth,
                  height: drawHeight,
                });

                page.pushOperators(popGraphicsState());

              } else {
                const imageDimensions = image.scale(1);
                const imageZoom = Math.min(3, Math.max(0.5, Number(field.image_zoom ?? 1)));
                const baseScale = field.image_fit === 'contain' || imageZoom < 1
                  ? Math.min(imgWidth / imageDimensions.width, imgHeight / imageDimensions.height)
                  : Math.max(imgWidth / imageDimensions.width, imgHeight / imageDimensions.height);
                const coverScale = baseScale * imageZoom;
                const drawWidth = imageDimensions.width * coverScale;
                const drawHeight = imageDimensions.height * coverScale;
                const positionX = Math.min(100, Math.max(0, Number(field.image_position_x ?? 50))) / 100;
                const positionY = Math.min(100, Math.max(0, Number(field.image_position_y ?? 50))) / 100;
                const drawX = field.x + (imgWidth - drawWidth) * positionX;
                const drawY = y + (imgHeight - drawHeight) * (1 - positionY);

                const shouldClip = imageZoom < 1 || field.image_fit !== 'contain' || Number(field.border_radius || 0) > 0;
                const clipX = field.image_fit === 'contain' && imageZoom >= 1 ? Math.max(field.x, drawX) : field.x;
                const clipY = field.image_fit === 'contain' && imageZoom >= 1 ? Math.max(y, drawY) : y;
                const clipWidth = field.image_fit === 'contain' && imageZoom >= 1 ? Math.min(field.x + imgWidth, drawX + drawWidth) - clipX : imgWidth;
                const clipHeight = field.image_fit === 'contain' && imageZoom >= 1 ? Math.min(y + imgHeight, drawY + drawHeight) - clipY : imgHeight;
                if (shouldClip) {
                  const radius = Math.max(0, Math.min(
                    Number(field.border_radius || 8),
                    clipWidth / 2,
                    clipHeight / 2,
                  ));
                  if (radius > 0) {
                    const kappa = 0.5522847498;
                    const offset = radius * kappa;
                    page.pushOperators(
                      pushGraphicsState(),
                      moveTo(clipX + radius, clipY),
                      lineTo(clipX + clipWidth - radius, clipY),
                      appendBezierCurve(clipX + clipWidth - radius + offset, clipY, clipX + clipWidth, clipY + radius - offset, clipX + clipWidth, clipY + radius),
                      lineTo(clipX + clipWidth, clipY + clipHeight - radius),
                      appendBezierCurve(clipX + clipWidth, clipY + clipHeight - radius + offset, clipX + clipWidth - radius + offset, clipY + clipHeight, clipX + clipWidth - radius, clipY + clipHeight),
                      lineTo(clipX + radius, clipY + clipHeight),
                      appendBezierCurve(clipX + radius - offset, clipY + clipHeight, clipX, clipY + clipHeight - radius + offset, clipX, clipY + clipHeight - radius),
                      lineTo(clipX, clipY + radius),
                      appendBezierCurve(clipX, clipY + radius - offset, clipX + radius - offset, clipY, clipX + radius, clipY),
                      closePath(),
                      clip(),
                      endPath(),
                    );
                  } else {
                    page.pushOperators(
                      pushGraphicsState(),
                      moveTo(clipX, clipY),
                      lineTo(clipX + clipWidth, clipY),
                      lineTo(clipX + clipWidth, clipY + clipHeight),
                      lineTo(clipX, clipY + clipHeight),
                      closePath(),
                      clip(),
                      endPath(),
                    );
                  }
                }
                if (imageZoom < 1) {
                  const backgroundScale = Math.max(imgWidth / imageDimensions.width, imgHeight / imageDimensions.height);
                  const backgroundWidth = imageDimensions.width * backgroundScale;
                  const backgroundHeight = imageDimensions.height * backgroundScale;
                  page.drawImage(image, {
                    x: field.x + (imgWidth - backgroundWidth) * positionX,
                    y: y + (imgHeight - backgroundHeight) * (1 - positionY),
                    width: backgroundWidth, height: backgroundHeight, opacity: 0.55,
                  });
                }
                page.drawImage(image, {
                  x: drawX,
                  y: drawY,
                  width: drawWidth,
                  height: drawHeight,
                });
                if (shouldClip) page.pushOperators(popGraphicsState());
              }
            } catch (error) {
              console.error(`Error drawing image ${field.field_name}:`, error);
            }
            continue;
          }

          const fontSize = field.font_size || 12;
          const autoBold = /(^|_)(name|title)$/.test(field.field_name);
          // Use the real bold face for every product CTA, including custom templates.
          // Font selection happens before wrapping and measuring the clickable area.
          const isReadMoreLink = field.type === 'url' && /^czytaj więcej(?:\s|$)/i.test(String(value).trim());
          const font = isReadMoreLink
            ? boldFont
            : field.font_role === 'heading'
              ? headingFont
              : autoBold
                ? boldFont
                : regularFont;

          const colorMatch = field.font_color?.match(/^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i);
          const color = field.cta_button ? rgb(1, 1, 1) : colorMatch
            ? rgb(
                parseInt(colorMatch[1], 16) / 255,
                parseInt(colorMatch[2], 16) / 255,
                parseInt(colorMatch[3], 16) / 255
              )
            : rgb(0, 0, 0);

          const isEmail = field.type === 'email' || field.field_name.includes('email');
          const isPhone = field.type === 'phone' || field.field_name.includes('phone');
          const isUrl = field.type === 'url';
          const iconSize = fontSize * 0.9;
          const iconPadding = 4;

          let iconSymbol = '';
          if (field.show_icon !== false && isEmail) {
            iconSymbol = '✉';
          } else if (field.show_icon !== false && isPhone) {
            iconSymbol = '☎';
          }

          if (iconSymbol && !symbolsFont) symbolsFont = await ensureSymbolsFont(pdfDoc);
          const lines = field.max_width
            ? wrapText(value, font, fontSize, field.max_width)
            : [value];

          const lineHeight = field.line_height || fontSize * 1.2;

          if (field.cta_button && isUrl) {
            drawRoundedRectangle(page, {
              x: field.x - 10, y: height - field.y - fontSize - 8,
              width: (field.max_width || 130) + 20, height: fontSize + 15,
              radius: 5, color: rgb(91 / 255, 0, 31 / 255),
            });
          }

          for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            let x = field.x;
            const y = height - field.y - fontSize - (lineIndex * lineHeight);

            let iconWidth = 0;
            if (iconSymbol) {
              try {
                iconWidth = symbolsFont.widthOfTextAtSize(iconSymbol, iconSize);
              } catch {
                iconWidth = fontSize;
              }
              x += iconWidth + iconPadding;
            }

            if (field.align === 'center' && field.max_width) {
              const textWidth = font.widthOfTextAtSize(line, fontSize);
              const totalWidth = iconSymbol ? textWidth + iconWidth + iconPadding : textWidth;
              x = field.x + (field.max_width - totalWidth) / 2;
              if (iconSymbol) {
                x += iconWidth + iconPadding;
              }
            } else if (field.align === 'right' && field.max_width) {
              const textWidth = font.widthOfTextAtSize(line, fontSize);
              const totalWidth = iconSymbol ? textWidth + iconWidth + iconPadding : textWidth;
              x = field.x + field.max_width - totalWidth;
              if (iconSymbol) {
                x += iconWidth + iconPadding;
              }
            }

            if (iconSymbol && lineIndex === 0) {
              try {
                const iconWidth = symbolsFont.widthOfTextAtSize(iconSymbol, iconSize);
                page.drawText(iconSymbol, {
                  x: x - iconWidth - iconPadding,
                  y: y,
                  size: iconSize,
                  font: symbolsFont,
                  color: rgb(0.8, 0.7, 0.45),
                });
              } catch (error) {
                console.error('Error drawing icon:', error);
              }
            }


            page.drawText(line, {
              x,
              y,
              size: fontSize,
              font,
              color,
            });

            if ((isEmail || isPhone || isUrl) && lineIndex === 0) {
              const textWidth = font.widthOfTextAtSize(line, fontSize);
              const linkUri = isEmail
                ? `mailto:${line}`
                : isPhone
                  ? `tel:${line.replace(/\s/g, '')}`
                  : field.link_url || '';

              try {
                if (!linkUri) continue;
                const linkAnnotation = pdfDoc.context.obj({
                  Type: 'Annot',
                  Subtype: 'Link',
                  Rect: field.cta_button
                    ? [field.x - 10, y - 8, field.x + (field.max_width || 130) + 10, y + fontSize + 7]
                    : [x, y - 2, x + textWidth, y + fontSize],
                  Border: [0, 0, 0],
                  C: [0, 0, 1],
                  A: {
                    S: 'URI',
                    URI: PDFString.of(linkUri),
                  },
                });

                const linkAnnotationRef = pdfDoc.context.register(linkAnnotation);

                const annotations = page.node.lookup(PDFName.of('Annots'), PDFArray) || pdfDoc.context.obj([]);
                annotations.push(linkAnnotationRef);
                page.node.set(PDFName.of('Annots'), annotations);
              } catch (error) {
                console.error('Error adding link annotation:', error);
              }
            }
          }
        }
      }
    };

    const mergedPdf = await PDFDocument.create();
    const offerData = prepareOfferData(offer, currentEmployee);
    const generatedProductPages: Array<Record<string, any>> = [];

    const requestedCompanyId = offer.event?.my_company_id || offer.my_company_id || null;
    const companyQuery = supabase
      .from('my_companies')
      .select('id, name, legal_name, logo_url, email, phone, website, nip')
      .eq('is_active', true)
      .limit(1);
    const { data: company } = requestedCompanyId
      ? await companyQuery.eq('id', requestedCompanyId).maybeSingle()
      : await companyQuery.eq('is_default', true).maybeSingle();

    if (company) {
      const [{ data: brandLogos }, { data: brandFonts }] = await Promise.all([
        supabase
          .from('company_brandbook_logos')
          .select('url, label, variant, background, is_default, order_index')
          .eq('company_id', company.id)
          .order('is_default', { ascending: false })
          .order('order_index'),
        supabase
          .from('company_brandbook_fonts')
          .select('family, role, weight, file_url, storage_path, order_index')
          .eq('company_id', company.id)
          .order('order_index'),
      ]);

      const logo = (brandLogos || []).find((item: any) => item.is_default)
        || (brandLogos || []).find((item: any) => item.background === 'transparent')
        || brandLogos?.[0];
      const rawLogoUrl = logo?.url || company.logo_url || '';
      brandLogoUrl = rawLogoUrl
        ? rawLogoUrl.startsWith('http')
          ? rawLogoUrl
          : supabase.storage.from('company-logos').getPublicUrl(rawLogoUrl).data.publicUrl
        : '';

      const headingFont = (brandFonts || []).find((item: any) => item.role === 'heading' && (item.file_url || item.storage_path));
      brandHeadingFontFamily = String(headingFont?.family || '');
      if (headingFont?.file_url) {
        brandHeadingFontUrl = headingFont.file_url;
      } else if (headingFont?.storage_path) {
        brandHeadingFontUrl = supabase.storage
          .from('company-logos')
          .getPublicUrl(headingFont.storage_path).data.publicUrl;
      }

      brandCompanyName = company.name || company.legal_name || 'MAVINCI';
      offerData.seller_name = company.legal_name || company.name || offerData.seller_name;
      offerData.seller_nip = company.nip || '';
      offerData.seller_email = company.email || '';
      offerData.seller_phone = company.phone || '';
      offerData.seller_website = company.website || '';
      offerData.company_logo = brandLogoUrl;
    }

    // Retain the brand identity, caretaker and image quality on resource retries.
    if (sellerMode) {
      // Version 2 snapshots are resolved by the database, never from a portal payload.
      const organizationIdentity = sellerBranding.identity_version === 2
        && sellerBranding.organization_id
        && sellerBranding.organization_id === offer.partner_organization_id;
      const sellerAsset = async (raw: unknown, kind: 'visual' | 'portrait' = 'visual') => {
        if (!raw) return '';
        if (demoMode) {
          // The service-only demo factory validates bounded PNG assets and JPEG portraits; never sign user paths.
          if (kind === 'visual' && (raw === sellerBranding.hotel_logo_url || raw === sellerBranding.hotel_cover_image_url) && /^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i.test(String(raw))) return String(raw);
          if (kind === 'portrait' && raw === sellerBranding.portrait_url && /^data:image\/jpeg;base64,[a-z0-9+/]+={0,2}$/i.test(String(raw))) return String(raw);
          throw new Error('Nieprawidłowa grafika demonstracji.');
        }
        let path = String(raw);
        if (kind === 'portrait' && sellerBranding.identity_version === 2 && sellerBranding.portrait_source === 'contact') {
          // Contact photos may already be public. Never sign arbitrary buckets
          // or fetch external URLs with the renderer's service credentials.
          try {
            const url = new URL(path);
            if (url.origin === new URL(supabaseUrl).origin && url.pathname.startsWith('/storage/v1/object/public/')) return url.toString();
          } catch { /* A private upload uses the owner-scoped branch below. */ }
          return '';
        }
        if (/^https?:/i.test(path)) {
          const url = new URL(path);
          const prefix = /^\/storage\/v1\/object\/(?:public|sign)\/seller-brand-assets\//;
          if (url.origin !== new URL(supabaseUrl).origin || !prefix.test(url.pathname)) throw new Error('Nieprawidłowy adres grafiki sprzedawcy.');
          path = decodeURIComponent(url.pathname.replace(prefix, ''));
        }
        path = path.replace(/^\/+/, '').replace(/^(?:public\/)?seller-brand-assets\//, '');
        const allowedPrefixes = [offer.sales_partner_id + '/' + offer.my_company_id + '/'];
        if (kind === 'visual' && organizationIdentity) {
          allowedPrefixes.push('organizations/' + sellerBranding.organization_id + '/' + offer.my_company_id + '/');
          if (sellerBranding.organization_asset_partner_id) {
            allowedPrefixes.push(sellerBranding.organization_asset_partner_id + '/' + offer.my_company_id + '/');
          }
        }
        if (!allowedPrefixes.some((prefix) => path.startsWith(prefix)) || path.split('/').some((part) => part === '..' || part === '.')) throw new Error('Plik nie należy do sprzedawcy ani jego organizacji.');
        const { data, error } = await supabase.storage.from('seller-brand-assets').createSignedUrl(path, 600);
        if (error || !data?.signedUrl) throw new Error('Nie udało się pobrać grafiki sprzedawcy.');
        return data.signedUrl;
      };
      const sellerHeadingFont = async () => {
        const family = String(sellerBranding.heading_font_family || 'Noto Sans').split(',')[0].replace(/["']/g, '').trim();
        if (sellerBranding.heading_font_catalog_id) {
          const font = sellerBranding.heading_font_catalog_snapshot;
          if (sellerBranding.identity_version !== 2 || !font || font.id !== sellerBranding.heading_font_catalog_id
            || font.company_id !== offer.my_company_id) {
            throw sellerFontError('Wybrana czcionka wymaga aktualizacji bazy lub nie należy do marki tej oferty.');
          }
          let path = String(font.storage_path || '');
          if (!path && font.file_url) {
            let url: URL;
            try { url = new URL(String(font.file_url)); }
            catch { throw sellerFontError('Nieprawidłowy adres czcionki w CRM. Wgraj plik ponownie.'); }
            const prefix = '/storage/v1/object/public/company-logos/';
            if (url.origin !== new URL(supabaseUrl).origin || !url.pathname.startsWith(prefix)) {
              throw sellerFontError('Czcionka z CRM musi mieć plik w bibliotece tej marki. Wgraj font zamiast zewnętrznego adresu.');
            }
            try { path = decodeURIComponent(url.pathname.slice(prefix.length)); }
            catch { throw sellerFontError('Nieprawidłowa ścieżka czcionki w CRM.'); }
          }
          if (path) {
            if (!path.startsWith('brandbook/' + offer.my_company_id + '/fonts/')
              || path.split('/').some((part) => part === '.' || part === '..')
              || !/\.(ttf|otf|woff2?)$/i.test(path)) {
              throw sellerFontError('Plik czcionki nie należy do biblioteki tej marki lub ma nieobsługiwany format.');
            }
            // Public CRM brandbook fonts only. Never sign another tenant's
            // bucket/path using the service role or follow external redirects.
            return supabase.storage.from('company-logos').getPublicUrl(path).data.publicUrl;
          }
        } else if (sellerBranding.heading_font_path) {
          return sellerAsset(sellerBranding.heading_font_path);
        }
        if ((sellerBranding.heading_font_catalog_id || sellerBranding.heading_font_selection_version === 1)
          && family.toLocaleLowerCase('pl-PL') !== 'noto sans') {
          throw sellerFontError('Wybrana czcionka nie ma pliku do PDF. Wgraj ją w brandingu albo wybierz czcionkę oznaczoną jako wgrana.');
        }
        return '';
      };
      const [logo, portrait, cover, headingFont] = await Promise.all([
        sellerAsset(sellerBranding.hotel_logo_url),
        sellerAsset(sellerBranding.portrait_url, 'portrait'),
        sellerAsset(sellerBranding.hotel_cover_image_url || sellerBranding.venue_image_urls?.[0]),
        sellerHeadingFont(),
      ]);
      brandLogoUrl = logo;
      sellerCoverUrl = cover;
      // A supplied heading font uses the same private, owner-scoped asset
      // resolver as the logo. Never fetch a caller-provided external font URL.
      if (headingFont) {
        brandHeadingFontUrl = headingFont;
        brandHeadingFontFamily = String(sellerBranding.heading_font_family || '');
      } else if (sellerBranding.identity_version === 2) {
        brandHeadingFontUrl = '';
        brandHeadingFontFamily = 'Noto Sans';
      }
      brandCompanyName = sellerOrganizationName || sellerBranding.display_name || 'Oferta';
      const name = String(sellerBranding.display_name || '').trim().split(/\s+/);
      Object.assign(offerData, {
        client_name: offer.portal_client_company || offer.portal_client_name || '',
        organization_name: offer.portal_client_company || '',
        organization_legal_name: offer.portal_client_company || '',
        contact_person_name: offer.portal_client_name || '',
        contact_person_email: offer.portal_client_email || '',
        contact_person_phone: offer.portal_client_phone || '',
        client_address: '', client_nip: '', client_city: '', client_postal_code: '', client_street: '',
        event_brief: offer.description || '', event_assumptions: offer.description || '',
        employee_first_name: name[0] || '', employee_last_name: name.slice(1).join(' '),
        employee_full_name: sellerBranding.display_name || '',
        employee_email: sellerBranding.contact_email || '', employee_phone: sellerBranding.contact_phone || '',
        employee_avatar_url: portrait, employee_avatar_metadata: null,
        employee_facebook_url: '', employee_instagram_url: '', employee_linkedin_url: '',
        seller_name: brandCompanyName, seller_address: sellerBranding.organization_address || '', seller_nip: '',
        seller_email: sellerBranding.contact_email || '', seller_phone: sellerBranding.contact_phone || '',
        seller_website: sellerBranding.organization_website || '', company_logo: logo,
      });
    }

    if (brandLogoUrl && !sellerMode) {
      // 768px gives over 300 dpi at the largest native logo size. Keep PNG alpha.
      brandLogoUrl = getPdfAvatarUrl(brandLogoUrl, 768);
      offerData.company_logo = brandLogoUrl;
    }

    const { data: globalSocials } = await supabase
      .from('schema_org_global')
      .select('facebook_url, instagram_url, linkedin_url, youtube_url, twitter_url')
      .limit(1)
      .maybeSingle();
    offerData.social_facebook_url = offerData.employee_facebook_url || globalSocials?.facebook_url || '';
    offerData.social_instagram_url = offerData.employee_instagram_url || globalSocials?.instagram_url || '';
    offerData.social_linkedin_url = offerData.employee_linkedin_url || globalSocials?.linkedin_url || '';
    offerData.social_youtube_url = globalSocials?.youtube_url || '';
    offerData.social_twitter_url = globalSocials?.twitter_url || '';

    if (sellerMode) {
      offerData.social_facebook_url = '';
      offerData.social_instagram_url = '';
      offerData.social_linkedin_url = '';
      offerData.social_youtube_url = '';
      offerData.social_twitter_url = '';
    }

    const { data: defaultCategory } = await supabase
      .from('offer_template_categories')
      .select('id, hero_image_path, hero_image_alt, design_config')
      .eq('is_default', true)
      .limit(1)
      .maybeSingle();
    const defaultTemplateCategoryId = defaultCategory?.id || null;
    const eventTemplateCategoryId =
      offer.event?.category?.default_offer_template_category_id || null;
    const templateCategoryId = eventTemplateCategoryId || defaultTemplateCategoryId;

    const templateLookupCache = new Map<string, any>();
    const embeddedTemplateCache = new Map<string, { page: any; width: number; height: number }>();
    const loadDefaultTemplate = async (templateType: string, variantKey = 'default') => {
      const findTemplate = async (categoryId: string | null, requestedVariant: string) => {
        const key = JSON.stringify([categoryId,templateType,requestedVariant]);
        if (templateLookupCache.has(key)) return templateLookupCache.get(key);
        let query = supabase
          .from('offer_page_templates')
          .select('id, pdf_url, text_fields_config, table_config, template_category_id, variant_key')
          .eq('type', templateType)
          .eq('variant_key', requestedVariant)
          .eq('is_active', true)
          .order('is_default', { ascending: false })
          .order('updated_at', { ascending: false })
          .limit(1);

        if (categoryId) query = query.eq('template_category_id', categoryId);
        const { data, error } = await query.maybeSingle();
        if (error) throw error;
        templateLookupCache.set(key, data);
        return data;
      };

      if (eventTemplateCategoryId) {
        const categoryTemplate =
          await findTemplate(eventTemplateCategoryId, variantKey) ||
          (templateType !== 'product' && variantKey !== 'default'
            ? await findTemplate(eventTemplateCategoryId, 'default')
            : null);
        if (categoryTemplate) return categoryTemplate;
      }

      if (defaultTemplateCategoryId) {
        return (
          await findTemplate(defaultTemplateCategoryId, variantKey) ||
          (templateType !== 'product' && variantKey !== 'default'
            ? await findTemplate(defaultTemplateCategoryId, 'default')
            : null)
        );
      }

      return null;
    };

    const addPdfFromTemplate = async (
      templateType: string,
      data: Record<string, any> = offerData,
      variantKey = 'default',
      requiredFieldPrefix?: string,
    ) => {
      // Uploaded PDF backgrounds are considerably more expensive to parse and
      // embed than the native fallback pages. The compact retry deliberately
      // avoids them so a resource-limit error is not repeated with the same load.
      // Static CRM backgrounds can contain baked-in logos, colors and prices.
      // Seller PDFs use the same dynamic page builders with seller-specific data.
      if (compactResourceMode || sellerMode) return { success: false };

      try {
        const template = await loadDefaultTemplate(templateType, variantKey);

        const configuredFields = Array.isArray(template?.text_fields_config)
          ? template.text_fields_config as TextFieldConfig[]
          : [];
        const configuredFieldNames = new Set(configuredFields.map((field) => field.field_name));
        const supportsRequiredFields = !requiredFieldPrefix
          || configuredFields.some((field) => field.field_name.startsWith(requiredFieldPrefix));
        const dynamicFieldRequirements: Record<string, string[]> = {
          cover: ['event_name', 'event_date'],
          about: ['event_assumptions', 'event_goal'],
          final: ['employee_full_name'],
        };
        const supportsDynamicCrmData = (dynamicFieldRequirements[templateType] || [])
          .every((fieldName) => configuredFieldNames.has(fieldName));

        if (template?.pdf_url && supportsRequiredFields && supportsDynamicCrmData) {
          let background = embeddedTemplateCache.get(template.pdf_url);
          if (background) assetStats.templateCacheHits += 1;
          if (!background) {
            const { data: pdfData, error } = await timed('template_fetch', () => supabase.storage
              .from('offer-template-pages').download(template.pdf_url));
            if (error) throw error;
            if (!pdfData) return { success: false };
            const bytes = await pdfData.arrayBuffer();
            const source = await timed('template_parse', () => PDFDocument.load(bytes));
            if (source.getPageCount() === 0) return { success: false };
            const sourcePage = source.getPage(0);
            const size = sourcePage.getSize();
            // Reuse the already parsed page, rather than parsing the bytes again via embedPdf.
            const embedded = await timed('template_embed', () => mergedPdf.embedPage(sourcePage));
            background = { page: embedded, width: size.width, height: size.height };
            embeddedTemplateCache.set(template.pdf_url, background);
            assetStats.templates += 1;
          }
          if (background) {
            const a4Width = 595.28;
            const a4Height = 841.89;
            const sourceWidth = background.width;
            const sourceHeight = background.height;
            const scale = Math.min(a4Width / sourceWidth, a4Height / sourceHeight);
            const renderedWidth = sourceWidth * scale;
            const renderedHeight = sourceHeight * scale;
            const offsetX = (a4Width - renderedWidth) / 2;
            const offsetY = (a4Height - renderedHeight) / 2;
            const topOffset = a4Height - offsetY - renderedHeight;
            const embeddedPage = background.page;

            const startPageIndex = mergedPdf.getPageCount();
            const page = mergedPdf.addPage([a4Width, a4Height]);
            page.drawPage(embeddedPage, {
              x: offsetX,
              y: offsetY,
              width: renderedWidth,
              height: renderedHeight,
            });

            const scaledFields = configuredFields.map((field) => ({
              ...field,
              x: offsetX + field.x * scale,
              y: topOffset + field.y * scale,
              font_size: field.font_size ? field.font_size * scale : field.font_size,
              max_width: field.max_width ? field.max_width * scale : field.max_width,
              width: field.width ? field.width * scale : field.width,
              height: field.height ? field.height * scale : field.height,
              border_radius: field.border_radius ? field.border_radius * scale : field.border_radius,
              line_height: field.line_height ? field.line_height * scale : field.line_height,
              image_position_x: /^product(?:_\d+)?_image$/.test(field.field_name)
                ? Number(data[`${field.field_name}_position_x`] ?? 50)
                : field.image_position_x,
              image_position_y: /^product(?:_\d+)?_image$/.test(field.field_name)
                ? Number(data[`${field.field_name}_position_y`] ?? 25)
                : field.image_position_y,
              image_zoom: /^product(?:_\d+)?_image$/.test(field.field_name)
                ? Number(data[`${field.field_name}_zoom`] ?? 1)
                : field.image_zoom,
            }));

            if (scaledFields.length > 0) {
              await overlayTextOnPages(
                mergedPdf,
                startPageIndex,
                1,
                scaledFields,
                data
              );
            }

            return {
              success: true,
              tableConfig: template.table_config,
              templateId: template.id,
              templateVariant: template.variant_key,
            };
          }
        }
      } catch (error) {
        console.error(`Error adding ${templateType} template:`, error);
      }
      return { success: false };
    };

    const sortedOfferItems = [...(offer.offer_items || [])]
      .sort((a: any, b: any) => a.display_order - b.display_order);

    const { data: selectedTemplateCategory } = templateCategoryId
      ? await supabase
          .from('offer_template_categories')
          .select('id, hero_image_path, hero_image_alt, design_config')
          .eq('id', templateCategoryId)
          .maybeSingle()
      : { data: null };

    const categoryDesign = {
      primary_color: '#4A001F',
      secondary_color: '#1c1f33',
      accent_color: '#D5C489',
      surface_color: '#faf7f2',
      hero_opacity: 0.58,
      hero_gradient_enabled: true,
      hero_gradient_end: 0.45,
      hero_height: 395,
      logo_scale: 1,
      cover_decorations_enabled: true,
      cover_primary_color: '#4A001F',
      cover_decoration_color: '#2D0013',
      cover_accent_color: '#D5C489',
      assumptions_layout: 'cards',
      visual_image_height: 285,
      pricing_style: 'card',
      info_page_enabled: true,
      info_page_title: 'INFORMACJE I WARUNKI',
      order_process_text: 'Akceptacja zakresu i wyceny\nPotwierdzenie terminu i podpisanie umowy\nUstalenia techniczne z obiektem\nRealizacja wydarzenia',
      requirements_page_enabled: true,
      requirements_page_title: 'WARUNKI TECHNICZNE I ORGANIZACYJNE',
      requirements_page_subtitle: 'Wymagania niezbędne do bezpiecznego i sprawnego przygotowania realizacji.',
      technical_requirements_text: 'Dostęp do sali przed wydarzeniem w czasie uzgodnionym z realizatorem\nStabilne zasilanie 230 V oraz miejsce dla stanowiska technicznego\nDostęp do internetu przewodowego przy realizacjach online\nKontakt do osoby technicznej po stronie obiektu',
      reservation_terms_text: 'Termin rezerwujemy po akceptacji oferty i podpisaniu umowy\nZakres końcowy potwierdzamy po weryfikacji warunków technicznych\nDodatkowe usługi i zmiany wymagają potwierdzenia przed wydarzeniem',
      ...(selectedTemplateCategory?.design_config || defaultCategory?.design_config || {}),
    };
    if (sellerMode) {
      const color = (value: unknown, fallback: string) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
      const primary = color(sellerBranding.brand_primary_color, '#2d0918');
      const secondary = color(sellerBranding.brand_secondary_color, '#d3bb73');
      const shade = (hex: string, factor: number) => '#' + [1, 3, 5]
        .map((offset) => Math.round(parseInt(hex.slice(offset, offset + 2), 16) * factor).toString(16).padStart(2, '0')).join('');
      Object.assign(categoryDesign, {
        primary_color: primary, secondary_color: shade(primary, 0.82), accent_color: secondary,
        surface_color: color(sellerBranding.brand_surface_color, categoryDesign.surface_color),
        cover_primary_color: primary, cover_decoration_color: shade(primary, 0.7), cover_accent_color: secondary,
        info_page_enabled: true,
        reservation_terms_text: [
          offer.partner_approval_status === 'approved'
            ? 'Termin i zasoby potwierdzone przez MAVINCI. Oferta nie stanowi rezerwacji ani zawartej umowy.'
            : 'Termin, sprzęt i dostępność zespołu wymagają potwierdzenia MAVINCI. Oferta nie stanowi rezerwacji.',
          sellerBranding.disclosure_text || '',
        ].filter(Boolean).join('\n'),
      });
    }
    const colorFromHex = (hex: string, fallback: [number, number, number]) => {
      const normalized = String(hex || '').replace('#', '').slice(0, 6);
      if (!/^[0-9a-f]{6}$/i.test(normalized)) return rgb(...fallback);
      return rgb(
        parseInt(normalized.slice(0, 2), 16) / 255,
        parseInt(normalized.slice(2, 4), 16) / 255,
        parseInt(normalized.slice(4, 6), 16) / 255,
      );
    };
    // Product subheadings and compact product names must follow the resolved
    // organization/seller palette, just like the main product title. Preserve
    // the established subsection color for regular CRM offers.
    const productSectionColor = sellerMode ? categoryDesign.primary_color : '#7f1734';
    const cream = colorFromHex(categoryDesign.surface_color, [0.98, 0.97, 0.95]);
    const burgundy = colorFromHex(categoryDesign.primary_color, [0.357, 0, 0.122]);
    const accent = colorFromHex(categoryDesign.accent_color, [0.827, 0.733, 0.451]);
    const coverBurgundy = colorFromHex(categoryDesign.cover_primary_color, [0.29, 0, 0.122]);
    const coverDecoration = rgb(
      coverBurgundy.red * 0.94 + 0.06,
      coverBurgundy.green * 0.94 + 0.06,
      coverBurgundy.blue * 0.94 + 0.06,
    );
    const coverAccent = colorFromHex(categoryDesign.cover_accent_color, [0.835, 0.769, 0.537]);

    const crc32 = (bytes: Uint8Array) => {
      let crc = 0xffffffff;
      for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
          crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
      }
      return (crc ^ 0xffffffff) >>> 0;
    };

    const pngChunk = (type: string, data: Uint8Array) => {
      const typeBytes = new TextEncoder().encode(type);
      const chunk = new Uint8Array(12 + data.length);
      const view = new DataView(chunk.buffer);
      view.setUint32(0, data.length);
      chunk.set(typeBytes, 4);
      chunk.set(data, 8);
      const crcInput = new Uint8Array(typeBytes.length + data.length);
      crcInput.set(typeBytes);
      crcInput.set(data, typeBytes.length);
      view.setUint32(8 + data.length, crc32(crcInput));
      return chunk;
    };

    const createHorizontalAlphaGradientPng = async (
      hexColor: string,
      rightVisibility: number,
    ) => {
      const width = 1024;
      const normalized = String(hexColor || '#5b001f').replace('#', '').slice(0, 6);
      const red = parseInt(normalized.slice(0, 2), 16) || 91;
      const green = parseInt(normalized.slice(2, 4), 16) || 0;
      const blue = parseInt(normalized.slice(4, 6), 16) || 31;
      const scanline = new Uint8Array(1 + width * 4);
      scanline[0] = 0;
      for (let index = 0; index < width; index += 1) {
        const progress = index / (width - 1);
        const alpha = Math.round(255 * (1 - rightVisibility * progress));
        const offset = 1 + index * 4;
        scanline[offset] = red;
        scanline[offset + 1] = green;
        scanline[offset + 2] = blue;
        scanline[offset + 3] = alpha;
      }

      const compressedStream = new Blob([scanline])
        .stream()
        .pipeThrough(new CompressionStream('deflate'));
      const compressed = new Uint8Array(await new Response(compressedStream).arrayBuffer());
      const ihdr = new Uint8Array(13);
      const ihdrView = new DataView(ihdr.buffer);
      ihdrView.setUint32(0, width);
      ihdrView.setUint32(4, 1);
      ihdr[8] = 8;
      ihdr[9] = 6;
      const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const chunks = [signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array())];
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const png = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        png.set(chunk, offset);
        offset += chunk.length;
      }
      return png;
    };

    const drawRoundedRectangle = (
      page: any,
      options: { x: number; y: number; width: number; height: number; radius?: number; color: any; opacity?: number },
    ) => {
      const radius = Math.max(0, Math.min(options.radius ?? 8, options.width / 2, options.height / 2));
      if (radius === 0) {
        page.drawRectangle(options);
        return;
      }
      const opacity = options.opacity ?? 1;
      page.drawRectangle({ x: options.x + radius, y: options.y, width: options.width - radius * 2, height: options.height, color: options.color, opacity });
      page.drawRectangle({ x: options.x, y: options.y + radius, width: options.width, height: options.height - radius * 2, color: options.color, opacity });
      page.drawCircle({ x: options.x + radius, y: options.y + radius, size: radius, color: options.color, opacity });
      page.drawCircle({ x: options.x + options.width - radius, y: options.y + radius, size: radius, color: options.color, opacity });
      page.drawCircle({ x: options.x + radius, y: options.y + options.height - radius, size: radius, color: options.color, opacity });
      page.drawCircle({ x: options.x + options.width - radius, y: options.y + options.height - radius, size: radius, color: options.color, opacity });
    };

    const truncateAtWord = (value: string, limit: number) => {
      const normalized = String(value || '').replace(/\s+/g, ' ').trim();
      if (normalized.length <= limit) return normalized;
      const shortened = normalized.slice(0, limit);
      return `${shortened.slice(0, shortened.lastIndexOf(' '))}…`;
    };

    const productImageUrlCache = new Map<string, string>();
    const getProductImageUrl = async (product: any) => {
      const imagePath = product?.offer_image_path || product?.pdf_thumbnail_url;
      if (!imagePath) return '';
      const cached = productImageUrlCache.get(imagePath);
      if (cached) return cached;
      const signedUrl = await createOptimizedSignedImageUrl(
        'offer-product-pages',
        imagePath,
        1440,
      );
      if (signedUrl) productImageUrlCache.set(imagePath, signedUrl);
      return signedUrl;
    };

    const firstProductImage = await getProductImageUrl(
      sortedOfferItems.find((item: any) => item.product?.offer_image_path)?.product,
    );
    let categoryHeroImage = '';
    // Własne hero jest kluczową częścią oferty, dlatego zachowujemy je także
    // w trybie oszczędnym. To pojedynczy, przeskalowany JPEG, więc nie niweczy
    // Wszystkie tryby zachowują tę samą rozdzielczość zdjęć produktów.
    if (offer.hero_image_path) {
      categoryHeroImage = await createOptimizedSignedImageUrl(
        'offer-template-pages',
        offer.hero_image_path,
        1440,
      );
    }
    if (!categoryHeroImage && selectedTemplateCategory?.hero_image_path) {
      categoryHeroImage = await createOptimizedSignedImageUrl(
        'offer-template-pages',
        selectedTemplateCategory.hero_image_path,
        1440,
      );
    }
    const recommendedScope = sortedOfferItems
      .map((item: any) => item.name || item.product?.name)
      .filter(Boolean)
      .slice(0, 6)
      .join('  •  ');

    const addBuiltInCover = async () => {
      const page = mergedPdf.addPage([595.28, 841.89]);
      page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: coverBurgundy });
      const coverImage = demoMode ? sellerCoverUrl || categoryHeroImage || firstProductImage : sellerMode ? sellerCoverUrl || firstProductImage : eventTemplateCategoryId
        ? categoryHeroImage
        : categoryHeroImage || firstProductImage;
      const imageSectionBottom = 210;
      const imageSectionHeight = Math.min(470, Math.max(320, Number(categoryDesign.hero_height || 395)));
      // Anchor both circles at the page corner so only a quarter is visible.
      const coverDecorationCenterX = page.getWidth();
      const coverDecorationCenterY = page.getHeight();
      const coverDecorationGap = 34; // Keep the decoration clear of the hero image.
      const coverDecorationRadius = Math.min(
        155,
        coverDecorationCenterY - imageSectionBottom - imageSectionHeight - coverDecorationGap,
      );

      if (coverImage) {
        try {
          const image = await embedImageFromUrl(mergedPdf, coverImage);
          if (image) {
            const imageDimensions = image.scale(1);
            const coverScale = Math.max(
              595.28 / imageDimensions.width,
              imageSectionHeight / imageDimensions.height,
            );
            const drawWidth = imageDimensions.width * coverScale;
            const drawHeight = imageDimensions.height * coverScale;

            page.drawImage(image, {
              x: (595.28 - drawWidth) / 2,
              y: imageSectionBottom + (imageSectionHeight - drawHeight) / 2,
              width: drawWidth,
              height: drawHeight,
            });
            page.drawRectangle({ x: 0, y: imageSectionBottom + imageSectionHeight, width: 595.28, height: 841.89 - imageSectionBottom - imageSectionHeight, color: coverBurgundy });
            page.drawRectangle({ x: 0, y: 0, width: 595.28, height: imageSectionBottom, color: coverBurgundy });
            if (categoryDesign.hero_gradient_enabled !== false) {
              const rightVisibility = Math.min(0.8, Math.max(0.2, Number(categoryDesign.hero_gradient_end || 0.45)));
              const gradientPng = await createHorizontalAlphaGradientPng(categoryDesign.cover_primary_color, rightVisibility);
              const gradientImage = await mergedPdf.embedPng(gradientPng);
              page.drawImage(gradientImage, {
                x: 0,
                y: imageSectionBottom,
                width: 595.28,
                height: imageSectionHeight,
              });
            } else {
              page.drawRectangle({
                x: 0,
                y: imageSectionBottom,
                width: 595.28,
                height: imageSectionHeight,
                color: coverBurgundy,
                opacity: Math.min(0.85, Math.max(0.2, Number(categoryDesign.hero_opacity || 0.58))),
              });
            }
          }
        } catch (error) {
          console.error('Error drawing category hero image:', error);
        }
      }

      // Subtle vector decoration inspired by the brand's circular motif.
      // It is drawn after the hero image, so preview and exported PDF stay identical.
      if (categoryDesign.cover_decorations_enabled !== false) {
        page.drawCircle({
          x: coverDecorationCenterX,
          y: coverDecorationCenterY,
          size: coverDecorationRadius,
          color: coverDecoration,
          opacity: 1,
        });
        page.drawCircle({
          x: coverDecorationCenterX,
          y: coverDecorationCenterY,
          size: coverDecorationRadius * (90 / 155),
          borderColor: coverAccent,
          borderWidth: 1.15,
          opacity: 1,
        });
      }

      page.drawLine({ start: { x: 45, y: 447 }, end: { x: 550, y: 447 }, thickness: 0.8, color: coverAccent, opacity: 0.9 });

      const timeRangeMatch = String(offerData.event_brief || '').match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
      const eventDateWithTime = `${offerData.event_date || ''}${timeRangeMatch ? ` · ${timeRangeMatch[1]}–${timeRangeMatch[2]}` : ''}`.trim();
      const logoScale = Math.min(1.5, Math.max(0.7, Number(categoryDesign.logo_scale || 1)));
      const coverTitle = String(offerData.event_name || offer.offer_number || 'OFERTA').toLocaleUpperCase('pl-PL');
      const splitCoverTitle = (() => {
        if (coverTitle.length <= 25) return coverTitle;
        const breakpoint = coverTitle.lastIndexOf(' ', 22);
        return breakpoint > 8
          ? `${coverTitle.slice(0, breakpoint)}\n${coverTitle.slice(breakpoint + 1)}`
          : coverTitle;
      })();

      await overlayTextOnPages(mergedPdf, mergedPdf.getPageCount() - 1, 1, [
        { field_name: 'company_logo', label: 'Logo firmy', type: 'image', image_fit: 'contain', x: 45, y: 42, width: 112 * logoScale, height: 78 * logoScale },
        { field_name: 'brand_title', label: 'Marka', x: 45, y: 62, font_size: 18, font_color: '#ffffff', font_role: 'heading' },
        { field_name: 'cover_kicker_title', label: 'Typ dokumentu', x: 45, y: 235, font_size: 8.5, font_color: categoryDesign.cover_accent_color },
        { field_name: 'event_name_cover', label: 'Nazwa wydarzenia', x: 45, y: 285, font_size: 25, line_height: 31, font_color: '#ffffff', max_width: 505, font_role: 'heading' },
        { field_name: 'cover_date_title', label: 'Data', x: 45, y: 430, font_size: 8, font_color: categoryDesign.cover_accent_color },
        { field_name: 'event_date_time', label: 'Termin wydarzenia', x: 45, y: 458, font_size: 13, font_color: '#ffffff', max_width: 300 },
        { field_name: 'event_location', label: 'Lokalizacja', x: 45, y: 485, font_size: 12, font_color: '#ffffff', max_width: 380 },
        { field_name: 'cover_client_title', label: 'Odbiorca', x: 45, y: 530, font_size: 8, font_color: categoryDesign.cover_accent_color },
        { field_name: 'cover_client_name', label: 'Organizacja lub klient', x: 45, y: 548, font_size: 13, font_color: '#ffffff', max_width: 380, font_role: 'heading' },
        { field_name: 'cover_contact_title', label: 'Osoba kontaktowa', x: 45, y: 578, font_size: 8, font_color: categoryDesign.cover_accent_color },
        { field_name: 'cover_contact_name', label: 'Imię i nazwisko kontaktu', x: 45, y: 596, font_size: 12, font_color: '#ffffff', max_width: 380 },
        { field_name: 'cover_footer_title', label: 'Stopka', x: 45, y: 765, font_size: 7.5, font_color: '#ffffff', max_width: 350 },
        { field_name: 'cover_valid_until', label: 'Ważność oferty', x: 45, y: 783, font_size: 8, font_color: categoryDesign.cover_accent_color, max_width: 400, font_role: 'heading' },
        { field_name: 'cover_page_number', label: 'Numer strony', x: 505, y: 765, font_size: 8, font_color: categoryDesign.cover_accent_color, max_width: 45, align: 'right', font_role: 'heading' },
      ], {
        ...offerData,
        brand_title: brandLogoUrl ? '' : brandCompanyName.toLocaleUpperCase('pl-PL'),
        cover_kicker_title: 'OFERTA OBSŁUGI TECHNICZNEJ',
        event_name_cover: splitCoverTitle,
        cover_date_title: 'TERMIN I MIEJSCE',
        event_date_time: eventDateWithTime,
        cover_client_title: offer.client_type === 'business' ? 'ORGANIZACJA' : 'OFERTA DLA',
        cover_client_name: String(
          offer.client_type === 'business'
            ? offerData.organization_name || offerData.client_name
            : offerData.client_name,
        ).toLocaleUpperCase('pl-PL'),
        cover_contact_title: offer.client_type === 'business' && offerData.contact_person_name
          ? 'OSOBA KONTAKTOWA'
          : '',
        cover_contact_name: offer.client_type === 'business'
          ? offerData.contact_person_name
          : '',
        category_hero_image: categoryHeroImage,
        cover_footer_title: sellerMode ? String(sellerBranding.footer_text || 'OFERTA PRZYGOTOWANA NA PODSTAWIE ZAPYTANIA') : 'OFERTA PRZYGOTOWANA NA PODSTAWIE ZAPYTANIA',
        cover_valid_until: offerData.offer_valid_until
          ? `OFERTA WAŻNA DO ${offerData.offer_valid_until}`
          : '',
        cover_page_number: '01',
      });
    };

    const addBuiltInAbout = async () => {
      const page = mergedPdf.addPage([595.28, 841.89]);
      page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: cream });
      page.drawLine({ start: { x: 45, y: 690 }, end: { x: 550, y: 690 }, thickness: 0.8, color: burgundy });

      const assumptionsText = String(offerData.event_assumptions || offerData.event_brief || '');
      const tableCountMatch = assumptionsText.match(/(\d+)\s*osób\s*przy\s*stole/i);
      const extraCountMatch = assumptionsText.match(/(\d+)\s*osób\s*(?:za\s*nimi|dodatkow)/i);
      const stationaryDetail = tableCountMatch
        ? `Układ konferencyjny „U”: ${tableCountMatch[1]} miejsc przy stole${extraCountMatch ? ` i ${extraCountMatch[1]} miejsc dodatkowych` : ''}.`
        : truncateAtWord(assumptionsText, 150);
      const timeRangeMatch = String(offerData.event_brief || assumptionsText).match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
      const durationDetail = timeRangeMatch
        ? `Pełne wsparcie techniczne od ${timeRangeMatch[1]} do ${timeRangeMatch[2]}.`
        : 'Czas realizacji zgodny z harmonogramem wydarzenia.';
      const configuredAssumptions = normalizeOfferAssumptionItems(offerData.event_assumption_items);
      const assumptionCards: OfferAssumptionItem[] = configuredAssumptions.length > 0
        ? configuredAssumptions
        : [
            {
              key: 'guest_count',
              label: 'Liczba gości',
              value: offerData.event_participants_stationary
                ? `${offerData.event_participants_stationary} osób`
                : stationaryDetail,
            },
            {
              key: 'event_hours',
              label: 'Godziny wydarzenia',
              value: timeRangeMatch
                ? `${timeRangeMatch[1]}–${timeRangeMatch[2]}`
                : durationDetail,
            },
            {
              key: 'client_needs',
              label: 'Przebieg i potrzeby klienta',
              value: assumptionsText,
            },
          ];

      while (assumptionCards.length < 3) {
        const fallbackIndex = assumptionCards.length;
        const fallback = [
          { key: 'guest_count', label: 'Liczba gości' },
          { key: 'event_hours', label: 'Godziny wydarzenia' },
          { key: 'client_needs', label: 'Przebieg i potrzeby klienta' },
        ][fallbackIndex];
        assumptionCards.push({ ...fallback, value: '' });
      }

      const assumptionTiles = assumptionCards.slice(0, 3).map((item, index) => {
        const explicitBadge = String(item.badge_value || '').trim();
        const rawValue = String(item.value || '').trim();
        const canUseValueInTile = !explicitBadge && rawValue.length > 0 && rawValue.length <= 7 && !rawValue.includes('\n');
        const tileValue = explicitBadge || (canUseValueInTile ? rawValue : String(index + 1).padStart(2, '0'));
        const tileFontSize = tileValue.length >= 6 ? 8 : tileValue.length >= 4 ? 9.5 : 12;
        const detail = canUseValueInTile ? '' : rawValue;
        const hasDetail = detail.length > 0;
        return {
          tileValue: tileValue.toLocaleUpperCase('pl-PL'),
          tileFontSize,
          detail,
          labelY: hasDetail ? 207 + index * 110 : 229 + index * 110,
          tileY: 229 + index * 110 + (12 - tileFontSize) / 2,
        };
      });

      if (categoryDesign.assumptions_layout === 'cards') {
        [190, 300, 410].forEach((top) => drawRoundedRectangle(page, {
          x: 45,
          y: 841.89 - top - 90,
          width: 505,
          height: 90,
          radius: 9,
          color: rgb(1, 1, 1),
        }));
      }
      [190, 300, 410].forEach((top) => drawRoundedRectangle(page, {
        x: 65,
        y: 841.89 - top - 64,
        width: 38,
        height: 38,
        radius: 8,
        color: burgundy,
      }));
      drawRoundedRectangle(page, { x: 45, y: 74, width: 505, height: 108, radius: 9, color: burgundy });

      await overlayTextOnPages(mergedPdf, mergedPdf.getPageCount() - 1, 1, [
        { field_name: 'about_title', label: 'Tytuł', x: 45, y: 52, font_size: 25, font_color: categoryDesign.primary_color, font_role: 'heading' },
        { field_name: 'about_subtitle', label: 'Podtytuł', x: 45, y: 105, font_size: 9.5, font_color: '#765f55', max_width: 505 },
        { field_name: 'stationary_value_title', label: 'Wartość', x: 65, y: assumptionTiles[0].tileY, font_size: assumptionTiles[0].tileFontSize, font_color: '#ffffff', max_width: 38, align: 'center', font_role: 'heading' },
        { field_name: 'stationary_label', label: 'Etykieta', x: 125, y: assumptionTiles[0].labelY, font_size: 10, font_color: categoryDesign.primary_color, max_width: 415, font_role: 'heading' },
        { field_name: 'stationary_detail', label: 'Szczegóły', x: 125, y: 226, font_size: 8.3, line_height: 10.5, font_color: '#171717', max_width: 415 },
        { field_name: 'online_value_title', label: 'Wartość', x: 65, y: assumptionTiles[1].tileY, font_size: assumptionTiles[1].tileFontSize, font_color: '#ffffff', max_width: 38, align: 'center', font_role: 'heading' },
        { field_name: 'online_label', label: 'Etykieta', x: 125, y: assumptionTiles[1].labelY, font_size: 10, font_color: categoryDesign.primary_color, max_width: 415, font_role: 'heading' },
        { field_name: 'online_detail', label: 'Szczegóły', x: 125, y: 336, font_size: 8.3, line_height: 10.5, font_color: '#171717', max_width: 415 },
        { field_name: 'duration_value_title', label: 'Wartość', x: 65, y: assumptionTiles[2].tileY, font_size: assumptionTiles[2].tileFontSize, font_color: '#ffffff', max_width: 38, align: 'center', font_role: 'heading' },
        { field_name: 'duration_label', label: 'Etykieta', x: 125, y: assumptionTiles[2].labelY, font_size: 10, font_color: categoryDesign.primary_color, max_width: 415, font_role: 'heading' },
        { field_name: 'duration_detail', label: 'Szczegóły', x: 125, y: 446, font_size: 8.3, line_height: 10.5, font_color: '#171717', max_width: 415 },
        { field_name: 'goal_title', label: 'Cel', x: 45, y: 545, font_size: 8.5, font_color: categoryDesign.primary_color },
        { field_name: 'event_goal_short', label: 'Cel wydarzenia', x: 45, y: 575, font_size: 11.5, line_height: 17, font_color: '#111111', max_width: 505 },
        { field_name: 'scope_title', label: 'Zakres', x: 65, y: 678, font_size: 8.5, font_color: categoryDesign.accent_color },
        { field_name: 'recommended_scope', label: 'Rekomendacja', x: 65, y: 713, font_size: 12.5, line_height: 18, font_color: '#ffffff', max_width: 465 },
        { field_name: 'about_footer', label: 'Stopka', x: 45, y: 805, font_size: 7, font_color: categoryDesign.accent_color, max_width: 390 },
        { field_name: 'about_page_number', label: 'Numer strony', x: 505, y: 805, font_size: 8, font_color: categoryDesign.primary_color, max_width: 45, align: 'right', font_role: 'heading' },
      ], {
        ...offerData,
        about_title: 'ZAŁOŻENIA SPOTKANIA',
        about_subtitle: 'Najważniejsze parametry i potrzeby klienta przyjęte do przygotowania realizacji.',
        stationary_value_title: assumptionTiles[0].tileValue,
        stationary_label: assumptionCards[0].label.toLocaleUpperCase('pl-PL'),
        stationary_detail: truncateAtWord(assumptionTiles[0].detail, 250),
        online_value_title: assumptionTiles[1].tileValue,
        online_label: assumptionCards[1].label.toLocaleUpperCase('pl-PL'),
        online_detail: truncateAtWord(assumptionTiles[1].detail, 250),
        duration_value_title: assumptionTiles[2].tileValue,
        duration_label: assumptionCards[2].label.toLocaleUpperCase('pl-PL'),
        duration_detail: truncateAtWord(assumptionTiles[2].detail, 250),
        goal_title: 'CEL REALIZACJI',
        event_goal_short: truncateAtWord(offerData.event_goal, 280) || 'Cel zostanie doprecyzowany wspólnie przed akceptacją zakresu.',
        scope_title: 'REKOMENDOWANY ZESTAW',
        recommended_scope: recommendedScope || 'Zakres zostanie dopasowany do ustaleń z klientem.',
        about_footer: `${brandCompanyName.toLocaleUpperCase('pl-PL')} / OFERTA NR ${offerData.offer_number}`,
        about_page_number: '02',
      });
    };

    const formatMoney = (value: number) =>
      `${Number(value || 0).toLocaleString('pl-PL', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} PLN`;

    const formatPackageMoney = (value: number) => {
      const numericValue = Number(value || 0);
      const hasFraction = !Number.isInteger(numericValue);
      return `${numericValue.toLocaleString('pl-PL', {
        minimumFractionDigits: hasFraction ? 2 : 0,
        maximumFractionDigits: hasFraction ? 2 : 0,
      })} PLN`;
    };

    const addBuiltInPackageComparison = async () => {
      const packages = [...(offerData.offer_packages || [])]
        .sort((a: any, b: any) => Number(a.display_order || 0) - Number(b.display_order || 0))
        .slice(0, 3);
      if (!offerData.package_mode || packages.length === 0) return false;

      const page = mergedPdf.addPage([595.28, 841.89]);
      const { width, height } = page.getSize();
      page.drawRectangle({ x: 0, y: 0, width, height, color: cream });
      page.drawLine({ start: { x: 45, y: height - 137 }, end: { x: 550, y: height - 137 }, thickness: 0.8, color: burgundy });

      const gap = 10;
      const cardWidth = (505 - gap * (packages.length - 1)) / packages.length;
      const cardTop = 176;
      const maxPackageItems = Math.max(...packages.map((pkg: any) => (pkg.items || []).length), 1);
      const cardHeight = Math.max(350, 270 + Math.min(8, maxPackageItems) * 30);
      const fallbackRecommendedId = packages.find((pkg: any) => pkg.is_recommended)?.id
        || packages[Math.min(1, packages.length - 1)].id;
      const packageNotes: string[] = [];
      if (offerData.logistics_enabled && Number(offerData.logistics_price_net || 0) > 0) {
        const logisticsNet = Number(offerData.logistics_price_net || 0);
        packageNotes.push(
          `* Logistyka: ${formatMoney(logisticsNet)} netto / ${formatMoney(logisticsNet * 1.23)} brutto (VAT 23%). ${offerData.logistics_description || ''}`.trim(),
        );
      }
      const fields: TextFieldConfig[] = [
        { field_name: 'packages_title', label: 'Tytuł pakietów', x: 45, y: 52, font_size: 24, font_color: categoryDesign.primary_color, max_width: 505, font_role: 'heading' },
        { field_name: 'packages_lead', label: 'Opis pakietów', x: 45, y: 102, font_size: 9.5, font_color: '#756f6b', max_width: 505 },
        { field_name: 'packages_note', label: 'Nota', x: 45, y: cardTop + cardHeight + 28, font_size: 7.5, line_height: 11, font_color: '#756f6b', max_width: 505 },
        { field_name: 'packages_footer', label: 'Stopka', x: 45, y: 805, font_size: 7, font_color: categoryDesign.accent_color, max_width: 390 },
        { field_name: 'packages_page_number', label: 'Numer strony', x: 505, y: 805, font_size: 8, font_color: categoryDesign.primary_color, max_width: 45, align: 'right', font_role: 'heading' },
      ];
      const pageData: Record<string, any> = {
        ...offerData,
        packages_title: 'WYBIERZ PAKIET REALIZACJI',
        packages_lead: 'Trzy czytelne poziomy zakresu - bez nadmiaru opcji i z rekomendacją najlepszego balansu.',
        packages_note: packageNotes.join('\n'),
        packages_footer: `${brandCompanyName.toLocaleUpperCase('pl-PL')} / OFERTA NR ${offerData.offer_number}`,
        packages_page_number: String(mergedPdf.getPageCount()).padStart(2, '0'),
      };

      packages.forEach((pkg: any, index: number) => {
        const x = 45 + index * (cardWidth + gap);
        const isRecommended = pkg.id === fallbackRecommendedId;
        const cardColor = isRecommended ? burgundy : rgb(1, 1, 1);
        const titleColor = isRecommended ? '#ffffff' : categoryDesign.primary_color;
        const bodyColor = isRecommended ? '#f8eef1' : '#171717';
        const mutedColor = isRecommended ? '#e8b7c4' : '#756f6b';
        if (isRecommended) {
          drawRoundedRectangle(page, {
            x: x - 7,
            y: height - cardTop - cardHeight - 7,
            width: cardWidth + 14,
            height: cardHeight + 14,
            radius: 15,
            color: accent,
            opacity: 0.06,
          });
          drawRoundedRectangle(page, {
            x: x - 3,
            y: height - cardTop - cardHeight - 3,
            width: cardWidth + 6,
            height: cardHeight + 6,
            radius: 12,
            color: accent,
            opacity: 0.16,
          });
        }
        drawRoundedRectangle(page, {
          x,
          y: height - cardTop - cardHeight,
          width: cardWidth,
          height: cardHeight,
          radius: 10,
          color: cardColor,
        });
        if (!isRecommended) {
          page.drawRectangle({ x: x + 14, y: height - cardTop - 4, width: cardWidth - 28, height: 4, color: accent });
        }

        const prefix = `package_${index + 1}`;
        const visiblePackageItems = [...(pkg.items || [])]
          .sort((a: any, b: any) => Number(a.display_order || 0) - Number(b.display_order || 0))
          .slice(0, 8);
        const itemLabels = visiblePackageItems.map((item: any) => {
            const productName = item.product?.name || 'Pozycja oferty';
            const variantName = item.selected_variant?.name;
            const quantity = Number(item.quantity || 1);
            return `• ${productName}${variantName ? ` — ${variantName}` : ''}${quantity !== 1 ? ` × ${quantity}` : ''}`;
          });
        const priceWithLogistics = Number(pkg.price_net || 0)
          + (offerData.logistics_enabled ? Number(offerData.logistics_price_net || 0) : 0);
        const listPriceWithLogistics = Number(pkg.list_price_net || pkg.price_net || 0)
          + (offerData.logistics_enabled ? Number(offerData.logistics_price_net || 0) : 0);
        const packageBenefit = Number(pkg.discount_amount || 0);

        fields.push(
          { field_name: `${prefix}_badge`, label: 'Status', x: x + 15, y: cardTop + 24, font_size: 6.8, font_color: isRecommended ? categoryDesign.accent_color : categoryDesign.primary_color, max_width: cardWidth - 30, align: 'center' },
          { field_name: `${prefix}_name`, label: 'Nazwa pakietu', x: x + 15, y: cardTop + 57, font_size: 15, font_color: titleColor, max_width: cardWidth - 30, align: 'center', font_role: 'heading' },
          { field_name: `${prefix}_description`, label: 'Opis pakietu', x: x + 15, y: cardTop + 91, font_size: 8.2, line_height: 12, font_color: mutedColor, max_width: cardWidth - 30, align: 'center' },
          { field_name: `${prefix}_list_price`, label: 'Suma produktów', x: x + 12, y: cardTop + 126, font_size: 7.2, font_color: mutedColor, max_width: cardWidth - 24, align: 'center' },
          { field_name: `${prefix}_price`, label: 'Cena pakietu', x: x + 12, y: cardTop + 148, font_size: 14.5, font_color: isRecommended ? categoryDesign.accent_color : categoryDesign.primary_color, max_width: cardWidth - 24, align: 'center', font_role: 'heading' },
          { field_name: `${prefix}_price_label`, label: 'Rodzaj ceny', x: x + 15, y: cardTop + 176, font_size: 6.8, font_color: mutedColor, max_width: cardWidth - 30, align: 'center' },
          { field_name: `${prefix}_benefit`, label: 'Korzyść klienta', x: x + 15, y: cardTop + 194, font_size: 7.2, font_color: isRecommended ? categoryDesign.accent_color : categoryDesign.primary_color, max_width: cardWidth - 30, align: 'center' },
          { field_name: `${prefix}_scope_title`, label: 'Zakres', x: x + 15, y: cardTop + 224, font_size: 7, font_color: isRecommended ? categoryDesign.accent_color : categoryDesign.primary_color, max_width: cardWidth - 30 },
        );
        pageData[`${prefix}_badge`] = isRecommended ? 'NAJLEPSZY WYBÓR' : `PAKIET ${index + 1}`;
        pageData[`${prefix}_name`] = String(pkg.name || '').toLocaleUpperCase('pl-PL');
        pageData[`${prefix}_description`] = truncateAtWord(pkg.description || '', 125);
        pageData[`${prefix}_list_price`] = packageBenefit > 0
          ? `WARTOŚĆ PRODUKTÓW: ${formatPackageMoney(listPriceWithLogistics)}`
          : '';
        pageData[`${prefix}_price`] = formatPackageMoney(priceWithLogistics);
        pageData[`${prefix}_price_label`] = `${formatPackageMoney(priceWithLogistics * (1 + Number(offer.tax_percent ?? 23) / 100))} BRUTTO · VAT ${Number(offer.tax_percent ?? 23)}%`;
        pageData[`${prefix}_benefit`] = packageBenefit > 0
          ? `OSZCZĘDZASZ ${formatPackageMoney(packageBenefit)} · ${Number(pkg.discount_percent || 0).toLocaleString('pl-PL')}%`
          : 'CENA WYNIKA Z SUMY WYBRANYCH PRODUKTÓW';
        pageData[`${prefix}_scope_title`] = 'W PAKIECIE';
        visiblePackageItems.forEach((item: any, itemIndex: number) => {
          const field = `${prefix}_item_${itemIndex}`;
          const top = cardTop + 248 + itemIndex * 30;
          const label = itemLabels[itemIndex];
          const font = overlayFontCache?.regularFont;
          let shortLabel = label;
          while (shortLabel.length > 1 && (font ? font.widthOfTextAtSize(shortLabel + '…', 7.8) : shortLabel.length * 4.5) > cardWidth - 30) shortLabel = shortLabel.slice(0, -1);
          fields.push({ field_name: field, label: 'Produkt w pakiecie', x: x + 15, y: top, font_size: 7.8, font_color: bodyColor, max_width: cardWidth - 30 });
          pageData[field] = shortLabel === label ? label : shortLabel.trimEnd() + '…';
          const url = publicProductUrl(item.product_id || item.product?.id);
          if (url) {
            fields.push({ field_name: `${field}_more`, label: 'Czytaj więcej', type: 'url', show_icon: false, link_url: url, x: x + 15, y: top + 12, font_size: 7, font_color: mutedColor, max_width: cardWidth - 30 });
            pageData[`${field}_more`] = 'CZYTAJ WIĘCEJ';
          }
        });
      });

      await overlayTextOnPages(mergedPdf, mergedPdf.getPageCount() - 1, 1, fields, pageData);
      return true;
    };

    const addDemoNotice = async (index: number, dark: boolean) => {
      await overlayTextOnPages(mergedPdf,index,1,[{field_name:'demo_notice',label:'Oznaczenie demonstracji',x:45,y:824,font_size:6,font_color:dark?'#ffffff':categoryDesign.primary_color,max_width:505}],{demo_notice:'DEMO / KALKULACJA TESTOWA / DOKUMENT TESTOWY'});
    };

    // Gotowy PDF okładki może zawierać obraz na stałe i nie mieć pola, które
    // da się zastąpić. Własne hero oferty ma wyższy priorytet, więc w takim
    // przypadku zawsze korzystamy z dynamicznej okładki.
    const coverResult = offer.hero_image_path
      ? { success: false }
      : await addPdfFromTemplate('cover');
    if (!coverResult.success) await addBuiltInCover();
    reportStage('cover_ready');
    // Preview uses the actual cover builder and embedded fonts/images. Never
    // create or return service/pricing pages before the full-PDF action.
    if (demoCoverOnly) {
      await addDemoNotice(0, true);
      mergedPdf.setTitle('Okładka przykładowej oferty');
      const coverBytes = await timed('serialization', () => mergedPdf.save({ useObjectStreams: !compactResourceMode, addDefaultPage: false }));
      reportStage('cover_pdf_ready', { bytes: coverBytes.byteLength });
      return new Response(coverBytes, { headers: { ...corsHeaders,
        'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
        'X-Offer-Demo-Cover': 'cover-v1',
      } });
    }
    const aboutResult = await addPdfFromTemplate('about');
    if (!aboutResult.success) await addBuiltInAbout();

    const addFallbackProductPage = async (
      data: Record<string, any>,
      requestedVariant = 'default',
    ) => {
      const page = mergedPdf.addPage([595.28, 841.89]);
      const { width, height } = page.getSize();
      const variant = ['default', 'compact', 'visual'].includes(requestedVariant)
        ? requestedVariant
        : 'default';

      page.drawRectangle({ x: 0, y: 0, width, height, color: cream });
      if (variant !== 'visual') {
        page.drawLine({ start: { x: 45, y: height - 142 }, end: { x: 550, y: height - 142 }, thickness: 0.8, color: burgundy });
      }
      // Images are clipped to rounded paths by overlayTextOnPages. Leave the
      // page surface visible behind them; a white rectangle leaks at corners.
      if (variant === 'default') {
        page.drawLine({ start: { x: 45, y: height - 430 }, end: { x: 550, y: height - 430 }, thickness: 0.8, color: rgb(0.82, 0.78, 0.74) });
      } else if (variant === 'compact') {
        page.drawLine({ start: { x: 45, y: height - 585 }, end: { x: 550, y: height - 585 }, thickness: 0.8, color: rgb(0.82, 0.78, 0.74) });
      } else {
        page.drawLine({ start: { x: 45, y: height - 120 }, end: { x: 550, y: height - 120 }, thickness: 0.8, color: burgundy });
        drawRoundedRectangle(page, { x: 45, y: 80, width: 505, height: 165, radius: 9, color: rgb(1, 1, 1) });
      }

      const defaultFields: TextFieldConfig[] = [
        { field_name: 'product_name', label: 'Nazwa produktu', type: 'text', x: 45, y: 55, font_size: 24, font_color: categoryDesign.primary_color, max_width: 505, font_role: 'heading' },
        { field_name: 'product_short_description', label: 'Krótki opis', type: 'text', x: 45, y: 108, font_size: 11, font_color: '#575c66', max_width: 505 },
        { field_name: 'scope_title', label: 'Zakres', type: 'text', x: 45, y: 175, font_size: 12, font_color: productSectionColor },
        { field_name: 'product_description', label: 'Opis', type: 'text', x: 45, y: 210, font_size: 10.5, line_height: 15, font_color: '#0c1a30', max_width: 245 },
        { field_name: 'product_image', label: 'Grafika', type: 'image', x: 325, y: 180, width: 225, height: 190 },
        { field_name: 'reason_title', label: 'Korzyści', type: 'text', x: 45, y: 455, font_size: 12, font_color: productSectionColor },
        { field_name: 'product_benefits_narrative', label: 'Korzyści', type: 'text', x: 45, y: 490, font_size: 9.5, line_height: 14, font_color: '#0c1a30', max_width: 245 },
      ];
      const compactFields: TextFieldConfig[] = [
        { field_name: 'product_name', label: 'Nazwa produktu', type: 'text', x: 45, y: 55, font_size: 24, font_color: categoryDesign.primary_color, max_width: 505, font_role: 'heading' },
        { field_name: 'product_short_description', label: 'Krótki opis', type: 'text', x: 45, y: 108, font_size: 11, font_color: '#575c66', max_width: 505 },
        { field_name: 'product_image', label: 'Grafika', type: 'image', x: 45, y: 165, width: 505, height: 220 },
        { field_name: 'scope_title', label: 'Zakres', type: 'text', x: 45, y: 420, font_size: 12, font_color: productSectionColor },
        { field_name: 'product_description', label: 'Opis', type: 'text', x: 45, y: 455, font_size: 10.5, line_height: 16, font_color: '#0c1a30', max_width: 505 },
        { field_name: 'reason_title', label: 'Korzyści', type: 'text', x: 45, y: 610, font_size: 12, font_color: productSectionColor },
        { field_name: 'product_benefits_narrative', label: 'Korzyści', type: 'text', x: 45, y: 645, font_size: 9.5, line_height: 14, font_color: '#0c1a30', max_width: 245 },
      ];
      const visualImageHeight = Math.min(330, Math.max(220, Number(categoryDesign.visual_image_height || 285)));
      const visualFields: TextFieldConfig[] = [
        { field_name: 'product_name', label: 'Nazwa produktu', type: 'text', x: 45, y: 45, font_size: 24, font_color: categoryDesign.primary_color, max_width: 505, font_role: 'heading' },
        { field_name: 'product_short_description', label: 'Krótki opis', type: 'text', x: 45, y: 93, font_size: 9.5, font_color: '#756f6b', max_width: 505 },
        { field_name: 'visual_scope_title', label: 'Typ zakresu', type: 'text', x: 45, y: 132, font_size: 11.5, font_color: categoryDesign.primary_color, font_role: 'heading' },
        { field_name: 'product_description', label: 'Opis', type: 'text', x: 45, y: 158, font_size: 8.8, line_height: 12, font_color: '#171717', max_width: 505 },
        { field_name: 'product_image', label: 'Grafika', type: 'image', x: 82, y: 235, width: 431, height: visualImageHeight, border_radius: 9 },
        { field_name: 'scope_title', label: 'Zakres', type: 'text', x: 67, y: 620, font_size: 8.5, font_color: categoryDesign.primary_color },
        { field_name: 'product_benefits', label: 'Korzyści', type: 'text', x: 67, y: 650, font_size: 7.6, line_height: 10.5, font_color: '#171717', max_width: 460 },
      ];
      const fallbackFields = (variant === 'compact'
        ? compactFields
        : variant === 'visual'
        ? visualFields
        : defaultFields).map((field) => field.field_name === 'product_image'
          ? {
              ...field,
              image_position_x: Number(data.product_image_position_x ?? 50),
              image_position_y: Number(data.product_image_position_y ?? 25),
              image_zoom: Number(data.product_image_zoom ?? 1),
            }
          : field);

      const fallbackData = variant === 'visual'
        ? { ...data, product_visual_layout: true, product_name: truncateAtWord(data.product_name || '', 42), product_description: truncateAtWord(data.product_description || '', 235) }
        : data;

      await overlayTextOnPages(
        mergedPdf,
        mergedPdf.getPageCount() - 1,
        1,
        fallbackFields,
        {
          ...fallbackData,
          scope_title: variant === 'visual' ? 'W ZAKRESIE' : 'CO ZAPEWNIAMY',
          visual_scope_title: 'ZAKRES REALIZACJI',
          reason_title: 'DLACZEGO TEN ZAKRES?',
          requirements_title: '',
          product_requirements: '',
        },
      );

      if (variant === 'visual' && data.product_image) {
        const visualImageBottom = height - 235 - visualImageHeight;
        const hasProductTags = Array.isArray(data.product_tags) && data.product_tags.length > 0;
        const rawTags = hasProductTags
          ? data.product_tags
          : Array.isArray(data.product_benefit_tags)
            ? data.product_benefit_tags
            : [];
        const productTags = rawTags
          .map((tag: unknown) => {
            const normalized = String(tag || '').replace(/[.!?]+$/, '').trim();
            const concise = hasProductTags
              ? truncateAtWord(normalized, 24)
              : normalized
                  .replace(/^(możliwość|bieżąca|zakres)\s+/i, '')
                  .split(/\s+/)
                  .slice(0, 3)
                  .join(' ');
            return concise.toLocaleUpperCase('pl-PL');
          })
          .filter(Boolean)
          .slice(0, 5);
        if (productTags.length) {
          const font = overlayFontCache!.regularFont;
          const fontSize = 12;
          const lineHeight = 15;
          const tagLines = wrapText(productTags.join('  •  '), font, fontSize, 455);
          // Five concise tags fit in at most three lines without shrinking the text.
          const lines = tagLines.slice(0, 3);
          const panelHeight = 64;
          const panelTop = 235 + visualImageHeight - 36;
          drawRoundedRectangle(page, {
            x: 45, y: visualImageBottom - 28, width: 505, height: panelHeight,
            radius: 9, color: burgundy,
          });
          await overlayTextOnPages(mergedPdf, mergedPdf.getPageCount() - 1, 1, [
            { field_name: 'product_tags_line', label: 'Tagi produktu', x: 70,
              y: panelTop + (panelHeight - (fontSize + (lines.length - 1) * lineHeight)) / 2,
              font_size: fontSize, line_height: lineHeight, font_color: '#ffffff', max_width: 455, align: 'center' },
          ], { product_tags_line: lines.join('\n') });
        }
      }
    };

    type PreparedProductEntry = {
      item: any;
      product: any;
      benefits: string[];
      quantity: number;
      unitPrice: number;
      itemTotal: number;
      data: Record<string, any>;
    };

    const prepareProductEntry = async (item: any): Promise<PreparedProductEntry> => {
      const product = item.product;
      const selectedVariant = item.selected_variant || null;
      const productImage = await getProductImageUrl(
        selectedVariant?.offer_image_path ? selectedVariant : product,
      );
      const benefitsSource = Array.isArray(selectedVariant?.benefits) && selectedVariant.benefits.length > 0
        ? selectedVariant.benefits
        : product.offer_benefits;
      const benefits = Array.isArray(benefitsSource)
        ? benefitsSource.filter((benefit: unknown) => typeof benefit === 'string')
        : [];
      const productTags = Array.isArray(product.tags)
        ? product.tags
            .filter((tag: unknown) => typeof tag === 'string' && tag.trim())
            .map((tag: string) => tag.trim())
        : [];
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price || item.final_price || 0);
      const itemTotal = Number(item.total ?? quantity * unitPrice);
      const benefitsNarrative = benefits.length
        ? `Ten zakres łączy ${benefits
            .map((benefit: string) => benefit.trim().replace(/[.!?]+$/, '').toLocaleLowerCase('pl-PL'))
            .join(', ')}. Dzięki temu rozwiązanie pozostaje spójne, czytelne dla uczestników i dopasowane do przebiegu wydarzenia.`
        : 'Zakres dobieramy do miejsca, liczby uczestników i ustalonego przebiegu wydarzenia.';

      return {
        item,
        product,
        benefits,
        quantity,
        unitPrice,
        itemTotal,
        data: {
          ...offerData,
          product_name: String(item.name || selectedVariant?.name || product.name || '').toLocaleUpperCase('pl-PL'),
          product_short_description: selectedVariant?.short_description || product.offer_short_description || '',
          product_description: item.description || selectedVariant?.description || product.offer_description || product.description || '',
          product_compact_description: compactProductDescription(product, item.description || ''),
          product_benefits: benefits.map((benefit: string) => `• ${benefit}`).join('\n'),
          product_requirements: '',
          product_requirements_inline: '',
          product_benefit_tags: benefits,
          product_tags: productTags,
          product_benefits_narrative: benefitsNarrative,
          product_image: productImage,
          product_image_alt: selectedVariant?.offer_image_alt || product.offer_image_alt || '',
          product_image_position_x: selectedVariant?.offer_image_path ? 50 : Number(product.offer_image_position_x ?? 50),
          product_image_position_y: selectedVariant?.offer_image_path ? 50 : Number(product.offer_image_position_y ?? 25),
          product_image_zoom: selectedVariant?.offer_image_path ? 1 : Number(product.offer_image_zoom ?? 1),
          product_page_url: publicProductUrl(product.id),
          product_quantity: quantity.toLocaleString('pl-PL'),
          product_unit: item.unit || product.unit || 'szt',
          product_unit_price: demoMode && item.demo_price_entered === false ? '' : formatMoney(unitPrice),
          product_total: demoMode && item.demo_price_entered === false ? '' : formatMoney(itemTotal),
        },
      };
    };

    const addFallbackCompactProductPage = async (entries: PreparedProductEntry[]) => {
      const page = mergedPdf.addPage([595.28, 841.89]);
      const { width, height } = page.getSize();
      page.drawRectangle({ x: 0, y: 0, width, height, color: cream });
      page.drawLine({ start: { x: 45, y: height - 112 }, end: { x: 550, y: height - 112 }, thickness: 2, color: burgundy });

      const fields: TextFieldConfig[] = [
        { field_name: 'compact_page_title', label: 'Tytuł strony', x: 45, y: 55, font_size: 23, font_color: productSectionColor, max_width: 505 },
      ];
      const compactData: Record<string, any> = {
        ...offerData,
        compact_page_title: 'ZAKRES OFERTY',
      };

      entries.slice(0, 3).forEach((entry, index) => {
        const slot = index + 1;
        const top = 145 + index * 215;
        page.drawRectangle({
          x: 45,
          y: height - top - 176,
          width: 4,
          height: 176,
          color: burgundy,
        });
        page.drawLine({
          start: { x: 45, y: height - top - 188 },
          end: { x: 550, y: height - top - 188 },
          thickness: 0.7,
          color: rgb(0.82, 0.78, 0.74),
        });

        fields.push(
          { field_name: `product_${slot}_name`, label: `Produkt ${slot}: nazwa`, x: 65, y: top + 8, font_size: 16, font_color: productSectionColor, max_width: entry.data.product_image ? 315 : 465 },
          { field_name: `product_${slot}_short_description`, label: `Produkt ${slot}: lead`, x: 65, y: top + 44, font_size: 9.5, font_color: '#575c66', max_width: entry.data.product_image ? 315 : 465 },
          { field_name: `product_${slot}_description`, label: `Produkt ${slot}: opis`, x: 65, y: top + 73, font_size: 9.3, line_height: 13, font_color: '#0c1a30', max_width: entry.data.product_image ? 315 : 465 },
          { field_name: `product_${slot}_requirements`, label: `Produkt ${slot}: wymagania`, x: 65, y: top + 132, font_size: 7.2, line_height: 9, font_color: productSectionColor, max_width: entry.data.product_image ? 315 : 465 },
          ...(entry.data.product_image ? [{ field_name: `product_${slot}_image`, label: `Produkt ${slot}: zdjęcie`, type: 'image' as const, x: 405, y: top + 10, width: 145, height: 135, image_position_x: Number(entry.data.product_image_position_x ?? 50), image_position_y: Number(entry.data.product_image_position_y ?? 25), image_zoom: Number(entry.data.product_image_zoom ?? 1), border_radius: 10 }] : []),

        );

        compactData[`product_${slot}_page_url`] = entry.data.product_page_url;
        compactData[`product_${slot}_name`] = entry.data.product_name;
        compactData[`product_${slot}_short_description`] = entry.data.product_short_description;
        compactData[`product_${slot}_description`] = truncateAtWord(entry.data.product_compact_description || entry.data.product_description, 330);
        compactData[`product_${slot}_requirements`] = entry.data.product_requirements_inline
          ? `WYMAGANIA: ${truncateAtWord(entry.data.product_requirements_inline, 110)}`
          : '';
        compactData[`product_${slot}_image`] = entry.data.product_image;
        compactData[`product_${slot}_image_zoom`] = entry.data.product_image_zoom;
        compactData[`product_${slot}_image_position_y`] = entry.data.product_image_position_y;
        compactData[`product_${slot}_image_position_x`] = entry.data.product_image_position_x;
        compactData[`product_${slot}_more`] = entry.data.product_page_url ? 'CZYTAJ WIĘCEJ' : '';
      });

      await overlayTextOnPages(
        mergedPdf,
        mergedPdf.getPageCount() - 1,
        1,
        fields,
        compactData,
      );
    };

    const compactBuffer: PreparedProductEntry[] = [];

    const flushCompactProducts = async () => {
      if (compactBuffer.length === 0) return;
      const entries = compactBuffer.splice(0, 3);
      const groupedData: Record<string, any> = { ...offerData };
      entries.forEach((entry, index) => {
        const slot = index + 1;
        groupedData[`product_${slot}_page_url`] = entry.data.product_page_url;
        groupedData[`product_${slot}_name`] = entry.data.product_name;
        groupedData[`product_${slot}_short_description`] = entry.data.product_short_description;
        groupedData[`product_${slot}_description`] = truncateAtWord(entry.data.product_compact_description || entry.data.product_description, 330);
        groupedData[`product_${slot}_requirements`] = entry.data.product_requirements_inline
          ? `WYMAGANIA: ${truncateAtWord(entry.data.product_requirements_inline, 110)}`
          : '';
        groupedData[`product_${slot}_image`] = entry.data.product_image;
        groupedData[`product_${slot}_image_zoom`] = entry.data.product_image_zoom;
        groupedData[`product_${slot}_image_position_y`] = entry.data.product_image_position_y;
        groupedData[`product_${slot}_image_position_x`] = entry.data.product_image_position_x;
      });

      const compactResult = await addPdfFromTemplate(
        'product',
        groupedData,
        'compact',
        'product_1_',
      );
      if (!compactResult.success) await addFallbackCompactProductPage(entries);

      if (compactResult.success) {
        const compactPage = mergedPdf.getPage(mergedPdf.getPageCount() - 1);
        entries.forEach((entry, index) => {
          if (!entry.data.product_page_url) return;
          const top = 145 + index * 215;
          // Extend the separator to include the dedicated CTA row.
          compactPage.drawRectangle({ x: 45, y: compactPage.getHeight() - top - 176, width: 4, height: 26, color: burgundy });
        });
      }

      entries.forEach((entry, index) => generatedProductPages.push({
        offer_item_id: entry.item.id,
        product_id: entry.product.id,
        source: compactResult.success ? 'compact_group_template' : 'compact_group_fallback',
        template_id: compactResult.success ? compactResult.templateId : null,
        variant: 'compact',
        slot: index + 1,
        products_on_page: entries.length,
        data: {
          product_name: entry.data.product_name,
          product_short_description: entry.data.product_short_description,
          product_description: entry.data.product_description,
          product_image_path: entry.item.selected_variant?.offer_image_path || entry.product.offer_image_path || null,
          quantity: entry.quantity,
          unit: entry.data.product_unit,
          unit_price: entry.unitPrice,
          total: entry.itemTotal,
        },
      }));
    };

    const addSingleProductPage = async (entry: PreparedProductEntry) => {
      const requestedVariant = entry.item.offer_page_variant_override || entry.product.offer_page_variant || 'default';
      const variant = hasOfferAddons(entry.item) || (requestedVariant === 'compact' && compactProductBlockReason(entry.product))
        ? 'default' : requestedVariant;
      const pageData = variant === 'visual'
        ? { ...entry.data, product_visual_layout: true, product_name: truncateAtWord(entry.data.product_name || '', 42) }
        : entry.data;
      const productResult = await addPdfFromTemplate('product', pageData, variant);
      if (!productResult.success) await addFallbackProductPage(pageData, variant);


      generatedProductPages.push({
        offer_item_id: entry.item.id,
        product_id: entry.product.id,
        source: productResult.success ? 'dynamic_template' : 'dynamic_fallback',
        template_id: productResult.success ? productResult.templateId : null,
        requested_variant: variant,
        resolved_variant: productResult.success ? productResult.templateVariant || variant : variant,
        data: {
          product_name: entry.data.product_name,
          product_short_description: entry.data.product_short_description,
          product_description: entry.data.product_description,
          product_benefits: entry.benefits,
          product_requirements: entry.product.offer_requirements || [],
          product_additional_requirements: entry.product.offer_additional_requirements || [],
          product_image_path: entry.item.selected_variant?.offer_image_path || entry.product.offer_image_path || null,
          product_image_alt: entry.data.product_image_alt,
          quantity: entry.quantity,
          unit: entry.data.product_unit,
          unit_price: entry.unitPrice,
          total: entry.itemTotal,
        },
      });
    };

    const addVariantComparisonSheet = async (entry: PreparedProductEntry, variants: any[], variantOffset: number, pageIndex: number, pageCount: number) => {
      const page = mergedPdf.addPage([595.28, 841.89]);
      const { width, height } = page.getSize();
      page.drawRectangle({ x: 0, y: 0, width, height, color: cream });
      page.drawLine({ start: { x: 45, y: height - 112 }, end: { x: 550, y: height - 112 }, thickness: 0.8, color: burgundy });
      page.drawLine({ start: { x: 45, y: height - 330 }, end: { x: 550, y: height - 330 }, thickness: 0.8, color: burgundy });

      const selectedVariantId = entry.item.product_variant_id || entry.item.selected_variant?.id || '';
      const fallbackRecommendedId = variants.find((variant: any) => variant.is_recommended)?.id || '';
      const highlightedId = selectedVariantId || fallbackRecommendedId;
      const elementsOnly = entry.elementsOnly === true;
      const showVariantPrices = !elementsOnly && entry.item.show_variant_prices_in_pdf !== false;
      const productImageUrl = await getProductImageUrl(entry.product) || entry.data.product_image;
      const variantImageUrls = await Promise.all(
        variants.map((variant: any) => getProductImageUrl(variant)),
      );
      const formatDuration = (value: unknown) => {
        const duration = Number(value || 0);
        if (!Number.isFinite(duration) || duration <= 0) return '';
        return duration.toLocaleString('pl-PL', {
          minimumFractionDigits: Number.isInteger(duration) ? 0 : 1,
          maximumFractionDigits: 2,
        });
      };
      const getServiceTerms = (durationHours: unknown, extensionPriceNetPerHour: unknown) => {
        const terms: string[] = [];
        const duration = formatDuration(durationHours);
        const extensionPrice = Number(extensionPriceNetPerHour || 0);
        if (duration) terms.push(`CZAS USŁUGI: ${duration} H`);
        if (Number.isFinite(extensionPrice) && extensionPrice > 0) {
          terms.push(`DODATKOWA GODZINA: ${formatMoney(extensionPrice)} NETTO`);
        }
        return terms.join('  •  ');
      };
      const fields: TextFieldConfig[] = [
        { field_name: 'variant_page_title', label: 'Produkt', x: 45, y: 42, font_size: 24, font_color: categoryDesign.primary_color, max_width: 505, font_role: 'heading' },
        { field_name: 'variant_page_lead', label: 'Opis skrócony', x: 45, y: 82, font_size: 9.5, font_color: '#756f6b', max_width: 505 },
        { field_name: 'variant_page_description', label: 'Opis produktu', x: 45, y: 137, font_size: 8.3, line_height: 11.5, font_color: '#171717', max_width: 250 },
        { field_name: 'variant_page_service_terms', label: 'Czas i przedłużenie usługi', x: 45, y: 307, font_size: 6.8, font_color: categoryDesign.primary_color, max_width: 250 },
        { field_name: 'variant_page_image', label: 'Zdjęcie produktu', type: 'image', x: 330, y: 132, width: 220, height: 165, image_position_x: Number(entry.product.offer_image_position_x ?? 50), image_position_y: Number(entry.product.offer_image_position_y ?? 25), image_zoom: Number(entry.product.offer_image_zoom ?? 1), border_radius: 8 },
        { field_name: 'variant_section_title', label: 'Sekcja wariantów', x: 45, y: 350, font_size: 12, font_color: categoryDesign.primary_color, max_width: 505, font_role: 'heading' },
        { field_name: 'variant_page_note', label: 'Nota', x: 45, y: 782, font_size: 7.5, font_color: '#756f6b', max_width: 360 },
        ...(entry.data.product_page_url ? [{
          field_name: 'variant_more_link',
          label: 'Czytaj więcej',
          type: 'url' as const,
          link_url: entry.data.product_page_url,
          x: 420,
          y: 782,
          font_size: 7.8,
          font_color: categoryDesign.primary_color,
          max_width: 130,
          align: 'right' as const,
        }] : []),
      ];
      const comparisonPageTitle = String(entry.product.name || entry.data.product_name || '').trim();
      const pageData: Record<string, any> = {
        ...offerData,
        variant_page_title: comparisonPageTitle.toLocaleUpperCase('pl-PL'),
        variant_page_lead: entry.product.offer_short_description || entry.data.product_short_description || 'Kompletny zakres usługi dopasowany do charakteru wydarzenia.',
        variant_page_description: truncateAtWord(entry.product.offer_description || entry.product.description || entry.data.product_description || '', 720),
        variant_page_service_terms: getServiceTerms(
          entry.product.service_duration_hours,
          null,
        ),
        variant_page_image: productImageUrl,
        variant_section_title: `${elementsOnly ? 'POZNAJ ELEMENTY' : 'WARIANTY'}${pageCount > 1 ? ` · ${pageIndex + 1}/${pageCount}` : ''}`,
        variant_page_note: pageIndex < pageCount - 1 ? 'Dalsze elementy znajdziesz na kolejnej stronie.' : elementsOnly ? 'Wybierz gotowy pakiet na kolejnej stronie.' : showVariantPrices
          ? 'Ceny wariantów są wartościami netto; obok podano wartość brutto z VAT 23%.'
          : 'Zakres wariantu można doprecyzować przed akceptacją oferty.',
        product_page_url: entry.data.product_page_url,
        variant_more_link: entry.data.product_page_url ? 'CZYTAJ WIĘCEJ' : '',
      };

      variants.forEach((catalogVariant: any, index: number) => {
        const override = entry.item.variant_prices_net?.[catalogVariant.id];
        const selectedPrice = catalogVariant.id === selectedVariantId ? Number(entry.item.unit_price) : undefined;
        const priceNet = selectedPrice !== undefined && Number.isFinite(selectedPrice) && selectedPrice >= 0
          ? selectedPrice : typeof override === 'number' && Number.isFinite(override) && override >= 0 ? override : Number(catalogVariant.price_net || 0);
        const variantVat = Number(offer.tax_percent ?? 23);
        const variant = { ...catalogVariant, price_net: priceNet, price_gross: Math.round(priceNet * (1 + variantVat / 100) * 100) / 100 };

        const x = 45;
        const rowTop = 382 + index * 132;
        const rowHeight = 120;
        const isHighlighted = variant.id === highlightedId;
        drawRoundedRectangle(page, {
          x,
          y: height - rowTop - rowHeight,
          width: 505,
          height: rowHeight,
          radius: 9,
          color: rgb(1, 1, 1),
        });
        page.drawRectangle({
          x: x + 14,
          y: height - rowTop - rowHeight + 10,
          width: 3,
          height: rowHeight - 20,
          color: isHighlighted ? accent : burgundy,
        });

        const fieldPrefix = `variant_${index + 1}`;
        fields.push(
          { field_name: `${fieldPrefix}_number`, label: 'Numer wariantu', x: x + 28, y: rowTop + 16, font_size: 12, font_color: categoryDesign.accent_color, max_width: 30, font_role: 'heading' },
          { field_name: `${fieldPrefix}_name`, label: 'Nazwa wariantu', x: x + 72, y: rowTop + 14, font_size: 12, font_color: categoryDesign.primary_color, max_width: 205, font_role: 'heading' },
          { field_name: `${fieldPrefix}_badge`, label: 'Status', x: x + 280, y: rowTop + 17, font_size: 5.8, font_color: categoryDesign.primary_color, max_width: 75, align: 'right' },
          { field_name: `${fieldPrefix}_short`, label: 'Lead wariantu', x: x + 72, y: rowTop + 38, font_size: 7.8, line_height: 10, font_color: '#756f6b', max_width: 285 },
          { field_name: `${fieldPrefix}_description`, label: 'Opis wariantu', x: x + 72, y: rowTop + 57, font_size: 7.2, line_height: 9.5, font_color: '#171717', max_width: 205 },
          { field_name: `${fieldPrefix}_service_terms`, label: 'Czas i przedłużenie wariantu', x: x + 72, y: rowTop + 103, font_size: 5.8, font_color: categoryDesign.primary_color, max_width: 205 },
          { field_name: `${fieldPrefix}_price`, label: 'Cena netto', x: x + 280, y: rowTop + 50, font_size: 9.4, font_color: categoryDesign.primary_color, max_width: 77, align: 'right', font_role: 'heading' },
          { field_name: `${fieldPrefix}_price_label`, label: 'Cena brutto', x: x + 270, y: rowTop + 72, font_size: 5.2, font_color: '#756f6b', max_width: 87, align: 'right' },
          { field_name: `${fieldPrefix}_image`, label: 'Zdjęcie wariantu', type: 'image', x: x + 375, y: rowTop + 10, width: 118, height: rowHeight - 20, image_position_x: variantImageUrls[index] ? 50 : Number(entry.product.offer_image_position_x ?? 50), image_position_y: variantImageUrls[index] ? 50 : Number(entry.product.offer_image_position_y ?? 25), image_zoom: variantImageUrls[index] ? 1 : Number(entry.product.offer_image_zoom ?? 1), border_radius: 6 },
        );
        pageData[`${fieldPrefix}_number`] = String(variantOffset + index + 1).padStart(2, '0');
        pageData[`${fieldPrefix}_badge`] = variant.is_recommended
          ? 'REKOMENDOWANY'
          : variant.id === selectedVariantId ? 'WYBRANY DO WYCENY' : '';
        pageData[`${fieldPrefix}_name`] = String(variant.name || '').toLocaleUpperCase('pl-PL');
        pageData[`${fieldPrefix}_short`] = truncateAtWord(variant.short_description || '', 95);
        pageData[`${fieldPrefix}_image`] = variantImageUrls[index] || productImageUrl;
        pageData[`${fieldPrefix}_price`] = showVariantPrices ? `${formatMoney(Number(variant.price_net || 0))} NETTO` : '';
        pageData[`${fieldPrefix}_price_label`] = showVariantPrices
          ? `${formatMoney(Number(variant.price_gross || Number(variant.price_net || 0) * 1.23))} BRUTTO · VAT ${variantVat}%`
          : '';
        pageData[`${fieldPrefix}_description`] = truncateAtWord(variant.description || '', 205);
        pageData[`${fieldPrefix}_service_terms`] = getServiceTerms(
          variant.service_duration_hours ?? entry.product.service_duration_hours,
          elementsOnly ? null : variant.extension_price_net_per_hour,
        );
      });

      await overlayTextOnPages(
        mergedPdf,
        mergedPdf.getPageCount() - 1,
        1,
        fields,
        pageData,
      );

      generatedProductPages.push({
        offer_item_id: entry.item.id,
        product_id: entry.product.id,
        product_variant_id: selectedVariantId || null,
        source: 'variant_comparison_fallback',
        variant: 'comparison',
        variants: variants.map((variant: any) => ({
          id: variant.id,
          name: variant.name,
          price_net: variant.id === selectedVariantId
            ? Number(entry.item.unit_price ?? variant.price_net ?? 0)
            : Number(entry.item.variant_prices_net?.[variant.id] ?? variant.price_net ?? 0),
          selected: variant.id === highlightedId,
        })),
        show_variant_prices_in_pdf: showVariantPrices,
        show_product_variants_in_pdf: true,
      });
    };

    const addVariantComparisonPage = async (entry: PreparedProductEntry) => {
      const variants = [...(entry.product.variants || [])]
        .filter((variant: any) => variant.is_active !== false)
        .sort((a: any, b: any) => Number(a.display_order || 0) - Number(b.display_order || 0));
      const pages = paginateProductVariants(variants);
      if (!pages.length) { await addSingleProductPage(entry); return; }
      let offset = 0;
      for (const [index, page] of pages.entries()) {
        await addVariantComparisonSheet(entry, page, offset, index, pages.length);
        offset += page.length;
      }
    };

    const addProductPackagesPage = async (entry: any, sourcePackages: ProductSalesPackage[]) => {
      const error = validateSalesPackages(sourcePackages);
      if (error) throw new Error(error);
      const options = sourcePackages.map(p => ({ ...p }));
      const chosen = entry.item.pricing_configuration?.product_package?.selected_id;
      const selected = options.find(p => p.id === chosen);
      if (selected) selected.price_net = Number(entry.item.pricing_configuration?.base_unit_price ?? entry.item.unit_price);
      const hexToRgb = (hex: string) => rgb(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);
      const L = packageLayout;
      const page = mergedPdf.addPage([L.width, L.height]);
      const H = L.height;
      const primary = hexToRgb(categoryDesign.primary_color);
      const accent = hexToRgb(categoryDesign.accent_color);
      page.drawRectangle({ x: 0, y: 0, width: L.width, height: H, color: hexToRgb(categoryDesign.surface_color) });
      const fields: TextFieldConfig[] = [];
      const data: Record<string, any> = { ...offerData };
      const text = (key: string, value: string, x: number, y: number, size: number, color: string, width: number, heading = false, align: 'left'|'center'|'right' = 'left') => {
        fields.push({ field_name: key, label: key, x, y, font_size: size, font_color: color, max_width: width, line_height: size * 1.25, ...(heading ? { font_role: 'heading' as const } : {}), align });
        data[key] = value;
      };
      const line = (x1: number,y1: number,x2: number,y2: number,color=primary,thickness=.8) => page.drawLine({ start:{x:x1,y:H-y1},end:{x:x2,y:H-y2},color,thickness });
      const gift = (x:number,y:number) => {
        const scale = .6;
        const stroke = (x1:number,y1:number,x2:number,y2:number) => line(x+x1*scale,y+y1*scale,x+x2*scale,y+y2*scale,accent,.7);
        stroke(0,8,18,8);stroke(0,8,0,23);stroke(18,8,18,23);stroke(0,23,18,23);stroke(9,3,9,23);
        for (const cx of [5,13]) page.drawEllipse({x:x+cx*scale,y:H-y-4*scale,xScale:4*scale,yScale:3*scale,borderColor:accent,borderWidth:.7});
      };
      text('pp_overline', `${entry.product.name} / PAKIETY`,36,32,8,categoryDesign.primary_color,523,true);
      text('pp_title', packageCopy.title,36,57,27,categoryDesign.primary_color,523,true);
      text('pp_lead', String(entry.product.name).toLocaleLowerCase('pl-PL').includes('kasyn') ? 'Od wspólnej gry przy dwóch stołach po kompletną strefę z dekoracją.' : packageCopy.lead,36,132,10,'#756f6b',523);
      line(36,160,559,160);
      for (const [i,p] of options.entries()) {
        const top=L.tops[i], h=L.heights[i], dark=p.id===chosen;
        const extension = packageExtensionLabel(p);
        const priceOffset = extension ? 12 : 0;
        const color=dark?'#faf7f2':categoryDesign.primary_color, muted=dark?'#eee7df':'#756f6b';
        drawRoundedRectangle(page,{x:L.x,y:H-top-h,width:L.widthCard,height:h,radius:9,color:dark?primary:rgb(1,1,1)});
        drawRoundedRectangle(page,{x:L.x+12,y:H-top-h+12,width:3,height:h-24,radius:1.5,color:dark?accent:primary});
        const prefix=`pp_${i}`;
        text(prefix+'_number',String(i+1).padStart(2,'0'),61,top+16,18,categoryDesign.accent_color,30,true);
        text(prefix+'_name',p.name,107,top+14,14,color,245,true);
        text(prefix+'_description',p.description,107,top+44,8.5,muted,242);
        text(prefix+'_included',p.included_label,107,top+72,8,color,245,true);
        line(107,top+92,342,top+92,dark?accent:primary,.6);
        text(prefix+'_price',`${Number(p.price_net).toLocaleString('pl-PL')} zł`,107,top+h-43-priceOffset,27,color,153);
        line(270,top+h-39-priceOffset,270,top+h-13-priceOffset,dark?accent:primary,.6);
        text(prefix+'_net','NETTO / PAKIET',281,top+h-31-priceOffset,7,muted,75);
        if (extension) text(prefix+'_extension',extension,107,top+h-15,6.6,muted,245);
        if(p.image_path){
          const url=await getProductImageUrl({offer_image_path:p.image_path});
          fields.push({field_name:prefix+'_image',label:'Zdjęcie pakietu',type:'image',x:L.imageX,y:top+12,width:L.imageWidth,height:h-24,border_radius:7});data[prefix+'_image']=url;
        }
      }
      [125,317,509].forEach((cx,i)=>{
        page.drawCircle({x:cx,y:H-727,size:18.5,color:hexToRgb('#f2eae1')});
        if(i===0){line(cx-7,717,cx+6,717);line(cx-7,717,cx-7,736);line(cx+6,717,cx+6,736);line(cx-7,736,cx+6,736);[723,728,732].forEach(y=>line(cx-3,y,cx+3,y));}
        else if(i===1){[719,726,733].forEach((y,j)=>{line(cx-9,y,cx+9,y);page.drawCircle({x:cx+(j===1?4:-3),y:H-y,size:2,borderColor:primary,borderWidth:.8,color:hexToRgb('#f2eae1')});});}
        else {page.drawCircle({x:cx,y:H-726,size:10,borderColor:primary,borderWidth:1});line(cx-5,726,cx-1,730);line(cx-1,730,cx+6,722);}
        text(`pp_step_${i}`,packageCopy.steps[i],cx-65,755,7,categoryDesign.primary_color,130,true,'center');
      });
      line(163,727,269,727,accent,.6);line(355,727,461,727,accent,.6);
      text('pp_note',packageCopy.note,36,780,7,'#756f6b',523,false,'center');
      line(36,801,559,801,primary,.6);
      text('pp_footer',`${brandCompanyName.toLocaleUpperCase('pl-PL')} / OFERTA NR ${offerData.offer_number}`,36,812,7,categoryDesign.primary_color,460,true);
      text('pp_page_number',String(mergedPdf.getPageCount()).padStart(2,'0'),515,812,7,categoryDesign.primary_color,44,false,'right');
      await overlayTextOnPages(mergedPdf,mergedPdf.getPageCount()-1,1,fields,data);
      // Bonus badges overlap the lower image edge without changing the card height.
      for (const [i,p] of options.entries()) {
        if (!p.bonus) continue;
        const y = L.tops[i] + L.heights[i] - 34;
        const x = L.imageX + L.imageWidth - 144;
        drawRoundedRectangle(page,{x,y:H-y-26,width:144,height:26,radius:6,color:primary});
        gift(x+7,y+6);
        await overlayTextOnPages(mergedPdf,mergedPdf.getPageCount()-1,1,[{field_name:'pp_bonus_badge',label:'Bonus w cenie',x:x+27,y:y+4,font_size:7,font_color:'#faf7f2',max_width:110,line_height:8.5}],{pp_bonus_badge:p.bonus});
      }
      // Selection belongs to this offer item, never to the catalog's promotional highlight.
      for (const [i,p] of options.entries()) {
        if (p.id !== chosen) continue;
        const y = L.tops[i] + 7;
        drawRoundedRectangle(page,{x:426,y:H-y-28,width:130,height:28,radius:14,color:accent});
        page.drawCircle({x:440,y:H-y-14,size:6,borderColor:primary,borderWidth:1});
        line(437,y+14,439,y+16,primary,1);line(439,y+16,443,y+11,primary,1);
        await overlayTextOnPages(mergedPdf,mergedPdf.getPageCount()-1,1,[{field_name:'pp_selected_badge',label:'Wybrany pakiet',x:451,y:y+9,font_size:8,font_color:categoryDesign.primary_color,max_width:98,line_height:10,font_role:'heading',align:'center'}],{pp_selected_badge:'WYBRANY PAKIET'});
      }
      generatedProductPages.push({offer_item_id:entry.item.id,product_id:entry.product.id,source:'product_packages',packages:options});
    };

    for (const item of sortedOfferItems) {
      const product = item.product;
      if (!product) continue;
      const packageSnapshot = item.pricing_configuration?.product_package;
      const productPackages = packageSnapshot?.options || (product.sales_packages_enabled && !item.product_variant_id ? product.sales_packages || [] : []);
      if (!sellerMode && productPackages.length > 0) {
        await flushCompactProducts();
        const entry = { ...await prepareProductEntry(item), elementsOnly: true };
        if (product.variants?.some((variant: any) => variant.is_active !== false)) await addVariantComparisonPage(entry);
        else await addSingleProductPage(entry);
        await addProductPackagesPage(entry, productPackages);
        continue;
      }

      // Product pages are always generated from catalog and offer data.
      // Legacy uploaded product PDFs and offer_page_enabled no longer select a rendering path.
      const entry = await prepareProductEntry(item);
      const activeProductVariants = (product.variants || []).filter((variant: any) => variant.is_active !== false);
      const showAllProductVariants = item.show_product_variants_in_pdf !== false;
      const requestedPageVariant = item.offer_page_variant_override
        || product.offer_page_variant
        || 'default';
      if (hasOfferAddons(item)) {
        await flushCompactProducts();
        await addSingleProductPage(entry);
      } else if (activeProductVariants.length > 0 && showAllProductVariants) {
        await flushCompactProducts();
        await addVariantComparisonPage(entry);
      } else if (requestedPageVariant === 'compact' && !compactProductBlockReason(product)) {
        compactBuffer.push(entry);
        if (compactBuffer.length === 3) await flushCompactProducts();
      } else {
        await flushCompactProducts();
        await addSingleProductPage(entry);
      }
    }
    await flushCompactProducts();
    reportStage('products_ready', { pages: mergedPdf.getPageCount() });

    const usesAcceptedCalculation = offer.pricing_source === 'calculation' && Boolean(acceptedCalculation);
    const calculationPricingItems = usesAcceptedCalculation
      ? [...(acceptedCalculation.event_calculation_items || [])]
          .sort((a: any, b: any) => Number(a.position || 0) - Number(b.position || 0))
          .map((item: any) => {
            const quantity = Number(item.quantity || 0);
            const days = Math.max(1, Number(item.days || 1));
            const unitPrice = Number(item.unit_price || 0);
            const effectiveQuantity = quantity * days;
            return {
              id: item.id,
              product_id: item.product_id,
              name: item.name,
              description: [item.description, days > 1 ? `Okres realizacji: ${days} dni.` : ''].filter(Boolean).join(' '),
              quantity: effectiveQuantity,
              unit: item.unit || 'szt.',
              unit_price: unitPrice,
              vat_rate: Number(item.vat_rate ?? 23),
              subtotal: effectiveQuantity * unitPrice,
              total: effectiveQuantity * unitPrice,
            };
          })
      : [];
    const logisticsPriceNet = !usesAcceptedCalculation && offerData.logistics_enabled
      ? Number(offerData.logistics_price_net || 0)
      : 0;
    const roundPricingMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    const originalPricingItems = [
      ...(usesAcceptedCalculation ? calculationPricingItems : offerData.offer_items),
      ...(logisticsPriceNet > 0 ? [{
        id: 'offer-logistics', name: 'Logistyka', description: offerData.logistics_description || '',
        quantity: 1, unit: 'usł.', unit_price: logisticsPriceNet, vat_rate: Number(offer.tax_percent ?? 23),
        subtotal: logisticsPriceNet, total: logisticsPriceNet,
      }] : []),
    ];
    // Use undiscounted component prices. All discounts are shown below the entire table.
    const rawPricingItems = originalPricingItems.map((item: any) => ({
      ...item,
      product: item.product ? { ...item.product, vat_rate: Number(offer.tax_percent ?? 23) } : undefined,
      vat_rate: usesAcceptedCalculation ? Number(item.vat_rate ?? 23) : Number(offer.tax_percent ?? 23),
      subtotal: roundPricingMoney(Number(item.quantity ?? 1) * Number(item.unit_price ?? 0)),
    }));
    const pricingItems = expandConfiguredItems(rawPricingItems);
    // Legacy line transport/logistics costs are still payable and must not disappear.
    if (!usesAcceptedCalculation) for (const item of originalPricingItems) {
      const extra = roundPricingMoney(Number(item.transport_cost || 0) + Number(item.logistics_cost || 0));
      if (extra > 0) pricingItems.push({ id: `${item.id}:logistics`, name: `${item.name} / transport i logistyka`, quantity: 1, unit: 'usł.', unit_price: extra, subtotal: extra, vat_rate: Number(offer.tax_percent ?? 23) });
    }
    const pricingListNet = roundPricingMoney(pricingItems.reduce((sum: number, item: any) => sum + Number(item.subtotal || 0), 0));
    const lineDiscount = usesAcceptedCalculation ? 0 : roundPricingMoney(originalPricingItems.reduce((sum: number, item: any) => sum + Number(item.discount_amount || 0), 0));
    const pricingDiscountAmount = usesAcceptedCalculation ? 0 : Math.min(pricingListNet,
      Math.max(0, roundPricingMoney(Number(offerData.discount_amount || 0) + lineDiscount)));
    const pricingDiscountPercent = pricingListNet > 0 ? pricingDiscountAmount / pricingListNet * 100 : 0;
    const pricingTotalNet = roundPricingMoney(Math.max(0, pricingListNet - pricingDiscountAmount));
    const pricingListGross = roundPricingMoney(pricingItems.reduce((sum: number, item: any) => sum + roundPricingMoney(Number(item.subtotal) * (1 + Number(item.vat_rate ?? 23) / 100)), 0));
    // Offer rows share its VAT rate; accepted calculations may retain mixed VAT rates.
    const pricingTotalGross = usesAcceptedCalculation ? pricingListGross
      : roundPricingMoney(pricingTotalNet * (1 + Number(offer.tax_percent ?? 23) / 100));

    const packageComparisonRequested = Boolean(
      offerData.package_mode && (offerData.offer_packages || []).length > 0,
    );
    const acceptedCalculationReference = usesAcceptedCalculation && acceptedCalculationNumber
      ? `Integralną częścią niniejszej oferty jest kalkulacja w wersji zapisanej przy ofercie, nr ${acceptedCalculationNumber}.`
      : '';
    // Przy pakietach korzystamy z przewidywalnej strony kalkulacji bez pola sumy.
    // Szablon PDF może zawierać statyczne etykiety podsumowania, których nie da się usunąć.
    const demoHasPrices = demoMode && pricingItems.some((item: any) => item.demo_price_entered);
    const demoPartialPrices = demoMode && pricingItems.some((item: any) => !item.demo_price_entered);
    const pricingResult = packageComparisonRequested || demoMode || pricingDiscountAmount > 0 || originalPricingItems.some(hasOfferAddons)
      ? { success: false, tableConfig: null }
      : await addPdfFromTemplate('pricing');
    if (pricingResult.success && pricingItems.length > 0) {
      const pricingPageIndex = mergedPdf.getPageCount() - 1;
      await drawOfferItemsTable(
        mergedPdf,
        pricingPageIndex,
        pricingItems,
        pricingTotalNet,
        {
          ...(pricingResult.tableConfig || {}),
          continuation_background_color: '#faf7f2',
          col_lp_width: 22,
          col_qty_width: 34,
          col_unit_width: 32,
          col_unit_price_width: 56,
          col_vat_width: 34,
          col_value_net_width: 66,
          col_value_gross_width: 66,
          header_height: 34,
          show_unit_price_net: true,
          show_value_net: true,
          show_value_gross: true,
          show_vat_column: true,
          show_summary: !packageComparisonRequested,
          discount_amount: pricingDiscountAmount,
          list_net: pricingListNet,
          list_gross: pricingListGross,
          discount_percent: pricingDiscountPercent,
          total_gross: pricingTotalGross,
        },
      );
      if (acceptedCalculationReference) {
        await overlayTextOnPages(mergedPdf, pricingPageIndex, 1, [
          { field_name: 'accepted_calculation_reference', label: 'Źródło wyceny', x: 45, y: 778, font_size: 7.4, font_color: categoryDesign.primary_color, max_width: 505 },
        ], {
          accepted_calculation_reference: acceptedCalculationReference,
        });
      }
    } else if (!pricingResult.success) {
      const page = mergedPdf.addPage([595.28, 841.89]);
      page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: cream });
      page.drawLine({ start: { x: 45, y: 700 }, end: { x: 550, y: 700 }, thickness: 0.8, color: burgundy });

      // The total belongs to the final table row, never to a fixed block that
      // a longer table could overlap or leave behind on its first page.
      const pricingFields: TextFieldConfig[] = [
        { field_name: 'pricing_title', label: 'Tytuł', x: 45, y: 58, font_size: 24, font_color: categoryDesign.primary_color, font_role: 'heading' },
        { field_name: 'pricing_subtitle', label: 'Opis', x: 45, y: 108, font_size: 10.5, font_color: '#575c66', max_width: 505 },
        { field_name: 'pricing_note', label: 'Nota', x: 45, y: 774, font_size: 7.5, font_color: '#575c66', max_width: 505 },
      ];

      await overlayTextOnPages(mergedPdf, mergedPdf.getPageCount() - 1, 1, pricingFields, {
        ...offerData,
        total_price: demoMode && !demoHasPrices ? '—' : formatMoney(pricingTotalGross),
        total_price_numeric: pricingTotalGross,
        pricing_title: demoMode ? 'PRÓBNA KALKULACJA' : 'WYCENA',
        pricing_subtitle: demoMode
          ? 'Twoje przykładowe ceny netto za 1 usługę. VAT: 23%. Puste pola nie są wycenione.'
          : packageComparisonRequested
          ? 'Ceny jednostkowe pozycji tworzących warianty pakietowe przedstawione na kolejnej stronie.'
          : usesAcceptedCalculation
            ? `Zakres i wartości wynikają z kalkulacji w wersji zapisanej przy ofercie, nr ${acceptedCalculationNumber}.`
          : 'Zakres i wartości wynikają bezpośrednio z pozycji zatwierdzonych w CRM.',
        total_label_title: demoMode ? (demoPartialPrices ? 'SUMA WPISANYCH CEN BRUTTO' : 'PRÓBNA WARTOŚĆ BRUTTO') : 'ŁĄCZNA WARTOŚĆ OFERTY BRUTTO',
        total_net_summary: `WARTOŚĆ NETTO: ${demoMode && !demoHasPrices ? '—' : formatMoney(pricingTotalNet)}`,
        discount_summary: pricingDiscountAmount > 0
          ? `RABAT ${pricingDiscountPercent.toFixed(2)}% · ${formatMoney(pricingDiscountAmount)}`
          : '',
        pricing_note: demoMode
          ? 'Kwoty wpisane przez użytkownika. Dokument testowy, bez zobowiązań.'
          : packageComparisonRequested
          ? 'Ostateczna wartość zależy od wybranego pakietu. Kwoty pakietowe znajdują się na kolejnej stronie.'
          : acceptedCalculationReference
            ? acceptedCalculationReference
          : 'Ostateczny zakres potwierdzimy po akceptacji oferty i weryfikacji warunków technicznych obiektu.',
      });

      if (pricingItems.length > 0) {
        await drawOfferItemsTable(
          mergedPdf,
          mergedPdf.getPageCount() - 1,
          pricingItems,
          pricingTotalNet,
          {
            start_y: 155,
            total_gross: pricingTotalGross,
            margin_left: 45,
            margin_right: 45,
            header_color: categoryDesign.primary_color,
            header_text_color: '#ffffff',
            text_color: '#0c1a30',
            row_bg_color: '#ffffff',
            row_odd_bg_color: '#f4f0e8',
            summary_color: categoryDesign.primary_color,
            summary_label_color: '#0c1a30',
            show_unit_price_net: true,
            show_value_net: true,
            show_value_gross: true,
            show_vat_column: true,
            show_summary: !packageComparisonRequested,
            table_bottom_margin: 110,
            demo_mode: demoMode,
            discount_amount: pricingDiscountAmount,
          list_net: pricingListNet,
          list_gross: pricingListGross,
            discount_percent: pricingDiscountPercent,
            show_borders: false,
            col_lp_width: 22,
            col_qty_width: 34,
            col_unit_width: 32,
            col_unit_price_width: 56,
            col_vat_width: 34,
            col_value_net_width: 66,
            col_value_gross_width: 66,
            row_height: 27,
            header_height: 34,
            body_font_size: 9,
            header_font_size: 9,
          },
        );
      }
    }

    // Porównanie pakietów zawsze następuje po kalkulacji jednostkowej.
    await addBuiltInPackageComparison();

    // Optional recommendations are deliberately never part of pricingItems,
    // offer_items, equipment reservations or the accepted calculation.
    let recommendations = Array.isArray(offer.recommended_items) ? offer.recommended_items : [];
    const recommendationProductIds = [...new Set(recommendations.map((item: any) => item.product_id).filter(Boolean))];
    const recommendationCatalog = new Map<string, any>();
    if (recommendationProductIds.length > 0) {
      const { data: catalogProducts, error: catalogError } = await supabase
        .from('offer_products')
        .select('id, name, description, offer_description, pricing_addons, offer_image_path, pdf_thumbnail_url, variants:offer_product_variants(id, offer_image_path)')
        .in('id', recommendationProductIds);
      if (catalogError) throw new Error(`Nie można pobrać zdjęć proponowanych produktów: ${catalogError.message}`);
      for (const product of catalogProducts || []) recommendationCatalog.set(product.id, product);
    }
    // Older CRM proposals only saved a flat price. Keep that negotiated price;
    // catalog rules supplement the scope without silently enabling new charges.
    recommendations = recommendations.map((item: any) => {
      if (sellerMode || item.pricing_configuration) return item;
      const product = recommendationCatalog.get(item.product_id);
      if (!Array.isArray(product?.pricing_addons) || !product.pricing_addons.length) return item;
      return { ...item, legacy_addon_rates: true, discount_percent: 0,
        pricing_configuration: createConfiguration(Number(item.unit_price), product.pricing_addons.map((addon: any) => ({
          ...addon, enabled: false, quantity: addon.kind === 'over_limit' ? addon.included_quantity : 0,
        }))),
      };
    });
    // Recommendations are product cards only. Never pass them to the calculation
    // renderer: even a configured proposal remains outside the quoted line items.
    let recommendationTop = 155;
    let recommendationPage: any = null;
    const startRecommendationPage = async () => {
      recommendationPage = mergedPdf.addPage([595.28, 841.89]);
      recommendationTop = 155;
      recommendationPage.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: cream });
      recommendationPage.drawLine({ start: { x: 45, y: 709.89 }, end: { x: 550, y: 709.89 }, thickness: 0.8, color: burgundy });
      await overlayTextOnPages(mergedPdf, mergedPdf.getPageCount() - 1, 1, [
        { field_name: 'recommendations_title', label: 'Tytuł', x: 45, y: 48, font_size: 22, line_height: 29, font_color: categoryDesign.primary_color, max_width: 505, font_role: 'heading' },
        { field_name: 'recommendations_note', label: 'Informacja', x: 45, y: 111, font_size: 9, font_color: '#756f6b', max_width: 505 },
        { field_name: 'recommendations_footer', label: 'Stopka', x: 45, y: 805, font_size: 7, font_color: categoryDesign.accent_color, max_width: 445 },
        { field_name: 'recommendations_page', label: 'Strona', x: 505, y: 805, font_size: 8, font_color: categoryDesign.primary_color, max_width: 45, align: 'right' },
      ], {
        recommendations_title: 'ZOBACZ, CO WARTO DOBRAĆ\nDO TAKIEGO WYDARZENIA',
        recommendations_note: 'Opcjonalne propozycje — poza kalkulacją i wartością oferty.',
        recommendations_footer: `${brandCompanyName.toLocaleUpperCase('pl-PL')} / OFERTA NR ${offerData.offer_number}`,
        recommendations_page: String(mergedPdf.getPageCount()).padStart(2, '0'),
      });
    };
    for (const item of recommendations) {
      if (!recommendationPage) await startRecommendationPage();
      const configuration = item.pricing_configuration;
      if (configuration) {
        const error = validateConfiguration(configuration);
        if (error) throw new Error(`${item.name}: ${error}`);
      }
      const quantity = Number(item.quantity);
      const discount = configuration ? Number(item.discount_percent ?? 0) : 0;
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(discount) || discount < 0 || discount > 100) throw new Error('Nieprawidłowa ilość lub rabat propozycji.');
      const unitPrice = configuration ? addonMoney(configurationPrice(configuration) * (1 - discount / 100)) : Number(item.unit_price);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Nieprawidłowa cena propozycji.');
      const net = addonMoney(quantity * unitPrice);
      const vatRate = Number(offer.tax_percent ?? 23);
      const catalogProduct = recommendationCatalog.get(item.product_id);
      const catalogVariant = catalogProduct?.variants?.find((variant: any) => variant.id === item.product_variant_id);
      const imagePath = item.image_path || catalogVariant?.offer_image_path || catalogProduct?.offer_image_path || catalogProduct?.pdf_thumbnail_url;
      const imageUrl = imagePath ? await createOptimizedSignedImageUrl('offer-product-pages', imagePath, 320) : '';
      const textX = imageUrl ? 185 : 60;
      const textWidth = imageUrl ? 350 : 475;
      const regular = overlayFontCache!.regularFont;
      const heading = overlayFontCache!.headingFont || overlayFontCache!.boldFont;
      const fitLines = (text: string, font: any, size: number, width: number, limit: number) => {
        const lines = wrapText(text, font, size, width);
        if (lines.length <= limit) return lines.join('\n');
        const clipped = lines.slice(0, limit);
        let last = clipped[limit - 1];
        while (last && font.widthOfTextAtSize(last + '…', size) > width) last = last.slice(0, -1);
        clipped[limit - 1] = last.trimEnd() + '…';
        return clipped.join('\n');
      };
      const title = fitLines(String(item.name || '').toLocaleUpperCase('pl-PL'), heading, 13, textWidth, 2);
      const description = fitLines(String(item.description || catalogProduct?.offer_description || catalogProduct?.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '), regular, 9, textWidth, 4);
      const rateTexts: string[] = [];
      if (configuration?.addons?.length) {
        rateTexts.push(`Pakiet bazowy: ${formatMoney(configuration.base_unit_price)} netto.${discount > 0 ? ` Rabat propozycji: ${discount}%. Poniższe stawki przed rabatem.` : ''}`);
        for (const addon of configuration.addons) {
          const price = addon.price_on_request && addon.unit_price <= 0 ? 'wycena indywidualna' : `${formatMoney(addon.unit_price)} netto / ${addon.unit}`;
          const allowance = addon.kind === 'over_limit' ? `W pakiecie ${addon.included_quantity} ${addon.unit}; dopłata ponad limit: ` : '';
          const selected = addonQuantity(addon);
          rateTexts.push(`${addon.name}: ${allowance}${price}. ${selected > 0 ? `W cenie propozycji: ${selected} ${addon.unit} / pakiet.` : 'Opcja do wyboru — poza podaną ceną.'}`);
        }
        if (item.legacy_addon_rates) rateTexts.push('Stawki rozszerzeń z aktualnego katalogu; zakres wymaga potwierdzenia. Cena zapisanej propozycji pozostaje bez zmian.');
      }
      const rateLines = rateTexts.flatMap(text => wrapText(text, regular, 8, 475));
      // Long lists continue as product cards, with repeated product identity and link.
      const chunkSize = 32;
      const chunks = rateLines.length ? Array.from({ length: Math.ceil(rateLines.length / chunkSize) }, (_, index) => rateLines.slice(index * chunkSize, (index + 1) * chunkSize)) : [[]];
      for (const [chunkIndex, lines] of chunks.entries()) {
        const cardHeight = lines.length ? 222 + lines.length * 12 : 184;
        if (recommendationTop + cardHeight > 780) await startRecommendationPage();
        const top = recommendationTop;
        drawRoundedRectangle(recommendationPage, { x: 45, y: 841.89 - top - cardHeight, width: 505, height: cardHeight, radius: 8, color: rgb(1, 1, 1) });
        const fields: TextFieldConfig[] = [
          { field_name: 'rec_name', label: 'Produkt', x: textX, y: top + 18, font_size: 13, line_height: 17, font_color: categoryDesign.primary_color, max_width: textWidth, font_role: 'heading' },
          { field_name: 'rec_description', label: 'Opis', x: textX, y: top + 58, font_size: 9, line_height: 13, font_color: '#756f6b', max_width: textWidth },
          { field_name: 'rec_quantity', label: 'Cena jednostkowa', x: textX, y: top + 118, font_size: 8, font_color: '#756f6b', max_width: textWidth },
          { field_name: 'rec_price', label: 'Cena propozycji', x: textX, y: top + 137, font_size: 12, font_color: categoryDesign.primary_color, max_width: textWidth, font_role: 'heading' },
          { field_name: 'rec_gross', label: 'Cena brutto', x: textX, y: top + 158, font_size: 8, font_color: '#756f6b', max_width: textWidth - 110 },
          { field_name: 'rec_more', label: 'Czytaj więcej', type: 'url', show_icon: false, x: 430, y: top + 158, font_size: 9, font_color: categoryDesign.primary_color, max_width: 105, link_url: publicProductUrl(item.product_id) },
        ];
        if (imageUrl) fields.push({ field_name: 'rec_image', label: 'Zdjęcie', type: 'image', x: 60, y: top + 22, width: 110, height: 110, image_fit: 'contain', border_radius: 8 });
        if (lines.length) {
          fields.push({ field_name: 'rec_rates_title', label: 'Możliwe rozszerzenia', x: 60, y: top + 185, font_size: 9, font_color: categoryDesign.primary_color, max_width: 475 });
          fields.push({ field_name: 'rec_rates', label: 'Stawki dodatków', x: 60, y: top + 205, font_size: 8, line_height: 12, font_color: '#756f6b', max_width: 475 });
        }
        await overlayTextOnPages(mergedPdf, mergedPdf.getPageCount() - 1, 1, fields, {
          rec_name: title, rec_description: description, rec_image: imageUrl,
          rec_quantity: `${quantity.toLocaleString('pl-PL')} ${item.unit || 'szt.'} × ${formatMoney(unitPrice)} netto${discount > 0 ? ' · po rabacie' : ''}`,
          rec_price: `${formatMoney(net)} NETTO`, rec_gross: `${formatMoney(net * (1 + vatRate / 100))} brutto · VAT ${vatRate}%`,
          rec_more: 'CZYTAJ WIĘCEJ',
          rec_rates_title: chunkIndex ? 'MOŻLIWE ROZSZERZENIA — CIĄG DALSZY' : 'ZAKRES I MOŻLIWE ROZSZERZENIA',
          rec_rates: lines.join('\n'),
        });
        recommendationTop += cardHeight + 15;
      }
    }

    const splitConfiguredLines = (value: unknown) => String(value || '')
      .split(/\r?\n/)
      .map((line) => line.replace(/^[•\-–—]\s*/, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const ensureSentence = (value: string) => {
      const normalized = value.replace(/\s+/g, ' ').trim();
      if (!normalized) return '';
      return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
    };
    const requirementCategoryLabels: Record<string, string> = {
      people: 'LUDZIE I OBSADA',
      resources: 'SPRZĘT I ZASOBY',
      place: 'MIEJSCE REALIZACJI',
      time: 'CZAS I HARMONOGRAM',
      power: 'ZASILANIE',
      internet: 'ŁĄCZE INTERNETOWE',
      access: 'DOSTĘP DO OBIEKTU',
      coordination: 'KOORDYNACJA Z OBIEKTEM',
      setup: 'MONTAŻ I PRÓBA',
      schedule: 'HARMONOGRAM',
      surface: 'MIEJSCE REALIZACJI',
      venue_approval: 'ZGODA OBIEKTU',
      safety: 'BEZPIECZEŃSTWO',
      technical: 'WARUNEK TECHNICZNY',
      accommodation: 'ZAKWATEROWANIE',
      backstage: 'ZAPLECZE / GARDEROBA',
      hospitality: 'GOŚCINNOŚĆ / CATERING',
      logistics: 'LOGISTYKA',
      permissions: 'POZWOLENIA OBIEKTU',
      other: 'INNE WYMAGANIE',
    };
    type OfferRequirementEntry = {
      key: string;
      title: string;
      description: string;
      category: string;
      sources: string[];
      included: boolean;
      priority: number;
      origin: 'template' | 'product' | 'manual';
    };
    const requirementEntryByKey = new Map<string, OfferRequirementEntry>();
    const normalizeRequirement = (value: string) => value
      .toLocaleLowerCase('pl-PL')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ł/g, 'l')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    const inferRequirementCategory = (description: string, preferred = 'technical') => {
      const value = normalizeRequirement(description);
      if (/zasil|230\s*v|230v|400\s*v|400v|3\s*faz|trojfaz|sila|gniazd|prad|obwod/.test(value)) return 'power';
      if (/internet|lacze|ethernet|wi fi|wifi|sieciow/.test(value)) return 'internet';
      if (/osob|technik|realizator|operator|obsluga|personel|ekipa/.test(value)) return 'people';
      if (/sprzet|urzadzen|zasob|okablow|mikrofon|glosnik|ekran|projektor/.test(value)) return 'resources';
      if (/zgod.*obiekt|akceptac.*obiekt|dopuszcz|czujek|przeciwpozar/.test(value)) return 'venue_approval';
      if (/kontakt|koordyn|osob.*decyzyjn|osob.*technicz/.test(value)) return 'coordination';
      if (/montaz|demontaz|proba|wczesniejsz.*wejsc|wyprzedzeniem/.test(value)) return 'setup';
      if (/harmonogram|scenariusz|moment|program wydarzenia/.test(value)) return 'schedule';
      if (/godzin|termin|czas realizac|okno czasow/.test(value)) return 'time';
      if (/dostep|dojazd|wniesien|transportow/.test(value)) return 'access';
      if (/rowne|stabilne|suche|podloze|stanowisko|powierzchni/.test(value)) return 'surface';
      if (/miejsce|sala|scena|przestrzen/.test(value)) return 'place';
      if (/bezpiecz|strefa|ewakuac|latwopal/.test(value)) return 'safety';
      return requirementCategoryLabels[preferred] ? preferred : 'technical';
    };
    const requirementPriority = (category: string, description: string) => {
      const value = normalizeRequirement(description);
      let priority = Math.min(80, value.length);
      if (category === 'power') {
        if (/400\s*v|400v|3\s*faz|trojfaz|sila/.test(value)) priority += 500;
        else if (/230\s*v|230v/.test(value)) priority += 300;
        else priority += 100;
        if (/32\s*a|32a|63\s*a|63a|kw/.test(value)) priority += 60;
      }
      if (category === 'internet') {
        if (/ethernet|przewod/.test(value)) priority += 500;
        else if (/stabiln|gwarantowan/.test(value)) priority += 300;
        else if (/wi fi|wifi/.test(value)) priority += 100;
        if (/mb\/s|mbps|gb\/s|gbps/.test(value)) priority += 80;
      }
      if (category === 'access' && /ciezar|bus|samochod|bezposredni dojazd/.test(value)) priority += 200;
      return priority;
    };
    const requirementFingerprint = (value: string) => normalizeRequirement(value)
      .split(' ')
      .filter((word) => word.length > 2 && !['oraz', 'dla', 'przed', 'przez', 'jest', 'byc', 'miec'].includes(word))
      .slice(0, 10)
      .sort()
      .join('-');
    const requirementKey = (category: string, description: string) => [
      'people', 'resources', 'place', 'time', 'power', 'internet', 'access',
      'coordination', 'setup', 'schedule', 'surface', 'venue_approval', 'permissions',
    ].includes(category)
      ? category
      : `${category}:${requirementFingerprint(description) || 'requirement'}`;
    const addRequirementEntry = (entry: Partial<OfferRequirementEntry> & Pick<OfferRequirementEntry, 'description' | 'sources'>) => {
      const title = String(entry.title || '').replace(/\s+/g, ' ').trim();
      const description = ensureSentence(entry.description || title);
      if (!title && !description) return;
      const requestedCategory = String(entry.category || '');
      const category = requirementCategoryLabels[requestedCategory]
        ? requestedCategory
        : inferRequirementCategory(description, 'technical');
      const key = entry.key || requirementKey(category, description);
      const priority = Number.isFinite(entry.priority) ? Number(entry.priority) : requirementPriority(category, description);
      const existing = requirementEntryByKey.get(key);
      const sources = [...new Set([...(existing?.sources || []), ...entry.sources.filter(Boolean)])];
      const normalizedEntry = {
        key,
        category,
        title: title || requirementCategoryLabels[category] || 'WYMAGANIE',
        description,
        sources,
        included: entry.included !== false,
        priority,
        origin: entry.origin || 'product',
      };
      if (!existing || priority > existing.priority || (priority === existing.priority && description.length > existing.description.length)) {
        requirementEntryByKey.set(key, normalizedEntry);
      } else {
        requirementEntryByKey.set(key, { ...existing, sources, included: entry.included ?? existing.included });
      }
    };

    splitConfiguredLines(categoryDesign.technical_requirements_text).forEach((description) => {
      addRequirementEntry({
        title: requirementCategoryLabels[inferRequirementCategory(description)],
        description,
        category: inferRequirementCategory(description),
        sources: ['Szablon główny oferty'],
        origin: 'template',
        included: true,
      });
    });
    sortedOfferItems.forEach((item: any) => {
      const productName = String(item.name || item.product?.name || 'Produkt').trim();
      const technicalRequirements = Array.isArray(item.product?.offer_requirements)
        ? item.product.offer_requirements
        : [];
      technicalRequirements
        .filter((requirement: unknown) => typeof requirement === 'string' && requirement.trim())
        .forEach((description: string) => {
          addRequirementEntry({
            title: requirementCategoryLabels[inferRequirementCategory(description)],
            description,
            category: inferRequirementCategory(description),
            sources: [productName],
            origin: 'product',
            included: true,
          });
        });

      const additionalRequirements = Array.isArray(item.product?.offer_additional_requirements)
        ? item.product.offer_additional_requirements
        : [];
      additionalRequirements.forEach((requirement: any) => {
        if (!requirement || typeof requirement !== 'object') return;
        const category = Object.prototype.hasOwnProperty.call(requirementCategoryLabels, requirement.category)
          ? String(requirement.category)
          : 'other';
        const title = String(requirement.title || requirementCategoryLabels[category] || 'Inne wymaganie').trim();
        const description = String(requirement.description || title).trim();
        if (!title && !description) return;
        addRequirementEntry({
          title: title.toLocaleUpperCase('pl-PL'),
          description,
          category,
          sources: [productName],
          origin: 'product',
          included: true,
        });
      });
    });

    const storedRequirements = (() => {
      if (Array.isArray(offer.offer_requirements)) return offer.offer_requirements;
      if (typeof offer.offer_requirements === 'string') {
        try {
          const parsed = JSON.parse(offer.offer_requirements);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    })();
    // Wysłana lub zaakceptowana oferta zachowuje zatwierdzony snapshot. Szkic
    // ma natomiast zawsze odzwierciedlać bieżące wymagania produktów; zapisane
    // ręczne zmiany są poniżej scalane z aktualnie wyliczoną listą.
    if (storedRequirements.length > 0 && offer.status !== 'draft') {
      requirementEntryByKey.clear();
    }
    storedRequirements.forEach((entry: any) => {
      if (!entry || typeof entry !== 'object') return;
      const description = String(entry.description || entry.title || '').trim();
      if (!description) return;
      const storedCategory = String(entry.category || '');
      const category = requirementCategoryLabels[storedCategory]
        ? storedCategory
        : inferRequirementCategory(description, 'technical');
      const key = entry.origin === 'manual' && entry.key
        ? String(entry.key)
        : requirementKey(category, description);
      const current = requirementEntryByKey.get(key);
      const priority = requirementPriority(category, description);
      const sources = [...new Set([...(current?.sources || []), ...(Array.isArray(entry.sources) ? entry.sources : [])].filter(Boolean))];
      if (!current || entry.origin === 'manual' || priority >= current.priority) {
        requirementEntryByKey.set(key, {
          key,
          category,
          title: String(entry.title || requirementCategoryLabels[category] || 'WYMAGANIE').trim(),
          description: ensureSentence(description),
          sources,
          included: entry.included !== false,
          priority,
          origin: entry.origin === 'manual' ? 'manual' : 'product',
        });
      } else {
        requirementEntryByKey.set(key, { ...current, sources, included: entry.included !== false });
      }
    });

    const requirementOrder = [
      'people', 'resources', 'place', 'time', 'power', 'internet', 'access',
      'setup', 'surface', 'venue_approval', 'permissions', 'coordination',
      'schedule', 'safety', 'accommodation', 'backstage', 'hospitality',
      'logistics', 'technical', 'other',
    ];
    const uniqueRequirementsByDescription = new Map<string, OfferRequirementEntry>();
    requirementEntryByKey.forEach((entry) => {
      const fingerprint = normalizeRequirement(entry.description);
      const existing = uniqueRequirementsByDescription.get(fingerprint);
      if (!existing) {
        uniqueRequirementsByDescription.set(fingerprint, entry);
        return;
      }
      uniqueRequirementsByDescription.set(fingerprint, {
        ...(entry.priority > existing.priority ? entry : existing),
        sources: [...new Set([...existing.sources, ...entry.sources])],
        included: existing.included && entry.included,
      });
    });
    const requirementGroupsByTitle = new Map<string, {
      entry: OfferRequirementEntry;
      descriptions: string[];
    }>();
    uniqueRequirementsByDescription.forEach((entry) => {
      const groupKey = normalizeRequirement(entry.title) || entry.category;
      const existing = requirementGroupsByTitle.get(groupKey);
      if (!existing) {
        requirementGroupsByTitle.set(groupKey, { entry, descriptions: [entry.description] });
        return;
      }
      const descriptions = [...existing.descriptions];
      if (!descriptions.some((description) => normalizeRequirement(description) === normalizeRequirement(entry.description))) {
        descriptions.push(entry.description);
      }
      requirementGroupsByTitle.set(groupKey, {
        entry: {
          ...(entry.priority > existing.entry.priority ? entry : existing.entry),
          sources: [...new Set([...existing.entry.sources, ...entry.sources])],
          included: existing.entry.included && entry.included,
        },
        descriptions,
      });
    });
    const requirementEntries = [...requirementGroupsByTitle.values()]
      .map(({ entry, descriptions }) => ({
        ...entry,
        description: descriptions.length > 1
          ? descriptions.map((description) => `• ${description}`).join('\n')
          : descriptions[0],
      }))
      .filter((entry) => entry.included !== false)
      .sort((a, b) => {
        const aOrder = requirementOrder.indexOf(a.category);
        const bOrder = requirementOrder.indexOf(b.category);
        return (aOrder < 0 ? 99 : aOrder) - (bOrder < 0 ? 99 : bOrder)
          || b.priority - a.priority
          || a.title.localeCompare(b.title, 'pl');
      });

    if (categoryDesign.info_page_enabled !== false) {
      const orderSteps = splitConfiguredLines(categoryDesign.order_process_text);
      const reservationTerms = splitConfiguredLines(categoryDesign.reservation_terms_text);
      const storedInfoSections = Array.isArray(offer.info_page_sections)
        ? offer.info_page_sections.slice(0, 3)
        : [];
      // Założenia mają jedno źródło: event_assumption_items i stronę trzech kart.
      // Nie powielamy ich automatycznymi kartami. Zachowujemy jawnie wpisane
      // warunki starych ofert, nie usuwając żadnych danych z bazy.
      const assumptionContent = normalizeOfferAssumptionItems(offerData.event_assumption_items)
        .map((item) => item.value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl-PL'));
      const additionalInfoSections = storedInfoSections
        .map((section: any) => ({
          key: String(section?.key || 'custom'),
          title: String(section?.title || 'DODATKOWE USTALENIA').trim(),
          content: String(section?.content || '').trim(),
        }))
        .filter((section: { content: string }) => section.content
          && !assumptionContent.includes(section.content.replace(/\s+/g, ' ').toLocaleLowerCase('pl-PL')));
      const infoSections = [
        {
          key: 'order',
          title: 'JAK WYGLĄDA ZAMÓWIENIE',
          content: orderSteps.map((line, index) => `${index + 1}.  ${line}`).join('\n'),
        },
        {
          key: 'reservation',
          title: 'REZERWACJA I ZMIANY',
          content: reservationTerms.map((line) => ensureSentence(line)).join('\n'),
        },
        ...additionalInfoSections,
      ];
      const page = mergedPdf.addPage([595.28, 841.89]);
      page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: cream });
      page.drawLine({ start: { x: 45, y: 700 }, end: { x: 550, y: 700 }, thickness: 0.8, color: burgundy });
      const infoFields: TextFieldConfig[] = [
        { field_name: 'info_title', label: 'Tytuł', x: 45, y: 58, font_size: 24, font_color: categoryDesign.primary_color, font_role: 'heading', max_width: 505 },
        { field_name: 'info_subtitle', label: 'Opis', x: 45, y: 118, font_size: 9.5, font_color: '#765f55', max_width: 505 },
        { field_name: 'info_footer', label: 'Stopka', x: 45, y: 805, font_size: 7, font_color: categoryDesign.accent_color, max_width: 390 },
        { field_name: 'info_page_number', label: 'Numer strony', x: 505, y: 805, font_size: 8, font_color: categoryDesign.primary_color, max_width: 45, align: 'right', font_role: 'heading' },
      ];
      const infoPageData: Record<string, any> = {
        info_title: String(categoryDesign.info_page_title || 'INFORMACJE I WARUNKI').toLocaleUpperCase('pl-PL'),
        info_subtitle: 'Najważniejsze informacje organizacyjne przed potwierdzeniem realizacji.',
        info_footer: `${brandCompanyName.toLocaleUpperCase('pl-PL')} / OFERTA NR ${offerData.offer_number}`,
        info_page_number: String(mergedPdf.getPageCount()).padStart(2, '0'),
      };
      const infoCardHeight = 116;
      const infoCardGap = 8;
      const infoCardTop = 165;
      infoSections.forEach((section, index) => {
        const top = infoCardTop + index * (infoCardHeight + infoCardGap);
        drawRoundedRectangle(page, {
          x: 45,
          y: 841.89 - top - infoCardHeight,
          width: 505,
          height: infoCardHeight,
          radius: 8,
          color: rgb(1, 1, 1),
        });
        const prefix = `info_section_${index}`;
        infoFields.push(
          { field_name: `${prefix}_number`, label: 'Numer', x: 65, y: top + 18, font_size: 18, font_color: categoryDesign.accent_color, font_role: 'heading' },
          { field_name: `${prefix}_title`, label: 'Sekcja', x: 125, y: top + 18, font_size: 9.2, font_color: categoryDesign.primary_color },
          { field_name: `${prefix}_content`, label: 'Treść', x: 125, y: top + 44, font_size: 7.8, line_height: 12.5, font_color: '#171717', max_width: 395 },
        );
        infoPageData[`${prefix}_number`] = String(index + 1).padStart(2, '0');
        infoPageData[`${prefix}_title`] = section.title.toLocaleUpperCase('pl-PL');
        infoPageData[`${prefix}_content`] = truncateAtWord(section.content, 360);
      });

      await overlayTextOnPages(
        mergedPdf,
        mergedPdf.getPageCount() - 1,
        1,
        infoFields,
        infoPageData,
      );
    }

    if (categoryDesign.requirements_page_enabled !== false && requirementEntries.length > 0) {
      const estimateRequirementLines = (description: string) => description
        .split(/\r?\n/)
        .reduce((sum, paragraph) => sum + Math.max(1, Math.ceil(paragraph.length / 112)), 0);
      const requirementRows = requirementEntries.map((entry) => ({
        ...entry,
        height: Math.min(150, Math.max(42, 25 + estimateRequirementLines(entry.description) * 10)),
      }));
      const requirementPages: typeof requirementRows[] = [];
      let currentPageRows: typeof requirementRows = [];
      let usedHeight = 0;
      requirementRows.forEach((row) => {
        if (currentPageRows.length > 0 && usedHeight + row.height > 598) {
          requirementPages.push(currentPageRows);
          currentPageRows = [];
          usedHeight = 0;
        }
        currentPageRows.push(row);
        usedHeight += row.height;
      });
      if (currentPageRows.length > 0) requirementPages.push(currentPageRows);

      for (let requirementPageIndex = 0; requirementPageIndex < requirementPages.length; requirementPageIndex += 1) {
        const pageRows = requirementPages[requirementPageIndex];
        const page = mergedPdf.addPage([595.28, 841.89]);
        page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: cream });
        page.drawLine({ start: { x: 45, y: 700 }, end: { x: 550, y: 700 }, thickness: 0.8, color: burgundy });

        const fields: TextFieldConfig[] = [
          { field_name: 'requirements_title', label: 'Tytuł', x: 45, y: 60, font_size: 18, font_color: categoryDesign.primary_color, font_role: 'heading', max_width: 505 },
          { field_name: 'requirements_subtitle', label: 'Opis', x: 45, y: 106, font_size: 8.3, font_color: '#765f55', max_width: 505 },
          { field_name: 'requirements_footer', label: 'Stopka', x: 45, y: 805, font_size: 7, font_color: categoryDesign.accent_color, max_width: 390 },
          { field_name: 'requirements_page_number', label: 'Numer strony', x: 505, y: 805, font_size: 8, font_color: categoryDesign.primary_color, max_width: 45, align: 'right', font_role: 'heading' },
        ];
        const pageData: Record<string, any> = {
          requirements_title: String(categoryDesign.requirements_page_title || 'WARUNKI TECHNICZNE I ORGANIZACYJNE').toLocaleUpperCase('pl-PL'),
          requirements_subtitle: requirementPageIndex === 0
            ? String(categoryDesign.requirements_page_subtitle || 'Wymagania niezbędne do bezpiecznego i sprawnego przygotowania realizacji.')
            : 'Dalsza część warunków wynikających z zakresu wybranych produktów.',
          requirements_footer: `${brandCompanyName.toLocaleUpperCase('pl-PL')} / OFERTA NR ${offerData.offer_number}`,
          requirements_page_number: String(mergedPdf.getPageCount()).padStart(2, '0'),
        };

        let rowTop = 164;
        pageRows.forEach((row, rowIndex) => {
          const fieldPrefix = `requirement_${rowIndex}`;
          const rowBottom = 841.89 - rowTop - row.height;
          page.drawLine({
            start: { x: 45, y: rowBottom + 1 },
            end: { x: 550, y: rowBottom + 1 },
            thickness: 0.45,
            color: burgundy,
            opacity: 0.18,
          });
          fields.push(
            { field_name: `${fieldPrefix}_title`, label: 'Nazwa wymagania', x: 45, y: rowTop + 3, font_size: 8.4, font_color: categoryDesign.primary_color, max_width: 505 },
            { field_name: `${fieldPrefix}_description`, label: 'Opis wymagania', x: 45, y: rowTop + 19, font_size: 7.7, line_height: 9.8, font_color: '#3c3836', max_width: 505 },
          );
          pageData[`${fieldPrefix}_title`] = row.title.toLocaleUpperCase('pl-PL');
          const description = String(row.description || '').trim();
          pageData[`${fieldPrefix}_description`] = description.length > 900
            ? `${description.slice(0, 897).trimEnd()}…`
            : description;
          rowTop += row.height;
        });

        await overlayTextOnPages(
          mergedPdf,
          mergedPdf.getPageCount() - 1,
          1,
          fields,
          pageData,
        );
      }
    }

    // Strona końcowa zawsze powstaje z aktualnych danych CRM i brandbooka.
    // Dzięki temu stary, częściowo skonfigurowany PDF nie może zastąpić nowego układu.
    {
      const page = mergedPdf.addPage([595.28, 841.89]);
      const finalLeft = colorFromHex(sellerMode ? categoryDesign.primary_color : '#69102d', [0.412, 0.063, 0.176]);
      const finalRight = colorFromHex(sellerMode ? categoryDesign.secondary_color : '#470018', [0.278, 0, 0.094]);
      page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: finalRight });
      page.drawRectangle({ x: 0, y: 0, width: 286, height: 841.89, color: finalLeft });
      if (!offerData.employee_avatar_url) {
        page.drawCircle({ x: 143, y: 396.89, size: 70, color: accent });
        page.drawCircle({ x: 143, y: 419, size: 20, color: finalLeft });
        drawRoundedRectangle(page, { x: 111, y: 341, width: 64, height: 48, radius: 19, color: finalLeft });
      }
      page.drawLine({ start: { x: 45, y: 74 }, end: { x: 550, y: 74 }, thickness: 0.8, color: accent, opacity: 0.85 });

      const finalFirstName = String(offerData.employee_first_name || '').toLocaleUpperCase('pl-PL');
      const finalLastName = String(offerData.employee_last_name || '').toLocaleUpperCase('pl-PL');
      const nameSize = 14;
      const nameFont = overlayFontCache?.headingFont || overlayFontCache?.boldFont;
      const firstNameWidth = nameFont?.widthOfTextAtSize(finalFirstName, nameSize) || finalFirstName.length * 8;
      const lastNameX = Math.min(158, 45 + firstNameWidth + 7);

      // Oryginalne wektorowe ikony z public/icons. Każda zajmuje pole 12 × 12 pt,
      // a odstęp 18 pt odpowiada dokładnie odstępowi między wierszami tekstu.
      page.drawSvgPath('M256,0C114.609,0,0,114.609,0,256s114.609,256,256,256s256-114.609,256-256S397.391,0,256,0z M256,472c-119.297,0-216-96.703-216-216S136.703,40,256,40s216,96.703,216,216S375.297,472,256,472z M327.125,383.969c5.703,0.016,56.875-37.828,56.875-42.656s-57.266-40.906-62.219-40.906s-21.578,19.938-26.062,22.156c-4.5,2.219-32.5,1.422-63.703-29.781c-31.219-31.188-41.875-67.109-41.875-72.75s26.031-23.062,26.75-27.156S182.578,128,176.891,128S128,180.5,128,184.875s3.953,60.656,75.219,131.906S321.422,383.938,327.125,383.969z', { x: 45, y: 140, scale: 0.0234375, color: accent });
      page.drawSvgPath('M27.9999,51.9063C41.0546,51.9063,51.9063,41.0781,51.9063,28C51.9063,14.9453,41.0312,4.0937,27.9765,4.0937C14.8983,4.0937,4.0937,14.9453,4.0937,28C4.0937,41.0781,14.9218,51.9063,27.9999,51.9063z M27.9999,47.9219C16.9374,47.9219,8.1014,39.0625,8.1014,28C8.1014,16.9609,16.914,8.0781,27.9765,8.0781C39.0155,8.0781,47.8983,16.9609,47.9219,28C47.9454,39.0625,39.039,47.9219,27.9999,47.9219z M27.9765,29.289C28.3749,29.289,28.8202,29.125,29.2655,28.6797L39.6014,18.3437C39.3202,18.1094,38.6405,17.875,37.6327,17.875L18.2968,17.875C17.3124,17.875,16.6093,18.1094,16.328,18.3437L26.664,28.6797C27.1327,29.1484,27.578,29.289,27.9765,29.289z M23.3358,28.0469L15.1796,19.8906C15.039,20.125,14.9687,20.6875,14.9687,21.5078L14.9687,34.4922C14.9687,35.3125,15.039,35.8984,15.203,36.1797z M32.5234,28.0469L40.6562,36.1797C40.8202,35.8984,40.8905,35.3125,40.8905,34.4922L40.8905,21.5078C40.8905,20.6875,40.8202,20.125,40.703,19.8906z M27.953,31.1406C27.1093,31.1406,26.453,30.8359,25.539,29.9922L24.789,29.289L16.3749,37.7031C16.6562,37.9609,17.3124,38.125,18.2968,38.125L37.6093,38.125C38.5936,38.125,39.2499,37.9609,39.5312,37.7031L31.1171,29.289L30.3671,29.9922C29.453,30.8359,28.7968,31.1406,27.953,31.1406z', { x: 45, y: 122, scale: 0.2142857, color: accent });
      if (String(offerData.seller_website || '').trim()) page.drawSvgPath('M336.5,160C322,70.7,287.8,8,248,8s-74,62.7-88.5,152h177z M152,256c0,22.2,1.2,43.5,3.3,64h185.3c2.1-20.5,3.3-41.8,3.3-64s-1.2-43.5-3.3-64H155.3c-2.1,20.5-3.3,41.8-3.3,64z M476.7,160c-28.6-67.9-86.5-120.4-158-141.6c24.4,33.8,41.2,84.7,50,141.6h108z M177.2,18.4C105.8,39.6,47.8,92.1,19.3,160h108c8.7-56.9,25.5-107.8,49.9-141.6z M487.4,192H372.7c2.1,21,3.3,42.5,3.3,64s-1.2,43-3.3,64h114.6c5.5-20.5,8.6-41.8,8.6-64s-3.1-43.5-8.5-64z M120,256c0-21.5,1.2-43,3.3-64H8.6C3.2,212.5,0,233.8,0,256s3.2,43.5,8.6,64h114.6c-2-21-3.2-42.5-3.2-64z M159.5,352c14.5,89.3,48.7,152,88.5,152s74-62.7,88.5-152h-177z M318.8,493.6c71.4-21.2,129.4-73.7,158-141.6h-108c-8.8,56.9-25.6,108-50,141.6z M19.3,352c28.6,67.9,86.5,120.4,158,141.6c-24.4-33.8-41.2-84.7-50-141.6h-108z', { x: 45.2, y: 104, scale: 0.0234375, color: accent });

      const socialItems = [
        { key: 'facebook', url: offerData.social_facebook_url },
        { key: 'instagram', url: offerData.social_instagram_url },
        { key: 'linkedin', url: offerData.social_linkedin_url },
        { key: 'youtube', url: offerData.social_youtube_url },
      ].filter((item) => item.url).slice(0, 4);
      socialItems.forEach((item, index) => {
        const x = 198 + index * 20;
        drawRoundedRectangle(page, { x, y: 92, width: 16, height: 16, radius: 4, color: accent });
        if (item.key === 'facebook') {
          // Znak z public/icons/facebook-gold.svg.
          page.drawSvgPath('M13.5 8H16V4.5h-2.5C10.7 4.5 9 6.2 9 9v2H6v3.5h3V22h3.8v-7.5h3l.5-3.5h-3.5V9.2c0-.8.3-1.2.7-1.2Z', { x: x + 1.9, y: 108, scale: 0.62, color: finalRight });
        } else if (item.key === 'instagram') {
          // Znak z public/icons/instagram-gold.svg.
          page.drawSvgPath('M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H7Zm5 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm4.5-2.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z', { x: x + 0.8, y: 108, scale: 0.6, color: finalRight });
        } else if (item.key === 'linkedin') {
          // Znak z public/icons/linkedin-gold.svg.
          page.drawSvgPath('M7.4 9.2H4.2V19h3.2V9.2ZM5.8 4A1.8 1.8 0 1 0 5.8 7.6 1.8 1.8 0 0 0 5.8 4ZM19.8 13.4c0-3-1.6-4.5-3.8-4.5-1.8 0-2.6 1-3 1.7V9.2H9.8V19H13v-4.9c0-1.3.2-2.6 1.9-2.6 1.6 0 1.7 1.5 1.7 2.7V19h3.2v-5.6Z', { x: x + 1.6, y: 107.5, scale: 0.62, color: finalRight });
        } else if (item.key === 'youtube') {
          page.drawSvgPath('M 0 0 L 0 7 L 6 3.5 Z', { x: x + 6, y: 96.5, color: finalRight });
        }
        try {
          const linkAnnotation = mergedPdf.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [x, 92, x + 16, 108],
            Border: [0, 0, 0],
            A: { S: 'URI', URI: PDFString.of(String(item.url)) },
          });
          const linkAnnotationRef = mergedPdf.context.register(linkAnnotation);
          const annotations = page.node.lookup(PDFName.of('Annots'), PDFArray) || mergedPdf.context.obj([]);
          annotations.push(linkAnnotationRef);
          page.node.set(PDFName.of('Annots'), annotations);
        } catch (error) {
          console.error('Error adding social link annotation:', error);
        }
      });

      await overlayTextOnPages(mergedPdf, mergedPdf.getPageCount() - 1, 1, [
        { field_name: 'closing_title', label: 'Zakończenie', x: 45, y: 56, font_size: 25, line_height: 34, font_color: '#ffffff', max_width: 230, font_role: 'heading' },
        { field_name: 'caretaker_title', label: 'Opiekun', x: 45, y: 176, font_size: 8.5, font_color: categoryDesign.accent_color },
        { field_name: 'employee_avatar_url', label: 'Zdjęcie', type: 'image', image_fit: 'contain', x: 45, y: 480, width: 146, height: 165 },
        { field_name: 'avatar_placeholder_label', label: 'Miejsce na zdjęcie', x: 45, y: 650, font_size: 8.5, font_color: '#ffffff', max_width: 196, align: 'center' },
        { field_name: 'final_first_name', label: 'Imię', x: 45, y: 670, font_size: nameSize, font_color: '#ffffff', max_width: 110, font_role: 'heading' },
        { field_name: 'final_last_name', label: 'Nazwisko', x: lastNameX, y: 670, font_size: nameSize, font_color: categoryDesign.accent_color, max_width: 128, font_role: 'heading' },
        { field_name: 'employee_phone', label: 'Telefon', type: 'phone', show_icon: false, x: 63, y: 702, font_size: 10, font_color: '#ffffff', max_width: 178 },
        { field_name: 'employee_email', label: 'E-mail', type: 'email', show_icon: false, x: 63, y: 720, font_size: 9, font_color: '#ffffff', max_width: 178 },
        { field_name: 'seller_website', label: 'Strona WWW', type: 'url', show_icon: false, x: 63, y: 738, font_size: 9, font_color: '#ffffff', max_width: 128 },
        { field_name: 'company_logo', label: 'Logo firmy', type: 'image', image_fit: 'contain', x: 358, y: 65, width: 165, height: 115 },
        { field_name: 'brand_title', label: 'Marka', x: 358, y: 80, font_size: 16, font_color: '#ffffff', font_role: 'heading' },
        { field_name: 'thanks_title', label: 'Podziękowanie', x: 344, y: 440, font_size: 11, font_color: categoryDesign.accent_color },
        { field_name: 'closing_text', label: 'Treść', x: 344, y: 482, font_size: 11, line_height: 19, font_color: '#ffffff', max_width: 205 },
        { field_name: 'final_footer', label: 'Stopka', x: 45, y: 795, font_size: 7, font_color: categoryDesign.accent_color, max_width: 390 },
        { field_name: 'final_page_number', label: 'Numer strony', x: 505, y: 795, font_size: 8, font_color: categoryDesign.accent_color, max_width: 45, align: 'right', font_role: 'heading' },
      ], {
        ...offerData,
        brand_title: brandLogoUrl ? '' : brandCompanyName.toLocaleUpperCase('pl-PL'),
        closing_title: 'ZAPRASZAMY\nDO WSPÓŁPRACY',
        caretaker_title: sellerMode ? String(sellerBranding.position_title || 'OPIEKUN OFERTY') : 'OPIEKUN OFERTY',
        avatar_placeholder_label: offerData.employee_avatar_url ? '' : 'MIEJSCE NA ZDJĘCIE OPIEKUNA',
        final_first_name: finalFirstName,
        final_last_name: finalLastName,
        thanks_title: 'DZIĘKUJEMY ZA ZAPYTANIE.',
        closing_text: sellerMode ? String(sellerBranding.footer_text || 'Jesteśmy gotowi doprecyzować zakres oraz zaplanować realizację.') : 'Jesteśmy gotowi doprecyzować zakres oraz zaplanować realizację.',
        final_footer: `${brandCompanyName.toLocaleUpperCase('pl-PL')} / OFERTA NR ${offerData.offer_number}`,
        final_page_number: String(mergedPdf.getPageCount()).padStart(2, '0'),
      });
    }

    if (mergedPdf.getPageCount() === 0) {
      throw new Error("No PDF pages found. Please add PDF pages to templates or products first.");
    }

    const totalPages = mergedPdf.getPageCount();
    for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
      const page = mergedPdf.getPage(pageIndex);
      const saved = documentFurniture.get(page);
      const boundaryPage = pageIndex === 0 || pageIndex === totalPages - 1;
      const right = page.getWidth() - 45;
      const footerY = page.getHeight() - 37;
      const numberStyle: TextFieldConfig = boundaryPage && saved?.number ? saved.number : {
        field_name: 'document_page_number', label: 'Numer strony',
        x: right - 45, y: footerY, font_size: 8,
        font_color: boundaryPage ? categoryDesign.accent_color : categoryDesign.primary_color,
        max_width: 45, align: 'right',
      };
      const fields: TextFieldConfig[] = [{
        ...numberStyle, field_name: 'document_page_number', font_role: 'body',
      }];
      const data: Record<string, any> = {
        document_page_number: String(pageIndex + 1).padStart(2, '0'),
      };
      if (boundaryPage && saved?.footer) {
        fields.push({ ...saved.footer.field, field_name: 'document_footer' });
        data.document_footer = saved.footer.value;
      } else if (!boundaryPage) {
        fields.push({ field_name: 'document_footer', label: 'Stopka dokumentu', x: 45, y: footerY, font_size: 7, font_color: categoryDesign.accent_color, max_width: Math.min(400, right - 100) });
        data.document_footer = `${brandCompanyName.toLocaleUpperCase('pl-PL')} / OFERTA NR ${offerData.offer_number}`;
      }
      await overlayTextOnPages(mergedPdf, pageIndex, 1, fields, data, true);
    }
    documentFurniture.clear();

    if (demoMode) {
      for (let index = 0; index < mergedPdf.getPageCount(); index++) {
        await addDemoNotice(index, index === 0 || index === mergedPdf.getPageCount() - 1);
      }
      mergedPdf.setTitle('Przykładowa oferta — demonstracja strefy sprzedawcy');
    }

    // Drop lookup references before serialization. The assets are already part
    // of the PDF context, while the maps would otherwise keep additional JS
    // objects alive during the most memory-intensive phase.
    embeddedImageCache?.images.clear();
    embeddedImageCache = null;
    imageFallbackUrls.clear();
    productImageUrlCache.clear();

    reportStage('serialization_start', { pages: mergedPdf.getPageCount() });
    const pdfBytes = await timed('serialization', () => mergedPdf.save({
      // On a retry skip only object-stream compression, never image quality or layout.
      useObjectStreams: !compactResourceMode,
      addDefaultPage: false,
      objectsPerTick: 15,
    }));
    reportStage('pdf_ready', { pages: mergedPdf.getPageCount(), bytes: pdfBytes.byteLength });

    if (sellerMode) {
      await ensureSellerSource();
      // The bridge owns private storage/versioning/notifications. Do not run any
      // CRM upload, pdf_url, offer history or event_files mutations below.
      return new Response(pdfBytes, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
          'X-Offer-Renderer': 'seller-v1', 'X-Offer-Identity': 'organization-v1', 'X-Offer-Fonts': 'catalog-v1', ...(demoMode ? { 'X-Offer-Demo': 'demo-v2', 'X-Offer-Demo-Cover': 'cover-v1' } : { 'X-Offer-Source-Key': expectedSourceKey! }) },
      });
    }

    const downloadFileName = offerPdfFileName(offer.offer_number);
    // Each generated version retains its own private path and friendly basename.
    const fileName = `${offer.id}/${crypto.randomUUID()}/${downloadFileName}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('generated-offers')
      .upload(fileName, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      throw new Error("Failed to upload PDF: " + uploadError.message);
    }

    const { data: previousSnapshot } = await supabase
      .from('offer_generation_snapshots')
      .select('generation_number')
      .eq('offer_id', offerId)
      .order('generation_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const generationNumber = Number(previousSnapshot?.generation_number || 0) + 1;
    const generatedAt = new Date().toISOString();
    const snapshot = {
      snapshot_version: 1,
      generated_at: generatedAt,
      offer_id: offerId,
      template_category_id: templateCategoryId,
      client: {
        name: offerData.client_name,
        organization_name: offerData.organization_name,
        organization_legal_name: offerData.organization_legal_name,
        contact_person_name: offerData.contact_person_name,
        contact_person_email: offerData.contact_person_email,
        contact_person_phone: offerData.contact_person_phone,
        address: offerData.client_address,
        nip: offerData.client_nip,
        city: offerData.client_city,
        postal_code: offerData.client_postal_code,
        street: offerData.client_street,
      },
      offer: {
        number: offerData.offer_number,
        name: offerData.offer_name,
        date: offerData.offer_date,
        total_price: offerData.total_price_numeric,
      },
      event: {
        name: offerData.event_name,
        category_id: offerData.event_category_id,
        category_name: offerData.event_category_name,
        date: offerData.event_date,
        location: offerData.event_location,
        assumptions: offerData.event_assumptions,
        goal: offerData.event_goal,
      },
      employee: {
        id: currentEmployee?.id || null,
        first_name: offerData.employee_first_name,
        last_name: offerData.employee_last_name,
        email: offerData.employee_email,
        phone: offerData.employee_phone,
        avatar_url: offerData.employee_avatar_url,
      },
      items: sortedOfferItems.map((item: any) => ({
        id: item.id,
        product_id: item.product?.id || item.product_id || null,
        name: item.name || item.product?.name || '',
        description: item.description || '',
        quantity: Number(item.quantity || 0),
        unit: item.unit || item.product?.unit || 'szt',
        unit_price: Number(item.unit_price || item.final_price || 0),
        pricing_configuration: item.pricing_configuration || null,
        discount_percent: Number(item.discount_percent || 0),
        discount_amount: Number(item.discount_amount || 0),
        transport_cost: Number(item.transport_cost || 0),
        logistics_cost: Number(item.logistics_cost || 0),
        total: Number(item.total || 0),
        vat_rate: Number(item.product?.vat_rate || item.vat_rate || 0),
      })),
      product_pages: generatedProductPages,
      generated_pdf_path: fileName,
    };

    const { error: snapshotError } = await supabase
      .from('offer_generation_snapshots')
      .insert({
        offer_id: offerId,
        generation_number: generationNumber,
        snapshot_version: 1,
        snapshot,
        generated_pdf_path: fileName,
        generated_by: currentEmployee?.id || offer.created_by || null,
      });
    if (snapshotError) {
      throw new Error("Failed to save offer generation snapshot: " + snapshotError.message);
    }

    const { error: updateError } = await supabase
      .from('offers')
      .update({
        generated_pdf_revision: offer.content_revision,
        generated_pdf_url: fileName,
        modified_after_generation: false,
        last_generated_by: currentEmployee?.id || offer.created_by || null,
        last_generated_at: generatedAt,
      })
      .eq('id', offerId).eq('content_revision', offer.content_revision).select('id').single();

    if (updateError) {
      throw new Error("Oferta zmieniła się podczas generowania. Wygeneruj PDF ponownie: " + updateError.message);
    }

    const { error: fileHistoryError } = await supabase.from('sales_document_files').insert({ offer_id: offerId, inquiry_id: offer.inquiry_id, storage_bucket: 'generated-offers', storage_path: fileName, revision: offer.content_revision });
    if (fileHistoryError) throw new Error('Nie udało się zapisać wersji PDF: ' + fileHistoryError.message);

    if (offer.event_id) {
      const eventFileName = downloadFileName;
      const eventFilePath = `${offer.event_id}/${crypto.randomUUID()}/${eventFileName}`;

      const { error: eventUploadError } = await supabase.storage
        .from('event-files')
        .upload(eventFilePath, pdfBytes, {
          contentType: 'application/pdf',
          upsert: false,
        });

      if (!eventUploadError) {
        const { data: folderId } = await supabase.rpc('get_or_create_documents_subfolder', {
          p_event_id: offer.event_id,
          p_subfolder_name: 'Oferty',
          p_required_permission: 'offers_create',
          p_created_by: currentEmployee?.id || offer.created_by,
        });

        await supabase.from('event_files').insert([
          {
            event_id: offer.event_id,
            folder_id: folderId,
            name: eventFileName,
            original_name: eventFileName,
            file_path: eventFilePath,
            file_size: pdfBytes.length,
            mime_type: 'application/pdf',
            document_type: 'offer',
            offer_id: offerId,
            thumbnail_url: null,
            uploaded_by: currentEmployee?.id || offer.created_by,
          },
        ]);

      } else {
        console.error('Failed to save offer PDF to event files:', eventUploadError);
      }
    }

    const { data: signedUrlData } = await supabase.storage
      .from('generated-offers')
      .createSignedUrl(fileName, 3600, { download: downloadFileName });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Offer PDF generated successfully",
        fileName: fileName,
        downloadFileName,
        generationNumber,
        pageCount: mergedPdf.getPageCount(),
        resourceMode,
        downloadUrl: signedUrlData?.signedUrl,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    reportStage('failed');
    console.error("Error generating offer PDF:", error);
    const errorMessage = error instanceof Error ? error.message : String(error || "");
    const resourceLimit = /memory|resource|allocation|array buffer|heap|out of memory|cpu time/i.test(errorMessage);
    return new Response(
      JSON.stringify({
        success: false,
        error: resourceLimit
          ? "Generator PDF przekroczył dostępny limit zasobów"
          : errorMessage || "Failed to generate offer PDF",
        ...(resourceLimit ? { code: "WORKER_RESOURCE_LIMIT" } : {}),
        ...((error as { code?: string })?.code === 'SELLER_FONT_ERROR' ? { code: 'SELLER_FONT_ERROR' } : {}),
      }),
      {
        status: resourceLimit ? 503 : 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
