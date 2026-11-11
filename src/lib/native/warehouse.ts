import 'server-only';
import type { NativeContext } from './auth';
import { can } from './auth';
import { collectionItems, collectionState, invalidateNativeSync } from './sync';

/*
 * Magazyn na Macu (`/crm/equipment`): katalog sprzętu i zestawów jak `getEquipmentFeed` (z liczbą sztuk i dostępnych),
 * słowniki (kategorie, lokalizacje, wtyki) i karta sprzętu jak `/crm/equipment/[id]` (`getEquipmentDetails`, jednostki,
 * historia zmian). Tokenem pracownika — RLS jak w przeglądarce.
 */

export const WAREHOUSE_SET = 'warehouse-catalog';
/** Pełne karty sprzętu (dane, jednostki, skład, galeria, pliki, historia) — cały magazyn na dysku Maca. */
export const WAREHOUSE_DETAILS_SET = 'warehouse-details';
/** Zestawy z pozycjami (`/crm/equipment/kits`). */
export const WAREHOUSE_KITS_SET = 'warehouse-kits';
/** Przewody (`/crm/equipment/cables`) z historią stanu. */
export const WAREHOUSE_CABLES_SET = 'warehouse-cables';
/** Sprzęt wynajmu od podwykonawców (`/crm/equipment/rental`). */
export const WAREHOUSE_RENTAL_SET = 'warehouse-rental';
const PAGE = 1000;

export type Row = Record<string, any>;
type Item = { id: string; item: Record<string, unknown> };

export const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
export const num = (value: unknown) => (value == null || value === '' || Number.isNaN(Number(value)) ? null : Number(value));

export async function pages(build: () => any): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order('id').range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

export function warehouseAccess(ctx: NativeContext) {
  return {
    canView: can(ctx.employee, 'equipment_view') || can(ctx.employee, 'equipment_manage'),
    canManage: can(ctx.employee, 'equipment_manage'),
    canCreate: can(ctx.employee, 'equipment_manage') || can(ctx.employee, 'equipment_create'),
  };
}

async function loadCatalog(ctx: NativeContext): Promise<Item[]> {
  const s = ctx.supabase;
  const [items, kits] = await Promise.all([
    pages(() => s.from('equipment_items')
      .select('id,name,warehouse_category_id,brand,model,thumbnail_url,description,created_at,is_active,total_quantity,cable_specs,cable_stock_quantity,equipment_units:equipment_units(id,status)')
      .is('deleted_at', null)),
    pages(() => s.from('equipment_kits').select('id,name,warehouse_category_id,thumbnail_url,description,created_at,is_active').is('deleted_at', null)),
  ]);
  return [
    ...items.map((row) => {
      const units = Array.isArray(row.equipment_units) ? row.equipment_units : [];
      return {
        id: `item:${row.id}`,
        item: {
          key: `item:${row.id}`, id: String(row.id), kind: 'item', name: text(row.name), brand: text(row.brand), model: text(row.model),
          categoryId: row.warehouse_category_id || null, thumbnailUrl: row.thumbnail_url || null, description: text(row.description),
          createdAt: row.created_at || null, active: row.is_active !== false,
          unitsTotal: units.length, unitsAvailable: units.filter((unit: Row) => unit.status === 'available').length,
          simpleQuantity: row.cable_specs ? Number(row.cable_stock_quantity) || 0 : null,
          // Sprawne sztuki do kompletowania zestawów jak `usableEquipmentStock`.
          usable: row.is_active === false ? 0 : units.length
            ? units.filter((unit: Row) => ['available', 'reserved', 'in_use'].includes(unit.status)).length
            : Math.max(0, Number(row.total_quantity) || 0),
        },
      };
    }),
    ...kits.map((row) => ({
      id: `kit:${row.id}`,
      item: {
        key: `kit:${row.id}`, id: String(row.id), kind: 'kit', name: text(row.name), brand: '', model: '',
        categoryId: row.warehouse_category_id || null, thumbnailUrl: row.thumbnail_url || null, description: text(row.description),
        createdAt: row.created_at || null, active: row.is_active !== false, unitsTotal: 0, unitsAvailable: 0, simpleQuantity: null, usable: 0,
      },
    })),
  ];
}

/** Zbiory magazynu synchronizowane z Makiem (skrót zbioru → zmienione koszyki → pozycje). */
const SETS = {
  catalog: { name: WAREHOUSE_SET, load: loadCatalog },
  details: { name: WAREHOUSE_DETAILS_SET, load: (ctx: NativeContext) => loadDetailItems(ctx) },
  kits: { name: WAREHOUSE_KITS_SET, load: (ctx: NativeContext) => loadKits(ctx) },
  cables: { name: WAREHOUSE_CABLES_SET, load: (ctx: NativeContext) => loadCables(ctx) },
  rental: { name: WAREHOUSE_RENTAL_SET, load: (ctx: NativeContext) => loadRental(ctx) },
} as const;
export type WarehouseSetKey = keyof typeof SETS;
export const warehouseSetKeys = Object.keys(SETS) as WarehouseSetKey[];
export const isWarehouseSet = (value: unknown): value is WarehouseSetKey => typeof value === 'string' && value in SETS;
export const warehouseSetState = (ctx: NativeContext, key: WarehouseSetKey, hash?: string) =>
  collectionState(ctx, SETS[key].name, SETS[key].load, hash);
export const warehouseSetItems = (ctx: NativeContext, key: WarehouseSetKey, buckets: unknown[]) =>
  collectionItems(ctx, SETS[key].name, SETS[key].load, buckets);
export const warehouseState = (ctx: NativeContext, hash?: string) => warehouseSetState(ctx, 'catalog', hash);
export const warehouseItems = (ctx: NativeContext, buckets: unknown[]) => warehouseSetItems(ctx, 'catalog', buckets);
export const invalidateWarehouse = () => invalidateNativeSync(Object.values(SETS).map((set) => set.name));

/** Słowniki: kategorie (z właściwościami `special_properties`), lokalizacje magazynowe, typy wtyków i przeznaczenia przewodów. */
export async function warehouseDictionaries(ctx: NativeContext) {
  const s = ctx.supabase;
  const [categories, locations, connectors, cableCategories] = await Promise.all([
    s.from('warehouse_categories').select('id,parent_id,name,description,color,level,order_index,special_properties').eq('is_active', true)
      .order('level', { ascending: true }).order('order_index', { ascending: true }),
    s.from('storage_locations').select('id,name').eq('is_active', true).order('name'),
    s.from('connector_types').select('id,name,description,common_uses,thumbnail_url,is_active').order('name'),
    s.from('cable_categories').select('id,parent_id,name,description,color,order_index,is_active').order('order_index').order('name'),
  ]);
  for (const result of [categories, locations, connectors]) if (result.error) throw result.error;
  const properties = (value: unknown) => (Array.isArray(value) ? value : [])
    .filter((p: Row) => typeof p?.name === 'string' && p.name.trim()).map((p: Row) => ({ name: String(p.name), value: p.value === true }));
  return {
    categories: (categories.data || []).map((row: Row) => ({
      id: String(row.id), parentId: row.parent_id || null, name: text(row.name), description: text(row.description), color: text(row.color),
      level: Number(row.level) || 1, order: Number(row.order_index) || 0,
      flags: Object.fromEntries((Array.isArray(row.special_properties) ? row.special_properties : [])
        .filter((p: Row) => typeof p?.name === 'string' && typeof p?.value === 'boolean').map((p: Row) => [p.name, p.value])),
      properties: properties(row.special_properties),
    })),
    locations: (locations.data || []).map((row: Row) => ({ id: String(row.id), name: text(row.name) })),
    connectors: (connectors.data || []).map((row: Row) => ({
      id: String(row.id), name: text(row.name), thumbnailUrl: row.thumbnail_url || null, description: text(row.description),
      commonUses: text(row.common_uses), active: row.is_active !== false,
    })),
    // Brak tabeli (migracja nie wdrożona) nie blokuje magazynu — lista przeznaczeń będzie pusta.
    cableCategories: cableCategories.error ? [] : (cableCategories.data || []).map((row: Row) => ({
      id: String(row.id), parentId: row.parent_id || null, name: text(row.name), description: text(row.description),
      color: text(row.color) || '#d3bb73', order: Number(row.order_index) || 0, active: row.is_active !== false,
    })),
  };
}

const unitItem = (row: Row) => ({
  id: String(row.id), serial: text(row.unit_serial_number), status: text(row.status) || 'available',
  locationId: row.location_id || null, locationName: text(row.storage_locations?.name), notes: text(row.condition_notes),
  purchaseDate: text(row.purchase_date), lastServiceDate: text(row.last_service_date), repairDate: text(row.estimated_repair_date),
  thumbnailUrl: row.thumbnail_url || null, createdAt: row.created_at || null,
});

const group = (rows: Row[], key: string) => {
  const map = new Map<string, Row[]>();
  for (const row of rows) {
    const id = row[key] ? String(row[key]) : '';
    if (!id) continue;
    const list = map.get(id);
    if (list) list.push(row); else map.set(id, [row]);
  }
  return map;
};
const specs = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value)
  ? Object.entries(value as Row).map(([key, v]) => ({ key, value: text(v) })) : []);
const time = (value: unknown) => (typeof value === 'string' ? Date.parse(value) || 0 : 0);

/**
 * Karty sprzętu jak `/crm/equipment/[id]`: dane, flagi kategorii (dziecko nadpisuje rodzica), jednostki, skład zestawu
 * (`equipment_components`) i elementy powiązane (`equipment_compatible_items`), galeria, pliki i historia zmian.
 * Bez `ids` — cały magazyn (zbiór `warehouse-details` synchronizowany na dysk Maca).
 */
async function buildDetails(ctx: NativeContext, ids?: string[]) {
  const s = ctx.supabase;
  const scope = (query: any, column: string) => (ids ? query.in(column, ids) : query);
  const [items, categories, units, history, images, files, components, compatible] = await Promise.all([
    pages(() => scope(s.from('equipment_items').select('*').is('deleted_at', null), 'id')),
    pages(() => s.from('warehouse_categories').select('id,parent_id,special_properties')),
    pages(() => scope(s.from('equipment_units').select('*, storage_locations:storage_locations(id,name)'), 'equipment_id')),
    pages(() => scope(s.from('equipment_edit_history')
      .select('id,equipment_id,field_name,old_value,new_value,change_type,changed_at,employees:employees(name,surname)'), 'equipment_id')),
    pages(() => scope(s.from('equipment_images').select('*'), 'equipment_id')),
    pages(() => scope(s.from('equipment_files').select('*'), 'equipment_id')),
    pages(() => scope(s.from('equipment_components')
      .select('*, equipment_items:equipment_items!equipment_components_component_equipment_id_fkey(id,name,model,brand,thumbnail_url)'), 'equipment_id')),
    pages(() => scope(s.from('equipment_compatible_items').select(`*,
      compatible_equipment:compatible_equipment_id(id,name,model,brand,thumbnail_url,cable_stock_quantity,equipment_units(id,status)),
      compatible_kit:compatible_kit_id(id,name,thumbnail_url,equipment_kit_items(quantity,equipment:equipment_items(name,model))),
      compatible_cable:compatible_cable_id(id,name,thumbnail_url,stock_quantity,stock_unit,length_meters)`), 'equipment_id')),
  ]);
  const categoryById = new Map(categories.map((row) => [String(row.id), row]));
  const props = (value: unknown) => new Map((Array.isArray(value) ? value : [])
    .filter((p: Row) => typeof p?.value === 'boolean').map((p: Row) => [String(p.name), p.value as boolean]));
  const unitsBy = group(units, 'equipment_id');
  const historyBy = group(history, 'equipment_id');
  const imagesBy = group(images, 'equipment_id');
  const filesBy = group(files, 'equipment_id');
  const componentsBy = group(components, 'equipment_id');
  const compatibleBy = group(compatible, 'equipment_id');
  const out = new Map<string, Record<string, unknown>>();
  for (const row of items) {
    const id = String(row.id);
    const category = row.warehouse_category_id ? categoryById.get(String(row.warehouse_category_id)) : null;
    const parent = category?.parent_id ? categoryById.get(String(category.parent_id)) : null;
    const own = props(category?.special_properties);
    const inherited = props(parent?.special_properties);
    const flag = (name: string) => own.get(name) ?? inherited.get(name) ?? false;
    const power = (row.power_specs || {}) as Row;
    const dims = (row.dimensions_cm || null) as Row | null;
    const cable = (row.cable_specs || null) as Row | null;
    const gallery = (imagesBy.get(id) || [])
      .sort((a, b) => Number(b.is_primary === true) - Number(a.is_primary === true) || (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
      .map((img) => ({
        id: String(img.id), url: text(img.image_url), title: text(img.title), primary: img.is_primary === true,
        order: Number(img.sort_order) || 0, createdAt: img.created_at || null,
      }));
    const documents = (filesBy.get(id) || []).sort((a, b) => time(b.created_at) - time(a.created_at)).map((f) => ({
      id: String(f.id), name: text(f.file_name), path: text(f.file_path), url: text(f.file_url), size: Number(f.file_size) || 0,
      mime: text(f.mime_type), createdAt: f.created_at || null,
    }));
    const parts = (componentsBy.get(id) || []).sort((a, b) => time(a.created_at) - time(b.created_at)).map((c) => ({
      id: String(c.id), name: text(c.component_name), quantity: Number(c.quantity) || 1, description: text(c.description),
      included: c.is_included !== false, integral: c.is_integral === true, optional: c.is_optional === true,
      equipmentId: c.component_equipment_id || null, thumbnailUrl: c.thumbnail_url || c.equipment_items?.thumbnail_url || null,
      specs: specs(c.technical_specs),
    }));
    const related = (compatibleBy.get(id) || [])
      .sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0) || time(a.created_at) - time(b.created_at))
      .flatMap((r) => {
        const eq = r.compatible_equipment as Row | null;
        const kit = r.compatible_kit as Row | null;
        const cab = r.compatible_cable as Row | null;
        const target = kit || cab || eq;
        if (!target) return [];
        const kind = kit ? 'kit' : cab ? 'cable' : 'equipment';
        // Dostępność jak `getAvailableQuantity` w CRM: przewód — stan, sprzęt — ilość przewodów albo liczba jednostek.
        const available = kind === 'kit' ? null : kind === 'cable' ? Number(cab?.stock_quantity) || 0
          : Number(eq?.cable_stock_quantity) > 0 ? Number(eq?.cable_stock_quantity) : Array.isArray(eq?.equipment_units) ? eq!.equipment_units.length : 0;
        return [{
          id: String(r.id), kind, targetId: String(target.id), name: text(target.name), brand: text(eq?.brand), model: text(eq?.model),
          thumbnailUrl: target.thumbnail_url || null, type: ['required', 'recommended', 'optional'].includes(r.compatibility_type) ? r.compatibility_type : 'optional',
          group: text(r.compatibility_group), quantity: Number(r.quantity) || 1, mode: r.quantity_mode === 'fixed' ? 'fixed' : 'per_item',
          notes: text(r.notes), order: Number(r.display_order) || 0, available,
          unit: kind === 'cable' && cab?.stock_unit === 'meter' ? 'm' : 'szt.',
          lengthMeters: num(cab?.length_meters),
          kitItems: kind === 'kit' ? (Array.isArray(kit?.equipment_kit_items) ? kit!.equipment_kit_items : []).map((i: Row) =>
            `${text(i.equipment?.name)}${i.equipment?.model ? ` ${i.equipment.model}` : ''} x${Number(i.quantity) || 1}`) : [],
        }];
      });
    out.set(id, {
      id, name: text(row.name), brand: text(row.brand), model: text(row.model), description: text(row.description),
      notes: text(row.notes), thumbnailUrl: row.thumbnail_url || null, manualUrl: text(row.user_manual_url),
      categoryId: row.warehouse_category_id || null, locationId: row.storage_location_id || null,
      weightKg: num(row.weight_kg),
      dimensions: dims ? { length: num(dims.length), width: num(dims.width), height: num(dims.height) } : null,
      cable: cable ? { lengthMeters: num(cable.length_meters), connectorIn: text(cable.connector_in), connectorOut: text(cable.connector_out) } : null,
      cableStockQuantity: Number(row.cable_stock_quantity) || 0,
      purchaseDate: text(row.purchase_date), purchasePrice: num(row.purchase_price), currentValue: num(row.current_value),
      depreciationRate: num(row.depreciation_rate), rentalPricePerDay: num(row.rental_price_per_day), warrantyUntil: text(row.warranty_until),
      serialNumber: text(row.serial_number), barcode: text(row.barcode), active: row.is_active !== false,
      power: {
        watts: num(power.power_watts), amps: num(power.current_amps), volts: num(power.voltage_volts) ?? 230,
        phase: power.power_phase === 'three_phase' ? 'three_phase' : 'single_phase',
        inputConnectorId: power.input_connector_type_id || null, outputConnectorId: power.output_connector_type_id || null, notes: text(power.power_notes),
      },
      preCheckAvailable: 'requires_pre_check' in row,
      requiresPreCheck: row.requires_pre_check === true, preCheckInstructions: text(row.pre_check_instructions),
      flags: {
        simpleQuantity: flag('simple_quantity'), requiresSerial: flag('requires_serial'), hideEvents: flag('hide_events'),
        disableUnits: flag('disable_units'), readOnly: flag('read_only'),
      },
      counts: { images: gallery.length, files: documents.length, components: related.length },
      units: (unitsBy.get(id) || []).sort((a, b) => time(b.created_at) - time(a.created_at)).map(unitItem),
      components: parts,
      compatible: related,
      images: gallery,
      files: documents,
      history: (historyBy.get(id) || []).sort((a, b) => time(b.changed_at) - time(a.changed_at)).slice(0, 300).map((h) => ({
        id: String(h.id), field: text(h.field_name), oldValue: text(h.old_value), newValue: text(h.new_value), type: text(h.change_type),
        at: h.changed_at || null, author: [h.employees?.name, h.employees?.surname].filter(Boolean).join(' '),
      })),
    });
  }
  return out;
}

async function loadDetailItems(ctx: NativeContext): Promise<Item[]> {
  return [...(await buildDetails(ctx))].map(([id, item]) => ({ id, item }));
}

/** Jedna karta sprzętu (ten sam kształt co pozycja zbioru `warehouse-details`). */
export async function equipmentDetail(ctx: NativeContext, id: string) {
  return (await buildDetails(ctx, [id])).get(id) ?? null;
}

/** Zestawy jak `fetchKits` (`equipment_kits` z `equipment_kit_items`); nazwy pozycji Mac bierze z kopii katalogu i przewodów. */
async function loadKits(ctx: NativeContext): Promise<Item[]> {
  const rows = await pages(() => ctx.supabase.from('equipment_kits').select('*, equipment_kit_items(*)').is('deleted_at', null));
  return rows.map((row) => ({
    id: String(row.id),
    item: {
      id: String(row.id), name: text(row.name), description: text(row.description), thumbnailUrl: row.thumbnail_url || null,
      categoryId: row.warehouse_category_id || null, quantity: Math.max(1, Number(row.quantity) || 1), active: row.is_active !== false,
      createdAt: row.created_at || null,
      items: (Array.isArray(row.equipment_kit_items) ? row.equipment_kit_items : [])
        .sort((a: Row, b: Row) => (Number(a.order_index) || 0) - (Number(b.order_index) || 0))
        .map((i: Row) => ({
          id: String(i.id), equipmentId: i.equipment_id || null, cableId: i.cable_id || null, quantity: Math.max(1, Number(i.quantity) || 1),
          notes: text(i.notes), order: Number(i.order_index) || 0,
        })),
    },
  }));
}

/** Przewody (`cables`, bez usuniętych) z ostatnimi zmianami stanu — lista, karta i wybór w zestawach. */
async function loadCables(ctx: NativeContext): Promise<Item[]> {
  const [rows, movements] = await Promise.all([
    pages(() => ctx.supabase.from('cables').select('*').is('deleted_at', null)),
    pages(() => ctx.supabase.from('cable_stock_movements')
      .select('id,cable_id,movement_type,quantity_delta,balance_after,reason,created_at,employee:employees!cable_stock_movements_created_by_fkey(name,surname)'))
      .catch(() => [] as Row[]),
  ]);
  const movementsBy = group(movements, 'cable_id');
  return rows.map((row) => ({
    id: String(row.id),
    item: {
      id: String(row.id), name: text(row.name), description: text(row.description), notes: text(row.notes), thumbnailUrl: row.thumbnail_url || null,
      lengthMeters: num(row.length_meters), connectorIn: row.connector_in || null, connectorOut: row.connector_out || null,
      stockQuantity: Number(row.stock_quantity) || 0, stockUnit: row.stock_unit === 'meter' ? 'meter' : 'piece',
      minimumStock: Number(row.minimum_stock_quantity) || 0, trackingMode: row.tracking_mode === 'individual' ? 'individual' : 'quantity',
      directional: row.is_directional === true, categoryId: row.warehouse_category_id || null, cableCategoryId: row.cable_category_id || null,
      locationId: row.storage_location_id || null, purchaseDate: text(row.purchase_date), purchasePrice: num(row.purchase_price),
      currentValue: num(row.current_value), specs: specs(row.technical_specs),
      tags: Array.isArray(row.usage_tags) ? row.usage_tags.map(text) : [], active: row.is_active !== false, createdAt: row.created_at || null,
      movements: (movementsBy.get(String(row.id)) || []).sort((a, b) => time(b.created_at) - time(a.created_at)).slice(0, 100).map((m) => ({
        id: String(m.id), type: text(m.movement_type), delta: Number(m.quantity_delta) || 0, balance: Number(m.balance_after) || 0,
        reason: text(m.reason), at: m.created_at || null, author: [m.employee?.name, m.employee?.surname].filter(Boolean).join(' '),
      })),
    },
  }));
}

/** Sprzęt wynajmu od podwykonawców (`subcontractor_rental_equipment`) jak `getAllRentalEquipment` i karta `/crm/subcontractors/rental/[id]`. */
async function loadRental(ctx: NativeContext): Promise<Item[]> {
  const rows = await pages(() => ctx.supabase.from('subcontractor_rental_equipment').select(`*,
    subcontractor:subcontractors(id,company_name,organization:organizations!subcontractors_organization_id_fkey(id,name,email,phone))`));
  return rows.map((row) => ({
    id: String(row.id),
    item: {
      id: String(row.id), name: text(row.name), description: text(row.description), category: text(row.category),
      categoryId: row.warehouse_category_id || null, quantity: Number(row.quantity_available) || 0, active: row.is_active !== false,
      thumbnailUrl: row.thumbnail_url || null, notes: text(row.notes), vatRate: num(row.vat_rate),
      dailyNet: num(row.daily_price_net), dailyGross: num(row.daily_price_gross), weeklyNet: num(row.weekly_price_net),
      weeklyGross: num(row.weekly_price_gross), monthlyNet: num(row.monthly_price_net), monthlyGross: num(row.monthly_price_gross),
      dailyPrice: num(row.daily_rental_price),
      skills: Array.isArray(row.required_skills) ? row.required_skills.map(text).filter(Boolean) : [],
      images: (Array.isArray(row.images) ? row.images : []).filter((img: Row) => typeof img?.url === 'string')
        .map((img: Row) => ({ url: String(img.url), title: text(img.title), primary: img.isPrimary === true })),
      specifications: row.specifications && typeof row.specifications === 'object' ? JSON.stringify(row.specifications) : '',
      subcontractorId: row.subcontractor?.id || row.subcontractor_id || null,
      company: text(row.subcontractor?.company_name), organization: text(row.subcontractor?.organization?.name),
      email: text(row.subcontractor?.organization?.email), phone: text(row.subcontractor?.organization?.phone),
      createdAt: row.created_at || null,
    },
  }));
}
