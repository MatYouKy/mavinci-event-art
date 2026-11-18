import 'server-only';
import type { NativeContext } from './auth';
import { DEMO_SAMPLE_SERVICES } from '@/components/crm/sellers/demo/demoData';

/*
 * „Pokaż portal hotelowi” na Macu — dane trybu pokazowego jak `HotelPortalDemo` w CRM (`/crm/salespeople/demo`): prowadzący
 * (zalogowany pracownik), marki dostępne dla pracownika (`get_my_accessible_companies`, bez danych finansowych), katalog usług
 * widocznych w portalu (do 60, tylko odczyt; pusty — przykładowe usługi z `demoData.ts`) i nazwa hotelu (z adresu, organizacji
 * albo obecnej organizacji kontaktu). Żadnych zapisów — pokaz działa wyłącznie w aplikacji.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_BUCKET = 'offer-product-pages';
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

const productPath = (value: unknown) => str(value).trim().replace(/^\/+/, '').replace(new RegExp(`^(?:public/)?${PRODUCT_BUCKET}/`), '');

export async function sellerDemo(ctx: NativeContext, request: Request, query: URLSearchParams) {
  const [employeeResult, accessible] = await Promise.all([
    ctx.supabase.from('employees').select('name,surname,email,phone_number').eq('id', ctx.employee.id).maybeSingle(),
    ctx.supabase.rpc('get_my_accessible_companies'),
  ]);
  const employee = (employeeResult.data || {}) as Row;

  // Marki dostępne dla pracownika; bez funkcji — lista firm (jak w CRM).
  let companies: Row[] = [];
  let brandsError: string | null = null;
  if (!accessible.error) companies = (accessible.data || []) as Row[];
  else {
    const fallback = await ctx.supabase.from('my_companies').select('id,name,is_active').order('name');
    if (fallback.error) brandsError = fallback.error.message || 'Nie udało się wczytać marek.';
    else companies = (fallback.data || []) as Row[];
  }
  const logo = (value: unknown) => {
    const raw = str(value).trim();
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/')) return new URL(raw, request.url).toString();
    return null;
  };
  const brands = companies.filter((row) => row.is_active !== false).map((row) => ({ id: str(row.id), name: str(row.name), logoUrl: logo(row.logo_url) }));

  // Katalog usług — tylko odczyt, pozycje widoczne w portalu sprzedawcy.
  const products = await ctx.supabase.from('offer_products')
    .select('id,name,offer_short_description,description,price_net,unit,offer_image_path,category:event_categories(name)')
    .eq('is_active', true)
    .eq('partner_portal_visible', true)
    .order('display_order')
    .limit(60);
  const rows = (products.error ? [] : products.data || []) as Row[];
  const paths = Array.from(new Set(rows.map((row) => productPath(row.offer_image_path)).filter((path) => path && !/^https?:/i.test(path))));
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data } = await ctx.supabase.storage.from(PRODUCT_BUCKET).createSignedUrls(paths, 3600);
    ((data || []) as Row[]).forEach((item) => { if (item?.path && item?.signedUrl) signed.set(str(item.path), str(item.signedUrl)); });
  }
  const mapped = rows.map((row) => {
    const category = Array.isArray(row.category) ? row.category[0] : row.category;
    const description = str(row.offer_short_description || row.description).replace(/\s+/g, ' ').trim();
    const path = productPath(row.offer_image_path);
    return {
      id: str(row.id),
      name: str(row.name),
      description: description.length > 180 ? `${description.slice(0, 177)}…` : description,
      priceNet: row.price_net == null ? null : Number(row.price_net),
      unit: str(row.unit) || 'usługa',
      category: str(category?.name) || null,
      imagePath: path || null,
      imageUrl: !path ? null : /^https?:/i.test(path) ? path : signed.get(path) || null,
    };
  });
  const services = mapped.length ? mapped : DEMO_SAMPLE_SERVICES.map((service) => ({ ...service, imagePath: null }));

  // Nazwa hotelu: z adresu, organizacji albo obecnej organizacji kontaktu.
  let hotelName = str(query.get('hotel')).slice(0, 120);
  if (!hotelName) {
    let organizationId = UUID.test(str(query.get('organization'))) ? str(query.get('organization')) : '';
    const contactId = UUID.test(str(query.get('contact'))) ? str(query.get('contact')) : '';
    if (!organizationId && contactId) {
      const link = await ctx.supabase.from('contact_organizations').select('organization_id').eq('contact_id', contactId).eq('is_current', true).limit(1).maybeSingle();
      organizationId = str((link.data as Row | null)?.organization_id);
    }
    if (organizationId) {
      const { data } = await ctx.supabase.from('organizations').select('name,alias').eq('id', organizationId).maybeSingle();
      if (data) hotelName = str((data as Row).alias || (data as Row).name).slice(0, 120);
    }
  }

  return {
    presenter: {
      name: `${employee.name || ''} ${employee.surname || ''}`.trim(),
      email: str(employee.email),
      phone: str(employee.phone_number),
    },
    brands,
    brandsError,
    services,
    source: mapped.length ? 'catalog' : 'sample',
    hotelName,
  };
}
