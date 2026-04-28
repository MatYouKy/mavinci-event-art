import { supabase } from '@/lib/supabase/browser';
import {
  DEFAULT_SIGNATURE_TEMPLATE,
  renderSignatureTemplate,
  SignaturePlaceholderValues,
} from '@/lib/signatureTemplate';
import {
  DEFAULT_EMAIL_BODY_TEMPLATE,
  EmailBodyPlaceholderValues,
  renderEmailBodyTemplate,
} from '@/lib/emailBodyTemplate';

interface BuildOptions {
  companyId?: string | null;
  employeeId?: string | null;
}

interface BuildResult {
  html: string;
  enabled: boolean;
  companyId: string | null;
}

interface BuildBodyOptions extends BuildOptions {
  content: string;
  subject?: string;
  recipientName?: string;
  pdfLink?: string;
  signatureHtml?: string;
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

interface CompanyContext {
  company: any;
  employee: any;
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
    ? await supabase.from('employees').select('*').eq('id', employeeId).maybeSingle()
    : { data: null };
  const employee = employeeRes.data;

  let companyQuery = supabase.from('my_companies').select('*').eq('is_active', true);
  if (opts.companyId) companyQuery = companyQuery.eq('id', opts.companyId);
  else companyQuery = companyQuery.order('is_default', { ascending: false });

  const { data: companies } = await companyQuery.limit(1);
  const company = companies?.[0] ?? null;
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

  const signatureThumbDataUri = employee?.signature_thumb
    ? await fetchAsDataUri(employee.signature_thumb)
    : employee?.avatar_url
    ? await fetchAsDataUri(employee.avatar_url)
    : '';

  return { company, employee, logos, colors, companyLogoDataUri, signatureThumbDataUri };
};

const buildSignatureValues = (ctx: CompanyContext): SignaturePlaceholderValues => {
  const { company, employee, colors, companyLogoDataUri, signatureThumbDataUri } = ctx;
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
    email: employee?.email ?? '',
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
    brand_primary_color: colorByRole('primary'),
    brand_secondary_color: colorByRole('secondary'),
    brand_accent_color: colorByRole('accent'),
  };
};

export async function buildCompanySignatureHtml(opts: BuildOptions = {}): Promise<BuildResult> {
  const ctx = await loadCompanyContext(opts);
  if (!ctx || !ctx.company.email_signature_use_template) {
    return { html: '', enabled: false, companyId: ctx?.company?.id ?? null };
  }
  const template = ctx.company.email_signature_template || DEFAULT_SIGNATURE_TEMPLATE;
  const values = buildSignatureValues(ctx);
  return {
    html: renderSignatureTemplate(template, values),
    enabled: true,
    companyId: ctx.company.id,
  };
}

export async function buildCompanyEmailBody(opts: BuildBodyOptions): Promise<BuildBodyResult> {
  const ctx = await loadCompanyContext(opts);
  const contentHtml = opts.content.replace(/\n/g, '<br>');

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
  }

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

  if (!ctx.company.email_body_use_template) {
    return {
      html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;"><div style="white-space: pre-wrap;">${contentHtml}</div>${opts.pdfLink ?? ''}${signatureHtml}</div>`,
      templateEnabled: false,
      companyId: ctx.company.id,
      signatureHtml,
    };
  }

  const template = ctx.company.email_body_template || DEFAULT_EMAIL_BODY_TEMPLATE;
  return {
    html: renderEmailBodyTemplate(template, values),
    templateEnabled: true,
    companyId: ctx.company.id,
    signatureHtml,
  };
}
