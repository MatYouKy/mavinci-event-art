import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NativeContext } from './auth';
import { fail, PRODUCT_UUID, productsAccess } from './products';
import {
  packageCostLineNet,
  packageCostSettlementLabels,
  staffCostItem,
  validatePackageResources,
} from '@/lib/CRM/Offers/productSalesPackages';
import {
  CONTRACT_CLAUSE_CATEGORY_LABELS,
  CONTRACT_CLAUSE_PRIMARY_CATEGORIES,
  CONTRACT_CLAUSE_TOPICS,
  getContractClauseTopicLabel,
  getContractClauseTopicOptions,
  parseContractClauseEntries,
  serializeContractClauseEntries,
  type ContractClauseEntry,
  type ContractClausePrimaryCategory,
} from '@/lib/CRM/contracts/contractClauseContent';
import { SHARED_CONTRACT_CLAUSES, getSharedContractClause } from '@/lib/CRM/contracts/sharedContractClauses';
import { systemLabel } from '@/lib/ui/systemLabels';

/*
 * Karta produktu na Macu, część B — sprzęt i zasoby, obsada (z kosztem dla firmy), Mavinci LIVE i klauzule umowy
 * w zakresie produktu bazowego albo wariantu (dziedziczenie jak „Zakres konfiguracji wariantu” w CRM):
 * te same tabele, zasady łączenia sprzętu, walidacja obsady (`validatePackageResources`) i zapis klauzul (wersja 2).
 */

type Row = Record<string, any>;
type Section = 'equipment' | 'staff' | 'mavinci_live' | 'contract_clauses';
const SECTIONS: Section[] = ['equipment', 'staff', 'mavinci_live', 'contract_clauses'];
const OVERRIDE: Record<Section, string> = {
  equipment: 'overrides_equipment',
  staff: 'overrides_staff',
  mavinci_live: 'overrides_mavinci_live',
  contract_clauses: 'overrides_contract_clauses',
};
const TABLE: Partial<Record<Section, string>> = {
  equipment: 'offer_product_equipment',
  staff: 'offer_product_staff',
  mavinci_live: 'offer_product_mavinci_live_modules',
};

const VARIANT_SELECT = 'id, name, is_active, display_order, overrides_equipment, overrides_staff, overrides_mavinci_live, '
  + 'overrides_contract_clauses, recommended_contract_clauses, recommended_contract_clause_category';

/** Zmienne do wstawienia w klauzuli (jak lista „Wstaw zmienną…” w CRM). */
const CLAUSE_PLACEHOLDERS: Array<[string, string]> = [
  ['{{event_name}}', 'Nazwa wydarzenia'],
  ['{{termin_dostarczenia_materialow}}', 'Wspólny termin materiałów'],
  ['{{event_schedule_contract}}', 'Termin wydarzenia'],
  ['{{planned_technical_schedule}}', 'Montaż i demontaż'],
  ['{{location_full}}', 'Lokalizacja'],
  ['{{organization_name}}', 'Organizacja klienta'],
  ['{{primary_contact_full_name}}', 'Osoba kontaktowa'],
  ['{{budget_brutto}}', 'Wartość brutto'],
];

const isMissingSchema = (message?: string) => /does not exist|schema cache|PGRST204|PGRST205|42P01|42703/i.test(message || '');
const uuid = (value: unknown, message: string) => {
  const id = String(value || '');
  if (!PRODUCT_UUID.test(id)) fail(message);
  return id;
};
const optionalUuid = (value: unknown) => (value == null || value === '' ? null : uuid(value, 'Nieprawidłowy wariant.'));

async function variantsOf(ctx: NativeContext, productId: string) {
  const { data, error } = await ctx.supabase.from('offer_product_variants').select(VARIANT_SELECT)
    .eq('product_id', productId).order('display_order');
  if (error) fail(error.message);
  return (data || []) as Row[];
}

/** Zakres zapisu sekcji: produkt bazowy (`null`) albo wariant z własną konfiguracją tej sekcji. */
async function editableScope(ctx: NativeContext, productId: string, variantValue: unknown, section: Section) {
  if (!productsAccess(ctx).canEdit) fail('Nie masz uprawnień do zmiany produktów.');
  const variantId = optionalUuid(variantValue);
  if (!variantId) return null;
  const variant = (await variantsOf(ctx, productId)).find((item) => item.id === variantId);
  if (!variant) fail('Nie znaleziono wariantu produktu.');
  if (section !== 'contract_clauses' && !variant[OVERRIDE[section]]) {
    fail('Ten wariant dziedziczy konfigurację produktu bazowego. Najpierw wybierz „Dostosuj wariant”.');
  }
  return variantId;
}

const scoped = (query: any, variantId: string | null) => (variantId ? query.eq('product_variant_id', variantId) : query.is('product_variant_id', null));

// MARK: Koszt obsady

/** Koszt roli dla firmy jak `ProductStaffSection` (opcjonalna — 0; bez stawki — `null`). */
export function staffRowCost(row: Row): number | null {
  if (row.is_optional) return 0;
  if (row.compensation) {
    const line = staffCostItem({ ...row, notes: row.notes || '' } as any);
    return line ? packageCostLineNet(line) : null;
  }
  return row.hourly_rate != null && row.estimated_hours != null
    ? Math.round(Number(row.hourly_rate) * Number(row.estimated_hours) * Number(row.quantity) * 100) / 100
    : null;
}

// MARK: Odczyt zakresu karty

export async function productResources(ctx: NativeContext, productValue: string, variantValue: string | null) {
  const access = productsAccess(ctx);
  const productId = uuid(productValue, 'Nieprawidłowy produkt.');
  const variantId = optionalUuid(variantValue);
  const [productRes, variants] = await Promise.all([
    ctx.supabase.from('offer_products').select('id, recommended_contract_clauses, recommended_contract_clause_category, sales_packages_enabled, sales_packages')
      .eq('id', productId).maybeSingle(),
    variantsOf(ctx, productId),
  ]);
  if (productRes.error || !productRes.data) fail('Nie znaleziono produktu.');
  const product = productRes.data as Row;
  const variant = variantId ? variants.find((item) => item.id === variantId) : null;
  if (variantId && !variant) fail('Nie znaleziono wariantu produktu.');
  const own = (section: Section) => Boolean(variant && variant[OVERRIDE[section]]);
  const scopeOf = (section: Section) => (own(section) ? variantId : null);

  const [equipment, staff, live, skills, compensation] = await Promise.all([
    equipmentRows(ctx, productId, scopeOf('equipment')),
    staffRows(ctx, productId, scopeOf('staff')),
    liveModules(ctx, productId, scopeOf('mavinci_live')),
    ctx.supabase.rpc('get_product_required_skills', { p_product_id: productId }),
    ctx.supabase.from('compensation_settings').select('cit_rate, dividend_rate, updated_at').eq('id', 1).maybeSingle(),
  ]);

  const clauseSource = own('contract_clauses') ? variant! : product;
  const entries = parseContractClauseEntries(clauseSource.recommended_contract_clauses || null,
    clauseSource.recommended_contract_clause_category || 'requirements');
  const costs = staff.map((row) => row.cost);
  const settings = compensation.data as Row | null;

  return {
    canEdit: access.canEdit,
    packages: product.sales_packages_enabled === true && Array.isArray(product.sales_packages) && product.sales_packages.length > 0,
    variants: variants.map((item) => ({
      id: String(item.id),
      name: String(item.name || 'Wariant'),
      active: item.is_active !== false,
      overrides: {
        equipment: Boolean(item.overrides_equipment),
        staff: Boolean(item.overrides_staff),
        mavinciLive: Boolean(item.overrides_mavinci_live),
        contractClauses: Boolean(item.overrides_contract_clauses),
      },
    })),
    scope: {
      variantId: variant ? String(variant.id) : null,
      variantName: variant ? String(variant.name || 'Wariant') : null,
      inherited: {
        equipment: Boolean(variant) && !own('equipment'),
        staff: Boolean(variant) && !own('staff'),
        mavinciLive: Boolean(variant) && !own('mavinci_live'),
        contractClauses: Boolean(variant) && !own('contract_clauses'),
      },
    },
    equipment,
    staff: {
      rows: staff,
      costNet: costs.some((cost) => cost == null) ? null : Math.round(costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0) * 100) / 100,
      requiredSkills: skills.error ? [] : ((skills.data || []) as Row[]).map((skill) => ({
        id: String(skill.skill_id),
        name: String(skill.skill_name || ''),
        description: skill.skill_description ? String(skill.skill_description) : null,
        category: skill.category_name ? String(skill.category_name) : null,
        minimum: String(skill.minimum_proficiency || ''),
        equipment: Array.isArray(skill.equipment_names) ? skill.equipment_names.map(String) : [],
      })),
    },
    live,
    clauses: entries.map((entry) => ({
      id: entry.id,
      category: entry.category,
      topic: entry.topic,
      title: entry.title,
      content: entry.content,
      sharedKey: entry.sharedKey ?? null,
    })),
    clauseMeta: {
      categories: CONTRACT_CLAUSE_PRIMARY_CATEGORIES.map((key) => ({ key, label: CONTRACT_CLAUSE_CATEGORY_LABELS[key] })),
      topics: CONTRACT_CLAUSE_TOPICS.map((topic) => ({ value: topic.value, category: topic.category, label: topic.label })),
      shared: SHARED_CONTRACT_CLAUSES.map((clause) => ({
        key: clause.key, category: clause.category, topic: clause.topic, title: clause.title, content: clause.content,
      })),
      placeholders: CLAUSE_PLACEHOLDERS.map(([value, label]) => ({ value, label })),
    },
    compensation: settings && Number.isFinite(Number(settings.cit_rate)) && Number.isFinite(Number(settings.dividend_rate))
      ? { cit_rate: Number(settings.cit_rate), dividend_rate: Number(settings.dividend_rate), updated_at: settings.updated_at ?? null }
      : null,
    settlementLabels: packageCostSettlementLabels,
  };
}

async function equipmentRows(ctx: NativeContext, productId: string, variantId: string | null) {
  const query = ctx.supabase.from('offer_product_equipment').select(
    '*, rental_equipment:subcontractor_rental_equipment(id, name, thumbnail_url, quantity_available, warehouse_category_id), '
    + 'subcontractor:subcontractors(id, organization:organizations!subcontractors_organization_id_fkey(name, alias))',
  ).eq('product_id', productId).is('replaced_by_rental_id', null);
  const { data, error } = await scoped(query, variantId).order('created_at', { ascending: true });
  if (error) fail(error.message);
  const rows = (data || []) as Row[];
  const itemIds = Array.from(new Set(rows.map((row) => row.equipment_item_id).filter(Boolean)));
  const kitIds = Array.from(new Set(rows.map((row) => row.equipment_kit_id).filter(Boolean)));
  const [items, kits, categories] = await Promise.all([
    itemIds.length
      ? ctx.supabase.from('equipment_items').select('id, name, brand, model, thumbnail_url, warehouse_category_id, equipment_units(id, status)').in('id', itemIds)
      : Promise.resolve({ data: [] as Row[] }),
    kitIds.length
      ? ctx.supabase.from('equipment_kits').select('id, name, thumbnail_url, warehouse_category_id, '
        + 'equipment_kit_items(id, quantity, order_index, equipment_items(id, name, model), cables(id, name, length_meters))').in('id', kitIds)
      : Promise.resolve({ data: [] as Row[] }),
    ctx.supabase.from('warehouse_categories').select('id, name'),
  ]);
  const itemMap = new Map(((items.data || []) as Row[]).map((item) => [String(item.id), item]));
  const kitMap = new Map(((kits.data || []) as Row[]).map((kit) => [String(kit.id), kit]));
  const categoryName = new Map(((categories.data || []) as Row[]).map((category) => [String(category.id), String(category.name || '')]));
  return rows.map((row) => {
    const rental = row.is_rental && row.rental_equipment ? (Array.isArray(row.rental_equipment) ? row.rental_equipment[0] : row.rental_equipment) : null;
    const mode = rental ? 'rental' : row.equipment_kit_id ? 'kit' : 'item';
    const source = rental || (row.equipment_kit_id ? kitMap.get(String(row.equipment_kit_id)) : itemMap.get(String(row.equipment_item_id || ''))) || null;
    const organization = row.subcontractor?.organization;
    const kitItems = mode === 'kit' && source
      ? ((source.equipment_kit_items || []) as Row[])
        .sort((a, b) => Number(a.order_index ?? 0) - Number(b.order_index ?? 0))
        .map((entry) => ({
          quantity: Number(entry.quantity || 1),
          name: String(entry.equipment_items?.name || entry.cables?.name || 'Nieznany element'),
          detail: entry.equipment_items?.model ? String(entry.equipment_items.model)
            : entry.cables?.length_meters ? `${entry.cables.length_meters} m` : null,
        }))
      : [];
    return {
      id: String(row.id),
      mode,
      targetId: String(row.equipment_kit_id || row.equipment_item_id || row.rental_equipment_id || ''),
      name: String(source?.name || 'Nieznany'),
      brand: mode === 'item' && source?.brand ? String(source.brand) : null,
      model: mode === 'item' && source?.model ? String(source.model) : null,
      thumbnail: source?.thumbnail_url ? String(source.thumbnail_url) : null,
      category: source?.warehouse_category_id ? categoryName.get(String(source.warehouse_category_id)) || null : null,
      available: mode === 'item' && source
        ? ((source.equipment_units || []) as Row[]).filter((unit) => unit.status === 'available').length
        : mode === 'rental' && source?.quantity_available != null ? Number(source.quantity_available) : null,
      quantity: Number(row.quantity || 1),
      optional: row.is_optional === true,
      notes: row.notes ? String(row.notes) : null,
      supplier: organization ? String(organization.alias || organization.name || '') || null : null,
      kitItems,
    };
  });
}

async function staffRows(ctx: NativeContext, productId: string, variantId: string | null) {
  const query = ctx.supabase.from('offer_product_staff').select('*').eq('product_id', productId);
  const { data, error } = await scoped(query, variantId).order('created_at', { ascending: true });
  if (error) fail(error.message);
  return ((data || []) as Row[]).map((row) => ({
    id: String(row.id),
    role: String(row.role || ''),
    roleLabel: systemLabel(row.role, 'role', { preserveCustom: true }),
    quantity: Number(row.quantity || 1),
    estimatedHours: row.estimated_hours == null ? null : Number(row.estimated_hours),
    hourlyRate: row.hourly_rate == null ? null : Number(row.hourly_rate),
    optional: row.is_optional === true,
    notes: row.notes ? String(row.notes) : null,
    paymentType: row.payment_type ? String(row.payment_type) : null,
    compensation: row.compensation && typeof row.compensation === 'object' ? row.compensation : null,
    cost: staffRowCost(row),
  }));
}

async function liveModules(ctx: NativeContext, productId: string, variantId: string | null) {
  const links = scoped(ctx.supabase.from('offer_product_mavinci_live_modules').select('module_key').eq('product_id', productId), variantId);
  const [modules, selected] = await Promise.all([
    ctx.supabase.from('mavinci_live_modules').select('module_key, name, description, display_order').eq('is_active', true).order('display_order'),
    links,
  ]);
  const problem = modules.error || selected.error;
  if (problem) {
    if (isMissingSchema(problem.message)) return { available: false, modules: [] as Row[] };
    fail(problem.message);
  }
  const keys = new Set(((selected.data || []) as Row[]).map((row) => String(row.module_key)));
  return {
    available: true,
    modules: ((modules.data || []) as Row[]).map((module) => ({
      key: String(module.module_key),
      name: String(module.name || module.module_key),
      description: module.description ? String(module.description) : null,
      selected: keys.has(String(module.module_key)),
    })),
  };
}

// MARK: Katalog sprzętu do wyboru

export async function equipmentCatalog(ctx: NativeContext) {
  if (!productsAccess(ctx).canView) fail('Nie masz dostępu do produktów.');
  const [items, kits, categories] = await Promise.all([
    ctx.supabase.from('equipment_items').select('id, name, brand, model, thumbnail_url, description, warehouse_category_id, equipment_units(id, status)')
      .is('deleted_at', null).eq('is_active', true).order('name'),
    ctx.supabase.from('equipment_kits').select('id, name, thumbnail_url, description, warehouse_category_id, '
      + 'equipment_kit_items(id, quantity, order_index, equipment_items(id, name, model), cables(id, name, length_meters))')
      .eq('is_active', true).order('name'),
    ctx.supabase.from('warehouse_categories').select('id, name'),
  ]);
  if (items.error) fail(items.error.message);
  if (kits.error) fail(kits.error.message);
  const categoryName = new Map(((categories.data || []) as Row[]).map((category) => [String(category.id), String(category.name || '')]));
  return {
    items: [
      ...((items.data || []) as Row[]).map((item) => ({
        id: String(item.id),
        kind: 'item',
        name: String(item.name || ''),
        brand: item.brand ? String(item.brand) : null,
        model: item.model ? String(item.model) : null,
        description: item.description ? String(item.description).slice(0, 300) : null,
        thumbnail: item.thumbnail_url ? String(item.thumbnail_url) : null,
        category: item.warehouse_category_id ? categoryName.get(String(item.warehouse_category_id)) || null : null,
        available: ((item.equipment_units || []) as Row[]).filter((unit) => unit.status === 'available').length,
        kitItems: [] as Row[],
      })),
      ...((kits.data || []) as Row[]).map((kit) => ({
        id: String(kit.id),
        kind: 'kit',
        name: String(kit.name || ''),
        brand: null,
        model: null,
        description: kit.description ? String(kit.description).slice(0, 300) : null,
        thumbnail: kit.thumbnail_url ? String(kit.thumbnail_url) : null,
        category: kit.warehouse_category_id ? categoryName.get(String(kit.warehouse_category_id)) || null : null,
        available: null,
        kitItems: ((kit.equipment_kit_items || []) as Row[])
          .sort((a, b) => Number(a.order_index ?? 0) - Number(b.order_index ?? 0))
          .map((entry) => ({
            quantity: Number(entry.quantity || 1),
            name: String(entry.equipment_items?.name || entry.cables?.name || 'Nieznany element'),
            detail: entry.equipment_items?.model ? String(entry.equipment_items.model)
              : entry.cables?.length_meters ? `${entry.cables.length_meters} m` : null,
          })),
      })),
    ],
  };
}

// MARK: Sprzęt

const notesText = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (text.length > 500) fail('Notatki mogą mieć maksymalnie 500 znaków.');
  return text || null;
};
const wholeQuantity = (value: unknown) => {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) fail('Podaj całkowitą ilość od 1 do 10 000.');
  return quantity;
};

/** Dodanie sprzętu lub zestawu; ponowny wybór tej samej pozycji zwiększa ilość (jak `addOfferProductEquipment`). */
export async function addEquipment(ctx: NativeContext, body: Row) {
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const variantId = await editableScope(ctx, productId, body.variantId, 'equipment');
  const kit = body.mode === 'kit';
  const targetId = uuid(body.targetId, 'Wybierz sprzęt lub zestaw z katalogu.');
  const quantity = wholeQuantity(body.quantity ?? 1);
  const optional = body.optional === true;
  const notes = notesText(body.notes);
  const target = await ctx.supabase.from(kit ? 'equipment_kits' : 'equipment_items').select('id').eq('id', targetId).maybeSingle();
  if (target.error || !target.data) fail('Nie znaleziono wybranego sprzętu.');

  const findExisting = async () => {
    const query = ctx.supabase.from('offer_product_equipment').select('*').eq('product_id', productId)
      .eq(kit ? 'equipment_kit_id' : 'equipment_item_id', targetId);
    const { data, error } = await scoped(query, variantId).limit(1);
    if (error) fail(error.message);
    return ((data || []) as Row[])[0] || null;
  };
  const merge = async (existing: Row) => {
    const { error } = await ctx.supabase.from('offer_product_equipment').update({
      quantity: Math.max(1, Number(existing.quantity || 0) + quantity),
      // Wymagane wystąpienie ma pierwszeństwo przed opcjonalnym.
      is_optional: Boolean(existing.is_optional) && optional,
      notes: notes || existing.notes || null,
      replaced_by_rental_id: null,
    }).eq('id', existing.id);
    if (error) fail(error.message);
  };
  const existing = await findExisting();
  if (existing) {
    await merge(existing);
  } else {
    const { error } = await ctx.supabase.from('offer_product_equipment').insert({
      product_id: productId,
      product_variant_id: variantId,
      quantity,
      is_optional: optional,
      notes,
      equipment_item_id: kit ? null : targetId,
      equipment_kit_id: kit ? targetId : null,
    });
    if (error?.code === '23505') {
      const raced = await findExisting();
      if (raced) await merge(raced);
      else fail(error.message);
    } else if (error) {
      fail(error.message);
    }
  }
  return productResources(ctx, productId, body.variantId || null);
}

async function ownEquipmentRow(ctx: NativeContext, productId: string, rowValue: unknown) {
  const rowId = uuid(rowValue, 'Nieprawidłowa pozycja sprzętu.');
  const { data, error } = await ctx.supabase.from('offer_product_equipment').select('*').eq('id', rowId).eq('product_id', productId).maybeSingle();
  if (error || !data) fail('Nie znaleziono pozycji sprzętu.');
  const row = data as Row;
  await editableScope(ctx, productId, row.product_variant_id, 'equipment');
  if (row.is_rental) fail('Sprzęt z wynajmu zmienisz w kalkulacji wydarzenia.');
  return row;
}

export async function updateEquipment(ctx: NativeContext, body: Row) {
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const row = await ownEquipmentRow(ctx, productId, body.rowId);
  const patch: Row = {};
  if ('quantity' in body) patch.quantity = wholeQuantity(body.quantity);
  if ('optional' in body) patch.is_optional = body.optional === true;
  if ('notes' in body) patch.notes = notesText(body.notes);
  if (!Object.keys(patch).length) fail('Brak zmian do zapisania.');
  const { error } = await ctx.supabase.from('offer_product_equipment').update(patch).eq('id', row.id).eq('product_id', productId);
  if (error) fail(error.message);
  return productResources(ctx, productId, body.variantId || null);
}

export async function removeEquipment(ctx: NativeContext, body: Row) {
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const row = await ownEquipmentRow(ctx, productId, body.rowId);
  const { error } = await ctx.supabase.from('offer_product_equipment').delete().eq('id', row.id).eq('product_id', productId);
  if (error) fail(error.message);
  return productResources(ctx, productId, body.variantId || null);
}

// MARK: Obsada

/** Rola obsady z kosztem (jak `AddStaffModal`): walidacja `validatePackageResources`, stawka godzinowa i rodzaj płatności. */
export async function saveStaff(ctx: NativeContext, body: Row) {
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const rowId = body.rowId ? uuid(body.rowId, 'Nieprawidłowa rola.') : null;
  let existing: Row | null = null;
  let variantId: string | null;
  if (rowId) {
    const { data, error } = await ctx.supabase.from('offer_product_staff').select('*').eq('id', rowId).eq('product_id', productId).maybeSingle();
    if (error || !data) fail('Nie znaleziono roli.');
    existing = data as Row;
    variantId = await editableScope(ctx, productId, existing.product_variant_id, 'staff');
  } else {
    variantId = await editableScope(ctx, productId, body.variantId, 'staff');
  }
  const role = String(body.role ?? '').trim();
  const quantity = Number(body.quantity);
  const hours = body.estimatedHours == null || body.estimatedHours === '' ? null : Number(body.estimatedHours);
  const optional = body.optional === true;
  const notes = String(body.notes ?? '').trim();
  const input = body.compensation && typeof body.compensation === 'object' ? body.compensation as Row : null;
  const compensation = input ? {
    rate_basis: input.rate_basis === 'hourly' ? 'hourly' : input.rate_basis === 'per_service' ? 'per_service' : String(input.rate_basis || ''),
    rate: Number(input.rate),
    settlement_method: String(input.settlement_method || ''),
    compensation_snapshot: input.settlement_method === 'cash_non_deductible' && input.compensation_snapshot && typeof input.compensation_snapshot === 'object'
      ? {
          cit_rate: Number(input.compensation_snapshot.cit_rate),
          dividend_rate: Number(input.compensation_snapshot.dividend_rate),
          ...(input.compensation_snapshot.updated_at ? { updated_at: String(input.compensation_snapshot.updated_at) } : {}),
        }
      : null,
  } : null;
  const problem = validatePackageResources({
    equipment: [],
    staff: [{ id: rowId || 'draft', role, quantity, estimated_hours: hours, is_optional: optional, notes, compensation: compensation as any }],
  });
  if (problem) fail(problem);
  const values = {
    role,
    quantity,
    estimated_hours: hours,
    hourly_rate: compensation?.rate_basis === 'hourly' ? compensation.rate : null,
    is_optional: optional,
    notes: notes || null,
    compensation,
    payment_type: compensation?.settlement_method === 'cash_documented' ? 'cash_documented'
      : compensation?.settlement_method === 'cash_non_deductible' ? 'cash_no_receipt'
        : existing?.payment_type === 'invoice_no_vat' ? 'invoice_no_vat' : 'invoice_with_vat',
  };
  const { error } = existing
    ? await ctx.supabase.from('offer_product_staff').update(values).eq('id', existing.id).eq('product_id', productId)
    : await ctx.supabase.from('offer_product_staff').insert({ id: randomUUID(), ...values, product_id: productId, product_variant_id: variantId });
  if (error) fail(error.message);
  return productResources(ctx, productId, body.variantId || null);
}

export async function removeStaff(ctx: NativeContext, body: Row) {
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const rowId = uuid(body.rowId, 'Nieprawidłowa rola.');
  const { data, error } = await ctx.supabase.from('offer_product_staff').select('id, product_variant_id').eq('id', rowId).eq('product_id', productId).maybeSingle();
  if (error || !data) fail('Nie znaleziono roli.');
  await editableScope(ctx, productId, (data as Row).product_variant_id, 'staff');
  const removed = await ctx.supabase.from('offer_product_staff').delete().eq('id', rowId).eq('product_id', productId);
  if (removed.error) fail(removed.error.message);
  return productResources(ctx, productId, body.variantId || null);
}

// MARK: Mavinci LIVE

export async function toggleLiveModule(ctx: NativeContext, body: Row) {
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const variantId = await editableScope(ctx, productId, body.variantId, 'mavinci_live');
  const key = String(body.key || '');
  const { data: module, error: moduleError } = await ctx.supabase.from('mavinci_live_modules').select('module_key').eq('module_key', key).eq('is_active', true).maybeSingle();
  if (moduleError || !module) fail('Nie znaleziono modułu Mavinci LIVE.');
  if (body.on === true) {
    const exists = await scoped(ctx.supabase.from('offer_product_mavinci_live_modules').select('module_key').eq('product_id', productId).eq('module_key', key), variantId).limit(1);
    if (exists.error) fail(exists.error.message);
    if (!(exists.data || []).length) {
      const { error } = await ctx.supabase.from('offer_product_mavinci_live_modules').insert({ product_id: productId, product_variant_id: variantId, module_key: key });
      if (error) fail(error.message);
    }
  } else {
    const { error } = await scoped(ctx.supabase.from('offer_product_mavinci_live_modules').delete().eq('product_id', productId).eq('module_key', key), variantId);
    if (error) fail(error.message);
  }
  return productResources(ctx, productId, body.variantId || null);
}

// MARK: Klauzule umowy

const CLAUSE_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'blockquote', 'ol', 'ul', 'li', 'br']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math']);
const CLAUSE_ATTRIBUTES: Record<string, { tags: string[]; pattern: RegExp }> = {
  'data-contract-paragraph': { tags: ['p', 'h1', 'h2', 'h3'], pattern: /^true$/ },
  'data-clause-role': { tags: ['p', 'h1', 'h2', 'h3', 'li'], pattern: /^[A-Za-z]{1,40}$/ },
  'data-clause-align': { tags: ['p', 'h1', 'h2', 'h3', 'li', 'blockquote'], pattern: /^(left|center|right|justify)$/ },
  'data-clause-indent': { tags: ['p', 'h1', 'h2', 'h3', 'blockquote'], pattern: /^\d{1,2}$/ },
  'data-clause-marker': { tags: ['ol'], pattern: /^[a-z-]{1,40}$/ },
  'data-contract-list-continuation': { tags: ['ol', 'ul'], pattern: /^[A-Za-z0-9-]{0,40}$/ },
  'data-contract-list-item-continuation': { tags: ['li'], pattern: /^[A-Za-z0-9-]{0,40}$/ },
  start: { tags: ['ol'], pattern: /^\d{1,4}$/ },
};
const escapeText = (value: string) => value.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Treść klauzuli z Maca: tylko znaczniki i atrybuty, które zostawia `normalizeContractClauseHtml` w CRM. */
export function sanitizeClauseHtml(input: string) {
  const html = String(input || '');
  const tokens = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s>"'=/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
  let output = '';
  let cursor = 0;
  let dropping: string | null = null;
  const open: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(html))) {
    if (!dropping) output += escapeText(html.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    if (match[0].startsWith('<!--')) continue;
    const tag = match[1].toLowerCase();
    const closing = match[0].startsWith('</');
    if (dropping) {
      if (closing && tag === dropping) dropping = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !match[0].endsWith('/>')) dropping = tag;
      continue;
    }
    if (!CLAUSE_TAGS.has(tag)) continue;
    if (closing) {
      const index = open.lastIndexOf(tag);
      if (index === -1) continue;
      while (open.length > index) output += `</${open.pop()}>`;
      continue;
    }
    if (tag === 'br') { output += '<br>'; continue; }
    let attributes = '';
    const attributePattern = /([^\s>"'=/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let attribute: RegExpExecArray | null;
    while ((attribute = attributePattern.exec(match[2] || ''))) {
      const name = attribute[1].toLowerCase();
      const value = attribute[3] ?? attribute[4] ?? attribute[5] ?? '';
      const rule = CLAUSE_ATTRIBUTES[name];
      if (rule && rule.tags.includes(tag) && rule.pattern.test(value)) attributes += ` ${name}="${value}"`;
    }
    output += `<${tag}${attributes}>`;
    open.push(tag);
  }
  if (!dropping) output += escapeText(html.slice(cursor));
  while (open.length) output += `</${open.pop()}>`;
  return output.trim();
}

const hasClauseText = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;

export async function saveClauses(ctx: NativeContext, body: Row) {
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const variantId = await editableScope(ctx, productId, body.variantId, 'contract_clauses');
  const input = Array.isArray(body.entries) ? body.entries as Row[] : [];
  if (input.length > 60) fail('Produkt może mieć najwyżej 60 klauzul.');
  const entries: ContractClauseEntry[] = input.flatMap((entry, index) => {
    const shared = getSharedContractClause(entry?.sharedKey);
    if (shared) {
      return [{ id: String(entry.id || `shared-${shared.key}-${index}`).slice(0, 80), category: shared.category, topic: shared.topic,
        title: shared.title, content: shared.content, sharedKey: shared.key }];
    }
    const category = (CONTRACT_CLAUSE_PRIMARY_CATEGORIES as string[]).includes(String(entry?.category))
      ? entry.category as ContractClausePrimaryCategory : 'requirements';
    const topics = getContractClauseTopicOptions(category);
    const topic = topics.some((item) => item.value === entry?.topic) ? String(entry.topic) : topics[0]?.value || 'technical';
    const raw = String(entry?.content ?? '');
    if (raw.length > 40000) fail('Treść klauzuli jest za długa.');
    const content = sanitizeClauseHtml(raw);
    if (!hasClauseText(content)) return [];
    const title = String(entry?.title ?? '').trim().slice(0, 200) || getContractClauseTopicLabel(topic);
    return [{ id: String(entry?.id || randomUUID()).slice(0, 80), category, topic, title, content }];
  });
  const first = entries[0]?.category;
  // Kolumna historyczna ma starszy CHECK — pełna kategoria jest w dokumencie wersji 2 (jak zapis w CRM).
  const storedCategory = first === 'additional_requirements' ? 'general' : first === 'conditions' ? 'requirements' : first || 'requirements';
  const serialized = entries.length ? serializeContractClauseEntries(entries) : null;
  const { data, error } = variantId
    ? await ctx.supabase.from('offer_product_variants').update({
        recommended_contract_clauses: serialized, recommended_contract_clause_category: storedCategory, overrides_contract_clauses: true,
      }).eq('id', variantId).eq('product_id', productId).select('id')
    : await ctx.supabase.from('offer_products').update({
        recommended_contract_clauses: serialized, recommended_contract_clause_category: storedCategory,
      }).eq('id', productId).select('id');
  if (error) fail(error.message);
  if (!data?.length) fail('Nie udało się zapisać klauzul.');
  return productResources(ctx, productId, body.variantId || null);
}

// MARK: Zakres wariantu (dostosowanie / dziedziczenie)

export async function customizeVariant(ctx: NativeContext, body: Row) {
  if (!productsAccess(ctx).canEdit) fail('Nie masz uprawnień do zmiany produktów.');
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const variantId = uuid(body.variantId, 'Wybierz wariant.');
  const section = String(body.section || '') as Section;
  if (!SECTIONS.includes(section)) fail('Nieznana sekcja.');
  const variant = (await variantsOf(ctx, productId)).find((item) => item.id === variantId);
  if (!variant) fail('Nie znaleziono wariantu produktu.');
  if (variant[OVERRIDE[section]]) return productResources(ctx, productId, variantId);
  const table = TABLE[section];
  if (table) {
    const { data, error } = await ctx.supabase.from(table).select('*').eq('product_id', productId).is('product_variant_id', null);
    if (error) fail(error.message);
    const rows = ((data || []) as Row[]).map((row) => {
      const { id: _id, created_at: _created, updated_at: _updated, ...copy } = row;
      return { ...copy, product_id: productId, product_variant_id: variantId };
    });
    if (rows.length) {
      const inserted = await ctx.supabase.from(table).insert(rows);
      if (inserted.error) fail(inserted.error.message);
    }
  }
  const patch: Row = { [OVERRIDE[section]]: true };
  if (section === 'contract_clauses') {
    const { data: product } = await ctx.supabase.from('offer_products').select('recommended_contract_clauses, recommended_contract_clause_category')
      .eq('id', productId).maybeSingle();
    patch.recommended_contract_clauses = (product as Row | null)?.recommended_contract_clauses || null;
    patch.recommended_contract_clause_category = (product as Row | null)?.recommended_contract_clause_category || 'requirements';
  }
  const { error } = await ctx.supabase.from('offer_product_variants').update(patch).eq('id', variantId).eq('product_id', productId);
  if (error) fail(error.message);
  return productResources(ctx, productId, variantId);
}

export async function inheritVariant(ctx: NativeContext, body: Row) {
  if (!productsAccess(ctx).canEdit) fail('Nie masz uprawnień do zmiany produktów.');
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const variantId = uuid(body.variantId, 'Wybierz wariant.');
  const section = String(body.section || '') as Section;
  if (!SECTIONS.includes(section)) fail('Nieznana sekcja.');
  const variant = (await variantsOf(ctx, productId)).find((item) => item.id === variantId);
  if (!variant) fail('Nie znaleziono wariantu produktu.');
  const table = TABLE[section];
  if (table) {
    const { error } = await ctx.supabase.from(table).delete().eq('product_id', productId).eq('product_variant_id', variantId);
    if (error) fail(error.message);
  }
  const patch: Row = { [OVERRIDE[section]]: false };
  if (section === 'contract_clauses') {
    patch.recommended_contract_clauses = null;
    patch.recommended_contract_clause_category = 'requirements';
  }
  const { error } = await ctx.supabase.from('offer_product_variants').update(patch).eq('id', variantId).eq('product_id', productId);
  if (error) fail(error.message);
  return productResources(ctx, productId, variantId);
}
