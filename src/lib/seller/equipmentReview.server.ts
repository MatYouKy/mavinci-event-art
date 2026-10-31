import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SellerArrangements } from './arrangements';
import type { SellerEquipmentReview } from './equipmentReview';
import { buildSellerEventSchedule, hasLegacySellerEventRange, nextSellerDay, sellerEventDaysFrom, validSellerDay } from './eventSchedule';
import { sellerReviewDate } from './review';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const positive = (value: unknown) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 10000000) throw new Error('Nieprawidłowa ilość sprzętu. Sprawdź konfigurację produktu.');
  return number;
};
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function localLabel(timestamp: number) {
  const parts = formatter.formatToParts(new Date(timestamp));
  const part = (key: string) => parts.find(p => p.type === key)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
// Enumerate Warsaw's possible offsets and round-trip them. In an autumn clock
// change, reserve the wider interval; never guess a nonexistent spring hour.
function warsawTime(value: string, end: boolean) {
  const local = value.slice(0, 16);
  if (!validSellerDay(local.slice(0, 10)) || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(local)) throw new Error('Uzupełnij poprawny termin i godziny wydarzenia.');
  const naive = Date.parse(local + ':00Z');
  const candidates = [60, 120].map(offset => naive - offset * 60000).filter(time => localLabel(time) === local);
  if (!candidates.length) throw new Error('Godzina wypada w przerwie związanej ze zmianą czasu. Popraw termin przed analizą sprzętu.');
  return end ? Math.max(...candidates) : Math.min(...candidates);
}
function periodFor(arrangements: SellerArrangements) {
  const check = sellerReviewDate(arrangements);
  if (check.date_error) throw new Error(check.date_error);
  const values = arrangements.values;
  const legacy = hasLegacySellerEventRange(values);
  let start: string, end: string, wholeDays = false;
  if (legacy) {
    if (!values.starts_at || !values.ends_at) throw new Error('Uzupełnij początek i koniec wydarzenia przed analizą.');
    start = values.starts_at; end = values.ends_at;
  } else {
    const schedule = buildSellerEventSchedule(sellerEventDaysFrom(values, String(arrangements.offer.event_date).slice(0, 10)));
    if (schedule.error || !schedule.days.length) throw new Error(schedule.error || 'Uzupełnij termin wydarzenia.');
    const first = schedule.days[0], last = schedule.days[schedule.days.length - 1];
    wholeDays = schedule.days.some(day => !day.start_time || !day.end_time);
    start = first.date + 'T' + (first.start_time || '00:00');
    end = (!last.end_time || last.end_time < last.start_time ? nextSellerDay(last.date) : last.date) + 'T' + (last.end_time || '00:00');
  }
  let from = warsawTime(start, false), to = warsawTime(end, true);
  if (to <= from) throw new Error('Koniec wydarzenia musi być później niż początek.');
  const includesPreparation = Boolean(values.setup_at || values.teardown_at);
  if (values.setup_at) from = Math.min(from, warsawTime(values.setup_at, false));
  if (values.teardown_at) to = Math.max(to, warsawTime(values.teardown_at, true));
  return { from, to, wholeDays, includesPreparation };
}

// Never interpret a truncated response or a failed read as zero reservations.
async function allRows(query: (from: number, to: number) => PromiseLike<any>) {
  const rows: any[] = [];
  for (let from = 0; from < 20000; from += 500) {
    const result = await query(from, from + 499);
    if (result.error) throw new Error('Nie udało się odczytać pełnych danych magazynu. Ponów analizę; nie potwierdzono dostępności.');
    if (!Array.isArray(result.data)) throw new Error('Nie otrzymano pełnego wyniku analizy magazynu.');
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
  }
  throw new Error('Zakres analizy jest zbyt duży. Wymagane jest sprawdzenie danych magazynu przez administratora.');
}
type LineResource = { equipment_item_id: string | null; equipment_kit_id: string | null; quantity: number; is_optional: boolean };
type Demand = { id: string; quantity: number; sources: Set<string>; references: number };
const numberOrZero = (value: unknown) => {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error('Nieprawidłowy stan magazynowy. Popraw ewidencję sprzętu.');
  return number;
};

/** Read only. The caller must first authorize CRM management of this exact offer.
 * Resolve the same saved product/variant/package/stage scope used by reservations.
 * Stock and event reservations are read globally, but only aggregate counts for
 * required models are returned — no other clients, events or private notes. */
export async function checkSellerEquipment(admin: SupabaseClient, offerId: string, arrangements: SellerArrangements, contextKey: string): Promise<SellerEquipmentReview> {
  const window = periodFor(arrangements);
  const loaded = await admin.from('offers').select('event_id,package_mode,accepted_package_id,offer_items(id,name,product_id,product_variant_id,quantity,pricing_configuration)')
    .eq('id', offerId).eq('sales_channel', 'seller_portal').single();
  if (loaded.error || !loaded.data) throw new Error('Nie udało się odczytać pozycji oferty do analizy sprzętu.');
  const offer = loaded.data;
  // Do not guess between alternative commercial packages.
  if (offer.package_mode) throw new Error('Oferta zawiera alternatywne pakiety. Ustal wybrany zakres przed analizą sprzętu.');
  const lines = [...(offer.offer_items || [])].sort((a, b) => a.id.localeCompare(b.id));
  if (!lines.length || lines.length > 100) throw new Error('Oferta musi zawierać od 1 do 100 pozycji do analizy sprzętu.');
  const issues: SellerEquipmentReview['issues'] = [];
  const sourceRows: { line: typeof lines[number]; resources: LineResource[] }[] = [];
  for (let index = 0; index < lines.length; index += 4) {
    const batch = await Promise.all(lines.slice(index, index + 4).map(async line => {
      positive(line.quantity);
      const result = await admin.rpc('resolve_offer_line_equipment', {
        p_product_id: line.product_id, p_variant_id: line.product_variant_id, p_configuration: line.pricing_configuration,
      });
      if (result.error || !Array.isArray(result.data) || result.data.length >= 1000) throw new Error(`Nie można ustalić sprzętu: „${line.name}”. Sprawdź powiązania i zapisaną konfigurację produktu; analiza nie jest kompletna.`);
      return { line, resources: (result.data as LineResource[]).filter(resource => !resource.is_optional) };
    }));
    sourceRows.push(...batch);
  }
  const selection = await admin.rpc('get_offer_selected_equipment', { p_offer_id: offerId, p_package_id: null });
  if (selection.error || !Array.isArray(selection.data) || selection.data.length >= 1000) throw new Error('Nie można odczytać zapotrzebowania wraz z zamiennikami. Odśwież konfigurację sprzętu.');
  const selected = selection.data as { item_type: string; item_id: string; qty: number }[];
  const kitIds = [...new Set([
    ...selected.filter(row => row.item_type === 'kit').map(row => row.item_id),
    ...sourceRows.flatMap(row => row.resources.map(resource => resource.equipment_kit_id).filter(Boolean)),
  ])].sort() as string[];
  if (kitIds.some(id => !uuid(id)) || kitIds.length > 200) throw new Error('Nieprawidłowy lub zbyt rozbudowany zestaw sprzętu.');
  const components = kitIds.length ? await allRows((from, to) => admin.from('equipment_kit_items').select('id,kit_id,equipment_id,cable_id,quantity').in('kit_id', kitIds).order('id').range(from, to)) : [];
  const demand = new Map<string, Demand>();
  const add = (id: string, quantity: number, source?: string) => {
    if (!uuid(id)) throw new Error('Nieprawidłowe powiązanie sprzętu z magazynem.');
    const row = demand.get(id) || { id, quantity: 0, sources: new Set<string>(), references: 0 };
    if (source) { row.sources.add(source); row.references += 1; } else row.quantity += positive(quantity);
    demand.set(id, row);
  };
  const expand = (type: string, id: string, quantity: number, consume: (id: string, quantity: number) => void) => {
    if (type === 'item') consume(id, quantity);
    else if (type === 'kit') {
      for (const component of components.filter(row => row.kit_id === id && row.equipment_id)) consume(component.equipment_id, quantity * positive(component.quantity));
    } else throw new Error('Nieobsługiwany rodzaj zasobu w rezerwacji.');
  };
  for (const row of selected) expand(row.item_type, row.item_id, positive(row.qty), (id, qty) => add(id, qty));
  for (const { line, resources } of sourceRows) {
    if (!Number.isInteger(Number(line.quantity)) && resources.length) issues.push({ product_id: line.product_id, name: line.name, message: 'Ułamkowa ilość produktu wymaga potwierdzenia przelicznika sztuk sprzętu.' });
    const configuration = line.pricing_configuration;
    const profile = configuration?.modular?.profile;
    const selectedPackage = configuration?.product_package?.options?.find((option: any) => option.id === configuration.product_package.selected_id);
    const explicitlyEmpty = selectedPackage && Array.isArray(selectedPackage.resources?.equipment) && selectedPackage.resources.equipment.length === 0;
    if (!resources.length && !explicitlyEmpty) issues.push({ product_id: line.product_id, name: line.name, message: 'Brak przypisanego sprzętu. Potwierdź, czy to usługa bez sprzętu, czy brak w katalogu.' });
    if (profile && profile !== 'warehouse_stage') issues.push({ product_id: line.product_id, name: line.name, message: 'Ta konfiguracja opisuje zakres handlowy; dobór konkretnych zasobów magazynowych wymaga potwierdzenia technicznego.' });
    if (configuration?.addons?.some((addon: any) => !addon.staff_role && (addon.kind === 'optional' ? addon.enabled : Number(addon.quantity) > (addon.kind === 'over_limit' ? Number(addon.included_quantity || 0) : 0)))) issues.push({ product_id: line.product_id, name: line.name, message: 'Dodatki nie mają osobnych powiązań sprzętowych. Potwierdź, że wyposażenie produktu pokrywa cały zakres.' });
    for (const resource of resources) {
      if (Boolean(resource.equipment_item_id) === Boolean(resource.equipment_kit_id)) throw new Error('Nieprawidłowe powiązanie zasobów produktu.');
      expand(resource.equipment_item_id ? 'item' : 'kit', (resource.equipment_item_id || resource.equipment_kit_id)!, positive(line.quantity) * positive(resource.quantity), (id, qty) => add(id, qty, line.name));
    }
  }
  for (const kitId of kitIds) {
    if (!components.some(row => row.kit_id === kitId && row.equipment_id)) issues.push({ product_id: null, name: 'Zestaw sprzętu', message: 'Zestaw nie ma składników sprzętowych w magazynie. Nie można potwierdzić jego dostępności.' });
  }
  const needed = [...demand.values()].filter(row => row.quantity > 0).sort((a, b) => a.id.localeCompare(b.id));
  if (needed.length > 300) throw new Error('Oferta przekracza zakres 300 modeli sprzętu. Wymagane jest indywidualne sprawdzenie.');
  const ids = needed.map(row => row.id);
  const rows: SellerEquipmentReview['rows'] = [];
  if (ids.length) {
    const [inventory, units, relatedKits, events] = await Promise.all([
      allRows((from, to) => admin.from('equipment_items').select('id,name,total_quantity,deleted_at,is_active').in('id', ids).order('id').range(from, to)),
      allRows((from, to) => admin.from('equipment_units').select('id,equipment_id,status').in('equipment_id', ids).order('id').range(from, to)),
      allRows((from, to) => admin.from('equipment_kit_items').select('id,kit_id,equipment_id,quantity').in('equipment_id', ids).order('id').range(from, to)),
      allRows((from, to) => admin.from('events').select('id,event_date,event_end_date,planned_setup_at,planned_teardown_at,status')
        .or(`and(or(event_date.lt.${new Date(window.to).toISOString()},planned_setup_at.lt.${new Date(window.to).toISOString()}),or(event_end_date.gt.${new Date(window.from).toISOString()},and(event_end_date.is.null,event_date.gt.${new Date(window.from - 86400000).toISOString()}),planned_teardown_at.gt.${new Date(window.from).toISOString()}))`)
        .order('id').range(from, to)),
    ]);
    const eventWindows = new Map<string, { start: number; end: number }>();
    const invalidEventTimes = new Set<string>();
    for (const event of events) {
      // Existing reservations of this realization must not conflict with itself.
      if (event.id === offer.event_id || event.status === 'cancelled') continue;
      const start = Date.parse(event.event_date), end = event.event_end_date ? Date.parse(event.event_end_date) : start + 86400000;
      const setup = event.planned_setup_at ? Date.parse(event.planned_setup_at) : start;
      const teardown = event.planned_teardown_at ? Date.parse(event.planned_teardown_at) : end;
      if (![start, end, setup, teardown].every(Number.isFinite) || end <= start) {
        invalidEventTimes.add(event.id);
        eventWindows.set(event.id, { start: window.from, end: window.to });
        continue;
      }
      const from = Math.max(window.from, Math.min(start, setup)), to = Math.min(window.to, Math.max(end, teardown));
      if (from < to) eventWindows.set(event.id, { start: from, end: to });
    }
    const eventIds = [...eventWindows.keys()];
    const reservations: any[] = [];
    for (let index = 0; index < eventIds.length; index += 100) {
      const batch = await allRows((from, to) => admin.from('event_equipment').select('id,event_id,equipment_id,kit_id,quantity,status,reservation_status')
        .in('event_id', eventIds.slice(index, index + 100)).order('id').range(from, to));
      reservations.push(...batch);
      if (reservations.length > 20000) throw new Error('Zbyt wiele rezerwacji w podanym terminie. Analiza nie jest kompletna.');
    }
    const changes = new Map<string, Map<number, number>>();
    const reserve = (id: string, quantity: number, start: number, end: number) => {
      if (!ids.includes(id)) return;
      const points = changes.get(id) || new Map<number, number>();
      points.set(start, (points.get(start) || 0) + quantity);
      points.set(end, (points.get(end) || 0) - quantity);
      changes.set(id, points);
    };
    let invalidReservationTerm = false;
    const relatedKitIds = new Set(relatedKits.map(row => row.kit_id));
    for (const reservation of reservations) {
      if (!ids.includes(reservation.equipment_id) && !relatedKitIds.has(reservation.kit_id)) continue;
      if (['released', 'cancelled'].includes(reservation.status)) continue;
      const active = reservation.reservation_status
        ? ['reserved_pending', 'reserved_confirmed', 'in_use'].includes(reservation.reservation_status)
        : [null, 'reserved', 'in_use'].includes(reservation.status);
      if (!active) continue;
      const interval = eventWindows.get(reservation.event_id)!;
      if (invalidEventTimes.has(reservation.event_id)) invalidReservationTerm = true;
      const quantity = positive(reservation.quantity);
      if (reservation.equipment_id && reservation.kit_id) throw new Error('Rezerwacja wskazuje jednocześnie sprzęt i zestaw. Popraw duplikację w magazynie.');
      if (reservation.equipment_id) reserve(reservation.equipment_id, quantity, interval.start, interval.end);
      if (reservation.kit_id) for (const component of relatedKits.filter(row => row.kit_id === reservation.kit_id)) reserve(component.equipment_id, quantity * positive(component.quantity), interval.start, interval.end);
    }
    if (invalidReservationTerm) issues.push({ product_id: null, name: 'Termin istniejącej rezerwacji', message: 'Co najmniej jedna rezerwacja potrzebnego sprzętu ma niepoprawne godziny. Ostrożnie policzono ją na cały okres; popraw termin w magazynie.' });
    for (const demandRow of needed) {
      const item = inventory.find(row => row.id === demandRow.id);
      if (!item || item.deleted_at || item.is_active === false) issues.push({ product_id: null, name: item?.name || 'Sprzęt niedostępny w katalogu', message: 'Model jest nieaktywny lub został usunięty. Wymagany zamiennik.' });
      const modelUnits = units.filter(row => row.equipment_id === demandRow.id);
      const total = !item || item.deleted_at || item.is_active === false ? 0 : modelUnits.length
        ? modelUnits.filter(row => ['available', 'reserved', 'in_use'].includes(row.status)).length : numberOrZero(item.total_quantity);
      let reserved = 0, running = 0;
      for (const [, change] of [...(changes.get(demandRow.id) || new Map<number, number>())].sort(([a], [b]) => a - b)) {
        running += change; reserved = Math.max(reserved, running);
      }
      // A multi-day offer occupies equipment continuously. Disjoint bookings
      // do not add up as simultaneous demand; calculate the actual peak.
      const available = Math.max(0, total - reserved), required = Math.ceil(demandRow.quantity);
      rows.push({ id: demandRow.id, name: item?.name || 'Sprzęt niedostępny', required, total, reserved, available,
        shortage: Math.max(0, required - available), sources: [...demandRow.sources].sort(), repeated: demandRow.references > 1 });
    }
  }
  const status = rows.some(row => row.shortage > 0) ? 'conflict' : issues.length ? 'incomplete' : 'clear';
  const period = { start: localLabel(window.from), end: localLabel(window.to), whole_days: window.wholeDays, includes_preparation: window.includesPreparation };
  const key = createHash('sha256').update(JSON.stringify({ contextKey, period, rows, issues, status })).digest('hex');
  return { key, context_key: contextKey, checked_at: new Date().toISOString(), status, period, rows, issues };
}
