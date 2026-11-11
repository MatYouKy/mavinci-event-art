import 'server-only';
import { createHash } from 'node:crypto';
import type { NativeContext } from './auth';
import { imageCrop } from './team';
import { uniquePhaseTypes } from '@/lib/CRM/events/uniquePhaseTypes';
import { phaseRank, suggestPhaseTimes } from '@/lib/CRM/events/phaseSuggestions';
import { eventTravelMinutes } from '@/lib/CRM/events/travelPlan';

/*
 * Zakładki karty wydarzenia dla aplikacji na Maca (Harmonogram, Sprzęt, Logistyka, Agenda, Pliki, Zadania, Podwykonawcy, Oferta,
 * Kalkulacje, Umowa, Ustalenia, Finanse, Podsumowanie, Historia) — te same zapytania co komponenty CRM, tokenem pracownika (RLS).
 * Każda zakładka wraca ze skrótem; Mac trzyma ją na dysku i pobiera ponownie tylko po zmianie. Zapisy: `eventMutate` (lista
 * dozwolonych tabel i kolumn — tak jak zapisy przeglądarki przez `supabase.from(...)`, z kontrolą przynależności do wydarzenia)
 * oraz RPC z listy w `eventCard.ts`.
 */

const digest = (value: unknown) => createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 20);
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

// ---------------------------------------------------------------------------------------------------------------
// Harmonogram (`EventPhasesTimeline`, `PhaseTimelineView`, `ResourceTimeline`, `PhaseResourcesPanel`)
// ---------------------------------------------------------------------------------------------------------------

async function phasesTab(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const [event, phases, types, team, vehicles, equipment] = await Promise.all([
    s.from('events').select('id, event_date, event_end_date, planned_setup_at, planned_teardown_at, flexible_travel_phases').eq('id', eventId).single(),
    s.from('event_phases').select('*, phase_type:event_phase_types(*)').eq('event_id', eventId).order('start_time', { ascending: true }),
    s.from('event_phase_types').select('*').eq('is_active', true).order('sequence_priority', { ascending: true }),
    s.from('employee_assignments')
      .select('employee_id, employee:employees!employee_assignments_employee_id_fkey(id, name, surname, avatar_url, avatar_metadata)')
      .eq('event_id', eventId).order('created_at', { ascending: true }),
    s.from('event_vehicles').select('*').eq('event_id', eventId).order('created_at', { ascending: true }),
    s.from('event_equipment').select('id, equipment_id, kit_id, quantity, equipment:equipment_items(id, name, category:warehouse_categories(name)), kit:equipment_kits(id, name)').eq('event_id', eventId),
  ]);
  if (event.error) throw event.error;
  if (phases.error) throw phases.error;
  const phaseRows = (phases.data ?? []) as any[];
  const phaseIds = phaseRows.map((phase) => phase.id);
  const acceptance = 'id, reason, accepted_at, accepted_by_employee:employees!event_employee_conflict_acceptances_acceptor_fkey(id, name, surname)';
  const [assignments, phaseVehicles, phaseEquipment] = phaseIds.length
    ? await Promise.all([
        s.from('event_phase_assignments').select(`*,
          employee:employees!event_phase_assignments_employee_id_fkey(id, name, surname, avatar_url, avatar_metadata),
          accepted_conflicts_as_a:event_employee_conflict_acceptances!event_employee_conflict_acceptances_assignment_a_id_fkey(${acceptance}),
          accepted_conflicts_as_b:event_employee_conflict_acceptances!event_employee_conflict_acceptances_assignment_b_id_fkey(${acceptance})`)
          .in('phase_id', phaseIds),
        s.from('event_phase_vehicles').select(`*,
          vehicle:vehicles!event_phase_vehicles_vehicle_id_fkey(id, name, registration_number, brand, model),
          driver:employees!event_phase_vehicles_driver_id_fkey(id, name, surname)`).in('phase_id', phaseIds),
        s.from('event_phase_equipment').select('*, equipment_items(id, name), equipment_kits(id, name)').in('phase_id', phaseIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }] as any[];
  const vehicleRows = (vehicles.data ?? []) as any[];
  const fleetIds = vehicleRows.map((row) => row.vehicle_id).filter(Boolean);
  const { data: fleet } = fleetIds.length
    ? await s.from('vehicles').select('id, brand, model, name, registration_number').in('id', fleetIds)
    : { data: [] as any[] };
  const fleetById = new Map(((fleet ?? []) as any[]).map((vehicle) => [vehicle.id, vehicle] as [string, any]));
  const phaseTypes = uniquePhaseTypes(((types.data ?? []) as any[]));
  const eventRow = event.data as any;
  const travel = eventTravelMinutes(vehicleRows);
  // Typy dojazdu i powrotu z czasem z logistyki (jak `AddPhaseModal`): pełne 15 min albo brak (faza „elastyczna”).
  const typesWithTravel = phaseTypes.map((type: any) => {
    const rank = phaseRank(type);
    const minutes = rank === 2 ? travel.outbound : rank === 6 ? travel.inbound : undefined;
    return rank === 2 || rank === 6 ? { ...type, default_duration_hours: minutes ? (Math.ceil(minutes / 15) * 15) / 60 : null } : type;
  });
  const suggestions = Object.fromEntries(typesWithTravel.map((type: any) => {
    const usable = { ...type, default_duration_hours: type.default_duration_hours ?? Number.NaN };
    const all = typesWithTravel.map((item: any) => ({ ...item, default_duration_hours: item.default_duration_hours ?? Number.NaN }));
    return [type.id, suggestPhaseTimes(usable, all, phaseRows, eventRow.event_date, eventRow.event_end_date || eventRow.event_date)];
  }));
  const person = (employee: any) => employee ? {
    id: String(employee.id), name: `${employee.name ?? ''} ${employee.surname ?? ''}`.trim(),
    avatarUrl: employee.avatar_url ?? null, avatar: imageCrop(employee.avatar_metadata),
  } : null;
  return {
    event: {
      start: eventRow.event_date, end: eventRow.event_end_date || eventRow.event_date,
      plannedSetupAt: eventRow.planned_setup_at ?? null, plannedTeardownAt: eventRow.planned_teardown_at ?? null,
    },
    phases: phaseRows.map((phase) => {
      const type = one(phase.phase_type) as any;
      return {
        id: phase.id, name: phase.name, description: phase.description ?? null, start: phase.start_time, end: phase.end_time,
        sequenceOrder: phase.sequence_order ?? 0, color: phase.color ?? null, notes: phase.notes ?? null, typeId: phase.phase_type_id ?? null,
        typeName: type?.name ?? null, typeColor: type?.color ?? null, rank: phaseRank(type || { name: phase.name, sequence_priority: 0 }),
      };
    }),
    phaseTypes: typesWithTravel.map((type: any) => ({
      id: type.id, name: type.name, color: type.color ?? null, durationHours: type.default_duration_hours ?? null, rank: phaseRank(type),
    })),
    suggestions,
    travel,
    flexibleTravel: Array.isArray(eventRow.flexible_travel_phases) ? eventRow.flexible_travel_phases : [],
    team: ((team.data ?? []) as any[]).map((row) => person(one(row.employee))).filter(Boolean),
    assignments: (((assignments as any).data ?? []) as any[]).map((row) => ({
      id: row.id, phaseId: row.phase_id, employeeId: row.employee_id, employee: person(one(row.employee)),
      start: row.assignment_start, end: row.assignment_end, workStart: row.phase_work_start ?? null, workEnd: row.phase_work_end ?? null,
      status: row.invitation_status ?? 'pending', role: row.role ?? null, notes: row.notes ?? null,
      acceptedConflicts: [...(row.accepted_conflicts_as_a ?? []), ...(row.accepted_conflicts_as_b ?? [])].map((item: any) => {
        const by = one(item.accepted_by_employee) as any;
        return { id: item.id, reason: item.reason ?? '', acceptedAt: item.accepted_at, by: by ? `${by.name ?? ''} ${by.surname ?? ''}`.trim() : null };
      }),
    })),
    phaseVehicles: (((phaseVehicles as any).data ?? []) as any[]).map((row) => {
      const vehicle = one(row.vehicle) as any;
      const driver = one(row.driver) as any;
      return {
        id: row.id, phaseId: row.phase_id, vehicleId: row.vehicle_id, start: row.assigned_start, end: row.assigned_end,
        name: vehicle?.name || vehicle?.registration_number || 'Bez nazwy',
        registration: vehicle?.registration_number ?? null,
        driver: driver ? `${driver.name ?? ''} ${driver.surname ?? ''}`.trim() : null, purpose: row.purpose ?? null, notes: row.notes ?? null,
      };
    }),
    phaseEquipment: (((phaseEquipment as any).data ?? []) as any[]).map((row) => ({
      id: row.id, phaseId: row.phase_id, itemId: row.equipment_item_id || row.kit_id || row.cable_id,
      name: one(row.equipment_items as any)?.name || one(row.equipment_kits as any)?.name || 'Bez nazwy',
      start: row.assigned_start, end: row.assigned_end, quantity: row.quantity ?? 1, notes: row.notes ?? null,
    })),
    eventVehicles: vehicleRows.filter((row) => (row.status ?? 'planned') !== 'cancelled').map((row) => {
      const vehicle = row.vehicle_id ? fleetById.get(row.vehicle_id) : null;
      return {
        id: row.id, vehicleId: row.vehicle_id ?? null,
        name: vehicle?.name ? `${vehicle.name}${vehicle.registration_number ? ` (${vehicle.registration_number})` : ''}`
          : row.external_vehicle_name || (row.vehicle_id ? `Pojazd ${String(row.vehicle_id).slice(0, 6)}…` : 'Bez nazwy'),
        availableFrom: row.vehicle_available_from ?? null, availableUntil: row.vehicle_available_until ?? null,
      };
    }),
    eventEquipment: ((equipment.data ?? []) as any[]).map((row) => {
      const item = one(row.equipment) as any;
      const kit = one(row.kit) as any;
      return {
        id: String(item?.id || kit?.id || row.id), name: item?.name || kit?.name || 'Bez nazwy',
        category: one(item?.category as any)?.name ?? null, kind: row.equipment_id ? 'Sprzęt' : 'Zestaw', quantity: row.quantity ?? 1,
      };
    }),
  };
}

/**
 * „Zastosuj czasy przejazdu z logistyki”: tworzy oczekujące fazy dojazdu / powrotu (podpowiedź godzin jak w CRM) i zwraca
 * nowe końce istniejących faz przejazdu do zatwierdzenia na osi (zmiany robocze — zapis przyciskiem „Zapisz zmiany”).
 */
export async function applyTravelTimes(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const [event, phases, types, vehicles] = await Promise.all([
    s.from('events').select('event_date, event_end_date, flexible_travel_phases').eq('id', eventId).single(),
    s.from('event_phases').select('*, phase_type:event_phase_types(*)').eq('event_id', eventId).order('start_time', { ascending: true }),
    s.from('event_phase_types').select('*').eq('is_active', true).order('sequence_priority', { ascending: true }),
    s.from('event_vehicles').select('*').eq('event_id', eventId),
  ]);
  if (event.error || phases.error || types.error) throw new Error('Nie udało się odczytać harmonogramu.');
  const eventRow = event.data as any;
  const estimate = eventTravelMinutes((vehicles.data ?? []) as any[]);
  const phaseTypes = uniquePhaseTypes((types.data ?? []) as any[]).map((type: any) => {
    const rank = phaseRank(type);
    const minutes = rank === 2 ? estimate.outbound : rank === 6 ? estimate.inbound : null;
    return minutes ? { ...type, default_duration_hours: minutes / 60 } : type;
  });
  const current: any[] = [...((phases.data ?? []) as any[])];
  let count = 0;
  for (const template of (Array.isArray(eventRow.flexible_travel_phases) ? eventRow.flexible_travel_phases : []) as any[]) {
    const rank = template.key === 'outbound' ? 2 : 6;
    const minutes = rank === 2 ? estimate.outbound : estimate.inbound;
    if (!minutes || current.some((phase) => phaseRank(phase.phase_type || { name: phase.name, sequence_priority: 0 }) === rank)) continue;
    const type = phaseTypes.find((item: any) => phaseRank(item) === rank);
    if (!type) continue;
    const times = suggestPhaseTimes(type, phaseTypes, current, eventRow.event_date, eventRow.event_end_date || eventRow.event_date);
    if (!times) continue;
    const { data: created, error } = await s.from('event_phases').insert({
      event_id: eventId, phase_type_id: type.id, name: template.name, description: template.description || undefined,
      start_time: times.start, end_time: times.end, sequence_order: current.length + 1,
    }).select('*').single();
    if (error) throw error;
    current.push({ ...created, phase_type: type });
    count++;
    const removed = await s.rpc('save_flexible_travel_phase', { p_event_id: eventId, p_key: template.key, p_name: null, p_description: '' });
    if (removed.error) throw removed.error;
  }
  const drafts: Record<string, { start: string; end: string }> = {};
  for (const phase of (phases.data ?? []) as any[]) {
    const rank = phaseRank(phase.phase_type || { name: phase.name, sequence_priority: 0 });
    const minutes = rank === 2 ? estimate.outbound : rank === 6 ? estimate.inbound : null;
    if (!minutes) continue;
    const start = new Date(phase.start_time);
    drafts[phase.id] = { start: start.toISOString(), end: new Date(start.getTime() + minutes * 60000).toISOString() };
    count++;
  }
  return {
    drafts,
    message: count
      ? 'Czasy pobrane z logistyki. Fazy są na osi. Sprawdź godziny i zapisz zmiany harmonogramu.'
      : !estimate.outbound && !estimate.inbound
        ? 'Brak zapisanej estymacji trasy. Oblicz trasę i zapisz pojazd w Logistyce.'
        : 'Czas trasy jest dostępny. Dodaj Dojazd lub Powrót — formularz pobierze estymację.',
    ok: count > 0,
  };
}

/** Do okien przypisań: aktywni pracownicy (z informacją o zespole), flota i obecne przypisania w fazach tego wydarzenia. */
export async function phaseOptions(ctx: NativeContext, eventId: string, kind: 'employees' | 'vehicles') {
  const s = ctx.supabase;
  const { data: phases } = await s.from('event_phases').select('id').eq('event_id', eventId);
  const phaseIds = ((phases ?? []) as any[]).map((phase) => phase.id);
  if (kind === 'employees') {
    const [employees, team, assigned] = await Promise.all([
      s.rpc('employees_public_list'),
      s.from('employee_assignments').select('employee_id').eq('event_id', eventId),
      phaseIds.length ? s.from('event_phase_assignments').select('phase_id, employee_id').in('phase_id', phaseIds) : Promise.resolve({ data: [] }),
    ]);
    if (employees.error) throw employees.error;
    const teamIds = new Set(((team.data ?? []) as any[]).map((row) => row.employee_id));
    return {
      employees: ((employees.data ?? []) as any[]).filter((row) => row?.is_active === true).map((row) => ({
        id: String(row.id), name: row.name ?? '', surname: row.surname ?? '', email: row.email ?? null,
        avatarUrl: row.avatar_url ?? null, avatar: imageCrop(row.avatar_metadata), inTeam: teamIds.has(row.id),
      })),
      assigned: ((assigned as any).data ?? []).map((row: any) => ({ phaseId: row.phase_id, employeeId: row.employee_id })),
    };
  }
  const [vehicles, employees, assigned] = await Promise.all([
    s.from('fleet_vehicles_view').select('id, name, brand, model, registration_number, status, category, assigned_to'),
    s.rpc('employees_public_list'),
    phaseIds.length ? s.from('event_phase_vehicles').select('phase_id, vehicle_id').in('phase_id', phaseIds) : Promise.resolve({ data: [] }),
  ]);
  if (vehicles.error) throw vehicles.error;
  return {
    vehicles: ((vehicles.data ?? []) as any[]).filter((row) => row.category !== 'trailer').map((row) => ({
      id: String(row.id), name: row.name ?? null, brand: row.brand ?? null, model: row.model ?? null,
      registration: row.registration_number ?? null, status: row.status ?? null, assignedTo: row.assigned_to ?? null,
    })),
    employees: ((employees.data ?? []) as any[]).filter((row) => row?.is_active === true)
      .map((row) => ({ id: String(row.id), name: `${row.name ?? ''} ${row.surname ?? ''}`.trim() })),
    assigned: ((assigned as any).data ?? []).map((row: any) => ({ phaseId: row.phase_id, vehicleId: row.vehicle_id })),
  };
}

/** Kolizje pojazdu z fazami innych wydarzeń w zakresie rezerwacji (`AddPhaseVehicleModal`). */
export async function vehicleConflicts(ctx: NativeContext, eventId: string, vehicleId: string, start: string, end: string) {
  const { data, error } = await ctx.supabase.from('event_phase_vehicles')
    .select('id, phase_id, assigned_start, assigned_end, phase:event_phases!event_phase_vehicles_phase_id_fkey(id, event_id, name)')
    .eq('vehicle_id', vehicleId).lt('assigned_start', end).gt('assigned_end', start);
  if (error) return [];
  return ((data ?? []) as any[]).filter((item) => (one(item.phase) as any)?.event_id !== eventId).map((item) => ({
    id: item.id, label: (one(item.phase) as any)?.name || 'Inna faza wydarzenia', start: item.assigned_start, end: item.assigned_end,
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Rejestr zakładek i zapisy
// ---------------------------------------------------------------------------------------------------------------

const TABS: Record<string, (ctx: NativeContext, eventId: string) => Promise<unknown>> = {
  phases: phasesTab,
};

export const isEventTab = (tab: string) => Object.prototype.hasOwnProperty.call(TABS, tab);

export function registerEventTab(tab: string, loader: (ctx: NativeContext, eventId: string) => Promise<unknown>) {
  TABS[tab] = loader;
}

export async function eventTabWithHash(ctx: NativeContext, eventId: string, tab: string, known: string | null) {
  const data = await TABS[tab](ctx, eventId);
  const hash = digest(data);
  return known && known === hash ? { hash, unchanged: true } : { hash, data };
}

// Czynności i odczyty pomocnicze zakładek (`op=tabAction` / `op=tabQuery`) — moduły zakładek rejestrują je przy imporcie.
type TabAction = (ctx: NativeContext, eventId: string, body: Record<string, any>) => Promise<unknown>;
type TabQuery = (ctx: NativeContext, eventId: string, params: URLSearchParams) => Promise<unknown>;
const ACTIONS: Record<string, Record<string, TabAction>> = {};
const QUERIES: Record<string, Record<string, TabQuery>> = {};
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

export function registerEventActions(tab: string, actions: Record<string, TabAction>) {
  ACTIONS[tab] = { ...(ACTIONS[tab] || {}), ...actions };
}
export function registerEventQueries(tab: string, queries: Record<string, TabQuery>) {
  QUERIES[tab] = { ...(QUERIES[tab] || {}), ...queries };
}
export async function eventTabAction(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const tab = String(body.tab || ''), action = String(body.action || '');
  if (!own(ACTIONS, tab) || !own(ACTIONS[tab], action)) throw new Error('Niedozwolona operacja.');
  return ACTIONS[tab][action](ctx, eventId, body);
}
export async function eventTabQuery(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const tab = params.get('tab') || '', query = params.get('query') || '';
  if (!own(QUERIES, tab) || !own(QUERIES[tab], query)) throw new Error('Nieznany odczyt.');
  return QUERIES[tab][query](ctx, eventId, params);
}

type TableRule = { parent: 'event' | 'phase'; insert: string[]; update: string[]; remove: boolean };

/** Tabele i kolumny zapisywane z kart Maca (jak zapisy przeglądarki) — reszta tylko przez RPC. */
const TABLES: Record<string, TableRule> = {
  event_phases: {
    parent: 'event', remove: true,
    insert: ['phase_type_id', 'name', 'description', 'start_time', 'end_time', 'sequence_order', 'color', 'notes'],
    update: ['name', 'description', 'start_time', 'end_time', 'sequence_order', 'color', 'notes'],
  },
  event_phase_assignments: {
    parent: 'phase', remove: true, insert: [],
    update: ['assignment_start', 'assignment_end', 'phase_work_start', 'phase_work_end', 'role', 'notes', 'travel_to_notes', 'travel_from_notes'],
  },
  event_phase_vehicles: { parent: 'phase', remove: true, insert: [], update: ['assigned_start', 'assigned_end', 'notes', 'purpose'] },
  event_phase_equipment: { parent: 'phase', remove: true, insert: [], update: ['assigned_start', 'assigned_end', 'notes'] },
};

export function registerEventTable(table: string, rule: TableRule) {
  TABLES[table] = rule;
}

async function rowBelongsToEvent(ctx: NativeContext, table: string, rule: TableRule, id: string, eventId: string) {
  if (rule.parent === 'event') {
    const { data } = await ctx.supabase.from(table).select('event_id').eq('id', id).maybeSingle();
    return (data as any)?.event_id === eventId;
  }
  const { data } = await ctx.supabase.from(table).select('phase:event_phases!inner(event_id)').eq('id', id).maybeSingle();
  return (one((data as any)?.phase) as any)?.event_id === eventId;
}

/**
 * Zapis z karty wydarzenia: `{table, action: insert|update|delete, id?, data}` — tylko dozwolone tabele i kolumny, wiersz musi
 * należeć do tego wydarzenia; o reszcie decyduje RLS (token pracownika), dokładnie jak przy zapisie z przeglądarki.
 */
export async function eventMutate(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const table = String(body.table || '');
  const rule = TABLES[table];
  if (!rule) throw new Error('Niedozwolona operacja.');
  const action = String(body.action || '');
  const input = body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {};
  const pick = (keys: string[]) => Object.fromEntries(Object.entries(input).filter(([key]) => keys.includes(key)));
  if (action === 'insert') {
    if (!rule.insert.length) throw new Error('Niedozwolona operacja.');
    const data: Record<string, unknown> = pick(rule.insert);
    if (rule.parent === 'event') data.event_id = eventId;
    else {
      const phaseId = String(input.phase_id || '');
      const { data: phase } = await ctx.supabase.from('event_phases').select('event_id').eq('id', phaseId).maybeSingle();
      if ((phase as any)?.event_id !== eventId) throw new Error('Nieprawidłowa faza.');
      data.phase_id = phaseId;
    }
    const { data: row, error } = await ctx.supabase.from(table).insert(data).select('*').single();
    if (error) throw error;
    return row;
  }
  const id = String(body.id || '');
  if (!id || !(await rowBelongsToEvent(ctx, table, rule, id, eventId))) throw new Error('Nie znaleziono wpisu albo nie masz do niego dostępu.');
  if (action === 'update') {
    const data = pick(rule.update);
    if (!Object.keys(data).length) throw new Error('Brak zmian.');
    const { data: rows, error } = await ctx.supabase.from(table).update(data).eq('id', id).select('*');
    if (error) throw error;
    if (!rows?.length) throw new Error('Nie masz uprawnień do zmiany tego wpisu.');
    return rows[0];
  }
  if (action === 'delete' && rule.remove) {
    const { error } = await ctx.supabase.from(table).delete().eq('id', id);
    if (error) throw error;
    return { id };
  }
  throw new Error('Niedozwolona operacja.');
}
