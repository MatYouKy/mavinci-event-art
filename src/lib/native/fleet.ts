import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NativeContext } from './auth';
import { can } from './auth';
import { imageCrop } from './team';
import { systemLabel } from '@/lib/ui/systemLabels';

/*
 * Flota na Macu (`/crm/fleet`): lista jak `getFleetVehicles` (widok `fleet_vehicles_view`, zdjęcia, przypisania, alerty,
 * wyjazdy doraźne `get_current_vehicle_usages`), karta pojazdu jak `getVehicleDetail` (tankowania, serwis: przeglądy, olej,
 * rozrząd, naprawy; ubezpieczenia, alerty, historia odbiorów i zdań, właściwości, wymagane prawo jazdy, galeria), oś czasu
 * (`get_vehicle_timeline` + `event_timeline_bounds`) oraz zapisy z modali CRM (pojazd, tankowanie, wpis serwisowy, polisa,
 * zdanie pojazdu, właściwość, wymaganie, zdjęcia). Tokenem pracownika — o dostępie decyduje RLS jak w przeglądarce.
 */

type Row = Record<string, any>;
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const num = (value: unknown) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const textOrNull = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const intOrNull = (value: unknown) => {
  const parsed = num(typeof value === 'string' ? value.replace(',', '.').replace(/\s/g, '') : value);
  return parsed == null ? null : Math.round(parsed);
};
const decimalOrNull = (value: unknown) => num(typeof value === 'string' ? value.replace(',', '.').replace(/\s/g, '') : value);
const dayOrNull = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
const timeOrNull = (value: unknown) => (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : null);
const person = (value: Row | null | undefined) => [value?.name, value?.surname].filter(Boolean).join(' ');
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const check = (error: { message?: string } | null | undefined, message: string) => {
  if (error) fail(error.message || message);
};

export function fleetAccess(ctx: NativeContext) {
  const manage = can(ctx.employee, 'fleet_manage');
  return {
    canView: manage || can(ctx.employee, 'fleet_view'),
    canManage: manage,
    canCreate: manage || can(ctx.employee, 'fleet_create'),
    isAdmin: ctx.employee.isAdmin,
    employeeId: ctx.employee.id,
  };
}

// MARK: Słowniki (te same etykiety co formularze i lista CRM)

export const VEHICLE_STATUSES: Record<string, string> = {
  available: 'Dostępny', active: 'Dostępny', in_use: 'W użytkowaniu', inactive: 'Nieaktywny', in_service: 'W serwisie',
  under_repair: 'W naprawie', no_insurance: 'Brak ważnego OC', no_inspection: 'Brak ważnego przeglądu', sold: 'Sprzedany', scrapped: 'Złomowany',
};
const CAR_CATEGORIES: [string, string][] = [
  ['personal_car', 'Samochód osobowy'], ['van', 'Bus/Van'], ['truck', 'Ciężarówka'], ['bus', 'Autobus'], ['motorcycle', 'Motocykl'],
];
const TRAILER_CATEGORIES: [string, string][] = [
  ['plandeka', 'Plandeka'], ['mobile_stage', 'Scena mobilna'], ['semi_trailer', 'Naczepa'], ['box_trailer', 'Przyczepa zamknięta'],
  ['flatbed_trailer', 'Przyczepa platformowa'], ['other_trailer', 'Inna przyczepa'],
];
const FUEL_TYPES: [string, string][] = [
  ['benzyna95', 'Benzyna 95'], ['benzyna98', 'Benzyna 98'], ['diesel', 'Diesel'], ['LPG', 'LPG'], ['elektryczny', 'Elektryczny'],
];
const TRANSMISSIONS: [string, string][] = [['manualna', 'Manualna'], ['automatyczna', 'Automatyczna']];
const OWNERSHIP: [string, string][] = [['owned', 'Własny'], ['leased', 'Leasing'], ['rented', 'Wynajem']];
const FORM_STATUSES: [string, string][] = [
  ['available', 'Dostępny'], ['inactive', 'Nieaktywny'], ['in_service', 'W serwisie'], ['under_repair', 'W naprawie'], ['sold', 'Sprzedany'], ['scrapped', 'Złomowany'],
];
const label = (pairs: [string, string][], value: unknown, fallback: string) => pairs.find(([key]) => key === value)?.[1] ?? fallback;
const statusLabel = (status: unknown) => VEHICLE_STATUSES[text(status)] ?? VEHICLE_STATUSES.inactive;
const categoryLabel = (category: unknown) => label([...CAR_CATEGORIES, ...TRAILER_CATEGORIES], category, systemLabel(category, 'vehicle', { preserveCustom: true }));
const fuelLabel = (fuel: unknown) => label(FUEL_TYPES, fuel, systemLabel(fuel, 'fuel', { preserveCustom: true }));
const transmissionLabel = (value: unknown) => label(TRANSMISSIONS, value, systemLabel(value, 'transmission', { preserveCustom: true }));
const ownershipLabel = (value: unknown) => label(OWNERSHIP, value, systemLabel(value, 'ownership', { preserveCustom: true }));
const options = (pairs: [string, string][]) => pairs.map(([value, title]) => ({ value, label: title }));

export function fleetDictionaries() {
  return {
    statuses: options(FORM_STATUSES),
    filterStatuses: options([
      ['available', 'Dostępny'], ['in_use', 'W użytkowaniu'], ['inactive', 'Nieaktywny'], ['in_service', 'W serwisie'], ['under_repair', 'W naprawie'],
      ['no_insurance', 'Brak ważnego OC'], ['no_inspection', 'Brak ważnego przeglądu'], ['sold', 'Sprzedany'], ['scrapped', 'Złomowany'],
    ]),
    filterCategories: options([...CAR_CATEGORIES, ['trailer', 'Przyczepa']]),
    carCategories: options(CAR_CATEGORIES),
    trailerCategories: options(TRAILER_CATEGORIES),
    fuelTypes: options(FUEL_TYPES),
    transmissions: options(TRANSMISSIONS),
    ownership: options(OWNERSHIP),
  };
}

// MARK: Lista (`getFleetVehicles`)

const sortImages = (images: Row[]) => [...images].sort((a, b) => {
  const primary = Number(b?.is_primary === true) - Number(a?.is_primary === true);
  if (primary) return primary;
  const order = (Number(a?.sort_order ?? 9999)) - (Number(b?.sort_order ?? 9999));
  if (order) return order;
  return new Date(a?.created_at ?? 0).getTime() - new Date(b?.created_at ?? 0).getTime();
});

const yearAgo = () => new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
const recordCost = (row: Row) => num(row.total_cost) ?? ((num(row.labor_cost) ?? 0) + (num(row.parts_cost) ?? 0));

export async function fleetList(ctx: NativeContext) {
  const s = ctx.supabase;
  const since = yearAgo();
  const [vehiclesRes, alertsRes, usagesRes, fuelRes, maintenanceRes, inspectionsRes, oilRes, timingRes] = await Promise.all([
    s.from('fleet_vehicles_view').select(`*,
      vehicle_images(id,image_url,title,created_at,sort_order,is_primary),
      vehicle_assignments!vehicle_assignments_vehicle_id_fkey(employee_id,status,employees(id,name,surname,avatar_url,avatar_metadata))`).order('name'),
    s.from('vehicle_alerts').select('vehicle_id,alert_type').eq('is_active', true),
    s.rpc('get_current_vehicle_usages'),
    // Koszty roczne (ostatnie 12 miesięcy): tankowania i serwis — w CRM pola widoku zawsze dawały 0.
    s.from('fuel_entries').select('vehicle_id,total_cost').gte('date', since).limit(5000),
    s.from('maintenance_records').select('vehicle_id,total_cost,labor_cost,parts_cost').gte('date', since).limit(5000),
    s.from('periodic_inspections').select('vehicle_id,cost').gte('inspection_date', since).limit(5000),
    s.from('oil_changes').select('vehicle_id,total_cost,labor_cost,parts_cost').gte('change_date', since).limit(5000),
    s.from('timing_belt_changes').select('vehicle_id,total_cost,labor_cost,parts_cost').gte('change_date', since).limit(5000),
  ]);
  check(vehiclesRes.error, 'Nie udało się pobrać pojazdów.');
  check(alertsRes.error, 'Nie udało się pobrać alertów pojazdów.');
  check(usagesRes.error, 'Nie udało się pobrać wyjazdów doraźnych.');
  const usageBy = new Map(((usagesRes.data ?? []) as Row[]).map((usage) => [String(usage.vehicle_id), usage]));
  const alerts = new Map<string, { insurance: number; inspection: number }>();
  for (const alert of (alertsRes.data ?? []) as Row[]) {
    const entry = alerts.get(String(alert.vehicle_id)) ?? { insurance: 0, inspection: 0 };
    if (alert.alert_type === 'insurance') entry.insurance += 1;
    if (alert.alert_type === 'inspection') entry.inspection += 1;
    alerts.set(String(alert.vehicle_id), entry);
  }
  const yearly = new Map<string, number>();
  const add = (rows: Row[] | null, cost: (row: Row) => number) => {
    for (const row of rows ?? []) yearly.set(String(row.vehicle_id), (yearly.get(String(row.vehicle_id)) ?? 0) + cost(row));
  };
  add(fuelRes.error ? [] : fuelRes.data as Row[], (row) => num(row.total_cost) ?? 0);
  add(maintenanceRes.error ? [] : maintenanceRes.data as Row[], recordCost);
  add(inspectionsRes.error ? [] : inspectionsRes.data as Row[], (row) => num(row.cost) ?? 0);
  add(oilRes.error ? [] : oilRes.data as Row[], recordCost);
  add(timingRes.error ? [] : timingRes.data as Row[], recordCost);

  const vehicles = ((vehiclesRes.data ?? []) as Row[]).map((v) => {
    const id = String(v.id);
    const images = sortImages(Array.isArray(v.vehicle_images) ? v.vehicle_images : []);
    const assignment = (Array.isArray(v.vehicle_assignments) ? v.vehicle_assignments : []).find((a: Row) => a?.status === 'active');
    const assigned = one(assignment?.employees) as Row | null;
    const usage = usageBy.get(id);
    const inUse = Boolean(v.in_use || usage);
    const driverName = usage ? text(usage.driver_first_name) : text(v.in_use_driver_name);
    const driverSurname = usage ? text(usage.driver_surname) : text(v.in_use_driver_surname);
    const driverId = usage?.driver_id ?? v.in_use_driver_id ?? null;
    return {
      id, name: text(v.name), brand: text(v.brand), model: text(v.model), year: num(v.year),
      registration: text(v.registration_number), vin: text(v.vin), status: text(v.status) || 'available', statusLabel: statusLabel(v.status),
      category: text(v.category), categoryLabel: categoryLabel(v.category), vehicleType: v.vehicle_type === 'trailer' ? 'trailer' : 'car',
      fuelType: text(v.fuel_type), mileage: Number(v.current_mileage) || 0,
      thumb: v.thumb_url || images[0]?.image_url || null,
      images: images.map((image: Row) => text(image.image_url)).filter(Boolean),
      assigned: assignment ? { id: text(assignment.employee_id), name: person(assigned), avatarUrl: assigned?.avatar_url || null, avatar: imageCrop(assigned?.avatar_metadata) } : null,
      inUse,
      inUseBy: usage ? text(usage.driver_name) : [driverName, driverSurname].filter(Boolean).join(' '),
      inUseEvent: usage ? `Wyjazd doraźny: ${text(usage.purpose)}` : text(v.in_use_event),
      inUseEventId: usage ? null : v.in_use_event_id || null,
      driver: inUse && driverId ? {
        id: String(driverId), name: [driverName, driverSurname].filter(Boolean).join(' ') || text(usage?.driver_name),
        avatarUrl: usage ? null : v.in_use_driver_avatar_url || null, avatar: usage ? null : imageCrop(v.in_use_driver_avatar_metadata),
      } : null,
      alerts: { inspection: Math.max(Number(v.upcoming_services) || 0, alerts.get(id)?.inspection ?? 0), insurance: alerts.get(id)?.insurance ?? 0 },
      yearlyCost: Math.round((yearly.get(id) ?? 0) * 100) / 100,
      createdAt: v.created_at || null,
    };
  });
  const total = vehicles.length;
  return {
    access: fleetAccess(ctx),
    dictionaries: fleetDictionaries(),
    stats: {
      total,
      active: vehicles.filter((v) => ['active', 'available', 'in_use'].includes(v.status)).length,
      inService: vehicles.filter((v) => v.status === 'in_service').length,
      yearlyCost: Math.round(vehicles.reduce((sum, v) => sum + v.yearlyCost, 0) * 100) / 100,
      averageMileage: Math.round(vehicles.reduce((sum, v) => sum + v.mileage, 0) / Math.max(total, 1)),
    },
    vehicles,
  };
}

// MARK: Karta pojazdu (`getVehicleDetail` + panele)

const MAINTENANCE_STATUS: Record<string, string> = {
  active: 'Aktywny', completed: 'Wykonany', scheduled: 'Zaplanowany', in_progress: 'W trakcie', cancelled: 'Anulowany',
  expired: 'Po terminie', failed: 'Negatywny', inactive: 'Brak ważności',
};
const INSURANCE_TYPES: Record<string, string> = { oc: 'OC', oc_ac: 'OC + AC', ac: 'AC', nnw: 'NNW', assistance: 'Assistance', gap: 'GAP', other: 'Inne' };
const INSURANCE_STATUS: Record<string, string> = { active: 'Aktywne', expired: 'Wygasłe', cancelled: 'Anulowane', scheduled: 'Zaplanowane', inactive: 'Nieaktywne' };
const displayDay = (value: unknown) => {
  const day = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}` : '';
};
const inspectionStatus = (row: Row) => {
  if (row.passed === false || row.result === 'failed') return 'failed';
  if (!row.valid_until) return 'inactive';
  return new Date(`${row.valid_until}T23:59:59`) >= new Date() ? 'active' : 'expired';
};

/** Aktywne użytkowanie: wyjazd doraźny (`get_current_vehicle_usages`) albo wydarzenie (`event_vehicles.is_in_use`). */
async function currentUsage(ctx: NativeContext, vehicleId: string) {
  const s = ctx.supabase;
  const [eventRes, usagesRes] = await Promise.all([
    s.from('event_vehicles').select('id,driver_id,pickup_timestamp,event:events(id,name),employees(name,surname)')
      .eq('vehicle_id', vehicleId).eq('is_in_use', true).limit(1),
    s.rpc('get_current_vehicle_usages'),
  ]);
  check(eventRes.error, 'Nie udało się sprawdzić użytkowania pojazdu.');
  check(usagesRes.error, 'Nie udało się sprawdzić wyjazdów doraźnych.');
  const event = ((eventRes.data ?? []) as Row[])[0] ?? null;
  const adHoc = ((usagesRes.data ?? []) as Row[]).find((usage) => String(usage.vehicle_id) === vehicleId) ?? null;
  const eventInfo = one(event?.event) as Row | null;
  const driver = one(event?.employees) as Row | null;
  const source = adHoc ? 'ad_hoc' : event ? 'event' : null;
  const driverId = adHoc?.driver_id ?? event?.driver_id ?? null;
  return {
    inUse: Boolean(event || adHoc),
    source,
    by: adHoc ? text(adHoc.driver_name) : driver ? person(driver) : '',
    driverId: driverId ? String(driverId) : null,
    eventVehicleId: event?.id ? String(event.id) : null,
    event: adHoc ? `Wyjazd doraźny: ${text(adHoc.purpose)}` : text(eventInfo?.name),
    eventId: eventInfo?.id ? String(eventInfo.id) : null,
    purpose: adHoc ? text(adHoc.purpose) : '',
    pickupAt: adHoc?.pickup_timestamp ?? event?.pickup_timestamp ?? null,
  };
}

export async function fleetVehicle(ctx: NativeContext, id: string) {
  const s = ctx.supabase;
  const [
    vehicleRes, fuelRes, maintenanceRes, inspectionsRes, oilRes, timingRes, insuranceRes, alertsRes, handoverRes,
    attributesRes, typesRes, licensesRes, categoriesRes, imagesRes, employeesRes, usage,
  ] = await Promise.all([
    s.from('vehicles').select('*').eq('id', id).maybeSingle(),
    s.from('fuel_entries').select('*, employees(name, surname)').eq('vehicle_id', id).order('date', { ascending: false }).order('created_at', { ascending: false }).limit(500),
    s.from('maintenance_records').select('*').eq('vehicle_id', id).order('date', { ascending: false }).limit(300),
    s.from('periodic_inspections').select('*, performed_by:employees!periodic_inspections_performed_by_fkey(name, surname)').eq('vehicle_id', id)
      .order('inspection_date', { ascending: false }).limit(300),
    s.from('oil_changes').select('*, oil_change_parts(*)').eq('vehicle_id', id).order('change_date', { ascending: false }).limit(300),
    s.from('timing_belt_changes').select('*').eq('vehicle_id', id).order('change_date', { ascending: false }).limit(300),
    s.from('insurance_policies').select('*').eq('vehicle_id', id).order('end_date', { ascending: false }),
    s.from('vehicle_alerts').select('*').eq('vehicle_id', id).eq('is_active', true),
    s.from('vehicle_handover_history').select('*').eq('vehicle_id', id).order('timestamp', { ascending: false }).limit(500),
    s.from('vehicle_attributes').select('*, attribute_type:vehicle_attribute_types(*)').eq('vehicle_id', id),
    s.from('vehicle_attribute_types').select('*').eq('is_active', true).order('name'),
    s.from('vehicle_license_requirements').select('id,license_category_id,is_required,notes,license_category:driving_license_categories(id,code,name,description,order_index)')
      .eq('vehicle_id', id),
    s.from('driving_license_categories').select('id,code,name,description,order_index').eq('is_active', true).order('order_index'),
    s.from('vehicle_images').select('*').eq('vehicle_id', id).order('sort_order', { ascending: true }),
    s.from('employees').select('id,name,surname').eq('is_active', true).order('surname'),
    currentUsage(ctx, id),
  ]);
  check(vehicleRes.error, 'Nie udało się pobrać pojazdu.');
  const v = vehicleRes.data as Row | null;
  if (!v) fail('Nie znaleziono pojazdu.', 404);
  for (const [result, message] of [
    [fuelRes, 'tankowań'], [maintenanceRes, 'serwisu'], [insuranceRes, 'ubezpieczeń'], [alertsRes, 'alertów'], [handoverRes, 'historii użytkowania'],
  ] as const) check((result as { error: { message?: string } | null }).error, `Nie udało się pobrać ${message}.`);
  const access = fleetAccess(ctx);

  const fuel = ((fuelRes.data ?? []) as Row[]).map((f) => ({
    id: String(f.id), date: text(f.date).slice(0, 10), time: text(f.time).slice(0, 5), location: text(f.location),
    odometer: Number(f.odometer_reading) || 0, fuelType: text(f.fuel_type), fuelLabel: fuelLabel(f.fuel_type),
    liters: num(f.liters) ?? 0, pricePerLiter: num(f.price_per_liter) ?? 0, totalCost: num(f.total_cost) ?? 0,
    avgConsumption: num(f.avg_consumption), distance: num(f.distance_since_last), fullTank: f.is_full_tank !== false,
    paymentMethod: text(f.payment_method), receiptNumber: text(f.receipt_number), receiptUrl: f.receipt_url || null,
    notes: text(f.notes), filledBy: person(one(f.employees)),
  }));

  const maintenance = [
    ...((maintenanceRes.data ?? []) as Row[]).map((r) => ({
      id: String(r.id), source: 'maintenance_records', kind: text(r.type) || 'Naprawa', date: text(r.date).slice(0, 10),
      odometer: Number(r.odometer_reading) || 0, title: text(r.title), description: text(r.description),
      provider: text(r.service_provider), labor: num(r.labor_cost) ?? 0, parts: num(r.parts_cost) ?? 0, total: recordCost(r),
      status: text(r.status) || 'completed', nextDate: text(r.next_service_date).slice(0, 10), nextMileage: num(r.next_service_mileage),
      validUntil: '', notes: text(r.notes), performedBy: '',
      items: (Array.isArray(r.parts_replaced) ? r.parts_replaced : []).map((p: Row) => ({
        description: text(p.description), partNumber: text(p.part_number), cost: num(p.cost) ?? 0,
      })),
    })),
    ...((inspectionsRes.error ? [] : inspectionsRes.data ?? []) as Row[]).map((r) => {
      const kind = r.inspection_type === 'technical_inspection' ? 'Przegląd techniczny' : 'Przegląd okresowy';
      return {
        id: String(r.id), source: 'periodic_inspections', kind, date: text(r.inspection_date).slice(0, 10),
        odometer: Number(r.odometer_reading) || 0, title: `${kind} - ${r.passed ? 'Pozytywny' : 'Negatywny'}`,
        description: text(r.defects_noted) || 'Brak uwag', provider: text(r.service_provider) || text(r.inspection_station),
        labor: 0, parts: 0, total: num(r.cost) ?? 0, status: inspectionStatus(r), nextDate: '', nextMileage: null,
        validUntil: text(r.valid_until).slice(0, 10), notes: text(r.notes), performedBy: person(one(r.performed_by)),
        items: [] as { description: string; partNumber: string; cost: number }[],
        certificate: text(r.certificate_number),
      };
    }),
    ...((oilRes.error ? [] : oilRes.data ?? []) as Row[]).map((r) => ({
      id: String(r.id), source: 'oil_changes', kind: 'Wymiana oleju', date: text(r.change_date).slice(0, 10),
      odometer: Number(r.odometer_reading) || 0, title: 'Wymiana oleju i filtrów',
      description: `Następna wymiana: ${Number(r.next_change_due_mileage) || 0} km lub ${displayDay(r.next_change_due_date) || '-'}`,
      provider: text(r.service_provider), labor: num(r.labor_cost) ?? 0, parts: num(r.parts_cost) ?? 0, total: recordCost(r),
      status: 'completed', nextDate: '', nextMileage: null, validUntil: '', notes: text(r.notes), performedBy: '',
      items: (Array.isArray(r.oil_change_parts) ? r.oil_change_parts : []).map((p: Row) => ({
        description: [text(p.part_name), num(p.quantity) != null ? `${num(p.quantity)} ${text(p.unit)}`.trim() : ''].filter(Boolean).join(' · '),
        partNumber: text(p.part_number), cost: num(p.cost) ?? 0,
      })),
    })),
    ...((timingRes.error ? [] : timingRes.data ?? []) as Row[]).map((r) => ({
      id: String(r.id), source: 'timing_belt_changes', kind: 'Wymiana rozrządu', date: text(r.change_date).slice(0, 10),
      odometer: Number(r.odometer_reading) || 0, title: 'Wymiana rozrządu', description: `Następna wymiana: ${Number(r.next_change_due_mileage) || 0} km`,
      provider: text(r.service_provider), labor: num(r.labor_cost) ?? 0, parts: num(r.parts_cost) ?? 0, total: recordCost(r),
      status: 'completed', nextDate: '', nextMileage: null, validUntil: '', notes: text(r.notes), performedBy: '',
      items: [] as { description: string; partNumber: string; cost: number }[],
    })),
  ].map((record) => ({ certificate: '', ...record, statusLabel: MAINTENANCE_STATUS[record.status] ?? MAINTENANCE_STATUS.inactive }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const insurance = ((insuranceRes.data ?? []) as Row[]).map((p) => ({
    id: String(p.id), type: text(p.type), typeLabel: INSURANCE_TYPES[text(p.type)] ?? text(p.type).toUpperCase(),
    company: text(p.insurance_company), number: text(p.policy_number), start: text(p.start_date).slice(0, 10), end: text(p.end_date).slice(0, 10),
    issued: text(p.issue_date).slice(0, 10), premium: num(p.premium_amount) ?? 0, frequency: text(p.payment_frequency),
    deductible: num(p.deductible), sumInsured: num(p.sum_insured), status: text(p.status) || 'active',
    statusLabel: INSURANCE_STATUS[text(p.status) || 'active'] ?? text(p.status), autoRenewal: p.auto_renewal === true, notes: text(p.notes),
  }));

  const handovers = ((handoverRes.data ?? []) as Row[]).map((h) => ({
    id: String(h.id), type: h.handover_type === 'pickup' ? 'pickup' : 'return', odometer: Number(h.odometer_reading) || 0,
    at: h.timestamp || null, notes: text(h.notes), eventId: h.event_id || null, eventName: text(h.event_name), eventDate: h.event_date || null,
    location: text(h.event_location), driver: text(h.driver_name), driverEmail: text(h.driver_email),
    source: h.usage_source === 'ad_hoc' ? 'ad_hoc' : 'event', purpose: text(h.purpose),
  }));

  const formatAttribute = (type: Row | null, value: string) => {
    if (type?.data_type === 'boolean') return value === 'true' ? 'Tak' : 'Nie';
    if (type?.data_type === 'number') return `${value}${type.unit ? ` ${type.unit}` : ''}`;
    return value;
  };
  const attributeCategory = (category: unknown) => (category ? systemLabel(category, 'vehicleAttribute') : '');
  const attributeType = (t: Row) => ({
    id: String(t.id), name: text(t.name), description: text(t.description), dataType: ['boolean', 'number', 'select'].includes(t.data_type) ? t.data_type : 'text',
    unit: text(t.unit), options: Array.isArray(t.options) ? t.options.map(text) : [], category: text(t.category), categoryLabel: attributeCategory(t.category),
  });
  const attributes = ((attributesRes.error ? [] : attributesRes.data ?? []) as Row[]).flatMap((a) => {
    const type = one(a.attribute_type) as Row | null;
    if (!type) return [];
    return [{
      id: String(a.id), value: text(a.value), display: formatAttribute(type, text(a.value)), notes: text(a.notes), type: attributeType(type),
    }];
  });

  const categories = ((categoriesRes.error ? [] : categoriesRes.data ?? []) as Row[]).map((c) => ({
    id: String(c.id), code: text(c.code), name: text(c.name), description: text(c.description), order: Number(c.order_index) || 0,
  }));
  const licenses = ((licensesRes.error ? [] : licensesRes.data ?? []) as Row[]).flatMap((r) => {
    const category = one(r.license_category) as Row | null;
    if (!category) return [];
    return [{
      id: String(r.id), categoryId: String(r.license_category_id), code: text(category.code), name: text(category.name),
      required: r.is_required !== false, notes: text(r.notes), order: Number(category.order_index) || 0,
    }];
  }).sort((a, b) => a.order - b.order);

  const images = ((imagesRes.error ? [] : imagesRes.data ?? []) as Row[]).map((img) => ({
    id: String(img.id), url: text(img.image_url), title: text(img.title), description: text(img.description), primary: img.is_primary === true,
    order: Number(img.sort_order) || 0, createdAt: img.created_at || null,
  }));

  const adHoc = usage.source === 'ad_hoc';
  const consumption = fuel.filter((f) => f.avgConsumption);
  return {
    access,
    dictionaries: fleetDictionaries(),
    vehicle: {
      id: String(v.id), vehicleType: v.vehicle_type === 'trailer' ? 'trailer' : 'car', name: text(v.name), brand: text(v.brand), model: text(v.model),
      registration: text(v.registration_number), vin: text(v.vin), year: num(v.year), color: text(v.color),
      engineType: text(v.engine_type), engineCapacity: num(v.engine_capacity), powerHp: num(v.power_hp), powerKw: num(v.power_kw),
      fuelType: text(v.fuel_type), fuelLabel: v.fuel_type ? fuelLabel(v.fuel_type) : '', averageConsumption: num(v.average_fuel_consumption),
      energyPrice: num(v.energy_price_per_kwh), transmission: text(v.transmission), transmissionLabel: v.transmission ? transmissionLabel(v.transmission) : '',
      driveType: text(v.drive_type), seats: num(v.number_of_seats), maxLoad: num(v.max_load_kg),
      cargoLength: num(v.cargo_length_cm), cargoWidth: num(v.cargo_width_cm), cargoHeight: num(v.cargo_height_cm),
      totalLength: num(v.total_length_cm), totalWidth: num(v.total_width_cm), totalHeight: num(v.total_height_cm), weight: num(v.weight_kg),
      status: text(v.status) || 'available', statusLabel: statusLabel(v.status), ownership: text(v.ownership_type),
      ownershipLabel: v.ownership_type ? ownershipLabel(v.ownership_type) : '', category: text(v.category), categoryLabel: categoryLabel(v.category),
      towHitch: v.has_tow_hitch === true, purchasePrice: num(v.purchase_price), purchaseDate: text(v.purchase_date).slice(0, 10),
      currentValue: num(v.current_value), leasingCompany: text(v.leasing_company), leasingMonthly: num(v.leasing_monthly_cost),
      leasingEnd: text(v.leasing_end_date).slice(0, 10), initialMileage: num(v.initial_mileage), mileage: Number(v.current_mileage) || 0,
      currentLocation: text(v.current_location), parkingLocation: text(v.parking_location), garageLocation: text(v.garage_location),
      description: text(v.description), notes: text(v.notes), thumb: v.thumb_url || images.find((i) => i.primary)?.url || images[0]?.url || null,
      createdAt: v.created_at || null,
    },
    usage: {
      ...usage,
      // Wyjazd doraźny zdaje kierowca, wydarzenie — zarządzający flotą (jak `canEndCurrentUsage` w CRM).
      canEnd: usage.inUse && (adHoc ? usage.driverId === ctx.employee.id : access.canManage),
    },
    alerts: ((alertsRes.data ?? []) as Row[]).map((a) => ({
      id: String(a.id), type: text(a.alert_type), title: text(a.title), message: text(a.message), blocking: a.is_blocking === true,
      priority: text(a.priority), dueDate: text(a.due_date).slice(0, 10),
    })),
    fuel,
    maintenance,
    insurance,
    handovers,
    attributes,
    attributeTypes: ((typesRes.error ? [] : typesRes.data ?? []) as Row[]).map(attributeType),
    licenses,
    licenseCategories: categories,
    images,
    employees: ((employeesRes.error ? [] : employeesRes.data ?? []) as Row[]).map((e) => ({ id: String(e.id), name: person(e) })),
    totals: {
      fuelCost: Math.round(fuel.reduce((sum, f) => sum + f.totalCost, 0) * 100) / 100,
      maintenanceCost: Math.round(maintenance.reduce((sum, m) => sum + m.total, 0) * 100) / 100,
      insuranceCost: Math.round(insurance.filter((p) => p.status === 'active').reduce((sum, p) => sum + p.premium, 0) * 100) / 100,
      avgConsumption: consumption.length ? Math.round(consumption.reduce((sum, f) => sum + (f.avgConsumption ?? 0), 0) / consumption.length * 10) / 10 : 0,
    },
  };
}

// MARK: Oś czasu (`VehicleSingleTimeline`, `VehiclesTimelineView`)

export async function fleetTimeline(ctx: NativeContext, vehicleId: string | null, from: string, to: string) {
  const s = ctx.supabase;
  const start = new Date(from), end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) fail('Nieprawidłowy zakres dat.');
  if (end.getTime() - start.getTime() > 400 * 86_400_000) fail('Zakres osi czasu może mieć najwyżej rok.');
  let query = s.from('vehicles').select('id,name,brand,model,registration_number,status,vehicle_type').order('name');
  if (vehicleId) query = query.eq('id', vehicleId);
  const { data: vehicles, error } = await query;
  check(error, 'Nie udało się pobrać pojazdów.');
  const rows = (vehicles ?? []) as Row[];
  const timelines: Row[][] = [];
  for (let i = 0; i < rows.length; i += 8) {
    const batch = await Promise.all(rows.slice(i, i + 8).map(async (vehicle) => {
      const { data, error: rpcError } = await s.rpc('get_vehicle_timeline', {
        p_vehicle_id: vehicle.id, p_start_date: start.toISOString(), p_end_date: end.toISOString(),
      });
      return rpcError ? [] : (data ?? []) as Row[];
    }));
    timelines.push(...batch);
  }
  // Wydarzenia rysujemy w granicach harmonogramu (`event_timeline_bounds`) jak CRM.
  const eventIds = [...new Set(timelines.flat().filter((e) => e.timeline_type === 'event' && e.related_id).map((e) => String(e.related_id)))];
  const bounds = new Map<string, Row>();
  for (let i = 0; i < eventIds.length; i += 200) {
    const { data } = await s.from('event_timeline_bounds').select('event_id,timeline_start,timeline_end').in('event_id', eventIds.slice(i, i + 200));
    for (const row of (data ?? []) as Row[]) bounds.set(String(row.event_id), row);
  }
  return {
    vehicles: rows.map((vehicle, index) => ({
      id: String(vehicle.id), name: text(vehicle.name), subtitle: [text(vehicle.brand), text(vehicle.model)].filter(Boolean).join(' '),
      registration: text(vehicle.registration_number), status: text(vehicle.status), vehicleType: vehicle.vehicle_type === 'trailer' ? 'trailer' : 'car',
      entries: (timelines[index] ?? []).map((entry, position) => {
        const isEvent = entry.timeline_type === 'event';
        const bound = isEvent ? bounds.get(String(entry.related_id)) : null;
        return {
          id: `${entry.timeline_id ?? position}-${position}`, type: isEvent ? 'event' : 'maintenance',
          start: bound?.timeline_start ?? entry.start_date, end: bound?.timeline_end ?? entry.end_date ?? entry.start_date,
          title: text(entry.title), description: text(entry.description), status: text(entry.status), color: text(entry.color),
          relatedId: entry.related_id ? String(entry.related_id) : null, eventName: text(entry.event_name), driver: text(entry.driver_name),
          location: text(entry.location),
        };
      }).filter((entry) => entry.start),
    })),
  };
}

// MARK: Zapisy

const requireId = (value: unknown, message: string) => {
  const id = text(value);
  if (!UUID.test(id)) fail(message);
  return id;
};

/** Pojazd z formularza (Mac: ta sama karta przy dodawaniu i edycji) — pola i walidacja jak `/crm/fleet/new` i `/crm/fleet/[id]/edit`. */
export async function saveVehicle(ctx: NativeContext, id: string | null, data: Row) {
  const access = fleetAccess(ctx);
  if (id ? !access.canManage : !access.canCreate) fail('Nie masz uprawnień do zapisu pojazdu.', 403);
  const name = textOrNull(data.name), brand = textOrNull(data.brand), model = textOrNull(data.model);
  if (!name || !brand || !model) fail('Wypełnij wymagane pola: Nazwa, Marka, Model');
  const type = data.vehicleType === 'trailer' ? 'trailer' : 'car';
  const car = type === 'car';
  const fuel = textOrNull(data.fuelType) ?? 'diesel';
  const electric = fuel === 'elektryczny';
  const consumption = car ? decimalOrNull(data.averageConsumption) : null;
  if (consumption !== null && (consumption < 0.01 || consumption > 999.99)) {
    fail(electric ? 'Podaj zużycie energii w kWh/100 km (0,01–999,99) albo pozostaw pole puste.' : 'Podaj średnie spalanie w l/100 km (0,01–999,99) albo pozostaw pole puste.');
  }
  const energy = car && electric ? decimalOrNull(data.energyPrice) : null;
  if (energy !== null && (energy <= 0 || energy >= 100)) fail('Podaj cenę prądu w zł/kWh (np. 1,10) albo pozostaw pole puste.');
  const year = intOrNull(data.year);
  if (year !== null && (year < 1900 || year > new Date().getFullYear() + 1)) fail('Podaj poprawny rok produkcji.');
  const leased = data.ownership === 'leased';
  const status = textOrNull(data.status) ?? 'available';
  if (!VEHICLE_STATUSES[status]) fail('Nieprawidłowy status pojazdu.');
  const columns: Row = {
    vehicle_type: type, name, brand, model,
    registration_number: textOrNull(data.registration), vin: textOrNull(data.vin), year, color: textOrNull(data.color),
    engine_type: car ? textOrNull(data.engineType) : null, engine_capacity: car ? intOrNull(data.engineCapacity) : null,
    power_hp: car ? intOrNull(data.powerHp) : null, power_kw: car ? intOrNull(data.powerKw) : null,
    fuel_type: car ? fuel : null, transmission: car ? textOrNull(data.transmission) ?? 'manualna' : null,
    drive_type: car ? textOrNull(data.driveType) : null, number_of_seats: car ? intOrNull(data.seats) : null,
    average_fuel_consumption: consumption, energy_price_per_kwh: energy,
    max_load_kg: intOrNull(data.maxLoad),
    cargo_length_cm: car ? null : intOrNull(data.cargoLength), cargo_width_cm: car ? null : intOrNull(data.cargoWidth),
    cargo_height_cm: car ? null : intOrNull(data.cargoHeight), total_length_cm: car ? null : intOrNull(data.totalLength),
    total_width_cm: car ? null : intOrNull(data.totalWidth), total_height_cm: car ? null : intOrNull(data.totalHeight),
    weight_kg: car ? null : intOrNull(data.weight),
    status, ownership_type: textOrNull(data.ownership) ?? 'owned', category: textOrNull(data.category) ?? (car ? 'van' : 'plandeka'),
    has_tow_hitch: car ? data.towHitch === true : false,
    purchase_price: decimalOrNull(data.purchasePrice), purchase_date: dayOrNull(data.purchaseDate), current_value: decimalOrNull(data.currentValue),
    leasing_company: leased ? textOrNull(data.leasingCompany) : null, leasing_monthly_cost: leased ? decimalOrNull(data.leasingMonthly) : null,
    leasing_end_date: leased ? dayOrNull(data.leasingEnd) : null,
    initial_mileage: car ? intOrNull(data.initialMileage) ?? 0 : 0, current_mileage: car ? intOrNull(data.mileage) ?? 0 : 0,
    current_location: textOrNull(data.currentLocation), parking_location: textOrNull(data.parkingLocation), garage_location: textOrNull(data.garageLocation),
    description: textOrNull(data.description), notes: textOrNull(data.notes),
  };
  for (const key of Object.keys(columns)) {
    if (typeof columns[key] === 'number' && !Number.isFinite(columns[key])) fail('Sprawdź liczby w formularzu.');
  }
  if (id) {
    const { data: updated, error } = await ctx.supabase.from('vehicles').update(columns).eq('id', id).select('id');
    check(error, 'Błąd podczas aktualizacji pojazdu');
    if (!updated?.length) fail('Nie masz uprawnień do edycji tego pojazdu.', 403);
    return { ok: true, id, message: 'Pojazd został zaktualizowany pomyślnie' };
  }
  const { data: created, error } = await ctx.supabase.from('vehicles').insert({ ...columns, created_by: ctx.employee.id }).select('id').single();
  check(error, 'Błąd podczas dodawania pojazdu');
  return { ok: true, id: String((created as Row).id), message: 'Pojazd został dodany pomyślnie' };
}

export async function deleteVehicle(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.from('vehicles').delete().eq('id', id).select('id');
  check(error, 'Błąd podczas usuwania pojazdu');
  if (!data?.length) fail('Nie masz uprawnień do usunięcia tego pojazdu.', 403);
  return { ok: true, message: 'Pojazd został usunięty' };
}

/** Tankowanie: pełne (`AddFuelEntryModal`) albo szybkie (`QuickFuelModal`: karta firmowa / inna płatność, paragon, przebieg pojazdu). */
export async function addFuel(ctx: NativeContext, vehicleId: string, data: Row) {
  const quick = data.mode === 'quick';
  const date = dayOrNull(data.date);
  const odometer = intOrNull(data.odometer);
  const liters = decimalOrNull(data.liters);
  const price = decimalOrNull(data.pricePerLiter);
  if (!date || odometer == null || liters == null || price == null) fail(quick ? 'Wypełnij wszystkie wymagane pola' : 'Wypełnij wymagane pola');
  if (liters <= 0 || price <= 0 || odometer < 0) fail('Litry, cena i przebieg muszą być większe od zera.');
  const payment = quick
    ? (data.paymentMethod === 'other' ? textOrNull(data.otherPayment) : 'company_card')
    : textOrNull(data.paymentMethod);
  if (quick && !payment) fail('Podaj metodę płatności');
  const { data: vehicle, error: vehicleError } = await ctx.supabase.from('vehicles').select('id,current_mileage').eq('id', vehicleId).maybeSingle();
  check(vehicleError, 'Nie udało się pobrać pojazdu.');
  if (!vehicle) fail('Nie znaleziono pojazdu.', 404);
  const { error } = await ctx.supabase.from('fuel_entries').insert({
    vehicle_id: vehicleId, date, time: timeOrNull(data.time), location: quick ? null : textOrNull(data.location), odometer_reading: odometer,
    fuel_type: quick ? 'other' : textOrNull(data.fuelType) ?? 'diesel', liters, price_per_liter: price,
    total_cost: Math.round(liters * price * 100) / 100, payment_method: payment, receipt_number: quick ? null : textOrNull(data.receiptNumber),
    receipt_url: textOrNull(data.receiptUrl), is_full_tank: quick ? true : data.fullTank !== false, filled_by: ctx.employee.id,
    notes: quick ? null : textOrNull(data.notes),
  });
  check(error, 'Błąd podczas dodawania tankowania');
  if (quick && odometer > (Number((vehicle as Row).current_mileage) || 0)) {
    await ctx.supabase.from('vehicles').update({ current_mileage: odometer }).eq('id', vehicleId);
  }
  return { ok: true, message: 'Tankowanie zostało dodane' };
}

const addYear = (day: string) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
};
const money = (value: unknown) => {
  const parsed = decimalOrNull(value);
  if (parsed != null && parsed < 0) fail('Kwoty nie mogą być ujemne.');
  return parsed ?? 0;
};

/** Wpis serwisowy (`AddMaintenanceModal`): kontrola techniczna, wymiana oleju z częściami, rozrząd, inne naprawy. */
export async function addMaintenance(ctx: NativeContext, vehicleId: string, kind: string, data: Row) {
  const s = ctx.supabase;
  const odometer = intOrNull(data.odometer);
  if (odometer == null || odometer < 0) fail('Podaj przebieg (km).');
  if (kind === 'inspection') {
    const date = dayOrNull(data.date), validUntil = dayOrNull(data.validUntil);
    if (!date || !validUntil) fail('Podaj datę przeglądu i datę ważności.');
    if (validUntil < date) fail('Data ważności nie może być wcześniejsza niż data przeglądu.');
    const performer = textOrNull(data.performedBy);
    const { error } = await s.from('periodic_inspections').insert({
      vehicle_id: vehicleId, inspection_type: 'technical_inspection', inspection_date: date, valid_until: validUntil, next_inspection_due: validUntil,
      certificate_number: textOrNull(data.certificate), performed_by: performer && UUID.test(performer) ? performer : null,
      service_provider: textOrNull(data.provider), cost: money(data.cost), odometer_reading: odometer, notes: textOrNull(data.notes),
      passed: true, result: 'passed', is_current: true,
    });
    check(error, 'Błąd podczas dodawania wpisu');
    return { ok: true, message: 'Kontrola techniczna została dodana' };
  }
  if (kind === 'oil_change') {
    const date = dayOrNull(data.date);
    if (!date) fail('Podaj datę wymiany.');
    const parts = (Array.isArray(data.parts) ? data.parts : []).slice(0, 50).map((p: Row) => ({
      part_type: ['oil', 'oil_filter', 'air_filter', 'cabin_filter', 'fuel_filter', 'other'].includes(p?.type) ? p.type : 'other',
      part_name: textOrNull(p?.name), part_number: textOrNull(p?.number), quantity: decimalOrNull(p?.quantity) ?? 1,
      unit: textOrNull(p?.unit) ?? 'szt', cost: money(p?.cost),
    }));
    if (parts.some((p: Row) => !p.part_name)) fail('Podaj nazwę każdej części (albo usuń pusty wiersz).');
    const labor = money(data.labor);
    const partsCost = parts.reduce((sum: number, p: Row) => sum + p.cost, 0);
    const { data: created, error } = await s.from('oil_changes').insert({
      vehicle_id: vehicleId, change_date: date, odometer_reading: odometer, next_change_due_mileage: odometer + 12000,
      next_change_due_date: addYear(date), service_provider: textOrNull(data.provider), labor_cost: labor, parts_cost: partsCost,
      total_cost: Math.round((labor + partsCost) * 100) / 100, notes: textOrNull(data.notes),
    }).select('id').single();
    check(error, 'Błąd podczas dodawania wpisu');
    if (parts.length) {
      const { error: partsError } = await s.from('oil_change_parts').insert(parts.map((p: Row) => ({ ...p, oil_change_id: (created as Row).id })));
      if (partsError) {
        await s.from('oil_changes').delete().eq('id', (created as Row).id);
        fail(partsError.message || 'Błąd podczas zapisywania części');
      }
    }
    return { ok: true, message: 'Wymiana oleju została dodana' };
  }
  if (kind === 'timing_belt') {
    const date = dayOrNull(data.date);
    const next = intOrNull(data.nextMileage);
    if (!date || next == null) fail('Podaj datę wymiany i przebieg następnej wymiany.');
    const labor = money(data.labor), partsCost = money(data.partsCost);
    const { error } = await s.from('timing_belt_changes').insert({
      vehicle_id: vehicleId, change_date: date, odometer_reading: odometer, next_change_due_mileage: next, service_provider: textOrNull(data.provider),
      labor_cost: labor, parts_cost: partsCost, total_cost: Math.round((labor + partsCost) * 100) / 100, notes: textOrNull(data.notes),
    });
    check(error, 'Błąd podczas dodawania wpisu');
    return { ok: true, message: 'Wymiana rozrządu została dodana' };
  }
  if (kind === 'repair') {
    // CRM zapisywał do nieistniejącej tabeli `maintenance_repairs`; naprawy trafiają do `maintenance_records` (tę tabelę czyta karta).
    const title = textOrNull(data.title);
    const date = dayOrNull(data.date);
    if (!title || !date) fail('Podaj tytuł naprawy i datę.');
    const status = ['scheduled', 'in_progress', 'completed', 'cancelled'].includes(data.status) ? data.status : 'completed';
    const severity = ['low', 'medium', 'high'].includes(data.severity) ? data.severity : 'medium';
    const items = status === 'completed'
      ? (Array.isArray(data.items) ? data.items : []).slice(0, 50).map((i: Row) => ({
        description: textOrNull(i?.description) ?? '', part_number: textOrNull(i?.partNumber) ?? '', cost: money(i?.cost),
      })).filter((i: Row) => i.description || i.part_number || i.cost)
      : [];
    const labor = money(data.labor);
    const partsCost = items.reduce((sum: number, i: Row) => sum + i.cost, 0);
    const description = [
      textOrNull(data.description),
      items.length ? `Naprawione elementy:\n${items.map((i: Row, n: number) => `${n + 1}. ${i.description}${i.part_number ? ` (${i.part_number})` : ''} - ${i.cost} zł`).join('\n')}` : null,
    ].filter(Boolean).join('\n\n');
    const { error } = await s.from('maintenance_records').insert({
      vehicle_id: vehicleId, type: 'repair', category: severity, date, odometer_reading: odometer, title, description: description || null,
      service_provider: textOrNull(data.provider), labor_cost: labor, parts_cost: partsCost, total_cost: Math.round((labor + partsCost) * 100) / 100,
      parts_replaced: items, status, next_service_date: status === 'scheduled' ? dayOrNull(data.plannedDate) : null,
      requested_by: ctx.employee.id, notes: textOrNull(data.notes),
    });
    check(error, 'Błąd podczas dodawania wpisu');
    await s.rpc('update_vehicle_status_from_alerts');
    return { ok: true, message: 'Naprawa została dodana' };
  }
  fail('Nieznany typ wpisu serwisowego.');
}

const MAINTENANCE_TABLES = ['maintenance_records', 'periodic_inspections', 'oil_changes', 'timing_belt_changes'];

export async function deleteMaintenance(ctx: NativeContext, id: string, source: string) {
  if (!MAINTENANCE_TABLES.includes(source)) fail('Nieprawidłowy wpis serwisowy.');
  if (source === 'oil_changes') await ctx.supabase.from('oil_change_parts').delete().eq('oil_change_id', id);
  const { data, error } = await ctx.supabase.from(source).delete().eq('id', id).select('id');
  check(error, 'Błąd podczas usuwania wpisu');
  if (!data?.length) fail('Nie masz uprawnień do usunięcia tego wpisu.', 403);
  return { ok: true, message: 'Wpis serwisowy został usunięty' };
}

/** Polisa (`AddInsuranceModal`) — alerty ubezpieczenia tworzy wyzwalacz bazy. */
export async function addInsurance(ctx: NativeContext, vehicleId: string, data: Row) {
  const company = textOrNull(data.company), number = textOrNull(data.number);
  const start = dayOrNull(data.start), end = dayOrNull(data.end);
  const premium = decimalOrNull(data.premium);
  if (!company || !number || !start || !end || premium == null) fail('Wypełnij wymagane pola');
  if (end < start) fail('Data końcowa nie może być wcześniejsza niż początkowa.');
  if (premium < 0) fail('Składka nie może być ujemna.');
  const { error } = await ctx.supabase.from('insurance_policies').insert({
    vehicle_id: vehicleId, type: Object.keys(INSURANCE_TYPES).includes(data.type) ? data.type : 'oc',
    insurance_company: company, policy_number: number, start_date: start, end_date: end, issue_date: dayOrNull(data.issued),
    premium_amount: premium, payment_frequency: ['annual', 'semi_annual', 'quarterly', 'monthly'].includes(data.frequency) ? data.frequency : 'annual',
    deductible: decimalOrNull(data.deductible), sum_insured: decimalOrNull(data.sumInsured),
    status: ['active', 'expired', 'cancelled'].includes(data.status) ? data.status : 'active', auto_renewal: data.autoRenewal === true,
    notes: textOrNull(data.notes),
  });
  check(error, 'Błąd podczas dodawania polisy');
  return { ok: true, message: 'Polisa ubezpieczeniowa została dodana' };
}

export async function deleteInsurance(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.from('insurance_policies').delete().eq('id', id).select('id');
  check(error, 'Błąd podczas usuwania ubezpieczenia');
  if (!data?.length) fail('Nie masz uprawnień do usunięcia tej polisy.', 403);
  return { ok: true, message: 'Ubezpieczenie zostało usunięte' };
}

/** „Zakończ użytkowanie” (`VehicleHandoverModal`, zdanie): wyjazd doraźny RPC, wydarzenie — wpis zdania i stan przypisania. */
export async function endUsage(ctx: NativeContext, vehicleId: string, data: Row) {
  const s = ctx.supabase;
  const mileage = intOrNull(data.odometer);
  if (mileage == null || mileage < 0) fail('Podaj prawidłowy stan licznika');
  const usage = await currentUsage(ctx, vehicleId);
  if (!usage.inUse) fail('Nie znaleziono aktywnego użytkowania pojazdu');
  const { data: vehicle } = await s.from('vehicles').select('current_mileage').eq('id', vehicleId).maybeSingle();
  const last = (vehicle as Row | null)?.current_mileage;
  if (last != null && mileage < Number(last)) fail(`Stan licznika nie może być niższy niż ${last} km`);
  const notes = textOrNull(data.notes);
  if (usage.source === 'ad_hoc') {
    if (usage.driverId !== ctx.employee.id) fail('Pojazd może zdać osoba, która go odebrała', 403);
    const { error } = await s.rpc('record_ad_hoc_vehicle_handover', {
      p_vehicle_id: vehicleId, p_handover_type: 'return', p_odometer_reading: mileage, p_purpose: usage.purpose || null, p_notes: notes,
    });
    check(error, 'Błąd podczas zapisywania');
    return { ok: true, message: 'Pojazd został zdany' };
  }
  if (!fleetAccess(ctx).canManage) fail('Nie masz uprawnień do zakończenia użytkowania pojazdu.', 403);
  if (!usage.eventVehicleId) fail('Nie znaleziono aktywnego przypisania pojazdu do eventu');
  const now = new Date().toISOString();
  const { error: handoverError } = await s.from('vehicle_handovers').insert({
    event_vehicle_id: usage.eventVehicleId, driver_id: ctx.employee.id, handover_type: 'return', odometer_reading: mileage, timestamp: now, notes,
  });
  check(handoverError, 'Błąd podczas zapisywania');
  const { data: updated, error: updateError } = await s.from('event_vehicles').update({ is_in_use: false, return_timestamp: now })
    .eq('id', usage.eventVehicleId).select('id');
  check(updateError, 'Błąd podczas zapisywania');
  if (!updated?.length) fail('Nie udało się zaktualizować statusu pojazdu (0 rekordów).');
  const { error: vehicleError } = await s.from('vehicles').update({ current_mileage: mileage, updated_at: now }).eq('id', vehicleId);
  check(vehicleError, 'Błąd podczas zapisywania');
  return { ok: true, message: 'Pojazd zdany' };
}

export async function addAttribute(ctx: NativeContext, vehicleId: string, data: Row) {
  const typeId = requireId(data.typeId, 'Wybierz typ właściwości.');
  const value = textOrNull(data.value);
  if (!value) fail('Podaj wartość właściwości.');
  const { error } = await ctx.supabase.from('vehicle_attributes').insert({ vehicle_id: vehicleId, attribute_type_id: typeId, value, notes: textOrNull(data.notes) });
  check(error, 'Błąd podczas dodawania właściwości');
  return { ok: true, message: 'Właściwość została dodana' };
}

export async function deleteAttribute(ctx: NativeContext, id: string) {
  const { error } = await ctx.supabase.from('vehicle_attributes').delete().eq('id', id);
  check(error, 'Błąd podczas usuwania właściwości');
  return { ok: true, message: 'Właściwość została usunięta' };
}

export async function addLicense(ctx: NativeContext, vehicleId: string, data: Row) {
  const categoryId = requireId(data.categoryId, 'Wybierz kategorię prawa jazdy');
  const { error } = await ctx.supabase.from('vehicle_license_requirements').insert({
    vehicle_id: vehicleId, license_category_id: categoryId, is_required: data.required !== false, notes: textOrNull(data.notes),
  });
  if (error?.code === '23505') fail('Ta kategoria jest już dodana');
  check(error, 'Błąd podczas dodawania wymagania');
  return { ok: true, message: 'Wymaganie dodane pomyślnie' };
}

export async function deleteLicense(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.from('vehicle_license_requirements').delete().eq('id', id).select('id');
  check(error, 'Błąd podczas usuwania wymagania');
  if (!data?.length) fail('Nie masz uprawnień do usunięcia wymagania.', 403);
  return { ok: true, message: 'Wymaganie usunięte pomyślnie' };
}

// MARK: Zdjęcia i paragony (multipart — plik przez serwer CRM do magazynu plików, tokenem pracownika)

const extension = (name: string, fallback: string) => (name.split('.').pop() || fallback).toLowerCase().replace(/[^a-z0-9]/g, '') || fallback;

/** Zdjęcie do galerii pojazdu (`VehicleGallery`): `vehicle-images`, pierwsze zdjęcie jest główne. */
export async function uploadVehicleImage(ctx: NativeContext, vehicleId: string, file: File) {
  if (!(file.type || '').startsWith('image/')) fail(`${file.name} nie jest obrazem`);
  if (file.size > 10 * 1024 * 1024) fail(`${file.name} przekracza 10MB`);
  const s = ctx.supabase;
  const { count } = await s.from('vehicle_images').select('id', { count: 'exact', head: true }).eq('vehicle_id', vehicleId);
  const path = `${vehicleId}/${Date.now()}-${randomUUID().slice(0, 7)}.${extension(file.name, 'jpg')}`;
  const upload = await s.storage.from('vehicle-images').upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type });
  if (upload.error) fail(`Błąd podczas przesyłania ${file.name}`);
  const { data: { publicUrl } } = s.storage.from('vehicle-images').getPublicUrl(path);
  const { error } = await s.from('vehicle_images').insert({
    vehicle_id: vehicleId, image_url: publicUrl, title: file.name, is_primary: !count, sort_order: count || 0, uploaded_by: ctx.employee.id, storage_path: path,
  });
  if (error) {
    await s.storage.from('vehicle-images').remove([path]);
    fail(`Błąd podczas przesyłania ${file.name}`);
  }
  return { ok: true };
}

/** Paragon / faktura do szybkiego tankowania (`fuel-receipts`) — zwraca adres do zapisania przy tankowaniu. */
export async function uploadReceipt(ctx: NativeContext, vehicleId: string, file: File) {
  const type = file.type || '';
  if (!type.startsWith('image/') && type !== 'application/pdf') fail('Paragon musi być zdjęciem albo PDF.');
  if (file.size > 10 * 1024 * 1024) fail(`${file.name} przekracza 10MB`);
  const path = `${vehicleId}/${vehicleId}_${Date.now()}.${extension(file.name, type === 'application/pdf' ? 'pdf' : 'jpg')}`;
  const upload = await ctx.supabase.storage.from('fuel-receipts').upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: type });
  if (upload.error) fail(upload.error.message || 'Nie udało się przesłać paragonu.');
  const { data: { publicUrl } } = ctx.supabase.storage.from('fuel-receipts').getPublicUrl(path);
  return { ok: true, url: publicUrl };
}

export async function setPrimaryVehicleImage(ctx: NativeContext, vehicleId: string, id: string) {
  const off = await ctx.supabase.from('vehicle_images').update({ is_primary: false }).eq('vehicle_id', vehicleId);
  check(off.error, 'Błąd podczas ustawiania zdjęcia głównego');
  const on = await ctx.supabase.from('vehicle_images').update({ is_primary: true }).eq('id', id).eq('vehicle_id', vehicleId).select('id');
  check(on.error, 'Błąd podczas ustawiania zdjęcia głównego');
  if (!on.data?.length) fail('Nie znaleziono zdjęcia.');
  return { ok: true, message: 'Zdjęcie główne zostało ustawione' };
}

export async function deleteVehicleImage(ctx: NativeContext, id: string) {
  const s = ctx.supabase;
  const { data: image } = await s.from('vehicle_images').select('image_url,storage_path').eq('id', id).maybeSingle();
  if (!image) fail('Nie znaleziono zdjęcia.');
  const parts = text((image as Row).image_url).split('/vehicle-images/');
  const path = textOrNull((image as Row).storage_path) ?? (parts.length > 1 ? decodeURIComponent(parts[1]) : null);
  const { data, error } = await s.from('vehicle_images').delete().eq('id', id).select('id');
  check(error, 'Błąd podczas usuwania zdjęcia');
  if (!data?.length) fail('Nie masz uprawnień do usunięcia zdjęcia.', 403);
  if (path) await s.storage.from('vehicle-images').remove([path]);
  return { ok: true, message: 'Zdjęcie zostało usunięte' };
}

export async function renameVehicleImage(ctx: NativeContext, id: string, title: unknown) {
  const { error } = await ctx.supabase.from('vehicle_images').update({ title: textOrNull(title) }).eq('id', id);
  check(error, 'Błąd podczas aktualizacji tytułu');
  return { ok: true, message: 'Tytuł został zaktualizowany' };
}
