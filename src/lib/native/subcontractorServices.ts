import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NativeContext } from './auth';
import { can } from './auth';
import { calculateSubcontractorSettlementCost, type SubcontractorSettlementMethod } from '@/lib/CRM/subcontractors/settlementCosts';

/*
 * Zakładka „Zakres i usługi” karty podwykonawcy (`SubcontractorServicesPanel`) i karta usługi
 * (`/crm/subcontractors/service/[id]`) dla Maca: typy usług (usługi, wynajem sprzętu, transport), katalogi pozycji,
 * dodawanie i usuwanie pozycji, edycja usługi z cennikiem, warunkami i galerią (`service-catalog-images`). Tokenem
 * pracownika — zapis rozstrzyga RLS jak w przeglądarce.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = 'service-catalog-images';
const TYPES = ['transport', 'services', 'rental'] as const;
type ServiceType = (typeof TYPES)[number];
const TABLES: Record<ServiceType, string> = {
  services: 'subcontractor_service_catalog',
  rental: 'subcontractor_rental_equipment',
  transport: 'subcontractor_transport_catalog',
};
const LABELS: Record<ServiceType, string> = { transport: 'Transport', services: 'Usługi', rental: 'Wynajem sprzętu' };
const METHODS: SubcontractorSettlementMethod[] = ['invoice', 'cash_documented', 'cash_non_deductible'];

export class SubcontractorServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new SubcontractorServiceError(message, status);
}
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Row[] : []);
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const num = (value: unknown, fallback = 0) => numOrNull(value) ?? fallback;
const idOf = (value: unknown) => {
  const id = str(value);
  if (!UUID.test(id)) fail('Nieprawidłowy rekord.');
  return id;
};
const typeOf = (value: unknown): ServiceType => {
  const type = str(value) as ServiceType;
  if (!TYPES.includes(type)) fail('Nieprawidłowy typ usługi.');
  return type;
};

/** `validateServiceTerms` (komponent CRM jest kliencki — ta sama reguła po stronie serwera). */
function validateServiceTerms(value: Row) {
  for (const key of ['included_hours', 'overtime_hourly_rate', 'travel_rate_per_km']) {
    const amount = value[key];
    if (amount != null && (!Number.isFinite(Number(amount)) || Number(amount) < 0)) {
      fail('Czas i stawki muszą być liczbami nieujemnymi.');
    }
  }
}

type Image = { url: string; title?: string; isPrimary?: boolean };
function imagesOf(value: unknown): Image[] {
  return rows(value).slice(0, 60).map((image) => ({
    url: str(image.url),
    ...(image.title !== undefined ? { title: str(image.title) } : {}),
    ...(image.isPrimary !== undefined ? { isPrimary: image.isPrimary === true } : {}),
  })).filter((image) => image.url.includes(`/${BUCKET}/`));
}

function itemOut(type: ServiceType, item: Row) {
  const category = Array.isArray(item.warehouse_categories) ? item.warehouse_categories[0] : item.warehouse_categories;
  return {
    id: str(item.id),
    type,
    name: str(item.name),
    description: str(item.description),
    category: str(category?.name) || str(item.category),
    thumbnailUrl: str(item.thumbnail_url) || null,
    isActive: item.is_active !== false,
    unit: str(item.unit),
    unitPrice: numOrNull(item.unit_price),
    priceNet: numOrNull(item.price_net),
    rentalPricePerDay: numOrNull(item.rental_price_per_day),
    settlementMethod: str(item.settlement_method),
    economicCost: numOrNull(item.economic_cost),
    includedHours: numOrNull(item.included_hours),
    overtimeHourlyRate: numOrNull(item.overtime_hourly_rate),
    travelRatePerKm: numOrNull(item.travel_rate_per_km),
    performanceRequirements: str(item.performance_requirements),
  };
}

/** Typy usług i katalogi podwykonawcy (jak `fetchServices` i `fetchCatalog` dla każdego typu). */
export async function subcontractorServices(ctx: NativeContext, idParam: unknown) {
  const id = idOf(idParam);
  const { data, error } = await ctx.supabase.from('subcontractor_services').select('*').eq('subcontractor_id', id).order('service_type');
  if (error) fail('Błąd podczas ładowania usług', 500);
  const services = rows(data).filter((row) => TYPES.includes(str(row.service_type) as ServiceType));
  const catalogs: Record<string, ReturnType<typeof itemOut>[]> = {};
  const errors: Record<string, string> = {};
  await Promise.all(services.map(async (service) => {
    const type = str(service.service_type) as ServiceType;
    const select = type === 'rental' ? '*, warehouse_categories(id, name, level, parent_id)' : '*';
    const { data: items, error: catalogError } = await ctx.supabase.from(TABLES[type]).select(select).eq('subcontractor_id', id).order('name');
    if (catalogError) errors[type] = `Błąd podczas ładowania katalogu ${LABELS[type]}`;
    catalogs[type] = rows(items).map((item) => itemOut(type, item));
  }));
  return {
    services: services.map((service) => ({
      id: str(service.id), type: str(service.service_type), isActive: service.is_active !== false, notes: str(service.notes),
    })),
    catalogs,
    catalogErrors: errors,
  };
}

/** „Dodaj typ usługi”. */
export async function addServiceType(ctx: NativeContext, body: Row) {
  const id = idOf(body.id);
  const type = typeOf(body.type);
  const { error } = await ctx.supabase.from('subcontractor_services').insert({
    subcontractor_id: id, service_type: type, is_active: true, notes: str(body.notes) || null,
  });
  if (error) fail('Błąd podczas dodawania usługi', error.code === '42501' ? 403 : 400);
  return { ok: true, message: 'Dodano typ usługi' };
}

/** „Aktywuj” / „Dezaktywuj”. */
export async function toggleServiceType(ctx: NativeContext, body: Row) {
  const serviceId = idOf(body.serviceId);
  const active = body.active === true;
  const { data, error } = await ctx.supabase.from('subcontractor_services').update({ is_active: active }).eq('id', serviceId).select('id');
  if (error) fail('Błąd podczas zmiany statusu usługi');
  if (!rows(data).length) fail('Nie masz uprawnień do zmiany usług podwykonawcy.', 403);
  return { ok: true, message: active ? 'Aktywowano usługę' : 'Dezaktywowano usługę' };
}

/** Usunięcie typu usługi. */
export async function removeServiceType(ctx: NativeContext, body: Row) {
  const serviceId = idOf(body.serviceId);
  const { data, error } = await ctx.supabase.from('subcontractor_services').delete().eq('id', serviceId).select('id');
  if (error) fail('Błąd podczas usuwania usługi');
  if (!rows(data).length) fail('Nie masz uprawnień do zmiany usług podwykonawcy.', 403);
  return { ok: true, message: 'Usunięto typ usługi' };
}

/** „Dodaj pozycję do katalogu” (`handleAddNewItem`) — te same pola i wyliczenia co w CRM. */
export async function addCatalogItem(ctx: NativeContext, body: Row) {
  const id = idOf(body.id);
  const type = typeOf(body.type);
  const item = body.item && typeof body.item === 'object' ? body.item as Row : {};
  const name = str(item.name);
  if (!name.trim()) fail('Podaj nazwę pozycji.');
  const insert: Row = { subcontractor_id: id, name, description: str(item.description) || null, is_active: true };
  const price = num(item.price);
  if (type === 'services') {
    const terms = {
      included_hours: numOrNull(item.includedHours),
      overtime_hourly_rate: numOrNull(item.overtimeHourlyRate),
      travel_rate_per_km: numOrNull(item.travelRatePerKm),
      performance_requirements: str(item.performanceRequirements),
    };
    validateServiceTerms(terms);
    if (!Number.isFinite(price) || price < 0) fail('Podaj poprawną nieujemną cenę usługi.');
    const method = (METHODS.includes(str(item.settlementMethod) as SubcontractorSettlementMethod) ? str(item.settlementMethod) : 'invoice') as SubcontractorSettlementMethod;
    const citRate = num(item.citRate, 9);
    const dividendTaxRate = num(item.dividendTaxRate, 19);
    const settlement = calculateSubcontractorSettlementCost({ contractorAmount: price, settlementMethod: method, citRate, dividendTaxRate });
    const images = imagesOf(item.images);
    Object.assign(insert, terms, {
      unit_price: price,
      unit: str(item.unit) === 'godz' ? 'godz' : 'realizacja',
      category: str(item.category) || null,
      vat_rate: num(item.vatRate, 23),
      price_net: num(item.priceNet),
      price_gross: num(item.priceGross),
      settlement_method: method,
      cash_payout_amount: method === 'invoice' ? null : price,
      cit_rate: citRate,
      dividend_tax_rate: dividendTaxRate,
      is_tax_deductible: method !== 'cash_non_deductible',
      economic_cost: settlement.economicCost,
      tax_burden_amount: settlement.taxBurden,
      images,
      thumbnail_url: images.find((image) => image.isPrimary)?.url || images[0]?.url || null,
    });
  } else if (type === 'rental') {
    const skills = str(item.requiredSkills);
    Object.assign(insert, {
      rental_price_per_day: price,
      weekly_rental_price: num(item.weeklyPrice) || null,
      monthly_rental_price: num(item.monthlyPrice) || null,
      quantity_available: Math.trunc(num(item.quantity, 1)),
      category: str(item.category) || null,
      vat_rate: num(item.vatRate, 23),
      daily_price_net: num(item.priceNet),
      daily_price_gross: num(item.priceGross),
      required_skills: skills ? skills.split(',').map((skill) => skill.trim()).filter(Boolean) : [],
    });
  }
  const { error } = await ctx.supabase.from(TABLES[type]).insert(insert).select().single();
  if (error) fail(error.message || 'Błąd podczas dodawania pozycji', error.code === '42501' ? 403 : 400);
  return { ok: true, message: 'Dodano pozycję do katalogu' };
}

/** Usunięcie pozycji katalogu. */
export async function deleteCatalogItem(ctx: NativeContext, body: Row) {
  const type = typeOf(body.type);
  const itemId = idOf(body.itemId);
  const { data, error } = await ctx.supabase.from(TABLES[type]).delete().eq('id', itemId).select('id');
  if (error) fail(error.message || 'Błąd podczas usuwania pozycji');
  if (!rows(data).length) fail('Nie masz uprawnień do usunięcia tej pozycji.', 403);
  return { ok: true, message: 'Usunięto pozycję z katalogu' };
}

/** Karta usługi (`getServiceCatalogDetails`) z prawem edycji jak na stronie CRM. */
export async function serviceDetails(ctx: NativeContext, idParam: unknown) {
  const id = idOf(idParam);
  const { data, error } = await ctx.supabase.from('subcontractor_service_catalog').select(`
    *,
    subcontractor:subcontractors(id, company_name, organization:organizations!subcontractors_organization_id_fkey(id, name, email, phone))
  `).eq('id', id).maybeSingle();
  if (error) fail('Nie znaleziono usługi', 500);
  if (!data) fail('Nie znaleziono usługi', 404);
  const row = data as Row;
  const sub = (Array.isArray(row.subcontractor) ? row.subcontractor[0] : row.subcontractor) as Row | null;
  const org = (sub && (Array.isArray(sub.organization) ? sub.organization[0] : sub.organization)) as Row | null;
  return {
    service: {
      id: str(row.id),
      name: str(row.name),
      description: str(row.description),
      category: str(row.category),
      unit: str(row.unit),
      isActive: row.is_active === true,
      unitPrice: numOrNull(row.unit_price),
      vatRate: numOrNull(row.vat_rate),
      priceNet: numOrNull(row.price_net),
      priceGross: numOrNull(row.price_gross),
      settlementMethod: str(row.settlement_method) || 'invoice',
      cashPayoutAmount: numOrNull(row.cash_payout_amount),
      citRate: numOrNull(row.cit_rate),
      dividendTaxRate: numOrNull(row.dividend_tax_rate),
      includedHours: numOrNull(row.included_hours),
      overtimeHourlyRate: numOrNull(row.overtime_hourly_rate),
      travelRatePerKm: numOrNull(row.travel_rate_per_km),
      performanceRequirements: str(row.performance_requirements),
      thumbnailUrl: str(row.thumbnail_url) || null,
      images: rows(row.images).map((image) => ({ url: str(image.url), title: str(image.title), isPrimary: image.isPrimary === true })),
    },
    subcontractor: sub ? {
      id: str(sub.id), name: str(sub.company_name),
      organization: org ? { name: str(org.name), email: str(org.email), phone: str(org.phone) } : null,
    } : null,
    canEdit: can(ctx.employee, 'contacts_manage') || ctx.employee.permissions.includes('equipment_manage'),
  };
}

/** Nazwa pliku w koszyku z adresu publicznego (jak `url.split('/service-catalog-images/').pop()`). */
const storageName = (url: string) => {
  const name = url.split(`/${BUCKET}/`).pop() || '';
  return url.includes(`/${BUCKET}/`) ? decodeURIComponent(name.split('?')[0]) : '';
};

/** „Zapisz” na karcie usługi (`handleSave`): te same pola i wyliczenia; zdjęcia usunięte w edycji — z koszyka po zapisie. */
export async function saveService(ctx: NativeContext, body: Row) {
  const id = idOf(body.id);
  const form = body.form && typeof body.form === 'object' ? body.form as Row : {};
  const terms = {
    included_hours: numOrNull(form.includedHours),
    overtime_hourly_rate: numOrNull(form.overtimeHourlyRate),
    travel_rate_per_km: numOrNull(form.travelRatePerKm),
  };
  validateServiceTerms(terms);
  const { data: current, error: currentError } = await ctx.supabase.from('subcontractor_service_catalog').select('images').eq('id', id).maybeSingle();
  if (currentError || !current) fail('Nie znaleziono usługi', 404);
  const method = (METHODS.includes(str(form.settlementMethod) as SubcontractorSettlementMethod) ? str(form.settlementMethod) : 'invoice') as SubcontractorSettlementMethod;
  const contractorAmount = method === 'invoice'
    ? Number(num(form.priceNet) || num(form.unitPrice) || 0)
    : Number(num(form.cashPayoutAmount) || num(form.unitPrice) || 0);
  const citRate = num(form.citRate, 9);
  const dividendTaxRate = num(form.dividendTaxRate, 19);
  const settlementCost = calculateSubcontractorSettlementCost({ contractorAmount, settlementMethod: method, citRate, dividendTaxRate });
  const images = imagesOf(form.images);
  const primary = images.find((image) => image.isPrimary);
  const { data, error } = await ctx.supabase.from('subcontractor_service_catalog').update({
    name: str(form.name),
    description: str(form.description) || null,
    category: str(form.category) || null,
    unit: str(form.unit),
    ...terms,
    performance_requirements: str(form.performanceRequirements) || null,
    unit_price: numOrNull(form.unitPrice),
    vat_rate: numOrNull(form.vatRate),
    price_net: numOrNull(form.priceNet),
    price_gross: numOrNull(form.priceGross),
    settlement_method: method,
    cash_payout_amount: method === 'invoice' ? null : contractorAmount,
    cit_rate: citRate,
    dividend_tax_rate: dividendTaxRate,
    is_tax_deductible: method !== 'cash_non_deductible',
    economic_cost: settlementCost.economicCost,
    tax_burden_amount: settlementCost.taxBurden,
    is_active: form.isActive === true,
    images,
    // Jak w CRM: miniatura z galerii, a bez zdjęć — wartość formularza (po usunięciu wszystkich zdjęć pusta).
    thumbnail_url: primary?.url || images[0]?.url || str(form.thumbnailUrl) || null,
  }).eq('id', id).select('id');
  if (error) fail(error.message || 'Błąd podczas zapisywania');
  if (!rows(data).length) fail('Nie masz uprawnień do zmiany tej usługi.', 403);
  // Zdjęcia usunięte w trakcie edycji (z folderu tej usługi) — dopiero po zapisie, żeby anulowanie edycji ich nie traciło.
  const kept = new Set(images.map((image) => image.url));
  const removed = rows((current as Row).images).map((image) => str(image.url))
    .filter((url) => url && !kept.has(url)).map(storageName).filter((name) => name.startsWith(`${id}/`));
  if (removed.length) await ctx.supabase.storage.from(BUCKET).remove(removed);
  return { ok: true, message: 'Zapisano zmiany' };
}

/** „Usuń” na karcie usługi. */
export async function deleteService(ctx: NativeContext, body: Row) {
  const id = idOf(body.id);
  const { data, error } = await ctx.supabase.from('subcontractor_service_catalog').delete().eq('id', id).select('id');
  if (error) fail(error.message || 'Błąd podczas usuwania');
  if (!rows(data).length) fail('Nie masz uprawnień do usunięcia tej usługi.', 403);
  return { ok: true, message: 'Usługa została usunięta' };
}

/** Folder zdjęć: usługa (`<id usługi>/…`) albo nowa pozycja (`temp-<znacznik>/…`), jak w CRM. */
function imageFolder(value: unknown) {
  const folder = str(value);
  if (UUID.test(folder) || /^temp-\d{10,16}$/.test(folder)) return folder;
  fail('Nieprawidłowy folder zdjęć.');
}

/** Zdjęcie usługi (multipart, pole „file”, JPEG po kompresji w aplikacji). */
export async function uploadServiceImage(ctx: NativeContext, folderParam: unknown, file: File) {
  const folder = imageFolder(folderParam);
  if (!(file.type || '').startsWith('image/')) fail(`${file.name} nie jest obrazem`);
  if (file.size > 10 * 1024 * 1024) fail(`${file.name} przekracza 10MB`);
  const path = `${folder}/${Date.now()}-${randomUUID().slice(0, 7)}.jpg`;
  const { error } = await ctx.supabase.storage.from(BUCKET).upload(path, new Uint8Array(await file.arrayBuffer()), {
    contentType: 'image/jpeg', upsert: false,
  });
  if (error) fail(`Błąd przesyłania ${file.name}: ${error.message || 'Nieznany błąd'}`);
  return { ok: true, url: ctx.supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
}

/** Usunięcie zdjęcia nowej pozycji przed jej zapisem (tylko z folderu `temp-…`, jak `handleRemoveNewImage`). */
export async function removeNewServiceImage(ctx: NativeContext, body: Row) {
  const name = storageName(str(body.url));
  if (!/^temp-\d{10,16}\//.test(name)) fail('Nieprawidłowe zdjęcie.');
  await ctx.supabase.storage.from(BUCKET).remove([name]);
  return { ok: true };
}
