import { nativeContext, nativeJson, nativeUnauthorized } from '@/lib/native/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Marka dla aplikacji na Maca — z brandbooka domyślnej firmy (Ustawienia → Moje firmy → Brandbook), jedynego źródła prawdy:
 * sygnet (logo w wariancie „icon”) i kolory (primary / secondary / accent). Aplikacja buduje z nich ikonę w Docku
 * i zapamiętuje je dla skryptu budowania (ikona pakietu). Odczyt tokenem pracownika (RLS).
 */
const publicLogoUrl = (value: string) =>
  /^https?:\/\//i.test(value) ? value : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${value.replace(/^\/+/, '')}`;
const hex = (value: unknown) => {
  const match = String(value || '').trim().match(/^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  return match ? `#${match[1].toLowerCase()}` : null;
};

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const { data: company } = await ctx.supabase.from('my_companies')
    .select('id, name').eq('is_default', true).eq('is_active', true).limit(1).maybeSingle();
  if (!company) return nativeJson({ error: 'Brak domyślnej firmy z brandbookiem.' }, 404);
  const [logos, colors] = await Promise.all([
    ctx.supabase.from('company_brandbook_logos').select('url, variant, label, order_index').eq('company_id', company.id).order('order_index'),
    ctx.supabase.from('company_brandbook_colors').select('hex, role, order_index').eq('company_id', company.id).order('order_index'),
  ]);
  const rows = logos.data || [];
  const sygnet = rows.find((logo) => logo.variant === 'icon') || rows.find((logo) => /sygnet|signature|icon/i.test(String(logo.label || '')));
  const byRole = (role: string) => hex((colors.data || []).find((color) => color.role === role)?.hex);
  return nativeJson({
    company: company.name,
    sygnet: sygnet?.url ? publicLogoUrl(sygnet.url) : null,
    colors: { primary: byRole('primary'), secondary: byRole('secondary'), accent: byRole('accent') },
  });
}
