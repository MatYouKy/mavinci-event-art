import 'server-only';
import type { NativeContext } from './auth';
import { compareEquipmentOrder, equipmentRowOrderKey } from '@/lib/events/equipment/equipmentChecklist';
import { imageCrop } from './team';
import { registerEventActions, registerEventQueries, registerEventTab } from './eventTabs';
import { kitEventLimits } from '@/lib/CRM/equipment/kitInventory';
import { checklistNoteRecords } from '@/lib/CRM/equipmentChecklistNotes';
import {
  EQUIPMENT_CHECKLIST_RPC,
  EQUIPMENT_RETURN_PHOTO_BUCKET,
  EQUIPMENT_RETURN_PHOTO_LIMIT,
  equipmentReturnPhotoPath,
  isEquipmentChecklistMissing,
  parseEquipmentChecklist,
} from '@/lib/events/equipment/equipmentChecklist';

/*
 * Zakładka „Sprzęt” karty wydarzenia dla Maca — te same zapytania i zapisy co `EventEquipmentTab`, `useEventEquipment`,
 * `AddEquipmentModal`, `RequiredComponentsWarning`, `SelectRentalEquipmentModal`, `EquipmentChecklistNotes` i checklista
 * etapów (`useEquipmentChecklist`), tokenem pracownika (RLS). Dostępność liczy serwer dokładnie jak hook przeglądarki.
 */

type ItemType = 'item' | 'kit' | 'cable';
export type EquipmentAvailability = {
  total_quantity: number; reserved_quantity: number; used_by_this_event: number; available_in_term: number; max_add: number; max_set: number;
};
type ByKey = Record<string, EquipmentAvailability>;

const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const num = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const keyOf = (type: ItemType, id: string) => `${type}-${id}`;
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const ACTIVE_STATUS = 'status.is.null,status.not.in.(cancelled,returned)';

function fail(message: string): never {
  throw new Error(message);
}
function dbFail(error: any, fallback: string): never {
  throw new Error(error?.message || fallback);
}

/** `getUiLimits` z zakładki Sprzęt. */
function uiLimits(avail?: EquipmentAvailability | null) {
  if (!avail) return { used: 0, availableInTerm: 0, maxAdd: 0, maxSet: 0, total: 0, reserved: 0 };
  const used = num(avail.used_by_this_event, 0);
  const availableInTerm = num(avail.available_in_term, 0);
  const maxAdd = num(avail.max_add, Math.max(0, availableInTerm - used));
  const maxSet = num(avail.max_set, used + maxAdd);
  return { used, availableInTerm, maxAdd, maxSet, total: num(avail.total_quantity, 0), reserved: num(avail.reserved_quantity, 0) + used };
}

/** `buildInEventMap` (`useEventEquipment`) — liczy tylko pola pobierane przez `getAllEventEquipmentForAvailability`. */
function buildInEventMap(rows: any[]) {
  const map = new Map<string, number>();
  const add = (type: ItemType, id: string, qty: number) => map.set(keyOf(type, id), (map.get(keyOf(type, id)) ?? 0) + qty);
  for (const row of rows || []) {
    if (row?.removed_from_offer || row?.use_external_rental || (row?.status && !['reserved', 'in_use'].includes(row.status))) continue;
    const qty = Number(row?.quantity ?? 0);
    if (row?.equipment_id) add('item', row.equipment_id, qty);
    if (row?.cable_id) add('cable', row.cable_id, qty);
    const kit = one(row?.kit) as any;
    const kitId = row?.kit_id ?? kit?.id;
    if (kitId) {
      add('kit', kitId, qty);
      for (const item of list(kit?.equipment_kit_items)) {
        const componentQty = Number(item?.quantity ?? 0) * qty;
        if (item?.equipment_id) add('item', item.equipment_id, componentQty);
        if (item?.cable_id) add('cable', item.cable_id, componentQty);
      }
    }
  }
  return map;
}

type EventDates = { id: string; event_date: string | null; event_end_date: string | null };

async function eventDates(ctx: NativeContext, eventId: string): Promise<EventDates> {
  const { data, error } = await ctx.supabase.from('events').select('id, event_date, event_end_date').eq('id', eventId).single();
  if (error || !data) dbFail(error, 'Nie znaleziono wydarzenia albo nie masz do niego dostępu.');
  return data as EventDates;
}

const dayAfter = (iso: string) => {
  const date = new Date(iso);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
};

/**
 * `fetchAvailableEquipment` z `useEventEquipment`: dostępność w terminie (RPC magazynu), kable, sprawdzenie pojedynczych pozycji
 * bez stanu w RPC i limity zestawów (`kitEventLimits`). `catalog` — także pełne listy sprzętu i zestawów do okna „Dodaj sprzęt”.
 */
async function availability(ctx: NativeContext, event: EventDates, catalog: boolean | 'all') {
  const s = ctx.supabase;
  const { data: allRows, error: rowsError } = await s.from('event_equipment')
    .select('id, equipment_id, cable_id, kit_id, quantity, removed_from_offer, kit:equipment_kits(id, equipment_kit_items(equipment_id, cable_id, quantity))')
    .eq('event_id', event.id);
  if (rowsError) throw rowsError;
  const usedMap = buildInEventMap(allRows ?? []);
  let baseRows: any[] = [];
  if (event.event_date && event.event_end_date) {
    const { data, error } = await s.rpc('check_equipment_inventory_for_event', {
      p_event_id: event.id, p_start_date: event.event_date, p_end_date: event.event_end_date,
    });
    if (error) throw error;
    baseRows = data || [];
  } else {
    const { data } = await s.from('equipment_items').select('id, total_quantity');
    baseRows = (data || []).map((it: any) => ({
      item_id: it.id, item_type: 'item', total_quantity: num(it.total_quantity), reserved_quantity: 0, available_quantity: num(it.total_quantity),
    }));
  }
  const byKey: ByKey = {};
  const set = (key: string, total: number, reserved: number, available: number) => {
    const used = Number(usedMap.get(key) ?? 0);
    const availableInTerm = Math.max(0, available);
    const maxAdd = Math.max(0, availableInTerm - used);
    byKey[key] = { total_quantity: total, reserved_quantity: reserved, used_by_this_event: used, available_in_term: availableInTerm, max_add: maxAdd, max_set: used + maxAdd };
  };
  for (const row of baseRows) {
    set(keyOf(row.item_type, row.item_id), Math.max(0, num(row.total_quantity)), Math.max(0, num(row.reserved_quantity)), num(row.available_quantity));
  }
  let cableRows: any[] = [];
  if (event.event_date) {
    const { data, error } = await s.rpc('get_cable_availability_for_event', {
      p_event_id: event.id, p_start_date: event.event_date, p_end_date: event.event_end_date || dayAfter(event.event_date),
    });
    if (error) throw error;
    cableRows = data || [];
  } else {
    const { data, error } = await s.from('cables').select('id, stock_quantity').eq('is_active', true).is('deleted_at', null);
    if (error) throw error;
    cableRows = (data || []).map((cable: any) => ({
      cable_id: cable.id, total_quantity: num(cable.stock_quantity), reserved_quantity: 0, available_quantity: num(cable.stock_quantity),
    }));
  }
  for (const cable of cableRows) set(keyOf('cable', cable.cable_id), num(cable.total_quantity), num(cable.reserved_quantity), num(cable.available_quantity));

  const { data: allItems, error: itemsError } = await s.from('equipment_items')
    .select(catalog ? '*, category:warehouse_categories(name)' : 'id, total_quantity').order('name');
  let items: any[] = [];
  if (!itemsError && allItems) {
    const candidates = (allItems as any[]).filter((item) => num(item.total_quantity) > 0 && num(byKey[keyOf('item', item.id)]?.total_quantity) === 0);
    if (candidates.length > 0 && event.event_date) {
      const endDate = event.event_end_date || dayAfter(event.event_date);
      const verifyOne = async (item: any) => {
        const { data, error } = await s.rpc('check_single_equipment_availability_for_event', {
          p_event_id: event.id, p_equipment_id: item.id, p_start_date: event.event_date, p_end_date: endDate,
        });
        if (error || !data?.[0]) return false;
        const row = data[0] as any;
        set(keyOf('item', item.id), Math.max(0, num(row.total_quantity)), Math.max(0, num(row.reserved_quantity)), num(row.available_quantity));
        return true;
      };
      const first = await verifyOne(candidates[0]);
      if (first && candidates.length > 1) await Promise.all(candidates.slice(1).map(verifyOne));
    }
    if (catalog) {
      items = (allItems as any[]).map((it) => {
        const a = byKey[keyOf('item', it.id)];
        return {
          id: it.id, name: it.name || 'Sprzęt', brand: it.brand || '', model: it.model || '', category: (one(it.category) as any)?.name || '',
          thumbnail: it.thumbnail_url || null, total: a?.total_quantity ?? 0, reserved: a?.reserved_quantity ?? 0, used: a?.used_by_this_event ?? 0,
          availableInTerm: a?.available_in_term ?? 0, maxAdd: a?.max_add ?? 0, maxSet: a?.max_set ?? 0,
        };
      }).filter((item) => catalog === 'all' || item.maxAdd > 0);
    }
  }

  const { data: kits, error: kitsError } = await s.from('equipment_kits').select(`
    *,
    equipment_kit_items(
      equipment_id, cable_id, quantity,
      equipment_items(id, name, brand, model, thumbnail_url, category:warehouse_categories(name)),
      cables(id, name, length_meters, thumbnail_url)
    )`).order('name');
  let kitList: any[] = [];
  if (!kitsError && kits) {
    kitList = (kits as any[]).map((kit) => {
      const kitKey = keyOf('kit', kit.id);
      const used = Number(usedMap.get(kitKey) ?? 0);
      const reservedElsewhere = num(baseRows.find((row) => row.item_type === 'kit' && row.item_id === kit.id)?.reserved_quantity);
      const { maxAdd, maxSet } = kitEventLimits(kit, byKey, used, reservedElsewhere);
      byKey[kitKey] = {
        total_quantity: num(kit.quantity), reserved_quantity: reservedElsewhere, used_by_this_event: used, available_in_term: maxSet, max_add: maxAdd, max_set: maxSet,
      };
      return {
        id: kit.id, name: kit.name || 'Zestaw', description: kit.description || '', thumbnail: kit.thumbnail_url || null,
        total: num(kit.quantity), reserved: reservedElsewhere, used, availableInTerm: maxSet, maxAdd, maxSet,
        contents: list(kit.equipment_kit_items).map((it: any, index: number) => {
          const eq = one(it.equipment_items) as any, cb = one(it.cables) as any;
          return {
            id: String(eq?.id || cb?.id || `${index}`), name: eq?.name || cb?.name || 'Nieznany element', brand: eq?.brand || '', model: eq?.model || '',
            lengthMeters: cb ? (cb.length_meters ?? null) : null, quantity: num(it.quantity, 1),
          };
        }),
      };
    });
  }
  return { byKey, items, kits: kitList, loaded: Object.keys(byKey).length > 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// Wiersze sprzętu wydarzenia (`getEventEquipment`)
// ---------------------------------------------------------------------------------------------------------------

const EQUIPMENT_SELECT = `
  *,
  equipment:equipment_items(name, brand, model, cable_specs, thumbnail_url, warehouse_category_id, category:warehouse_categories(id, name, parent_id)),
  kit:equipment_kits(name, thumbnail_url, category:warehouse_categories(name), items:equipment_kit_items(quantity, equipment:equipment_items(name, brand, model, cable_specs, thumbnail_url, warehouse_category_id, category:warehouse_categories(id, name, parent_id)))),
  cable:cables(id, name, description, length_meters, stock_unit, thumbnail_url, category:warehouse_categories(name))`;

async function equipmentRows(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.from('event_equipment').select(EQUIPMENT_SELECT).eq('event_id', eventId)
    .or('removed_from_offer.is.null,removed_from_offer.eq.false').order('created_at', { ascending: true });
  if (error) throw error;
  // Jedna kolejność wszędzie (CRM, Mac, telefon, PDF): zestawy, sprzęt, przewody; kategoria, nazwa.
  return ((data || []) as any[]).sort((a, b) => compareEquipmentOrder(equipmentRowOrderKey(a), equipmentRowOrderKey(b)));
}

const rowKey = (row: any): string | null =>
  row?.equipment_id ? keyOf('item', row.equipment_id) : row?.kit_id ? keyOf('kit', row.kit_id) : row?.cable_id ? keyOf('cable', row.cable_id) : null;

function mapRow(row: any, loadedBy: Map<string, any>) {
  const equipment = one(row.equipment) as any, kit = one(row.kit) as any, cable = one(row.cable) as any;
  const kind: ItemType = row.kit_id || kit ? 'kit' : row.cable_id || cable ? 'cable' : 'item';
  const employee = row.loaded_by ? loadedBy.get(row.loaded_by) : null;
  return {
    id: row.id,
    kind,
    key: rowKey(row),
    equipmentId: row.equipment_id ?? null,
    kitId: row.kit_id ?? null,
    cableId: row.cable_id ?? null,
    name: kind === 'kit' ? kit?.name || 'Zestaw' : (equipment || cable)?.name || 'Nieznany',
    brand: equipment?.brand || '',
    model: equipment?.model || '',
    category: (one(equipment?.category) as any)?.name || '',
    warehouseCategoryId: equipment?.warehouse_category_id ?? null,
    thumbnail: (kind === 'kit' ? kit?.thumbnail_url : (equipment || cable)?.thumbnail_url) || null,
    cableLength: cable?.length_meters ?? null,
    unit: cable?.stock_unit === 'meter' ? 'm' : 'szt.',
    quantity: num(row.quantity),
    status: row.status || '',
    autoAdded: row.auto_added === true,
    fromOffer: row.auto_added === true || Boolean(row.offer_id),
    offerId: row.offer_id ?? null,
    optional: row.is_optional === true,
    rental: row.status === 'rental' || row.use_external_rental === true,
    removed: row.removed_from_offer === true,
    loaded: row.is_loaded === true,
    loadedBy: employee ? { name: `${employee.first_name ?? ''} ${employee.last_name ?? ''}`.trim(), avatarUrl: employee.avatar_url ?? null } : null,
    expandInChecklist: row.expand_kit_in_checklist === true,
    notes: row.notes || '',
    kitItems: list(kit?.items).map((item: any) => {
      const eq = one(item?.equipment) as any;
      return {
        name: eq?.name || 'Nieznany', brand: eq?.brand || '', model: eq?.model || '', category: (one(eq?.category) as any)?.name || '',
        thumbnail: eq?.thumbnail_url || null, quantity: num(item?.quantity),
      };
    }),
  };
}

async function loadedByEmployees(ctx: NativeContext, rows: any[]) {
  const ids = Array.from(new Set(rows.map((row) => row.loaded_by).filter(Boolean)));
  const map = new Map<string, any>();
  if (ids.length) {
    const { data } = await ctx.supabase.from('employees').select('id, first_name, last_name, avatar_url').in('id', ids);
    for (const employee of data || []) map.set((employee as any).id, employee);
  }
  return map;
}

// ---------------------------------------------------------------------------------------------------------------
// Komponenty sprzętu (`RequiredComponentsWarning`)
// ---------------------------------------------------------------------------------------------------------------

const COMPONENT_SELECT = `
  id, equipment_id, compatible_equipment_id, compatible_kit_id, compatible_cable_id, compatibility_type, compatibility_group, quantity, quantity_mode,
  compatible_equipment:equipment_items!compatible_equipment_id(id, name, model, brand, thumbnail_url),
  compatible_kit:equipment_kits!compatible_kit_id(id, name, description, thumbnail_url),
  compatible_cable:cables!compatible_cable_id(id, name, description, length_meters, thumbnail_url, stock_unit)`;

const componentKey = (c: any) =>
  c.compatible_equipment_id ? keyOf('item', c.compatible_equipment_id) : c.compatible_kit_id ? keyOf('kit', c.compatible_kit_id) : c.compatible_cable_id ? keyOf('cable', c.compatible_cable_id) : null;

const requiredQuantity = (c: any, source: number) => {
  const base = Math.max(1, Number(c.quantity ?? 1));
  return c.quantity_mode === 'fixed' ? base : base * Math.max(1, source);
};

/** Niespełnione grupy komponentów dla każdego sprzętu (`checkRequiredComponents`) — po jednym zapytaniu na całą listę. */
async function componentGroups(ctx: NativeContext, eventId: string, equipmentIds: string[]) {
  const ids = Array.from(new Set(equipmentIds.filter(Boolean)));
  const result: Record<string, { sourceQuantity: number; defined: boolean; groups: any[] }> = {};
  if (!ids.length) return result;
  const s = ctx.supabase;
  const [compat, active, reviews] = await Promise.all([
    s.from('equipment_compatible_items').select(COMPONENT_SELECT).in('equipment_id', ids).in('compatibility_type', ['required', 'recommended', 'optional']),
    s.from('event_equipment').select('equipment_id, kit_id, cable_id, quantity').eq('event_id', eventId).or(ACTIVE_STATUS),
    s.from('event_equipment_component_reviews').select('equipment_id, dismissed_component_ids').eq('event_id', eventId).in('equipment_id', ids),
  ]);
  if (compat.error) throw compat.error;
  if (active.error) throw active.error;
  if (reviews.error) throw reviews.error;
  const sum = (field: string) => {
    const map = new Map<string, number>();
    for (const row of active.data || []) {
      const id = (row as any)[field];
      if (id) map.set(id, (map.get(id) ?? 0) + Number((row as any).quantity ?? 0));
    }
    return map;
  };
  const existingItems = sum('equipment_id'), existingKits = sum('kit_id'), existingCables = sum('cable_id');
  const dismissedBy = new Map<string, Set<string>>();
  for (const review of reviews.data || []) dismissedBy.set((review as any).equipment_id, new Set(list((review as any).dismissed_component_ids).map(String)));
  for (const equipmentId of ids) {
    const all = (compat.data || []).filter((c: any) => c.equipment_id === equipmentId);
    const sourceQuantity = Math.max(1, existingItems.get(equipmentId) ?? 0);
    const dismissed = dismissedBy.get(equipmentId) ?? new Set<string>();
    const mapped = all.filter((c: any) => !dismissed.has(c.id)).map((c: any) => {
      const eq = one(c.compatible_equipment) as any, kit = one(c.compatible_kit) as any, cable = one(c.compatible_cable) as any;
      const existing = c.compatible_equipment_id ? existingItems.get(c.compatible_equipment_id) ?? 0
        : c.compatible_kit_id ? existingKits.get(c.compatible_kit_id) ?? 0
          : c.compatible_cable_id ? existingCables.get(c.compatible_cable_id) ?? 0 : 0;
      const required = requiredQuantity(c, sourceQuantity);
      const item = eq || kit || cable;
      return {
        id: c.id,
        type: c.compatibility_type,
        group: c.compatibility_group || null,
        kind: c.compatible_equipment_id ? 'item' : c.compatible_kit_id ? 'kit' : 'cable',
        targetId: c.compatible_equipment_id || c.compatible_kit_id || c.compatible_cable_id || null,
        key: componentKey(c),
        name: item?.name || null,
        brand: eq?.brand || '',
        model: eq?.model || '',
        description: kit?.description || cable?.description || '',
        lengthMeters: cable?.length_meters ?? null,
        unit: cable?.stock_unit === 'meter' ? 'm' : 'szt.',
        thumbnail: item?.thumbnail_url || null,
        required,
        existing,
        missing: Math.max(0, required - existing),
      };
    });
    const satisfied = (c: any) => (c.type !== 'required' ? c.existing > 0 : c.existing >= c.required);
    const grouped = new Map<string, any[]>();
    for (const c of mapped) {
      const key = c.group || `single_${c.id}`;
      grouped.set(key, [...(grouped.get(key) ?? []), c]);
    }
    const groups: any[] = [];
    for (const components of Array.from(grouped.values())) {
      if (components[0].group) {
        if (!components.some(satisfied)) {
          groups.push({ name: components[0].group, required: components.some((c) => c.type === 'required'),
            recommended: components.some((c) => c.type === 'recommended'), components });
        }
      } else if (!satisfied(components[0])) {
        groups.push({ name: null, required: components[0].type === 'required', recommended: components[0].type === 'recommended', components });
      }
    }
    result[equipmentId] = { sourceQuantity, defined: all.length > 0, groups };
  }
  return result;
}

/** „Gdzie jest zajęty?” (`loadConflicts`) i sprawdzenie stanu przez administratora (`verifyAdminInventory`). */
async function componentConflicts(ctx: NativeContext, eventId: string, key: string, existing: number) {
  const s = ctx.supabase;
  const [type, ...rest] = key.split('-');
  const itemId = rest.join('-');
  if (!['item', 'kit', 'cable'].includes(type) || !uuid.test(itemId)) fail('Nieprawidłowy komponent.');
  const { data: current, error: currentError } = await s.from('events').select('event_date,event_end_date').eq('id', eventId).single();
  if (currentError) throw currentError;
  const start = new Date((current as any).event_date).getTime();
  const end = new Date((current as any).event_end_date || new Date(start + 86_400_000).toISOString()).getTime();
  const field = type === 'item' ? 'equipment_id' : type === 'kit' ? 'kit_id' : 'cable_id';
  const { data: direct, error: directError } = await s.from('event_equipment').select('id,event_id,quantity,status').eq(field, itemId).neq('event_id', eventId);
  if (directError) throw directError;
  let kitRows: any[] = [];
  if (type === 'item') {
    const { data: kitItems, error } = await s.from('equipment_kit_items').select('kit_id').eq('equipment_id', itemId);
    if (error) throw error;
    const kitIds = Array.from(new Set((kitItems || []).map((row: any) => row.kit_id)));
    if (kitIds.length) {
      const { data, error: kitError } = await s.from('event_equipment').select('id,event_id,quantity,status').in('kit_id', kitIds).neq('event_id', eventId);
      if (kitError) throw kitError;
      kitRows = data || [];
    }
  }
  const activeRows = [...(direct || []).map((row: any) => ({ ...row, source: 'direct' })), ...kitRows.map((row) => ({ ...row, source: 'kit' }))]
    .filter((row) => !['cancelled', 'returned'].includes(String(row.status || 'reserved')));
  const relatedIds = Array.from(new Set(activeRows.map((row) => row.event_id).filter(Boolean)));
  let conflicts: any[] = [];
  if (relatedIds.length) {
    const { data: events, error } = await s.from('events').select('id,name,event_date,event_end_date,status').in('id', relatedIds);
    if (error) throw error;
    const byId = new Map((events || []).map((event: any) => [event.id, event] as [string, any]));
    conflicts = activeRows.flatMap((row) => {
      const event = byId.get(row.event_id);
      if (!event || event.status === 'cancelled') return [];
      const conflictStart = new Date(event.event_date).getTime();
      const conflictEnd = new Date(event.event_end_date || new Date(conflictStart + 86_400_000).toISOString()).getTime();
      if (conflictStart >= end || conflictEnd <= start) return [];
      return [{
        reservationId: row.id, eventId: row.event_id, eventName: event.name || 'Wydarzenie bez nazwy', start: event.event_date,
        end: event.event_end_date || new Date(conflictEnd).toISOString(), quantity: Number(row.quantity || 1), source: row.source,
      }];
    });
  }
  let verified: EquipmentAvailability | null = null;
  if (!conflicts.length && ctx.employee.isAdmin && type === 'item') {
    const [{ data: item, error: itemError }, { data: units, error: unitsError }] = await Promise.all([
      s.from('equipment_items').select('total_quantity').eq('id', itemId).single(),
      s.from('equipment_units').select('id,status').eq('equipment_id', itemId),
    ]);
    if (!itemError && !unitsError) {
      const active = (units || []).filter((unit: any) => ['available', 'reserved', 'in_use'].includes(String(unit.status))).length;
      const total = (units || []).length > 0 ? active : Math.max(0, num((item as any)?.total_quantity));
      const available = Math.max(0, total - existing);
      verified = { total_quantity: total, reserved_quantity: 0, used_by_this_event: existing, available_in_term: available, max_add: available, max_set: total };
    }
  }
  return { conflicts, verified };
}

// ---------------------------------------------------------------------------------------------------------------
// Kalkulacja (`loadCalculationEquipment`) i konflikty oferty
// ---------------------------------------------------------------------------------------------------------------

async function calculationEquipment(ctx: NativeContext, eventId: string): Promise<{ calculationId: string | null; items: any[] }> {
  const s = ctx.supabase;
  const { data, error } = await s.rpc('get_event_calculation_equipment', { p_event_id: eventId });
  if (!error) {
    const result = (data ?? {}) as any;
    return { calculationId: result.calculation_id ?? null, items: Array.isArray(result.items) ? result.items : [] };
  }
  if (!['42883', 'PGRST202'].includes(error.code ?? '')) throw error;
  const { data: eventData, error: eventError } = await s.from('events').select('accepted_calculation_id, financial_source').eq('id', eventId).maybeSingle();
  if (eventError) throw eventError;
  if (!(eventData as any)?.accepted_calculation_id || (eventData as any).financial_source !== 'calculation') return { calculationId: null, items: [] };
  const { data: items, error: itemsError } = await s.from('event_calculation_items')
    .select('id, calculation_id, category, name, description, unit, quantity, days, source, source_ref, position')
    .eq('calculation_id', (eventData as any).accepted_calculation_id).eq('category', 'equipment').order('position');
  if (itemsError) throw itemsError;
  return { calculationId: (eventData as any).accepted_calculation_id, items: items ?? [] };
}

/** Pozycje kalkulacji spoza magazynu (`fetchAcceptedCalculation`). */
export async function calculationExternalItems(ctx: NativeContext, eventId: string) {
  const { calculationId, items } = await calculationEquipment(ctx, eventId);
  if (!calculationId) return { calculationId: null, external: [] as any[] };
  const external = items.filter((item: any) => item.source !== 'warehouse' && !item.source_ref)
    .map((item: any) => ({ name: item.name, quantity: num(item.quantity), unit: item.unit || 'szt.', description: item.description || '' }));
  return { calculationId, external };
}

/** Nierozwiązane konflikty sprzętu w ofertach wydarzenia i najnowsza oferta („Rozwiąż konflikty”). */
async function unresolvedOfferConflicts(ctx: NativeContext, eventId: string) {
  const { data: offers, error } = await ctx.supabase.from('offers').select('id, created_at').eq('event_id', eventId).order('created_at', { ascending: false });
  if (error || !offers?.length) return { has: false, latestOfferId: null as string | null };
  const latestOfferId = (offers[0] as any).id as string;
  const { data: conflicts, error: conflictsError } = await ctx.supabase.from('offer_equipment_conflicts').select('id')
    .eq('status', 'unresolved').in('offer_id', offers.map((offer: any) => offer.id)).limit(1);
  if (conflictsError) return { has: false, latestOfferId };
  return { has: (conflicts?.length || 0) > 0, latestOfferId };
}

// ---------------------------------------------------------------------------------------------------------------
// Zakładki: „equipment” (lista, dostępność, komponenty, kalkulacja, notatki) i „equipment-checklist” (etapy)
// ---------------------------------------------------------------------------------------------------------------

const photoBase = () => `${(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')}/storage/v1/object/public/${EQUIPMENT_RETURN_PHOTO_BUCKET}/`;

async function equipmentTab(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const { data: event, error } = await s.from('events')
    .select('id, name, event_date, event_end_date, has_equipment_shortage, equipment_checklist_pdf_path, equipment_checklist_modified, loading_confirmed, loading_confirmed_at, equipment_checklist_notes, equipment_checklist_note_items')
    .eq('id', eventId).single();
  if (error || !event) dbFail(error, 'Nie znaleziono wydarzenia albo nie masz do niego dostępu.');
  const e = event as any;
  const [rows, reviews, calculation, hasConflicts] = await Promise.all([
    equipmentRows(ctx, eventId),
    s.from('event_equipment_component_reviews').select('id, equipment_id, source, equipment:equipment_items(name)').eq('event_id', eventId).eq('status', 'pending').order('created_at'),
    calculationExternalItems(ctx, eventId).catch(() => ({ calculationId: null, external: [] as any[] })),
    unresolvedOfferConflicts(ctx, eventId),
  ]);
  const [loadedBy, avail] = await Promise.all([loadedByEmployees(ctx, rows), availability(ctx, e as EventDates, false)]);
  const queue = (reviews.error ? [] : reviews.data || []).map((row: any) => ({
    id: row.id, equipmentId: row.equipment_id, name: (one(row.equipment) as any)?.name || 'Sprzęt', source: row.source,
  }));
  const mapped = rows.map((row) => mapRow(row, loadedBy));
  const components = await componentGroups(ctx, eventId, [
    ...mapped.filter((row) => row.kind !== 'kit' && row.equipmentId).map((row) => row.equipmentId as string),
    ...queue.map((review: any) => review.equipmentId),
  ]);
  const keys = new Set<string>(mapped.map((row) => row.key).filter(Boolean) as string[]);
  for (const entry of Object.values(components)) for (const group of entry.groups) for (const c of group.components) if (c.key) keys.add(c.key);
  const availabilitySubset: ByKey = {};
  for (const key of Array.from(keys)) if (avail.byKey[key]) availabilitySubset[key] = avail.byKey[key];
  return {
    event: {
      name: e.name || 'Wydarzenie', start: e.event_date ?? null, end: e.event_end_date ?? null, hasShortage: e.has_equipment_shortage === true,
      checklistPdfPath: e.equipment_checklist_pdf_path ?? null, checklistModified: e.equipment_checklist_modified === true,
      loadingConfirmed: e.loading_confirmed === true, loadingConfirmedAt: e.loading_confirmed_at ?? null,
    },
    rows: mapped,
    availability: availabilitySubset,
    availabilityLoaded: avail.loaded,
    reviews: queue,
    components,
    hasUnresolvedConflicts: hasConflicts.has,
    latestOfferId: hasConflicts.latestOfferId,
    calculationId: calculation.calculationId,
    external: calculation.external,
    notes: checklistNoteRecords(e.equipment_checklist_note_items, e.equipment_checklist_notes),
    canVerifyInventory: ctx.employee.isAdmin,
    photoBase: photoBase(),
  };
}

/** Checklista etapów w postaci `parseEquipmentChecklist` + kadrowanie awatarów osób. */
function normalizedChecklist(raw: unknown, eventId: string) {
  const parsed = parseEquipmentChecklist(raw);
  if (!parsed || parsed.event_id !== eventId) return null;
  const people: Record<string, unknown> = {};
  for (const [id, person] of Object.entries(parsed.people)) {
    people[id] = { id, name: person.name, avatar_url: person.avatar_url, avatar: imageCrop(person.avatar_metadata as any) };
  }
  return { ...parsed, people };
}

async function checklistTab(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.rpc(EQUIPMENT_CHECKLIST_RPC.get, { p_event: eventId });
  if (error) {
    if (isEquipmentChecklistMissing(error)) return { status: 'missing', checklist: null, error: null };
    return { status: 'error', checklist: null, error: error.message || 'Nie udało się wczytać checklisty sprzętu.' };
  }
  const checklist = normalizedChecklist(data, eventId);
  return checklist ? { status: 'ready', checklist, error: null } : { status: 'error', checklist: null, error: 'Nie udało się odczytać checklisty sprzętu.' };
}

registerEventTab('equipment', equipmentTab);
registerEventTab('equipment-checklist', checklistTab);

// ---------------------------------------------------------------------------------------------------------------
// Zapisy (`handle…` z `EventEquipmentTab`)
// ---------------------------------------------------------------------------------------------------------------

async function markChecklistModified(ctx: NativeContext, eventId: string) {
  try {
    await ctx.supabase.from('events').update({ equipment_checklist_modified: true }).eq('id', eventId);
  } catch {
    // jak w przeglądarce — oznaczenie checklisty nie blokuje zapisu sprzętu
  }
}

async function ownRow(ctx: NativeContext, eventId: string, rowId: string) {
  if (!uuid.test(rowId)) fail('Nieprawidłowa pozycja.');
  const { data, error } = await ctx.supabase.from('event_equipment').select('*').eq('id', rowId).maybeSingle();
  if (error) throw error;
  if (!data || (data as any).event_id !== eventId) fail('Nie znaleziono pozycji albo nie masz do niej dostępu.');
  return data as any;
}

async function updateRow(ctx: NativeContext, rowId: string, data: Record<string, unknown>) {
  const { data: rows, error } = await ctx.supabase.from('event_equipment').update(data).eq('id', rowId).select('id');
  if (error) throw error;
  if (!rows?.length) fail('Nie udało się zaktualizować');
}

type Selection = { id: string; type: ItemType; quantity: number; notes: string };

function selections(value: unknown): Selection[] {
  const map = new Map<string, Selection>();
  for (const raw of list(value)) {
    const type = String(raw?.type || '') as ItemType;
    const id = String(raw?.id || '');
    const quantity = Math.trunc(Number(raw?.quantity));
    if (!['item', 'kit', 'cable'].includes(type) || !uuid.test(id) || !Number.isFinite(quantity) || quantity < 1) continue;
    const key = keyOf(type, id);
    const previous = map.get(key);
    map.set(key, previous ? { ...previous, quantity: previous.quantity + quantity } : { id, type, quantity, notes: String(raw?.notes || '') });
  }
  return Array.from(map.values());
}

function existingMap(rows: any[]) {
  const map = new Map<string, any>();
  for (const row of rows) {
    if (row.equipment_id) map.set(keyOf('item', row.equipment_id), row);
    if (row.kit_id) map.set(keyOf('kit', row.kit_id), row);
    if (row.cable_id) map.set(keyOf('cable', row.cable_id), row);
  }
  return map;
}

async function insertSelections(ctx: NativeContext, eventId: string, items: Selection[]) {
  const { error } = await ctx.supabase.from('event_equipment').insert(items.map((item) => ({
    event_id: eventId,
    equipment_id: item.type === 'item' ? item.id : null,
    kit_id: item.type === 'kit' ? item.id : null,
    cable_id: item.type === 'cable' ? item.id : null,
    quantity: item.quantity,
    notes: item.notes ?? null,
  })));
  if (error) throw error;
}

/** `handleAddEquipment` (okno „Dodaj sprzęt”): istniejące pozycje dostają większą ilość, nowe są dodawane — w granicach dostępności. */
async function addEquipment(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const merged = selections(body.items);
  if (!merged.length) fail('Zaznacz przynajmniej jedną pozycję');
  const event = await eventDates(ctx, eventId);
  const [rows, avail] = await Promise.all([equipmentRows(ctx, eventId), availability(ctx, event, false)]);
  const existing = existingMap(rows);
  const toInsert: Selection[] = [];
  const toUpdate: { rowId: string; quantity: number }[] = [];
  for (const s of merged) {
    const key = keyOf(s.type, s.id);
    const row = existing.get(key);
    const a = avail.byKey[key];
    const { used, maxAdd, maxSet } = uiLimits(a);
    const finalQty = Number(row?.quantity ?? used ?? 0) + s.quantity;
    if (!a || finalQty > maxSet) fail(`Brak dostępności: max ${maxSet} szt. (do dodania zostało ${maxAdd}).`);
    if (!row) toInsert.push(s);
    else toUpdate.push({ rowId: row.id, quantity: finalQty });
  }
  if (toInsert.length) await insertSelections(ctx, eventId, toInsert);
  for (const update of toUpdate) await updateRow(ctx, update.rowId, { quantity: update.quantity });
  await markChecklistModified(ctx, eventId);
  return { ok: true, message: toUpdate.length ? 'Pozycje były już na liście — zwiększono ilości.' : null };
}

/** `handleUpdateQuantity`: 1…„max ustawienia” z dostępności. */
async function setQuantity(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const row = await ownRow(ctx, eventId, String(body.rowId || ''));
  const quantity = Number(body.quantity);
  const event = await eventDates(ctx, eventId);
  const avail = await availability(ctx, event, false);
  const key = rowKey(row);
  const { maxSet } = uiLimits(key ? avail.byKey[key] : null);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxSet) fail(`Maksymalnie możesz ustawić: ${maxSet} szt.`);
  await updateRow(ctx, row.id, { quantity });
  await markChecklistModified(ctx, eventId);
  return { ok: true };
}

/** `handleRemoveEquipment`: pozycja z oferty jest ukrywana (ilość 0), dodana ręcznie — usuwana. */
async function removeEquipment(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const row = await ownRow(ctx, eventId, String(body.rowId || ''));
  if (row.auto_added) {
    await updateRow(ctx, row.id, { removed_from_offer: true, is_overridden: true, quantity: 0 });
    await markChecklistModified(ctx, eventId);
    return { ok: true, message: 'Zaktualizowano' };
  }
  const { data, error } = await ctx.supabase.from('event_equipment').delete().eq('id', row.id).select();
  if (error) throw error;
  if (!data?.length) fail('Nie udało się usunąć sprzętu. Prawdopodobnie brak uprawnień lub wpis nie istnieje.');
  await markChecklistModified(ctx, eventId);
  return { ok: true, message: 'Usunięto' };
}

async function restoreEquipment(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const row = await ownRow(ctx, eventId, String(body.rowId || ''));
  await updateRow(ctx, row.id, { removed_from_offer: false, is_overridden: false, quantity: Math.max(1, Number(row.offer_quantity ?? row.auto_quantity ?? 1)) });
  await markChecklistModified(ctx, eventId);
  return { ok: true };
}

async function expandInChecklist(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const row = await ownRow(ctx, eventId, String(body.rowId || ''));
  await updateRow(ctx, row.id, { expand_kit_in_checklist: body.expand === true });
  await markChecklistModified(ctx, eventId);
  return { ok: true };
}

/** `handleImportFromCalculation`: pozycje magazynowe kalkulacji → sprzęt wydarzenia, z brakami do rozwiązania. */
async function importCalculation(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const { items } = await calculationEquipment(ctx, eventId);
  if (!items.length) return { level: 'info', message: 'Brak pozycji sprzętowych w kalkulacji', conflicts: [] };
  const warehouseItems = items.filter((item: any) => item.source === 'warehouse' && item.source_ref);
  if (!warehouseItems.length) return { level: 'info', message: 'Kalkulacja nie zawiera pozycji z magazynu do zaimportowania', conflicts: [] };
  const ids = warehouseItems.map((item: any) => item.source_ref).filter(Boolean);
  const [{ data: equipmentCheck }, { data: kitCheck }] = await Promise.all([
    s.from('equipment_items').select('id, name').in('id', ids),
    s.from('equipment_kits').select('id, name').in('id', ids),
  ]);
  const validItems = new Map((equipmentCheck ?? []).map((e: any) => [e.id, e.name] as [string, string]));
  const validKits = new Map((kitCheck ?? []).map((k: any) => [k.id, k.name] as [string, string]));
  const toAdd: any[] = [];
  for (const calc of warehouseItems) {
    const ref = calc.source_ref;
    if (validItems.has(ref)) toAdd.push({ id: ref, type: 'item', quantity: Number(calc.quantity) || 1, notes: '' });
    else if (validKits.has(ref)) toAdd.push({ id: ref, type: 'kit', quantity: Number(calc.quantity) || 1, notes: '' });
  }
  if (!toAdd.length) return { level: 'info', message: 'Nie znaleziono sprzętu z magazynu do dodania', conflicts: [] };
  const merged = selections(toAdd);
  const event = await eventDates(ctx, eventId);
  const [rows, avail] = await Promise.all([equipmentRows(ctx, eventId), availability(ctx, event, false)]);
  const existing = existingMap(rows);
  const toInsert: Selection[] = [];
  const toUpdate: { rowId: string; quantity: number }[] = [];
  const conflicts: any[] = [];
  let upToDate = 0;
  for (const sel of merged) {
    const key = keyOf(sel.type, sel.id);
    const row = existing.get(key);
    const a = avail.byKey[key];
    const { maxSet } = uiLimits(a);
    const current = Number(row?.quantity ?? 0);
    const target = sel.quantity;
    const name = (sel.type === 'item' ? validItems.get(sel.id) : validKits.get(sel.id)) || 'Nieznany';
    if (row && current >= target) {
      upToDate++;
      continue;
    }
    if (a && maxSet > 0 && target > maxSet) {
      const available = Math.max(0, maxSet);
      conflicts.push({ name, quantity: target, available, equipmentId: sel.id, type: sel.type });
      if (available > current) {
        if (!row) toInsert.push({ ...sel, quantity: available });
        else toUpdate.push({ rowId: row.id, quantity: available });
      }
    } else if (!row) toInsert.push(sel);
    else toUpdate.push({ rowId: row.id, quantity: target });
  }
  if (!toInsert.length && !toUpdate.length && !conflicts.length) {
    return { level: 'info', message: `Sprzęt jest już zsynchronizowany z kalkulacją (${upToDate} pozycji aktualnych)`, conflicts: [] };
  }
  let added = 0;
  if (toInsert.length) {
    try {
      await insertSelections(ctx, eventId, toInsert);
    } catch {
      fail('Błąd podczas dodawania sprzętu z kalkulacji');
    }
    added += toInsert.length;
  }
  for (const update of toUpdate) {
    await updateRow(ctx, update.rowId, { quantity: update.quantity }).catch(() => undefined);
    added++;
  }
  await markChecklistModified(ctx, eventId);
  const imported = merged.filter((item) => item.type === 'item').map((item) => item.id);
  if (imported.length) {
    await s.from('event_equipment_component_reviews').update({ source: 'import', updated_at: new Date().toISOString() })
      .eq('event_id', eventId).in('equipment_id', imported).eq('status', 'pending');
  }
  if (conflicts.length) {
    return { level: 'warning', message: `Zsynchronizowano ${added} pozycji, ale ${conflicts.length} ma niewystarczający stan magazynowy`, conflicts };
  }
  const parts: string[] = [];
  if (toInsert.length) parts.push(`${toInsert.length} dodano`);
  if (toUpdate.length) parts.push(`${toUpdate.length} zaktualizowano`);
  if (upToDate) parts.push(`${upToDate} bez zmian`);
  return { level: 'success', message: `Zsynchronizowano z kalkulacją: ${parts.join(', ')}`, conflicts: [] };
}

/** `handleReplaceEquipment`: zamiana pozycji (albo braku z importu) na sprzęt alternatywny. */
async function replaceEquipment(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const alternativeId = String(body.alternativeId || '');
  if (!uuid.test(alternativeId)) fail('Nieprawidłowy sprzęt.');
  const quantity = Math.max(1, Math.trunc(Number(body.quantity) || 1));
  const oldName = String(body.oldName || 'Nieznany');
  const { data: alternative, error: fetchError } = await ctx.supabase.from('equipment_items').select('name').eq('id', alternativeId).single();
  if (fetchError) throw fetchError;
  const newName = (alternative as any)?.name || alternativeId;
  if (body.rowId) {
    const row = await ownRow(ctx, eventId, String(body.rowId));
    const { error } = await ctx.supabase.from('event_equipment').update({
      equipment_id: alternativeId, kit_id: null, status: 'reserved', is_optional: false, auto_added: false, quantity,
      notes: `Zamieniono z: ${oldName} → ${newName}`,
    }).eq('id', row.id);
    if (error) throw error;
  } else {
    const { error } = await ctx.supabase.from('event_equipment').insert({
      event_id: eventId, equipment_id: alternativeId, kit_id: null, quantity, status: 'reserved', is_optional: false, auto_added: false,
      notes: `Alternatywa dla: ${oldName} → ${newName}`,
    });
    if (error) throw error;
  }
  return { ok: true, message: `Sprzęt zamieniony: ${oldName} → ${(alternative as any)?.name} (${quantity} szt.)` };
}

/** `handleSelectRentalEquipment`: pozycja jako wynajem od podwykonawcy + zadanie podwykonawcy. */
async function markRental(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const subcontractorId = String(body.subcontractorId || '');
  const equipmentId = String(body.rentalEquipmentId || '');
  if (!uuid.test(subcontractorId) || !uuid.test(equipmentId)) fail('Nieprawidłowy wybór wynajmu.');
  const equipmentName = String(body.equipmentName || 'Sprzęt');
  const subcontractorName = String(body.subcontractorName || 'Podwykonawca');
  const row = body.rowId ? await ownRow(ctx, eventId, String(body.rowId)) : null;
  if (row) {
    const { error } = await ctx.supabase.from('event_equipment').update({
      use_external_rental: true, status: 'rental', is_optional: false, auto_added: false, rental_subcontractor_id: subcontractorId,
      rental_equipment_id: equipmentId, notes: `Wynajem od: ${subcontractorName} - ${equipmentName}`,
    }).eq('id', row.id);
    if (error) throw error;
  }
  const quantity = row ? row.quantity : Math.max(1, Math.trunc(Number(body.quantity) || 1));
  const { error: taskError } = await ctx.supabase.from('subcontractor_tasks').insert({
    event_id: eventId, subcontractor_id: subcontractorId, event_equipment_id: row?.id ?? null, rental_equipment_id: equipmentId,
    task_type: 'equipment_rental', task_name: `Wynajem: ${equipmentName}`,
    description: `Wynajem od ${subcontractorName} - ${equipmentName} (${quantity} szt.)`, status: 'planned', payment_type: 'fixed', fixed_price: 0,
    notes: 'Utworzone automatycznie z zakładki Sprzęt',
  });
  if (taskError) console.error('[native-equipment] rental task', taskError.message);
  return { ok: true, message: `Sprzęt oznaczony jako wynajem od ${subcontractorName}` };
}

async function upsertDismissed(ctx: NativeContext, eventId: string, equipmentId: string, ids: string[]) {
  const { data: current, error: readError } = await ctx.supabase.from('event_equipment_component_reviews').select('dismissed_component_ids')
    .eq('event_id', eventId).eq('equipment_id', equipmentId).maybeSingle();
  if (readError) throw readError;
  const dismissed = Array.from(new Set([...list((current as any)?.dismissed_component_ids).map(String), ...ids]));
  const { error } = await ctx.supabase.from('event_equipment_component_reviews').upsert({
    event_id: eventId, equipment_id: equipmentId, dismissed_component_ids: dismissed, updated_at: new Date().toISOString(),
  }, { onConflict: 'event_id,equipment_id' });
  if (error) throw error;
}

/** „Pomiń wymaganie” / „Nie używamy” (`dismissComponentGroup`). */
async function dismissComponents(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const equipmentId = String(body.equipmentId || '');
  if (!uuid.test(equipmentId)) fail('Nieprawidłowy sprzęt.');
  const ids = list(body.componentIds).map(String).filter((id) => uuid.test(id));
  try {
    await upsertDismissed(ctx, eventId, equipmentId, ids);
  } catch {
    fail('Nie udało się zapisać decyzji o pominięciu komponentu');
  }
  return { ok: true, message: body.required === true ? 'Wymaganie zostało świadomie pominięte dla tego wydarzenia' : 'Rekomendacja została pominięta dla tego wydarzenia' };
}

/** `addComponentReservation` — istniejąca rezerwacja dostaje większą ilość. */
async function addComponentReservation(ctx: NativeContext, eventId: string, payload: Record<string, any>) {
  const field = payload.equipment_id ? 'equipment_id' : payload.kit_id ? 'kit_id' : 'cable_id';
  const { data: existing, error: existingError } = await ctx.supabase.from('event_equipment').select('id,quantity')
    .eq('event_id', eventId).eq(field, payload[field]).or(ACTIVE_STATUS).limit(1).maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    const { error } = await ctx.supabase.from('event_equipment').update({ quantity: Number((existing as any).quantity || 0) + Number(payload.quantity || 0) }).eq('id', (existing as any).id);
    if (error) throw error;
    return;
  }
  const { error } = await ctx.supabase.from('event_equipment').insert(payload);
  if (error) throw error;
}

/** `handleAddComponents`: wybrane komponenty (ilości z okna) + pominięte rekomendacje zapisane jako decyzja. */
async function addComponents(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const equipmentId = String(body.equipmentId || '');
  if (!uuid.test(equipmentId)) fail('Nieprawidłowy sprzęt.');
  const picks = new Map<string, number>();
  for (const pick of list(body.picks)) picks.set(String(pick?.componentId || ''), Math.max(0, Math.trunc(Number(pick?.quantity) || 0)));
  const groups = (await componentGroups(ctx, eventId, [equipmentId]))[equipmentId]?.groups ?? [];
  const event = await eventDates(ctx, eventId);
  const avail = await availability(ctx, event, false);
  const availabilityOf = async (c: any) => {
    let a = c.key ? avail.byKey[c.key] : null;
    if (a && Number(a.max_add ?? a.available_in_term ?? 0) <= 0 && ctx.employee.isAdmin && c.key) {
      const verified = (await componentConflicts(ctx, eventId, c.key, c.existing)).verified;
      if (verified) a = verified;
    }
    if (!a) return null;
    const available = Number(a.max_add ?? a.available_in_term ?? 0);
    return { available, isAvailable: available > 0, addable: Math.min(c.missing, available) };
  };
  const quantityOf = async (c: any) => {
    const a = await availabilityOf(c);
    const maximum = Math.max(0, a?.addable ?? c.missing);
    if (maximum <= 0) return { quantity: 0, a };
    const minimum = c.type === 'optional' ? 0 : 1;
    const fallback = c.type === 'optional' && !c.group ? 0 : maximum;
    return { quantity: Math.min(maximum, Math.max(minimum, picks.has(c.id) ? (picks.get(c.id) as number) : fallback)), a };
  };
  const chosen = (group: any) => (group.name ? group.components.find((c: any) => picks.has(c.id)) : group.components[0]);
  for (const group of groups) {
    if (group.name && group.required && !chosen(group)) fail(`Proszę wybrać jeden komponent z grupy "${group.name}"`);
  }
  const omitted: string[] = [];
  for (const group of groups) {
    const component = chosen(group);
    if (!component) {
      if (!group.required) omitted.push(...group.components.map((c: any) => c.id));
      continue;
    }
    const { quantity, a } = await quantityOf(component);
    if (component.type === 'optional' && quantity <= 0) {
      if (!group.required) omitted.push(...(group.name ? group.components.map((c: any) => c.id) : [component.id]));
      continue;
    }
    if (a && !a.isAvailable) {
      fail(group.name ? 'Wybrany komponent nie jest dostępny w terminie wydarzenia' : `${component.name || 'Komponent'} nie jest dostępny w terminie wydarzenia`);
    }
    if (quantity <= 0) {
      if (!group.required) omitted.push(...(group.name ? group.components.map((c: any) => c.id) : [component.id]));
      continue;
    }
    const field = component.kind === 'item' ? 'equipment_id' : component.kind === 'kit' ? 'kit_id' : 'cable_id';
    await addComponentReservation(ctx, eventId, {
      event_id: eventId, [field]: component.targetId, quantity, status: 'reserved', offer_id: uuid.test(String(body.offerId || '')) ? body.offerId : null,
    });
  }
  if (omitted.length) await upsertDismissed(ctx, eventId, equipmentId, omitted);
  return { ok: true, message: 'Zaktualizowano komponenty wydarzenia' };
}

/** Kolejka weryfikacji zestawów (`onReviewFinished`). */
async function finishReview(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const reviewId = String(body.reviewId || '');
  const status = String(body.status || '');
  if (!uuid.test(reviewId) || !['reviewed', 'skipped', 'not_applicable'].includes(status)) fail('Nieprawidłowa decyzja.');
  const now = new Date().toISOString();
  const { error } = await ctx.supabase.from('event_equipment_component_reviews')
    .update({ status, reviewed_by: ctx.employee.id, reviewed_at: now, updated_at: now }).eq('id', reviewId).eq('event_id', eventId);
  if (error) throw error;
  return { ok: true };
}

/** `EquipmentChecklistNotes.save`. */
async function saveNotes(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const notes = list(body.notes).map((note) => ({ id: String(note?.id || ''), text: String(note?.text ?? ''), checked: note?.checked === true }))
    .filter((note) => note.id);
  const length = notes.reduce((sum, note) => sum + note.text.length, 0);
  if (length > 1000 || notes.length > 50) fail('Notatki mogą mieć łącznie do 1000 znaków i 50 punktów.');
  if (notes.some((note) => !note.text.trim())) fail('Uzupełnij treść każdego punktu lub usuń pustą notatkę.');
  const value = notes.map((note) => ({ ...note, text: note.text.trim() }));
  const { error } = await ctx.supabase.from('events').update({
    equipment_checklist_note_items: value,
    equipment_checklist_notes: value.map((note) => note.text).join('\n') || null,
    equipment_checklist_modified: true,
  }).eq('id', eventId).select('id').single();
  if (error) fail('Nie udało się zapisać notatek. Spróbuj ponownie.');
  return { ok: true, notes: value };
}

const CHECKLIST_WRITES = new Set<string>(Object.values(EQUIPMENT_CHECKLIST_RPC).filter((name) => name !== EQUIPMENT_CHECKLIST_RPC.get));

/** Zapis checklisty etapów (`useEquipmentChecklist.run`) — RPC zwraca całą checklistę. */
async function runChecklist(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const name = String(body.name || '');
  if (!CHECKLIST_WRITES.has(name)) fail('Niedozwolona operacja.');
  const params = body.params && typeof body.params === 'object' ? { ...body.params } : {};
  if ('p_event' in params) params.p_event = eventId;
  const { data, error } = await ctx.supabase.rpc(name, params);
  if (error) {
    const message = error.message || '';
    fail(/Failed to fetch|Network request failed|fetch failed|NetworkError/i.test(message) ? 'Brak połączenia. Spróbuj ponownie za chwilę.'
      : message || 'Nie udało się zapisać checklisty. Spróbuj ponownie.');
  }
  const checklist = normalizedChecklist(data, eventId);
  if (!checklist) fail('Zapisano, ale nie udało się odczytać checklisty. Odśwież widok.');
  return { checklist };
}

/** Zdjęcie zwrotu (`ReturnPhotos.add`): plik do magazynu `event-files`, potem zapis pozycji z nową listą zdjęć. */
export async function uploadReturnPhoto(ctx: NativeContext, eventId: string, form: FormData) {
  const lineId = String(form.get('line') || '');
  const file = form.get('file');
  if (!uuid.test(lineId)) fail('Nieprawidłowa pozycja.');
  if (!(file instanceof File)) fail('Brak pliku.');
  if (!(file.type || '').startsWith('image/')) fail('Wybierz pliki zdjęć (JPG, PNG, HEIC).');
  if (file.size > 15 * 1024 * 1024) fail(`Zdjęcie „${file.name}” ma więcej niż 15 MB.`);
  const { data: line, error: lineError } = await ctx.supabase.from('event_equipment').select('id, event_id').eq('id', lineId).maybeSingle();
  if (lineError) throw lineError;
  if (!line || (line as any).event_id !== eventId) fail('Nie znaleziono pozycji.');
  const photos = (() => {
    try {
      return list(JSON.parse(String(form.get('photos') || '[]'))).map(String);
    } catch {
      return [] as string[];
    }
  })();
  if (photos.length >= EQUIPMENT_RETURN_PHOTO_LIMIT) fail(`Najwyżej ${EQUIPMENT_RETURN_PHOTO_LIMIT} zdjęć na pozycję.`);
  const path = equipmentReturnPhotoPath(eventId, lineId, file.name);
  const storage = ctx.supabase.storage.from(EQUIPMENT_RETURN_PHOTO_BUCKET);
  const { error: uploadError } = await storage.upload(path, new Uint8Array(await file.arrayBuffer()), {
    contentType: file.type || 'image/jpeg', cacheControl: '3600', upsert: false,
  });
  if (uploadError) fail(uploadError.message || 'Nie udało się wysłać zdjęcia.');
  const intOrNull = (key: string) => {
    const raw = form.get(key);
    if (raw == null || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.trunc(value) : null;
  };
  const note = String(form.get('note') || '');
  const { data, error } = await ctx.supabase.rpc(EQUIPMENT_CHECKLIST_RPC.returnLine, {
    p_line: lineId, p_ok: intOrNull('ok'), p_damaged: intOrNull('damaged') ?? 0, p_note: note || null, p_photos: [...photos, path],
  });
  if (error) {
    await storage.remove([path]);
    fail(error.message || 'Nie udało się zapisać zdjęcia.');
  }
  const checklist = normalizedChecklist(data, eventId);
  if (!checklist) fail('Zapisano, ale nie udało się odczytać checklisty. Odśwież widok.');
  return { checklist };
}

registerEventActions('equipment', {
  add: addEquipment,
  quantity: setQuantity,
  remove: removeEquipment,
  restore: restoreEquipment,
  expand: expandInChecklist,
  importCalculation: (ctx, eventId) => importCalculation(ctx, eventId),
  replace: replaceEquipment,
  rental: markRental,
  components: addComponents,
  dismissComponents,
  review: finishReview,
  notes: saveNotes,
  checklist: runChecklist,
});

// ---------------------------------------------------------------------------------------------------------------
// Odczyty pomocnicze: katalog do dodania, alternatywy, wynajem, zajętość komponentu, PDF checklisty
// ---------------------------------------------------------------------------------------------------------------

/**
 * Katalog „Dodaj sprzęt” jako zbiór synchronizowany koszykami (`collectionState` / `collectionItems`): Mac trzyma go na dysku
 * przy karcie wydarzenia i pobiera tylko koszyki, które się zmieniły (dostępność w terminie, nowe pozycje, zestawy).
 */
export async function equipmentCatalogEntries(ctx: NativeContext, eventId: string) {
  const event = await eventDates(ctx, eventId);
  const avail = await availability(ctx, event, 'all');
  return [
    ...avail.items.map((item: any) => ({ id: `item:${item.id}`, item: { ...item, kind: 'item', loaded: avail.loaded } })),
    ...avail.kits.map((kit: any) => ({ id: `kit:${kit.id}`, item: { ...kit, kind: 'kit', loaded: avail.loaded } })),
  ];
}

async function catalogQuery(ctx: NativeContext, eventId: string) {
  const event = await eventDates(ctx, eventId);
  const avail = await availability(ctx, event, true);
  return { items: avail.items, kits: avail.kits, loaded: avail.loaded };
}

/** `handleSuggestAlternative`: sprzęt z tej samej podkategorii, a gdy brak — z kategorii głównej. */
async function alternativesQuery(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const s = ctx.supabase;
  let currentId = params.get('equipmentId') || null;
  let categoryId = params.get('categoryId') || null;
  if (params.get('kind') === 'kit') fail('Alternatywy dla zestawów nie są jeszcze obsługiwane');
  if (!categoryId && currentId) {
    const { data, error } = await s.from('equipment_items').select('id, name, warehouse_category_id').eq('id', currentId).single();
    if (error) throw error;
    categoryId = (data as any)?.warehouse_category_id ?? null;
    currentId = (data as any)?.id ?? currentId;
  }
  if (!categoryId) fail('Nie można znaleźć kategorii sprzętu');
  const { data: category, error: categoryError } = await s.from('warehouse_categories').select('id, name, parent_id, level').eq('id', categoryId).single();
  if (categoryError) throw categoryError;
  let { data: alternatives, error } = await s.from('equipment_items').select('id, name, brand, model, thumbnail_url, warehouse_category_id')
    .eq('warehouse_category_id', categoryId).neq('id', currentId || '').limit(20);
  if (error) throw error;
  let level = 'subcategory';
  let parentName = '';
  if ((!alternatives || !alternatives.length) && (category as any).parent_id) {
    level = 'main_category';
    const { data: parent } = await s.from('warehouse_categories').select('id, name').eq('id', (category as any).parent_id).single();
    if (parent) {
      parentName = (parent as any).name;
      const { data: subcategories } = await s.from('warehouse_categories').select('id').eq('parent_id', (category as any).parent_id);
      if (subcategories?.length) {
        const { data: main, error: mainError } = await s.from('equipment_items').select('id, name, brand, model, thumbnail_url, warehouse_category_id')
          .in('warehouse_category_id', subcategories.map((sub: any) => sub.id)).neq('id', currentId || '').limit(20);
        if (mainError) throw mainError;
        if (main) alternatives = main;
      }
    }
  }
  if (!alternatives?.length) return { alternatives: [], message: 'Brak dostępnych alternatyw' };
  const event = await eventDates(ctx, eventId);
  const avail = await availability(ctx, event, false);
  const enriched = await Promise.all((alternatives as any[]).map(async (alt) => {
    const [{ count: total, error: totalError }, { count: available, error: availableError }] = await Promise.all([
      s.from('equipment_units').select('*', { count: 'exact', head: true }).eq('equipment_id', alt.id),
      s.from('equipment_units').select('*', { count: 'exact', head: true }).eq('equipment_id', alt.id).eq('status', 'available'),
    ]);
    if (totalError) throw totalError;
    if (availableError) throw availableError;
    const a = avail.byKey[keyOf('item', alt.id)];
    return {
      id: alt.id, name: alt.name || 'Sprzęt', brand: alt.brand || '', model: alt.model || '', thumbnail: alt.thumbnail_url || null,
      total: total || 0, available: available || 0, availableInTerm: a?.available_in_term ?? available ?? 0, maxAdd: a?.max_add ?? available ?? 0,
    };
  }));
  return {
    alternatives: enriched,
    message: level === 'main_category' ? `Znaleziono ${enriched.length} alternatyw z kategorii: ${parentName}` : `Znaleziono ${enriched.length} alternatyw`,
  };
}

/** `SelectRentalEquipmentModal.fetchRentalEquipment`. */
async function rentalsQuery(ctx: NativeContext, _eventId: string, params: URLSearchParams) {
  const s = ctx.supabase;
  let query = s.from('subcontractor_rental_equipment')
    .select('id, name, description, rental_price_per_day, quantity_available, thumbnail_url, specifications, subcontractor_id, warehouse_category_id, warehouse_categories (name)')
    .eq('is_active', true);
  const categoryId = params.get('categoryId');
  if (categoryId && uuid.test(categoryId)) query = query.eq('warehouse_category_id', categoryId);
  const { data, error } = await query.order('name');
  if (error) fail('Błąd podczas ładowania sprzętu');
  const subcontractorIds = Array.from(new Set((data || []).map((item: any) => item.subcontractor_id)));
  const { data: organizations } = subcontractorIds.length
    ? await s.from('organizations').select('id, name, alias, subcontractor_id').in('subcontractor_id', subcontractorIds).not('subcontractor_id', 'is', null)
    : { data: [] as any[] };
  const orgs = new Map<string, any>();
  for (const org of organizations || []) if (!orgs.has((org as any).subcontractor_id)) orgs.set((org as any).subcontractor_id, org);
  return {
    items: (data || []).map((item: any) => {
      const org = orgs.get(item.subcontractor_id);
      return {
        id: item.id, name: item.name || 'Sprzęt', description: item.description || '', pricePerDay: item.rental_price_per_day ?? null,
        quantity: num(item.quantity_available), thumbnail: item.thumbnail_url || null, category: (one(item.warehouse_categories) as any)?.name || null,
        subcontractorId: item.subcontractor_id, subcontractorName: org?.name || null, subcontractorAlias: org?.alias || null,
      };
    }),
  };
}

/**
 * „Kto zarezerwował?” — rezerwacje pozycji w innych wydarzeniach nakładających się z terminem (te same źródła co
 * `check_equipment_inventory_for_event`: sprzęt z `equipment_bookings`, zestawy z `event_equipment`), zsumowane per wydarzenie,
 * z autorem wydarzenia i kontaktem — żeby można było zapytać, czy coś odstąpią. Wydarzenia, których użytkownik nie widzi
 * (zakres widoczności CRM), są liczone bez nazwy i osoby.
 */
async function reservationsQuery(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const s = ctx.supabase;
  const kind = params.get('kind') === 'kit' ? 'kit' : 'item';
  const id = params.get('id') || '';
  if (!uuid.test(id)) fail('Nieprawidłowa pozycja.');
  const event = await eventDates(ctx, eventId);
  if (!event.event_date) return { reservations: [], hiddenQuantity: 0 };
  const start = event.event_date;
  const end = event.event_end_date || dayAfter(event.event_date);
  const demand = new Map<string, { quantity: number; start: string | null; end: string | null }>();
  const add = (eventKey: string, quantity: number, from: string | null, to: string | null) => {
    const previous = demand.get(eventKey);
    demand.set(eventKey, previous ? { ...previous, quantity: previous.quantity + quantity } : { quantity, start: from, end: to });
  };
  if (kind === 'item') {
    const { data, error } = await s.from('equipment_bookings').select('event_id, quantity, start_date, end_date')
      .eq('equipment_id', id).neq('event_id', eventId).lt('start_date', end).gt('end_date', start);
    if (error) throw error;
    for (const row of (data || []) as any[]) if (row.event_id) add(row.event_id, num(row.quantity), row.start_date, row.end_date);
  } else {
    const { data, error } = await s.from('event_equipment').select('event_id, quantity, status, removed_from_offer, use_external_rental')
      .eq('kit_id', id).neq('event_id', eventId);
    if (error) throw error;
    for (const row of (data || []) as any[]) {
      if (!['reserved', 'in_use'].includes(String(row.status || 'reserved')) || row.removed_from_offer || row.use_external_rental) continue;
      add(row.event_id, num(row.quantity), null, null);
    }
  }
  const ids = Array.from(demand.keys());
  if (!ids.length) return { reservations: [], hiddenQuantity: 0 };
  const { data: events, error: eventsError } = await s.from('events').select('id, name, event_date, event_end_date, status, created_by').in('id', ids);
  if (eventsError) throw eventsError;
  const visible = new Map(((events || []) as any[]).map((row) => [row.id, row] as [string, any]));
  const authorIds = Array.from(new Set(((events || []) as any[]).map((row) => row.created_by).filter(Boolean)));
  const { data: people } = authorIds.length
    ? await s.from('employees').select('id, name, surname, avatar_url, avatar_metadata, email, phone_number').in('id', authorIds)
    : { data: [] as any[] };
  const byId = new Map(((people || []) as any[]).map((row) => [row.id, row] as [string, any]));
  let hiddenQuantity = 0;
  const reservations: any[] = [];
  for (const [key, value] of demand) {
    const row = visible.get(key);
    if (!row) {
      hiddenQuantity += value.quantity;
      continue;
    }
    if (String(row.status || '') === 'cancelled') continue;
    if (kind === 'kit') {
      const rowStart = row.event_date as string | null;
      const rowEnd = (row.event_end_date as string | null) || (rowStart ? dayAfter(rowStart) : null);
      if (!rowStart || !rowEnd || !(Date.parse(rowStart) < Date.parse(end) && Date.parse(rowEnd) > Date.parse(start))) continue;
    }
    const person = row.created_by ? byId.get(row.created_by) : null;
    reservations.push({
      eventId: row.id, name: row.name || 'Wydarzenie', status: row.status || null, quantity: value.quantity,
      start: value.start || row.event_date || null, end: value.end || row.event_end_date || null,
      eventStart: row.event_date || null, eventEnd: row.event_end_date || null,
      author: person ? {
        id: person.id, name: [person.name, person.surname].filter(Boolean).join(' ') || 'Pracownik', avatarUrl: person.avatar_url || null,
        avatar: imageCrop(person.avatar_metadata as any), email: person.email || null, phone: person.phone_number || null,
      } : null,
    });
  }
  reservations.sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
  return { reservations, hiddenQuantity };
}

async function conflictsQuery(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  return componentConflicts(ctx, eventId, params.get('key') || '', Math.max(0, num(params.get('existing'))));
}

/** „Pokaż / Pobierz checklistę” — plik z `events.equipment_checklist_pdf_path` i jego nazwa z `event_files`. */
async function checklistPdfQuery(ctx: NativeContext, eventId: string) {
  const { data: event, error } = await ctx.supabase.from('events').select('equipment_checklist_pdf_path').eq('id', eventId).single();
  if (error) throw error;
  const path = (event as any)?.equipment_checklist_pdf_path;
  if (!path) fail('Brak checklisty sprzętu do wydruku');
  const [signed, record] = await Promise.all([
    ctx.supabase.storage.from('event-files').createSignedUrl(path, 3600),
    ctx.supabase.from('event_files').select('name,original_name').eq('event_id', eventId).eq('file_path', path).maybeSingle(),
  ]);
  if (signed.error || !signed.data?.signedUrl) fail('Błąd podczas otwierania PDF');
  return { url: signed.data.signedUrl, name: (record.data as any)?.original_name || (record.data as any)?.name || 'checklista-sprzetu.pdf' };
}

registerEventQueries('equipment', {
  catalog: (ctx, eventId) => catalogQuery(ctx, eventId),
  alternatives: alternativesQuery,
  rentals: rentalsQuery,
  conflicts: conflictsQuery,
  reservations: reservationsQuery,
  checklistPdf: (ctx, eventId) => checklistPdfQuery(ctx, eventId),
});
