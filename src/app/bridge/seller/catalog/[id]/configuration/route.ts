import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { sellerConfigurationCatalog, applySellerSelection } from '@/lib/seller/productConfiguration.server';
import { configurationPrice, validateConfiguration } from '@/lib/CRM/Offers/offerAddons';
import { calculateModular, modularScope, modularTitle } from '@/lib/CRM/Offers/modularProduct';
import { isSellerLedPackage, sellerLedPackageScope } from '@/lib/seller/ledPackage';
import { missingSellerConfigurationRate } from '@/lib/seller/productSelection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
const fail = (e: unknown) => json({ error: e instanceof Error ? e.message : 'Nie udało się odczytać konfiguracji.' }, 400);

async function authorize(request: NextRequest, product: string) {
  const company = request.nextUrl.searchParams.get('brand');
  const requestedPartner = request.nextUrl.searchParams.get('partner');
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !uuid(product) || !uuid(company) || (requestedPartner && !uuid(requestedPartner))) throw new Error('Zaloguj się ponownie i wybierz produkt oraz markę.');
  const admin = createSupabaseAdminClient();
  const auth = await admin.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
  const user = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: 'Bearer ' + token } }, auth: { persistSession: false, autoRefreshToken: false } });
  let partner: string;
  let basePrice = 0;
  if (requestedPartner) {
    // Use the existing CRM price-list permission gate before service-role access.
    const access = await user.rpc('get_sales_partner_price_list', { p_sales_partner_id: requestedPartner, p_company_id: company });
    if (access.error || !access.data) throw new Error('Nie masz uprawnień do cennika tego sprzedawcy.');
    partner = requestedPartner;
  } else {
    const context = await user.rpc('get_seller_portal_context');
    const catalog = await user.rpc('get_seller_portal_catalog', { p_company_id: company });
    const entry = Array.isArray(catalog.data) ? catalog.data.find((p: { id: string }) => p.id === product) : null;
    if (context.error || !uuid(context.data?.profile?.id) || catalog.error || !entry || entry.base_price == null) throw new Error('Ten produkt nie jest dostępny w Twoim cenniku. Poproś opiekuna o udostępnienie produktu podstawowego.');
    partner = context.data.profile.id;
    basePrice = Number(entry.base_price);
  }
  return { admin, partner, company, basePrice, crm: Boolean(requestedPartner) };
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const a = await authorize(request, params.id);
    return json(await sellerConfigurationCatalog(a.admin, a.partner, a.company, params.id, a.basePrice));
  } catch (e) { return fail(e); }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const a = await authorize(request, params.id);
    if (!a.crm) throw new Error('Stawki indywidualne ustala opiekun w CRM.');
    const body = await request.json();
    const catalog = await sellerConfigurationCatalog(a.admin, a.partner, a.company, params.id, 0);
    if (body.revision !== catalog.revision) throw new Error('Cennik lub konfiguracja zmieniły się. Wczytaj aktualne dane przed zapisem.');
    if (!Array.isArray(body.rates) || body.rates.length !== catalog.rates.length) throw new Error('Niekompletna lista stawek.');
    const seen = new Set<string>();
    const rows = body.rates.map((r: { key: string; price: number | null }) => {
      if (!catalog.rates.some(c => c.key === r.key) || seen.has(r.key) || (r.price !== null && (typeof r.price !== 'number' || !Number.isFinite(r.price) || r.price < 0 || r.price > 9999999 || Math.abs(r.price * 100 - Math.round(r.price * 100)) > .0001))) throw new Error('Podaj poprawne, nieujemne stawki z dwoma miejscami po przecinku lub pozostaw puste.');
      seen.add(r.key);
      return { sales_partner_id: a.partner, my_company_id: a.company, product_id: params.id, component_key: r.key, price_net: r.price };
    });
    if (rows.length) {
      const save = await a.admin.from('sales_partner_component_prices').upsert(rows, { onConflict: 'sales_partner_id,my_company_id,product_id,component_key' });
      if (save.error) throw new Error('Nie udało się zapisać indywidualnych stawek.');
    }
    return json({ saved: true });
  } catch (e) { return fail(e); }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const a = await authorize(request, params.id);
    if (a.crm) throw new Error('Ten zapis jest przeznaczony dla portalu sprzedawcy.');
    const raw = await request.text();
    if (raw.length > 100000) throw new Error('Konfiguracja jest zbyt duża.');
    const body = JSON.parse(raw);
    const catalog = await sellerConfigurationCatalog(a.admin, a.partner, a.company, params.id, a.basePrice);
    if (catalog.revision !== body.revision) throw new Error('Zmieniły się stawki lub składniki. Otwórz ponownie konfigurator i sprawdź nową wycenę.');
    if (catalog.rates.some(r => r.key === 'stage:deck' && r.price === null)) throw new Error('Opiekun musi uzupełnić Twoją cenę blatu. Brak ceny nie oznacza bezpłatnego produktu.');
    const configuration = applySellerSelection(catalog.configuration, body.configuration);
    const missing = missingSellerConfigurationRate(configuration, catalog.rates);
    if (missing) throw new Error(missing);
    if (configuration.modular) configuration.base_unit_price = calculateModular(configuration.modular).total;
    const error = validateConfiguration(configuration);
    if (error) throw new Error(error.replace('Uzupełnij stawkę:', 'Poproś opiekuna o wycenę:'));
    const price = configurationPrice(configuration);
    const name = configuration.modular ? modularTitle(configuration.modular) : catalog.name;
    const description = isSellerLedPackage(configuration) ? sellerLedPackageScope(configuration).join('\n') : configuration.modular ? modularScope(configuration.modular).join('\n') : configuration.addons.filter(a => a.enabled || a.quantity > 0).map(a => a.name).join('\n');
    const quote = await a.admin.from('seller_configuration_quotes').insert({ sales_partner_id: a.partner, my_company_id: a.company, product_id: params.id, configuration, price_net: price, name, description }).select('id').single();
    if (quote.error) throw new Error('Nie udało się zapisać wyceny. Nic nie zostało dodane do oferty.');
    return json({ id: quote.data.id, configuration, price, name, description });
  } catch (e) { return fail(e); }
}
