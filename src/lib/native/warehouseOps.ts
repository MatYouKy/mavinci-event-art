import 'server-only';
import { randomUUID } from 'node:crypto';
import { checkKitInventory } from '@/lib/CRM/equipment/kitInventory';
import type { NativeContext } from './auth';
import { invalidateWarehouse, text, type Row } from './warehouse';

/*
 * Zapisy karty sprzętu z Maca jak w CRM: skład zestawu (`ComponentsTab`, `ComponentEditDialog`), galeria (`EquipmentGallery`),
 * pliki (`FilesTab`) i zestawy (`KitsPageClient` → `saveEquipmentKit`). Tokenem pracownika — RLS i magazyn plików jak w przeglądarce.
 * Każda funkcja zwraca komunikat błędu albo `null`.
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
const optionalText = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const wholeQuantity = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) && Number.isInteger(amount) && amount >= 1 ? amount : null;
};
const COMPAT_TYPES = ['required', 'recommended', 'optional'];
const done = (message: string | null = null) => {
  if (!message) invalidateWarehouse();
  return message;
};

// MARK: Skład zestawu

export async function addComponent(ctx: NativeContext, equipmentId: string, data: Row) {
  if (!isId(equipmentId)) return 'Nieprawidłowy sprzęt.';
  const fromWarehouse = isId(data.componentEquipmentId);
  let name = optionalText(data.name);
  if (fromWarehouse) {
    const { data: eq } = await ctx.supabase.from('equipment_items').select('name,model').eq('id', data.componentEquipmentId).maybeSingle();
    if (!eq) return 'Nie znaleziono sprzętu z magazynu.';
    name = `${eq.name}${eq.model ? ` ${eq.model}` : ''}`;
  }
  if (!name) return 'Podaj nazwę komponentu.';
  const quantity = wholeQuantity(data.quantity);
  if (!quantity) return 'Wpisz poprawną ilość — liczbę całkowitą większą od zera.';
  const optional = data.optional === true;
  const technical = Array.isArray(data.specs)
    ? Object.fromEntries((data.specs as Row[]).filter((s) => optionalText(s?.key) && optionalText(s?.value)).map((s) => [String(s.key).trim(), String(s.value).trim()]))
    : {};
  const { error } = await ctx.supabase.from('equipment_components').insert({
    equipment_id: equipmentId,
    component_equipment_id: fromWarehouse ? data.componentEquipmentId : null,
    component_name: name, quantity, description: optionalText(data.description),
    is_included: !optional, is_integral: !fromWarehouse, is_optional: optional,
    thumbnail_url: fromWarehouse ? null : optionalText(data.thumbnailUrl),
    technical_specs: !fromWarehouse && Object.keys(technical).length ? technical : null,
  });
  return done(error ? 'Błąd podczas dodawania komponentu' : null);
}

export async function updateComponent(ctx: NativeContext, id: string, data: Row) {
  if (!isId(id)) return 'Nieprawidłowy komponent.';
  const quantity = wholeQuantity(data.quantity);
  if (!quantity) return 'Wpisz poprawną ilość — liczbę całkowitą większą od zera.';
  const name = optionalText(data.name);
  if (!name) return 'Podaj nazwę komponentu.';
  const optional = data.optional === true;
  const { data: rows, error } = await ctx.supabase.from('equipment_components')
    .update({ component_name: name, quantity, description: optionalText(data.description), is_optional: optional, is_included: !optional })
    .eq('id', id).select('id');
  if (error) return error.message || 'Nie udało się zapisać zmian.';
  return done(rows?.length ? null : 'Nie znaleziono komponentu lub brak uprawnień.');
}

export async function deleteComponent(ctx: NativeContext, id: string) {
  if (!isId(id)) return 'Nieprawidłowy komponent.';
  const { error } = await ctx.supabase.from('equipment_components').delete().eq('id', id);
  return done(error ? 'Błąd podczas usuwania komponentu' : null);
}

export async function addCompatible(ctx: NativeContext, equipmentId: string, data: Row) {
  if (!isId(equipmentId)) return 'Nieprawidłowy sprzęt.';
  const kind = ['equipment', 'kit', 'cable'].includes(data.kind) ? String(data.kind) : '';
  if (!kind || !isId(data.targetId)) return 'Wybierz produkt.';
  if (kind === 'equipment' && data.targetId === equipmentId) return 'Nie można powiązać sprzętu z nim samym.';
  const { count } = await ctx.supabase.from('equipment_compatible_items').select('id', { count: 'exact', head: true }).eq('equipment_id', equipmentId);
  const { error } = await ctx.supabase.from('equipment_compatible_items').insert({
    equipment_id: equipmentId,
    compatibility_type: COMPAT_TYPES.includes(data.type) ? data.type : 'optional',
    compatibility_group: optionalText(data.group),
    quantity: Math.max(1, Number(data.quantity) || 1),
    quantity_mode: data.mode === 'fixed' ? 'fixed' : 'per_item',
    notes: optionalText(data.notes),
    display_order: count || 0,
    compatible_equipment_id: kind === 'equipment' ? data.targetId : null,
    compatible_kit_id: kind === 'kit' ? data.targetId : null,
    compatible_cable_id: kind === 'cable' ? data.targetId : null,
  });
  return done(error ? error.message || 'Błąd podczas dodawania produktu' : null);
}

export async function updateCompatible(ctx: NativeContext, id: string, data: Row) {
  if (!isId(id)) return 'Nieprawidłowy element.';
  const quantity = wholeQuantity(data.quantity);
  if (!quantity) return 'Wpisz poprawną ilość — liczbę całkowitą większą od zera.';
  const { data: rows, error } = await ctx.supabase.from('equipment_compatible_items').update({
    quantity, compatibility_type: COMPAT_TYPES.includes(data.type) ? data.type : 'optional', compatibility_group: optionalText(data.group),
    quantity_mode: data.mode === 'fixed' ? 'fixed' : 'per_item', notes: optionalText(data.notes),
  }).eq('id', id).select('id');
  if (error) return error.message || 'Nie udało się zapisać zmian.';
  return done(rows?.length ? null : 'Nie znaleziono elementu lub brak uprawnień.');
}

export async function deleteCompatible(ctx: NativeContext, id: string) {
  if (!isId(id)) return 'Nieprawidłowy element.';
  const { error } = await ctx.supabase.from('equipment_compatible_items').delete().eq('id', id);
  return done(error ? 'Błąd podczas usuwania' : null);
}

// MARK: Galeria i pliki

export async function uploadGalleryImage(ctx: NativeContext, equipmentId: string, file: File) {
  if (!isId(equipmentId)) return 'Nieprawidłowy sprzęt.';
  if (!(file.type || '').startsWith('image/')) return `${file.name} nie jest obrazem`;
  if (file.size > 10 * 1024 * 1024) return `${file.name} przekracza 10MB`;
  const { count } = await ctx.supabase.from('equipment_images').select('id', { count: 'exact', head: true }).eq('equipment_id', equipmentId);
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${equipmentId}/${Date.now()}-${randomUUID().slice(0, 7)}.${ext}`;
  const upload = await ctx.supabase.storage.from('equipment-images').upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type });
  if (upload.error) return `Błąd podczas przesyłania ${file.name}`;
  const { data: { publicUrl } } = ctx.supabase.storage.from('equipment-images').getPublicUrl(path);
  const { error } = await ctx.supabase.from('equipment_images').insert({
    equipment_id: equipmentId, image_url: publicUrl, title: file.name, is_primary: !count, sort_order: count || 0, uploaded_by: ctx.employee.id,
  });
  if (error) {
    await ctx.supabase.storage.from('equipment-images').remove([path]);
    return `Błąd podczas przesyłania ${file.name}`;
  }
  return done();
}

export async function setPrimaryImage(ctx: NativeContext, equipmentId: string, id: string) {
  if (!isId(equipmentId) || !isId(id)) return 'Nieprawidłowe zdjęcie.';
  const off = await ctx.supabase.from('equipment_images').update({ is_primary: false }).eq('equipment_id', equipmentId);
  if (off.error) return 'Błąd podczas ustawiania zdjęcia głównego';
  const on = await ctx.supabase.from('equipment_images').update({ is_primary: true }).eq('id', id);
  return done(on.error ? 'Błąd podczas ustawiania zdjęcia głównego' : null);
}

export async function deleteImage(ctx: NativeContext, id: string) {
  if (!isId(id)) return 'Nieprawidłowe zdjęcie.';
  const { data: image } = await ctx.supabase.from('equipment_images').select('image_url').eq('id', id).maybeSingle();
  const parts = text(image?.image_url).split('/equipment-images/');
  if (parts.length > 1) await ctx.supabase.storage.from('equipment-images').remove([decodeURIComponent(parts[1])]);
  const { error } = await ctx.supabase.from('equipment_images').delete().eq('id', id);
  return done(error ? 'Błąd podczas usuwania zdjęcia' : null);
}

export async function uploadEquipmentFile(ctx: NativeContext, equipmentId: string, file: File) {
  if (!isId(equipmentId)) return 'Nieprawidłowy sprzęt.';
  if (file.size > 50 * 1024 * 1024) return `${file.name} przekracza 50MB`;
  const ext = file.name.split('.').pop() || 'bin';
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${equipmentId}/${Date.now()}-${randomUUID().slice(0, 7)}-${safeName}`;
  const upload = await ctx.supabase.storage.from('equipment-files').upload(path, new Uint8Array(await file.arrayBuffer()), {
    contentType: file.type || undefined,
  });
  if (upload.error) return `Błąd przesyłania ${file.name}`;
  const { data: { publicUrl } } = ctx.supabase.storage.from('equipment-files').getPublicUrl(path);
  const { error } = await ctx.supabase.from('equipment_files').insert({
    equipment_id: equipmentId, file_name: file.name, file_path: path, file_url: publicUrl, file_size: file.size,
    mime_type: file.type || `application/${ext}`, uploaded_by: ctx.employee.id,
  });
  if (error) {
    await ctx.supabase.storage.from('equipment-files').remove([path]);
    return `Błąd przesyłania ${file.name}`;
  }
  return done();
}

export async function renameFile(ctx: NativeContext, id: string, name: unknown) {
  if (!isId(id)) return 'Nieprawidłowy plik.';
  const next = optionalText(name);
  if (!next) return 'Nazwa pliku nie może być pusta';
  const { data: rows, error } = await ctx.supabase.from('equipment_files').update({ file_name: next }).eq('id', id).select('id');
  if (error) return 'Błąd zmiany nazwy pliku';
  return done(rows?.length ? null : 'Nie znaleziono pliku lub brak uprawnień.');
}

export async function deleteFile(ctx: NativeContext, id: string) {
  if (!isId(id)) return 'Nieprawidłowy plik.';
  const { data: file } = await ctx.supabase.from('equipment_files').select('file_path').eq('id', id).maybeSingle();
  if (file?.file_path) await ctx.supabase.storage.from('equipment-files').remove([file.file_path]);
  const { error } = await ctx.supabase.from('equipment_files').delete().eq('id', id);
  return done(error ? 'Błąd usuwania pliku' : null);
}

// MARK: Zestawy

/** Zapis zestawu jak `saveEquipmentKit`: kontrola stanów (sprawne sztuki minus inne zestawy), potem RPC pod blokadą. */
export async function saveKit(ctx: NativeContext, id: string | null, kit: Row, items: Row[]): Promise<{ id?: string; error?: string }> {
  const name = optionalText(kit.name);
  if (!name) return { error: 'Nazwa zestawu jest wymagana' };
  const components = items.map((item) => ({
    equipment_id: isId(item.equipmentId) ? item.equipmentId : null,
    cable_id: isId(item.cableId) ? item.cableId : null,
    quantity: Number(item.quantity),
    notes: optionalText(item.notes) || '',
  }));
  if (!components.length) return { error: 'Dodaj przynajmniej jedną pozycję do zestawu' };
  const quantity = Number(kit.quantity);
  const s = ctx.supabase;
  const [kits, equipment, cables] = await Promise.all([
    s.from('equipment_kits').select('id,quantity,is_active,deleted_at,equipment_kit_items(equipment_id,cable_id,quantity)'),
    s.from('equipment_items').select('id,name,is_active,total_quantity,equipment_units(status)'),
    s.from('cables').select('id,name,is_active,deleted_at,stock_quantity'),
  ]);
  for (const result of [kits, equipment, cables]) if (result.error) return { error: result.error.message };
  try {
    const check = checkKitInventory(id, quantity, components, (kits.data || []) as any, (equipment.data || []) as any, (cables.data || []) as any);
    if (check.shortages.length) return { error: `Nie można zapisać zestawu. Maksymalnie ${check.maxQuantity} kompletów. ${check.shortages.join(' ')}` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Nieprawidłowy zestaw.' };
  }
  const { data, error } = await s.rpc('save_equipment_kit_checked', {
    p_kit_id: id,
    p_kit: {
      name, quantity, description: optionalText(kit.description) || '', thumbnail_url: optionalText(kit.thumbnailUrl) || '',
      warehouse_category_id: isId(kit.categoryId) ? kit.categoryId : '',
    },
    p_items: components,
  });
  if (error) {
    if (error.code === 'PGRST202') return { error: 'Zapis zablokowany: zabezpieczenie magazynu wymaga wdrożenia migracji bazy danych.' };
    return { error: error.message };
  }
  invalidateWarehouse();
  return { id: String(data) };
}

// MARK: Przewody (`/crm/equipment/cables`, `cables/new`, `cables/[id]`, `cables/categories`)

const floatOrNull = (value: unknown) => (value == null || value === '' || Number.isNaN(Number(value)) ? null : Number(value));
const intOrNull = (value: unknown) => (value == null || value === '' || Number.isNaN(Number(value)) ? null : Math.round(Number(value)));
const dayOrNull = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
const idOrNull = (value: unknown) => (isId(value) ? value : null);

function cablePayload(data: Row) {
  return {
    name: optionalText(data.name) || '',
    length_meters: floatOrNull(data.lengthMeters),
    connector_in: idOrNull(data.connectorIn),
    connector_out: idOrNull(data.connectorOut),
    storage_location_id: idOrNull(data.locationId),
    cable_category_id: idOrNull(data.cableCategoryId),
    stock_unit: data.stockUnit === 'meter' ? 'meter' : 'piece',
    tracking_mode: data.trackingMode === 'individual' ? 'individual' : 'quantity',
    minimum_stock_quantity: Math.max(0, intOrNull(data.minimumStock) ?? 0),
    is_directional: data.directional === true,
    description: optionalText(data.description),
    thumbnail_url: optionalText(data.thumbnailUrl),
    purchase_date: dayOrNull(data.purchaseDate),
    purchase_price: floatOrNull(data.purchasePrice),
    current_value: floatOrNull(data.currentValue),
    notes: optionalText(data.notes),
  };
}

/** Nowy przewód jak `cables/new` (`createCable`). */
export async function createCable(ctx: NativeContext, data: Row): Promise<{ id?: string; error?: string }> {
  if (!optionalText(data.name)) return { error: 'Podaj nazwę przewodu' };
  if (!isId(data.connectorIn) || !isId(data.connectorOut)) return { error: 'Wybierz typ złącz' };
  const { data: row, error } = await ctx.supabase.from('cables').insert({
    ...cablePayload(data),
    warehouse_category_id: idOrNull(data.categoryId),
    stock_quantity: Math.max(0, intOrNull(data.stockQuantity) ?? 0),
  }).select('id').single();
  if (error) return { error: 'Błąd podczas dodawania' };
  invalidateWarehouse();
  return { id: String(row.id) };
}

/** Zapis karty przewodu jak `updateCable`: dane, a zmiana stanu przez `adjust_cable_stock` (wpis w historii stanu). */
export async function updateCable(ctx: NativeContext, id: string, data: Row) {
  if (!isId(id)) return 'Nieprawidłowy przewód.';
  if (!optionalText(data.name)) return 'Podaj nazwę przewodu';
  const { data: current } = await ctx.supabase.from('cables').select('stock_quantity').eq('id', id).maybeSingle();
  if (!current) return 'Nie znaleziono kabla';
  const { error } = await ctx.supabase.from('cables').update(cablePayload(data)).eq('id', id);
  if (error) return 'Błąd podczas zapisywania';
  const next = intOrNull(data.stockQuantity);
  if (next != null && next !== Number(current.stock_quantity)) {
    const { error: stockError } = await ctx.supabase.rpc('adjust_cable_stock', { p_cable_id: id, p_new_quantity: next, p_reason: 'Korekta z karty przewodu' });
    if (stockError) return stockError.message || 'Błąd podczas zapisywania';
  }
  return done();
}

export async function deleteCable(ctx: NativeContext, id: string) {
  if (!isId(id)) return 'Nieprawidłowy przewód.';
  const { error } = await ctx.supabase.from('cables').update({ deleted_at: new Date().toISOString(), is_active: false }).eq('id', id);
  return done(error ? 'Błąd podczas usuwania' : null);
}

/** Kategoria przewodów jak `cables/categories` (te same reguły: dwa poziomy, aktywność rodzica i dzieci, unikalna nazwa w grupie). */
export async function saveCableCategory(ctx: NativeContext, data: Row) {
  const id = isId(data.id) ? data.id : randomUUID();
  const existing = data.existing === true && isId(data.id);
  const name = optionalText(data.name);
  const order = Number(data.order);
  if (!name || !Number.isInteger(order) || Math.abs(order) > 2147483647) return 'Podaj nazwę i całkowitą liczbę określającą kolejność.';
  const parentId = isId(data.parentId) ? data.parentId : '';
  const active = data.active !== false;
  const { data: all, error: readError } = await ctx.supabase.from('cable_categories').select('id,parent_id,name,is_active');
  if (readError) return 'Nie udało się pobrać kategorii przewodów.';
  const rows = (all || []) as Row[];
  const children = rows.filter((row) => row.parent_id === id);
  const parent = rows.find((row) => row.id === parentId);
  if (parentId && (!parent || parent.parent_id || parent.id === id || children.length)) return 'Wybierz grupę główną. Kategoria z podkategoriami musi pozostać grupą główną.';
  if (active && parent && parent.is_active === false) return 'Najpierw włącz grupę nadrzędną.';
  if (!active && children.some((row) => row.is_active !== false)) return 'Najpierw wyłącz aktywne podkategorie tej grupy.';
  if (rows.some((row) => row.id !== id && (row.parent_id || '') === parentId && text(row.name).trim().toLocaleLowerCase('pl-PL') === name.toLocaleLowerCase('pl-PL'))) {
    return 'Kategoria o tej nazwie już istnieje w wybranej grupie.';
  }
  const color = typeof data.color === 'string' && /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : '#d3bb73';
  const payload = { name, parent_id: parentId || null, description: optionalText(data.description), color, order_index: order, is_active: active, updated_at: new Date().toISOString() };
  const result = existing
    ? await ctx.supabase.from('cable_categories').update(payload).eq('id', id).select('id').single()
    : await ctx.supabase.from('cable_categories').upsert({ ...payload, id, slug: `custom-${id}` }, { onConflict: 'id' }).select('id').single();
  if (result.error) {
    return result.error.code === '42501' ? 'Brak uprawnień do zapisu. Sprawdź uprawnienia do sprzętu i wdrożenie migracji kategorii.' : result.error.message || 'Nie udało się zapisać kategorii.';
  }
  return done();
}

// MARK: Wtyki (`/crm/equipment/connectors`, `ConnectorsView`)

export async function saveConnector(ctx: NativeContext, id: string | null, data: Row) {
  const name = optionalText(data.name);
  if (!name) return 'Podaj nazwę wtyka.';
  const payload = { name, description: optionalText(data.description) || '', common_uses: optionalText(data.commonUses) || '', thumbnail_url: optionalText(data.thumbnailUrl) };
  const { error } = id && isId(id)
    ? await ctx.supabase.from('connector_types').update(payload).eq('id', id)
    : await ctx.supabase.from('connector_types').insert({ ...payload, is_active: true });
  return done(error ? 'Błąd podczas zapisywania wtyka' : null);
}

export async function deleteConnector(ctx: NativeContext, id: string) {
  if (!isId(id)) return 'Nieprawidłowy wtyk.';
  const { error } = await ctx.supabase.from('connector_types').delete().eq('id', id);
  return done(error ? 'Błąd podczas usuwania wtyka' : null);
}

/** Miniatura wtyka do `connector-thumbnails` (jak `uploadThumbnail` w `ConnectorsView`) — zwraca adres. */
export async function uploadConnectorThumb(ctx: NativeContext, file: File): Promise<{ url?: string; error?: string }> {
  if (!(file.type || '').startsWith('image/')) return { error: 'Plik musi być obrazem' };
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${Date.now()}_${randomUUID().slice(0, 7)}.${ext}`;
  const upload = await ctx.supabase.storage.from('connector-thumbnails').upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type });
  if (upload.error) return { error: 'Błąd podczas przesyłania zdjęcia' };
  return { url: ctx.supabase.storage.from('connector-thumbnails').getPublicUrl(path).data.publicUrl };
}

// MARK: Kategorie magazynu (`/crm/equipment/categories`)

const sanitizeProps = (list: unknown) => {
  const seen = new Set<string>();
  const out: Array<{ name: string; value: boolean }> = [];
  for (const p of Array.isArray(list) ? (list as Row[]) : []) {
    const name = String(p?.name ?? '').trim();
    if (!name || seen.has(name)) continue;
    out.push({ name, value: p?.value === true });
    seen.add(name);
  }
  return out;
};

export async function saveWarehouseCategory(ctx: NativeContext, id: string | null, data: Row) {
  const name = optionalText(data.name);
  if (!name) return 'Podaj nazwę kategorii.';
  const description = optionalText(data.description);
  const special = sanitizeProps(data.properties);
  if (id && isId(id)) {
    const { error } = await ctx.supabase.from('warehouse_categories').update({ name, description, special_properties: special }).eq('id', id);
    return done(error ? error.message || 'Błąd zapisu' : null);
  }
  const parentId = isId(data.parentId) ? data.parentId : null;
  const { data: siblings } = parentId
    ? await ctx.supabase.from('warehouse_categories').select('order_index').eq('is_active', true).eq('parent_id', parentId)
    : await ctx.supabase.from('warehouse_categories').select('order_index').eq('is_active', true).eq('level', 1);
  const orders = ((siblings || []) as Row[]).map((row) => Number(row.order_index) || 0);
  const { error } = await ctx.supabase.from('warehouse_categories').insert({
    name, description, special_properties: special, level: parentId ? 2 : 1, parent_id: parentId,
    order_index: (orders.length ? Math.max(...orders) : -1) + 1, color: '#d3bb73',
  });
  return done(error ? error.message || 'Błąd dodawania' : null);
}

export async function deleteWarehouseCategory(ctx: NativeContext, id: string) {
  if (!isId(id)) return 'Nieprawidłowa kategoria.';
  const { error } = await ctx.supabase.from('warehouse_categories').delete().eq('id', id);
  return done(error ? error.message || 'Błąd usuwania' : null);
}

// MARK: Rental (`/crm/equipment/rental`, karta `/crm/subcontractors/rental/[id]`)

export async function updateRental(ctx: NativeContext, id: string, data: Row) {
  if (!isId(id)) return 'Nieprawidłowy sprzęt.';
  const name = optionalText(data.name);
  if (!name) return 'Podaj nazwę sprzętu.';
  const images = (Array.isArray(data.images) ? (data.images as Row[]) : [])
    .filter((img) => typeof img?.url === 'string' && img.url)
    .map((img) => ({ url: String(img.url), title: text(img.title), isPrimary: img.primary === true }));
  const { error } = await ctx.supabase.from('subcontractor_rental_equipment').update({
    name, description: optionalText(data.description), warehouse_category_id: idOrNull(data.categoryId),
    vat_rate: floatOrNull(data.vatRate) ?? 23,
    daily_price_net: floatOrNull(data.dailyNet), daily_price_gross: floatOrNull(data.dailyGross),
    weekly_price_net: floatOrNull(data.weeklyNet), weekly_price_gross: floatOrNull(data.weeklyGross),
    monthly_price_net: floatOrNull(data.monthlyNet), monthly_price_gross: floatOrNull(data.monthlyGross),
    quantity_available: Math.max(0, intOrNull(data.quantity) ?? 0),
    required_skills: (Array.isArray(data.skills) ? data.skills : []).map(text).map((v: string) => v.trim()).filter(Boolean),
    notes: optionalText(data.notes), is_active: data.active !== false, images,
    thumbnail_url: images.find((img) => img.isPrimary)?.url || images[0]?.url || null,
  }).eq('id', id);
  return done(error ? error.message || 'Błąd podczas zapisywania' : null);
}

export async function deleteRental(ctx: NativeContext, id: string) {
  if (!isId(id)) return 'Nieprawidłowy sprzęt.';
  const { error } = await ctx.supabase.from('subcontractor_rental_equipment').delete().eq('id', id);
  return done(error ? error.message || 'Błąd podczas usuwania' : null);
}

/** Zdjęcie sprzętu wynajmu do `rental-equipment-images` (jak `RentalEquipmentGallery`) — zwraca adres; lista zdjęć zapisuje się z kartą. */
export async function uploadRentalImage(ctx: NativeContext, equipmentId: string, file: File): Promise<{ url?: string; error?: string }> {
  if (!isId(equipmentId)) return { error: 'Nieprawidłowy sprzęt.' };
  if (!(file.type || '').startsWith('image/')) return { error: `${file.name} nie jest obrazem` };
  const path = `${equipmentId}/${Date.now()}-${randomUUID().slice(0, 7)}.jpg`;
  const upload = await ctx.supabase.storage.from('rental-equipment-images').upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: 'image/jpeg' });
  if (upload.error) return { error: `Błąd podczas przesyłania ${file.name}` };
  return { url: ctx.supabase.storage.from('rental-equipment-images').getPublicUrl(path).data.publicUrl };
}
