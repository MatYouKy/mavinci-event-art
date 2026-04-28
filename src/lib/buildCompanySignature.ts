import { supabase } from '@/lib/supabase/browser';
import {
  DEFAULT_SIGNATURE_TEMPLATE,
  renderSignatureTemplate,
  SignaturePlaceholderValues,
} from '@/lib/signatureTemplate';

interface BuildOptions {
  companyId?: string | null;
  employeeId?: string | null;
}

interface BuildResult {
  html: string;
  enabled: boolean;
  companyId: string | null;
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

export async function buildCompanySignatureHtml(opts: BuildOptions = {}): Promise<BuildResult> {
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

  if (!company || !company.email_signature_use_template) {
    return { html: '', enabled: false, companyId: company?.id ?? null };
  }

  const template = company.email_signature_template || DEFAULT_SIGNATURE_TEMPLATE;

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
  const colorByRole = (role: string) => colors.find((c) => c.role === role)?.hex || '#d3bb73';

  const rawLogo = logos.find((l) => l.is_default)?.url || logos[0]?.url || company.logo_url || '';
  const companyLogo = await fetchAsDataUri(toPublicLogoUrl(rawLogo));

  const signatureThumb = employee?.signature_thumb
    ? await fetchAsDataUri(employee.signature_thumb)
    : employee?.avatar_url
    ? await fetchAsDataUri(employee.avatar_url)
    : '';

  const addressParts = [
    company.street,
    company.building_number,
    company.apartment_number ? `/${company.apartment_number}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const fullAddress = `${addressParts}, ${company.postal_code ?? ''} ${company.city ?? ''}`.trim();

  const values: SignaturePlaceholderValues = {
    full_name: employee ? `${employee.name ?? ''} ${employee.surname ?? ''}`.trim() : '',
    first_name: employee?.name ?? '',
    last_name: employee?.surname ?? '',
    position: employee?.occupation ?? '',
    phone: employee?.phone_number ?? '',
    email: employee?.email ?? '',
    website: company.website ?? '',
    signature_thumb: signatureThumb,
    company_name: company.name ?? '',
    company_legal_name: company.legal_name ?? '',
    company_address: fullAddress,
    company_nip: company.nip ?? '',
    company_regon: company.regon ?? '',
    company_krs: company.krs ?? '',
    company_logo: companyLogo,
    company_phone: company.phone ?? '',
    company_email: company.email ?? '',
    company_website: company.website ?? '',
    brand_primary_color: colorByRole('primary'),
    brand_secondary_color: colorByRole('secondary'),
    brand_accent_color: colorByRole('accent'),
  };

  return {
    html: renderSignatureTemplate(template, values),
    enabled: true,
    companyId: company.id,
  };
}
