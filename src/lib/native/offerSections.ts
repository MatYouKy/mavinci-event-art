import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NativeContext } from './auth';
import { fail } from './offers';
import {
  buildOfferRequirements,
  getOfferRequirementLabel,
  getOfferRequirementPriority,
  type OfferRequirementEntry,
} from '@/lib/CRM/Offers/offerRequirements';
import { summarizeLogisticsEstimate, type LogisticsEstimate } from '@/lib/CRM/Offers/logisticsEstimate';

/*
 * Oferty na Macu, część C1 — wymagania techniczne oferty (`OfferRequirementsEditor`: szablon kategorii, produkty, scalanie,
 * „Odśwież automatycznie”, własne wymagania) oraz pakiety oferty i logistyka (`OfferPackagesEditor`: do trzech alternatyw
 * z pozycji oferty, rabat pakietu, kolejność, rekomendacja; koszt logistyki ręczny albo z kalkulatora szacunkowego, dopłata
 * klienta). Zapis pakietów i logistyki jedną operacją `save_offer_packages_and_logistics` z kontrolą wersji treści.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: unknown, message = 'Nieprawidłowa oferta.') => {
  const id = String(value || '');
  if (!UUID.test(id)) fail(message);
  return id;
};
const text = (value: unknown) => (value == null ? '' : String(value));
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Odczyt dla każdego z dostępem do oferty; zmiany jak `canEditCrmContent` (zarządzający, nie zaakceptowana, nie sprzedawcy). */
async function access(ctx: NativeContext, id: string, select: string, edit: boolean) {
  const [{ data: allowed }, { data: offer, error }] = await Promise.all([
    ctx.supabase.rpc('sales_can_manage_offer', { p_offer: id }),
    ctx.supabase.from('offers').select(select).eq('id', id).maybeSingle(),
  ]);
  if (error || !offer) fail('Nie znaleziono oferty.');
  const row = offer as unknown as Row;
  const canEdit = allowed === true && row.status !== 'accepted' && row.sales_channel !== 'seller_portal';
  if (edit && !canEdit) {
    if (row.status === 'accepted') fail('Zaakceptowanej oferty nie można edytować.');
    if (row.sales_channel === 'seller_portal') fail('Ofertę z portalu sprzedawcy zmienia się w obsłudze oferty sprzedawcy.');
    fail('Nie masz uprawnień do zmiany tej oferty.');
  }
  return { offer: row, canEdit };
}

// MARK: Wymagania techniczne

const parseStored = (value: unknown): OfferRequirementEntry[] => {
  if (Array.isArray(value)) return value as OfferRequirementEntry[];
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
};

const REQUIREMENTS_SELECT = `id, status, sales_channel, offer_requirements,
  event:events!event_id(category:event_categories(default_offer_template_category_id)),
  offer_items(name, display_order, product:offer_products(name, offer_requirements, offer_additional_requirements))`;

const byOrder = (items: unknown) => [...((items || []) as Row[])].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

const view = (entry: OfferRequirementEntry) => ({ ...entry, label: getOfferRequirementLabel(entry.category) });

/** Wymagania jak przy otwarciu sekcji w CRM i wersja „Odśwież automatycznie” (bez zapisanych zmian). */
export async function offerRequirements(ctx: NativeContext, id: string) {
  const key = uuid(id);
  const { offer, canEdit } = await access(ctx, key, REQUIREMENTS_SELECT, false);
  const templateId = offer.event?.category?.default_offer_template_category_id || null;
  let query = ctx.supabase.from('offer_template_categories').select('id, design_config').limit(1);
  query = templateId ? query.eq('id', templateId) : query.eq('is_default', true);
  const { data } = await query.maybeSingle();
  const template = text((data as Row | null)?.design_config?.technical_requirements_text);
  const items = byOrder(offer.offer_items);
  const entries = buildOfferRequirements({
    templateRequirements: template, items: items as any, storedRequirements: parseStored(offer.offer_requirements),
    refreshAutomaticSources: offer.status === 'draft',
  });
  const automatic = buildOfferRequirements({ templateRequirements: template, items: items as any, storedRequirements: [] });
  return { canEdit, entries: entries.map(view), automatic: automatic.map(view) };
}

export async function saveOfferRequirements(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  await access(ctx, id, 'id, status, sales_channel', true);
  const input = (Array.isArray(body.entries) ? body.entries : []).slice(0, 200) as Row[];
  const keys = new Set<string>();
  const normalized: OfferRequirementEntry[] = [];
  for (const raw of input) {
    const key = text(raw.key).slice(0, 200);
    const description = text(raw.description).trim().slice(0, 2000);
    if (!key || keys.has(key) || !description) continue;
    keys.add(key);
    const category = text(raw.category) || 'other';
    normalized.push({
      key,
      category,
      title: text(raw.title).trim().slice(0, 200) || getOfferRequirementLabel(category),
      description,
      sources: (Array.isArray(raw.sources) ? raw.sources : []).map((source: unknown) => text(source).slice(0, 200)).filter(Boolean).slice(0, 20),
      origin: ['template', 'product', 'manual'].includes(raw.origin) ? raw.origin : 'manual',
      included: raw.included !== false,
      priority: getOfferRequirementPriority(category, description),
    });
  }
  const { data, error } = await ctx.supabase.from('offers').update({ offer_requirements: normalized }).eq('id', id).select('id').maybeSingle();
  if (error) fail(error.message || 'Nie udało się zapisać wymagań');
  if (!data) fail('Nie masz uprawnień do zmiany tej oferty.');
  return offerRequirements(ctx, id);
}

// MARK: Pakiety oferty i logistyka

const PACKAGES_SELECT = `id, status, sales_channel, content_revision, package_mode, logistics_cost_net, logistics_estimate, logistics_enabled,
  logistics_price_net, logistics_description, offer_items(id, display_order, product_id, product_variant_id, name, quantity, unit, unit_price, days, product:offer_products(id, name))`;

type Position = { id: string; product_id: string; product_variant_id: string | null; name: string; quantity: number; unit: string; unit_price: number; days: number };

const positionsOf = (offer: Row): Position[] => byOrder(offer.offer_items)
  .filter((item) => item.id && (item.product_id || item.product?.id))
  .map((item) => ({
    id: String(item.id), product_id: String(item.product_id || item.product.id), product_variant_id: item.product_variant_id || null,
    name: text(item.name || item.product?.name) || 'Pozycja oferty', quantity: Number(item.quantity || 1), unit: text(item.unit) || 'szt.',
    unit_price: Number(item.unit_price || 0), days: Number(item.days ?? 1),
  }));

const logisticsOf = (offer: Row) => ({
  estimate: offer.logistics_estimate ?? (offer.logistics_cost_net == null ? { version: 1, rows: [], reserve_percent: 0, notes: '' } : null),
  cost: Number(offer.logistics_cost_net ?? 0),
  price: Number(offer.logistics_price_net ?? 0),
  enabled: Boolean(offer.logistics_enabled),
  description: text(offer.logistics_description) || 'Transport, załadunek i obsługa logistyczna realizacji.',
});

export async function offerPackages(ctx: NativeContext, id: string) {
  const key = uuid(id);
  const { offer, canEdit } = await access(ctx, key, PACKAGES_SELECT, false);
  const { data, error } = await ctx.supabase.from('offer_packages')
    .select('id, name, description, price_net, list_price_net, discount_amount, discount_percent, is_recommended, items:offer_package_items(offer_item_id, product_id, product_variant_id, quantity, display_order)')
    .eq('offer_id', key).order('display_order');
  if (error) fail(error.message || 'Nie udało się wczytać pakietów i logistyki.');
  const positions = positionsOf(offer);
  const logistics = logisticsOf(offer);
  return {
    canEdit,
    enabled: offer.package_mode === true,
    revision: Number(offer.content_revision ?? 0),
    positions,
    logistics: { ...logistics, summary: logistics.estimate ? summarizeLogisticsEstimate(logistics.estimate) : null },
    packages: ((data || []) as Row[]).map((pkg) => ({
      id: String(pkg.id), name: text(pkg.name), description: text(pkg.description), price_net: Number(pkg.price_net) || 0,
      list_price_net: Number(pkg.list_price_net) || 0, discount_amount: Number(pkg.discount_amount) || 0,
      discount_percent: Number(pkg.discount_percent) || 0, is_recommended: pkg.is_recommended === true,
      items: [...(pkg.items || [])].sort((a: Row, b: Row) => (a.display_order ?? 0) - (b.display_order ?? 0)).map((item: Row) => ({
        offer_item_id: item.offer_item_id || positions.find((position) => position.product_id === item.product_id)?.id || '',
        product_id: String(item.product_id || ''), product_variant_id: item.product_variant_id || null, quantity: Number(item.quantity) || 1,
      })),
    })),
  };
}

const validMoney = (value: unknown) => {
  const number = Number(value);
  return value !== '' && value != null && Number.isFinite(number) && number >= 0 && number <= 99999999.99 && Math.abs(number * 100 - Math.round(number * 100)) < 0.00001;
};

/** Szacunek logistyki z Maca: wiersze kosztów i rezerwa (kalkulator trasy i cen paliwa — w CRM). */
function estimateOf(raw: unknown): LogisticsEstimate | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Row;
  const kinds = ['fuel', 'travel', 'meals', 'accommodation', 'other'];
  const number = (input: unknown) => (input === null || input === undefined || input === '' ? null : Number(input));
  return {
    version: 1,
    ...(value.route && typeof value.route === 'object' ? { route: value.route } : {}),
    rows: (Array.isArray(value.rows) ? value.rows : []).slice(0, 31).map((row: Row) => ({
      ...(row.fuel_estimate && typeof row.fuel_estimate === 'object' ? { fuel_estimate: row.fuel_estimate } : {}),
      ...(row.route && typeof row.route === 'object' ? { route: row.route } : {}),
      id: text(row.id).slice(0, 80) || randomUUID(),
      kind: kinds.includes(row.kind) ? row.kind : 'other',
      name: text(row.name).slice(0, 200),
      quantity: number(row.quantity), units: number(row.units), rate: number(row.rate),
      included_hours: number(row.included_hours), consumption: number(row.consumption),
    })),
    reserve_percent: number(value.reserve_percent),
    notes: text(value.notes).slice(0, 2100),
  } as LogisticsEstimate;
}

/**
 * Zapis jak `save` w `OfferPackagesEditor`: pakiety (cena przeliczona z pozycji oferty i rabatu), widoczność pakietów
 * i — opcjonalnie — logistyka. `packages: null` / `logistics: null` — bez zmian.
 */
export async function saveOfferPackages(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const { offer } = await access(ctx, id, PACKAGES_SELECT, true);
  const positions = positionsOf(offer);
  const revision = Number(body.revision);
  if (!Number.isInteger(revision)) fail('Odśwież ofertę przed zapisaniem.');

  let packages: Row[] | null = null;
  if (Array.isArray(body.packages)) {
    if (body.packages.length > 3) fail('Oferta może mieć maksymalnie trzy pakiety.');
    packages = (body.packages as Row[]).map((raw) => {
      const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 100).map((item: Row) => {
        const position = positions.find((source) => source.id === item.offer_item_id);
        if (!position) fail('Każdy pakiet musi mieć nazwę i co najmniej jedną dostępną pozycję tej oferty.');
        // Ilość i wariant zapisane w pakiecie zostają jak w CRM — zmianę wariantu pozycji zgłosi zapis w bazie.
        const quantity = Number(item.quantity);
        const variant = item.product_variant_id === undefined ? position.product_variant_id : (UUID.test(text(item.product_variant_id)) ? text(item.product_variant_id) : null);
        return {
          offer_item_id: position.id, product_id: position.product_id, product_variant_id: variant,
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : position.quantity,
        };
      });
      const name = text(raw.name).trim();
      if (!name || name.length > 120 || !items.length) fail('Każdy pakiet musi mieć nazwę i co najmniej jedną dostępną pozycję tej oferty.');
      const list = round(items.reduce((sum: number, item: Row) => {
        const position = positions.find((source) => source.id === item.offer_item_id)!;
        return sum + position.unit_price * position.days * item.quantity;
      }, 0));
      const discount = Math.min(list, Math.max(0, Number(raw.discount_amount) || 0));
      return {
        id: UUID.test(text(raw.id)) ? text(raw.id) : randomUUID(),
        name,
        description: text(raw.description).trim().slice(0, 1000),
        list_price_net: list,
        discount_amount: round(discount),
        discount_percent: list ? round(discount / list * 100) : 0,
        price_net: round(list - discount),
        is_recommended: raw.is_recommended === true,
        items,
      };
    });
    // Jeden pakiet rekomendowany (ostatnio oznaczony wygrywa jak w CRM).
    const recommended = packages.map((pkg) => pkg.is_recommended).lastIndexOf(true);
    packages = packages.map((pkg, index) => ({ ...pkg, is_recommended: index === recommended }));
  }

  let logistics: Row | null = null;
  if (body.logistics && typeof body.logistics === 'object') {
    const raw = body.logistics as Row;
    const estimate = estimateOf(raw.estimate);
    let cost: unknown = raw.cost;
    if (estimate) {
      const summary = summarizeLogisticsEstimate(estimate);
      if (summary.error || summary.total == null) fail(summary.error || 'Uzupełnij szacunek logistyki.');
      cost = summary.total;
    }
    if (!validMoney(cost) || !validMoney(raw.price)) {
      fail('Podaj nieujemny koszt i cenę z maksymalnie dwoma miejscami po przecinku. Wpisz 0, jeśli koszt nie występuje.');
    }
    logistics = {
      estimate, cost_net: Number(cost), price_net: Number(raw.price), enabled: raw.enabled === true,
      description: text(raw.description).trim().slice(0, 1000),
    };
  }

  const { error } = await ctx.supabase.rpc('save_offer_packages_and_logistics', {
    p_offer_id: id, p_revision: revision, p_packages: packages, p_enabled: body.enabled === true, p_logistics: logistics,
  });
  if (error) fail(error.message || 'Nie udało się zapisać zmian.');
  return offerPackages(ctx, id);
}
