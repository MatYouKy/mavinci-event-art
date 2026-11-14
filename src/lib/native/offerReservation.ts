import 'server-only';
import type { NativeContext } from './auth';
import { fail, offerDetail } from './offers';
import { eventConfirmationPreview, sendEventConfirmation } from './eventCard';

/*
 * Oferty na Macu, część D3 — akceptacja oferty z wydarzeniem i rezerwacja sprzętu jak `ReserveEquipmentModal`: wybór
 * akceptowanego pakietu, kontrola konfiguracji pozycji z pakietami, sprzęt z dostępnością w terminie wydarzenia
 * (`get_offer_equipment_for_reservation`), zamienniki z tej samej kategorii magazynu (z wymaganymi komponentami),
 * akceptowanie braków, opcjonalne potwierdzenie realizacji dla klienta i zapis `reserve_selected_equipment`.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: unknown, message = 'Nieprawidłowa oferta.') => {
  const id = String(value || '');
  if (!UUID.test(id)) fail(message);
  return id;
};
const text = (value: unknown) => (value == null ? '' : String(value));
const key = (type: unknown, id: unknown) => `${text(type)}-${text(id)}`;

const CONTEXT_SELECT = `id, event_id, status, sales_channel, package_mode, accepted_package_id,
  offer_items(product_variant:offer_product_variants!product_variant_id(name)),
  packages:offer_packages!offer_id(id, name, price_net, is_recommended, display_order,
    items:offer_package_items(product_variant:offer_product_variants!product_variant_id(name)))`;

async function context(ctx: NativeContext, id: string) {
  const [{ data: allowed, error: permissionError }, { data, error }] = await Promise.all([
    ctx.supabase.rpc('sales_can_manage_offer', { p_offer: id }),
    ctx.supabase.from('offers').select(CONTEXT_SELECT).eq('id', id).maybeSingle(),
  ]);
  if (error || !data) fail('Nie udało się odczytać danych oferty.');
  if (permissionError || allowed !== true) fail('Nie masz uprawnień do tej oferty.');
  const offer = data as Row;
  if (offer.sales_channel === 'seller_portal') fail('Ofertę z portalu sprzedawcy obsługujesz w obsłudze oferty sprzedawcy.');
  if (!offer.event_id) fail('Nie znaleziono eventu dla tej oferty');
  const packages = ((offer.packages || []) as Row[])
    .slice().sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
    .map((pkg) => ({
      id: String(pkg.id), name: text(pkg.name), priceNet: Number(pkg.price_net || 0), recommended: Boolean(pkg.is_recommended),
      variants: ((pkg.items || []) as Row[]).map((item) => text(item.product_variant?.name)).filter(Boolean),
    }));
  const packageMode = Boolean(offer.package_mode && packages.length);
  return { offer, packages, packageMode };
}

/** Pozycje z pakietem bez wybranego pakietu albo bez zapisanego sprzętu i obsady (jak kontrola przed akceptacją w CRM). */
async function resourceIssues(ctx: NativeContext, offerId: string, packageId: string | null) {
  let query = ctx.supabase.from('offer_items').select('id, name, pricing_configuration').eq('offer_id', offerId);
  if (packageId) {
    const { data: packageItems, error } = await ctx.supabase.from('offer_package_items').select('offer_item_id').eq('package_id', packageId);
    if (error) fail(error.message || 'Nie udało się sprawdzić sprzętu oferty.');
    query = query.in('id', ((packageItems || []) as Row[]).map((item) => item.offer_item_id));
  }
  const { data, error } = await query;
  if (error) fail(error.message || 'Nie udało się sprawdzić sprzętu oferty.');
  return ((data || []) as Row[]).flatMap((item) => {
    const selection = item.pricing_configuration?.product_package;
    if (!selection) return [];
    const selected = Array.isArray(selection.options) ? selection.options.find((option: Row) => option.id === selection.selected_id) : null;
    const resources = selected?.resources;
    const missing = [!Array.isArray(resources?.equipment) && 'sprzęt', !Array.isArray(resources?.staff) && 'obsadę'].filter(Boolean).join(' i ');
    return !selected || missing
      ? [{ id: String(item.id), name: text(item.name), packageName: text(selected?.name) || 'Nie wybrano pakietu', missing: selected ? missing : 'wybór pakietu' }]
      : [];
  });
}

async function equipmentOf(ctx: NativeContext, offerId: string, packageId: string | null) {
  const { data, error } = await ctx.supabase.rpc('get_offer_equipment_for_reservation', { p_offer_id: offerId, p_package_id: packageId });
  if (error) fail(error.message || 'Nie udało się sprawdzić sprzętu oferty.');
  return ((data || []) as Row[]).map((item) => ({
    key: key(item.item_type, item.item_id),
    type: text(item.item_type) as 'item' | 'kit',
    itemId: String(item.item_id),
    name: text(item.item_name) || 'Sprzęt',
    required: Number(item.required_qty) || 0,
    total: Number(item.total_qty) || 0,
    reserved: Number(item.reserved_qty) || 0,
    available: Number(item.available_qty) || 0,
    conflict: item.has_conflict === true,
    shortage: Number(item.shortage_qty) || 0,
  }));
}

/**
 * Okno „Zarezerwuj sprzęt”: pakiety (przy ofercie z pakietami), warianty zapisywane przy akceptacji, braki konfiguracji,
 * sprzęt z dostępnością i — przy nowej akceptacji — odbiorca potwierdzenia realizacji.
 */
export async function offerReservation(ctx: NativeContext, id: string, requestedPackage: string | null) {
  const offerId = uuid(id);
  const { offer, packages, packageMode } = await context(ctx, offerId);
  const packageId = packageMode
    ? (packages.find((pkg) => pkg.id === requestedPackage)?.id || packages.find((pkg) => pkg.id === offer.accepted_package_id)?.id
      || packages.find((pkg) => pkg.recommended)?.id || packages[0]?.id || null)
    : null;
  const variants = packageMode
    ? packages.find((pkg) => pkg.id === packageId)?.variants || []
    : ((offer.offer_items || []) as Row[]).map((item) => text(item.product_variant?.name)).filter(Boolean);
  const isNew = offer.status !== 'accepted';
  let confirmation: Row | null = null;
  if (isNew) {
    try {
      confirmation = { preview: await eventConfirmationPreview(ctx, String(offer.event_id)), error: null };
    } catch (error) {
      confirmation = { preview: null, error: (error as Error).message || 'Nie udało się odczytać odbiorcy.' };
    }
  }
  const issues = await resourceIssues(ctx, offerId, packageId);
  const base = {
    eventId: String(offer.event_id), status: text(offer.status), isNewAcceptance: isNew, packageMode, packages, packageId, variants,
    confirmation, issues,
  };
  if (issues.length) return { ...base, error: 'Przed akceptacją uzupełnij konfigurację wskazanych pozycji oferty.', equipment: [] };
  return { ...base, error: null, equipment: await equipmentOf(ctx, offerId, packageId) };
}

// MARK: Zamienniki

type Component = Row;

/** Wymagane komponenty sprzętu (`equipment_compatible_items`, typ „required”). */
async function requiredComponents(ctx: NativeContext, equipmentId: string): Promise<Component[]> {
  const { data, error } = await ctx.supabase.from('equipment_compatible_items')
    .select(`id, compatible_equipment_id, compatible_kit_id, compatible_cable_id, compatibility_type, quantity, quantity_mode,
      compatible_equipment:equipment_items!compatible_equipment_id(id, name, model, brand),
      compatible_kit:equipment_kits!compatible_kit_id(id, name, description),
      compatible_cable:cables!compatible_cable_id(id, name, description, stock_unit)`)
    .eq('equipment_id', equipmentId).eq('compatibility_type', 'required');
  if (error) return [];
  const first = (value: unknown) => (Array.isArray(value) ? value[0] : value) as Row | undefined;
  return ((data || []) as Row[]).map((row) => {
    const equipment = first(row.compatible_equipment);
    const kit = first(row.compatible_kit);
    const cable = first(row.compatible_cable);
    const target = equipment || kit || cable;
    return {
      id: String(row.id),
      equipmentId: row.compatible_equipment_id || null,
      kitId: row.compatible_kit_id || null,
      cableId: row.compatible_cable_id || null,
      name: text(target?.name) || 'Komponent',
      kind: kit ? 'kit' : cable ? 'cable' : 'item',
      detail: kit ? text(kit.description) : cable ? text(cable.description) : [equipment?.brand, equipment?.model].filter(Boolean).join(' '),
      quantity: Math.max(1, Number(row.quantity || 1)),
      fixed: row.quantity_mode === 'fixed',
      meters: cable?.stock_unit === 'meter',
    };
  }).filter((component) => component.equipmentId || component.kitId || component.cableId);
}

async function availableUnits(ctx: NativeContext, equipmentId: string) {
  const { count, error } = await ctx.supabase.from('equipment_units').select('*', { count: 'exact', head: true })
    .eq('equipment_id', equipmentId).eq('status', 'available');
  if (error) fail('Nie udało się pobrać zamienników. Spróbuj ponownie.');
  return count || 0;
}

/** „Rozwiąż konflikt”: dostępny sprzęt z tej samej kategorii magazynu (bez zestawów — jak w CRM). */
export async function offerSubstitutes(ctx: NativeContext, id: string, itemId: string) {
  const offerId = uuid(id);
  await context(ctx, offerId);
  const equipmentId = uuid(itemId, 'Nieprawidłowy sprzęt.');
  const { data: item, error } = await ctx.supabase.from('equipment_items').select('warehouse_category_id').eq('id', equipmentId).maybeSingle();
  if (error) fail('Nie udało się pobrać zamienników. Spróbuj ponownie.');
  const category = (item as Row | null)?.warehouse_category_id;
  if (!category) return { substitutes: [] };
  const { data, error: listError } = await ctx.supabase.from('equipment_items').select('id, name, brand, model, thumbnail_url, warehouse_category_id')
    .eq('warehouse_category_id', category).neq('id', equipmentId).order('name');
  if (listError) fail('Nie udało się pobrać zamienników. Spróbuj ponownie.');
  const rows = await Promise.all(((data || []) as Row[]).map(async (row) => ({
    id: String(row.id), name: text(row.name), brand: text(row.brand), model: text(row.model), thumbnailUrl: row.thumbnail_url || null,
    available: await availableUnits(ctx, String(row.id)),
    components: await requiredComponents(ctx, String(row.id)),
  })));
  return { substitutes: rows.filter((row) => row.available > 0) };
}

/**
 * Zapis zamiennika (poprzedni dla tego sprzętu jest zastępowany); `addComponents` — wymagane komponenty trafiają do sprzętu
 * wydarzenia jako zarezerwowane (ilość na sztukę zamiennika albo stała).
 */
export async function saveOfferSubstitution(ctx: NativeContext, body: Row) {
  const offerId = uuid(body.id);
  const { offer } = await context(ctx, offerId);
  const fromId = uuid(body.fromItemId, 'Nieprawidłowy sprzęt.');
  const toId = uuid(body.toItemId, 'Wybierz zamiennik.');
  const quantity = Number(body.quantity);
  const available = await availableUnits(ctx, toId);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > available) fail('Podaj pełną liczbę sztuk od 1 do dostępnej ilości.');
  if (body.addComponents === true) {
    for (const component of await requiredComponents(ctx, toId)) {
      const count = component.fixed ? component.quantity : component.quantity * quantity;
      const target = component.equipmentId ? { equipment_id: component.equipmentId } : component.kitId ? { kit_id: component.kitId } : { cable_id: component.cableId };
      const { error } = await ctx.supabase.from('event_equipment').insert({ event_id: offer.event_id, ...target, quantity: count, status: 'reserved', offer_id: offerId });
      if (error) fail(error.message || 'Błąd podczas dodawania komponentów');
    }
  }
  const { error: deleteError } = await ctx.supabase.from('offer_equipment_substitutions').delete().eq('offer_id', offerId).eq('from_item_id', fromId);
  if (deleteError) fail(deleteError.message || 'Błąd podczas zapisywania substytucji');
  const { error } = await ctx.supabase.from('offer_equipment_substitutions').insert({ offer_id: offerId, from_item_id: fromId, to_item_id: toId, qty: quantity });
  if (error) fail(error.message || 'Błąd podczas zapisywania substytucji');
  return offerReservation(ctx, offerId, body.packageId ? text(body.packageId) : null);
}

// MARK: Akceptacja i rezerwacja

/**
 * „Potwierdź rezerwację” / „Potwierdź ofertę”: zaznaczony dostępny sprzęt i zaakceptowane braki (ilości z bieżącej
 * dostępności), akceptowany pakiet, a przy nowej akceptacji — opcjonalnie potwierdzenie realizacji do klienta.
 */
export async function confirmOfferReservation(ctx: NativeContext, body: Row, accessToken: string) {
  const offerId = uuid(body.id);
  const { offer, packages, packageMode } = await context(ctx, offerId);
  const packageId = packageMode ? packages.find((pkg) => pkg.id === text(body.packageId))?.id || null : null;
  if (packageMode && !packageId) fail('Wybierz akceptowany pakiet.');
  if ((await resourceIssues(ctx, offerId, packageId)).length) fail('Przed akceptacją uzupełnij konfigurację wskazanych pozycji oferty.');
  const equipment = await equipmentOf(ctx, offerId, packageId);
  const selected = new Set((Array.isArray(body.items) ? body.items : []).map(text));
  const shortages = new Set((Array.isArray(body.shortages) ? body.shortages : []).map(text));
  const items = equipment.filter((item) => selected.has(item.key) && !item.conflict)
    .map((item) => ({ item_type: item.type, item_id: item.itemId, qty: item.required }));
  const accepted = equipment.filter((item) => shortages.has(item.key))
    .map((item) => ({ item_type: item.type, item_id: item.itemId, shortage_qty: item.shortage }));
  if (equipment.length && !items.length && !accepted.length) fail('Zaznacz sprzęt do rezerwacji albo zaakceptuj braki.');

  const isNew = offer.status !== 'accepted';
  const sendConfirmation = body.sendConfirmation === true && isNew;
  const expected = text(body.expectedRecipientEmail);
  if (sendConfirmation) {
    const preview = await eventConfirmationPreview(ctx, String(offer.event_id)).catch(() => null);
    if (!preview?.recipientEmail || preview.recipientEmail !== expected || preview.eventId !== String(offer.event_id)) {
      fail('Dane akceptacji lub odbiorcy zmieniły się. Otwórz okno ponownie przed wysłaniem potwierdzenia.');
    }
  }

  const { data, error } = await ctx.supabase.rpc('reserve_selected_equipment', {
    p_offer_id: offerId, p_items: items, p_accepted_shortages: accepted, p_package_id: packageId,
  });
  if (error) fail(error.message || 'Błąd podczas rezerwacji sprzętu');
  const result = (data || {}) as Row;
  if (!result.success) fail(text(result.error) || 'Nie potwierdzono zapisania akceptacji i rezerwacji.');

  let confirmation: Row | null = null;
  if (sendConfirmation) {
    try {
      const sent = await sendEventConfirmation(ctx, accessToken, String(offer.event_id), expected);
      confirmation = { sent: true, message: `Oferta zaakceptowana. Potwierdzenie wysłano do ${sent.recipientEmail}` };
    } catch (mailError) {
      confirmation = { sent: false, message: `Oferta i rezerwacja zostały zapisane. ${(mailError as Error).message || 'Nie potwierdzono wysłania wiadomości.'}` };
    }
  }
  const rejected = Number(result.rejected_offers_count) || 0;
  return {
    message: rejected > 0 ? `Sprzęt zarezerwowany pomyślnie. Odrzucono ${rejected} pozostałych ofert.` : 'Sprzęt został zarezerwowany pomyślnie',
    confirmation,
    eventId: String(offer.event_id),
    offer: await offerDetail(ctx, offerId),
  };
}
