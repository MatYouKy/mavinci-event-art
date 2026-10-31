import { sealDemoAttribution } from '@/lib/seller/demoAttribution.server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { brochurePalette, parseDecorativePages, parseComposer, resolvedBenefits, requiresPageImage, type BrochureImageBucket } from '@/lib/brochures/decorativePages';
import { brochureFileName, brochurePageReferences, validateBrochureContent, type BrochureValidationIssue } from '@/lib/brochures/validation';
import { validatePdfAssets, type BrochureImageSource } from '@/lib/brochures/validatePdfAssets.server';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { loadPdfFont } from '@/lib/brochures/loadPdfFont.server';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { BrochureRequestError, requireBrochureEmployeeAccess } from '@/lib/brochures/access.server';
import { resolveBrochureClient } from '@/lib/brochures/recipient.server';
import { brochureClientPdfFileName } from '@/lib/brochures/recipient';
import {
  buildSalesBrochureHtml,
  SalesBrochureSnapshot,
} from '@/lib/brochures/buildSalesBrochureHtml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const BROCHURE_PDF_SIZE_LIMIT = 50 * 1024 * 1024;
const formatPdfSize = (bytes: number) =>
  `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(bytes / (1024 * 1024))} MiB`;

const pdfSizeLimitResponse = (fileSizeBytes: number, limitBytes: number, storageRejected = false) =>
  NextResponse.json({
    error: storageRejected
      ? `Magazyn plików odrzucił PDF o rozmiarze ${formatPdfSize(fileSizeBytes)}. Limit broszur wynosi ${formatPdfSize(limitBytes)}. Administrator powinien sprawdzić także globalny limit plików w Supabase. PDF nie został zapisany.`
      : `PDF ma ${formatPdfSize(fileSizeBytes)}, a dopuszczalny rozmiar broszury wynosi ${formatPdfSize(limitBytes)}. Zmniejsz rozdzielczość zdjęć lub podziel broszurę na mniejsze części. PDF nie został zapisany.`,
    code: 'brochure_pdf_size_limit',
    fileSizeBytes,
    limitBytes,
  }, { status: 413 });

const getSupabaseAdmin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'broszura';

const asStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
};

export async function POST(request: Request) {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    const { brochureId, recipientEmail: rawRecipient, recipient: rawClient, campaignId, validateOnly: rawValidateOnly } = (await request.json()) as { brochureId?: string; recipientEmail?: unknown; recipient?: unknown; campaignId?: string; validateOnly?: boolean };
    const validateOnly = rawValidateOnly === true;
    const recipientEmail = typeof rawRecipient === 'string' ? rawRecipient.trim().toLowerCase() : '';
    if (recipientEmail && (recipientEmail.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail))) return NextResponse.json({ error: 'Wpisz prawidłowy e-mail odbiorcy lub pozostaw pole puste.' }, { status: 400 });
    if (!brochureId) {
      return NextResponse.json({ error: 'Brak identyfikatora broszury' }, { status: 400 });
    }

    const userClient = createSupabaseServerClient(cookies());
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ error: 'Wymagane logowanie' }, { status: 401 });
    }

    const { data: visibleBrochure, error: accessError } = await userClient
      .from('sales_brochures')
      .select('id')
      .eq('id', brochureId)
      .maybeSingle();
    if (accessError || !visibleBrochure) {
      return NextResponse.json({ error: 'Brak dostępu do broszury' }, { status: 403 });
    }

    const employeeId = await requireBrochureEmployeeAccess(userClient);
    const recipient = await resolveBrochureClient(userClient, rawClient);
    if (!validateOnly) {
      // Fail before rendering/uploading if the client-version migration is missing.
      const readiness = await userClient.from('sales_brochure_generations')
        .select('recipient_contact_id,recipient_organization_id,recipient_name,recipient_email')
        .eq('brochure_id', brochureId).limit(0);
      if (readiness.error) {
        const missingMigration = ['42703', 'PGRST204'].includes(readiness.error.code);
        throw new BrochureRequestError(missingMigration
          ? 'Generator wymaga migracji powiązań broszur z klientami (20261020160000_brochure_client_versions.sql). Poproś administratora o jej wdrożenie. PDF nie został utworzony.'
          : 'Nie udało się sprawdzić zapisu wersji broszury. Spróbuj ponownie. PDF nie został utworzony.', 503);
      }
    }
    const admin = getSupabaseAdmin();
    const { data: employee, error: employeeError } = await admin
      .from('employees')
      .select('id,name,surname,email,phone_number,avatar_url')
      .eq('id', employeeId)
      .eq('is_active', true)
      .maybeSingle();
    if (employeeError) {
      console.error('Brochure employee lookup failed:', employeeError);
      throw new BrochureRequestError('Nie udało się pobrać danych pracownika przygotowującego PDF.', 503);
    }
    if (!employee) {
      return NextResponse.json({ error: 'Nie znaleziono aktywnego pracownika' }, { status: 403 });
    }
    const { data: brochure, error: brochureError } = await admin
      .from('sales_brochures')
      .select('*')
      .eq('id', brochureId)
      .maybeSingle();
    if (brochureError || !brochure) {
      return NextResponse.json({ error: 'Nie znaleziono broszury' }, { status: 404 });
    }

    let campaignGenerationId: string | null = null;
    if (campaignId) {
      if (!/^[0-9a-f-]{36}$/i.test(campaignId) || recipientEmail || recipient) return NextResponse.json({ error: 'Wersja kampanijna nie może być przypisana do pojedynczego klienta ani adresu e-mail.' }, { status: 400 });
      const { data: canManageCampaign } = await userClient.rpc('can_manage_marketing_campaigns');
      const { data: campaign } = await userClient.from('mailing_campaigns').select('id,status,brochure_generation_id').eq('id',campaignId).maybeSingle();
      if (!canManageCampaign || !campaign || campaign.status !== 'draft' || !campaign.brochure_generation_id) return NextResponse.json({ error: 'Wymagany jest dostęp do szkicu kampanii z przypisaną broszurą.' }, { status: 403 });
      const { data: source } = await userClient.from('sales_brochure_generations').select('brochure_id').eq('id',campaign.brochure_generation_id).maybeSingle();
      if (source?.brochure_id !== brochureId) return NextResponse.json({ error: 'Kampania dotyczy innej broszury.' }, { status: 400 });
      if (brochure.brand_config?.seller_demo_enabled !== true) return NextResponse.json({ error: 'Włącz demo w broszurze przed przygotowaniem wersji kampanii.' }, { status: 400 });
      campaignGenerationId = campaign.brochure_generation_id;
    }

    const [itemsResult, companyResult, organizationResult, contactResult, logosResult, colorsResult, fontsResult] =
      await Promise.all([
        admin
          .from('sales_brochure_items')
          .select(`
            *,
            product:offer_products(
              id,name,description,offer_short_description,offer_description,offer_compact_description,offer_benefits,
              offer_image_path,offer_image_alt,category:event_categories(id,name)
            ),
            variant:offer_product_variants(
              id,name,short_description,description,benefits,offer_image_path,offer_image_alt
            )
          `)
          .eq('brochure_id', brochureId)
          .eq('is_visible', true)
          .order('display_order'),
        admin
          .from('my_companies')
          .select('id,name,legal_name,logo_url,email,phone,website')
          .eq('id', brochure.my_company_id)
          .maybeSingle(),
        brochure.organization_id
          ? admin
              .from('organizations')
              .select('id,name,email,website')
              .eq('id', brochure.organization_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        brochure.contact_employee_id
          ? admin
              .from('employees')
              .select('id,name,surname,email,phone_number,avatar_url')
              .eq('id', brochure.contact_employee_id)
              .maybeSingle()
          : Promise.resolve({ data: employee, error: null }),
        admin
          .from('company_brandbook_logos')
          .select('url,is_default,background,order_index')
          .eq('company_id', brochure.my_company_id)
          .order('is_default', { ascending: false })
          .order('order_index'),
        admin
          .from('company_brandbook_colors')
          .select('hex,role')
          .eq('company_id', brochure.my_company_id),
        admin
          .from('company_brandbook_fonts')
          .select('family,role,file_url,storage_path,order_index')
          .eq('company_id', brochure.my_company_id)
          .order('order_index'),
      ]);

    if (itemsResult.error) throw itemsResult.error;
    if (fontsResult.error) throw new Error('Nie udało się odczytać fontów działalności. Spróbuj ponownie.');
    if (companyResult.error || !companyResult.data) {
      throw companyResult.error || new Error('Broszura nie ma prawidłowej działalności');
    }

    const decorativePages = parseDecorativePages(brochure.brand_config?.decorative_pages).filter((page) => page.isVisible);
    const composer = parseComposer(brochure.brand_config?.composer);
    const references = brochurePageReferences((itemsResult.data || []).map((row: any) => ({
      id: row.id, title: row.custom_title || (row.variant?.name ? `${row.product?.name} — ${row.variant.name}` : row.product?.name) || 'Usługa',
    })), decorativePages, composer);
    const validationIssues = validateBrochureContent(decorativePages, references);
    const validationResponse = (issues: BrochureValidationIssue[]) => NextResponse.json({
      error: `Broszura wymaga sprawdzenia. Liczba problemów: ${issues.length}. Szczegóły i miejsca edycji są w raporcie. PDF nie został zapisany.`,
      issues,
    }, { status: 422 });
    const imageSources = new Map<string, BrochureImageSource>();
    type ImageResolution = { url: string; originalUrl: string } | { reason: 'missing' | 'access' | 'temporary' };
    const signingCache = new Map<string, Promise<ImageResolution>>();
    const signProductImage = async (path: string | null | undefined, requestedBucket: BrochureImageBucket | 'company-logos', pageKey: string, logo = false) => {
      let value = String(path || '').trim();
      if (!value) return null;
      let bucket: BrochureImageBucket | 'company-logos' = requestedBucket;
      // Refresh saved Storage URLs instead of reusing an expired signed link.
      // Resolve only known buckets on our own Storage host.
      if (/^https?:\/\//i.test(value)) {
        try {
          const url = new URL(value);
          const match = url.pathname.match(/^\/storage\/v1\/(?:object|render\/image)\/(?:sign|public)\/([^/]+)\/(.+)$/);
          if (url.origin === new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin && match
            && ['offer-product-pages', 'offer-template-pages', 'seller-brand-assets', 'company-logos'].includes(match[1])) {
            bucket = match[1] as typeof bucket;
            value = decodeURIComponent(match[2]);
          }
        } catch { /* The actual download reports malformed/unavailable URLs. */ }
      }
      const fileName = brochureFileName(value);
      if (/^https?:\/\//i.test(value) || value.startsWith('data:image/')) {
        imageSources.set(value, { originalUrl: value, fileName });
        return value;
      }
      const key = `${bucket}:${value}`;
      if (!signingCache.has(key)) {
        signingCache.set(key, (async (): Promise<ImageResolution> => {
          // Hotel materials retain their RLS, including when supplied as URLs.
          const storage = (bucket === 'seller-brand-assets' ? userClient : admin).storage.from(bucket);
          try {
            const original = await storage.createSignedUrl(value, 3600);
            if (original.error || !original.data?.signedUrl) {
              const code = original.error && 'statusCode' in original.error ? String(original.error.statusCode) : '';
              const message = original.error?.message || '';
              return { reason: code === '404' || /not found|does not exist/i.test(message) ? 'missing'
                : ['401', '403'].includes(code) || /permission|not authorized|row.level security|access denied/i.test(message) ? 'access' : 'temporary' };
            }
            // Logos (including SVG) do not need a raster transformation.
            if (logo) return { url: original.data.signedUrl, originalUrl: original.data.signedUrl };
            const transformed = await storage.createSignedUrl(value, 3600, {
              transform: { width: 1800, height: 2200, resize: 'contain', quality: 85 },
            }).catch(() => null);
            return { url: transformed?.data?.signedUrl || original.data.signedUrl, originalUrl: original.data.signedUrl };
          } catch { return { reason: 'temporary' }; }
        })());
      }
      const resolved = await signingCache.get(key)!;
      if ('url' in resolved) {
        imageSources.set(resolved.url, { originalUrl: resolved.originalUrl, fileName });
        return resolved.url;
      }
      const reference = references.find((entry) => entry.key === pageKey);
      validationIssues.push({
        id: logo ? 'brand:logo' : `${pageKey}:image`, pageKey,
        pageNumber: reference?.number || null, pageTitle: reference?.title || 'Cała broszura',
        field: logo ? 'logo' : 'imagePath', element: logo ? 'Logo marki' : 'Zdjęcie strony', fileName,
        ...(logo ? { companyId: brochure.my_company_id } : {}), reason: resolved.reason,
        message: resolved.reason === 'missing' ? 'Plik nie istnieje już w bibliotece.'
          : resolved.reason === 'access' ? 'Brak dostępu do pliku w bibliotece.' : 'Nie udało się uzyskać linku do pliku.',
        remedy: resolved.reason === 'temporary' ? 'Sprawdź ponownie za chwilę. Nie usuwaj zdjęcia — to może być chwilowy problem połączenia.'
          : resolved.reason === 'access' ? 'Sprawdź uprawnienia do materiałów organizacji. Ponowne wgranie pliku nie jest wymagane.'
            : logo ? 'W brandbooku marki wybierz aktualne logo.' : 'Otwórz wskazaną stronę i wybierz aktualne zdjęcie lub wgraj poprawny plik.',
      });
      return null;
    };

    const company = companyResult.data;
    const organization = organizationResult.data as any;
    const contact = (contactResult.data || employee) as any;
    const brandLogo = (logosResult.data || []).find((logo: any) => logo.is_default)
      || (logosResult.data || []).find((logo: any) => logo.background === 'transparent')
      || logosResult.data?.[0];
    const rawLogo = String(brandLogo?.url || company.logo_url || '').trim();
    if (logosResult.error) throw new BrochureRequestError('Nie udało się odczytać logo marki. Spróbuj ponownie za chwilę.', 503);
    const logoUrl = await signProductImage(rawLogo, 'company-logos', references[0]?.key || 'cover', true);
    const colors = (colorsResult.data || []) as Array<{ hex: string; role: string }>;
    const { primaryColor, secondaryColor } = brochurePalette(colors);
    const headingFont = (fontsResult.data || []).find((font) => font.role === 'heading' && (font.file_url || font.storage_path));
    const bodyFont = (fontsResult.data || []).find((font) => font.role === 'body');
    const bodyFontUrl = bodyFont?.file_url || (bodyFont?.storage_path ? admin.storage.from('company-logos').getPublicUrl(bodyFont.storage_path).data.publicUrl : /\bInter\b/i.test(bodyFont?.family || '') ? new URL('/fonts/Inter-Variable.ttf', request.url).href : null);
    const headingFontUrl = headingFont?.file_url || (headingFont?.storage_path ? admin.storage.from('company-logos').getPublicUrl(headingFont.storage_path).data.publicUrl : null);
    const snapshotDecorations = await Promise.all(decorativePages.map(async (page) => ({
      ...page, imageUrl: requiresPageImage(page.layout)
        ? await signProductImage(page.imagePath, page.imageBucket, `decorative:${page.id}`)
        : null,
    })));

    const snapshotItems = await Promise.all(
      (itemsResult.data || []).map(async (row: any) => {
        const product = row.product || {};
        const variant = row.variant || null;
        const benefits = resolvedBenefits(row.custom_benefits, variant?.benefits, product.offer_benefits);
        const imagePath = row.custom_image_path || variant?.offer_image_path || product.offer_image_path;
        const imageUrl = await signProductImage(imagePath, 'offer-product-pages', `product:${row.id}`);
        return {
          id: row.id,
          title: row.custom_title || (variant?.name ? `${product.name} — ${variant.name}` : product.name),
          shortDescription:
            row.custom_short_description || variant?.short_description || product.offer_short_description || null,
          description:
            row.custom_description || variant?.description || (row.page_layout === 'compact' ? product.offer_compact_description : null) || product.offer_description || product.description || null,
          benefits: asStringArray(benefits),
          imageUrl,
          layout: row.page_layout || 'visual',
          category: product.category?.name || null,
        };
      }),
    );

    if (!snapshotItems.length && !snapshotDecorations.length && composer.hiddenPages.length === 3) {
      return NextResponse.json(
        { error: 'Dodaj lub pokaż przynajmniej jedną stronę przed wygenerowaniem PDF' },
        { status: 400 },
      );
    }

    const coverImagePath = composer.coverImagePath || brochure.cover_image_path;
    const coverImageUrl = composer.hiddenPages.includes('cover') ? null : await signProductImage(coverImagePath, composer.coverImagePath ? composer.coverImageBucket : 'offer-product-pages', 'cover');

    const demoAttribution = !validateOnly && brochure.brand_config?.seller_demo_enabled === true
      ? { sourceId: crypto.randomUUID(), brochureId: brochure.id, employeeId: employee.id, recipientEmail, ...(campaignId ? { campaignId } : {}) } : undefined;
    let demoUrl: string | undefined;
    if (demoAttribution) {
      const token = sealDemoAttribution(demoAttribution);
      demoUrl = `https://mavinci.pl/demo-sprzedawcy/${brochure.id}?source=${encodeURIComponent(token)}`;
      for (const page of snapshotDecorations) {
        if (!page.linkUrl) continue;
        try {
          const url = new URL(page.linkUrl.replace(/\{\{broszura\}\}/g, brochure.id));
          if (url.hostname === 'mavinci.pl' && url.pathname.replace(/\/$/, '') === `/demo-sprzedawcy/${brochure.id}`) {
            url.searchParams.set('source', token); page.linkUrl = url.toString();
          }
        } catch { /* Unrelated custom links keep their existing behavior. */ }
      }
    }
    const snapshot: SalesBrochureSnapshot = {
      recipientEmail,
      recipient,
      demoAttribution,
      demoUrl,
      brochure: {
        id: brochure.id,
        name: brochure.name,
        title: brochure.title,
        subtitle: brochure.subtitle,
        introduction: brochure.introduction,
        closingText: brochure.closing_text,
        audienceType: brochure.audience_type,
      },
      company: {
        name: company.name,
        legalName: company.legal_name,
        logoUrl,
        email: company.email,
        phone: company.phone,
        website: company.website,
        primaryColor,
        secondaryColor,
        headingFontFamily: headingFont?.family || null,
        headingFontUrl,
        bodyFontFamily: bodyFont?.family || null,
        bodyFontUrl,
      },
      organization: organization
        ? { name: organization.name, email: organization.email, website: organization.website }
        : null,
      contact: contact
        ? {
            name: [contact.name, contact.surname].filter(Boolean).join(' ') || contact.email,
            email: contact.email,
            phone: contact.phone_number,
            avatarUrl: contact.avatar_url,
          }
        : null,
      coverImageUrl,
      composer,
      items: snapshotItems as SalesBrochureSnapshot['items'],
      decorativePages: snapshotDecorations,
      generatedAt: new Date().toISOString(),
    };

    const fontResults = await Promise.allSettled([
      loadPdfFont(headingFontUrl, headingFont?.family || 'Nagłówki'),
      loadPdfFont(bodyFontUrl, bodyFont?.family || 'Treść', Boolean(!bodyFont?.file_url && !bodyFont?.storage_path && /\bInter\b/i.test(bodyFont?.family || ''))),
    ]);
    fontResults.forEach((result, index) => {
      if (result.status !== 'rejected') return;
      validationIssues.push({
        id: `brand:font:${index}`, pageKey: 'cover', pageNumber: null, pageTitle: 'Cała broszura',
        field: 'font', element: index === 0 ? 'Czcionka nagłówków' : 'Czcionka treści',
        companyId: brochure.my_company_id, reason: 'font',
        message: 'Nie udało się pobrać poprawnego pliku czcionki.',
        remedy: 'Sprawdź ponownie za chwilę. Jeśli problem wraca, sprawdź plik TTF, OTF, WOFF lub WOFF2 w brandbooku marki.',
      });
    });
    if (validationIssues.length) return validationResponse(validationIssues);
    const embeddedHeadingFont = fontResults[0].status === 'fulfilled' ? fontResults[0].value : null;
    const embeddedBodyFont = fontResults[1].status === 'fulfilled' ? fontResults[1].value : null;
    // Keep the original source URLs in generation history; only the document
    // sent to Chromium contains the embedded font files.
    const renderSnapshot: SalesBrochureSnapshot = {
      ...snapshot,
      company: { ...snapshot.company, headingFontUrl: embeddedHeadingFont, bodyFontUrl: embeddedBodyFont },
    };

    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
    });
    const page = await browser.newPage();
    let assetIssues: BrochureValidationIssue[];
    try {
      assetIssues = await validatePdfAssets(page, buildSalesBrochureHtml(renderSnapshot), references,
        imageSources, brochure.my_company_id, Boolean(embeddedHeadingFont), Boolean(embeddedBodyFont));
    } catch {
      // A browser/renderer failure is not evidence that the user chose a bad file.
      // Do not expose Playwright errors containing signed asset URLs.
      throw new BrochureRequestError('Nie udało się zakończyć sprawdzania materiałów broszury. Spróbuj ponownie za chwilę. Nie zmieniaj zdjęć na podstawie tego komunikatu — problem dotyczy działania generatora.', 503);
    }
    if (assetIssues.length) return validationResponse(assetIssues);
    // Validate the actual composition after images and fonts settle; never publish clipped copy.
    const issues = await page.evaluate(() => {
      const errors: Array<{ pageKey: string; number: number }> = [];
      document.querySelectorAll<HTMLElement>('.page').forEach((sheet, index) => {
        const bounds = sheet.getBoundingClientRect();
        const footer = sheet.querySelector('footer')?.getBoundingClientRect();
        const bottom = footer?.top ?? bounds.bottom;
        const boxes = sheet.querySelectorAll<HTMLElement>('[data-fit-box], .service-body, .intro-copy, .promise-card, .closing-content, .cover-copy, .decorative-copy, .decorative-caption');
        let bad = false;
        boxes.forEach((box) => {
          const rect = box.getBoundingClientRect();
          if (rect.bottom > bottom - 5 || rect.top < bounds.top || rect.left < bounds.left || rect.right > bounds.right + 1
            || (box.hasAttribute('data-fit-box') && (box.scrollHeight > box.clientHeight + 2 || box.scrollWidth > box.clientWidth + 2))) bad = true;
        });
        const textBox = sheet.querySelector('.creative-text')?.getBoundingClientRect();
        const detailBox = sheet.querySelector('.creative-details')?.getBoundingClientRect();
        if (textBox && detailBox && textBox.left < detailBox.right && textBox.right > detailBox.left && textBox.top < detailBox.bottom && textBox.bottom > detailBox.top) bad = true;
        const metrics = sheet.querySelector('.metrics')?.getBoundingClientRect();
        const intro = sheet.querySelector('.intro-grid')?.getBoundingClientRect();
        if (metrics && intro && intro.bottom > metrics.top - 5) bad = true;
        if (bad) errors.push({ pageKey: sheet.dataset.pageKey || '', number: index + 1 });
      });
      return errors;
    });
    if (issues.length) return validationResponse(issues.map((issue) => ({
      id: `${issue.pageKey}:layout`, pageKey: issue.pageKey, pageNumber: issue.number,
      pageTitle: references.find((reference) => reference.key === issue.pageKey)?.title || 'Strona broszury',
      field: 'layout', element: 'Układ i długość tekstu', reason: 'layout',
      message: 'Treść wychodzi poza stronę lub nakłada się na inne elementy.',
      remedy: 'Otwórz tę stronę. Skróć tekst, zmniejsz hasło albo zmień rozmiar lub położenie pola w Studio stron.',
    })));
    if (validateOnly) return NextResponse.json({ ok: true, issues: [], pageCount: references.length });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });

    // Read the deployed bucket limit: environments may still have an older
    // migration. Do not upload an oversized PDF or create a history entry for it.
    const { data: pdfBucket, error: pdfBucketError } = await admin.storage.getBucket('generated-brochures');
    if (pdfBucketError || !pdfBucket) {
      throw new BrochureRequestError(
        `PDF ma ${formatPdfSize(pdf.byteLength)}, ale nie udało się odczytać limitu magazynu broszur. Spróbuj ponownie za chwilę. PDF nie został zapisany.`,
        503,
      );
    }
    const configuredLimit = pdfBucket.file_size_limit;
    const sizeLimit = typeof configuredLimit === 'number' && Number.isFinite(configuredLimit) && configuredLimit > 0
      ? Math.min(BROCHURE_PDF_SIZE_LIMIT, configuredLimit)
      : BROCHURE_PDF_SIZE_LIMIT;
    if (pdf.byteLength > sizeLimit) return pdfSizeLimitResponse(pdf.byteLength, sizeLimit);

    const fileName = recipient ? brochureClientPdfFileName(recipient) : `broszura-${slugify(brochure.name)}-${new Date()
      .toISOString()
      .slice(0, 10)}.pdf`;
    // Unikalny katalog zachowuje odrębne wersje bez identyfikatora w nazwie
    // pobieranego pliku. Klucz Storage jest ASCII, nazwa dla klienta zachowuje
    // polskie znaki i trafia również do załącznika e-mail.
    const storagePath = recipient
      ? `${brochure.id}/${crypto.randomUUID()}/${slugify(fileName.replace(/\.pdf$/i, ''))}.pdf`
      : `${brochure.id}/${crypto.randomUUID()}-${fileName}`;
    const upload = await admin.storage.from('generated-brochures').upload(storagePath, pdf, {
      contentType: 'application/pdf',
      upsert: false,
    });
    if (upload.error) {
      // A project-wide Storage limit can be lower than the bucket limit.
      // Explain that separately instead of incorrectly blaming image validation.
      const storageCode = String(upload.error.statusCode || '');
      if (upload.error.status === 413 || storageCode === '413' || storageCode === 'EntityTooLarge'
        || /exceeded the maximum allowed size|payload too large|entity too large/i.test(upload.error.message)) {
        return pdfSizeLimitResponse(pdf.byteLength, sizeLimit, true);
      }
      throw upload.error;
    }

    const { data: generation, error: generationError } = await admin.rpc(
      'record_sales_brochure_generation',
      {
        p_brochure_id: brochure.id,
        p_pdf_path: storagePath,
        p_file_name: fileName,
        p_file_size: pdf.byteLength,
        p_snapshot: snapshot,
        p_created_by: employee.id,
      },
    );
    if (generationError) {
      await admin.storage.from('generated-brochures').remove([storagePath]);
      throw generationError;
    }

    if (campaignId) {
      const { data: attached, error: attachError } = await userClient.from('mailing_campaigns')
        .update({ brochure_generation_id: generation.id }).eq('id',campaignId).eq('status','draft')
        .eq('brochure_generation_id',campaignGenerationId!).select('id').maybeSingle();
      if (attachError || !attached) throw new Error('PDF został zapisany, ale kampania zmieniła się w trakcie generowania. Otwórz kampanię i przygotuj jej PDF ponownie.');
    }
    const { data: signed } = await admin.storage
      .from('generated-brochures')
      .createSignedUrl(storagePath, 3600, { download: fileName });

    return NextResponse.json({
      ok: true,
      generation,
      storagePath,
      fileName,
      pageCount: references.length,
      downloadUrl: signed?.signedUrl || null,
    });
  } catch (error: any) {
    console.error('Sales brochure PDF error:', error);
    return NextResponse.json(
      { error: error?.message || 'Nie udało się wygenerować broszury' },
      { status: error instanceof BrochureRequestError ? error.status : 500 },
    );
  } finally {
    // Cleanup must not replace a successful result or hide the original error.
    if (browser) await browser.close().catch((error) => console.error('Brochure browser cleanup failed:', error));
  }
}
