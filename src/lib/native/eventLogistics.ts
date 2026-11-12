import 'server-only';
import type { NativeContext } from './auth';
import { imageCrop } from './team';
import { registerEventActions, registerEventQueries, registerEventTab } from './eventTabs';
import { getDrivingLeg } from '@/lib/CRM/events/travelDirections';
import { getFuelPriceQuote } from '@/lib/CRM/events/fuelPriceQuote';
import { averageFuelConsumption } from '@/lib/CRM/events/travelEstimate';

/*
 * Zakładka „Logistyka” karty wydarzenia dla Maca — te same zapytania i zapisy co `EventLogisticsPanel` (`getEventLogistics`),
 * `AddEventVehicleModal`, `VehicleTravelCalculator` (trasa Google Maps i ceny paliw jak `/bridge/events/travel-estimate`)
 * i `VehicleHandoverModal`, tokenem pracownika (RLS).
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
function fail(message: string): never {
  throw new Error(message);
}

/** `canEventManage` ze strony wydarzenia: `current_employee_can_manage_event`, a bez funkcji — administrator / `events_manage`. */
async function canManageEvent(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.rpc('current_employee_can_manage_event', { p_event_id: eventId });
  if (!error && typeof data === 'boolean') return data;
  return ctx.employee.isAdmin || ctx.employee.permissions.includes('events_manage');
}

const person = (row: any) => (row ? {
  id: row.id, name: [row.name, row.surname].filter(Boolean).join(' ') || 'Przypisany pracownik', avatarUrl: row.avatar_url ?? null, avatar: imageCrop(row.avatar_metadata),
} : null);

async function logisticsTab(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const canManage = await canManageEvent(ctx, eventId);
  const [vehiclesRes, conflictsRes, timelineRes, eventRes] = await Promise.all([
    s.from('event_vehicles').select(`
      *,
      vehicles!event_vehicles_vehicle_id_fkey(name, registration_number, fuel_type, thumb_url),
      trailer:vehicles!event_vehicles_trailer_vehicle_id_fkey(name, registration_number, fuel_type),
      driver:employees!event_vehicles_driver_id_fkey(id, name, surname, avatar_url, avatar_metadata)`)
      .eq('event_id', eventId).order('created_at', { ascending: true }),
    s.from('vehicle_reservation_conflicts').select('*').or(`event_id_1.eq.${eventId},event_id_2.eq.${eventId}`),
    s.from('event_logistics_timeline').select('*, responsible_employee:employees(name, surname)').eq('event_id', eventId).order('sort_order', { ascending: true }),
    s.from('events').select('event_date, location_id, location:locations(name, formatted_address, address, city)').eq('id', eventId).maybeSingle(),
  ]);
  if (vehiclesRes.error) throw vehiclesRes.error;
  if (conflictsRes.error) throw conflictsRes.error;
  if (timelineRes.error) throw timelineRes.error;
  const conflictCounts: Record<string, number> = {};
  for (const conflict of conflictsRes.data || []) conflictCounts[(conflict as any).reservation_id] = (conflictCounts[(conflict as any).reservation_id] || 0) + 1;
  const missing = Array.from(new Set((vehiclesRes.data || []).filter((v: any) => v.driver_id && !v.driver).map((v: any) => v.driver_id as string)));
  const lookup = new Map<string, any>();
  if (missing.length) {
    const { data } = await s.from('employees').select('id,name,surname,avatar_url,avatar_metadata').in('id', missing);
    for (const driver of data || []) lookup.set((driver as any).id, driver);
  }
  let rows = (vehiclesRes.data || []) as any[];
  if (!canManage) rows = rows.filter((v) => v.driver_id === ctx.employee.id);
  const location = one((eventRes.data as any)?.location) as any;
  return {
    canManage,
    employeeId: ctx.employee.id,
    eventDate: (eventRes.data as any)?.event_date ?? null,
    eventLocation: location?.formatted_address || [location?.name, location?.address, location?.city].filter(Boolean).join(', '),
    hasLocation: Boolean((eventRes.data as any)?.location_id),
    vehicles: rows.map((v) => {
      const fleet = one(v.vehicles) as any, trailer = one(v.trailer) as any;
      const schedule = v.logistics_schedule || null;
      const departure = schedule?.mode === 'timeline' ? schedule.outbound_start : schedule?.outbound_start || v.departure_time || v.phase_assignment_from;
      return {
        id: v.id,
        vehicleId: v.vehicle_id ?? null,
        name: fleet?.name ?? null,
        registration: fleet?.registration_number ?? null,
        fuelType: fleet?.fuel_type ?? null,
        thumbnail: fleet?.thumb_url ?? null,
        isExternal: v.is_external === true,
        externalCompany: v.external_company_name ?? null,
        role: v.role || 'transport_equipment',
        driverId: v.driver_id ?? null,
        driver: person(one(v.driver) || lookup.get(v.driver_id)),
        status: v.status || 'pending',
        departure: departure ?? null,
        distance: num(v.estimated_distance_km),
        fuelCost: num(v.fuel_cost_estimate),
        tollCost: num(v.toll_cost_estimate),
        rentalCost: num(v.external_rental_cost),
        trailerRentalCost: num(v.external_trailer_rental_cost),
        conflicts: conflictCounts[v.id] || 0,
        addedFromPhase: v.added_from_phase === true,
        inUse: v.is_in_use === true,
        hasTrailer: v.has_trailer === true,
        trailerExternal: v.is_trailer_external === true,
        trailerName: trailer?.name ?? null,
        trailerRegistration: trailer?.registration_number ?? null,
        externalTrailerName: v.external_trailer_name ?? null,
        externalTrailerCompany: v.external_trailer_company ?? null,
        externalTrailerReturnLocation: v.external_trailer_return_location ?? null,
      };
    }),
    timeline: (timelineRes.data || []).map((a: any) => ({
      id: a.id, type: a.activity_type || '', title: a.title || '', description: a.description ?? null, start: a.start_time ?? null,
      duration: a.duration_minutes ?? null, responsible: one(a.responsible_employee) ? [one(a.responsible_employee as any)?.name, one(a.responsible_employee as any)?.surname].filter(Boolean).join(' ') : null,
      crew: num(a.required_crew_count), status: a.status || 'pending',
    })),
  };
}

registerEventTab('logistics', logisticsTab);

// ---------------------------------------------------------------------------------------------------------------
// Formularz pojazdu (`AddEventVehicleModal`)
// ---------------------------------------------------------------------------------------------------------------

const ASSIGNABLE = ['available', 'active'];

async function vehicleForm(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const s = ctx.supabase;
  const editingId = params.get('editingId') || '';
  const [cars, trailers, existing] = await Promise.all([
    s.from('vehicles').select('id, name, registration_number, brand, model, fuel_type, max_load_kg, category, vehicle_type, has_tow_hitch')
      .in('status', ASSIGNABLE).eq('vehicle_type', 'car').order('name'),
    s.from('vehicles').select('id, name, registration_number, brand, model, fuel_type, vehicle_type').in('status', ASSIGNABLE).eq('vehicle_type', 'trailer').order('name'),
    s.from('event_vehicles').select('vehicle_id').eq('event_id', eventId),
  ]);
  if (cars.error) throw cars.error;
  const taken = new Set((existing.data || []).map((row: any) => row.vehicle_id).filter(Boolean));
  let editing: any = null;
  if (editingId) {
    if (!uuid.test(editingId)) fail('Nieprawidłowy pojazd.');
    const { data, error } = await s.from('event_vehicles').select('*').eq('id', editingId).single();
    if (error) throw error;
    if ((data as any).event_id !== eventId) fail('Nie znaleziono pojazdu.');
    editing = data;
  }
  let vehicles = (cars.data || []).filter((v: any) => !taken.has(v.id));
  if (editing?.vehicle_id && !vehicles.some((v: any) => v.id === editing.vehicle_id)) {
    const { data } = await s.from('vehicles').select('id,name,registration_number,brand,model,fuel_type,max_load_kg,category,vehicle_type,has_tow_hitch')
      .eq('id', editing.vehicle_id).maybeSingle();
    if (data) vehicles = [...vehicles, data];
  }
  const mapVehicle = (v: any) => ({
    id: v.id, name: v.name || 'Pojazd', registration: v.registration_number || '', brand: v.brand || '', model: v.model || '',
    fuelType: v.fuel_type || null, towHitch: v.has_tow_hitch === true,
  });
  const e = editing;
  return {
    vehicles: vehicles.map(mapVehicle),
    trailers: (trailers.data || []).map(mapVehicle),
    editing: e ? {
      isExternal: e.is_external === true,
      vehicleId: e.vehicle_id || '',
      externalCompany: e.external_company_name || '',
      externalVehicleName: e.external_vehicle_name || '',
      externalRentalCost: e.external_rental_cost?.toString() || '',
      role: e.role || 'transport_equipment',
      driverId: e.driver_id || '',
      departureLocation: e.departure_location || null,
      loadingMinutes: e.loading_time_minutes ?? 60,
      unloadingMinutes: e.logistics_schedule?.unloading_minutes ?? 60,
      preparationMinutes: e.preparation_time_minutes || 30,
      travelMinutes: e.travel_time_minutes || 60,
      travelPlan: e.travel_plan || null,
      distance: e.estimated_distance_km?.toString() || '',
      fuelCost: e.fuel_cost_estimate?.toString() || '',
      tollCost: e.toll_cost_estimate?.toString() || '',
      notes: e.notes || '',
      hasTrailer: e.has_trailer === true,
      trailerId: e.trailer_vehicle_id || '',
      trailerExternal: e.is_trailer_external === true,
      externalTrailerName: e.external_trailer_name || '',
      externalTrailerCompany: e.external_trailer_company || '',
      externalTrailerCost: e.external_trailer_rental_cost?.toString() || '',
      externalTrailerReturnDate: e.external_trailer_return_date || null,
      externalTrailerReturnLocation: e.external_trailer_return_location || '',
      externalTrailerNotes: e.external_trailer_notes || '',
      pickup: e.vehicle_available_from || null,
      returnAt: e.vehicle_available_until || null,
    } : null,
  };
}

/** Kierowcy z wymaganymi kategoriami prawa jazdy: w terminie rezerwacji albo (bez terminu) na dzień wydarzenia. */
async function drivers(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const vehicleId = params.get('vehicleId') || '';
  if (!uuid.test(vehicleId)) fail('Wybierz pojazd.');
  const trailerId = params.get('trailerId') || '';
  const scope = {
    p_vehicle_id: vehicleId,
    p_trailer_id: uuid.test(trailerId) ? trailerId : null,
    p_external_trailer: params.get('externalTrailer') === '1',
  };
  const start = params.get('start'), end = params.get('end');
  const complete = Boolean(start && end);
  let result;
  if (complete) {
    const exclude = params.get('excludeId') || '';
    result = await ctx.supabase.rpc('eligible_event_vehicle_drivers', { ...scope, p_start: start, p_end: end, p_exclude_id: uuid.test(exclude) ? exclude : null });
  } else {
    const { data: event } = await ctx.supabase.from('events').select('event_date').eq('id', eventId).maybeSingle();
    const date = new Date((event as any)?.event_date || '');
    if (!Number.isFinite(date.getTime())) return { state: 'waiting', drivers: [], message: 'Uzupełnij datę wydarzenia lub wybierz fazy odbioru i zwrotu.' };
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    result = await ctx.supabase.rpc('qualified_vehicle_drivers', { ...scope, p_date: day });
  }
  const { data, error } = result;
  if (error) {
    return {
      state: 'error', drivers: [],
      message: ['PGRST202', '42883'].includes(error.code ?? '')
        ? 'Sprawdzanie kierowców wymaga aktualizacji bazy: migracja 20260917200000 (po 20260917151000). To nie oznacza braku uprawnień pracowników.'
        : error.message,
    };
  }
  const list = (data || []).map((d: any) => ({ id: d.id, name: [d.name, d.surname].filter(Boolean).join(' ') }));
  return {
    state: complete ? 'ready' : 'preview',
    drivers: list,
    message: list.length
      ? complete ? 'Dostępni w całym terminie rezerwacji, z ważnymi wymaganymi kategoriami.'
        : 'Możesz przypisać kierowcę już teraz. Uprawnienia sprawdzono na dzień wydarzenia; dostępność czasową sprawdzimy po ustaleniu godzin w Timeline.'
      : complete ? 'Brak kierowców wolnych w tym terminie z ważnymi wymaganymi kategoriami.'
        : 'Brak aktywnych pracowników z wymaganymi kategoriami ważnymi w dniu wydarzenia. Kategorie uzupełnisz w Kwalifikacje → Prawa jazdy.',
  };
}

/** Konflikty rezerwacji pojazdu w terminie (`check_vehicle_availability`). */
async function availability(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const vehicleId = params.get('vehicleId') || '';
  const start = params.get('start'), end = params.get('end');
  if (!uuid.test(vehicleId) || !start || !end) return { conflicts: [] };
  const { data, error } = await ctx.supabase.rpc('check_vehicle_availability', {
    p_vehicle_id: vehicleId, p_start_time: start, p_end_time: end, p_exclude_event_id: eventId,
  });
  if (error) return { conflicts: [] };
  return {
    conflicts: (data || []).map((c: any) => ({
      eventId: c.conflicting_event_id, name: c.event_name || 'Wydarzenie', date: c.event_date ?? null, location: c.event_location || '',
    })),
  };
}

/** Spalanie auta: z karty pojazdu albo średnia z tankowań z 90 dni (ważona dystansem); dla auta elektrycznego kWh/100 km i cena prądu. */
async function consumption(ctx: NativeContext, _eventId: string, params: URLSearchParams) {
  const vehicleId = params.get('vehicleId') || '';
  if (!uuid.test(vehicleId)) return { value: null, source: null, error: null };
  const from = new Date();
  from.setDate(from.getDate() - 90);
  const [vehicle, history] = await Promise.all([
    // `*` — działa także przed migracją ceny prądu (`energy_price_per_kwh`).
    ctx.supabase.from('vehicles').select('*').eq('id', vehicleId).maybeSingle(),
    ctx.supabase.from('fuel_entries').select('avg_consumption,distance_since_last').eq('vehicle_id', vehicleId)
      .gte('date', from.toISOString().slice(0, 10)).lte('date', new Date().toISOString().slice(0, 10))
      .gt('avg_consumption', 0).gt('distance_since_last', 0),
  ]);
  const configured = Number((vehicle.data as any)?.average_fuel_consumption);
  const hasConfigured = !vehicle.error && Number.isFinite(configured) && configured > 0;
  const energyPrice = Number((vehicle.data as any)?.energy_price_per_kwh);
  return {
    energyPrice: Number.isFinite(energyPrice) && energyPrice > 0 ? energyPrice : null,
    value: hasConfigured ? configured : history.error ? null : averageFuelConsumption((history.data || []) as any[]),
    source: hasConfigured ? 'vehicle' : 'history',
    error: !hasConfigured && (vehicle.error || history.error) ? 'Nie udało się pobrać pełnych danych o spalaniu. Możesz wpisać je ręcznie.' : null,
  };
}

const safeTravelError = (error: unknown) =>
  error instanceof Error && /^(Google Maps|Nie udało się|Zestawienie cen|Brak aktualnych)/.test(error.message)
    ? error.message : 'Nie udało się pobrać danych. Spróbuj ponownie lub uzupełnij wartości ręcznie.';

async function fuel() {
  try {
    return await getFuelPriceQuote();
  } catch (error) {
    fail(safeTravelError(error));
  }
}

/** Trasa do lokalizacji wydarzenia (`/bridge/events/travel-estimate`, `action: route`). */
async function route(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const origin = (params.get('origin') || '').trim();
  const roundTrip = params.get('roundTrip') === '1';
  if (!origin || origin.length > 500) fail('Podaj adres startu i wybierz kierunek przejazdu.');
  const { data: event, error: eventError } = await ctx.supabase.from('events').select('id,location_id').eq('id', eventId).maybeSingle();
  if (eventError || !event) fail('Brak dostępu do wydarzenia.');
  if (!(event as any).location_id) fail('Najpierw zapisz lokalizację wydarzenia w zakładce Przegląd.');
  const { data: location, error } = await ctx.supabase.from('locations')
    .select('name,formatted_address,address,city,postal_code,google_place_id,latitude,longitude').eq('id', (event as any).location_id).single();
  if (error || !location) fail('Nie udało się odczytać lokalizacji wydarzenia.');
  const l = location as any;
  const address = l.formatted_address || [l.address, l.postal_code, l.city].filter(Boolean).join(', ');
  const destination = l.google_place_id ? `place_id:${l.google_place_id}` : l.latitude != null && l.longitude != null ? `${l.latitude},${l.longitude}` : address;
  if (!destination) fail('Uzupełnij dokładny adres miejsca w zakładce Przegląd.');
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) fail('Brak klucza Google Maps w konfiguracji serwera.');
  try {
    const [outbound, inbound] = await Promise.all([
      getDrivingLeg(origin, destination, key),
      roundTrip ? getDrivingLeg(destination, origin, key) : Promise.resolve(null),
    ]);
    return {
      outbound,
      inbound,
      distanceKm: Math.round((outbound.distanceMeters + (inbound?.distanceMeters || 0)) / 100) / 10,
      travelMinutes: Math.ceil(outbound.durationSeconds / 60),
      destination: [l.name, address].filter(Boolean).join(' — '),
    };
  } catch (failure) {
    fail(safeTravelError(failure));
  }
}

registerEventQueries('logistics', {
  vehicleForm,
  drivers,
  availability,
  consumption,
  fuel: () => fuel(),
  route,
});

// ---------------------------------------------------------------------------------------------------------------
// Zapisy: pojazd (`handleSubmit`), usunięcie (`handleDeleteVehicle`), odbiór / zdanie (`VehicleHandoverModal`)
// ---------------------------------------------------------------------------------------------------------------

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const optionalNumber = (value: unknown) => {
  const raw = text(value).trim();
  return raw ? Number(raw) : null;
};
const floatOrNull = (value: unknown) => {
  const parsed = parseFloat(text(value));
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
};
const isoOrNull = (value: unknown) => {
  const raw = text(value);
  return raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
};

async function saveVehicle(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const f = body.form && typeof body.form === 'object' ? body.form : {};
  const editingId = text(body.editingId);
  if (editingId && !uuid.test(editingId)) fail('Nieprawidłowy pojazd.');
  for (const value of [f.distance, f.fuelCost, f.tollCost]) {
    const raw = text(value).trim();
    if (raw && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) fail('Dystans i koszty muszą być nieujemnymi liczbami.');
  }
  const isExternal = f.isExternal === true;
  if (!isExternal && !uuid.test(text(f.vehicleId))) fail('Wybierz pojazd.');
  if (isExternal && !text(f.externalCompany).trim()) fail('Podaj nazwę firmy wypożyczającej.');
  let savedSchedule: any = null;
  if (editingId) {
    const { data, error } = await ctx.supabase.from('event_vehicles').select('event_id, logistics_schedule').eq('id', editingId).single();
    if (error) throw error;
    if ((data as any).event_id !== eventId) fail('Nie znaleziono pojazdu.');
    savedSchedule = (data as any).logistics_schedule || null;
  }
  const availableFrom = isoOrNull(f.pickup);
  const availableUntil = isoOrNull(f.returnAt);
  const travelPlan = f.travelPlan && typeof f.travelPlan === 'object' ? f.travelPlan : null;
  const insertData: Record<string, any> = {
    event_id: eventId,
    role: ['transport_equipment', 'transport_crew', 'support'].includes(f.role) ? f.role : 'transport_equipment',
    driver_id: uuid.test(text(f.driverId)) ? f.driverId : null,
    departure_location: text(f.departureLocation) || null,
    loading_time_minutes: Math.trunc(num(f.loadingMinutes)) || 60,
    preparation_time_minutes: Math.trunc(num(f.preparationMinutes)) || 30,
    travel_time_minutes: travelPlan?.outbound?.plannedMinutes ?? (Math.trunc(num(f.travelMinutes)) || 60),
    travel_plan: travelPlan,
    departure_time: availableFrom,
    arrival_time: null,
    estimated_distance_km: optionalNumber(f.distance),
    fuel_cost_estimate: optionalNumber(f.fuelCost),
    toll_cost_estimate: floatOrNull(f.tollCost),
    notes: text(f.notes) || null,
    vehicle_available_from: availableFrom,
    vehicle_available_until: availableUntil,
    logistics_schedule: {
      ...(savedSchedule || { mode: 'timeline', pickup: { id: 'local:loading', name: 'Załadunek' }, return: { id: 'local:unloading', name: 'Rozładunek' } }),
      unloading_minutes: Math.trunc(num(f.unloadingMinutes)) || 60,
    },
    is_external: isExternal,
  };
  if (isExternal) {
    insertData.external_company_name = text(f.externalCompany);
    insertData.external_rental_cost = floatOrNull(f.externalRentalCost);
    insertData.vehicle_id = null;
  } else {
    insertData.vehicle_id = f.vehicleId;
  }
  if (f.hasTrailer === true) {
    insertData.has_trailer = true;
    if (f.trailerExternal === true) {
      insertData.is_trailer_external = true;
      insertData.external_trailer_name = text(f.externalTrailerName) || null;
      insertData.external_trailer_company = text(f.externalTrailerCompany) || null;
      insertData.external_trailer_rental_cost = floatOrNull(f.externalTrailerCost);
      insertData.external_trailer_return_date = isoOrNull(f.externalTrailerReturnDate);
      insertData.external_trailer_return_location = text(f.externalTrailerReturnLocation) || null;
      insertData.external_trailer_notes = text(f.externalTrailerNotes) || null;
    } else {
      insertData.trailer_vehicle_id = uuid.test(text(f.trailerId)) ? f.trailerId : null;
    }
  }
  const query = editingId
    ? ctx.supabase.from('event_vehicles').update(insertData).eq('id', editingId).eq('event_id', eventId).select('id').single()
    : ctx.supabase.from('event_vehicles').insert([insertData]).select('id').single();
  const { error } = await query;
  if (error) {
    fail((error as any).code === '23514' && error.message === 'Wybierz poprawny termin odbioru i zwrotu pojazdu.'
      ? 'Baza odrzuciła przedział odbioru i zwrotu. Sama godzina w Timeline nie określa całej rezerwacji. Sprawdź, czy zastosowano migrację 20261006210000_assign_driver_from_phase_vehicle.sql.'
      : error.message || 'Nie udało się zapisać pojazdu. Spróbuj ponownie.');
  }
  return { ok: true, message: 'Pojazd zapisany z własnym terminem odbioru i zwrotu.' };
}

async function deleteVehicle(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const id = text(body.rowId);
  if (!uuid.test(id)) fail('Nieprawidłowy pojazd.');
  const { data: row } = await ctx.supabase.from('event_vehicles').select('event_id').eq('id', id).maybeSingle();
  if (!row || (row as any).event_id !== eventId) fail('Nie znaleziono pojazdu.');
  const { error } = await ctx.supabase.from('event_vehicles').delete().eq('id', id);
  if (error) fail(error.message || 'Błąd podczas usuwania pojazdu');
  return { ok: true };
}

/** Ostatni stan licznika: z karty pojazdu albo z ostatniego odbioru / zdania. */
async function lastOdometer(ctx: NativeContext, _eventId: string, params: URLSearchParams) {
  const vehicleId = params.get('vehicleId') || '';
  if (!uuid.test(vehicleId)) return { value: null };
  const { data: vehicle, error } = await ctx.supabase.from('vehicles').select('current_mileage').eq('id', vehicleId).maybeSingle();
  if (error) return { value: null };
  if ((vehicle as any)?.current_mileage != null) return { value: Number((vehicle as any).current_mileage) };
  const { data: uses } = await ctx.supabase.from('event_vehicles').select('id').eq('vehicle_id', vehicleId);
  const ids = (uses || []).map((row: any) => row.id);
  if (!ids.length) return { value: null };
  const { data } = await ctx.supabase.from('vehicle_handovers').select('odometer_reading, timestamp, handover_type')
    .in('event_vehicle_id', ids).order('timestamp', { ascending: false }).limit(1).maybeSingle();
  return { value: data ? Number((data as any).odometer_reading) : null };
}

async function handover(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const id = text(body.rowId);
  if (!uuid.test(id)) fail('Brak identyfikatora przypisania pojazdu do wydarzenia');
  const mileage = parseInt(text(body.odometer), 10);
  if (!Number.isFinite(mileage)) fail('Podaj prawidłowy stan licznika');
  const { data: row, error: rowError } = await ctx.supabase.from('event_vehicles').select('id, event_id, vehicle_id, is_in_use, driver_id').eq('id', id).maybeSingle();
  if (rowError) throw rowError;
  if (!row || (row as any).event_id !== eventId) fail('Nie znaleziono rekordu przypisania pojazdu do wydarzenia');
  const fleetId = (row as any).vehicle_id as string | null;
  if (!fleetId) fail('Brak identyfikatora pojazdu');
  const last = (await lastOdometer(ctx, eventId, new URLSearchParams({ vehicleId: fleetId }))).value;
  if (last != null && mileage < last) fail(`Stan licznika nie może być niższy niż ${last} km`);
  const type = (row as any).is_in_use ? 'return' : 'pickup';
  const now = new Date().toISOString();
  if (type === 'pickup') {
    const { data: active, error } = await ctx.supabase.from('event_vehicles').select('id').eq('vehicle_id', fleetId).eq('is_in_use', true).neq('id', id).limit(1);
    if (error) throw error;
    if (active?.length) fail('Pojazd jest już w użyciu (aktywny rekord w kalendarzu).');
  }
  const { error: handoverError } = await ctx.supabase.from('vehicle_handovers').insert({
    event_vehicle_id: id, driver_id: ctx.employee.id, handover_type: type, odometer_reading: mileage, timestamp: now, notes: text(body.notes) || null,
  });
  if (handoverError) throw handoverError;
  const patch = type === 'pickup' ? { is_in_use: true, pickup_timestamp: now, return_timestamp: null } : { is_in_use: false, return_timestamp: now };
  const { data: updated, error: updateError } = await ctx.supabase.from('event_vehicles').update(patch).eq('id', id).select('id');
  if (updateError) throw updateError;
  if (!updated?.length) fail('Nie udało się zaktualizować statusu pojazdu (0 rekordów).');
  const { error: vehicleError } = await ctx.supabase.from('vehicles').update({ current_mileage: mileage, updated_at: now }).eq('id', fleetId);
  if (vehicleError) throw vehicleError;
  return { ok: true, message: type === 'pickup' ? 'Pojazd odebrany' : 'Pojazd zdany' };
}

registerEventActions('logistics', { saveVehicle, deleteVehicle, handover });
registerEventQueries('logistics', { lastOdometer });
