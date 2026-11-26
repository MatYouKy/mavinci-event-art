import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * Rental → „Wypożyczenia klientom” (`docs/rental.md`, migracje `20261130170000_client_rentals.sql` i `20261202090000_rental_catalog_window.sql`
 * — katalog magazynu i okno zajęcia sprzętu) — typy, etykiety i wywołania
 * funkcji bazy `rental_*`. Wspólne dla CRM, serwera (Mac: `/bridge/native/v1/rental`) i aplikacji na telefonie: bez importów
 * aplikacji, klient Supabase przekazywany z zewnątrz (sesja pracownika — dostęp sprzedaż / magazyn liczy baza).
 */

export type RentalStatus = 'draft' | 'reserved' | 'issued' | 'returned' | 'settled' | 'cancelled';
export type RentalHandover = 'pickup' | 'delivery';
export type RentalChargeKind = 'damage' | 'missing' | 'late' | 'cleaning' | 'other';
export type RentalTripKind = 'delivery' | 'collection';
export type RentalResolveAction = 'damaged_back' | 'damaged_service' | 'damaged_write_off' | 'missing_back' | 'missing_write_off';
export type RentalFileArea = 'sales' | 'warehouse';
export type RentalFileKind = 'scan' | 'photo' | 'document';

export const RENTAL_STATUS_LABELS: Record<RentalStatus, string> = {
  draft: 'Szkic',
  reserved: 'Zarezerwowane',
  issued: 'Wydane',
  returned: 'Zwrócone',
  settled: 'Rozliczone',
  cancelled: 'Anulowane',
};

export const RENTAL_HANDOVER_LABELS: Record<RentalHandover, string> = { pickup: 'Odbiór własny', delivery: 'Dostawa' };
export const RENTAL_TRIP_LABELS: Record<RentalTripKind, string> = { delivery: 'Dostawa do klienta', collection: 'Odbiór od klienta' };
export const RENTAL_CHARGE_LABELS: Record<RentalChargeKind, string> = {
  damage: 'Uszkodzenie',
  missing: 'Brak',
  late: 'Opóźniony zwrot',
  cleaning: 'Czyszczenie',
  other: 'Inne',
};
export const RENTAL_RESOLVE_LABELS: Record<RentalResolveAction, string> = {
  damaged_back: 'Sprawne — wraca na stan',
  damaged_service: 'Do serwisu',
  damaged_write_off: 'Spisz ze stanu',
  missing_back: 'Oddane później',
  missing_write_off: 'Spisz ze stanu',
};
/** Opis zdarzeń historii (`rental_log.action`). */
export const RENTAL_LOG_LABELS: Record<string, string> = {
  created: 'Utworzono wypożyczenie',
  updated: 'Zmieniono dane',
  items: 'Zmieniono pozycje',
  reserved: 'Zarezerwowano sprzęt',
  unreserved: 'Cofnięto rezerwację',
  cancelled: 'Anulowano',
  issued: 'Wydano sprzęt',
  returned: 'Przyjęto zwrot (całość)',
  returned_partly: 'Przyjęto zwrot częściowy',
  damaged_back: 'Uszkodzone — sprawne, wraca na stan',
  damaged_service: 'Uszkodzone — do serwisu',
  damaged_write_off: 'Uszkodzone — spisane ze stanu',
  missing_back: 'Brak — oddane później',
  missing_write_off: 'Brak — spisane ze stanu',
  charges: 'Zmieniono naliczenia',
  settled: 'Rozliczono',
  unsettled: 'Cofnięto rozliczenie',
  trips: 'Zmieniono dostawę / odbiór',
  warehouse_note: 'Zmieniono uwagi magazynu',
  invoice_linked: 'Dołączono fakturę',
  invoice_unlinked: 'Odłączono fakturę',
  file_added: 'Dodano plik',
  file_removed: 'Usunięto plik',
};

export type RentalAccess = {
  create: boolean;
  sales_view: boolean;
  sales_manage: boolean;
  sales_all: boolean;
  warehouse_view: boolean;
  warehouse_act: boolean;
  admin: boolean;
  own: boolean;
  employee_id: string | null;
};

export type RentalTotals = {
  lines_net: number;
  discount_amount: number;
  rental_net: number;
  charges_net: number;
  net: number;
  vat: number;
  gross: number;
  deposit: number;
  deposit_returned: number | null;
};

export type RentalListRow = {
  id: string;
  number: string;
  status: RentalStatus;
  title: string;
  client_name: string;
  starts_at: string;
  ends_at: string;
  handover: RentalHandover;
  seller_id: string | null;
  seller_name: string | null;
  items_count: number;
  quantity: number;
  out_qty: number;
  open_issues: number;
  overdue: boolean;
  sales: { totals: RentalTotals } | null;
};

export type RentalItem = {
  id: string;
  position: number;
  kind: 'equipment' | 'service';
  equipment_id: string | null;
  kit_id: string | null;
  kit_name: string | null;
  name: string;
  quantity: number;
  unit: string;
  note: string | null;
  thumbnail_url: string | null;
  storage_location: string | null;
  has_units: boolean;
  issued_qty: number;
  returned_ok_qty: number;
  returned_damaged_qty: number;
  returned_missing_qty: number;
  damaged_back_qty: number;
  damaged_out_qty: number;
  missing_back_qty: number;
  missing_out_qty: number;
  out_qty: number;
  open_damaged: number;
  open_missing: number;
  // Tylko sprzedaż:
  price_mode?: 'per_day' | 'flat';
  unit_price?: number;
  days?: number | null;
  discount_percent?: number;
  replacement_value?: number | null;
  line_net?: number;
};

export type RentalTrip = {
  id: string;
  kind: RentalTripKind;
  vehicle_id: string | null;
  vehicle_name: string | null;
  driver_id: string | null;
  driver_name: string | null;
  starts_at: string;
  ends_at: string;
  note: string | null;
};

export type RentalProtocolLine = {
  item_id: string;
  name: string;
  unit: string;
  qty: number;
  damaged: number;
  missing: number;
  note: string | null;
  photos: string[];
};

export type RentalProtocol = {
  id: string;
  kind: 'issue' | 'return';
  seq: number;
  number: string;
  person_name: string;
  note: string | null;
  created_at: string;
  created_by_name: string | null;
  lines: RentalProtocolLine[];
};

export type RentalFile = {
  id: string;
  protocol_id: string | null;
  area: RentalFileArea;
  kind: RentalFileKind;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by_name: string | null;
  created_at: string;
};

export type RentalLogEntry = {
  area: RentalFileArea;
  action: string;
  details: Record<string, any>;
  note: string | null;
  actor_name: string | null;
  created_at: string;
};

export type RentalCharge = {
  id?: string;
  item_id: string | null;
  kind: RentalChargeKind;
  description: string;
  amount: number;
  created_at?: string;
};

export type RentalInvoice = {
  invoice_id: string;
  kind: 'rental' | 'deposit' | 'charges';
  invoice_number: string;
  status: string;
  total_gross: number;
};

export type RentalSales = {
  discount_percent: number;
  vat_rate: number;
  deposit_amount: number;
  deposit_received_at: string | null;
  deposit_returned_amount: number | null;
  deposit_settled_at: string | null;
  sales_note: string | null;
  totals: RentalTotals;
  charges: RentalCharge[];
  invoices: RentalInvoice[];
};

export type RentalDetail = {
  id: string;
  number: string;
  status: RentalStatus;
  title: string;
  client_name: string;
  organization_id: string | null;
  contact_id: string | null;
  organization_name: string | null;
  contact_name: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  starts_at: string;
  ends_at: string;
  default_days: number;
  handover: RentalHandover;
  delivery_address: string | null;
  delivery_location_id: string | null;
  delivery_location_name: string | null;
  my_company_id: string | null;
  my_company_name: string | null;
  seller_id: string | null;
  seller_name: string | null;
  created_by: string | null;
  created_by_name: string | null;
  warehouse_note: string | null;
  cancel_reason: string | null;
  reserved_at: string | null;
  issued_at: string | null;
  returned_at: string | null;
  settled_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  overdue: boolean;
  access: RentalAccess;
  items: RentalItem[];
  trips: RentalTrip[];
  protocols: RentalProtocol[];
  files: RentalFile[];
  log: RentalLogEntry[];
  sales: RentalSales | null;
};

export type RentalConflict = {
  type: 'event' | 'rental';
  id: string;
  name: string;
  starts_at: string;
  ends_at: string | null;
  open_ended?: boolean;
  qty: number;
};

export type RentalAvailability = {
  equipment_id: string;
  name: string;
  required: number;
  stock: number;
  /** Rezerwacje eventów i innych wypożyczeń z okna (sumy — do opisu). */
  events: number;
  rentals: number;
  /** Najwięcej sztuk zajętych naraz w oknie (dostępne = stan − busy). */
  busy?: number;
  available: number;
  shortage: number;
  conflicts: RentalConflict[];
};

/** Katalog magazynu do wyboru pozycji (`rental_catalog`): okno zajęcia, kategorie, sprzęt i zestawy z wolnymi sztukami. */
export type RentalCatalogCategory = { id: string; name: string; parent_id: string | null; level: number | null; order_index: number | null };
export type RentalCatalogItem = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  category_id: string | null;
  thumbnail_url: string | null;
  /** Cena za dobę z katalogu — tylko sprzedaż. */
  price: number | null;
  /** Stan sprawny. */
  stock: number;
  /** Najwięcej sztuk zajętych naraz w oknie przez eventy i inne wypożyczenia. */
  busy: number;
  /** Wolne w oknie (bez pozycji tego wypożyczenia) — ile łącznie może mieć to wypożyczenie. */
  available: number;
};
export type RentalCatalogKitComponent = { equipment_id: string; quantity: number; name: string };
export type RentalCatalogKit = {
  id: string;
  name: string;
  category_id: string | null;
  thumbnail_url: string | null;
  /** Ile kompletów da się złożyć z wolnych składników. */
  available: number;
  components: RentalCatalogKitComponent[];
};
export type RentalCatalog = {
  /** Okno zajęcia magazynu: od wyjazdu sprzętu (wydanie / dostawa) do powrotu (zwrot / odbiór). */
  window: { starts_at: string; ends_at: string };
  categories: RentalCatalogCategory[];
  items: RentalCatalogItem[];
  kits: RentalCatalogKit[];
};
/** Pozycja formularza w liczeniu zapotrzebowania (ilość liczbowa; `settled` — sztuki, które już nie zajmują magazynu). */
export type RentalDemandLine = { kind: 'equipment' | 'service'; equipment_id?: string | null; kit_id?: string | null; quantity: number; settled?: number };

export type RentalVehicleConflict = { type: 'event' | 'rental'; id: string; name: string; starts_at: string; ends_at: string | null };

export type RentalUnit = { id: string; serial: string | null; status: string; location: string | null; condition_notes: string | null };

/** Dane nagłówka (`rental_save`) — przekazane klucze są zmieniane. */
export type RentalSaveData = Partial<{
  title: string;
  organization_id: string | null;
  contact_id: string | null;
  client_name: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  starts_at: string;
  ends_at: string;
  handover: RentalHandover;
  delivery_address: string | null;
  delivery_location_id: string | null;
  my_company_id: string | null;
  seller_id: string | null;
  discount_percent: number;
  vat_rate: number;
  deposit_amount: number;
  deposit_received_at: string | null;
  deposit_returned_amount: number | null;
  deposit_settled_at: string | null;
  sales_note: string | null;
  warehouse_note: string | null;
}>;

/** Pozycja do zapisu (`rental_set_items`): z `id` — zmiana, bez — nowa; zestaw: `kit_id` bez `equipment_id` (rozpisuje się). */
export type RentalItemInput = {
  id?: string;
  kind: 'equipment' | 'service';
  equipment_id?: string | null;
  kit_id?: string | null;
  name?: string;
  quantity: number;
  unit?: string;
  price_mode?: 'per_day' | 'flat';
  unit_price?: number | null;
  days?: number | null;
  discount_percent?: number;
  replacement_value?: number | null;
  note?: string | null;
};

export type RentalIssueLine = { item_id: string; qty: number; note?: string | null; photos?: string[] };
export type RentalReturnLine = { item_id: string; ok: number; damaged: number; missing: number; note?: string | null; photos?: string[] };
export type RentalTripInput = { kind: RentalTripKind; vehicle_id: string | null; driver_id: string | null; starts_at: string; ends_at: string; note?: string | null };
export type RentalListFilter = { status?: RentalStatus[]; q?: string; from?: string; to?: string; mine?: boolean };

export const RENTAL_BUCKET = 'rental-files';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRentalId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** Komunikat błędu z bazy (funkcje `rental_*` zwracają polskie komunikaty) albo ogólny. */
export function rentalErrorMessage(error: unknown, fallback = 'Nie udało się zapisać zmian. Spróbuj ponownie.') {
  const message = (error as { message?: string } | null)?.message || '';
  if (/rental_catalog/i.test(message) && /could not find the function|does not exist/i.test(message)) {
    return 'Katalog magazynu nie jest jeszcze włączony w bazie (migracja 20261202090000_rental_catalog_window.sql).';
  }
  if (/could not find the function public\.rental_|function public\.rental_\w+\(.*\) does not exist/i.test(message)) {
    return 'Moduł Rental nie jest jeszcze włączony w bazie (migracja 20261130170000_client_rentals.sql).';
  }
  if (!message || /fetch|network|timeout/i.test(message)) return fallback;
  return message.replace(/^[A-Z0-9]{5}:\s*/, '');
}

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>, fallback?: string): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(rentalErrorMessage(error, fallback));
  return data as T;
}

export const loadRentalAccess = (client: SupabaseClient, id: string | null = null) =>
  rpc<RentalAccess>(client, 'rental_access', { p_rental: id }, 'Nie udało się sprawdzić uprawnień.');

export async function listRentals(client: SupabaseClient, filter: RentalListFilter = {}) {
  return (await rpc<RentalListRow[] | null>(client, 'rental_list', { p_filter: filter }, 'Nie udało się pobrać wypożyczeń.')) || [];
}

export const getRental = (client: SupabaseClient, id: string) =>
  rpc<RentalDetail>(client, 'rental_get', { p_id: id }, 'Nie udało się pobrać wypożyczenia.');

export const saveRental = (client: SupabaseClient, id: string | null, data: RentalSaveData) =>
  rpc<string>(client, 'rental_save', { p_id: id, p_data: data });

export const setRentalItems = (client: SupabaseClient, id: string, items: RentalItemInput[]) =>
  rpc<RentalDetail>(client, 'rental_set_items', { p_id: id, p_items: items });

export async function rentalAvailability(client: SupabaseClient, id: string) {
  return (await rpc<RentalAvailability[] | null>(client, 'rental_availability', { p_id: id }, 'Nie udało się sprawdzić dostępności.')) || [];
}

export async function checkRentalAvailability(
  client: SupabaseClient, start: string, end: string, items: Array<{ equipment_id: string; quantity: number }>, exclude: string | null = null,
) {
  return (await rpc<RentalAvailability[] | null>(client, 'rental_check_availability',
    { p_start: start, p_end: end, p_items: items, p_exclude_rental: exclude }, 'Nie udało się sprawdzić dostępności.')) || [];
}

export const setRentalStatus = (client: SupabaseClient, id: string, status: RentalStatus, note: string | null = null) =>
  rpc<RentalStatus>(client, 'rental_set_status', { p_id: id, p_status: status, p_note: note });

export const setRentalTrips = (client: SupabaseClient, id: string, trips: RentalTripInput[]) =>
  rpc<RentalDetail>(client, 'rental_set_trips', { p_id: id, p_trips: trips });

export const setRentalCharges = (client: SupabaseClient, id: string, charges: RentalCharge[]) =>
  rpc<RentalDetail>(client, 'rental_set_charges', {
    p_id: id,
    p_charges: charges.map(({ item_id, kind, description, amount }) => ({ item_id, kind, description, amount })),
  });

export const linkRentalInvoice = (client: SupabaseClient, id: string, invoiceId: string, kind: RentalInvoice['kind'], link: boolean) =>
  rpc<RentalDetail>(client, 'rental_link_invoice', { p_id: id, p_invoice: invoiceId, p_kind: kind, p_link: link });

export const issueRental = (client: SupabaseClient, id: string, lines: RentalIssueLine[], person: string, note: string | null) =>
  rpc<string>(client, 'rental_issue', { p_id: id, p_lines: lines, p_person: person, p_note: note });

export const returnRental = (client: SupabaseClient, id: string, lines: RentalReturnLine[], person: string, note: string | null) =>
  rpc<string>(client, 'rental_return', { p_id: id, p_lines: lines, p_person: person, p_note: note });

export const resolveRentalItem = (
  client: SupabaseClient, itemId: string, action: RentalResolveAction, qty: number, unitIds: string[] | null, note: string | null,
) => rpc<RentalDetail>(client, 'rental_resolve', { p_item: itemId, p_action: action, p_qty: qty, p_unit_ids: unitIds, p_note: note });

export async function rentalItemUnits(client: SupabaseClient, itemId: string) {
  return (await rpc<RentalUnit[] | null>(client, 'rental_item_units', { p_item: itemId }, 'Nie udało się pobrać egzemplarzy.')) || [];
}

export const setRentalWarehouseNote = (client: SupabaseClient, id: string, note: string) =>
  rpc<null>(client, 'rental_set_warehouse_note', { p_id: id, p_note: note });

export async function rentalVehicleConflicts(client: SupabaseClient, vehicleId: string, start: string, end: string, exclude: string | null) {
  return (await rpc<RentalVehicleConflict[] | null>(client, 'rental_vehicle_conflicts',
    { p_vehicle: vehicleId, p_start: start, p_end: end, p_exclude_rental: exclude }, 'Nie udało się sprawdzić pojazdu.')) || [];
}

/** Katalog magazynu z wolnymi sztukami w terminie; z wypożyczeniem — w jego oknie (dostawa, odbiór), bez jego pozycji. */
export async function rentalCatalog(client: SupabaseClient, start: string, end: string, rentalId: string | null = null): Promise<RentalCatalog> {
  const data = await rpc<Partial<RentalCatalog> | null>(client, 'rental_catalog',
    { p_start: start, p_end: end, p_rental: rentalId }, 'Nie udało się pobrać katalogu magazynu.');
  return {
    window: data?.window || { starts_at: start, ends_at: end },
    categories: data?.categories || [],
    items: data?.items || [],
    kits: data?.kits || [],
  };
}

// ─── Katalog: kategorie, wyszukiwanie, wolne sztuki ──────────────────────────────────────────────────────────────────────

/** Ścieżka kategorii „Nadrzędna › Podrzędna” dla każdej kategorii katalogu. */
export function rentalCategoryPaths(categories: RentalCatalogCategory[]) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const paths = new Map<string, string>();
  const pathOf = (id: string, seen: Set<string>): string => {
    const cached = paths.get(id);
    if (cached) return cached;
    const category = byId.get(id);
    if (!category) return '';
    const parent = category.parent_id && !seen.has(category.parent_id) ? pathOf(category.parent_id, new Set([...seen, id])) : '';
    const path = parent ? `${parent} › ${category.name}` : category.name;
    paths.set(id, path);
    return path;
  };
  categories.forEach((category) => pathOf(category.id, new Set()));
  return paths;
}

/** Kategoria z wszystkimi podrzędnymi (filtr katalogu). */
export function rentalCategoryScope(categories: RentalCatalogCategory[], id: string) {
  const scope = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const category of categories) {
      if (category.parent_id && scope.has(category.parent_id) && !scope.has(category.id)) {
        scope.add(category.id);
        grew = true;
      }
    }
  }
  return scope;
}

/** Kategorie w kolejności drzewa (nadrzędna, potem jej podrzędne) z głębokością — lista wyboru filtra. */
export function rentalCategoryTree(categories: RentalCatalogCategory[]) {
  const children = new Map<string | null, RentalCatalogCategory[]>();
  const ids = new Set(categories.map((category) => category.id));
  for (const category of categories) {
    const parent = category.parent_id && ids.has(category.parent_id) ? category.parent_id : null;
    children.set(parent, [...(children.get(parent) || []), category]);
  }
  const order = (a: RentalCatalogCategory, b: RentalCatalogCategory) =>
    (a.order_index ?? 1e9) - (b.order_index ?? 1e9) || a.name.localeCompare(b.name, 'pl');
  const result: Array<{ category: RentalCatalogCategory; depth: number }> = [];
  const visit = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const category of [...(children.get(parent) || [])].sort(order)) {
      if (seen.has(category.id)) continue;
      result.push({ category, depth });
      visit(category.id, depth + 1, new Set([...seen, category.id]));
    }
  };
  visit(null, 0, new Set());
  return result;
}

const folded = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();

/** Czy pozycja katalogu pasuje do wyszukiwania (każde słowo w nazwie, marce, modelu albo kategorii; bez polskich znaków). */
export function rentalCatalogMatches(query: string, ...fields: Array<string | null | undefined>) {
  const words = folded(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = folded(fields.filter(Boolean).join(' '));
  return words.every((word) => haystack.includes(word));
}

/**
 * Sztuki sprzętu, które pozycje formularza zajmują w magazynie: sprzęt (bez tego, co już wróciło albo zeszło ze stanu)
 * i zestawy jeszcze nierozpisane na składniki (wg składu z katalogu). `skip` — pomija wskazaną pozycję.
 */
export function rentalLinesDemand<T extends RentalDemandLine>(lines: T[], kits: RentalCatalogKit[] = [], skip?: (line: T) => boolean) {
  const demand = new Map<string, number>();
  const add = (id: string, qty: number) => {
    if (qty > 0) demand.set(id, (demand.get(id) || 0) + qty);
  };
  const kitById = new Map(kits.map((kit) => [kit.id, kit]));
  for (const line of lines) {
    if (line.kind !== 'equipment' || skip?.(line)) continue;
    const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0));
    if (line.equipment_id) add(line.equipment_id, quantity - (line.settled || 0));
    else if (line.kit_id) for (const part of kitById.get(line.kit_id)?.components || []) add(part.equipment_id, part.quantity * quantity);
  }
  return demand;
}

/** Ile sztuk sprzętu można jeszcze dodać: wolne w oknie minus to, co już zajmują pozycje formularza (nie mniej niż 0). */
export const rentalCatalogFree = (item: Pick<RentalCatalogItem, 'id' | 'available'>, demand: Map<string, number>) =>
  Math.max(0, item.available - (demand.get(item.id) || 0));

/** Ile kompletów zestawu można jeszcze dodać przy obecnych pozycjach (składnik spoza katalogu — niedostępny). */
export function rentalKitFree(kit: RentalCatalogKit, items: Map<string, Pick<RentalCatalogItem, 'id' | 'available'>>, demand: Map<string, number>) {
  if (!kit.components.length) return 0;
  return Math.max(0, Math.min(...kit.components.map((part) => {
    const item = items.get(part.equipment_id);
    if (!item || part.quantity <= 0) return 0;
    return Math.floor(Math.max(0, item.available - (demand.get(part.equipment_id) || 0)) / part.quantity);
  })));
}

const randomId = () => {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
};

/** Bezpieczna nazwa pliku w ścieżce magazynu (bez znaków spoza ASCII). */
export function rentalSafeFileName(name: string) {
  const cleaned = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return (cleaned || 'plik').slice(-80);
}

/** Ścieżka nowego pliku: `<wypożyczenie>/<sales|warehouse>/<rodzaj>/<losowy>-<nazwa>`. */
export function rentalFilePath(rentalId: string, area: RentalFileArea, kind: RentalFileKind, name: string) {
  const folder = kind === 'scan' ? 'protocols' : kind === 'photo' ? 'photos' : 'documents';
  return `${rentalId}/${area}/${folder}/${randomId()}-${rentalSafeFileName(name)}`;
}

/** Plik do magazynu `rental-files` i wpis w wypożyczeniu; nieudany wpis usuwa przesłany plik. */
export async function uploadRentalFile(
  client: SupabaseClient,
  rentalId: string,
  file: { body: Blob | ArrayBuffer | Uint8Array; name: string; type: string; size: number },
  area: RentalFileArea,
  kind: RentalFileKind,
  protocolId: string | null = null,
) {
  if (file.size > 25 * 1024 * 1024) throw new Error(`Plik „${file.name}” jest większy niż 25 MB.`);
  const path = rentalFilePath(rentalId, area, kind, file.name);
  const { error } = await client.storage.from(RENTAL_BUCKET).upload(path, file.body, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (error) throw new Error(`Nie udało się przesłać pliku „${file.name}”.`);
  try {
    const id = await rpc<string>(client, 'rental_add_file', {
      p_id: rentalId, p_path: path, p_name: file.name, p_mime: file.type || null, p_size: file.size, p_kind: kind, p_protocol: protocolId,
    });
    return { id, path };
  } catch (failure) {
    await client.storage.from(RENTAL_BUCKET).remove([path]);
    throw failure;
  }
}

/** Zdjęcie do protokołu (przed zapisem protokołu) — ścieżka do `photos` linii. */
export async function uploadRentalPhoto(client: SupabaseClient, rentalId: string, file: { body: Blob | ArrayBuffer | Uint8Array; name: string; type: string; size: number }) {
  if (file.size > 25 * 1024 * 1024) throw new Error(`Zdjęcie „${file.name}” jest większe niż 25 MB.`);
  const path = rentalFilePath(rentalId, 'warehouse', 'photo', file.name);
  const { error } = await client.storage.from(RENTAL_BUCKET).upload(path, file.body, { contentType: file.type || 'image/jpeg', upsert: false });
  if (error) throw new Error(`Nie udało się przesłać zdjęcia „${file.name}”.`);
  return path;
}

export async function removeRentalFile(client: SupabaseClient, fileId: string) {
  const path = await rpc<string>(client, 'rental_remove_file', { p_file: fileId });
  if (path) await client.storage.from(RENTAL_BUCKET).remove([path]);
}

export async function rentalFileUrl(client: SupabaseClient, path: string, download?: string) {
  const { data, error } = await client.storage.from(RENTAL_BUCKET).createSignedUrl(path, 600, download ? { download } : undefined);
  if (error || !data?.signedUrl) throw new Error('Nie udało się otworzyć pliku.');
  return data.signedUrl;
}

// ─── Pomocnicze ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const WARSAW = 'Europe/Warsaw';

export const rentalDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('pl-PL', { timeZone: WARSAW, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

export const rentalDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString('pl-PL', { timeZone: WARSAW, day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

export const rentalPeriod = (start: string, end: string) => `${rentalDateTime(start)} – ${rentalDateTime(end)}`;

export const rentalMoney = (value: number | null | undefined) =>
  `${Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;

/** Liczba dób jak w bazie (`rental_default_days`): rozpoczęta doba liczy się w całości, najmniej 1. */
export function rentalDays(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 1;
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

/** Wartość netto pozycji jak w bazie: cena × ilość × doby (lub ryczałt) × (1 − rabat). */
export function rentalLineNet(item: Pick<RentalItemInput, 'quantity' | 'price_mode' | 'unit_price' | 'days' | 'discount_percent'>, defaultDays: number) {
  const days = item.price_mode === 'flat' ? 1 : Number(item.days || defaultDays);
  const value = Number(item.unit_price || 0) * Number(item.quantity || 0) * days * (1 - Number(item.discount_percent || 0) / 100);
  return Math.round(value * 100) / 100;
}

/** Ile sztuk pozycji jest jeszcze u klienta. */
export const rentalOutQty = (item: Pick<RentalItem, 'issued_qty' | 'returned_ok_qty' | 'returned_damaged_qty' | 'returned_missing_qty'>) =>
  item.issued_qty - item.returned_ok_qty - item.returned_damaged_qty - item.returned_missing_qty;

/** `<input type="datetime-local">` w czasie polskim ↔ ISO. */
export function rentalLocalInput(value: string | null | undefined) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WARSAW, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function rentalIsoFromLocal(local: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match.map(Number) as unknown as number[];
  // Przesunięcie strefy w tej chwili (CET / CEST) — dwa przybliżenia wystarczają poza godziną zmiany czasu.
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (at: number) => {
    const local2 = rentalLocalInput(new Date(at).toISOString());
    const [date, time] = local2.split('T');
    const [ly, lm, ld] = date.split('-').map(Number);
    const [lh, lmin] = time.split(':').map(Number);
    return Date.UTC(ly, lm - 1, ld, lh, lmin) - at;
  };
  let at = guess - offset(guess);
  at = guess - offset(at);
  return new Date(at).toISOString();
}
