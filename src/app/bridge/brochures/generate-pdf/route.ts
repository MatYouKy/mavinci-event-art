import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import {
  buildSalesBrochureHtml,
  SalesBrochureSnapshot,
} from '@/lib/brochures/buildSalesBrochureHtml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    const { brochureId } = (await request.json()) as { brochureId?: string };
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

    const admin = getSupabaseAdmin();
    const { data: employee } = await admin
      .from('employees')
      .select('id,name,surname,email,phone_number,avatar_url,role,access_level,permissions')
      .or(`id.eq.${authData.user.id},auth_user_id.eq.${authData.user.id}`)
      .eq('is_active', true)
      .maybeSingle();
    if (!employee) {
      return NextResponse.json({ error: 'Nie znaleziono aktywnego pracownika' }, { status: 403 });
    }
    const canManage = employee.role === 'admin'
      || employee.access_level === 'admin'
      || (employee.permissions || []).includes('offers_manage');
    if (!canManage) {
      return NextResponse.json({ error: 'Brak uprawnień do generowania broszur' }, { status: 403 });
    }

    const { data: brochure, error: brochureError } = await admin
      .from('sales_brochures')
      .select('*')
      .eq('id', brochureId)
      .maybeSingle();
    if (brochureError || !brochure) {
      return NextResponse.json({ error: 'Nie znaleziono broszury' }, { status: 404 });
    }

    const [itemsResult, companyResult, organizationResult, contactResult, logosResult, colorsResult] =
      await Promise.all([
        admin
          .from('sales_brochure_items')
          .select(`
            *,
            product:offer_products(
              id,name,description,offer_short_description,offer_description,offer_benefits,
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
      ]);

    if (itemsResult.error) throw itemsResult.error;
    if (companyResult.error || !companyResult.data) {
      throw companyResult.error || new Error('Broszura nie ma prawidłowej działalności');
    }

    const signProductImage = async (path?: string | null) => {
      const value = String(path || '').trim();
      if (!value) return null;
      if (/^https?:\/\//i.test(value) || value.startsWith('data:image/')) return value;
      const { data } = await admin.storage.from('offer-product-pages').createSignedUrl(value, 3600, {
        transform: { width: 1800, resize: 'cover', quality: 85 },
      });
      return data?.signedUrl || null;
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
    const primaryColor = colors.find((color) => color.role === 'primary')?.hex || '#d3bb73';
    const secondaryColor = colors.find((color) => color.role === 'secondary')?.hex || '#650026';

    const snapshotItems = await Promise.all(
      (itemsResult.data || []).map(async (row: any) => {
        const product = row.product || {};
        const variant = row.variant || null;
        const benefits = row.custom_benefits ?? variant?.benefits ?? product.offer_benefits ?? [];
        const imagePath = row.custom_image_path || variant?.offer_image_path || product.offer_image_path;
        return {
          id: row.id,
          title: row.custom_title || (variant?.name ? `${product.name} — ${variant.name}` : product.name),
          shortDescription:
            row.custom_short_description || variant?.short_description || product.offer_short_description || null,
          description:
            row.custom_description || variant?.description || product.offer_description || product.description || null,
          benefits: asStringArray(benefits),
          imageUrl: await signProductImage(imagePath),
          layout: row.page_layout || 'visual',
          category: product.category?.name || null,
        };
      }),
    );

    if (!snapshotItems.length) {
      return NextResponse.json(
        { error: 'Dodaj przynajmniej jedną usługę przed wygenerowaniem PDF' },
        { status: 400 },
      );
    }

    const snapshot: SalesBrochureSnapshot = {
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
      coverImageUrl: await signProductImage(brochure.cover_image_path),
      items: snapshotItems as SalesBrochureSnapshot['items'],
      generatedAt: new Date().toISOString(),
    };

    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
    });
    const page = await browser.newPage();
    await page.setContent(buildSalesBrochureHtml(snapshot), { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      // @ts-ignore
      if (document.fonts?.ready) await document.fonts.ready;
      await Promise.all(
        Array.from(document.images).map(
          (image) =>
            new Promise<void>((resolve) => {
              if (image.complete) return resolve();
              image.onload = () => resolve();
              image.onerror = () => resolve();
            }),
        ),
      );
    });
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

    const { data: signed } = await admin.storage
      .from('generated-brochures')
      .createSignedUrl(storagePath, 3600);

    return NextResponse.json({
      ok: true,
      generation,
      storagePath,
      fileName,
      pageCount: snapshotItems.length + 3,
      downloadUrl: signed?.signedUrl || null,
    });
  } catch (error: any) {
    console.error('Sales brochure PDF error:', error);
    return NextResponse.json(
      { error: error?.message || 'Nie udało się wygenerować broszury' },
      { status: 500 },
    );
  } finally {
    if (browser) await browser.close();
  }
}
