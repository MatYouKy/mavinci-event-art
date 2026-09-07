import { supabase } from '@/lib/supabase/browser';
import {
  DEFAULT_SIGNATURE_TEMPLATE,
  normalizeSignatureHtml,
  renderSignatureTemplate,
  SignaturePlaceholderValues,
  stripUnavailableCompanyRegistryData,
} from '@/lib/signatureTemplate';
import {
  DEFAULT_EMAIL_BODY_TEMPLATE,
  EmailBodyPlaceholderValues,
  renderSafeEmailBodyTemplate,
} from '@/lib/emailBodyTemplate';

interface BuildOptions {
  companyId?: string | null;
  employeeId?: string | null;
  emailAccountId?: string | null;
}

interface BuildResult {
  html: string;
  enabled: boolean;
  companyId: string | null;
  companyName: string | null;
}

export type EmailTemplatePurpose = 'general' | 'offer' | 'invoice' | 'contract' | 'link';

interface BuildBodyOptions extends BuildOptions {
  content: string;
  contentIsHtml?: boolean;
  subject?: string;
  recipientName?: string;
  pdfLink?: string;
  signatureHtml?: string;
  purpose?: EmailTemplatePurpose;
}

interface BuildBodyResult {
  html: string;
  templateEnabled: boolean;
  companyId: string | null;
  signatureHtml: string;
}

const toPublicLogoUrl = (value: string | null | undefined): string => {
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  return `${base}/storage/v1/object/public/company-logos/${value.replace(/^\/+/, '')}`;
};

const fetchAsDataUri = async (url: string): Promise<string> => {
  if (!url || url.startsWith('data:')) return url;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return url;
    const blob = await resp.blob();
    const buffer = await blob.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
    );
    const mime = blob.type || 'image/png';
    return `data:${mime};base64,${base64}`;
  } catch {
    return url;
  }
};

const readImageDimension = (tag: string, dimension: 'width' | 'height'): number | null => {
  const attributeValue = tag.match(
    new RegExp(`\\s${dimension}\\s*=\\s*["']?(\\d+)["']?`, 'i'),
  )?.[1];
  const styleValue = tag.match(
    new RegExp(`style\\s*=\\s*["'][^"']*\\b${dimension}\\s*:\\s*(\\d+)px`, 'i'),
  )?.[1];
  const value = Number(attributeValue || styleValue || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const rasterizeEmbeddedImage = (
  source: string,
  displayedWidth: number | null,
  displayedHeight: number | null,
): Promise<string> =>
  new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(source);
      return;
    }

    const image = new window.Image();
    image.onload = () => {
      const naturalWidth = image.naturalWidth || displayedWidth || 120;
      const naturalHeight = image.naturalHeight || displayedHeight || 120;
      const ratio = naturalWidth / Math.max(1, naturalHeight);
      // Zachowujemy dwa piksele obrazu na jeden piksel CSS. Atrybuty width i
      // height w HTML nadal blokują rozmiar stopki, a wariant 2x zapobiega
      // rozmyciu zdjęcia i ikon na ekranach Retina/HiDPI.
      const density = 2;

      let targetWidth = displayedWidth ? displayedWidth * density : Math.min(naturalWidth, 320);
      let targetHeight = displayedHeight ? displayedHeight * density : Math.min(naturalHeight, 320);

      if (displayedWidth && !displayedHeight) targetHeight = Math.round(targetWidth / ratio);
      if (!displayedWidth && displayedHeight) targetWidth = Math.round(targetHeight * ratio);

      const maxDimension = 960;
      const scale = Math.min(1, maxDimension / Math.max(targetWidth, targetHeight));
      targetWidth = Math.max(1, Math.round(targetWidth * scale));
      targetHeight = Math.max(1, Math.round(targetHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(source);
        return;
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.clearRect(0, 0, targetWidth, targetHeight);
      const drawScale = Math.min(targetWidth / naturalWidth, targetHeight / naturalHeight);
      const drawWidth = Math.round(naturalWidth * drawScale);
      const drawHeight = Math.round(naturalHeight * drawScale);
      context.drawImage(
        image,
        Math.round((targetWidth - drawWidth) / 2),
        Math.round((targetHeight - drawHeight) / 2),
        drawWidth,
        drawHeight,
      );

      const optimized = canvas.toDataURL('image/png');
      const hasLockedDisplaySize = Boolean(displayedWidth || displayedHeight);
      resolve(
        hasLockedDisplaySize || optimized.length < source.length || /^data:image\/svg\+xml/i.test(source)
          ? optimized
          : source,
      );
    };
    image.onerror = () => resolve(source);
    image.src = source;
  });

/**
 * Stopki potrafią zawierać wielomegabajtowe zdjęcia oraz SVG zapisane jako
 * base64. Przed wysyłką rasteryzujemy SVG i zmniejszamy duże obrazy do
 * rozmiaru faktycznie używanego w stopce.
 */
export const optimizeEmbeddedEmailImages = async (html: string): Promise<string> => {
  if (!html || typeof window === 'undefined' || !/data:image\//i.test(html)) return html;

  const imageTags = html.match(/<img\b[^>]*>/gi) ?? [];
  const replacements = new Map<string, string>();

  await Promise.all(
    imageTags.map(async (tag) => {
      const source = tag.match(/\bsrc\s*=\s*["'](data:image\/[^"']+)["']/i)?.[1];
      if (!source || replacements.has(source)) return;

      const isSvg = /^data:image\/svg\+xml/i.test(source);
      const isOversized = source.length > 120_000;
      const displayedWidth = readImageDimension(tag, 'width');
      const displayedHeight = readImageDimension(tag, 'height');
      if (!isSvg && !isOversized && !displayedWidth && !displayedHeight) return;

      const optimized = await rasterizeEmbeddedImage(
        source,
        displayedWidth,
        displayedHeight,
      );
      if (optimized !== source) replacements.set(source, optimized);
    }),
  );

  let optimizedHtml = html;
  replacements.forEach((replacement, source) => {
    optimizedHtml = optimizedHtml.split(source).join(replacement);
  });
  return optimizedHtml;
};

interface CompanyContext {
  company: any;
  employee: any;
  emailAccount: any;
  employeeSignature: any;
  logos: Array<{ url: string; is_default: boolean }>;
  colors: Array<{ hex: string; role: string }>;
  companyLogoDataUri: string;
  signatureThumbDataUri: string;
}

const loadCompanyContext = async (opts: BuildOptions): Promise<CompanyContext | null> => {
  let employeeId = opts.employeeId ?? null;
  if (!employeeId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    employeeId = user?.id ?? null;
  }

  const employeeRes = employeeId
    ? await supabase
        .from('employees')
        .select('*')
        .or(`id.eq.${employeeId},auth_user_id.eq.${employeeId}`)
        .limit(1)
        .maybeSingle()
    : { data: null };
  const employee = employeeRes.data;

  const { data: emailAccount } = opts.emailAccountId
    ? await supabase
        .from('employee_email_accounts')
        .select('*')
        .eq('id', opts.emailAccountId)
        .maybeSingle()
    : { data: null };

  const employeeSignatureIds = Array.from(
    new Set([employee?.id, employeeId].filter(Boolean) as string[]),
  );
  const { data: employeeSignatures } = employeeSignatureIds.length
    ? await supabase
        .from('employee_signatures')
        .select('*')
        .in('employee_id', employeeSignatureIds)
        .limit(1)
    : { data: [] };
  const employeeSignature = employeeSignatures?.[0] ?? null;

  const resolvedCompanyId = opts.companyId || (emailAccount as any)?.my_company_id || null;
  let companyQuery = supabase
    .from('my_companies')
    .select('*')
    .eq('is_active', true)
    .order('is_default', { ascending: false });
  if (resolvedCompanyId) companyQuery = companyQuery.eq('id', resolvedCompanyId);

  const { data: companies } = await companyQuery;
  const accountEmail = String((emailAccount as any)?.email_address || '').trim().toLowerCase();
  const accountDomain = accountEmail.split('@')[1] || '';
  const company = resolvedCompanyId
    ? companies?.[0] ?? null
    : companies?.find((item) => String(item.email || '').trim().toLowerCase() === accountEmail) ||
      companies?.find(
        (item) =>
          accountDomain && String(item.email || '').trim().toLowerCase().split('@')[1] === accountDomain,
      ) ||
      companies?.[0] ||
      null;
  if (!company) return null;

  const [logosRes, colorsRes] = await Promise.all([
    supabase
      .from('company_brandbook_logos')
      .select('url,is_default,order_index')
      .eq('company_id', company.id)
      .order('order_index'),
    supabase
      .from('company_brandbook_colors')
      .select('hex,role')
      .eq('company_id', company.id),
  ]);

  const logos = (logosRes.data ?? []) as Array<{ url: string; is_default: boolean }>;
  const colors = (colorsRes.data ?? []) as Array<{ hex: string; role: string }>;

  const rawLogo = logos.find((l) => l.is_default)?.url || logos[0]?.url || company.logo_url || '';
  const companyLogoDataUri = await fetchAsDataUri(toPublicLogoUrl(rawLogo));

  const signatureThumbSource =
    employee?.signature_thumb || employeeSignature?.avatar_url || employee?.avatar_url || '';
  const signatureThumbDataUri = signatureThumbSource
    ? await fetchAsDataUri(signatureThumbSource)
    : '';

  return {
    company,
    employee,
    emailAccount,
    employeeSignature,
    logos,
    colors,
    companyLogoDataUri,
    signatureThumbDataUri,
  };
};

const buildLegacyEmployeeSignatureHtml = (ctx: CompanyContext): string => {
  const legacy = ctx.employeeSignature;
  if (!legacy) return '';
  if (legacy.use_custom_html && legacy.custom_html) return legacy.custom_html;

  const values = buildSignatureValues(ctx);
  return renderSignatureTemplate(DEFAULT_SIGNATURE_TEMPLATE, {
    ...values,
    full_name: legacy.full_name || values.full_name,
    position: legacy.position || values.position,
    phone: legacy.phone || values.phone,
    email: legacy.email || values.email,
    website: legacy.website || values.website,
  });
};

const buildSignatureValues = (ctx: CompanyContext): SignaturePlaceholderValues => {
  const {
    company,
    employee,
    emailAccount,
    colors,
    companyLogoDataUri,
    signatureThumbDataUri,
  } = ctx;
  const colorByRole = (role: string) => colors.find((c) => c.role === role)?.hex || '#d3bb73';
  const addressParts = [
    company.street,
    company.building_number,
    company.apartment_number ? `/${company.apartment_number}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const fullAddress = `${addressParts}, ${company.postal_code ?? ''} ${company.city ?? ''}`.trim();

  return {
    full_name: employee ? `${employee.name ?? ''} ${employee.surname ?? ''}`.trim() : '',
    first_name: employee?.name ?? '',
    last_name: employee?.surname ?? '',
    position: employee?.occupation ?? '',
    phone: employee?.phone_number ?? '',
    email: emailAccount?.email_address ?? employee?.email ?? '',
    website: company.website ?? '',
    signature_thumb: signatureThumbDataUri,
    company_name: company.name ?? '',
    company_legal_name: company.legal_name ?? '',
    company_address: fullAddress,
    company_nip: company.nip ?? '',
    company_regon: company.regon ?? '',
    company_krs: company.krs ?? '',
    company_logo: companyLogoDataUri,
    company_phone: company.phone ?? '',
    company_email: company.email ?? '',
    company_website: company.website ?? '',
    company_facebook_url: company.facebook_url ?? '',
    company_instagram_url: company.instagram_url ?? '',
    company_linkedin_url: company.linkedin_url ?? '',
    company_tiktok_url: company.tiktok_url ?? '',
    company_youtube_url: company.youtube_url ?? '',
    brand_primary_color: colorByRole('primary'),
    brand_secondary_color: colorByRole('secondary'),
    brand_accent_color: colorByRole('accent'),
  };
};

export async function buildCompanySignatureHtml(opts: BuildOptions = {}): Promise<BuildResult> {
  const ctx = await loadCompanyContext(opts);
  if (!ctx) {
    return {
      html: '',
      enabled: false,
      companyId: null,
      companyName: null,
    };
  }

  let html = '';
  if (ctx.company.email_signature_use_template) {
    const template = ctx.company.email_signature_template || DEFAULT_SIGNATURE_TEMPLATE;
    html = renderSignatureTemplate(template, buildSignatureValues(ctx));
  } else if (ctx.emailAccount?.signature) {
    html = normalizeSignatureHtml(ctx.emailAccount.signature);
  } else {
    html = buildLegacyEmployeeSignatureHtml(ctx);
  }
  html = stripUnavailableCompanyRegistryData(html, buildSignatureValues(ctx));
  html = await optimizeEmbeddedEmailImages(html);

  return {
    html,
    enabled: Boolean(html.trim()),
    companyId: ctx.company.id,
    companyName: ctx.company.name ?? null,
  };
}

export async function buildCompanyEmailBody(opts: BuildBodyOptions): Promise<BuildBodyResult> {
  const ctx = await loadCompanyContext(opts);
  const rawContentHtml = opts.contentIsHtml ? opts.content : opts.content.replace(/\n/g, '<br>');
  const contentHtml = `<div style="margin:0; padding:0; color:#1c1f33 !important; background-color:#ffffff !important; font-family:Arial, sans-serif; font-size:14px; line-height:1.6;">${rawContentHtml}</div>`;

  if (!ctx) {
    return {
      html: contentHtml,
      templateEnabled: false,
      companyId: null,
      signatureHtml: opts.signatureHtml ?? '',
    };
  }

  const colorByRole = (role: string) =>
    ctx.colors.find((c) => c.role === role)?.hex || '#d3bb73';

  let signatureHtml = opts.signatureHtml ?? '';
  if (!signatureHtml && ctx.company.email_signature_use_template) {
    const sigTemplate = ctx.company.email_signature_template || DEFAULT_SIGNATURE_TEMPLATE;
    signatureHtml = renderSignatureTemplate(sigTemplate, buildSignatureValues(ctx));
  } else if (!signatureHtml && ctx.emailAccount?.signature) {
    signatureHtml = ctx.emailAccount.signature;
  } else if (!signatureHtml) {
    signatureHtml = buildLegacyEmployeeSignatureHtml(ctx);
  }
  signatureHtml = stripUnavailableCompanyRegistryData(
    signatureHtml,
    buildSignatureValues(ctx),
  );
  signatureHtml = normalizeSignatureHtml(signatureHtml);
  signatureHtml = await optimizeEmbeddedEmailImages(signatureHtml);

  const values: EmailBodyPlaceholderValues = {
    content: contentHtml,
    subject: opts.subject ?? '',
    recipient_name: opts.recipientName ?? '',
    sender_name: ctx.employee
      ? `${ctx.employee.name ?? ''} ${ctx.employee.surname ?? ''}`.trim()
      : '',
    sender_email: ctx.employee?.email ?? '',
    company_logo: ctx.companyLogoDataUri,
    company_name: ctx.company.name ?? '',
    company_website: ctx.company.website ?? '',
    brand_primary_color: colorByRole('primary'),
    brand_secondary_color: colorByRole('secondary'),
    brand_accent_color: colorByRole('accent'),
    signature: signatureHtml,
    pdf_link: opts.pdfLink ?? '',
  };

  const purpose: EmailTemplatePurpose = opts.purpose ?? 'general';

  let assignedTemplateHtml: string | null = null;
  const { data: assignment } = await supabase
    .from('email_body_template_assignments')
    .select('template:email_body_templates(template_html, is_active)')
    .eq('company_id', ctx.company.id)
    .eq('purpose', purpose)
    .maybeSingle();

  const tmpl = (assignment as any)?.template;
  if (tmpl?.is_active && tmpl?.template_html) {
    assignedTemplateHtml = tmpl.template_html;
  }

  if (!assignedTemplateHtml && purpose !== 'general') {
    const { data: fallback } = await supabase
      .from('email_body_template_assignments')
      .select('template:email_body_templates(template_html, is_active)')
      .eq('company_id', ctx.company.id)
      .eq('purpose', 'general')
      .maybeSingle();
    const fb = (fallback as any)?.template;
    if (fb?.is_active && fb?.template_html) assignedTemplateHtml = fb.template_html;
  }

  if (!assignedTemplateHtml && ctx.company.email_body_use_template) {
    assignedTemplateHtml = ctx.company.email_body_template || null;
  }

  if (!assignedTemplateHtml) {
    const html = await optimizeEmbeddedEmailImages(
      `<div style="display:block; width:100%; max-width:none; margin:0; padding:0; box-sizing:border-box; font-family:Arial,sans-serif; color:#1c1f33; background-color:#ffffff;"><div style="margin:0; padding:0; white-space:pre-wrap; color:#1c1f33; background-color:#ffffff;">${contentHtml}</div>${opts.pdfLink ?? ''}${signatureHtml}</div>`,
    );
    return {
      html,
      templateEnabled: false,
      companyId: ctx.company.id,
      signatureHtml,
    };
  }

  const html = await optimizeEmbeddedEmailImages(
    renderSafeEmailBodyTemplate(assignedTemplateHtml, values),
  );
  return {
    html,
    templateEnabled: true,
    companyId: ctx.company.id,
    signatureHtml,
  };
}
