import 'server-only';
import type { NativeContext } from '@/lib/native/auth';
import { loadInvoiceFinanceAccess } from '@/lib/invoices/financeAccess';
import {
  ASSET_LIMITS, ASSET_OWNERSHIPS, isAssetOwnership,
  type AssetCompany, type AssetDocument, type AssetDocumentList, type AssetOwnership, type AssetRegisterRow, type EquipmentAcquisition,
  type EquipmentAssets,
} from './assetsShared';

/*
 * Własność sprzętu i dokument zakupu (`/bridge/native/v1/assets`; CRM i Mac: sprzęt → „Zakup”; Dysk → Finanse → Majątek).
 * Wszystko tokenem pracownika — RLS `equipment_acquisitions` (migracja 20261125170000): widzą osoby z dostępem do faktur firmy
 * (prywatne — „Finanse — podgląd” w dowolnej firmie), zmienia „Finanse — zarządzanie”. Dokument z tej samej firmy pilnuje baza.
 */

type Row = Record<string, any>;

export class AssetsError extends Error {
  constructor(message: string, public status = 400, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

function fail(message: string, status = 400, extra: Record<string, unknown> = {}): never {
  throw new AssetsError(message, status, extra);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const lower = (value: unknown) => String(value ?? '').toLowerCase();
const PENDING = 'Własność sprzętu będzie dostępna po wdrożeniu migracji bazy 20261125170000 (equipment_acquisitions).';
const missingTable = (error: any) => Boolean(error) && (error.code === '42P01' || error.code === 'PGRST205');
const ACQUISITION_COLUMNS = 'id,equipment_id,quantity,ownership,my_company_id,acquired_on,net_amount,gross_amount,currency,ksef_invoice_id,external_invoice_id,recurring_contract_id,document_note,notes,updated_at,created_at';
const CONTRACT_KINDS: Record<string, string> = {
  rent: 'Najem', lease: 'Leasing', subscription: 'Abonament', insurance: 'Raty ubezpieczenia', loan: 'Kredyt / pożyczka', other: 'Inna umowa',
};
const money = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function check(error: any, fallback: string) {
  if (!error) return;
  if (missingTable(error)) fail(PENDING, 503, { code: 'pending' });
  if (error.code === '42501') fail('Zmiany wprowadza osoba z poziomem „Finanse — zarządzanie” w tej firmie.', 403, { code: 'forbidden' });
  if (error.code === '22023' && text(error.message)) fail(text(error.message), 400);
  if (error.code === '23514') fail('Nieprawidłowe dane partii sprzętu — sprawdź ilość, własność, firmę i dokument.', 400);
  console.error('[native assets]', error.code, error.message);
  fail(fallback, 500);
}

const day = (value: unknown) => (/^\d{4}-\d{2}-\d{2}/.test(text(value)) ? text(value).slice(0, 10) : null);
const amount = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) && Math.abs(parsed) < 1e12 ? Math.round(parsed * 100) / 100 : null;
};
const amountLabel = (value: unknown, currency: unknown) => {
  const parsed = amount(value);
  if (parsed === null) return '';
  const code = text(currency).toUpperCase() || 'PLN';
  return `${money.format(parsed)} ${code === 'PLN' ? 'zł' : code}`;
};

/** Data `RRRR-MM-DD` z kalendarza albo `null`. */
function isoDay(value: unknown): string | null {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : null;
}

type Access = { companies: AssetCompany[]; canEditPrivate: boolean };

/** Firmy z dostępem do faktur (zakres „cała firma”); bez nich — brak dostępu do własności sprzętu. */
async function access(ctx: NativeContext): Promise<Access> {
  let finance: Awaited<ReturnType<typeof loadInvoiceFinanceAccess>>;
  try {
    finance = await loadInvoiceFinanceAccess(ctx.supabase);
  } catch (error) {
    console.error('[native assets] finance access', error instanceof Error ? error.message : error);
    fail('Nie udało się ustalić dostępu do finansów. Spróbuj ponownie za chwilę.', 503);
  }
  const ids = finance.scope === 'company' ? finance.invoiceViewCompanyIds.map(lower) : [];
  if (!ids.length) fail('Własność sprzętu i dokumenty zakupu widzą osoby z dostępem do finansów firmy.', 403, { code: 'forbidden' });
  const view = new Set(finance.financeViewCompanyIds.map(lower));
  const manage = new Set(finance.financeManageCompanyIds.map(lower));
  const { data, error } = await ctx.supabase.from('my_companies').select('id,name,legal_name').in('id', ids);
  if (error) {
    console.error('[native assets] companies', error.message);
    fail('Nie udało się pobrać firm.', 500);
  }
  const companies = ((data || []) as Row[]).map((row) => ({
    id: lower(row.id), name: text(row.name) || text(row.legal_name) || 'Firma', canEdit: view.has(lower(row.id)) && manage.has(lower(row.id)),
  })).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  return { companies, canEditPrivate: companies.some((company) => company.canEdit) };
}

/** Dokumenty partii: faktury z KSeF, dokumenty spoza KSeF i umowy stałe (umowy — od „Finanse — podgląd”, inaczej bez opisu). */
async function documentsFor(ctx: NativeContext, rows: Row[]): Promise<Map<string, AssetDocument>> {
  const ids = (key: string) => Array.from(new Set(rows.map((row) => row[key]).filter(Boolean).map(String)));
  const ksefIds = ids('ksef_invoice_id');
  const externalIds = ids('external_invoice_id');
  const contractIds = ids('recurring_contract_id');
  const [ksef, external, contracts] = await Promise.all([
    ksefIds.length ? ctx.supabase.from('ksef_invoices').select('id,invoice_number,seller_name,issue_date,gross_amount,currency').in('id', ksefIds) : null,
    externalIds.length ? ctx.supabase.from('external_invoices').select('id,invoice_number,label,seller_name,invoice_date,amount_gross,currency').in('id', externalIds) : null,
    contractIds.length ? ctx.supabase.from('finance_recurring_contracts').select('id,title,counterparty_name,kind,start_date,amount,currency').in('id', contractIds) : null,
  ]);
  const out = new Map<string, AssetDocument>();
  for (const row of (ksef?.data || []) as Row[]) out.set(`ksef:${lower(row.id)}`, ksefDocument(row));
  for (const row of (external?.data || []) as Row[]) out.set(`external:${lower(row.id)}`, externalDocument(row));
  for (const row of (contracts?.data || []) as Row[]) out.set(`contract:${lower(row.id)}`, contractDocument(row));
  return out;
}

function ksefDocument(row: Row): AssetDocument {
  return {
    type: 'ksef', id: lower(row.id), label: text(row.invoice_number) || 'Faktura z KSeF', counterparty: text(row.seller_name),
    detail: [text(row.seller_name), amountLabel(row.gross_amount, row.currency)].filter(Boolean).join(' · '),
    date: day(row.issue_date), amount: amount(row.gross_amount), currency: text(row.currency).toUpperCase() || 'PLN',
  };
}

function externalDocument(row: Row): AssetDocument {
  return {
    type: 'external', id: lower(row.id), label: text(row.invoice_number) || text(row.label) || 'Dokument spoza KSeF', counterparty: text(row.seller_name),
    detail: [text(row.seller_name), amountLabel(row.amount_gross, row.currency)].filter(Boolean).join(' · '),
    date: day(row.invoice_date), amount: amount(row.amount_gross), currency: text(row.currency).toUpperCase() || 'PLN',
  };
}

function contractDocument(row: Row): AssetDocument {
  return {
    type: 'contract', id: lower(row.id), label: text(row.title) || CONTRACT_KINDS[text(row.kind)] || 'Umowa', counterparty: text(row.counterparty_name),
    detail: [CONTRACT_KINDS[text(row.kind)] || '', text(row.counterparty_name), amountLabel(row.amount, row.currency)].filter(Boolean).join(' · '),
    date: day(row.start_date), amount: amount(row.amount), currency: text(row.currency).toUpperCase() || 'PLN',
  };
}

const documentKey = (row: Row) => (row.ksef_invoice_id ? `ksef:${lower(row.ksef_invoice_id)}`
  : row.external_invoice_id ? `external:${lower(row.external_invoice_id)}`
    : row.recurring_contract_id ? `contract:${lower(row.recurring_contract_id)}` : null);

/** Sztuki sprzętu w Magazynie: jednostki z numerami albo stan ilościowy. */
async function equipmentQuantity(ctx: NativeContext, equipmentId: string): Promise<number> {
  const [{ data: item, error }, { count }] = await Promise.all([
    ctx.supabase.from('equipment_items').select('id,cable_stock_quantity').eq('id', equipmentId).is('deleted_at', null).maybeSingle(),
    ctx.supabase.from('equipment_units').select('id', { count: 'exact', head: true }).eq('equipment_id', equipmentId),
  ]);
  if (error) check(error, 'Nie udało się pobrać sprzętu.');
  if (!item) fail('Nie znaleziono sprzętu.', 404);
  return (count || 0) > 0 ? count || 0 : Math.max(0, Number((item as Row).cable_stock_quantity) || 0);
}

/** Własność jednego sprzętu: partie, sztuki według własności, nieustalone i bez dokumentu. */
export async function equipmentAssets(ctx: NativeContext, equipmentValue: unknown): Promise<EquipmentAssets> {
  const equipmentId = lower(equipmentValue);
  if (!UUID.test(equipmentId)) fail('Nieprawidłowy sprzęt.');
  const scope = await access(ctx);
  const quantity = await equipmentQuantity(ctx, equipmentId);
  const { data, error } = await ctx.supabase.from('equipment_acquisitions').select(ACQUISITION_COLUMNS).eq('equipment_id', equipmentId)
    .order('acquired_on', { ascending: true, nullsFirst: false }).order('created_at');
  check(error, 'Nie udało się pobrać własności sprzętu.');
  const rows = (data || []) as Row[];
  const documents = await documentsFor(ctx, rows);
  const names = new Map(scope.companies.map((company) => [company.id, company]));
  const acquisitions: EquipmentAcquisition[] = rows.map((row) => {
    const companyId = row.my_company_id ? lower(row.my_company_id) : null;
    const key = documentKey(row);
    const document = key ? documents.get(key) || {
      type: key.split(':')[0] as AssetDocument['type'], id: key.split(':')[1], label: 'Dokument bez dostępu', counterparty: '',
      detail: 'Widoczny dla osób z „Finanse — podgląd”.', date: null, amount: null, currency: 'PLN',
    } : null;
    return {
      id: lower(row.id), quantity: Number(row.quantity) || 0, ownership: isAssetOwnership(row.ownership) ? row.ownership : 'asset',
      companyId, companyName: companyId ? names.get(companyId)?.name || 'Firma' : '', acquiredOn: day(row.acquired_on),
      netAmount: amount(row.net_amount), grossAmount: amount(row.gross_amount), currency: text(row.currency).toUpperCase() || 'PLN', document,
      documentNote: text(row.document_note), notes: text(row.notes), updatedAt: row.updated_at || row.created_at || null,
      canEdit: companyId ? names.get(companyId)?.canEdit === true : scope.canEditPrivate,
    };
  });
  const counts = Object.fromEntries(ASSET_OWNERSHIPS.map((entry) => [entry.key, 0])) as Record<AssetOwnership, number>;
  let undocumented = 0;
  for (const entry of acquisitions) {
    counts[entry.ownership] += entry.quantity;
    if (entry.ownership !== 'private' && !entry.document) undocumented += entry.quantity;
  }
  const assigned = acquisitions.reduce((sum, entry) => sum + entry.quantity, 0);
  return {
    equipmentId, quantity, acquisitions, counts, unassigned: Math.max(0, quantity - assigned), undocumented,
    companies: scope.companies, canEditPrivate: scope.canEditPrivate,
  };
}

/** Szukana fraza bez znaków składni filtrów PostgREST. */
const searchTerm = (value: unknown) => text(value).replace(/[^\p{L}\p{N}\s./-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

/**
 * Dokumenty zakupu firmy do wyboru: faktury kosztowe z KSeF i dokumenty spoza KSeF (najnowsze), a dla leasingu i najmu także
 * umowy stałe; `query` — numer, kontrahent albo tytuł.
 */
export async function assetDocuments(ctx: NativeContext, params: { company: unknown; query: unknown; contracts: boolean }): Promise<AssetDocumentList> {
  const companyId = lower(params.company);
  if (!UUID.test(companyId)) fail('Wybierz firmę.');
  const scope = await access(ctx);
  if (!scope.companies.some((company) => company.id === companyId)) fail('Nie masz dostępu do finansów tej firmy.', 403, { code: 'forbidden' });
  const term = searchTerm(params.query);
  const like = term ? `%${term}%` : null;
  const ksefQuery = ctx.supabase.from('ksef_invoices').select('id,invoice_number,seller_name,issue_date,gross_amount,currency')
    .eq('my_company_id', companyId).eq('invoice_type', 'received');
  const externalQuery = ctx.supabase.from('external_invoices').select('id,invoice_number,label,seller_name,invoice_date,amount_gross,currency')
    .eq('my_company_id', companyId);
  const contractQuery = ctx.supabase.from('finance_recurring_contracts').select('id,title,counterparty_name,kind,start_date,amount,currency')
    .eq('my_company_id', companyId);
  const [ksef, external, contracts] = await Promise.all([
    (like ? ksefQuery.or(`invoice_number.ilike.${like},seller_name.ilike.${like}`) : ksefQuery).order('issue_date', { ascending: false }).limit(25),
    (like ? externalQuery.or(`invoice_number.ilike.${like},seller_name.ilike.${like},label.ilike.${like}`) : externalQuery)
      .order('invoice_date', { ascending: false }).limit(25),
    params.contracts
      ? (like ? contractQuery.or(`title.ilike.${like},counterparty_name.ilike.${like}`) : contractQuery).order('start_date', { ascending: false }).limit(25)
      : null,
  ]);
  if (ksef.error) check(ksef.error, 'Nie udało się pobrać faktur z KSeF.');
  if (external.error) check(external.error, 'Nie udało się pobrać dokumentów spoza KSeF.');
  const documents = [
    ...((contracts?.data || []) as Row[]).map(contractDocument),
    ...((ksef.data || []) as Row[]).map(ksefDocument),
    ...((external.data || []) as Row[]).map(externalDocument),
  ];
  documents.sort((a, b) => (a.type === 'contract') !== (b.type === 'contract') ? (a.type === 'contract' ? -1 : 1) : (b.date || '').localeCompare(a.date || ''));
  return { documents: documents.slice(0, 50) };
}

/** Zapis partii (nowej albo zmienionej); wynik — aktualna własność sprzętu. */
export async function saveAcquisition(ctx: NativeContext, body: Row): Promise<EquipmentAssets> {
  const equipmentId = lower(body.equipmentId);
  if (!UUID.test(equipmentId)) fail('Nieprawidłowy sprzęt.');
  const id = body.id ? lower(body.id) : null;
  if (id && !UUID.test(id)) fail('Nieprawidłowa partia.');
  const quantity = Math.floor(Number(body.quantity));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > ASSET_LIMITS.quantity) fail(`Ilość musi być liczbą od 1 do ${ASSET_LIMITS.quantity}.`);
  if (!isAssetOwnership(body.ownership)) fail('Wybierz własność.');
  const ownership: AssetOwnership = body.ownership;
  const companyId = ownership === 'private' ? null : lower(body.companyId);
  if (companyId !== null && !UUID.test(companyId)) fail('Wybierz firmę, do której należy sprzęt.');
  const scope = await access(ctx);
  if (companyId && !scope.companies.some((company) => company.id === companyId && company.canEdit)) {
    fail('Partie tej firmy zmienia osoba z poziomem „Finanse — zarządzanie” w tej firmie.', 403, { code: 'forbidden' });
  }
  if (!companyId && !scope.canEditPrivate) fail('Sprzęt prywatny opisuje osoba z poziomem „Finanse — zarządzanie”.', 403, { code: 'forbidden' });
  const document = ownership === 'private' || !body.document || typeof body.document !== 'object' ? null : body.document as Row;
  const documentType = document ? text(document.type) : '';
  const documentId = document ? lower(document.id) : '';
  if (document && (!['ksef', 'external', 'contract'].includes(documentType) || !UUID.test(documentId))) fail('Nieprawidłowy dokument zakupu.');
  if (documentType === 'contract' && ownership !== 'leased') fail('Umowę stałą wskazuje się tylko dla leasingu i najmu.');
  const currency = text(body.currency).toUpperCase() || 'PLN';
  if (!/^[A-Z]{3}$/.test(currency)) fail('Waluta to trzyliterowy kod, np. PLN.');
  const values = {
    equipment_id: equipmentId, quantity, ownership, my_company_id: companyId, acquired_on: isoDay(body.acquiredOn),
    net_amount: amount(body.netAmount), gross_amount: amount(body.grossAmount), currency,
    ksef_invoice_id: documentType === 'ksef' ? documentId : null,
    external_invoice_id: documentType === 'external' ? documentId : null,
    recurring_contract_id: documentType === 'contract' ? documentId : null,
    document_note: text(body.documentNote).slice(0, ASSET_LIMITS.documentNote),
    notes: text(body.notes).slice(0, ASSET_LIMITS.notes),
  };
  if (id) {
    const { data, error } = await ctx.supabase.from('equipment_acquisitions').update(values).eq('id', id).select('id');
    check(error, 'Nie udało się zapisać partii sprzętu.');
    if (!data?.length) fail('Nie znaleziono partii albo nie możesz jej zmienić.', 404);
  } else {
    const { error } = await ctx.supabase.from('equipment_acquisitions').insert(values);
    check(error, 'Nie udało się dodać partii sprzętu.');
  }
  return equipmentAssets(ctx, equipmentId);
}

/** Usunięcie partii; wynik — aktualna własność sprzętu. */
export async function deleteAcquisition(ctx: NativeContext, body: Row): Promise<EquipmentAssets> {
  const id = lower(body.id);
  if (!UUID.test(id)) fail('Nieprawidłowa partia.');
  const { data, error } = await ctx.supabase.from('equipment_acquisitions').select('id,equipment_id').eq('id', id).maybeSingle();
  check(error, 'Nie udało się pobrać partii sprzętu.');
  if (!data) fail('Nie znaleziono partii.', 404);
  const { data: removed, error: deleteError } = await ctx.supabase.from('equipment_acquisitions').delete().eq('id', id).select('id');
  check(deleteError, 'Nie udało się usunąć partii sprzętu.');
  if (!removed?.length) fail('Partię usuwa osoba z poziomem „Finanse — zarządzanie” w tej firmie.', 403, { code: 'forbidden' });
  return equipmentAssets(ctx, (data as Row).equipment_id);
}

/**
 * Rejestr majątku firm (Dysk → Finanse → firma → Majątek): partie firm z nazwą sprzętu i dokumentem. Przed migracją
 * 20261125170000 — pusto (reszta Dysku działa).
 */
export async function assetRegisterRows(ctx: NativeContext, companyIds: string[]): Promise<AssetRegisterRow[]> {
  if (!companyIds.length) return [];
  const rows: Row[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await ctx.supabase.from('equipment_acquisitions').select(ACQUISITION_COLUMNS).in('my_company_id', companyIds)
      .order('id').range(from, from + 999);
    if (missingTable(error)) return [];
    if (error) check(error, 'Nie udało się pobrać rejestru majątku.');
    rows.push(...((data || []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  if (!rows.length) return [];
  const equipmentIds = Array.from(new Set(rows.map((row) => String(row.equipment_id))));
  const equipment = new Map<string, Row>();
  for (let i = 0; i < equipmentIds.length; i += 150) {
    const { data, error } = await ctx.supabase.from('equipment_items').select('id,name,brand,model').in('id', equipmentIds.slice(i, i + 150));
    if (error) check(error, 'Nie udało się pobrać sprzętu.');
    for (const item of (data || []) as Row[]) equipment.set(lower(item.id), item);
  }
  const documents = await documentsFor(ctx, rows);
  return rows.map((row) => {
    const item = equipment.get(lower(row.equipment_id));
    const key = documentKey(row);
    const document = key ? documents.get(key) : undefined;
    return {
      id: lower(row.id), companyId: lower(row.my_company_id), equipmentId: lower(row.equipment_id), equipment: text(item?.name) || 'Sprzęt',
      brand: text(item?.brand), model: text(item?.model), quantity: Number(row.quantity) || 0,
      ownership: isAssetOwnership(row.ownership) ? row.ownership : 'asset', acquiredOn: day(row.acquired_on), netAmount: amount(row.net_amount),
      grossAmount: amount(row.gross_amount), currency: text(row.currency).toUpperCase() || 'PLN',
      document: document ? document.label : key ? 'dokument bez dostępu' : '', counterparty: document?.counterparty || '',
      documentDate: document?.date || null, documentNote: text(row.document_note), notes: text(row.notes), updatedAt: row.updated_at || row.created_at || null,
    };
  }).sort((a, b) => a.equipment.localeCompare(b.equipment, 'pl') || (a.acquiredOn || '').localeCompare(b.acquiredOn || ''));
}

