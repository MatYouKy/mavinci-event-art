import 'server-only';
import type { NativeContext } from './auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { renderPrintJob } from '@/lib/print/pdfRenderer.server';
import { loadRentalProtocolPrint } from '@/lib/rental/rentalProtocolPrint.server';
import {
  checkRentalAvailability,
  getRental,
  isRentalId,
  issueRental,
  linkRentalInvoice,
  listRentals,
  loadRentalAccess,
  removeRentalFile,
  rentalFileUrl,
  rentalCatalog,
  rentalItemUnits,
  rentalVehicleConflicts,
  resolveRentalItem,
  returnRental,
  saveRental,
  setRentalCharges,
  setRentalItems,
  setRentalStatus,
  setRentalTrips,
  setRentalWarehouseNote,
  uploadRentalFile,
  uploadRentalPhoto,
  RENTAL_BUCKET,
  type RentalFileArea,
  type RentalFileKind,
  type RentalListFilter,
  type RentalResolveAction,
  type RentalStatus,
} from '@/lib/CRM/rental/rental';

/*
 * Rental → Wypożyczenia klientom na Macu i w telefonie (`/bridge/native/v1/rental`) — te same funkcje bazy co CRM (`src/lib/CRM/rental/rental.ts`,
 * `docs/rental.md`), tokenem pracownika: co widzi sprzedaż, a co magazyn, liczy baza (`rental_access`). Katalog magazynu z wolnymi
 * sztukami w terminie — `op=stock` (`rental_catalog`); `op=catalog` (wyszukiwanie po nazwie) zostaje dla starszych wersji aplikacji.
 * Słowniki do formularzy (klienci, pojazdy, kierowcy, firmy, faktury) — zapytania z RLS jak w przeglądarce.
 */

type Row = Record<string, any>;
const STATUSES: RentalStatus[] = ['draft', 'reserved', 'issued', 'returned', 'settled', 'cancelled'];
const ACTIONS: RentalResolveAction[] = ['damaged_back', 'damaged_service', 'damaged_write_off', 'missing_back', 'missing_write_off'];

export class RentalNativeError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const fail = (message: string, status = 400): never => {
  throw new RentalNativeError(message, status);
};
const id = (value: unknown, label = 'wypożyczenie') => (isRentalId(value) ? value : fail(`Nieprawidłowe ${label}.`));
const like = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * Znacznik czasu z adresu (`start`, `end`). Starsze wersje aplikacji na Maca wysyłały strefę `+00:00` bez zakodowania „+”,
 * a w adresie „+” oznacza spację („2026-11-30T09:00:00 00:00”) — przywracamy „+” przed strefą.
 */
const stampParam = (value: string | null) =>
  String(value || '').trim().replace(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?) (\d{2}(?::?\d{2})?)$/, '$1+$2');

export async function rentalGet(ctx: NativeContext, params: URLSearchParams) {
  const s = ctx.supabase;
  switch (params.get('op') || '') {
    case 'list': {
      const filter: RentalListFilter = {};
      const status = (params.get('status') || '').split(',').filter((value): value is RentalStatus => STATUSES.includes(value as RentalStatus));
      if (status.length) filter.status = status;
      if (params.get('mine') === '1') filter.mine = true;
      const [access, rentals] = await Promise.all([loadRentalAccess(s), listRentals(s, filter)]);
      return { access, rentals };
    }
    case 'access':
      return { access: await loadRentalAccess(s) };
    case 'detail':
      return { rental: await getRental(s, id(params.get('id'))) };
    case 'availability': {
      const items = JSON.parse(params.get('items') || '[]');
      if (!Array.isArray(items) || items.length > 500) fail('Nieprawidłowa lista pozycji.');
      return {
        availability: await checkRentalAvailability(s, stampParam(params.get('start')), stampParam(params.get('end')),
          items.filter((item: Row) => isRentalId(item?.equipment_id)).map((item: Row) => ({ equipment_id: item.equipment_id, quantity: Math.max(0, Math.floor(Number(item.quantity) || 0)) })),
          isRentalId(params.get('exclude')) ? params.get('exclude') : null),
      };
    }
    case 'stock':
      // Katalog magazynu z wolnymi sztukami w terminie (`rental_catalog`): z `id` — w oknie wypożyczenia, bez jego pozycji.
      return {
        catalog: await rentalCatalog(s, stampParam(params.get('start')), stampParam(params.get('end')),
          isRentalId(params.get('id')) ? params.get('id') : null),
      };
    case 'units':
      return { units: await rentalItemUnits(s, id(params.get('item'), 'pozycję')) };
    case 'conflicts':
      return {
        conflicts: await rentalVehicleConflicts(s, id(params.get('vehicle'), 'pojazd'), stampParam(params.get('start')), stampParam(params.get('end')),
          isRentalId(params.get('exclude')) ? params.get('exclude') : null),
      };
    case 'protocolPdf': {
      // PDF protokołu do podpisu dla telefonu (podgląd bez nagłówka autoryzacji): wydruk jak `/bridge/rental/[id]/protocols/[protocolId]`
      // (dostęp sprawdza odczyt protokołu tokenem pracownika), kopia w `rental-files` (`<wypożyczenie>/warehouse/prints/`) i adres na 10 minut.
      const rentalId = id(params.get('id'));
      const protocolId = id(params.get('protocol'), 'protokół');
      const print = await loadRentalProtocolPrint(s, rentalId, protocolId);
      const { pdf } = await renderPrintJob(print.job);
      const admin = createSupabaseAdminClient();
      const path = `${rentalId}/warehouse/prints/${protocolId}.pdf`;
      const saved = await admin.storage.from(RENTAL_BUCKET).upload(path, new Uint8Array(pdf), { contentType: 'application/pdf', upsert: true });
      if (saved.error) fail('Nie udało się przygotować PDF protokołu.', 500);
      const signed = await admin.storage.from(RENTAL_BUCKET).createSignedUrl(path, 600);
      if (signed.error || !signed.data?.signedUrl) fail('Nie udało się przygotować PDF protokołu.', 500);
      return { url: signed.data!.signedUrl, name: print.fileName };
    }
    case 'fileUrl': {
      const path = String(params.get('path') || '');
      if (!/^[0-9a-f-]{36}\/(sales|warehouse)\//i.test(path) || path.includes('..')) fail('Nieprawidłowy plik.');
      return { url: await rentalFileUrl(s, path) };
    }
    case 'clients': {
      const text = String(params.get('q') || '').trim().slice(0, 100);
      if (text.length < 2) return { clients: [] };
      const [organizations, contacts] = await Promise.all([
        s.from('organizations').select('id, name').ilike('name', like(text)).order('name').limit(8),
        s.from('contacts').select('id, full_name, first_name, last_name').ilike('full_name', like(text)).order('full_name').limit(8),
      ]);
      return {
        clients: [
          ...((organizations.data || []) as Row[]).map((row) => ({ kind: 'organization', id: String(row.id), name: String(row.name || '') })),
          ...((contacts.data || []) as Row[]).map((row) => ({ kind: 'contact', id: String(row.id), name: String(row.full_name || `${row.first_name || ''} ${row.last_name || ''}`).trim() })),
        ],
      };
    }
    case 'catalog': {
      const text = String(params.get('q') || '').trim().slice(0, 100);
      if (text.length < 2) return { items: [] };
      const [items, kits] = await Promise.all([
        s.from('equipment_items').select('id, name, brand, model, rental_price_per_day, warehouse_categories(name)')
          .ilike('name', like(text)).is('deleted_at', null).eq('is_active', true).order('name').limit(15),
        s.from('equipment_kits').select('id, name').ilike('name', like(text)).is('deleted_at', null).eq('is_active', true).order('name').limit(5),
      ]);
      return {
        items: [
          ...((items.data || []) as Row[]).map((row) => {
            const category = Array.isArray(row.warehouse_categories) ? row.warehouse_categories[0]?.name : row.warehouse_categories?.name;
            return {
              kind: 'equipment', id: String(row.id), name: String(row.name || ''),
              detail: [category, [row.brand, row.model].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
              price: row.rental_price_per_day == null ? null : Number(row.rental_price_per_day),
            };
          }),
          ...((kits.data || []) as Row[]).map((row) => ({ kind: 'kit', id: String(row.id), name: String(row.name || ''), detail: 'Zestaw — doda składniki', price: null })),
        ],
      };
    }
    case 'options': {
      const [companies, employees, vehicles] = await Promise.all([
        s.from('my_companies').select('id, name').order('name'),
        s.from('employees').select('id, name, surname').eq('is_active', true).order('name'),
        s.from('vehicles').select('id, name, registration_number, status').order('name'),
      ]);
      return {
        companies: ((companies.data || []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.name || '') })),
        employees: ((employees.data || []) as Row[]).map((row) => ({ id: String(row.id), name: `${row.name || ''} ${row.surname || ''}`.trim() })),
        vehicles: ((vehicles.data || []) as Row[]).filter((row) => !row.status || row.status === 'active')
          .map((row) => ({ id: String(row.id), name: [row.name, row.registration_number].filter(Boolean).join(' · ') })),
      };
    }
    case 'invoices': {
      const text = String(params.get('q') || '').trim().slice(0, 60);
      if (text.length < 2) return { invoices: [] };
      const { data } = await s.from('invoices').select('id, invoice_number, total_gross').ilike('invoice_number', like(text))
        .order('issue_date', { ascending: false }).limit(8);
      return { invoices: ((data || []) as Row[]).map((row) => ({ id: String(row.id), invoice_number: String(row.invoice_number || ''), total_gross: Number(row.total_gross || 0) })) };
    }
    default:
      return fail('Nieznana operacja.');
  }
}

export async function rentalPost(ctx: NativeContext, body: Row) {
  const s = ctx.supabase;
  const rental = () => id(body.id);
  switch (String(body.op || '')) {
    case 'save':
      return { id: await saveRental(s, body.id ? rental() : null, body.data && typeof body.data === 'object' ? body.data : {}) };
    case 'items':
      return { rental: await setRentalItems(s, rental(), Array.isArray(body.items) ? body.items : fail('Nieprawidłowa lista pozycji.')) };
    case 'status': {
      const status = String(body.status || '') as RentalStatus;
      if (!STATUSES.includes(status)) fail('Nieprawidłowy status.');
      await setRentalStatus(s, rental(), status, body.note ? String(body.note).slice(0, 1000) : null);
      return { rental: await getRental(s, rental()) };
    }
    case 'trips':
      return { rental: await setRentalTrips(s, rental(), Array.isArray(body.trips) ? body.trips : fail('Nieprawidłowa lista przejazdów.')) };
    case 'charges':
      return { rental: await setRentalCharges(s, rental(), Array.isArray(body.charges) ? body.charges : fail('Nieprawidłowa lista naliczeń.')) };
    case 'invoice':
      return { rental: await linkRentalInvoice(s, rental(), id(body.invoiceId, 'faktura'), ['rental', 'deposit', 'charges'].includes(body.kind) ? body.kind : 'rental', body.link !== false) };
    case 'issue': {
      const protocolId = await issueRental(s, rental(), Array.isArray(body.lines) ? body.lines : [], String(body.person || ''), body.note ? String(body.note) : null);
      return { protocolId, rental: await getRental(s, rental()) };
    }
    case 'return': {
      const protocolId = await returnRental(s, rental(), Array.isArray(body.lines) ? body.lines : [], String(body.person || ''), body.note ? String(body.note) : null);
      return { protocolId, rental: await getRental(s, rental()) };
    }
    case 'resolve': {
      const action = String(body.action || '') as RentalResolveAction;
      if (!ACTIONS.includes(action)) fail('Nieprawidłowa czynność.');
      const units = Array.isArray(body.units) ? body.units.filter(isRentalId) : null;
      return { rental: await resolveRentalItem(s, id(body.item, 'pozycję'), action, Math.floor(Number(body.qty) || 0), units?.length ? units : null, body.note ? String(body.note) : null) };
    }
    case 'warehouseNote':
      await setRentalWarehouseNote(s, rental(), String(body.note || '').slice(0, 4000));
      return { rental: await getRental(s, rental()) };
    case 'removeFile':
      await removeRentalFile(s, id(body.fileId, 'plik'));
      return { rental: await getRental(s, rental()) };
    default:
      return fail('Nieznana operacja.');
  }
}

/** Plik z Maca (multipart `file`): `kind=photo` — zdjęcie do protokołu (zwraca ścieżkę), inne — plik wypożyczenia. */
export async function rentalUpload(ctx: NativeContext, params: URLSearchParams, file: File) {
  const rentalId = id(params.get('id'));
  if (file.size > 25 * 1024 * 1024) fail(`Plik „${file.name}” jest większy niż 25 MB.`);
  const body = new Uint8Array(await file.arrayBuffer());
  const kind = (params.get('kind') || 'scan') as RentalFileKind;
  if (!['scan', 'photo', 'document'].includes(kind)) fail('Nieprawidłowy rodzaj pliku.');
  const entry = { body, name: file.name, type: file.type || 'application/octet-stream', size: file.size };
  if (kind === 'photo' && params.get('protocolPhoto') === '1') {
    return { path: await uploadRentalPhoto(ctx.supabase, rentalId, entry) };
  }
  const area = (params.get('area') === 'sales' ? 'sales' : 'warehouse') as RentalFileArea;
  const protocol = isRentalId(params.get('protocol')) ? params.get('protocol') : null;
  const saved = await uploadRentalFile(ctx.supabase, rentalId, entry, area, kind, protocol);
  return { ...saved, rental: await getRental(ctx.supabase, rentalId) };
}
