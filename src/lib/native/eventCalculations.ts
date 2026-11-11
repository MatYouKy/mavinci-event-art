import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NativeContext } from './auth';
import { registerEventActions, registerEventQueries, registerEventTab } from './eventTabs';
import { getDrivingLeg } from '@/lib/CRM/events/travelDirections';
import { DEFAULT_TRAVEL_ORIGIN } from '@/lib/CRM/events/travelEstimate';
import { guessCategory } from '@/components/crm/events/calculations/calculations.utils';

/**
 * Zakładka „Kalkulacje” (`EventCalculationsTab` + `CalculationEditor` + `AddCalculationItemModal`): lista z sumą netto,
 * tworzenie, duplikowanie (`duplicate_sales_calculation`), akceptacja (źródło finansów), usuwanie, PDF; edytor z pozycjami
 * według kategorii (magazyn ze stanem, usługi personelu, pojazdy, ręczne), kolejność, zapis wszystkich pozycji jednym żądaniem.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = ['equipment', 'staff', 'transport', 'other'];
const SOURCES = ['manual', 'offer', 'warehouse', 'product', 'vehicle'];
const round2 = (n: number) => Math.round(n * 100) / 100;

function fail(message: string): never {
  throw new Error(message);
}

async function calculationsTab(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.from('event_calculations').select('*, event_calculation_items(quantity, unit_price, days)')
    .eq('event_id', eventId).order('created_at', { ascending: false });
  if (error) throw error;
  return {
    calculations: ((data || []) as Row[]).map((r) => {
      const items = (r.event_calculation_items || []) as Row[];
      return {
        id: r.id, name: r.name || '', notes: r.notes ?? null, createdAt: r.created_at, updatedAt: r.updated_at, itemsCount: items.length,
        total: round2(items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.unit_price || 0) * Number(it.days || 1), 0)),
        pdf: r.generated_pdf_path ?? null, accepted: r.is_accepted === true,
      };
    }),
  };
}

registerEventTab('calculations', calculationsTab);

async function ownCalculation(ctx: NativeContext, eventId: string, id: string) {
  if (!UUID.test(id)) fail('Nieprawidłowa kalkulacja.');
  const { data } = await ctx.supabase.from('event_calculations').select('*').eq('id', id).eq('event_id', eventId).maybeSingle();
  if (!data) fail('Nie znaleziono kalkulacji.');
  return data as Row;
}

/** `load` z `CalculationEditor`: pozycje z miniaturą, stanem i wagą sprzętu oraz nazwą pojazdu. */
async function editor(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const calc = await ownCalculation(ctx, eventId, params.get('calculationId') || '');
  const s = ctx.supabase;
  const { data: rows, error } = await s.from('event_calculation_items').select('*').eq('calculation_id', calc.id).order('category').order('position').order('id');
  if (error) throw error;
  const items = (rows || []) as Row[];
  const equipmentIds = items.filter((r) => r.source === 'warehouse' && r.source_ref).map((r) => r.source_ref as string);
  const equipment: Record<string, { thumbnail: string | null; stock: number; weight: number | null }> = {};
  if (equipmentIds.length) {
    const { data: eq } = await s.from('equipment_items').select('id, thumbnail_url, cable_stock_quantity, weight_kg').in('id', equipmentIds);
    const unitIds = ((eq || []) as Row[]).filter((e) => Number(e.cable_stock_quantity ?? 0) <= 0).map((e) => e.id);
    const counts: Record<string, number> = {};
    if (unitIds.length) {
      const { data: units } = await s.from('equipment_units').select('equipment_id').in('equipment_id', unitIds).eq('status', 'available');
      for (const unit of (units || []) as Row[]) counts[unit.equipment_id] = (counts[unit.equipment_id] || 0) + 1;
    }
    for (const e of (eq || []) as Row[]) {
      const simple = Number(e.cable_stock_quantity ?? 0);
      equipment[e.id] = { thumbnail: e.thumbnail_url ?? null, stock: simple > 0 ? simple : counts[e.id] ?? 0, weight: e.weight_kg != null ? Number(e.weight_kg) : null };
    }
  }
  const vehicleIds = [...new Set(items.filter((r) => r.source === 'vehicle' && r.source_ref).map((r) => r.source_ref as string))];
  const vehicles = new Map<string, string>();
  if (vehicleIds.length) {
    const { data } = await s.from('vehicles').select('id,name,registration_number').in('id', vehicleIds);
    for (const v of (data || []) as Row[]) vehicles.set(v.id, [v.name, v.registration_number].filter(Boolean).join(' · '));
  }
  return {
    id: calc.id, name: calc.name || '', notes: calc.notes || '', pdf: calc.generated_pdf_path ?? null, createdAt: calc.created_at,
    pdfCurrent: Boolean(calc.generated_pdf_path) && calc.generated_pdf_revision === calc.content_revision, revision: Number(calc.content_revision ?? 0),
    items: items.map((r) => {
      const info = r.source_ref ? equipment[r.source_ref] : undefined;
      return {
        id: r.id, category: CATEGORIES.includes(r.category) ? r.category : 'other', name: r.name || '', description: r.description || '', unit: r.unit || 'szt.',
        quantity: Number(r.quantity || 0), unitPrice: Number(r.unit_price || 0), days: Number(r.days || 1), source: r.source || 'manual', sourceRef: r.source_ref ?? null,
        sourceLabel: r.source === 'vehicle' ? vehicles.get(r.source_ref) || 'Pojazd z bazy' : null, position: Number(r.position || 0),
        vat: r.vat_rate != null ? Number(r.vat_rate) : 23, power: r.power_watts != null ? Number(r.power_watts) : null,
        weight: r.weight_kg != null ? Number(r.weight_kg) : info?.weight ?? null, thumbnail: info?.thumbnail ?? null, stock: info?.stock ?? null,
        transportEstimate: r.transport_estimate ?? null,
      };
    }),
  };
}

const watts = (value: unknown) => (value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null);

/** Katalogi formularza pozycji: sprzęt (aktywny, ze stanem dostępnym), usługi personelu, pojazdy. */
async function catalog(ctx: NativeContext, _eventId: string, params: URLSearchParams) {
  const s = ctx.supabase;
  const kind = params.get('kind');
  if (kind === 'equipment') {
    const { data, error } = await s.from('equipment_items')
      .select('id,name,brand,model,thumbnail_url,rental_price_per_day,power_specs,weight_kg,cable_stock_quantity,warehouse_categories:warehouse_category_id(id,name,special_properties)')
      .eq('is_active', true).is('deleted_at', null).order('name');
    if (error) throw error;
    const simple = (row: Row) => (row.warehouse_categories?.special_properties || []).some((p: Row) => p.name === 'uses_simple_quantity' && p.value === true);
    const unitIds = ((data || []) as Row[]).filter((d) => !simple(d)).map((d) => d.id);
    const counts: Record<string, number> = {};
    for (let i = 0; i < unitIds.length; i += 300) {
      const { data: units } = await s.from('equipment_units').select('equipment_id').in('equipment_id', unitIds.slice(i, i + 300)).eq('status', 'available');
      for (const unit of (units || []) as Row[]) counts[unit.equipment_id] = (counts[unit.equipment_id] || 0) + 1;
    }
    return {
      options: ((data || []) as Row[]).map((d) => ({
        id: d.id, label: [d.brand, d.model, d.name].filter(Boolean).join(' ') || d.name, name: [d.brand, d.model, d.name].filter(Boolean).join(' ') || d.name,
        title: d.name || '', subtitle: [d.brand, d.model].filter(Boolean).join(' '),
        detail: d.warehouse_categories?.name ?? null, price: Number(d.rental_price_per_day ?? 0), unit: 'szt.', vat: 23, thumbnail: d.thumbnail_url ?? null,
        stock: simple(d) ? Number(d.cable_stock_quantity ?? 0) : counts[d.id] ?? 0, power: watts(d.power_specs?.power_watts),
        weight: d.weight_kg != null ? Number(d.weight_kg) : null, description: '', minimum: null, people: null, fuelType: null,
      })),
    };
  }
  if (kind !== 'product' && kind !== 'vehicle') fail('Nieznany katalog.');
  // Jak `AddCalculationItemModal`: strony po 500, sortowanie po etykiecie (pl).
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = kind === 'product'
      ? await s.from('offer_products').select('id,name,description,price_net,base_price,unit,vat_rate,min_quantity,offer_image_path,offer_product_staff(quantity,product_variant_id,is_optional)')
        .eq('is_active', true).eq('is_personnel_service', true).order('id').range(offset, offset + 499)
      : await s.from('vehicles').select('id,name,brand,model,registration_number,category,status,fuel_type').not('status', 'in', '(sold,scrapped,inactive)').order('id').range(offset, offset + 499);
    if (result.error) fail('Nie udało się pobrać katalogu. Zamknij formularz i spróbuj ponownie.');
    rows.push(...((result.data || []) as Row[]));
    if ((result.data || []).length < 500) break;
  }
  const thumbnails = new Map<string, string>();
  const paths = kind === 'product' ? rows.map((r) => r.offer_image_path).filter(Boolean) as string[] : [];
  if (paths.length) {
    const { data } = await s.storage.from('offer-product-pages').createSignedUrls(paths, 3600);
    for (const entry of data || []) if (entry.path && entry.signedUrl) thumbnails.set(entry.path, entry.signedUrl);
  }
  const options = rows.map((r) => {
    if (kind === 'product') {
      const staff = ((r.offer_product_staff || []) as Row[]).filter((p) => !p.product_variant_id && !p.is_optional);
      return {
        id: r.id, label: r.name || '', name: r.name || '', title: r.name || '', subtitle: '', detail: null, price: Number(r.price_net ?? r.base_price ?? 0),
        unit: r.unit || 'h', vat: Number(r.vat_rate ?? 23), thumbnail: r.offer_image_path ? thumbnails.get(r.offer_image_path) ?? null : null, stock: null,
        power: null, weight: null, description: r.description || '', minimum: Number(r.min_quantity) > 0 ? Number(r.min_quantity) : 1,
        people: staff.length ? staff.reduce((sum, p) => sum + Number(p.quantity || 0), 0) : null, fuelType: null,
      };
    }
    const label = [r.name || [r.brand, r.model].filter(Boolean).join(' '), r.registration_number].filter(Boolean).join(' · ');
    return {
      id: r.id, label, name: ['personal_car', 'bus', 'motorcycle'].includes(r.category) ? 'Transport osobowy' : 'Transport ciężarowy', title: label, subtitle: '',
      detail: null, price: 0, unit: 'auto', vat: 23, thumbnail: null, stock: null, power: null, weight: null, description: '', minimum: null, people: null,
      fuelType: r.fuel_type ?? null,
    };
  });
  return { options: options.sort((a, b) => a.label.localeCompare(b.label, 'pl')) };
}

type Destination = { target: string; label: string; locationId: string | null; source: string };

/** Miejsce realizacji jak `/bridge/calculations/travel-estimate`: lokalizacja wydarzenia, potem z zapytania. */
async function suggestedDestination(ctx: NativeContext, eventId: string, calc: Row): Promise<Destination | null> {
  const s = ctx.supabase;
  const readLocation = async (id: unknown, source: string): Promise<Destination | null> => {
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    const { data, error } = await s.from('locations').select('id,name,formatted_address,address,city,postal_code,google_place_id,latitude,longitude').eq('id', id).maybeSingle();
    if (error || !data) return null;
    const l = data as Row;
    const address = l.formatted_address || [l.address, l.postal_code, l.city].filter(Boolean).join(', ');
    const target = l.google_place_id ? `place_id:${l.google_place_id}` : l.latitude != null && l.longitude != null ? `${l.latitude},${l.longitude}` : address;
    return target ? { target, label: [l.name, address].filter(Boolean).join(' — '), locationId: l.id, source } : null;
  };
  let destination: Destination | null = null;
  const event = await s.from('events').select('location_id,location').eq('id', eventId).maybeSingle();
  if (event.error) fail('Nie udało się odczytać miejsca wydarzenia. Możesz wpisać adres ręcznie.');
  if (event.data) {
    const e = event.data as Row;
    destination = await readLocation(e.location_id, 'event');
    if (!destination && typeof e.location === 'string' && e.location.trim()) destination = { target: e.location.trim(), label: e.location.trim(), locationId: null, source: 'event' };
  }
  if (!destination && calc.inquiry_id) {
    const inquiry = await s.from('tasks').select('inquiry_details').eq('id', calc.inquiry_id).eq('is_inquiry', true).maybeSingle();
    if (inquiry.error) fail('Nie udało się odczytać miejsca z zapytania. Możesz wpisać adres ręcznie.');
    const details = (inquiry.data as Row | null)?.inquiry_details;
    if (details) {
      destination = await readLocation(details.location_id, 'inquiry');
      if (!destination && typeof details.location_text === 'string' && details.location_text.trim()) {
        destination = { target: details.location_text.trim(), label: details.location_text.trim(), locationId: null, source: 'inquiry' };
      }
    }
  }
  return destination;
}

const safeTravelError = (error: unknown) =>
  error instanceof Error && /^(Google Maps|Nie udało się|Zestawienie cen|Brak aktualnych)/.test(error.message)
    ? error.message : 'Nie udało się pobrać danych trasy. Spróbuj ponownie lub wpisz wartości ręcznie.';

/** `CalculationVehicleTravel`: `action=destination` (podpowiedź celu) albo `action=route` (Google Maps, ręczny cel opcjonalny). */
async function travel(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const calc = await ownCalculation(ctx, eventId, params.get('calculationId') || '');
  if (params.get('action') === 'destination') {
    const destination = await suggestedDestination(ctx, eventId, calc);
    return { origin: DEFAULT_TRAVEL_ORIGIN, destination: destination ? { label: destination.label, locationId: destination.locationId, source: destination.source } : null };
  }
  const manual = params.get('destination');
  let destination: Destination | null;
  if (manual !== null) {
    if (manual.length > 500) fail('Podaj adres docelowy (maks. 500 znaków).');
    if (!manual.trim()) fail('Wpisz miejsce docelowe.');
    destination = { target: manual.trim(), label: manual.trim(), locationId: null, source: 'manual' };
  } else {
    destination = await suggestedDestination(ctx, eventId, calc);
  }
  if (!destination) fail('Brak lokalizacji w zapytaniu lub wydarzeniu. Wpisz miejsce docelowe.');
  const origin = (params.get('origin') || '').trim();
  const roundTrip = params.get('roundTrip') === '1';
  if (!origin || origin.length > 500) fail('Podaj adres startu i wybierz kierunek przejazdu.');
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) fail('Brak klucza Google Maps w konfiguracji serwera.');
  try {
    const [outbound, inbound] = await Promise.all([getDrivingLeg(origin, destination.target, key), roundTrip ? getDrivingLeg(destination.target, origin, key) : Promise.resolve(null)]);
    return {
      outbound, inbound, distanceKm: Math.round((outbound.distanceMeters + (inbound?.distanceMeters || 0)) / 100) / 10,
      travelMinutes: Math.ceil(outbound.durationSeconds / 60), origin, destination: destination.label, location_id: destination.locationId,
      source: destination.source, round_trip: roundTrip, calculated_at: new Date().toISOString(),
    };
  } catch (error) {
    fail(safeTravelError(error));
  }
}

const VEHICLE_ROLES: Record<string, string> = { transport_equipment: 'Transport sprzętu', transport_crew: 'Transport ekipy', support: 'Wsparcie' };

/** `ImportFromOfferModal` (wydarzenie): pozycje ofert, zawartość produktów (sprzęt, zestawy, rental, ludzie) i pojazdy wydarzenia. */
async function importSources(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const { data: vehicleRows } = await s.from('event_vehicles')
    .select('id, role, estimated_distance_km, fuel_cost_estimate, toll_cost_estimate, vehicle:vehicles(id, brand, model, registration_number), driver:employees!event_vehicles_driver_id_fkey(id, name, surname)')
    .eq('event_id', eventId).neq('status', 'cancelled');
  const vehicles = ((vehicleRows || []) as Row[]).map((v) => ({
    ref: `veh_${v.id}`,
    vehicleName: v.vehicle ? `${v.vehicle.brand || ''} ${v.vehicle.model || ''} (${v.vehicle.registration_number || ''})`.trim() : 'Pojazd',
    role: VEHICLE_ROLES[v.role || 'transport_equipment'] || v.role || 'Transport sprzętu',
    driverName: v.driver ? `${v.driver.name ?? ''} ${v.driver.surname ?? ''}`.trim() || null : null,
    estimatedDistance: v.estimated_distance_km ? Number(v.estimated_distance_km) : null,
    fuelCost: v.fuel_cost_estimate ? Number(v.fuel_cost_estimate) : null, tollCost: v.toll_cost_estimate ? Number(v.toll_cost_estimate) : null,
  }));
  const { data: offers } = await s.from('offers').select('id, offer_number').eq('event_id', eventId);
  if (!offers?.length) return { products: [], equipment: [], staff: [], vehicles };
  const offerList = offers as Row[];
  const offerIds = offerList.map((o) => o.id);
  const offerName = (id: string) => offerList.find((o) => o.id === id)?.offer_number || 'Oferta';

  const { data: itemsData } = await s.from('offer_items').select('*').in('offer_id', offerIds).order('display_order');
  const items = (itemsData || []) as Row[];
  const productIds = [...new Set(items.map((it) => it.product_id).filter(Boolean))] as string[];
  const productMap = new Map<string, Row>();
  const categoryMap = new Map<string, string>();
  if (productIds.length) {
    const { data: products } = await s.from('offer_products').select('id, category_id, vat_rate').in('id', productIds);
    for (const p of (products || []) as Row[]) productMap.set(p.id, p);
    const categoryIds = [...new Set(((products || []) as Row[]).map((p) => p.category_id).filter(Boolean))] as string[];
    if (categoryIds.length) {
      const { data: categories } = await s.from('event_categories').select('id, name').in('id', categoryIds);
      for (const c of (categories || []) as Row[]) categoryMap.set(c.id, c.name);
    }
  }
  const products = items.map((it) => {
    const product = it.product_id ? productMap.get(it.product_id) : null;
    const categoryName = product?.category_id ? categoryMap.get(product.category_id) ?? null : null;
    return {
      ref: it.id, name: it.name || '', description: it.description || '', quantity: Number(it.quantity || 1), unit: it.unit || 'szt.',
      unitPrice: Number(it.unit_price || 0), total: Number(it.total || 0), offerName: offerName(it.offer_id), categoryName,
      category: guessCategory(categoryName, it.name), vat: product && product.vat_rate != null ? Number(product.vat_rate) : 23,
    };
  });

  const { data: scopeData } = await s.from('offer_items')
    .select('id, offer_id, product_id, product_variant_id, name, quantity, product_variant:offer_product_variants!product_variant_id(overrides_equipment, overrides_staff)')
    .in('offer_id', offerIds);
  const scope = (scopeData || []) as Row[];
  const scopeProducts = [...new Set(scope.map((it) => it.product_id).filter(Boolean))] as string[];
  if (!scope.length || !scopeProducts.length) return { products, equipment: [], staff: [], vehicles };
  const [{ data: prodEquipment }, { data: prodStaff }] = await Promise.all([
    s.from('offer_product_equipment').select('id, product_id, product_variant_id, equipment_item_id, equipment_kit_id, rental_equipment_id, quantity, is_rental, notes').in('product_id', scopeProducts),
    s.from('offer_product_staff').select('id, product_id, product_variant_id, role, quantity, hourly_rate, estimated_hours, notes').in('product_id', scopeProducts),
  ]);
  const effective = (row: Row, field: 'overrides_equipment' | 'overrides_staff') => scope.some((item) => {
    if (row.product_id !== item.product_id) return false;
    const variant = Array.isArray(item.product_variant) ? item.product_variant[0] : item.product_variant;
    return item.product_variant_id && variant?.[field] ? row.product_variant_id === item.product_variant_id : row.product_variant_id == null;
  });
  const equipmentRows = ((prodEquipment || []) as Row[]).filter((row) => effective(row, 'overrides_equipment'));
  const staffRows = ((prodStaff || []) as Row[]).filter((row) => effective(row, 'overrides_staff'));
  const ids = (key: string) => equipmentRows.map((e) => e[key]).filter(Boolean) as string[];
  const empty = { data: [] as Row[] };
  const [eqRes, kitRes, rentalRes] = await Promise.all([
    ids('equipment_item_id').length ? s.from('equipment_items').select('id, name, brand, rental_price_per_day').in('id', ids('equipment_item_id')) : Promise.resolve(empty),
    ids('equipment_kit_id').length ? s.from('equipment_kits').select('id, name').in('id', ids('equipment_kit_id')) : Promise.resolve(empty),
    ids('rental_equipment_id').length ? s.from('subcontractor_rental_equipment').select('id, name, daily_rate').in('id', ids('rental_equipment_id')) : Promise.resolve(empty),
  ]);
  const byId = (rows: unknown) => new Map(((rows || []) as Row[]).map((r) => [r.id as string, r] as [string, Row]));
  const equipmentMap = byId(eqRes.data);
  const kitMap = byId(kitRes.data);
  const rentalMap = byId(rentalRes.data);
  const productName = new Map<string, string>();
  for (const it of scope) if (it.product_id) productName.set(it.product_id, it.name);
  const offerOf = (productId: string) => {
    const offer = offerList.find((o) => scope.some((it) => it.offer_id === o.id && it.product_id === productId));
    return offer?.offer_number || 'Oferta';
  };
  const equipment: Row[] = [];
  for (const pe of equipmentRows) {
    const base = { quantity: pe.quantity || 1, productName: productName.get(pe.product_id) || '', offerName: offerOf(pe.product_id) };
    if (pe.equipment_item_id) {
      const eq = equipmentMap.get(pe.equipment_item_id);
      equipment.push({ ...base, ref: `eq_${pe.id}`, name: eq ? `${eq.name}${eq.brand ? ` (${eq.brand})` : ''}` : 'Sprzęt', rentalPrice: Number(eq?.rental_price_per_day ?? 0), isKit: false, isRental: false });
    } else if (pe.equipment_kit_id) {
      equipment.push({ ...base, ref: `kit_${pe.id}`, name: kitMap.get(pe.equipment_kit_id)?.name || 'Zestaw', rentalPrice: 0, isKit: true, isRental: false });
    } else if (pe.rental_equipment_id) {
      const rental = rentalMap.get(pe.rental_equipment_id);
      equipment.push({ ...base, ref: `rental_${pe.id}`, name: rental?.name || 'Rental', rentalPrice: Number(rental?.daily_rate ?? 0), isKit: false, isRental: true });
    }
  }
  const staff = staffRows.map((ps) => ({
    ref: `staff_${ps.id}`, role: ps.role || '', quantity: ps.quantity || 1, hourlyRate: Number(ps.hourly_rate || 0), estimatedHours: Number(ps.estimated_hours || 0),
    productName: productName.get(ps.product_id) || '', offerName: offerOf(ps.product_id),
  }));
  return { products, equipment, staff, vehicles };
}

/** Podpisany adres aktualnego PDF (gdy rewizja dokumentu zgadza się z treścią). */
async function pdf(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const calc = await ownCalculation(ctx, eventId, params.get('calculationId') || '');
  if (!calc.generated_pdf_path) fail('Ta kalkulacja nie ma jeszcze wygenerowanego PDF');
  if (params.get('current') === '1' && calc.generated_pdf_revision !== calc.content_revision) fail('Kalkulacja zmieniła się od wygenerowania dokumentu. Wygeneruj aktualny PDF.');
  const { data, error } = await ctx.supabase.storage.from('event-files').createSignedUrl(calc.generated_pdf_path, 300);
  if (error || !data?.signedUrl) fail('Nie udało się pobrać PDF');
  return { url: data.signedUrl, name: `${String(calc.name || 'Kalkulacja').replace(/[\\/:*?"<>|]/g, '_')}.pdf` };
}

/** Dane żądania PDF dla Maca: identyfikatory i rewizja zapisanej treści. */
async function pdfPayload(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const calc = await ownCalculation(ctx, eventId, params.get('calculationId') || '');
  return { eventId, calculationId: calc.id, expectedRevision: Number(calc.content_revision ?? 0) };
}

registerEventQueries('calculations', { editor, catalog, pdf, pdfPayload, travel, importSources });

async function create(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.from('event_calculations').insert({ event_id: eventId, name: 'Nowa kalkulacja' }).select('id').single();
  if (error || !data) fail('Nie udało się utworzyć kalkulacji');
  return { ok: true, id: (data as Row).id };
}

async function remove(ctx: NativeContext, eventId: string, body: Row) {
  const calc = await ownCalculation(ctx, eventId, String(body.id || ''));
  const { error } = await ctx.supabase.from('event_calculations').delete().eq('id', calc.id);
  if (error) fail(error.message || 'Nie udało się usunąć kalkulacji');
  return { ok: true };
}

async function duplicate(ctx: NativeContext, eventId: string, body: Row) {
  const calc = await ownCalculation(ctx, eventId, String(body.id || ''));
  const { error } = await ctx.supabase.rpc('duplicate_sales_calculation', { p_calculation: calc.id, p_request_id: randomUUID() });
  if (error) fail(error.message || 'Nie udało się zduplikować kalkulacji');
  return { ok: true };
}

async function accept(ctx: NativeContext, eventId: string, body: Row) {
  const calc = await ownCalculation(ctx, eventId, String(body.id || ''));
  const { error } = await ctx.supabase.from('event_calculations').update({ is_accepted: body.accepted === true }).eq('id', calc.id);
  if (error) fail(error.message || 'Nie udało się zmienić statusu kalkulacji');
  return { ok: true };
}

/** `serializeItem`: pola pozycji zapisywane w bazie. */
function serialize(calculationId: string, item: Row, position: number) {
  const category = CATEGORIES.includes(item.category) ? item.category : 'other';
  return {
    calculation_id: calculationId, category, name: String(item.name || '').trim(), description: String(item.description || ''),
    unit: String(item.unit || 'szt.'), quantity: Number(item.quantity) || 0, unit_price: Number(item.unitPrice) || 0, days: Number(item.days) || 1,
    source: SOURCES.includes(item.source) ? item.source : 'manual', source_ref: item.sourceRef || null,
    transport_estimate: category === 'transport' ? item.transportEstimate ?? null : null, position, vat_rate: Number(item.vat ?? 23),
    power_watts: item.power ?? null, weight_kg: item.weight ?? null,
  };
}

function validItem(item: Row) {
  const values = [Number(item.quantity), Number(item.days), Number(item.unitPrice), Number(item.vat)];
  if (!String(item.name || '').trim()) fail('Podaj nazwę pozycji.');
  if (!values.every(Number.isFinite) || values[0] <= 0 || values[1] <= 0 || values[2] < 0 || values[3] < 0 || values[3] > 100 || !String(item.unit || '').trim()) {
    fail('Uzupełnij poprawną ilość, jednostkę, dni / kilometry, cenę i VAT.');
  }
}

/** Dodanie albo zmiana jednej pozycji (formularz pozycji). */
async function saveItem(ctx: NativeContext, eventId: string, body: Row) {
  const calc = await ownCalculation(ctx, eventId, String(body.calculationId || ''));
  const item = body.item && typeof body.item === 'object' ? body.item : {};
  validItem(item);
  const s = ctx.supabase;
  if (item.id) {
    if (!UUID.test(String(item.id))) fail('Nieprawidłowa pozycja.');
    const { data: current } = await s.from('event_calculation_items').select('id,position').eq('id', item.id).eq('calculation_id', calc.id).maybeSingle();
    if (!current) fail('Pozycja nie jest już dostępna. Otwórz kalkulację ponownie.');
    const { error } = await s.from('event_calculation_items').update(serialize(calc.id, item, Number((current as Row).position))).eq('id', item.id);
    if (error) fail('Błąd zapisu pozycji');
  } else {
    const { data: last } = await s.from('event_calculation_items').select('position').eq('calculation_id', calc.id).order('position', { ascending: false }).limit(1).maybeSingle();
    const { error } = await s.from('event_calculation_items').insert(serialize(calc.id, item, last ? Number((last as Row).position) + 1 : 0));
    if (error) fail('Błąd dodawania pozycji');
  }
  await s.from('event_calculations').update({ updated_at: new Date().toISOString() }).eq('id', calc.id);
  return { ok: true };
}

async function removeItem(ctx: NativeContext, eventId: string, body: Row) {
  const calc = await ownCalculation(ctx, eventId, String(body.calculationId || ''));
  const { error } = await ctx.supabase.from('event_calculation_items').delete().eq('id', String(body.itemId || '')).eq('calculation_id', calc.id);
  if (error) fail('Błąd usuwania pozycji');
  await ctx.supabase.from('event_calculations').update({ updated_at: new Date().toISOString() }).eq('id', calc.id);
  return { ok: true };
}

/** `handleSave`: nazwa, notatki i wszystkie pozycje w kolejności (jedno żądanie); zmiana kolejności unieważnia PDF. */
async function save(ctx: NativeContext, eventId: string, body: Row) {
  const calc = await ownCalculation(ctx, eventId, String(body.calculationId || ''));
  const s = ctx.supabase;
  const { error: updateError } = await s.from('event_calculations').update({
    name: String(body.name || '').trim() || calc.name, notes: String(body.notes || ''), updated_at: new Date().toISOString(),
    ...(body.orderChanged ? { generated_pdf_path: null, generated_pdf_at: null } : {}),
  }).eq('id', calc.id);
  if (updateError) fail(updateError.message || 'Błąd zapisu');
  const items = (Array.isArray(body.items) ? body.items : []) as Row[];
  for (const item of items) validItem(item);
  if (items.length) {
    const rows = items.map((item, index) => ({ ...serialize(calc.id, item, index), id: UUID.test(String(item.id || '')) ? item.id : randomUUID() }));
    const { data, error } = await s.from('event_calculation_items').upsert(rows).select('id');
    if (error) fail(error.message || 'Błąd zapisu');
    if ((data || []).length !== rows.length) fail('Nie udało się potwierdzić zapisu wszystkich pozycji.');
  }
  return { ok: true };
}

/** `appendImportedItems`: pozycje z oferty dopisywane na końcu kalkulacji (źródło `offer`). */
async function importItems(ctx: NativeContext, eventId: string, body: Row) {
  const calc = await ownCalculation(ctx, eventId, String(body.calculationId || ''));
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 500) as Row[];
  if (!items.length) fail('Zaznacz pozycje do importu.');
  const s = ctx.supabase;
  const { count } = await s.from('event_calculation_items').select('id', { count: 'exact', head: true }).eq('calculation_id', calc.id);
  const start = Number(count || 0);
  const rows = items.map((item, index) => serialize(calc.id, { ...item, source: 'offer' }, start + index));
  const { data, error } = await s.from('event_calculation_items').insert(rows).select('id');
  if (error) fail('Błąd dodawania pozycji');
  await s.from('event_calculations').update({ updated_at: new Date().toISOString() }).eq('id', calc.id);
  return { ok: true, count: (data || []).length };
}

registerEventActions('calculations', { create, remove, duplicate, accept, saveItem, removeItem, save, importItems });
