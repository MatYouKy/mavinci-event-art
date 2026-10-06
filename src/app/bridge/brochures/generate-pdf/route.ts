import { sealDemoAttribution } from '@/lib/seller/demoAttribution.server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { brochurePalette, parseDecorativePages, parseComposer, resolvedBenefits, brochurePageProblem, requiresPageImage, orderedBrochureKeys, type BrochureImageBucket } from '@/lib/brochures/decorativePages';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { loadPdfFont } from '@/lib/brochures/loadPdfFont.server';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { BrochureRequestError, requireBrochureEmployeeAccess } from '@/lib/brochures/access.server';
import {
  buildSalesBrochureHtml,
  SalesBrochureSnapshot,
} from '@/lib/brochures/buildSalesBrochureHtml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

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
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'broszura';

const asStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
};

export async function POST(request: Request) {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    const { brochureId, recipientEmail: rawRecipient, campaignId } = (await request.json()) as { brochureId?: string; recipientEmail?: unknown; campaignId?: string };
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
      if (!/^[0-9a-f-]{36}$/i.test(campaignId) || recipientEmail) return NextResponse.json({ error: 'Wersja kampanijna nie może mieć e-maila pojedynczego odbiorcy.' }, { status: 400 });
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

    const signProductImage = async (path: string | null | undefined, bucket: BrochureImageBucket, label: string) => {
      const value = String(path || '').trim();
      if (!value) return null;
      if (/^https?:\/\//i.test(value) || value.startsWith('data:image/')) return value;
      // Hotel materials retain their own RLS; never retry them as service_role.
      const storageClient = bucket === 'seller-brand-assets' ? userClient : admin;
      const transformed = await storageClient.storage.from(bucket).createSignedUrl(value, 3600, {
        transform: { width: 1800, height: 2200, resize: 'contain', quality: 85 },
      });
      if (!transformed.error && transformed.data?.signedUrl) return transformed.data.signedUrl;
      // Image transformation is optional; a valid original must still work.
      const original = await storageClient.storage.from(bucket).createSignedUrl(value, 3600);
      if (!original.error && original.data?.signedUrl) return original.data.signedUrl;
      const error = original.error || transformed.error;
      const code = error && 'statusCode' in error ? String(error.statusCode) : '';
      const message = error?.message || '';
      console.error('Brochure image unavailable:', { label, bucket, path: value, code, message });
      if (code === '404' || /not found|does not exist/i.test(message)) {
        throw new BrochureRequestError(`${label}: zapisane zdjęcie nie istnieje już w bibliotece. W Studio stron wybierz aktualne zdjęcie i zapisz broszurę. Brak pliku: ${value.split('/').pop()}.`, 422);
      }
      if (code === '403' || /permission|not authorized|row.level security|access denied/i.test(message)) {
        throw new BrochureRequestError(`${label}: brak dostępu do zdjęcia. Sprawdź uprawnienia do materiałów organizacji; ponowne wgranie pliku nie jest wymagane.`, 403);
      }
      throw new BrochureRequestError(`${label}: nie udało się uzyskać dostępu do zdjęcia. Spróbuj ponownie za chwilę; nie trzeba usuwać zdjęcia z broszury.`, 503);
    };

    const company = companyResult.data;
    const organization = organizationResult.data as any;
    const contact = (contactResult.data || employee) as any;
    const brandLogo = (logosResult.data || []).find((logo: any) => logo.is_default)
      || (logosResult.data || []).find((logo: any) => logo.background === 'transparent')
      || logosResult.data?.[0];
    const rawLogo = String(brandLogo?.url || company.logo_url || '').trim();
    const logoUrl = !rawLogo
      ? null
      : /^https?:\/\//i.test(rawLogo)
        ? rawLogo
        : admin.storage.from('company-logos').getPublicUrl(rawLogo).data.publicUrl;
    const colors = (colorsResult.data || []) as Array<{ hex: string; role: string }>;
    const { primaryColor, secondaryColor } = brochurePalette(colors);
    const headingFont = (fontsResult.data || []).find((font) => font.role === 'heading' && (font.file_url || font.storage_path));
    const bodyFont = (fontsResult.data || []).find((font) => font.role === 'body');
    const bodyFontUrl = bodyFont?.file_url || (bodyFont?.storage_path ? admin.storage.from('company-logos').getPublicUrl(bodyFont.storage_path).data.publicUrl : /\bInter\b/i.test(bodyFont?.family || '') ? new URL('/fonts/Inter-Variable.ttf', request.url).href : null);
    const headingFontUrl = headingFont?.file_url || (headingFont?.storage_path ? admin.storage.from('company-logos').getPublicUrl(headingFont.storage_path).data.publicUrl : null);
    const decorativePages = parseDecorativePages(brochure.brand_config?.decorative_pages).filter((page) => page.isVisible);
    const invalidPage = decorativePages.find((page) => brochurePageProblem(page));
    if (invalidPage) return NextResponse.json({ error: `${invalidPage.slogan || 'Strona'}: ${brochurePageProblem(invalidPage)}` }, { status: 400 });
    const composer = parseComposer(brochure.brand_config?.composer);
    const pageNumbers = new Map(orderedBrochureKeys(itemsResult.data || [], decorativePages, composer.pageOrder)
      .filter((key) => !composer.hiddenPages.includes(key)).map((key, index) => [key, index + 1]));
    const snapshotDecorations = await Promise.all(decorativePages.map(async (page) => ({
      ...page, imageUrl: requiresPageImage(page.layout)
        ? await signProductImage(page.imagePath, page.imageBucket, `Strona ${pageNumbers.get(`decorative:${page.id}`)} „${page.slogan || 'Grafika'}”`)
        : null,
    })));

    const snapshotItems = await Promise.all(
      (itemsResult.data || []).map(async (row: any) => {
        const product = row.product || {};
        const variant = row.variant || null;
        const benefits = resolvedBenefits(row.custom_benefits, variant?.benefits, product.offer_benefits);
        const imagePath = row.custom_image_path || variant?.offer_image_path || product.offer_image_path;
        const imageUrl = await signProductImage(imagePath, 'offer-product-pages', `Zdjęcie usługi „${product.name}”`);
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
    const coverImageUrl = composer.hiddenPages.includes('cover') ? null : await signProductImage(coverImagePath, composer.coverImagePath ? composer.coverImageBucket : 'offer-product-pages', 'Okładka broszury');

    const demoAttribution = brochure.brand_config?.seller_demo_enabled === true
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

    const [embeddedHeadingFont, embeddedBodyFont] = await Promise.all([
      loadPdfFont(headingFontUrl, headingFont?.family || 'Nagłówki'),
      loadPdfFont(bodyFontUrl, bodyFont?.family || 'Treść', Boolean(!bodyFont?.file_url && !bodyFont?.storage_path && /\bInter\b/i.test(bodyFont?.family || ''))),
    ]);
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
    // The document is ready independently of long-running image/network requests.
    await page.setContent(buildSalesBrochureHtml(renderSnapshot), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const assets = await page.evaluate(async ({ heading, body, timeoutMs }) => {
      const images = Array.from(document.images);
      const cleanups: Array<() => void> = [];
      const imageLoads = images.map((image) => new Promise<void>((resolve) => {
        if (image.complete) return resolve();
        const settled = () => {
          image.removeEventListener('load', settled);
          image.removeEventListener('error', settled);
          resolve();
        };
        image.addEventListener('load', settled, { once: true });
        image.addEventListener('error', settled, { once: true });
        cleanups.push(settled);
      }));
      let fontsReady = false;
      let fontFailed = false;
      const fontLoads = (async () => {
        try {
          const families = [heading ? 'BrochureBrandHeading' : '', body ? 'BrochureBrandBody' : ''].filter(Boolean);
          // Explicitly start font loading before waiting, including Polish glyphs.
          await Promise.all(families.map((family) => document.fonts.load(`16px "${family}"`, 'MAVINCI ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż')));
          await document.fonts.ready;
          fontsReady = true;
        } catch {
          fontFailed = true;
        }
      })();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        Promise.all([...imageLoads, fontLoads]).then(() => false),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), timeoutMs); }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
      cleanups.forEach((cleanup) => cleanup());
      const errors = new Set<string>();
      const sheets = Array.from(document.querySelectorAll('.page'));
      for (const image of images) {
        if (image.complete && image.naturalWidth > 0) continue;
        const sheet = image.closest('.page');
        const index = sheet ? sheets.indexOf(sheet) : -1;
        errors.add(`${index >= 0 ? `Strona ${index + 1}: ` : ''}nie udało się wczytać zdjęcia lub logo. Spróbuj ponownie; jeśli problem wraca, wybierz plik ponownie.`);
      }
      if (fontFailed || !fontsReady) errors.add('Generator nie mógł zastosować osadzonych fontów w dokumencie PDF. Plik nie został zapisany.');
      if (timedOut) errors.add('Pobieranie materiałów broszury przekroczyło 60 sekund. PDF nie został zapisany.');
      return { errors: Array.from(errors), timedOut };
    }, { heading: Boolean(headingFontUrl), body: Boolean(bodyFontUrl), timeoutMs: 60_000 });
    if (assets.errors.length) return NextResponse.json({ error: assets.errors.join('\n') }, { status: assets.timedOut ? 504 : 422 });
    // Validate the actual composition after images and fonts settle; never publish clipped copy.
    const issues = await page.evaluate(() => {
      const errors: string[] = [];
      document.querySelectorAll<HTMLElement>('.page').forEach((sheet, index) => {
        const label = `Strona ${index + 1}`;
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
        if (bad) errors.push(`${label}: treść nie mieści się w układzie. Skróć tekst, zmniejsz hasło lub powiększ/przesuń pole.`);
        if (Array.from(sheet.querySelectorAll('img')).some((image) => !image.complete || image.naturalWidth === 0)) errors.push(`${label}: nie udało się wczytać zdjęcia lub logo. Wybierz plik ponownie.`);
      });
      return errors;
    });
    if (issues.length) return NextResponse.json({ error: issues.join('\n') }, { status: 422 });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });

    const fileName = `broszura-${slugify(brochure.name)}-${new Date()
      .toISOString()
      .slice(0, 10)}.pdf`;
    const storagePath = `${brochure.id}/${crypto.randomUUID()}-${fileName}`;
    const upload = await admin.storage.from('generated-brochures').upload(storagePath, pdf, {
      contentType: 'application/pdf',
      upsert: false,
    });
    if (upload.error) throw upload.error;

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
      .createSignedUrl(storagePath, 3600);

    return NextResponse.json({
      ok: true,
      generation,
      storagePath,
      fileName,
      pageCount: snapshotItems.length + snapshotDecorations.length + 3 - composer.hiddenPages.length,
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
