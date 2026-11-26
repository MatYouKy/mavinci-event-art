import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { can, type NativeContext } from '@/lib/native/auth';
import { materialAccess, materialCompanies } from '@/lib/materials/materials.server';
import { materialKind } from '@/lib/materials/materialsShared';
import { loadInvoiceFinanceAccess } from '@/lib/invoices/financeAccess';
import { externalDocumentKindLabel } from '@/lib/invoices/externalDocumentKinds';
import { assetRegisterRows } from '@/lib/assets/assets.server';
import type { AssetRegisterRow } from '@/lib/assets/assetsShared';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { latestDesktopRelease, signedDesktopLink } from '@/lib/native/desktopRelease';
import {
  DRIVE_CORPORATE_CATEGORIES, DRIVE_EMPLOYEE_GROUPS, DRIVE_FINANCE_AGREEMENTS, DRIVE_FINANCE_ASSETS, DRIVE_FINANCE_BOOKS, DRIVE_FINANCE_CLARIFY,
  DRIVE_FINANCE_CORPORATE, DRIVE_FINANCE_GROUPS, DRIVE_MONTHS, driveAssetsNodeId, driveClarifyNodeId, driveMonthCloseFileId,
  DRIVE_SCAN_LIMITS, DRIVE_SECTIONS, DRIVE_TITLE, DRIVE_UPLOAD_LIMITS, EMPLOYEE_DOCUMENT_LIMITS, EMPLOYEE_DOCUMENT_TYPES, driveAgreementsNodeId, driveCorporateCategory,
  driveCorporateNodeId, driveEmployeeDocumentsNode, driveFinanceNodeId, driveMonthName, driveName, driveUniqueNames, employeeDocumentType, parseDriveFileId,
  driveStorageUsage, parseDriveNode,
  type DriveBrandColor, type DriveBrandNode, type DriveCorporateCategory, type DriveDocumentSection, type DriveDownload, type DriveEmployeeGroup, type DriveFile,
  type DriveFileType, type DriveFinanceGroup, type DriveFolder, type DriveListing, type DriveNode, type DriveRoot, type DriveSection, type DriveSectionInfo,
  type DriveScanUpload, type DriveStorageUsage, type DriveSync, type DriveUpload, type DriveUploadResult,
} from './driveShared';

/*
 * Dysk — działy chmury poza Eventami i Materiałami (te mają własne API: `/bridge/native/v1/files`, `/bridge/native/v1/materials`):
 * Finanse (firma → Księgowość → rok → miesiąc → Sprzedaż, Koszty, Bank, Podatki i ZUS, XML z KSeF; Dokumenty spółki; Umowy
 * stałe; Majątek — patrz „MARK: Finanse”),
 * Oferty, Kalkulacje i Umowy (PDF-y wygenerowane w CRM, rok → miesiąc, tylko do odczytu), Magazyn (kategoria → sprzęt →
 * zdjęcia, pliki, instrukcja; dodawanie plików z prawem „Zarządzanie magazynem”), Pracownicy (pracownik → Zdjęcia, Dokumenty,
 * Umowy — jak zakładki profilu pracownika) i księga znaku marki (logotypy i fonty z Moich firm — w Materiałach w folderze
 * „Logotypy i księga znaku”). Wszystko tokenem pracownika: RLS jak w CRM decyduje, które oferty, kalkulacje, umowy, sprzęt,
 * dokumenty i umowy personelu widać. Treść plików nie przechodzi przez serwer — podpisane albo publiczne adresy magazynu;
 * wyjątek: PDF dokumentu umowy personelu powstaje raz na serwerze z treści zapisanej w CRM (kopia w `employee-documents/contracts/`).
 * Programy — instalator aplikacji Mavinci na Maca z katalogu wydań serwera (`yarn dmg`, zawsze najnowsza wersja; podpisany adres
 * trasy `/bridge/native/v1/desktop`), dla każdego pracownika.
 * Miejsce na Dysku (tylko administrator): pakiet i zajętość plików oraz bazy — `crm_storage_usage()` / `crm_set_storage_plan()`.
 */

type Row = Record<string, any>;
type Page = PromiseLike<{ data: any[] | null; error: any }>;

const PAGE = 1000;
const MAX_ROWS = 20_000;
const SIGNED_TTL = 3600;
const CHUNK = 150;

export class DriveError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(message: string, status = 400, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function fail(message: string, status = 400, extra: Record<string, unknown> = {}): never {
  throw new DriveError(message, status, extra);
}

function check(error: any, fallback: string) {
  if (!error) return;
  if (error.code === '42501') fail('Nie masz uprawnień do tej czynności.', 403);
  console.error('[native drive]', error.code, error.message);
  fail(fallback, 500);
}

async function fetchAll(build: (from: number, to: number) => Page, fallback: string) {
  const rows: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    check(error, fallback);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

// MARK: Działy i uprawnienia

const INQUIRY_SCOPES = [
  'inquiries_view', 'inquiries_manage', 'inquiries_view_pool', 'inquiries_view_own', 'inquiries_manage_own', 'inquiries_view_team',
  'inquiries_manage_team', 'inquiries_view_all', 'inquiries_manage_all',
];
const EVENT_SCOPES = ['events_view', 'events_view_planning', 'events_view_operational', 'events_manage', 'events_create', 'calendar_view'];

/** Kto widzi dział w Dysku (który plik — decyduje RLS jak w CRM). */
const SECTION_SCOPES: Record<DriveSection, string[]> = {
  // Finanse — według poziomu dostępu do finansów firm z bazy (`financeCompanies`), nie według uprawnień profilu.
  finance: [],
  events: EVENT_SCOPES,
  materials: ['materials_view', 'materials_manage'],
  offers: ['offers_view', 'offers_create', 'offers_manage', ...INQUIRY_SCOPES],
  calculations: [...EVENT_SCOPES, 'offers_view', 'offers_create', 'offers_manage', ...INQUIRY_SCOPES],
  contracts: ['contracts_view', 'contracts_manage', 'contracts_create'],
  warehouse: ['equipment_view', 'equipment_manage', 'equipment_create'],
  employees: ['employees_view', 'employees_manage', 'personnel_view', 'personnel_manage'],
  // Programy — każdy pracownik (instalator aplikacji Mavinci).
  programs: [],
};

const warehouseWriter = (ctx: NativeContext) =>
  ctx.employee.isAdmin || can(ctx.employee, 'equipment_manage') || ctx.employee.permissions.includes('equipment:manage');

/**
 * Galeria zdjęć sprzętu (bucket i tabela `equipment_images`) — polityki bazy wymagają w profilu prawa `equipment_manage` albo `admin`.
 * Kto ma dostęp do magazynu inną drogą (np. rola administratora), dodaje zdjęcie do plików sprzętu.
 */
const galleryWriter = (ctx: NativeContext) =>
  ctx.employee.id === ctx.employee.authUserId && (ctx.employee.permissions.includes('equipment_manage') || ctx.employee.permissions.includes('admin'));

/** Dokumenty wszystkich pracowników (profil → Dokumenty): administrator i „Pracownicy — zarządzanie”. */
const documentsManager = (ctx: NativeContext) => can(ctx.employee, 'employees_manage');
/** Dokumenty pracownika widzi i dodaje on sam, administrator i „Pracownicy — zarządzanie” (jak zakładka profilu i RLS). */
const canSeeDocuments = (ctx: NativeContext, employeeId: string) => documentsManager(ctx) || ctx.employee.id.toLowerCase() === employeeId.toLowerCase();
/**
 * Umowy i rozliczenia pracownika (profil → „Umowy i rozliczenia”): własne albo z prawem „Umowy personelu — podgląd /
 * zarządzanie”; zakres finansów „sprzedaż” — bez umów personelu (jak RLS `personnel_*`).
 */
const canSeeContracts = (ctx: NativeContext, employeeId: string) => ctx.employee.financeScope !== 'sales'
  && (ctx.employee.id.toLowerCase() === employeeId.toLowerCase() || can(ctx.employee, 'personnel_view') || can(ctx.employee, 'personnel_manage'));

/** Działy z dostępem pracownika; `finance` — czy ma Finanse (co najmniej jedna firma, `financeCompanies`). */
export function driveSections(ctx: NativeContext, finance = false): DriveSectionInfo[] {
  return DRIVE_SECTIONS.map((section) => ({
    ...section,
    available: section.key === 'finance' ? finance : section.key === 'programs'
      || ctx.employee.isAdmin || SECTION_SCOPES[section.key].some((scope) => can(ctx.employee, scope)),
    canUpload: section.key === 'warehouse' ? warehouseWriter(ctx) : section.key === 'employees' ? documentsManager(ctx) : false,
  }));
}

function requireSection(ctx: NativeContext, key: DriveSection) {
  const info = driveSections(ctx).find((section) => section.key === key);
  if (!info?.available) fail('Nie masz dostępu do tego działu Dysku.', 403, { code: 'forbidden' });
  return info;
}

export async function driveRoot(ctx: NativeContext): Promise<DriveRoot> {
  // Błąd odczytu dostępu do finansów nie zamyka Dysku — dział Finanse jest wtedy chwilowo niewidoczny.
  const finance = await financeCompanies(ctx).then((companies) => companies.length > 0, () => false);
  return { title: DRIVE_TITLE, sections: driveSections(ctx, finance), storage: ctx.employee.isAdmin };
}

const sectionFolder = (key: DriveSection): DriveFolder => ({
  id: key, parentId: null, name: DRIVE_SECTIONS.find((section) => section.key === key)?.label || key, kind: 'section', count: null,
});

// MARK: Daty (Europa/Warszawa)

const warsaw = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit' });
function yearMonth(value: unknown): { year: number; month: number } | null {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  const parts = warsaw.formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  return year && month ? { year, month } : null;
}

const monthId = (section: DriveDocumentSection, year: number, month: number) => `${section}:${year}-${String(month).padStart(2, '0')}`;

// MARK: Oferty, Kalkulacje, Umowy

type DocumentRow = {
  file: Omit<DriveFile, 'parentId'>;
  section: DriveDocumentSection;
  date: string;
  year: number;
  month: number;
  bucket: string;
  path: string;
};

const OFFER_STATUS: Record<string, string> = { draft: 'Szkic', sent: 'Wysłana', accepted: 'Zaakceptowana', rejected: 'Odrzucona' };
const CONTRACT_STATUS: Record<string, string> = {
  draft: 'Szkic', sent: 'Wysłana', signed: 'Podpisana', signed_by_client: 'Podpisana przez klienta', signed_returned: 'Podpisana i odesłana',
  cancelled: 'Anulowana',
};

/** Nazwy powiązanych rekordów (RLS — niewidoczne zostają bez nazwy). */
async function namesOf(ctx: NativeContext, table: string, columns: string, ids: unknown[], label: (row: Row) => string) {
  const unique = Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)));
  const names = new Map<string, string>();
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await ctx.supabase.from(table).select(columns).in('id', unique.slice(i, i + CHUNK));
    if (error) {
      console.error('[native drive] names', table, error.message);
      continue;
    }
    for (const row of (data || []) as unknown as Row[]) {
      const value = label(row);
      if (value) names.set(String(row.id), value);
    }
  }
  return names;
}

const contactName = (row: Row) => text(row.full_name) || [text(row.first_name), text(row.last_name)].filter(Boolean).join(' ') || text(row.company_name);
const pdfName = (base: string, fallback: string) => `${driveName(base, fallback).replace(/\.pdf$/i, '')}.pdf`;

function documentFile(row: Omit<DocumentRow, 'file'> & { id: string; name: string; updatedAt: string | null; version: string;
  record: DriveFile['record']; detail: string; type: 'offer' | 'calculation' | 'contract' }): DocumentRow {
  return {
    section: row.section, date: row.date, year: row.year, month: row.month, bucket: row.bucket, path: row.path,
    file: {
      id: `${row.type}:${row.id}`, name: row.name, type: row.type, mime: 'application/pdf', kind: 'pdf', size: null, updatedAt: row.updatedAt,
      version: row.version, thumbnailUrl: null, record: row.record, detail: row.detail,
    },
  };
}

async function offerRows(ctx: NativeContext): Promise<DocumentRow[]> {
  const rows = (await fetchAll((a, b) => ctx.supabase.from('offers')
    .select('id,offer_number,title,status,created_at,updated_at,generated_pdf_url,last_generated_at,organization_id,contact_id,portal_client_company,portal_client_name')
    .not('generated_pdf_url', 'is', null).order('created_at', { ascending: true }).order('id').range(a, b), 'Nie udało się pobrać ofert.'))
    .filter((row) => text(row.generated_pdf_url));
  const [organizations, contacts] = await Promise.all([
    namesOf(ctx, 'organizations', 'id,name,alias', rows.map((row) => row.organization_id), (row) => text(row.name) || text(row.alias)),
    namesOf(ctx, 'contacts', 'id,full_name,first_name,last_name,company_name', rows.map((row) => row.contact_id), contactName),
  ]);
  const out: DocumentRow[] = [];
  for (const row of rows) {
    const when = yearMonth(row.created_at);
    if (!when) continue;
    const client = organizations.get(row.organization_id) || contacts.get(row.contact_id) || text(row.portal_client_company) || text(row.portal_client_name);
    const title = text(row.title);
    const number = text(row.offer_number);
    const base = [number || 'Oferta', client, title && title !== client ? title : ''].filter(Boolean).join(' — ');
    out.push(documentFile({
      type: 'offer', section: 'offers', id: row.id, ...when, date: row.created_at, bucket: 'generated-offers', path: text(row.generated_pdf_url),
      name: pdfName(base, 'Oferta'), updatedAt: row.last_generated_at || row.updated_at || null,
      version: `${row.last_generated_at || row.updated_at || ''}|${text(row.generated_pdf_url)}`,
      record: { type: 'offer', id: row.id }, detail: [OFFER_STATUS[row.status] || '', client].filter(Boolean).join(' · '),
    }));
  }
  return out;
}

async function calculationRows(ctx: NativeContext): Promise<DocumentRow[]> {
  const rows = (await fetchAll((a, b) => ctx.supabase.from('event_calculations')
    .select('id,name,created_at,updated_at,generated_pdf_path,generated_pdf_at,event_id,inquiry_id,is_accepted')
    .not('generated_pdf_path', 'is', null).order('created_at', { ascending: true }).order('id').range(a, b), 'Nie udało się pobrać kalkulacji.'))
    .filter((row) => text(row.generated_pdf_path));
  const [events, inquiries] = await Promise.all([
    namesOf(ctx, 'events', 'id,name', rows.map((row) => row.event_id), (row) => text(row.name)),
    namesOf(ctx, 'tasks', 'id,title', rows.map((row) => row.inquiry_id), (row) => text(row.title)),
  ]);
  const out: DocumentRow[] = [];
  for (const row of rows) {
    const when = yearMonth(row.created_at);
    if (!when) continue;
    const name = text(row.name) || 'Kalkulacja';
    const context = events.get(row.event_id) || inquiries.get(row.inquiry_id) || '';
    const head = /^kalkulacja/i.test(name) ? name : `Kalkulacja — ${name}`;
    const base = context && !head.toLocaleLowerCase('pl-PL').includes(context.toLocaleLowerCase('pl-PL')) ? `${head} — ${context}` : head;
    out.push(documentFile({
      type: 'calculation', section: 'calculations', id: row.id, ...when, date: row.created_at, bucket: 'event-files', path: text(row.generated_pdf_path),
      name: pdfName(base, 'Kalkulacja'), updatedAt: row.generated_pdf_at || row.updated_at || null,
      version: `${row.generated_pdf_at || row.updated_at || ''}|${text(row.generated_pdf_path)}`,
      record: row.event_id ? { type: 'event', id: row.event_id } : row.inquiry_id ? { type: 'inquiry', id: row.inquiry_id } : null,
      detail: [row.is_accepted ? 'Zaakceptowana' : '', context].filter(Boolean).join(' · '),
    }));
  }
  return out;
}

async function contractRows(ctx: NativeContext): Promise<DocumentRow[]> {
  const rows = (await fetchAll((a, b) => ctx.supabase.from('contracts')
    .select('id,contract_number,title,status,created_at,updated_at,issued_at,generated_pdf_path,generated_pdf_at,event_id,client_id')
    .not('generated_pdf_path', 'is', null).order('created_at', { ascending: true }).order('id').range(a, b), 'Nie udało się pobrać umów.'))
    .filter((row) => text(row.generated_pdf_path));
  const [events, clients] = await Promise.all([
    namesOf(ctx, 'events', 'id,name', rows.map((row) => row.event_id), (row) => text(row.name)),
    namesOf(ctx, 'contacts', 'id,full_name,first_name,last_name,company_name', rows.map((row) => row.client_id), contactName),
  ]);
  const out: DocumentRow[] = [];
  for (const row of rows) {
    const date = row.issued_at || row.created_at;
    const when = yearMonth(date);
    if (!when) continue;
    const number = text(row.contract_number);
    const label = text(row.title) || events.get(row.event_id) || clients.get(row.client_id) || '';
    const base = [number ? `Umowa ${number}` : 'Umowa', label].filter(Boolean).join(' — ');
    out.push(documentFile({
      type: 'contract', section: 'contracts', id: row.id, ...when, date, bucket: 'event-files', path: text(row.generated_pdf_path),
      name: pdfName(base, 'Umowa'), updatedAt: row.generated_pdf_at || row.updated_at || null,
      version: `${row.generated_pdf_at || row.updated_at || ''}|${text(row.generated_pdf_path)}`,
      record: { type: 'contract', id: row.id },
      detail: [CONTRACT_STATUS[row.status] || '', clients.get(row.client_id) || ''].filter(Boolean).join(' · '),
    }));
  }
  return out;
}

const DOCUMENT_LOADERS: Record<DriveDocumentSection, (ctx: NativeContext) => Promise<DocumentRow[]>> = {
  offers: offerRows, calculations: calculationRows, contracts: contractRows,
};

/** Foldery lat i miesięcy oraz pliki z nazwami bez powtórzeń w miesiącu (kolejność nadawania „ (2)” — od najstarszego). */
function documentTree(section: DriveDocumentSection, rows: DocumentRow[]) {
  const years = new Map<number, number>();
  const months = new Map<string, { year: number; month: number; count: number }>();
  const byMonth = new Map<string, DocumentRow[]>();
  for (const row of rows) {
    years.set(row.year, (years.get(row.year) || 0) + 1);
    const key = monthId(section, row.year, row.month);
    const entry = months.get(key) || { year: row.year, month: row.month, count: 0 };
    entry.count += 1;
    months.set(key, entry);
    byMonth.set(key, [...(byMonth.get(key) || []), row]);
  }
  const folders: DriveFolder[] = [
    ...Array.from(years.entries()).map(([year, count]) => ({ id: `${section}:${year}`, parentId: section, name: String(year), kind: 'year' as const, count })),
    ...Array.from(months.entries()).map(([id, entry]) => ({
      id, parentId: `${section}:${entry.year}`, name: driveMonthName(entry.month), kind: 'month' as const, count: entry.count,
    })),
  ];
  const files: Array<DriveFile & { date: string }> = [];
  for (const [parentId, list] of byMonth) {
    const ordered = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.file.id.localeCompare(b.file.id));
    for (const row of driveUniqueNames(ordered.map((entry) => ({ ...entry.file, parentId, date: entry.date })))) files.push(row);
  }
  return { folders, files };
}

// MARK: Magazyn

type Category = { id: string; parentId: string | null; name: string; order: number };
type Equipment = { id: string; name: string; categoryId: string | null; updatedAt: string | null; manualUrl: string };

async function warehouseCatalog(ctx: NativeContext) {
  const [categoryRows, itemRows] = await Promise.all([
    fetchAll((a, b) => ctx.supabase.from('warehouse_categories').select('id,parent_id,name,order_index,is_active')
      .order('order_index').order('name').range(a, b), 'Nie udało się pobrać kategorii magazynu.'),
    fetchAll((a, b) => ctx.supabase.from('equipment_items').select('id,name,warehouse_category_id,updated_at,user_manual_url,is_active')
      .is('deleted_at', null).order('name').order('id').range(a, b), 'Nie udało się pobrać sprzętu.'),
  ]);
  const categories = new Map<string, Category>();
  for (const row of categoryRows) {
    if (row.is_active === false) continue;
    categories.set(String(row.id), { id: String(row.id), parentId: row.parent_id ? String(row.parent_id) : null, name: driveName(row.name, 'Kategoria'), order: Number(row.order_index) || 0 });
  }
  // Rodzic nieaktywny albo usunięty — kategoria na najwyższym poziomie.
  for (const category of categories.values()) if (category.parentId && !categories.has(category.parentId)) category.parentId = null;
  const items: Equipment[] = itemRows.filter((row) => row.is_active !== false).map((row) => ({
    id: String(row.id), name: driveName(row.name, 'Sprzęt'),
    categoryId: row.warehouse_category_id && categories.has(String(row.warehouse_category_id)) ? String(row.warehouse_category_id) : null,
    updatedAt: row.updated_at || null, manualUrl: /^https:\/\//i.test(text(row.user_manual_url)) ? text(row.user_manual_url) : '',
  }));
  // Liczba sprzętu w gałęzi — puste kategorie się nie pokazują.
  const counts = new Map<string, number>();
  for (const item of items) {
    for (let id = item.categoryId, guard = 0; id && guard < 20; id = categories.get(id)?.parentId || null, guard += 1) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return { categories, items, counts };
}

const categoryNode = (category: Category, count: number): DriveFolder => ({
  id: `warehouse:cat:${category.id}`, parentId: category.parentId ? `warehouse:cat:${category.parentId}` : 'warehouse', name: category.name,
  kind: 'category', count,
});
const equipmentNode = (item: Equipment): DriveFolder => ({
  id: `warehouse:item:${item.id}`, parentId: item.categoryId ? `warehouse:cat:${item.categoryId}` : 'warehouse:none', name: item.name,
  kind: 'equipment', count: null,
});
const NONE_NODE: DriveFolder = { id: 'warehouse:none', parentId: 'warehouse', name: 'Bez kategorii', kind: 'category', count: null };

const sortFolders = (list: DriveFolder[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'pl'));

function warehouseChildren(catalog: Awaited<ReturnType<typeof warehouseCatalog>>, parentId: string): DriveFolder[] {
  const { categories, items, counts } = catalog;
  const subcategories = Array.from(categories.values())
    .filter((category) => (category.parentId ? `warehouse:cat:${category.parentId}` : 'warehouse') === parentId && (counts.get(category.id) || 0) > 0)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pl'))
    .map((category) => categoryNode(category, counts.get(category.id) || 0));
  const equipment = sortFolders(items.filter((item) => equipmentNode(item).parentId === parentId).map(equipmentNode));
  const extra = parentId === 'warehouse' && items.some((item) => !item.categoryId)
    ? [{ ...NONE_NODE, count: items.filter((item) => !item.categoryId).length }] : [];
  return driveUniqueNames([...subcategories, ...extra, ...equipment]);
}

const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', heic: 'image/heic', avif: 'image/avif',
  pdf: 'application/pdf', xml: 'application/xml', csv: 'text/csv', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain',
};

/** Rozszerzenie z adresu albo ścieżki (bez zapytania), małymi literami. */
function urlExtension(value: string) {
  const path = value.split(/[?#]/)[0];
  const match = /\.([A-Za-z0-9]{2,5})$/.exec(path);
  return match ? match[1].toLowerCase() : '';
}

const withExtension = (name: string, ext: string) => (ext && !name.toLowerCase().endsWith(`.${ext}`) ? `${name}.${ext}` : name);

async function equipmentFiles(ctx: NativeContext, item: Equipment): Promise<DriveFile[]> {
  const [images, files] = await Promise.all([
    ctx.supabase.from('equipment_images').select('id,equipment_id,image_url,title,is_primary,sort_order,created_at,updated_at').eq('equipment_id', item.id)
      .order('sort_order').order('created_at'),
    ctx.supabase.from('equipment_files').select('id,equipment_id,file_name,file_path,file_url,file_size,mime_type,created_at,updated_at').eq('equipment_id', item.id)
      .order('created_at'),
  ]);
  check(images.error, 'Nie udało się pobrać zdjęć sprzętu.');
  check(files.error, 'Nie udało się pobrać plików sprzętu.');
  return equipmentFilesFrom(item, (images.data || []) as Row[], (files.data || []) as Row[]);
}

function warehousePath(catalog: Awaited<ReturnType<typeof warehouseCatalog>>, categoryId: string | null) {
  const chain: DriveFolder[] = [];
  for (let id = categoryId, guard = 0; id && guard < 20; id = catalog.categories.get(id)?.parentId || null, guard += 1) {
    const category = catalog.categories.get(id);
    if (category) chain.unshift(categoryNode(category, catalog.counts.get(category.id) || 0));
  }
  return chain;
}

// MARK: Księga znaku marki (Moje firmy)

function publicLogoUrl(ctx: NativeContext, value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  if (/^https:\/\//i.test(raw)) return raw;
  return ctx.supabase.storage.from('company-logos').getPublicUrl(raw.replace(/^\/+/, '')).data.publicUrl || '';
}

const BACKGROUNDS: Record<string, string> = { light: 'jasne tło', dark: 'ciemne tło', transparent: 'przezroczyste', white: 'białe tło', black: 'czarne tło' };
const FONT_ROLES: Record<string, string> = { heading: 'nagłówki', body: 'tekst', accent: 'akcent' };

async function brandListing(ctx: NativeContext, companyId: string): Promise<{ node: DriveFolder; files: DriveFile[]; colors: DriveBrandColor[] }> {
  const access = await materialAccess(ctx, companyId);
  if (!access.view) fail('Nie masz dostępu do Materiałów tej marki.', 403, { code: 'forbidden' });
  const s = ctx.supabase;
  const [company, logos, fonts, colors] = await Promise.all([
    s.from('my_companies').select('id,name,logo_url,updated_at').eq('id', companyId).maybeSingle(),
    s.from('company_brandbook_logos').select('id,label,url,variant,background,is_default,order_index,updated_at').eq('company_id', companyId).order('order_index'),
    s.from('company_brandbook_fonts').select('id,label,family,weight,role,file_url,storage_path,order_index,updated_at').eq('company_id', companyId).order('order_index'),
    s.from('company_brandbook_colors').select('label,hex,role,order_index').eq('company_id', companyId).order('order_index'),
  ]);
  check(company.error, 'Nie udało się pobrać marki.');
  if (!company.data) fail('Nie znaleziono marki.', 404);
  check(logos.error, 'Nie udało się pobrać logotypów.');
  check(fonts.error, 'Nie udało się pobrać fontów.');
  check(colors.error, 'Nie udało się pobrać kolorów.');
  const node: DriveFolder = { id: `brand:${companyId}`, parentId: null, name: 'Księga znaku', kind: 'brand', count: null };
  const record = { type: 'company' as const, id: companyId };
  const files: DriveFile[] = [];
  ((logos.data || []) as Row[]).forEach((row, index) => {
    const url = publicLogoUrl(ctx, row.url);
    if (!url) return;
    const ext = urlExtension(url) || 'png';
    const label = text(row.label) || text(row.variant) || `Logo ${index + 1}`;
    const background = BACKGROUNDS[text(row.background)] || text(row.background);
    files.push({
      id: `brand-logo:${row.id}`, parentId: node.id, name: withExtension(driveName(`Logo — ${label}${background ? ` (${background})` : ''}`, `Logo ${index + 1}`), ext),
      type: 'brand-logo', mime: EXTENSION_MIME[ext] || 'image/png', kind: 'image', size: null, updatedAt: row.updated_at || null,
      version: `${row.updated_at || ''}|${url}`, thumbnailUrl: url, record, detail: [row.is_default ? 'Logo domyślne' : 'Logo', background].filter(Boolean).join(' · '),
    });
  });
  if (!files.length) {
    const url = publicLogoUrl(ctx, (company.data as Row).logo_url);
    if (url) {
      const ext = urlExtension(url) || 'png';
      files.push({
        id: `company-logo:${companyId}`, parentId: node.id, name: withExtension('Logo', ext), type: 'company-logo', mime: EXTENSION_MIME[ext] || 'image/png',
        kind: 'image', size: null, updatedAt: (company.data as Row).updated_at || null, version: url, thumbnailUrl: url, record, detail: 'Logo firmy',
      });
    }
  }
  for (const row of (fonts.data || []) as Row[]) {
    const url = row.storage_path ? publicLogoUrl(ctx, row.storage_path) : /^https:\/\//i.test(text(row.file_url)) ? text(row.file_url) : '';
    if (!url) continue;
    const ext = urlExtension(url) || 'ttf';
    const role = FONT_ROLES[text(row.role)] || text(row.role);
    files.push({
      id: `brand-font:${row.id}`, parentId: node.id,
      name: withExtension(driveName([text(row.family) || text(row.label) || 'Font', text(row.weight)].filter(Boolean).join(' '), 'Font'), ext),
      type: 'brand-font', mime: EXTENSION_MIME[ext] || 'font/ttf', kind: 'font', size: null, updatedAt: row.updated_at || null,
      version: `${row.updated_at || ''}|${url}`, thumbnailUrl: null, record, detail: ['Font', role ? `rola: ${role}` : ''].filter(Boolean).join(' · '),
    });
  }
  const palette: DriveBrandColor[] = ((colors.data || []) as Row[])
    .map((row) => ({ label: text(row.label), hex: /^#[0-9a-f]{6}$/i.test(text(row.hex).slice(0, 7)) ? text(row.hex).slice(0, 7).toLowerCase() : '', role: text(row.role) }))
    .filter((row) => row.hex);
  return { node, files: driveUniqueNames(files), colors: palette };
}

// MARK: Pracownicy

type EmployeeEntry = { id: string; name: string; avatarUrl: string; backgroundUrl: string; updatedAt: string | null };

const EMPLOYEE_COLUMNS = 'id,name,surname,nickname,avatar_url,background_image_url,updated_at';
const DOCUMENT_COLUMNS = 'id,employee_id,name,document_type,description,storage_path,file_name,mime_type,size_bytes,expiry_date,created_at,updated_at';
const DOCUMENTS_BUCKET = 'employee-documents';
/** Tabela dokumentów pracowników powstaje w migracji 20261123100000 — do tego czasu Dokumenty są puste (reszta Dysku działa). */
const DOCUMENTS_PENDING = 'Dokumenty pracowników będą dostępne po wdrożeniu migracji bazy 20261123100000 (employee_documents).';
const documentsMissing = (error: any) => Boolean(error) && (error.code === '42P01' || error.code === 'PGRST205');

const CONTRACT_KINDS: Record<string, string> = {
  mandate: 'Umowa zlecenie', employment: 'Umowa o pracę', specific_work: 'Umowa o dzieło', oral: 'Umowa ustna — dżentelmeńska',
};
const PERSONNEL_STATUS: Record<string, string> = { draft: 'Szkic', active: 'Aktywna', completed: 'Zakończona', terminated: 'Rozwiązana' };

const httpsUrl = (value: unknown) => (/^https:\/\//i.test(text(value)) ? text(value) : '');
const warsawDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });
const plDate = (value: string) => value.slice(0, 10).split('-').reverse().join('.');

function employeeEntry(row: Row): EmployeeEntry {
  return {
    id: String(row.id).toLowerCase(),
    name: driveName([text(row.name), text(row.surname)].filter(Boolean).join(' ') || text(row.nickname), 'Pracownik'),
    avatarUrl: httpsUrl(row.avatar_url),
    backgroundUrl: httpsUrl(row.background_image_url),
    updatedAt: row.updated_at || null,
  };
}

/** Aktywni pracownicy (alfabetycznie, jak lista Pracownicy w CRM). */
async function employeeEntries(ctx: NativeContext): Promise<EmployeeEntry[]> {
  const rows = await fetchAll((a, b) => ctx.supabase.from('employees').select(EMPLOYEE_COLUMNS).eq('is_active', true).order('id').range(a, b),
    'Nie udało się pobrać pracowników.');
  return rows.map(employeeEntry).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

async function employeeById(ctx: NativeContext, employeeId: string): Promise<EmployeeEntry> {
  const { data, error } = await ctx.supabase.from('employees').select(EMPLOYEE_COLUMNS).eq('id', employeeId).eq('is_active', true).maybeSingle();
  check(error, 'Nie udało się pobrać pracownika.');
  if (!data) fail('Nie znaleziono pracownika.', 404);
  return employeeEntry(data as Row);
}

const employeeNode = (employee: EmployeeEntry): DriveFolder => ({
  id: `employees:${employee.id}`, parentId: 'employees', name: employee.name, kind: 'employee', count: null,
});
const groupNode = (employee: EmployeeEntry, group: DriveEmployeeGroup, count: number): DriveFolder => ({
  id: `employees:${employee.id}:${group}`, parentId: `employees:${employee.id}`, name: DRIVE_EMPLOYEE_GROUPS.find((entry) => entry.key === group)?.label || group,
  kind: 'group', count,
});

/** Zdjęcie profilowe i zdjęcie w tle (CRM: profil pracownika) — adresy publiczne. */
function employeePhotoFiles(employee: EmployeeEntry): DriveFile[] {
  const parentId = `employees:${employee.id}:photos`;
  const record = { type: 'employee' as const, id: employee.id };
  const photos = [
    { type: 'employee-avatar' as const, url: employee.avatarUrl, label: 'Zdjęcie profilowe' },
    { type: 'employee-background' as const, url: employee.backgroundUrl, label: 'Zdjęcie w tle' },
  ];
  return photos.filter((photo) => photo.url).map((photo) => {
    const ext = urlExtension(photo.url) || 'jpg';
    return {
      id: `${photo.type}:${employee.id}`, parentId, name: withExtension(photo.label, ext), type: photo.type, mime: EXTENSION_MIME[ext] || 'image/jpeg',
      kind: 'image', size: null, updatedAt: employee.updatedAt, version: photo.url, thumbnailUrl: photo.url, record, detail: photo.label,
    };
  });
}

/** Dokument pracownika jako plik Dysku: nazwa z rozszerzeniem pliku, rodzaj, termin ważności i opis pod nazwą. */
function documentFileFrom(row: Row): DriveFile {
  const employeeId = String(row.employee_id).toLowerCase();
  const fileName = text(row.file_name);
  const ext = urlExtension(fileName);
  const name = withExtension(driveName(row.name, 'Dokument'), ext);
  const mime = text(row.mime_type) || EXTENSION_MIME[ext] || 'application/octet-stream';
  const expiry = text(row.expiry_date) ? text(row.expiry_date).slice(0, 10) : '';
  const expiryText = expiry ? (expiry < warsawDay.format(new Date()) ? `termin minął ${plDate(expiry)}` : `ważny do ${plDate(expiry)}`) : '';
  const description = text(row.description);
  return {
    id: `employee-document:${row.id}`, parentId: driveEmployeeDocumentsNode(employeeId), name, type: 'employee-document', mime, kind: materialKind(mime, name),
    size: Number(row.size_bytes) || null, updatedAt: row.updated_at || row.created_at || null,
    version: `${row.updated_at || row.created_at || ''}|${text(row.storage_path)}`, thumbnailUrl: null, record: { type: 'employee', id: employeeId },
    detail: [EMPLOYEE_DOCUMENT_TYPES.find((entry) => entry.key === row.document_type)?.label || 'Dokument', expiryText,
      description.length > 80 ? `${description.slice(0, 79)}…` : description].filter(Boolean).join(' · '),
  };
}

/**
 * Dokumenty pracownika (`employeeId`) albo wszystkie widoczne (`null` — synchronizacja Findera; RLS zostawia własne albo wszystkie
 * dla „Pracownicy — zarządzanie”). Bez tabeli (migracja niewdrożona): `tolerant` — pusta lista, inaczej komunikat.
 */
async function employeeDocumentRows(ctx: NativeContext, employeeId: string | null, tolerant = false): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let query = ctx.supabase.from('employee_documents').select(DOCUMENT_COLUMNS);
    if (employeeId) query = query.eq('employee_id', employeeId);
    const { data, error } = await query.order('created_at', { ascending: false }).order('id').range(from, from + PAGE - 1);
    if (documentsMissing(error)) {
      if (tolerant) return [];
      fail(DOCUMENTS_PENDING, 503, { code: 'pending' });
    }
    check(error, 'Nie udało się pobrać dokumentów pracownika.');
    rows.push(...((data || []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/**
 * Umowy personelu z dokumentem (najnowsza wersja z „Umowy i rozliczenia”) jako PDF-y w folderze „Umowy” pracownika —
 * `employeeIds` albo wszystkie widoczne (`null`). Właściciel umowy jak w bazie: pracownik osoby z umowy, inaczej pracownik umowy.
 */
async function employeeContractFiles(ctx: NativeContext, employeeIds: string[] | null): Promise<DriveFile[]> {
  const s = ctx.supabase;
  const columns = 'id,employee_id,person_id,contract_kind,contract_number,title,status,created_at';
  const contracts: Row[] = [];
  if (employeeIds) {
    if (!employeeIds.length) return [];
    const people = await fetchAll((a, b) => s.from('personnel_people').select('id').in('employee_id', employeeIds).order('id').range(a, b),
      'Nie udało się pobrać umów pracownika.');
    contracts.push(...await fetchAll((a, b) => s.from('personnel_contracts').select(columns).in('employee_id', employeeIds).order('id').range(a, b),
      'Nie udało się pobrać umów pracownika.'));
    const personIds = people.map((row) => String(row.id));
    for (let i = 0; i < personIds.length; i += CHUNK) {
      contracts.push(...await fetchAll((a, b) => s.from('personnel_contracts').select(columns).in('person_id', personIds.slice(i, i + CHUNK)).order('id').range(a, b),
        'Nie udało się pobrać umów pracownika.'));
    }
  } else {
    contracts.push(...await fetchAll((a, b) => s.from('personnel_contracts').select(columns).order('id').range(a, b), 'Nie udało się pobrać umów personelu.'));
  }
  const unique = new Map(contracts.map((row) => [String(row.id), row] as const));
  if (!unique.size) return [];
  const personIds = Array.from(new Set(Array.from(unique.values()).map((row) => row.person_id).filter(Boolean).map(String)));
  const owners = new Map<string, string>();
  for (let i = 0; i < personIds.length; i += CHUNK) {
    const { data, error } = await s.from('personnel_people').select('id,employee_id').in('id', personIds.slice(i, i + CHUNK));
    check(error, 'Nie udało się pobrać umów personelu.');
    for (const row of (data || []) as Row[]) if (row.employee_id) owners.set(String(row.id), String(row.employee_id).toLowerCase());
  }
  const wanted = employeeIds ? new Set(employeeIds.map((id) => id.toLowerCase())) : null;
  const ownerOf = (row: Row) => (row.person_id && owners.get(String(row.person_id))) || (row.employee_id ? String(row.employee_id).toLowerCase() : '');
  const relevant = Array.from(unique.values()).filter((row) => {
    const owner = ownerOf(row);
    return owner && (!wanted || wanted.has(owner));
  });
  const latest = new Map<string, Row>();
  const ids = relevant.map((row) => String(row.id));
  for (let i = 0; i < ids.length; i += CHUNK) {
    const documents = await fetchAll((a, b) => s.from('personnel_contract_documents').select('id,contract_id,version,created_at')
      .in('contract_id', ids.slice(i, i + CHUNK)).order('version', { ascending: false }).order('id').range(a, b), 'Nie udało się pobrać dokumentów umów.');
    for (const doc of documents) if (!latest.has(String(doc.contract_id))) latest.set(String(doc.contract_id), doc);
  }
  const out: DriveFile[] = [];
  for (const row of relevant.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    const doc = latest.get(String(row.id));
    if (!doc) continue;
    const owner = ownerOf(row);
    const kind = CONTRACT_KINDS[text(row.contract_kind)] || 'Umowa';
    out.push({
      id: `employee-contract:${doc.id}`, parentId: `employees:${owner}:contracts`, name: personnelContractName(row), type: 'employee-contract',
      mime: 'application/pdf', kind: 'pdf', size: null, updatedAt: doc.created_at || null, version: String(doc.id), thumbnailUrl: null,
      record: { type: 'employee', id: owner },
      detail: [kind, PERSONNEL_STATUS[text(row.status)] || '', `wersja ${Number(doc.version) || 1}`].filter(Boolean).join(' · '),
    });
  }
  return out;
}

const personnelContractName = (row: Row) =>
  pdfName([text(row.contract_number) || CONTRACT_KINDS[text(row.contract_kind)] || 'Umowa', text(row.title)].filter(Boolean).join(' — '), 'Umowa');

/** Pliki w folderach pracowników bez powtórzeń nazw (w każdym folderze osobno). */
const uniqueByParent = (files: DriveFile[]) => {
  const byParent = new Map<string, DriveFile[]>();
  for (const file of files) byParent.set(file.parentId, [...(byParent.get(file.parentId) || []), file]);
  return Array.from(byParent.values()).flatMap((list) => driveUniqueNames(list));
};

async function employeesListing(ctx: NativeContext, node: Extract<DriveNode, { section: 'employees' }>): Promise<DriveListing> {
  const root = sectionFolder('employees');
  if (node.employeeId && node.group === 'documents') {
    // Dokumenty: sam pracownik albo „Pracownicy — zarządzanie” — także bez działu Pracownicy (zakładka „Dokumenty” w profilu).
    if (!canSeeDocuments(ctx, node.employeeId)) fail('Dokumenty pracownika widzi on sam i osoba z prawem „Pracownicy — zarządzanie”.', 403, { code: 'forbidden' });
    const employee = await employeeById(ctx, node.employeeId);
    const files = driveUniqueNames((await employeeDocumentRows(ctx, employee.id)).map(documentFileFrom));
    const self = groupNode(employee, 'documents', files.length);
    return { node: self, path: [root, employeeNode(employee), self], folders: [], files, canUpload: true, colors: [] };
  }
  requireSection(ctx, 'employees');
  if (!node.employeeId) {
    return { node: root, path: [root], folders: driveUniqueNames((await employeeEntries(ctx)).map(employeeNode)), files: [], ...EMPTY };
  }
  const employee = await employeeById(ctx, node.employeeId);
  const person = employeeNode(employee);
  if (node.group === 'photos') {
    const files = employeePhotoFiles(employee);
    const self = groupNode(employee, 'photos', files.length);
    return { node: self, path: [root, person, self], folders: [], files, ...EMPTY };
  }
  if (node.group === 'contracts') {
    if (!canSeeContracts(ctx, employee.id)) fail('Umowy pracownika widzi on sam i osoba z prawem „Umowy personelu — podgląd”.', 403, { code: 'forbidden' });
    const files = driveUniqueNames(await employeeContractFiles(ctx, [employee.id]));
    const self = groupNode(employee, 'contracts', files.length);
    return { node: self, path: [root, person, self], folders: [], files, ...EMPTY };
  }
  const folders = [groupNode(employee, 'photos', employeePhotoFiles(employee).length)];
  if (canSeeDocuments(ctx, employee.id)) folders.push(groupNode(employee, 'documents', (await employeeDocumentRows(ctx, employee.id, true)).length));
  if (canSeeContracts(ctx, employee.id)) folders.push(groupNode(employee, 'contracts', (await employeeContractFiles(ctx, [employee.id])).length));
  return { node: person, path: [root, person], folders, files: [], ...EMPTY };
}

/** Cały dział Pracownicy dla Findera: pracownicy, ich foldery (tylko z dostępem) i pliki. */
async function employeesSync(ctx: NativeContext): Promise<{ folders: DriveFolder[]; files: DriveFile[] }> {
  const list = await employeeEntries(ctx);
  const named = driveUniqueNames(list.map(employeeNode));
  const folders: DriveFolder[] = [sectionFolder('employees'), ...named];
  const files: DriveFile[] = [];
  const documents = (await employeeDocumentRows(ctx, null, true)).map(documentFileFrom);
  let contracts: DriveFile[] = [];
  try {
    contracts = await employeeContractFiles(ctx, null);
  } catch (error) {
    console.error('[native drive] employee contracts', error instanceof Error ? error.message : error);
  }
  for (const employee of list) {
    const photos = employeePhotoFiles(employee);
    folders.push(groupNode(employee, 'photos', photos.length));
    files.push(...photos);
    if (canSeeDocuments(ctx, employee.id)) {
      const own = documents.filter((file) => file.parentId === driveEmployeeDocumentsNode(employee.id));
      folders.push(groupNode(employee, 'documents', own.length));
      files.push(...own);
    }
    if (canSeeContracts(ctx, employee.id)) {
      const own = contracts.filter((file) => file.parentId === `employees:${employee.id}:contracts`);
      folders.push(groupNode(employee, 'contracts', own.length));
      files.push(...own);
    }
  }
  return { folders, files: uniqueByParent(files) };
}

/**
 * PDF dokumentu umowy personelu: kopia `employee-documents/contracts/<dokument>.pdf` (dokument w CRM jest niezmienny — nowa wersja
 * to nowy dokument), za pierwszym razem renderowana na serwerze z treści zapisanej w CRM. Dostęp sprawdza wcześniejszy odczyt
 * dokumentu tokenem pracownika (RLS); kopię zapisuje i podpisuje konto serwisowe (użytkownicy nie mają dostępu do `contracts/`).
 */
async function personnelContractUrl(document: Row, title: string, name: string, mode: 'preview' | 'download') {
  const admin = createSupabaseAdminClient();
  const path = `contracts/${String(document.id).toLowerCase()}.pdf`;
  const sign = () => admin.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, SIGNED_TTL, mode === 'download' ? { download: name } : undefined);
  let { data } = await sign();
  if (!data?.signedUrl) {
    const { renderPersonnelContractPdf } = await import('@/lib/personnel/contractPdf.server');
    const pdf = await renderPersonnelContractPdf(text(document.content), title);
    const { error } = await admin.storage.from(DOCUMENTS_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true });
    if (error) {
      console.error('[native drive] contract pdf', error.message);
      fail('Nie udało się przygotować PDF-u umowy. Spróbuj ponownie za chwilę.', 500);
    }
    ({ data } = await sign());
  }
  if (!data?.signedUrl) fail('Nie udało się przygotować PDF-u umowy. Spróbuj ponownie za chwilę.', 500);
  return data.signedUrl;
}

// MARK: Finanse

/*
 * Dział Finanse: firma → Księgowość → rok → miesiąc → teczka miesiąca (Sprzedaż, Koszty, Bank, Podatki i ZUS, XML z KSeF).
 * Firmy i teczki według poziomu dostępu do finansów (`get_invoice_finance_access`): faktury — co najmniej „Faktury”, bank
 * i podatki — „Podgląd finansów”; zakres „sprzedaż” nie widzi działu. Wiersze czyta token pracownika (RLS jak w CRM). Miesiąc
 * jak w przekazaniu księgowej: faktury CRM i KSeF — data wystawienia, dokumenty spoza KSeF — data dokumentu, wyciągi — miesiąc
 * wyciągu, deklaracje — okres (roczne — grudzień). Faktura CRM wysłana do KSeF jest w Sprzedaży raz (PDF z CRM), jej XML —
 * w „XML z KSeF”. Wizualizacje faktur z KSeF, wydruki faktur CRM bez zapisanego PDF i kopie XML powstają raz na serwerze
 * i czekają w prywatnym magazynie `finance-documents` (`<firma>/ksef|invoices/…`): zapis i podpis konta serwisowego po
 * sprawdzeniu dostępu tokenem pracownika (jak PDF umowy personelu).
 */

const FINANCE_BUCKET = 'finance-documents';
const FINANCE_PENDING = 'Pliki Finansów czekają na aktualizację bazy (migracja 20261125140000_finance_drive_documents.sql).';
const FINANCE_FILE_TYPES: ReadonlySet<DriveFileType> = new Set([
  'sales-invoice', 'ksef-invoice', 'ksef-xml', 'cost-document', 'bank-statement', 'tax-document', 'company-document', 'agreement-file',
  'asset-register', 'asset-register-csv', 'month-close', 'clarify-report',
]);
/** Wersja szablonów raportów „Zamknięcie miesiąca” i „Do wyjaśnienia” (`financeReports.server.ts`) — zmiana szablonu = podnieś. */
const FINANCE_REPORT_VERSION = 1;
/** Dokument spoza KSeF dodany bez odczytanych danych (Koszty, skaner) — do uzupełnienia. */
const COST_PLACEHOLDER = 'Do uzupełnienia';
/** Wersja szablonu rejestru majątku (`assetRegister.server.ts`) — zmiana szablonu = podnieś. */
const ASSET_REGISTER_VERSION = 1;
const FINANCE_MISSING = 'Nie znaleziono dokumentu albo nie masz do niego dostępu.';
/** Wersja szablonu wizualizacji faktur z KSeF (`ksefVisualization.server.ts`) — zmiana szablonu = podnieś (nowe kopie i nowe wersje w Finderze). */
const KSEF_VISUALIZATION_VERSION = 1;

const SALES_COLUMNS = 'id,invoice_number,invoice_type,status,issue_date,buyer_name,total_gross,currency_code,pdf_url,pdf_generated_at,updated_at,my_company_id,is_proforma,cancelled_at,payment_due_date';
const KSEF_COLUMNS = 'id,invoice_type,invoice_id,invoice_number,seller_name,buyer_name,gross_amount,currency,issue_date,ksef_reference_number,synced_at,created_at,payment_status,payment_due_date,my_company_id';
const KSEF_DETAIL_COLUMNS = `${KSEF_COLUMNS},xml_content,seller_nip,buyer_nip,seller_address,buyer_address,net_amount,vat_amount,vat_rate,invoice_items,payment_method,bank_account_number`;
const EXTERNAL_COLUMNS = 'id,seller_name,invoice_number,label,invoice_date,amount_gross,currency,file_url,document_kind,payment_status,my_company_id,updated_at,created_at';
const STATEMENT_COLUMNS = 'id,file_name,file_type,statement_month,statement_year,account_number,account_type,currency,file_storage_path,my_company_id,created_at,upload_date,validation_status';
const DECLARATION_COLUMNS = 'id,my_company_id,kind,form,period_kind,period_start';
const DECLARATION_FILE_COLUMNS = 'id,declaration_id,storage_path,file_name,mime_type,file_size,created_at';

/** `finance` — „Finanse — podgląd” (bank, podatki, dokumenty spółki, umowy stałe), `manage` — „Finanse — zarządzanie” (dodawanie i usuwanie plików). */
type FinanceCompany = { id: string; name: string; finance: boolean; manage: boolean };
type FinanceDoc = { file: Omit<DriveFile, 'parentId'>; companyId: string; group: DriveFinanceGroup; year: number; month: number; date: string };

const SALES_TYPES: Record<string, string> = {
  vat: 'Faktura VAT', advance: 'Faktura zaliczkowa', final: 'Faktura końcowa', corrective: 'Faktura korygująca',
};
/** Krótki dopisek w nazwie dokumentu spoza KSeF (rodzaj — jak `EXTERNAL_DOCUMENT_KINDS`). */
const EXTERNAL_TAGS: Record<string, string> = {
  invoice: 'spoza KSeF', receipt: 'paragon', credit_note: 'korekta spoza KSeF', insurance_policy: 'polisa', contract: 'umowa', debit_note: 'nota',
  other: 'dokument',
};

const financeMoney = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad2 = (value: number) => String(value).padStart(2, '0');
const lower = (value: unknown) => String(value ?? '').toLowerCase();
const dayOf = (value: unknown) => (/^\d{4}-\d{2}-\d{2}/.test(text(value)) ? text(value).slice(0, 10) : '');
const dayParts = (day: string) => (day ? { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) } : null);
const sha12 = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 12);

/** „1 230,00 zł” albo kwota z kodem waluty; bez kwoty — pusto. */
function amountLabel(value: unknown, currency: unknown) {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  const code = text(currency).toUpperCase() || 'PLN';
  return `${financeMoney.format(amount)} ${code === 'PLN' ? 'zł' : code}`;
}

/** Stan płatności dokumentu (faktury CRM — status, KSeF i spoza KSeF — `payment_status`). */
function paymentLabel(status: unknown, due: unknown) {
  switch (text(status)) {
    case 'paid': return 'Opłacona';
    case 'overdue': return 'Po terminie';
    case 'refunded': return 'Zwrócona';
    case 'unpaid': case 'sent': case 'issued': return dayOf(due) ? `Do zapłaty do ${plDate(dayOf(due))}` : 'Do zapłaty';
    default: return '';
  }
}

/** Nazwa pliku w teczce: części rozdzielone „ · ”, rozszerzenie na końcu (data na początku — kolejność w Finderze). */
const financeName = (parts: string[], ext: string, fallback: string) => withExtension(driveName(parts.filter(Boolean).join(' · '), fallback), ext);

/** Ścieżka PDF-u faktury CRM w `event-files` (zapis w CRM to ścieżka; starsze wiersze mogą mieć pełny adres magazynu). */
const invoiceStoragePath = (value: unknown) =>
  text(value).replace(/^https?:\/\/[^/]+\/storage\/v1\/object\/(?:public|sign)\/event-files\//i, '').split('?')[0];

const financeAccessCache = new WeakMap<NativeContext, Promise<FinanceCompany[]>>();

/** Firmy działu Finanse: poziom co najmniej „Faktury” (zakres „cała firma”); `finance` — także bank i podatki („Podgląd finansów”). */
function financeCompanies(ctx: NativeContext): Promise<FinanceCompany[]> {
  let pending = financeAccessCache.get(ctx);
  if (!pending) {
    pending = (async () => {
      let access: Awaited<ReturnType<typeof loadInvoiceFinanceAccess>>;
      try {
        access = await loadInvoiceFinanceAccess(ctx.supabase);
      } catch (error) {
        console.error('[native drive] finance access', error instanceof Error ? error.message : error);
        fail('Nie udało się ustalić dostępu do finansów. Spróbuj ponownie za chwilę.', 503);
      }
      if (access.scope !== 'company' || !access.invoiceViewCompanyIds.length) return [];
      const ids = access.invoiceViewCompanyIds.map(lower);
      const { data, error } = await ctx.supabase.from('my_companies').select('id,name,legal_name').in('id', ids);
      check(error, 'Nie udało się pobrać firm.');
      const finance = new Set(access.financeViewCompanyIds.map(lower));
      const manage = new Set(access.financeManageCompanyIds.map(lower));
      return ((data || []) as Row[])
        .map((row) => ({
          id: lower(row.id), name: driveName(text(row.name) || text(row.legal_name), 'Firma'), finance: finance.has(lower(row.id)),
          manage: finance.has(lower(row.id)) && manage.has(lower(row.id)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    })();
    financeAccessCache.set(ctx, pending);
    pending.catch(() => financeAccessCache.delete(ctx));
  }
  return pending;
}

const financeGroups = (company: FinanceCompany) => DRIVE_FINANCE_GROUPS.filter((group) => group.level === 'invoices' || company.finance);

/** Faktura CRM w Sprzedaży (bez proform, szkiców i anulowanych); PDF z CRM albo wydruk z danych faktury. */
function salesDoc(row: Row): FinanceDoc | null {
  if (row.is_proforma || row.cancelled_at || ['draft', 'proforma', 'cancelled'].includes(text(row.status)) || text(row.invoice_type) === 'proforma') return null;
  const day = dayOf(row.issue_date);
  const when = dayParts(day);
  if (!when) return null;
  const path = invoiceStoragePath(row.pdf_url);
  return {
    companyId: lower(row.my_company_id), group: 'sales', ...when, date: day,
    file: {
      id: `sales-invoice:${lower(row.id)}`, type: 'sales-invoice', mime: 'application/pdf', kind: 'pdf', size: null, thumbnailUrl: null,
      name: financeName([day, text(row.invoice_number) || 'Faktura', text(row.buyer_name), amountLabel(row.total_gross, row.currency_code)], 'pdf', 'Faktura'),
      updatedAt: row.pdf_generated_at || row.updated_at || null,
      version: path ? `${row.pdf_generated_at || row.updated_at || ''}|${path}` : `print|${row.updated_at || ''}`,
      record: { type: 'invoice', id: lower(row.id) },
      detail: [SALES_TYPES[text(row.invoice_type)] || 'Faktura', paymentLabel(row.status, row.payment_due_date), path ? '' : 'wydruk z danych faktury']
        .filter(Boolean).join(' · '),
    },
  };
}

/**
 * Faktura z KSeF: wizualizacja PDF (otrzymana — Koszty, wystawiona — Sprzedaż, chyba że jej faktura CRM już tam jest z PDF-em
 * z CRM: `inSales`) i oryginał XML (gdy zapisany) w „XML z KSeF”.
 */
function ksefDocs(row: Row, hasXml: boolean, inSales: boolean): FinanceDoc[] {
  const day = dayOf(row.issue_date);
  const when = dayParts(day);
  if (!when) return [];
  const issued = text(row.invoice_type) === 'issued';
  const companyId = lower(row.my_company_id);
  const id = lower(row.id);
  const number = text(row.invoice_number) || 'Faktura';
  const counterparty = issued ? text(row.buyer_name) : text(row.seller_name);
  const record = { type: 'ksef-invoice' as const, id };
  const out: FinanceDoc[] = [];
  if (!(issued && inSales)) {
    out.push({
      companyId, group: issued ? 'sales' : 'costs', ...when, date: day,
      file: {
        id: `ksef-invoice:${id}`, type: 'ksef-invoice', mime: 'application/pdf', kind: 'pdf', size: null, thumbnailUrl: null,
        name: financeName([day, number, counterparty, amountLabel(row.gross_amount, row.currency), 'KSeF'], 'pdf', 'Faktura'),
        updatedAt: row.synced_at || row.created_at || null,
        version: `${row.synced_at || row.created_at || ''}|${hasXml ? 'xml' : 'dane'}|v${KSEF_VISUALIZATION_VERSION}`,
        record,
        detail: ['Faktura z KSeF', issued ? '' : paymentLabel(row.payment_status, row.payment_due_date), hasXml ? '' : 'bez pobranego XML']
          .filter(Boolean).join(' · '),
      },
    });
  }
  if (hasXml) {
    out.push({
      companyId, group: 'ksef', ...when, date: day,
      file: {
        id: `ksef-xml:${id}`, type: 'ksef-xml', mime: 'application/xml', kind: materialKind('application/xml', 'faktura.xml'), size: null,
        thumbnailUrl: null, name: financeName([day, number, counterparty], 'xml', 'Faktura'), updatedAt: row.synced_at || row.created_at || null,
        version: `${row.synced_at || row.created_at || ''}|xml`, record,
        detail: [issued ? 'Sprzedaż' : 'Koszt', text(row.ksef_reference_number) ? `KSeF ${text(row.ksef_reference_number)}` : ''].filter(Boolean).join(' · '),
      },
    });
  }
  return out;
}

/** Dokument spoza KSeF (faktura zagraniczna, paragon, polisa…) w Kosztach — plik wgrany w CRM. */
function externalDoc(row: Row): FinanceDoc | null {
  const path = text(row.file_url);
  if (!path) return null;
  const day = dayOf(row.invoice_date);
  const when = day ? dayParts(day) : yearMonth(row.created_at);
  if (!when) return null;
  const ext = urlExtension(path) || 'pdf';
  const mime = EXTENSION_MIME[ext] || 'application/octet-stream';
  return {
    companyId: lower(row.my_company_id), group: 'costs', ...when, date: day || text(row.created_at),
    file: {
      id: `cost-document:${lower(row.id)}`, type: 'cost-document', mime, kind: materialKind(mime, `dokument.${ext}`), size: null, thumbnailUrl: null,
      name: financeName([day, text(row.invoice_number) || text(row.label), text(row.seller_name), amountLabel(row.amount_gross, row.currency),
        EXTERNAL_TAGS[text(row.document_kind)] || 'spoza KSeF'], ext, 'Dokument'),
      updatedAt: row.updated_at || row.created_at || null, version: `${row.updated_at || row.created_at || ''}|${path}`,
      record: { type: 'external-invoice', id: lower(row.id) },
      detail: [externalDocumentKindLabel(text(row.document_kind) || null), paymentLabel(row.payment_status, null)].filter(Boolean).join(' · '),
    },
  };
}

/** Wyciąg bankowy (PDF albo MT940) w teczce miesiąca wyciągu. */
function statementDoc(row: Row): FinanceDoc | null {
  const year = Number(row.statement_year);
  const month = Number(row.statement_month);
  const path = text(row.file_storage_path);
  if (!path || !(year >= 2000 && year <= 2100 && month >= 1 && month <= 12)) return null;
  const ext = urlExtension(text(row.file_name)) || urlExtension(path) || (text(row.file_type).toUpperCase() === 'PDF' ? 'pdf' : 'txt');
  const digits = text(row.account_number).replace(/\D/g, '');
  const currency = text(row.currency).toUpperCase();
  const account = [text(row.account_type) === 'vat' ? 'rachunek VAT' : 'rachunek', digits.length >= 4 ? `…${digits.slice(-4)}` : '',
    currency && currency !== 'PLN' ? currency : ''].filter(Boolean).join(' ');
  const mime = EXTENSION_MIME[ext] || 'text/plain';
  return {
    companyId: lower(row.my_company_id), group: 'bank', year, month, date: `${year}-${pad2(month)}-01`,
    file: {
      id: `bank-statement:${lower(row.id)}`, type: 'bank-statement', mime, kind: materialKind(mime, `wyciag.${ext}`), size: null, thumbnailUrl: null,
      name: financeName([`Wyciąg — ${account}`, `${pad2(month)}.${year}`], ext, 'Wyciąg'),
      updatedAt: row.created_at || row.upload_date || null, version: `${row.created_at || ''}|${path}`,
      record: { type: 'finance', id: lower(row.my_company_id) },
      detail: [text(row.file_type), text(row.validation_status) === 'valid' ? 'Odczytany' : 'Do sprawdzenia'].filter(Boolean).join(' · '),
    },
  };
}

/** Plik deklaracji (VAT, ZUS, PIT, CIT) w teczce okresu, którego dotyczy (roczna — grudzień tego roku). */
function taxDoc(file: Row, declaration: Row): FinanceDoc | null {
  const start = dayOf(declaration.period_start);
  const path = text(file.storage_path);
  if (!start || !path) return null;
  const yearly = text(declaration.period_kind) === 'year';
  const year = Number(start.slice(0, 4));
  const month = yearly ? 12 : Number(start.slice(5, 7));
  const period = yearly ? String(year) : `${start.slice(5, 7)}.${year}`;
  const form = text(declaration.form) || text(declaration.kind).toUpperCase() || 'Deklaracja';
  const fileName = text(file.file_name) || 'plik';
  const ext = urlExtension(fileName) || urlExtension(path) || 'pdf';
  const mime = text(file.mime_type) || EXTENSION_MIME[ext] || 'application/octet-stream';
  return {
    companyId: lower(declaration.my_company_id), group: 'taxes', year, month, date: `${year}-${pad2(month)}-01`,
    file: {
      id: `tax-document:${lower(file.id)}`, type: 'tax-document', mime, kind: materialKind(mime, fileName), size: Number(file.file_size) || null,
      thumbnailUrl: null, name: withExtension(driveName(`${form} za ${period} — ${fileName.replace(/\.[A-Za-z0-9]{2,5}$/, '')}`, form), ext),
      updatedAt: file.created_at || null, version: `${file.created_at || ''}|${path}`, record: { type: 'finance', id: lower(declaration.my_company_id) },
      detail: `${form} · ${yearly ? `rok ${year}` : `okres ${period}`}`,
    },
  };
}

/** Wszystkie dokumenty teczek wskazanych firm (bank i podatki — tylko firmy z „Podglądem finansów”). */
async function financeDocs(ctx: NativeContext, companies: FinanceCompany[]): Promise<FinanceDoc[]> {
  if (!companies.length) return [];
  const s = ctx.supabase;
  const ids = companies.map((company) => company.id);
  const financeIds = companies.filter((company) => company.finance).map((company) => company.id);
  const [sales, ksef, withXml, external, statements, declarations] = await Promise.all([
    fetchAll((a, b) => s.from('invoices').select(SALES_COLUMNS).in('my_company_id', ids).order('issue_date').order('id').range(a, b),
      'Nie udało się pobrać faktur sprzedaży.'),
    fetchAll((a, b) => s.from('ksef_invoices').select(KSEF_COLUMNS).in('my_company_id', ids).order('issue_date').order('id').range(a, b),
      'Nie udało się pobrać faktur z KSeF.'),
    fetchAll((a, b) => s.from('ksef_invoices').select('id').in('my_company_id', ids).not('xml_content', 'is', null).order('id').range(a, b),
      'Nie udało się pobrać faktur z KSeF.'),
    fetchAll((a, b) => s.from('external_invoices').select(EXTERNAL_COLUMNS).in('my_company_id', ids).not('file_url', 'is', null).order('id').range(a, b),
      'Nie udało się pobrać dokumentów spoza KSeF.'),
    financeIds.length
      ? fetchAll((a, b) => s.from('bank_statements').select(STATEMENT_COLUMNS).in('my_company_id', financeIds).not('file_storage_path', 'is', null)
        .order('id').range(a, b), 'Nie udało się pobrać wyciągów.')
      : Promise.resolve([] as Row[]),
    financeIds.length
      ? fetchAll((a, b) => s.from('finance_declarations').select(DECLARATION_COLUMNS).in('my_company_id', financeIds).order('id').range(a, b),
        'Nie udało się pobrać deklaracji.')
      : Promise.resolve([] as Row[]),
  ]);
  const declarationIds = declarations.map((row) => String(row.id));
  const files: Row[] = [];
  for (let i = 0; i < declarationIds.length; i += CHUNK) {
    const part = declarationIds.slice(i, i + CHUNK);
    files.push(...await fetchAll((a, b) => s.from('finance_declaration_files').select(DECLARATION_FILE_COLUMNS).in('declaration_id', part)
      .order('id').range(a, b), 'Nie udało się pobrać plików deklaracji.'));
  }
  const xml = new Set(withXml.map((row) => lower(row.id)));
  const byDeclaration = new Map(declarations.map((row) => [lower(row.id), row]));
  const allowed = new Set(ids);
  const salesDocs = sales.map(salesDoc).filter((doc): doc is FinanceDoc => Boolean(doc));
  // Faktura CRM wysłana do KSeF, której nie ma w Sprzedaży (np. anulowana później w CRM) — w Sprzedaży zostaje wizualizacja z KSeF.
  const inSales = new Set(salesDocs.map((doc) => doc.file.id.slice('sales-invoice:'.length)));
  const docs: FinanceDoc[] = [
    ...salesDocs,
    ...ksef.flatMap((row) => ksefDocs(row, xml.has(lower(row.id)), Boolean(row.invoice_id) && inSales.has(lower(row.invoice_id)))),
    ...external.map(externalDoc),
    ...statements.map(statementDoc),
    ...files.map((file) => {
      const declaration = byDeclaration.get(lower(file.declaration_id));
      return declaration ? taxDoc(file, declaration) : null;
    }),
  ].filter((doc): doc is FinanceDoc => Boolean(doc) && allowed.has(doc!.companyId));
  return docs;
}

const companyFolder = (company: FinanceCompany): DriveFolder => ({
  id: driveFinanceNodeId(company.id), parentId: 'finance', name: company.name, kind: 'company', count: null,
});

/** Foldery firm, Księgowości, lat, miesięcy i teczek oraz pliki z nazwami bez powtórzeń w teczce (od najstarszego). */
type PeriodState = { locked: boolean; lockedAt: string | null; lockedBy: string | null; handedOverAt: string | null };
const periodKey = (companyId: string, year: number, month: number) => `${companyId}:${year}-${pad2(month)}`;

/** Stan miesięcy firm z „Finanse — podgląd” (zamknięty, przekazany księgowej — `get_finance_periods`); błąd odczytu — bez stanu. */
async function financePeriods(ctx: NativeContext, companies: FinanceCompany[], years: number[]): Promise<Map<string, PeriodState>> {
  const out = new Map<string, PeriodState>();
  const jobs = companies.filter((company) => company.finance).flatMap((company) => Array.from(new Set(years)).map((year) => ({ company, year })));
  await Promise.all(jobs.map(async ({ company, year }) => {
    const { data, error } = await ctx.supabase.rpc('get_finance_periods', { p_company_id: company.id, p_year: year });
    if (error || !Array.isArray(data)) return;
    for (const row of data as Row[]) {
      const month = Number(row.month);
      if (!(month >= 1 && month <= 12)) continue;
      out.set(periodKey(company.id, year, month), {
        locked: row.locked === true, lockedAt: text(row.locked_at) || null, lockedBy: text(row.locked_by_name) || null, handedOverAt: text(row.handed_over_at) || null,
      });
    }
  }));
  return out;
}

/** Lata, których dotyczą dokumenty (i bieżący) — dla stanu miesięcy. */
const financeYears = (docs: FinanceDoc[]) => Array.from(new Set([...docs.map((doc) => doc.year), Number(warsawDay.format(new Date()).slice(0, 4))]));

const periodText = (period: PeriodState | undefined) => (period?.locked ? 'zamknięty' : period?.handedOverAt ? 'przekazany księgowej' : '');

function financeTree(companies: FinanceCompany[], docs: FinanceDoc[], periods: Map<string, PeriodState> = new Map()) {
  const folders: DriveFolder[] = [];
  const byParent = new Map<string, FinanceDoc[]>();
  const monthFiles: Array<DriveFile & { date: string }> = [];
  for (const company of companies) {
    const own = docs.filter((doc) => doc.companyId === company.id);
    const companyId = driveFinanceNodeId(company.id);
    const booksId = driveFinanceNodeId(company.id, { books: true });
    folders.push(companyFolder(company), { id: booksId, parentId: companyId, name: DRIVE_FINANCE_BOOKS, kind: 'books', count: own.length });
    const years = new Map<number, number>();
    const months = new Map<string, { year: number; month: number; count: number }>();
    // Bieżący miesiąc zawsze jest (pusty też) — tu trafiają nowe dokumenty, skany i pliki z Findera.
    const today = warsawDay.format(new Date());
    const current = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
    years.set(current.year, 0);
    months.set(driveFinanceNodeId(company.id, current), { ...current, count: 0 });
    for (const doc of own) {
      years.set(doc.year, (years.get(doc.year) || 0) + 1);
      const monthId = driveFinanceNodeId(company.id, { year: doc.year, month: doc.month });
      const entry = months.get(monthId) || { year: doc.year, month: doc.month, count: 0 };
      entry.count += 1;
      months.set(monthId, entry);
      const parent = `${monthId}:${doc.group}`;
      byParent.set(parent, [...(byParent.get(parent) || []), doc]);
    }
    for (const [year, count] of years) {
      folders.push({ id: driveFinanceNodeId(company.id, { year }), parentId: booksId, name: String(year), kind: 'year', count });
    }
    for (const [monthId, entry] of months) {
      const period = periods.get(periodKey(company.id, entry.year, entry.month));
      const status = periodText(period);
      folders.push({
        id: monthId, parentId: driveFinanceNodeId(company.id, { year: entry.year }), name: `${driveMonthName(entry.month)}${status ? ` · ${status}` : ''}`,
        kind: 'month', count: entry.count,
      });
      // Lista zamknięcia miesiąca — firmy z „Finanse — podgląd” (dane przekazania księgowej: bank, deklaracje).
      if (company.finance) {
        const label = `${DRIVE_MONTHS[entry.month - 1]} ${entry.year}`;
        monthFiles.push({
          id: driveMonthCloseFileId(company.id, entry.year, entry.month), parentId: monthId, name: driveName(`Zamknięcie miesiąca — ${label}.pdf`, 'Zamknięcie miesiąca.pdf'),
          type: 'month-close', mime: 'application/pdf', kind: 'pdf', size: null, updatedAt: null, thumbnailUrl: null,
          version: `v${FINANCE_REPORT_VERSION}|${warsawDay.format(new Date())}|${status}|${entry.count}`, record: { type: 'finance', id: company.id },
          detail: ['Lista kontrolna i sprawy do wyjaśnienia', status ? `miesiąc ${status}` : 'miesiąc otwarty'].join(' · '),
          date: `${entry.year}-${pad2(entry.month)}-01`,
        });
      }
      for (const group of financeGroups(company)) {
        const id = `${monthId}:${group.key}`;
        folders.push({
          id, parentId: monthId, name: group.label, kind: 'ledger', count: (byParent.get(id) || []).length,
          ...(group.key === 'costs' && company.manage ? { upload: true } : {}),
        });
      }
    }
  }
  const files: Array<DriveFile & { date: string }> = [];
  for (const [parentId, list] of byParent) {
    const ordered = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.file.id.localeCompare(b.file.id));
    for (const row of driveUniqueNames(ordered.map((entry) => ({ ...entry.file, parentId, date: entry.date })))) files.push(row);
  }
  files.push(...monthFiles);
  return { folders, files };
}

async function financeListing(ctx: NativeContext, node: Extract<DriveNode, { section: 'finance' }>): Promise<DriveListing> {
  const companies = await financeCompanies(ctx);
  if (!companies.length) fail('Nie masz dostępu do tego działu Dysku.', 403, { code: 'forbidden' });
  const root = sectionFolder('finance');
  if (!node.companyId) return { node: root, path: [root], folders: companies.map(companyFolder), files: [], ...EMPTY };
  const company = companies.find((entry) => entry.id === node.companyId);
  if (!company) fail('Nie masz dostępu do finansów tej firmy.', 403, { code: 'forbidden' });
  if (node.area === 'corporate' || node.area === 'agreements' || node.area === 'assets' || node.area === 'clarify') return financeRecordsListing(ctx, company, node, root);
  const docs = await financeDocs(ctx, [company]);
  const tree = financeTree([company], docs, node.year !== null ? await financePeriods(ctx, [company], [node.year]) : new Map());
  const folder = (id: string, fallback: DriveFolder) => tree.folders.find((entry) => entry.id === id) || fallback;
  const children = (id: string) => tree.folders.filter((entry) => entry.parentId === id);
  const self = folder(driveFinanceNodeId(company.id), companyFolder(company));
  if (!node.books) {
    // Firma: Księgowość, a od „Finanse — podgląd” także Dokumenty spółki i Umowy stałe.
    const records = company.finance ? financeRecordsTree([company], await financeRecords(ctx, [company])) : { folders: [], files: [] };
    return { node: self, path: [root, self], folders: [...children(self.id), ...records.folders.filter((entry) => entry.parentId === self.id)], files: [], ...EMPTY };
  }
  const booksId = driveFinanceNodeId(company.id, { books: true });
  const books = folder(booksId, { id: booksId, parentId: self.id, name: DRIVE_FINANCE_BOOKS, kind: 'books', count: 0 });
  if (node.year === null) {
    return { node: books, path: [root, self, books], folders: children(books.id).sort((a, b) => b.name.localeCompare(a.name)), files: [], ...EMPTY };
  }
  const yearId = driveFinanceNodeId(company.id, { year: node.year });
  const year = folder(yearId, { id: yearId, parentId: books.id, name: String(node.year), kind: 'year', count: 0 });
  if (node.month === null) {
    return { node: year, path: [root, self, books, year], folders: children(year.id).sort((a, b) => b.id.localeCompare(a.id)), files: [], ...EMPTY };
  }
  const monthId = driveFinanceNodeId(company.id, { year: node.year, month: node.month });
  const month = folder(monthId, { id: monthId, parentId: year.id, name: driveMonthName(node.month), kind: 'month', count: 0 });
  const groups = financeGroups(company).map((group) => folder(`${monthId}:${group.key}`, {
    id: `${monthId}:${group.key}`, parentId: monthId, name: group.label, kind: 'ledger', count: 0,
  }));
  if (!node.group) {
    const files = tree.files.filter((file) => file.parentId === monthId).map(({ date: _date, ...file }) => file);
    return { node: month, path: [root, self, books, year, month], folders: groups, files, ...EMPTY };
  }
  const group = groups.find((entry) => entry.id === `${monthId}:${node.group}`);
  if (!group) fail('Nie masz dostępu do tego folderu Finansów.', 403, { code: 'forbidden' });
  const files = tree.files.filter((file) => file.parentId === group.id).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .map(({ date: _date, ...file }) => file);
  return { node: group, path: [root, self, books, year, month, group], folders: [], files, ...EMPTY, canUpload: node.group === 'costs' && company.manage };
}

// MARK: Finanse — Dokumenty spółki i Umowy stałe

/*
 * Dokumenty spółki (umowa spółki i KRS, uchwały, sprawozdania, rejestracje, pełnomocnictwa, inne) — tabela `company_documents`
 * i prywatny bucket `company-documents` (`<firma>/<plik>`, migracja 20261125150000). Umowy stałe — umowy z Centrum finansów
 * (`finance_recurring_contracts`) z plikami w `finance-contracts` (`<firma>/<umowa>/<plik>`). Widać je od „Finanse — podgląd”,
 * pliki dodaje i usuwa „Finanse — zarządzanie” (CRM, Mac, Finder; telefon — skaner). Wiersze i wysyłka — tokenem pracownika
 * (RLS i polityki magazynu), pobranie — adres podpisany przez konto serwisowe po odczycie wiersza.
 */

const CORPORATE_BUCKET = 'company-documents';
const AGREEMENTS_BUCKET = 'finance-contracts';
const CORPORATE_PENDING = 'Dokumenty spółki będą dostępne po wdrożeniu migracji bazy 20261125150000 (company_documents).';
const CORPORATE_COLUMNS = 'id,my_company_id,category,title,document_date,description,storage_path,file_name,mime_type,size_bytes,created_at,updated_at';
const AGREEMENT_COLUMNS = 'id,my_company_id,kind,title,counterparty_name,status,start_date,end_date';
const AGREEMENT_FILE_COLUMNS = 'id,contract_id,storage_path,file_name,mime_type,file_size,created_at';
/** Rodzaj umowy stałej (jak `RECURRING_CONTRACT_KIND_LABELS` w Centrum finansów). */
const AGREEMENT_KINDS: Record<string, string> = {
  rent: 'Najem', lease: 'Leasing', subscription: 'Abonament', insurance: 'Raty ubezpieczenia', loan: 'Kredyt / pożyczka', other: 'Inna umowa',
};

type FinanceRecords = { corporate: Row[]; agreements: Row[]; agreementFiles: Row[]; assets: AssetRegisterRow[] };

/** Nazwa obiektu w magazynie Finansów: bezpieczne znaki, bez „..” (funkcje bazy odrzucają takie ścieżki). */
const financeObjectName = (name: string) => safeObjectName(name).replace(/\.{2,}/g, '.');
const corporatePattern = (companyId: string) => new RegExp(`^${companyId}/\\d+-[0-9a-f]{7}-[A-Za-z0-9._-]{1,120}$`);
const agreementPattern = (companyId: string, contractId: string) => new RegExp(`^${companyId}/${contractId}/\\d+-[0-9a-f]{7}-[A-Za-z0-9._-]{1,120}$`);

/** Nazwy folderów bez powtórzeń wśród rodzeństwa („Najem — Biuro (2)”). */
function uniqueFolderNames(folders: DriveFolder[]): DriveFolder[] {
  const used = new Set<string>();
  return folders.map((folder) => {
    let name = folder.name;
    for (let n = 2; used.has(name.toLocaleLowerCase('pl-PL')); n += 1) name = `${folder.name} (${n})`;
    used.add(name.toLocaleLowerCase('pl-PL'));
    return name === folder.name ? folder : { ...folder, name };
  });
}

/** Dokument spółki jako plik Dysku: data dokumentu i tytuł w nazwie, rozszerzenie pliku. */
function corporateFile(row: Row, company: FinanceCompany): DriveFile {
  const category = driveCorporateCategory(row.category);
  const fileName = text(row.file_name) || 'plik';
  const ext = urlExtension(fileName) || urlExtension(text(row.storage_path));
  const mime = text(row.mime_type) || EXTENSION_MIME[ext] || 'application/octet-stream';
  const day = dayOf(row.document_date);
  const title = text(row.title) || (ext ? fileName.slice(0, -(ext.length + 1)) : fileName);
  return {
    id: `company-document:${lower(row.id)}`, parentId: driveCorporateNodeId(company.id, category), type: 'company-document',
    name: withExtension(driveName([day, title].filter(Boolean).join(' · '), 'Dokument'), ext), mime, kind: materialKind(mime, fileName),
    size: Number(row.size_bytes) || null, updatedAt: row.updated_at || row.created_at || null,
    version: `${row.updated_at || row.created_at || ''}|${text(row.storage_path)}`, thumbnailUrl: null, record: { type: 'finance', id: company.id },
    detail: [DRIVE_CORPORATE_CATEGORIES.find((entry) => entry.key === category)?.label || '', day ? plDate(day) : '', text(row.description)]
      .filter(Boolean).join(' · ').slice(0, 240),
    ...(company.manage ? { canDelete: true } : {}),
  };
}

/** Folder umowy stałej: „Tytuł — kontrahent”, zakończona — z dopiskiem. */
function agreementFolder(row: Row, company: FinanceCompany, count: number): DriveFolder {
  const kind = AGREEMENT_KINDS[text(row.kind)] || 'Umowa';
  const label = [text(row.title) || kind, text(row.counterparty_name)].filter(Boolean).join(' — ');
  return {
    id: driveAgreementsNodeId(company.id, lower(row.id)), parentId: driveAgreementsNodeId(company.id),
    name: driveName(text(row.status) === 'ended' ? `${label} (zakończona)` : label, kind), kind: 'agreement', count, ...(company.manage ? { upload: true } : {}),
  };
}

/** Plik umowy stałej (umowa, aneks, harmonogram…). */
function agreementFile(row: Row, contract: Row, company: FinanceCompany): DriveFile {
  const fileName = text(row.file_name) || 'plik';
  const ext = urlExtension(fileName) || urlExtension(text(row.storage_path));
  const mime = text(row.mime_type) || EXTENSION_MIME[ext] || 'application/octet-stream';
  return {
    id: `agreement-file:${lower(row.id)}`, parentId: driveAgreementsNodeId(company.id, lower(contract.id)), type: 'agreement-file',
    name: withExtension(driveName(ext ? fileName.slice(0, -(ext.length + 1)) : fileName, 'Plik umowy'), ext), mime, kind: materialKind(mime, fileName),
    size: Number(row.file_size) || null, updatedAt: row.created_at || null, version: `${row.created_at || ''}|${text(row.storage_path)}`, thumbnailUrl: null,
    record: { type: 'finance', id: company.id },
    detail: [AGREEMENT_KINDS[text(contract.kind)] || 'Umowa', text(contract.counterparty_name), text(contract.status) === 'ended' ? 'zakończona' : '']
      .filter(Boolean).join(' · '),
    ...(company.manage ? { canDelete: true } : {}),
  };
}

/** Dokumenty spółki firm (przed migracją 20261125150000 — pusto, reszta Finansów działa). */
async function corporateRows(ctx: NativeContext, ids: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await ctx.supabase.from('company_documents').select(CORPORATE_COLUMNS).in('my_company_id', ids).order('id').range(from, from + PAGE - 1);
    if (documentsMissing(error)) return [];
    check(error, 'Nie udało się pobrać dokumentów spółki.');
    rows.push(...((data || []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Dokumenty spółki i umowy stałe z plikami — tylko firmy z „Finanse — podgląd”. */
async function financeRecords(ctx: NativeContext, companies: FinanceCompany[]): Promise<FinanceRecords> {
  const ids = companies.filter((company) => company.finance).map((company) => company.id);
  if (!ids.length) return { corporate: [], agreements: [], agreementFiles: [], assets: [] };
  const [corporate, agreements, assets] = await Promise.all([
    corporateRows(ctx, ids),
    fetchAll((a, b) => ctx.supabase.from('finance_recurring_contracts').select(AGREEMENT_COLUMNS).in('my_company_id', ids).order('id').range(a, b),
      'Nie udało się pobrać umów stałych.'),
    assetRegisterRows(ctx, ids).catch((error) => {
      console.error('[native drive] asset register', error instanceof Error ? error.message : error);
      return [] as AssetRegisterRow[];
    }),
  ]);
  const contractIds = agreements.map((row) => String(row.id));
  const agreementFiles: Row[] = [];
  for (let i = 0; i < contractIds.length; i += CHUNK) {
    const part = contractIds.slice(i, i + CHUNK);
    agreementFiles.push(...await fetchAll((a, b) => ctx.supabase.from('finance_recurring_contract_files').select(AGREEMENT_FILE_COLUMNS).in('contract_id', part)
      .order('id').range(a, b), 'Nie udało się pobrać plików umów stałych.'));
  }
  return { corporate, agreements, agreementFiles, assets };
}

/** Rejestr majątku firmy (PDF i CSV) — wersja z treści wierszy (Finder pobiera plik od nowa po zmianie). */
function assetRegisterFiles(company: FinanceCompany, rows: AssetRegisterRow[]): DriveFile[] {
  const version = `v${ASSET_REGISTER_VERSION}|${sha12(JSON.stringify(rows))}`;
  const updatedAt = rows.reduce<string | null>((latest, row) => (row.updatedAt && (!latest || row.updatedAt > latest) ? row.updatedAt : latest), null);
  const parentId = driveAssetsNodeId(company.id);
  const pieces = rows.reduce((sum, row) => sum + row.quantity, 0);
  const detail = rows.length ? `${pieces} szt. sprzętu firmy` : 'Brak sprzętu przypisanego do firmy';
  const base = { parentId, size: null, updatedAt, thumbnailUrl: null, record: { type: 'finance' as const, id: company.id } };
  return [
    { ...base, id: `asset-register:${company.id}`, type: 'asset-register', name: driveName(`Rejestr majątku — ${company.name}.pdf`, 'Rejestr majątku.pdf'),
      mime: 'application/pdf', kind: 'pdf', version, detail: `${detail} · PDF` },
    { ...base, id: `asset-register-csv:${company.id}`, type: 'asset-register-csv', name: driveName(`Rejestr majątku — ${company.name}.csv`, 'Rejestr majątku.csv'),
      mime: 'text/csv', kind: materialKind('text/csv', 'rejestr.csv'), version, detail: `${detail} · CSV dla księgowej` },
  ];
}

/** Foldery Dokumentów spółki (kategorie) i Umów stałych (umowy, najpierw trwające) oraz ich pliki. */
function financeRecordsTree(companies: FinanceCompany[], records: FinanceRecords) {
  const folders: DriveFolder[] = [];
  const files: DriveFile[] = [];
  for (const company of companies.filter((entry) => entry.finance)) {
    const companyNode = driveFinanceNodeId(company.id);
    const corporate = records.corporate.filter((row) => lower(row.my_company_id) === company.id).map((row) => ({ row, file: corporateFile(row, company) }));
    folders.push({ id: driveCorporateNodeId(company.id), parentId: companyNode, name: DRIVE_FINANCE_CORPORATE, kind: 'corporate', count: corporate.length });
    for (const category of DRIVE_CORPORATE_CATEGORIES) {
      const id = driveCorporateNodeId(company.id, category.key);
      const own = corporate.filter((entry) => entry.file.parentId === id)
        .sort((a, b) => `${dayOf(a.row.document_date)}|${a.row.created_at}`.localeCompare(`${dayOf(b.row.document_date)}|${b.row.created_at}`));
      folders.push({ id, parentId: driveCorporateNodeId(company.id), name: category.label, kind: 'docgroup', count: own.length, ...(company.manage ? { upload: true } : {}) });
      files.push(...driveUniqueNames(own.map((entry) => entry.file)));
    }
    const contracts = records.agreements.filter((row) => lower(row.my_company_id) === company.id)
      .sort((a, b) => Number(text(a.status) === 'ended') - Number(text(b.status) === 'ended')
        || text(a.title).localeCompare(text(b.title), 'pl') || String(a.id).localeCompare(String(b.id)));
    const contractFolders: DriveFolder[] = [];
    let total = 0;
    for (const contract of contracts) {
      const own = records.agreementFiles.filter((row) => lower(row.contract_id) === lower(contract.id))
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
      total += own.length;
      contractFolders.push(agreementFolder(contract, company, own.length));
      files.push(...driveUniqueNames(own.map((row) => agreementFile(row, contract, company))));
    }
    folders.push({ id: driveAgreementsNodeId(company.id), parentId: companyNode, name: DRIVE_FINANCE_AGREEMENTS, kind: 'agreements', count: total },
      ...uniqueFolderNames(contractFolders));
    const assets = records.assets.filter((row) => row.companyId === company.id);
    folders.push({ id: driveAssetsNodeId(company.id), parentId: companyNode, name: DRIVE_FINANCE_ASSETS, kind: 'assets', count: 2 });
    files.push(...assetRegisterFiles(company, assets));
    folders.push({ id: driveClarifyNodeId(company.id), parentId: companyNode, name: DRIVE_FINANCE_CLARIFY, kind: 'clarify', count: 1 });
    files.push({
      id: `clarify-report:${company.id}`, parentId: driveClarifyNodeId(company.id), name: driveName(`Do wyjaśnienia — ${company.name}.pdf`, 'Do wyjaśnienia.pdf'),
      type: 'clarify-report', mime: 'application/pdf', kind: 'pdf', size: null, updatedAt: null, thumbnailUrl: null,
      version: `v${FINANCE_REPORT_VERSION}|${warsawDay.format(new Date())}`, record: { type: 'finance', id: company.id },
      detail: 'Otwarte sprawy firmy: miesiące, dokumenty, płatności, sprzęt — stan na dziś',
    });
  }
  return { folders, files };
}

/** Dokumenty spółki albo Umowy stałe firmy: folder działu, kategoria / umowa z plikami. */
async function financeRecordsListing(ctx: NativeContext, company: FinanceCompany, node: Extract<DriveNode, { section: 'finance' }>, root: DriveFolder): Promise<DriveListing> {
  if (!company.finance) fail('Dokumenty spółki, umowy stałe i majątek widać od poziomu „Finanse — podgląd” w tej firmie.', 403, { code: 'forbidden' });
  const tree = financeRecordsTree([company], await financeRecords(ctx, [company]));
  const self = companyFolder(company);
  if (node.area === 'assets' || node.area === 'clarify') {
    const leaf = tree.folders.find((entry) => entry.id === (node.area === 'assets' ? driveAssetsNodeId(company.id) : driveClarifyNodeId(company.id)));
    if (!leaf) fail('Nie znaleziono folderu Finansów.', 404);
    return { node: leaf, path: [root, self, leaf], folders: [], files: tree.files.filter((file) => file.parentId === leaf.id), ...EMPTY };
  }
  const areaId = node.area === 'corporate' ? driveCorporateNodeId(company.id) : driveAgreementsNodeId(company.id);
  const area = tree.folders.find((entry) => entry.id === areaId);
  if (!area) fail('Nie znaleziono folderu Finansów.', 404);
  const leafId = node.category ? driveCorporateNodeId(company.id, node.category) : node.contractId ? driveAgreementsNodeId(company.id, node.contractId) : null;
  if (!leafId) return { node: area, path: [root, self, area], folders: tree.folders.filter((entry) => entry.parentId === area.id), files: [], ...EMPTY };
  const leaf = tree.folders.find((entry) => entry.id === leafId);
  if (!leaf) fail('Nie znaleziono tej umowy albo nie masz do niej dostępu.', 404);
  const files = tree.files.filter((file) => file.parentId === leaf.id).reverse();
  return { node: leaf, path: [root, self, area, leaf], folders: [], files, ...EMPTY, canUpload: company.manage };
}

// MARK: Finanse — Zamknięcie miesiąca i Do wyjaśnienia

type ReportsModule = typeof import('./financeReports.server');
type ReportDocument = import('./financeReports.server').ReportDocument;
type ReportPayment = import('./financeReports.server').ReportPayment;
type ReportCheck = import('./financeReports.server').ReportCheck;

const monthRange = (year: number, month: number) => ({
  start: `${year}-${pad2(month)}-01`, end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
});
/** Odmiana po liczbie: 1 płatność, 2 płatności, 5 płatności. */
const plural = (count: number, one: string, few: string, many: string) => {
  const tens = count % 100;
  const ones = count % 10;
  return `${count} ${count === 1 ? one : ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? few : many}`;
};
const numberOrNull = (value: unknown) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

/** Dokumenty spoza KSeF bez danych (sprzedawca „Do uzupełnienia” albo bez kwoty) — miesiąc albo wszystkie (najnowsze 200). */
async function incompleteCosts(ctx: NativeContext, companyId: string, range: { start: string; end: string } | null): Promise<ReportDocument[]> {
  let query = ctx.supabase.from('external_invoices').select('id,invoice_number,label,seller_name,invoice_date,amount_gross,currency,notes')
    .eq('my_company_id', companyId).or(`seller_name.eq."${COST_PLACEHOLDER}",amount_gross.is.null`);
  if (range) query = query.gte('invoice_date', range.start).lte('invoice_date', range.end);
  const { data, error } = await query.order('invoice_date', { ascending: false }).limit(200);
  check(error, 'Nie udało się pobrać dokumentów spoza KSeF.');
  return ((data || []) as Row[]).map((row) => ({
    number: text(row.invoice_number) || text(row.label), counterparty: text(row.seller_name), date: dayOf(row.invoice_date),
    amount: numberOrNull(row.amount_gross), currency: text(row.currency).toUpperCase() || 'PLN',
    note: text(row.seller_name) === COST_PLACEHOLDER ? 'brak danych dokumentu' : 'brak kwoty',
  }));
}

/** Dane „Zamknięcia miesiąca”: przekazanie księgowej (jak „Dla księgowej”), dokumenty do uzupełnienia, XML z KSeF, zamknięcie. */
async function monthCloseReport(ctx: NativeContext, company: FinanceCompany, year: number, month: number) {
  const range = monthRange(year, month);
  let saldeo: Awaited<ReturnType<typeof import('@/lib/native/financeSaldeo').saldeoMonth>> | null = null;
  let partial = '';
  try {
    const saldeoModule = await import('@/lib/native/financeSaldeo');
    saldeo = await saldeoModule.saldeoMonth(ctx, { company: company.id, month, year });
  } catch (error) {
    partial = `Nie udało się odczytać danych przekazania księgowej (${error instanceof Error ? error.message : 'błąd serwera'}) — lista jest niepełna.`;
  }
  const [periods, incomplete, ksef] = await Promise.all([
    financePeriods(ctx, [company], [year]),
    incompleteCosts(ctx, company.id, range),
    ctx.supabase.from('ksef_invoices').select('id', { count: 'exact', head: true }).eq('my_company_id', company.id).eq('invoice_type', 'received')
      .is('xml_content', null).gte('issue_date', range.start).lte('issue_date', range.end),
  ]);
  const period = periods.get(periodKey(company.id, year, month));
  const ksefWithoutXml = ksef.count || 0;
  const payments: ReportPayment[] = (saldeo?.unlinked || []).map((bank) => ({
    date: dayOf(bank.date), amount: numberOrNull(bank.amount), currency: text(bank.currency).toUpperCase() || 'PLN', counterparty: text(bank.counterparty),
    reference: text(bank.reference), note: text(bank.note), acknowledged: bank.acknowledged === true,
  }));
  const open = payments.filter((payment) => !payment.acknowledged);
  const pending: ReportDocument[] = (saldeo?.documents || []).filter((document) => document.state === 'saldeo').map((document) => ({
    number: text(document.number), counterparty: text(document.counterparty), date: dayOf(document.date), amount: numberOrNull(document.amount),
    currency: text(document.currency).toUpperCase() || 'PLN', note: text(document.sourceLabel),
  }));
  const followups: ReportPayment[] = (saldeo?.followups || []).map((item) => ({
    date: dayOf(item.date), amount: numberOrNull(item.amount), currency: text(item.currency).toUpperCase() || 'PLN', counterparty: text(item.counterparty),
    reference: text(item.reference), note: [text(item.status), text(item.note)].filter(Boolean).join(' · '), acknowledged: false,
  }));
  const counts = saldeo?.counts;
  const unknown = 'brak danych przekazania';
  const checks: ReportCheck[] = [
    { label: 'Wyciąg bankowy za miesiąc', state: !counts ? 'info' : counts.statements > 0 ? 'ok' : 'todo',
      detail: !counts ? unknown : counts.statements > 0 ? `Dodano: ${counts.statements}` : 'Brak wyciągu — dodaj w Centrum finansów → Wyciągi.' },
    { label: 'Płatności mają dokumenty', state: !saldeo ? 'info' : open.length ? 'todo' : 'ok',
      detail: !saldeo ? unknown : open.length
        ? `${plural(open.length, 'płatność', 'płatności', 'płatności')} bez dokumentu${payments.length > open.length ? `, ${payments.length - open.length} świadomie bez dokumentu` : ''}`
        : payments.length ? `${plural(payments.length, 'płatność', 'płatności', 'płatności')} świadomie bez dokumentu` : 'Wszystkie płatności mają dokument albo go nie wymagają.' },
    { label: 'Dokumenty spoza KSeF uzupełnione', state: incomplete.length ? 'todo' : 'ok',
      detail: incomplete.length ? `${plural(incomplete.length, 'dokument', 'dokumenty', 'dokumentów')} do uzupełnienia (Finanse → Dokumenty spoza KSeF)`
        : 'Sprzedawca, numer i kwota są wszędzie.' },
    { label: 'Faktury z KSeF z pobranym XML', state: ksefWithoutXml ? 'info' : 'ok',
      detail: ksefWithoutXml ? `${plural(ksefWithoutXml, 'faktura kosztowa', 'faktury kosztowe', 'faktur kosztowych')} bez XML — pobierz w KSeF` : 'Wszystkie faktury z KSeF mają XML.' },
    { label: 'Dokumenty przekazane księgowej', state: !counts ? 'info' : counts.pending ? 'todo' : 'ok',
      detail: !counts ? unknown : counts.pending ? `Czeka ${counts.pending}, przekazano ${counts.sent}` : `Przekazano ${counts.sent}${saldeo?.latestHandoff?.deliveredAt ? ` (ostatnio ${plDate(dayOf(saldeo.latestHandoff.deliveredAt))})` : ''}` },
    { label: 'Bez błędów przekazania', state: !saldeo ? 'info' : saldeo.blockers.length ? 'todo' : 'ok',
      detail: !saldeo ? unknown : saldeo.blockers.length ? `${plural(saldeo.blockers.length, 'błąd', 'błędy', 'błędów')} do poprawienia — szczegóły niżej` : 'Brak błędów.' },
    { label: 'Pytania księgowej', state: !saldeo ? 'info' : followups.length ? 'todo' : 'ok',
      detail: !saldeo ? unknown : followups.length ? plural(followups.length, 'otwarte pytanie', 'otwarte pytania', 'otwartych pytań') : 'Brak otwartych pytań.' },
    { label: 'Miesiąc zamknięty', state: period?.locked ? 'ok' : 'todo',
      detail: period?.locked ? `Zamknięty${period.lockedAt ? ` ${plDate(dayOf(period.lockedAt))}` : ''}${period.lockedBy ? ` — ${period.lockedBy}` : ''}`
        : 'Zamknij w Centrum finansów → Zamknięcie miesięcy po przekazaniu księgowej.' },
  ];
  return {
    company: company.name, year, month, checks, payments, incomplete, pending, followups,
    blockers: (saldeo?.blockers || []).map(String), warnings: (saldeo?.warnings || []).map(String), partial,
  };
}

/** Sprzęt bez ustalonej własności (wszystkie firmy, partie widoczne dla pracownika) — sztuki w Magazynie minus opisane partie. */
async function unassignedEquipment(ctx: NativeContext) {
  const items = await fetchAll((a, b) => ctx.supabase.from('equipment_items').select('id,name,brand,model,cable_stock_quantity').is('deleted_at', null)
    .order('name').range(a, b), 'Nie udało się pobrać sprzętu.');
  const units = await fetchAll((a, b) => ctx.supabase.from('equipment_units').select('equipment_id').order('id').range(a, b), 'Nie udało się pobrać jednostek sprzętu.');
  // Partie widoczne dla pracownika (RLS); przed migracją 20261125170000 — brak partii.
  const acquisitions: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await ctx.supabase.from('equipment_acquisitions').select('equipment_id,quantity').order('id').range(from, from + PAGE - 1);
    if (documentsMissing(error)) break;
    check(error, 'Nie udało się pobrać własności sprzętu.');
    acquisitions.push(...((data || []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  const unitCount = new Map<string, number>();
  for (const row of units) unitCount.set(lower(row.equipment_id), (unitCount.get(lower(row.equipment_id)) || 0) + 1);
  const assigned = new Map<string, number>();
  for (const row of acquisitions) assigned.set(lower(row.equipment_id), (assigned.get(lower(row.equipment_id)) || 0) + (Number(row.quantity) || 0));
  return items.map((item) => {
    const id = lower(item.id);
    const total = unitCount.get(id) || Math.max(0, Number(item.cable_stock_quantity) || 0);
    const name = [text(item.name) || 'Sprzęt', [text(item.brand), text(item.model)].filter(Boolean).join(' ')].filter(Boolean).join(' — ');
    return { equipment: name, total, quantity: Math.max(0, total - (assigned.get(id) || 0)) };
  }).filter((row) => row.quantity > 0);
}

/** Dane „Do wyjaśnienia”: niezamknięte miesiące, dokumenty do uzupełnienia, pytania księgowej, XML z KSeF, sprzęt. */
async function clarifyReport(ctx: NativeContext, company: FinanceCompany, allCompanies: FinanceCompany[]) {
  const today = warsawDay.format(new Date());
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  const [periods, incomplete, ksef, followups, register, unassigned] = await Promise.all([
    financePeriods(ctx, [company], [currentYear - 1, currentYear]),
    incompleteCosts(ctx, company.id, null),
    ctx.supabase.from('ksef_invoices').select('id,invoice_number,seller_name,issue_date,gross_amount,currency').eq('my_company_id', company.id)
      .eq('invoice_type', 'received').is('xml_content', null).order('issue_date', { ascending: false }).limit(200),
    ctx.supabase.from('accounting_document_followups').select('id,period_month,period_year,acknowledged_at,transaction_snapshot').eq('my_company_id', company.id)
      .eq('active', true).order('period_year', { ascending: false }).order('period_month', { ascending: false }).limit(200),
    assetRegisterRows(ctx, [company.id]).catch(() => [] as AssetRegisterRow[]),
    unassignedEquipment(ctx).catch(() => [] as Array<{ equipment: string; total: number; quantity: number }>),
  ]);
  const openMonths: Array<{ year: number; month: number; handedOverAt: string | null }> = [];
  for (let back = 1; back <= 12; back += 1) {
    const date = new Date(Date.UTC(currentYear, currentMonth - 1 - back, 1));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const period = periods.get(periodKey(company.id, year, month));
    if (period && !period.locked) openMonths.push({ year, month, handedOverAt: period.handedOverAt });
  }
  const ownershipLabels: Record<string, string> = { asset: 'Środek trwały', equipment: 'Wyposażenie', leased: 'Leasing / najem' };
  const unassignedTotal = unassigned.reduce((sum, row) => sum + row.quantity, 0);
  return {
    company: company.name,
    openMonths,
    incomplete,
    ksefWithoutXml: ((ksef.data || []) as Row[]).map((row) => ({
      number: text(row.invoice_number), counterparty: text(row.seller_name), date: dayOf(row.issue_date), amount: numberOrNull(row.gross_amount),
      currency: text(row.currency).toUpperCase() || 'PLN',
    })),
    followups: ((followups.data || []) as Row[]).map((row) => {
      const snapshot = (row.transaction_snapshot && typeof row.transaction_snapshot === 'object' ? row.transaction_snapshot : {}) as Row;
      return {
        date: dayOf(snapshot.transaction_date), amount: numberOrNull(snapshot.amount) === null ? null : Math.abs(Number(snapshot.amount)),
        currency: text(snapshot.currency).toUpperCase() || 'PLN', counterparty: text(snapshot.counterparty_name), reference: text(snapshot.reference_number),
        note: text(snapshot.accounting_note), acknowledged: Boolean(row.acknowledged_at), year: Number(row.period_year) || undefined, month: Number(row.period_month) || undefined,
      };
    }),
    undocumented: register.filter((row) => !row.document && row.ownership !== 'private').map((row) => ({
      equipment: [row.equipment, [row.brand, row.model].filter(Boolean).join(' ')].filter(Boolean).join(' — '), quantity: row.quantity,
      ownership: ownershipLabels[row.ownership] || row.ownership, note: row.documentNote,
    })),
    unassigned: unassigned.slice(0, 300),
    unassignedTotal,
    unassignedNote: [
      unassigned.length > 300 ? `Pokazano 300 z ${unassigned.length} pozycji.` : '',
      allCompanies.some((entry) => !entry.finance) ? 'Liczone z partii firm, do których masz dostęp.' : '',
    ].filter(Boolean).join(' '),
  };
}

/** Kopia w `finance-documents` (zapis i podpis konta serwisowego); za pierwszym razem plik powstaje z `build`. */
async function financeCached(path: string, name: string, mode: 'preview' | 'download', contentType: string, build: () => Promise<Buffer | string>) {
  const admin = createSupabaseAdminClient();
  const sign = () => admin.storage.from(FINANCE_BUCKET).createSignedUrl(path, SIGNED_TTL, mode === 'download' ? { download: name } : undefined);
  let { data } = await sign();
  if (!data?.signedUrl) {
    const body = await build();
    const { error } = await admin.storage.from(FINANCE_BUCKET).upload(path, typeof body === 'string' ? Buffer.from(body, 'utf8') : body, { contentType, upsert: true });
    if (error) {
      console.error('[native drive] finance cache', error.message);
      if (/bucket not found/i.test(error.message)) fail(FINANCE_PENDING, 503, { code: 'pending' });
      fail('Nie udało się przygotować pliku. Spróbuj ponownie za chwilę.', 500);
    }
    ({ data } = await sign());
  }
  if (!data?.signedUrl) fail('Nie udało się przygotować pliku. Spróbuj ponownie za chwilę.', 500);
  return data.signedUrl;
}

/** Środowisko KSeF firmy (kod QR wizualizacji) — jak wydruk faktury CRM. */
async function ksefEnvironment(companyId: string): Promise<'test' | 'production'> {
  const { data } = await createSupabaseAdminClient().from('ksef_credentials').select('is_test_environment').eq('my_company_id', companyId)
    .eq('is_active', true).order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return (data as Row | null)?.is_test_environment ? 'test' : 'production';
}

/** Adres pliku Finansów: wiersz czyta token pracownika (RLS), firma musi być w jego Finansach (bank i podatki — z „Podglądem finansów”). */
async function financeDownload(ctx: NativeContext, ref: { type: DriveFileType; id: string }, mode: 'preview' | 'download'): Promise<DriveDownload> {
  const s = ctx.supabase;
  const companies = await financeCompanies(ctx);
  const company = (value: unknown) => companies.find((entry) => entry.id === lower(value));
  // Dostęp sprawdza odczyt wiersza tokenem pracownika (RLS) i firma w jego Finansach — adres podpisuje konto serwisowe.
  const signed = async (bucket: string, path: string, name: string) => {
    const { data, error } = await createSupabaseAdminClient().storage.from(bucket)
      .createSignedUrl(path, SIGNED_TTL, mode === 'download' ? { download: name } : undefined);
    if (error || !data?.signedUrl) fail('Pliku nie ma już w magazynie.', 410, { code: 'missing' });
    return data.signedUrl;
  };
  if (ref.type === 'sales-invoice') {
    const { data, error } = await s.from('invoices').select(SALES_COLUMNS).eq('id', ref.id).maybeSingle();
    check(error, 'Nie udało się pobrać faktury.');
    const row = data as Row | null;
    const doc = row && company(row.my_company_id) ? salesDoc(row) : null;
    if (!row || !doc) fail(FINANCE_MISSING, 404);
    const path = invoiceStoragePath(row.pdf_url);
    if (path) return { url: await signed('event-files', path, doc.file.name), name: doc.file.name, mime: 'application/pdf', size: null };
    const print = await import('@/lib/invoices/print/renderInvoicePdf.server');
    const url = await financeCached(`${doc.companyId}/invoices/${ref.id}-${sha12(print.invoicePrintRevision(row))}.pdf`, doc.file.name, mode, 'application/pdf',
      async () => {
        const admin = createSupabaseAdminClient();
        const { data: invoice, error: printError } = await admin.from('invoices').select(print.INVOICE_PRINT_SELECT).eq('id', ref.id).maybeSingle();
        if (printError || !invoice) fail('Nie udało się odczytać faktury do wydruku.', 500);
        try {
          return (await print.renderInvoicePdf(await print.buildInvoicePrintDocument(admin, invoice as any))).pdf;
        } catch (error) {
          if (error instanceof print.InvoicePrintError) fail(error.message, 422);
          throw error;
        }
      });
    return { url, name: doc.file.name, mime: 'application/pdf', size: null };
  }
  if (ref.type === 'ksef-invoice' || ref.type === 'ksef-xml') {
    const { data, error } = await s.from('ksef_invoices').select(KSEF_DETAIL_COLUMNS).eq('id', ref.id).maybeSingle();
    check(error, 'Nie udało się pobrać faktury z KSeF.');
    const row = data as Row | null;
    if (!row || !company(row.my_company_id)) fail(FINANCE_MISSING, 404);
    const xml = typeof row.xml_content === 'string' ? row.xml_content : '';
    let inSales = false;
    if (ref.type === 'ksef-invoice' && text(row.invoice_type) === 'issued' && row.invoice_id) {
      const { data: invoice, error: invoiceError } = await s.from('invoices').select(SALES_COLUMNS).eq('id', row.invoice_id).maybeSingle();
      check(invoiceError, 'Nie udało się pobrać faktury.');
      inSales = Boolean(invoice && lower((invoice as Row).my_company_id) === lower(row.my_company_id) && salesDoc(invoice as Row));
    }
    const doc = ksefDocs(row, Boolean(xml), inSales).find((entry) => entry.file.id === `${ref.type}:${ref.id}`);
    if (!doc) fail(FINANCE_MISSING, 404);
    if (ref.type === 'ksef-xml') {
      const url = await financeCached(`${doc.companyId}/ksef/${ref.id}-${sha12(xml)}.xml`, doc.file.name, mode, 'application/xml', async () => xml);
      return { url, name: doc.file.name, mime: 'application/xml', size: null };
    }
    const visualization = await import('./ksefVisualization.server');
    const source = xml || JSON.stringify([row.invoice_number, row.seller_name, row.buyer_name, row.gross_amount, row.net_amount, row.invoice_items, row.synced_at]);
    const url = await financeCached(`${doc.companyId}/ksef/${ref.id}-v${KSEF_VISUALIZATION_VERSION}-${sha12(source)}.pdf`, doc.file.name, mode,
      'application/pdf', async () => visualization.renderKsefVisualizationPdf(row, await ksefEnvironment(doc.companyId)));
    return { url, name: doc.file.name, mime: 'application/pdf', size: null };
  }
  if (ref.type === 'cost-document') {
    const { data, error } = await s.from('external_invoices').select(EXTERNAL_COLUMNS).eq('id', ref.id).maybeSingle();
    check(error, 'Nie udało się pobrać dokumentu.');
    const row = data as Row | null;
    const doc = row && company(row.my_company_id) ? externalDoc(row) : null;
    if (!row || !doc) fail(FINANCE_MISSING, 404);
    return { url: await signed('external-invoices', text(row.file_url), doc.file.name), name: doc.file.name, mime: doc.file.mime, size: null };
  }
  if (ref.type === 'bank-statement') {
    const { data, error } = await s.from('bank_statements').select(STATEMENT_COLUMNS).eq('id', ref.id).maybeSingle();
    check(error, 'Nie udało się pobrać wyciągu.');
    const row = data as Row | null;
    const doc = row && company(row.my_company_id)?.finance ? statementDoc(row) : null;
    if (!row || !doc) fail(FINANCE_MISSING, 404);
    return { url: await signed('bank-statements', text(row.file_storage_path), doc.file.name), name: doc.file.name, mime: doc.file.mime, size: null };
  }
  if (ref.type === 'month-close') {
    const [companyId, period] = ref.id.split(':');
    const owner = company(companyId);
    const year = Number(period.slice(0, 4));
    const month = Number(period.slice(5, 7));
    if (!owner?.finance || !(year >= 2000 && year <= 2100) || !(month >= 1 && month <= 12)) fail(FINANCE_MISSING, 404);
    const report = await monthCloseReport(ctx, owner, year, month);
    const name = driveName(`Zamknięcie miesiąca — ${DRIVE_MONTHS[month - 1]} ${year}.pdf`, 'Zamknięcie miesiąca.pdf');
    const reports: ReportsModule = await import('./financeReports.server');
    const url = await financeCached(`${owner.id}/close/${period}-v${FINANCE_REPORT_VERSION}-${sha12(JSON.stringify(report))}.pdf`, name, mode, 'application/pdf',
      async () => reports.renderMonthClosePdf(report));
    return { url, name, mime: 'application/pdf', size: null };
  }
  if (ref.type === 'clarify-report') {
    const owner = company(ref.id);
    if (!owner?.finance) fail(FINANCE_MISSING, 404);
    const report = await clarifyReport(ctx, owner, companies);
    const name = driveName(`Do wyjaśnienia — ${owner.name}.pdf`, 'Do wyjaśnienia.pdf');
    const reports: ReportsModule = await import('./financeReports.server');
    const url = await financeCached(`${owner.id}/clarify/v${FINANCE_REPORT_VERSION}-${sha12(JSON.stringify(report))}.pdf`, name, mode, 'application/pdf',
      async () => reports.renderClarifyPdf(report));
    return { url, name, mime: 'application/pdf', size: null };
  }
  if (ref.type === 'asset-register' || ref.type === 'asset-register-csv') {
    const owner = company(ref.id);
    if (!owner?.finance) fail(FINANCE_MISSING, 404);
    const rows = await assetRegisterRows(ctx, [owner.id]);
    const [file] = assetRegisterFiles(owner, rows).filter((entry) => entry.type === ref.type);
    const hash = sha12(`${ASSET_REGISTER_VERSION}|${JSON.stringify(rows)}`);
    if (ref.type === 'asset-register-csv') {
      const register = await import('@/lib/assets/assetRegister.server');
      const url = await financeCached(`${owner.id}/assets/register-${hash}.csv`, file.name, mode, 'text/csv', async () => register.assetRegisterCsv(rows));
      return { url, name: file.name, mime: 'text/csv', size: null };
    }
    const register = await import('@/lib/assets/assetRegister.server');
    const url = await financeCached(`${owner.id}/assets/register-${hash}.pdf`, file.name, mode, 'application/pdf',
      async () => register.renderAssetRegisterPdf(owner.name, rows));
    return { url, name: file.name, mime: 'application/pdf', size: null };
  }
  if (ref.type === 'company-document') {
    const { data, error } = await s.from('company_documents').select(CORPORATE_COLUMNS).eq('id', ref.id).maybeSingle();
    if (documentsMissing(error)) fail(FINANCE_MISSING, 404);
    check(error, 'Nie udało się pobrać dokumentu spółki.');
    const row = data as Row | null;
    const owner = row ? company(row.my_company_id) : undefined;
    if (!row || !owner?.finance) fail(FINANCE_MISSING, 404);
    const file = corporateFile(row, owner);
    return { url: await signed(CORPORATE_BUCKET, text(row.storage_path), file.name), name: file.name, mime: file.mime, size: file.size };
  }
  if (ref.type === 'agreement-file') {
    const { data, error } = await s.from('finance_recurring_contract_files').select(AGREEMENT_FILE_COLUMNS).eq('id', ref.id).maybeSingle();
    check(error, 'Nie udało się pobrać pliku umowy.');
    const row = data as Row | null;
    if (!row) fail(FINANCE_MISSING, 404);
    const { data: contract, error: contractError } = await s.from('finance_recurring_contracts').select(AGREEMENT_COLUMNS).eq('id', row.contract_id).maybeSingle();
    check(contractError, 'Nie udało się pobrać umowy.');
    const owner = contract ? company((contract as Row).my_company_id) : undefined;
    if (!contract || !owner?.finance) fail(FINANCE_MISSING, 404);
    const file = agreementFile(row, contract as Row, owner);
    return { url: await signed(AGREEMENTS_BUCKET, text(row.storage_path), file.name), name: file.name, mime: file.mime, size: file.size };
  }
  const { data: file, error } = await s.from('finance_declaration_files').select(DECLARATION_FILE_COLUMNS).eq('id', ref.id).maybeSingle();
  check(error, 'Nie udało się pobrać pliku deklaracji.');
  if (!file) fail(FINANCE_MISSING, 404);
  const { data: declaration, error: declarationError } = await s.from('finance_declarations').select(DECLARATION_COLUMNS)
    .eq('id', (file as Row).declaration_id).maybeSingle();
  check(declarationError, 'Nie udało się pobrać deklaracji.');
  const doc = declaration && company((declaration as Row).my_company_id)?.finance ? taxDoc(file as Row, declaration as Row) : null;
  if (!doc) fail(FINANCE_MISSING, 404);
  return { url: await signed('finance-declarations', text((file as Row).storage_path), doc.file.name), name: doc.file.name, mime: doc.file.mime, size: doc.file.size };
}

// MARK: Programy — instalatory aplikacji Mavinci (`yarn dmg`, `src/lib/native/desktopRelease.ts`)

/** Najnowszy instalator aplikacji na Maca (brak opublikowanej wersji — pusty folder). */
async function programFiles(): Promise<DriveFile[]> {
  const release = await latestDesktopRelease('mac');
  if (!release) return [];
  return [{
    id: 'program:mac', parentId: 'programs', name: driveName(`Mavinci ${release.version} — macOS.dmg`, 'Mavinci — macOS.dmg'), type: 'program',
    mime: 'application/x-apple-diskimage', kind: 'archive', size: release.dmg.size, updatedAt: release.publishedAt,
    version: `${release.build}|${release.dmg.sha256}`, thumbnailUrl: null, record: null,
    detail: `Instalator aplikacji na Maca · wersja ${release.version} (${release.build}) · macOS ${release.minimumSystem} lub nowszy`,
  }];
}

// MARK: Odczyt

const EMPTY: Pick<DriveListing, 'canUpload' | 'colors'> = { canUpload: false, colors: [] };

export async function driveList(ctx: NativeContext, nodeValue: string): Promise<DriveListing> {
  const node = parseDriveNode(nodeValue);
  if (!node) fail('Nieprawidłowy folder Dysku.', 400);
  if (node.section === 'brand') {
    const brand = await brandListing(ctx, node.companyId);
    return { node: brand.node, path: [], folders: [], files: brand.files, canUpload: false, colors: brand.colors };
  }
  if (node.section === 'employees') return employeesListing(ctx, node);
  if (node.section === 'finance') return financeListing(ctx, node);
  if (node.section === 'programs') {
    const root = sectionFolder('programs');
    return { node: root, path: [root], folders: [], files: await programFiles(), ...EMPTY };
  }
  if (node.section === 'warehouse') {
    const info = requireSection(ctx, 'warehouse');
    const catalog = await warehouseCatalog(ctx);
    const root = sectionFolder('warehouse');
    if (node.equipmentId) {
      const item = catalog.items.find((entry) => entry.id === node.equipmentId);
      if (!item) fail('Nie znaleziono sprzętu.', 404);
      const self = equipmentNode(item);
      const path = [root, ...(item.categoryId ? warehousePath(catalog, item.categoryId) : [{ ...NONE_NODE }]), self];
      return { node: self, path, folders: [], files: await equipmentFiles(ctx, item), canUpload: info.canUpload, colors: [] };
    }
    if (node.uncategorized) {
      return { node: NONE_NODE, path: [root, NONE_NODE], folders: warehouseChildren(catalog, 'warehouse:none'), files: [], ...EMPTY };
    }
    if (node.categoryId) {
      const category = catalog.categories.get(node.categoryId);
      if (!category) fail('Nie znaleziono kategorii.', 404);
      const self = categoryNode(category, catalog.counts.get(category.id) || 0);
      return { node: self, path: [root, ...warehousePath(catalog, category.id)], folders: warehouseChildren(catalog, self.id), files: [], ...EMPTY };
    }
    return { node: root, path: [root], folders: warehouseChildren(catalog, 'warehouse'), files: [], ...EMPTY };
  }
  requireSection(ctx, node.section);
  const tree = documentTree(node.section, await DOCUMENT_LOADERS[node.section](ctx));
  const root = sectionFolder(node.section);
  const yearNode = node.year !== null ? tree.folders.find((folder) => folder.id === `${node.section}:${node.year}`) : null;
  if (node.year !== null && node.month !== null) {
    const id = monthId(node.section, node.year, node.month);
    const monthNode = tree.folders.find((folder) => folder.id === id)
      || { id, parentId: `${node.section}:${node.year}`, name: driveMonthName(node.month), kind: 'month' as const, count: 0 };
    const files = tree.files.filter((file) => file.parentId === id).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .map(({ date: _date, ...file }) => file);
    const year = yearNode || { id: `${node.section}:${node.year}`, parentId: node.section, name: String(node.year), kind: 'year' as const, count: 0 };
    return { node: monthNode, path: [root, year, monthNode], folders: [], files, ...EMPTY };
  }
  if (node.year !== null) {
    const year = yearNode || { id: `${node.section}:${node.year}`, parentId: node.section, name: String(node.year), kind: 'year' as const, count: 0 };
    const folders = tree.folders.filter((folder) => folder.parentId === year.id).sort((a, b) => b.id.localeCompare(a.id));
    return { node: year, path: [root, year], folders, files: [], ...EMPTY };
  }
  const folders = tree.folders.filter((folder) => folder.parentId === node.section).sort((a, b) => b.name.localeCompare(a.name));
  return { node: root, path: [root], folders, files: [], ...EMPTY };
}

/** Księga znaku każdej marki z dostępem do Materiałów, która ma folder „Logotypy i księga znaku” (Finder: „Z księgi znaku”). */
async function brandSync(ctx: NativeContext): Promise<{ brands: DriveBrandNode[]; files: DriveFile[] }> {
  const companies = await materialCompanies(ctx);
  if (!companies.length) return { brands: [], files: [] };
  const { data, error } = await ctx.supabase.from('material_folders').select('id,company_id')
    .in('company_id', companies.map((company) => company.id)).eq('system_key', 'brand');
  check(error, 'Nie udało się pobrać folderów Materiałów.');
  const folders = new Map<string, string>();
  for (const row of (data || []) as Row[]) if (!folders.has(String(row.company_id))) folders.set(String(row.company_id), String(row.id));
  const brands: DriveBrandNode[] = [];
  const files: DriveFile[] = [];
  for (const company of companies) {
    const materialFolderId = folders.get(company.id);
    if (!materialFolderId) continue;
    const listing = await brandListing(ctx, company.id);
    brands.push({ companyId: company.id, companyName: company.name, materialFolderId, colors: listing.colors });
    files.push(...listing.files);
  }
  return { brands, files };
}

/** Całe drzewo działów Finansów, Ofert, Kalkulacji, Umów, Magazynu i Pracowników oraz księgi znaku marek naraz (Finder trzyma kopię i porównuje wersje). */
export async function driveSync(ctx: NativeContext): Promise<DriveSync> {
  const cursor = new Date().toISOString();
  // Błąd odczytu dostępu do finansów przerywa synchronizację — Finder zostaje przy poprzedniej kopii (nie usuwa Finansów).
  const companies = await financeCompanies(ctx);
  const sections = driveSections(ctx, companies.length > 0);
  const available = new Set(sections.filter((section) => section.available).map((section) => section.key));
  const folders: DriveFolder[] = [];
  const files: DriveFile[] = [];
  if (companies.length) {
    const [tree, records] = await Promise.all([
      financeDocs(ctx, companies).then(async (docs) => financeTree(companies, docs, await financePeriods(ctx, companies, financeYears(docs)))),
      financeRecords(ctx, companies).then((rows) => financeRecordsTree(companies, rows)),
    ]);
    folders.push(sectionFolder('finance'), ...tree.folders, ...records.folders);
    files.push(...tree.files.map(({ date: _date, ...file }) => file), ...records.files);
  }
  for (const section of ['offers', 'calculations', 'contracts'] as const) {
    if (!available.has(section)) continue;
    const tree = documentTree(section, await DOCUMENT_LOADERS[section](ctx));
    folders.push(sectionFolder(section), ...tree.folders);
    files.push(...tree.files.map(({ date: _date, ...file }) => file));
  }
  if (available.has('warehouse')) {
    const catalog = await warehouseCatalog(ctx);
    folders.push(sectionFolder('warehouse'));
    const queue = ['warehouse'];
    const equipment: Equipment[] = [];
    while (queue.length) {
      const parent = queue.shift()!;
      for (const folder of warehouseChildren(catalog, parent)) {
        folders.push(folder);
        if (folder.kind === 'equipment') {
          const item = catalog.items.find((entry) => `warehouse:item:${entry.id}` === folder.id);
          if (item) equipment.push({ ...item, name: folder.name });
        } else queue.push(folder.id);
      }
    }
    // Pliki całego magazynu naraz (zamiast zapytań dla każdej pozycji).
    const ids = equipment.map((item) => item.id);
    const images: Row[] = [];
    const attachments: Row[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK);
      images.push(...await fetchAll((a, b) => ctx.supabase.from('equipment_images').select('id,equipment_id,image_url,title,is_primary,sort_order,created_at,updated_at')
        .in('equipment_id', part).order('sort_order').order('created_at').range(a, b), 'Nie udało się pobrać zdjęć sprzętu.'));
      attachments.push(...await fetchAll((a, b) => ctx.supabase.from('equipment_files').select('id,equipment_id,file_name,file_path,file_url,file_size,mime_type,created_at,updated_at')
        .in('equipment_id', part).order('created_at').range(a, b), 'Nie udało się pobrać plików sprzętu.'));
    }
    for (const item of equipment) {
      files.push(...equipmentFilesFrom(item, images.filter((row) => row.equipment_id === item.id), attachments.filter((row) => row.equipment_id === item.id)));
    }
  }
  if (available.has('employees')) {
    const employees = await employeesSync(ctx);
    folders.push(...employees.folders);
    files.push(...employees.files);
  }
  const brand = available.has('materials') ? await brandSync(ctx) : { brands: [], files: [] };
  files.push(...brand.files);
  folders.push(sectionFolder('programs'));
  files.push(...await programFiles());
  return { cursor, sections, folders, files, brands: brand.brands };
}

/** To samo co `equipmentFiles`, z wierszy pobranych wcześniej (synchronizacja Findera). */
function equipmentFilesFrom(item: Equipment, images: Row[], attachments: Row[]): DriveFile[] {
  const parentId = `warehouse:item:${item.id}`;
  const record = { type: 'equipment' as const, id: item.id };
  const out: DriveFile[] = [];
  images.forEach((row, index) => {
    const url = text(row.image_url);
    if (!url) return;
    const ext = urlExtension(url) || 'jpg';
    out.push({
      id: `equipment-image:${row.id}`, parentId,
      name: withExtension(driveName(text(row.title).replace(/\.[A-Za-z0-9]{2,5}$/, '') || `Zdjęcie ${index + 1}`, `Zdjęcie ${index + 1}`), ext),
      type: 'equipment-image', mime: EXTENSION_MIME[ext] || 'image/jpeg', kind: 'image', size: null, updatedAt: row.updated_at || row.created_at || null,
      version: `${row.updated_at || row.created_at || ''}|${url}`, thumbnailUrl: url, record, detail: row.is_primary ? 'Zdjęcie główne' : 'Zdjęcie',
    });
  });
  for (const row of attachments) {
    const name = driveName(row.file_name, 'Plik');
    const mime = text(row.mime_type) || EXTENSION_MIME[urlExtension(name)] || 'application/octet-stream';
    const kind = materialKind(mime, name);
    const url = text(row.file_url);
    out.push({
      id: `equipment-file:${row.id}`, parentId, name, type: 'equipment-file', mime, kind, size: Number(row.file_size) || null,
      updatedAt: row.updated_at || row.created_at || null, version: `${row.updated_at || row.created_at || ''}|${text(row.file_path)}`,
      thumbnailUrl: kind === 'image' && url ? url : null, record, detail: 'Plik',
    });
  }
  if (item.manualUrl) {
    const ext = urlExtension(item.manualUrl) || 'pdf';
    out.push({
      id: `equipment-manual:${item.id}`, parentId, name: withExtension(driveName(`Instrukcja — ${item.name}`, 'Instrukcja'), ext), type: 'equipment-manual',
      mime: EXTENSION_MIME[ext] || 'application/pdf', kind: materialKind(EXTENSION_MIME[ext] || 'application/pdf', `x.${ext}`), size: null,
      updatedAt: item.updatedAt, version: item.manualUrl, thumbnailUrl: null, record, detail: 'Instrukcja obsługi',
    });
  }
  return driveUniqueNames(out);
}

/** Adres pliku Dysku: PDF-y — podpisany adres (1 h; `download` — z nazwą pliku do zapisu), pliki magazynu i księgi znaku — adres publiczny bucketu. */
export async function driveDownload(ctx: NativeContext, idValue: string, mode: 'preview' | 'download' = 'download'): Promise<DriveDownload> {
  const ref = parseDriveFileId(idValue);
  if (!ref) fail('Nieprawidłowy plik Dysku.', 400);
  if (FINANCE_FILE_TYPES.has(ref.type)) return financeDownload(ctx, ref, mode);
  if (ref.type === 'program') {
    const release = await latestDesktopRelease('mac');
    if (!release) fail('Nie ma jeszcze opublikowanego instalatora aplikacji na Maca.', 404);
    // Ścieżka względna — trasa dopisuje adres serwera dla aplikacji na Macu i Findera (przeglądarka otwiera ją sama).
    return { url: signedDesktopLink(release, 'dmg'), name: `Mavinci-${release.version}.dmg`, mime: 'application/x-apple-diskimage', size: release.dmg.size };
  }
  const s = ctx.supabase;
  const signed = async (bucket: string, path: string, name: string) => {
    if (!path) fail('Ten dokument nie ma jeszcze PDF-u.', 404);
    const { data, error } = await s.storage.from(bucket).createSignedUrl(path, SIGNED_TTL, mode === 'download' ? { download: name } : undefined);
    if (error || !data?.signedUrl) fail('Pliku nie ma już w magazynie.', 410, { code: 'missing' });
    return data.signedUrl;
  };
  if (ref.type === 'offer' || ref.type === 'calculation' || ref.type === 'contract') {
    const section: DriveDocumentSection = ref.type === 'offer' ? 'offers' : ref.type === 'calculation' ? 'calculations' : 'contracts';
    requireSection(ctx, section);
    const rows = await DOCUMENT_LOADERS[section](ctx);
    const row = rows.find((entry) => entry.file.id === `${ref.type}:${ref.id}`);
    if (!row) fail('Nie znaleziono dokumentu albo nie masz do niego dostępu.', 404);
    const tree = documentTree(section, rows);
    const name = tree.files.find((file) => file.id === row.file.id)?.name || row.file.name;
    return { url: await signed(row.bucket, row.path, name), name, mime: 'application/pdf', size: null };
  }
  if (ref.type === 'employee-document') {
    const { data, error } = await s.from('employee_documents').select(DOCUMENT_COLUMNS).eq('id', ref.id).maybeSingle();
    if (documentsMissing(error)) fail(DOCUMENTS_PENDING, 503, { code: 'pending' });
    check(error, 'Nie udało się pobrać dokumentu.');
    if (!data) fail('Nie znaleziono dokumentu albo nie masz do niego dostępu.', 404);
    const row = data as Row;
    const file = documentFileFrom(row);
    return { url: await signed(DOCUMENTS_BUCKET, text(row.storage_path), file.name), name: file.name, mime: file.mime, size: file.size };
  }
  if (ref.type === 'employee-contract') {
    requireSection(ctx, 'employees');
    const { data, error } = await s.from('personnel_contract_documents').select('id,contract_id,version,content').eq('id', ref.id).maybeSingle();
    check(error, 'Nie udało się pobrać dokumentu umowy.');
    if (!data) fail('Nie znaleziono dokumentu umowy albo nie masz do niego dostępu.', 404);
    const document = data as Row;
    const { data: contract, error: contractError } = await s.from('personnel_contracts').select('id,contract_kind,contract_number,title')
      .eq('id', document.contract_id).maybeSingle();
    check(contractError, 'Nie udało się pobrać umowy.');
    if (!contract) fail('Nie znaleziono umowy albo nie masz do niej dostępu.', 404);
    const name = personnelContractName(contract as Row);
    const title = text((contract as Row).contract_number) || text((contract as Row).title) || 'Umowa';
    return { url: await personnelContractUrl(document, title, name, mode), name, mime: 'application/pdf', size: null };
  }
  if (ref.type === 'employee-avatar' || ref.type === 'employee-background') {
    requireSection(ctx, 'employees');
    const employee = await employeeById(ctx, ref.id);
    const file = employeePhotoFiles(employee).find((entry) => entry.id === `${ref.type}:${ref.id}`);
    if (!file?.thumbnailUrl) fail('Pracownik nie ma tego zdjęcia.', 404);
    return { url: file.thumbnailUrl, name: file.name, mime: file.mime, size: null };
  }
  if (ref.type === 'brand-logo' || ref.type === 'brand-font' || ref.type === 'company-logo') {
    let companyId = ref.id;
    if (ref.type !== 'company-logo') {
      const table = ref.type === 'brand-logo' ? 'company_brandbook_logos' : 'company_brandbook_fonts';
      const { data, error } = await s.from(table).select('company_id').eq('id', ref.id).maybeSingle();
      check(error, 'Nie udało się pobrać pliku.');
      if (!data) fail('Nie znaleziono pliku.', 404);
      companyId = String((data as Row).company_id);
    }
    const brand = await brandListing(ctx, companyId);
    const file = brand.files.find((entry) => entry.id === `${ref.type}:${ref.id}`);
    if (!file) fail('Nie znaleziono pliku.', 404);
    const url = ref.type === 'brand-font' ? await fontUrl(ctx, ref.id) : file.thumbnailUrl || '';
    if (!url) fail('Pliku nie ma już w magazynie.', 410, { code: 'missing' });
    return { url, name: file.name, mime: file.mime, size: null };
  }
  requireSection(ctx, 'warehouse');
  const equipmentId = ref.type === 'equipment-manual' ? ref.id : await equipmentOf(ctx, ref.type, ref.id);
  const catalog = await warehouseCatalog(ctx);
  const item = catalog.items.find((entry) => entry.id === equipmentId);
  if (!item) fail('Nie znaleziono sprzętu.', 404);
  const files = await equipmentFiles(ctx, item);
  const file = files.find((entry) => entry.id === `${ref.type}:${ref.id}`);
  if (!file) fail('Nie znaleziono pliku.', 404);
  let url = file.thumbnailUrl || '';
  if (ref.type === 'equipment-manual') url = item.manualUrl;
  if (ref.type === 'equipment-file') {
    const { data } = await s.from('equipment_files').select('file_path,file_url').eq('id', ref.id).maybeSingle();
    const row = (data || {}) as Row;
    url = text(row.file_path) ? s.storage.from('equipment-files').getPublicUrl(text(row.file_path)).data.publicUrl : text(row.file_url);
  }
  if (!url) fail('Pliku nie ma już w magazynie.', 410, { code: 'missing' });
  return { url, name: file.name, mime: file.mime, size: file.size };
}

async function fontUrl(ctx: NativeContext, id: string) {
  const { data } = await ctx.supabase.from('company_brandbook_fonts').select('storage_path,file_url').eq('id', id).maybeSingle();
  const row = (data || {}) as Row;
  return row.storage_path ? publicLogoUrl(ctx, row.storage_path) : /^https:\/\//i.test(text(row.file_url)) ? text(row.file_url) : '';
}

async function equipmentOf(ctx: NativeContext, type: string, id: string) {
  const table = type === 'equipment-image' ? 'equipment_images' : 'equipment_files';
  const { data, error } = await ctx.supabase.from(table).select('equipment_id').eq('id', id).maybeSingle();
  check(error, 'Nie udało się pobrać pliku.');
  if (!data) fail('Nie znaleziono pliku.', 404);
  return String((data as Row).equipment_id);
}

// MARK: Finanse — Koszty (dokument spoza KSeF) i skaner z telefonu

/*
 * Plik dodany do Kosztów miesiąca (CRM, Mac, Finder) albo skan z telefonu staje się dokumentem spoza KSeF (`external_invoices`,
 * plik w `external-invoices/<uuid>.<rozszerzenie>`, jak w CRM). Dane czyta AI tą samą funkcją co „Odczytaj z pliku” w CRM
 * (`extract-external-invoice`, token pracownika); bez odczytu dokument dostaje dane „do uzupełnienia” i uwagę w notatce. Teczkę
 * wyznacza data dokumentu (jak w przekazaniu księgowej) — inna niż wybrany miesiąc przenosi dokument, o czym mówi `notice`.
 * Skan: telefon wysyła zdjęcia stron do prywatnego `finance-scans/<firma>/<skan>/<nr>.jpg` (adresy podpisuje konto serwisowe),
 * serwer składa z nich PDF (pdf-lib, orientacja z EXIF) i zapisuje go w wybranym folderze: Koszty, kategoria Dokumentów spółki
 * albo umowa stała. Strony znikają po zapisie. Uprawnienia: `uploadTarget` („Finanse — zarządzanie”) i RLS wpisu.
 */

const COSTS_BUCKET = 'external-invoices';
const SCANS_BUCKET = 'finance-scans';
const SCANS_PENDING = 'Skaner Finansów będzie dostępny po wdrożeniu migracji bazy 20261125160000 (finance-scans).';
const COST_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/;
const SCAN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AI_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const AI_LIMIT = 10 * 1024 * 1024;
const AI_TIMEOUT = 70_000;
const COST_KINDS = new Set(['invoice', 'receipt', 'credit_note', 'insurance_policy', 'contract', 'debit_note', 'other']);
/** Sposób płatności z odczytu, który oznacza zapłatę na miejscu (paragon, karta). */
const PAID_ON_SPOT = new Set(['Karta', 'Gotówka', 'BLIK']);
const COST_PENDING_NAME = 'Do uzupełnienia';

/** Miesiąc zamknięty (przekazany księgowej) — komunikat bazy zamiast „brak uprawnień”. */
const financeLocked = (error: any) => error?.code === '42501' && /zamknięty/i.test(String(error?.message || ''));

const amountOf = (value: unknown) => {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.replace(',', '.')) : NaN;
  return Number.isFinite(amount) && Math.abs(amount) < 1e12 ? Math.round(amount * 100) / 100 : null;
};

/** Data dokumentu bez odczytu: dziś w bieżącym miesiącu, ostatni dzień minionego, pierwszy — przyszłego. */
function fallbackDay(year: number, month: number) {
  const today = warsawDay.format(new Date());
  const key = `${year}-${pad2(month)}`;
  if (today.startsWith(key)) return today;
  if (key < today.slice(0, 7)) return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return `${key}-01`;
}

type CostReading = { fields: Row; kind: string; warnings: string[] };

/** Odczyt AI dokumentu kosztowego (jak „Odczytaj z pliku” w CRM); każdy błąd — bez odczytu (dokument powstaje i tak). */
async function readCostDocument(ctx: NativeContext, companyId: string, bytes: Uint8Array, mime: string, name: string): Promise<CostReading | null> {
  if (!AI_TYPES.has(mime) || !bytes.length || bytes.length > AI_LIMIT) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const form = new FormData();
    form.append('file', new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime }), name);
    form.append('company_id', companyId);
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), AI_TIMEOUT); });
    const reply = await Promise.race([ctx.supabase.functions.invoke('extract-external-invoice', { body: form }), timeout]);
    if (!reply || reply.error) return null;
    const payload = reply.data as Row | null;
    const data = payload && payload.success === true && payload.data && typeof payload.data === 'object' ? payload.data as Row : null;
    if (!data) return null;
    return {
      fields: data.fields && typeof data.fields === 'object' ? data.fields as Row : {},
      kind: text(data.document_kind),
      warnings: Array.isArray(data.warnings) ? data.warnings.filter((entry: unknown): entry is string => typeof entry === 'string').slice(0, 10) : [],
    };
  } catch (error) {
    console.error('[native drive] cost reading', error instanceof Error ? error.message : error);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Dokument spoza KSeF z pliku w `external-invoices` (`path`): odczyt AI (`bytes` — treść do odczytu albo `null`), wpis tokenem
 * pracownika. Obiektu w magazynie nie sprząta — robi to wywołujący przy błędzie.
 */
async function createCostDocument(ctx: NativeContext, owner: CostTarget, file: { path: string; name: string; bytes: Uint8Array | null; mime: string; scan: boolean }): Promise<DriveUploadResult> {
  const reading = file.bytes ? await readCostDocument(ctx, owner.company.id, file.bytes, file.mime, file.name) : null;
  const fields = reading?.fields || {};
  const readDay = isoDate(fields.invoice_date);
  const day = readDay && readDay >= '2000-01-01' && readDay <= '2100-12-31' ? readDay : fallbackDay(owner.year, owner.month);
  const gross = amountOf(fields.amount_gross);
  const method = text(fields.payment_method).slice(0, 40);
  const paid = PAID_ON_SPOT.has(method);
  const base = file.name.replace(/\.[A-Za-z0-9]{2,5}$/, '');
  const notes = [
    file.scan ? 'Dodano skanem z aplikacji Mavinci (Dysk → Finanse → Koszty).' : 'Dodano z Dysku (Finanse → Koszty).',
    reading ? 'Dane odczytało AI — porównaj je z dokumentem.' : 'Danych nie odczytano — uzupełnij sprzedawcę, numer, datę i kwoty.',
    ...(reading?.warnings || []).map((warning) => `• ${warning}`),
  ].join('\n').slice(0, 2000);
  const { data, error } = await ctx.supabase.from('external_invoices').insert({
    my_company_id: owner.company.id,
    document_kind: COST_KINDS.has(reading?.kind || '') ? reading!.kind : 'invoice',
    seller_name: text(fields.seller_name).slice(0, 200) || COST_PENDING_NAME,
    seller_nip: text(fields.seller_nip).slice(0, 50) || null,
    invoice_number: text(fields.invoice_number).slice(0, 120) || driveName(base, COST_PENDING_NAME).slice(0, 120),
    label: text(fields.label).slice(0, 200) || null,
    invoice_date: day,
    payment_method: method || null,
    amount_net: amountOf(fields.amount_net),
    amount_gross: gross,
    currency: /^[A-Z]{3}$/.test(text(fields.currency)) ? text(fields.currency) : 'PLN',
    file_url: file.path,
    notes,
    payment_status: paid ? 'paid' : 'unpaid',
    paid_amount: paid && gross !== null ? Math.abs(gross) : 0,
    payment_date: paid ? day : null,
  }).select(EXTERNAL_COLUMNS).single();
  if (error || !data) {
    if (financeLocked(error)) fail(String(error!.message), 409, { code: 'locked' });
    check(error || { message: 'insert' }, 'Nie udało się dodać dokumentu kosztowego.');
  }
  const doc = externalDoc(data as Row);
  if (!doc) fail('Dokument dodano, ale nie udało się go odczytać — odśwież widok.', 500);
  const moved = doc.year !== owner.year || doc.month !== owner.month;
  const notice = [
    reading ? 'Odczytano dane dokumentu — sprawdź je w Finansach → Dokumenty spoza KSeF.' : 'Nie udało się odczytać danych — uzupełnij je w Finansach → Dokumenty spoza KSeF.',
    moved ? `Dokument ma datę ${plDate(day)}, więc jest w teczce ${driveMonthName(doc.month)} ${doc.year}.` : '',
  ].filter(Boolean).join(' ');
  return { file: { ...doc.file, parentId: driveFinanceNodeId(owner.company.id, { year: doc.year, month: doc.month, group: 'costs' }) }, notice };
}

/** Plik dodany do Kosztów (CRM, Mac, Finder): dokument spoza KSeF; błąd — obiekt znika z magazynu. */
async function completeCost(ctx: NativeContext, owner: CostTarget, body: Row): Promise<DriveUploadResult> {
  const path = text(body.path);
  if (text(body.bucket) !== COSTS_BUCKET || !COST_PATTERN.test(path)) fail('Nieprawidłowa wysyłka.', 400);
  const name = driveName(body.name, 'Dokument').slice(0, 255);
  const mime = text(body.mime).toLowerCase() || EXTENSION_MIME[urlExtension(name)] || 'application/octet-stream';
  const size = Math.max(0, Number(body.size) || 0);
  const admin = createSupabaseAdminClient();
  // Tylko świeżo wysłany obiekt: plik innego dokumentu nie może zostać podpięty drugi raz.
  const { data: used } = await admin.from('external_invoices').select('id').eq('file_url', path).limit(1);
  if (used?.length) fail('Nieprawidłowa wysyłka.', 400);
  let bytes: Uint8Array | null = null;
  if (AI_TYPES.has(mime) && size > 0 && size <= AI_LIMIT) {
    const { data } = await admin.storage.from(COSTS_BUCKET).download(path);
    bytes = data ? new Uint8Array(await data.arrayBuffer()) : null;
  }
  if (!bytes) {
    const { error } = await admin.storage.from(COSTS_BUCKET).createSignedUrl(path, 60);
    if (error) fail('Plik nie dotarł do magazynu. Spróbuj dodać go ponownie.', 409);
  }
  try {
    return await createCostDocument(ctx, owner, { path, name, bytes, mime, scan: false });
  } catch (error) {
    await admin.storage.from(COSTS_BUCKET).remove([path]);
    throw error;
  }
}

/** Orientacja zdjęcia z EXIF (1 — prosto, 3 — 180°, 6 — 90° w prawo, 8 — 90° w lewo; lustrzane jak najbliższe). */
function jpegOrientation(bytes: Uint8Array): number {
  let offset = 2;
  while (offset + 4 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xda || length < 2) break;
    const start = offset + 4;
    if (marker === 0xe1 && start + 14 <= bytes.length && String.fromCharCode(...bytes.slice(start, start + 4)) === 'Exif') {
      const tiff = start + 6;
      const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
      const u16 = (at: number) => (at + 1 < bytes.length ? (little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1]) : 0);
      const u32 = (at: number) => (at + 3 < bytes.length
        ? (little ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)) + bytes[at + 3] * 0x1000000
          : bytes[at] * 0x1000000 + ((bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]))
        : 0);
      const ifd = tiff + u32(tiff + 4);
      const entries = u16(ifd);
      for (let i = 0; i < entries && i < 64; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8);
          return ({ 1: 1, 2: 1, 3: 3, 4: 3, 5: 8, 6: 6, 7: 6, 8: 8 } as Record<number, number>)[value] || 1;
        }
      }
      return 1;
    }
    offset = start - 2 + length;
  }
  return 1;
}

/** PDF ze zdjęć stron (A4, strona w orientacji zdjęcia, zdjęcie wpasowane bez kadrowania); także zdjęcia zakupów (`purchases.server.ts`). */
export async function scanPdf(images: Uint8Array[]): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (const bytes of images) {
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (!jpeg && !png) fail('Strona skanu nie jest zdjęciem JPG ani PNG.', 415);
    const image = jpeg ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    const orientation = jpeg ? jpegOrientation(bytes) : 1;
    const turned = orientation === 6 || orientation === 8;
    const shownWidth = turned ? image.height : image.width;
    const shownHeight = turned ? image.width : image.height;
    const [pageWidth, pageHeight] = shownWidth > shownHeight ? [841.89, 595.28] : [595.28, 841.89];
    const scale = Math.min(pageWidth / shownWidth, pageHeight / shownHeight);
    const width = image.width * scale;
    const height = image.height * scale;
    const boxX = (pageWidth - (turned ? height : width)) / 2;
    const boxY = (pageHeight - (turned ? width : height)) / 2;
    const page = pdf.addPage([pageWidth, pageHeight]);
    if (orientation === 6) page.drawImage(image, { x: boxX, y: boxY + width, width, height, rotate: degrees(-90) });
    else if (orientation === 8) page.drawImage(image, { x: boxX + height, y: boxY, width, height, rotate: degrees(90) });
    else if (orientation === 3) page.drawImage(image, { x: boxX + width, y: boxY + height, width, height, rotate: degrees(180) });
    else page.drawImage(image, { x: boxX, y: boxY, width, height });
  }
  pdf.setTitle('Skan');
  pdf.setCreator('Mavinci CRM');
  pdf.setProducer('Mavinci CRM');
  return pdf.save();
}

/** Folder Finansów, do którego trafia skan: Koszty, kategoria Dokumentów spółki albo umowa stała. */
async function scanTarget(ctx: NativeContext, parentId: unknown): Promise<CostTarget | FinanceUploadTarget> {
  const owner = await uploadTarget(ctx, parentId);
  if (owner.kind !== 'cost' && owner.kind !== 'corporate' && owner.kind !== 'agreement') {
    fail('Skan zapisuje się w Finansach: w Kosztach miesiąca, w Dokumentach spółki albo w umowie stałej.', 400, { code: 'readonly' });
  }
  return owner;
}

const scanPages = (value: unknown) => {
  const count = Math.floor(Number(value) || 0);
  if (count < 1 || count > DRIVE_SCAN_LIMITS.pages) fail(`Skan może mieć od 1 do ${DRIVE_SCAN_LIMITS.pages} stron.`);
  return count;
};
const scanPagePath = (companyId: string, scanId: string, page: number) => `${companyId}/${scanId}/${String(page).padStart(3, '0')}.jpg`;

/** Skan z telefonu, krok 1: podpisane adresy wysyłki stron (zdjęć) do `finance-scans`. */
export async function drivePrepareScan(ctx: NativeContext, body: Row): Promise<DriveScanUpload> {
  const owner = await scanTarget(ctx, body.parentId);
  const count = scanPages(body.pages);
  const scanId = randomUUID();
  const admin = createSupabaseAdminClient();
  const pages: DriveScanUpload['pages'] = [];
  for (let page = 1; page <= count; page += 1) {
    const path = scanPagePath(owner.company.id, scanId, page);
    const { data, error } = await admin.storage.from(SCANS_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) {
      console.error('[native drive] scan upload url', error?.message);
      if (/not.?found/i.test(error?.message || '')) fail(SCANS_PENDING, 503, { code: 'pending' });
      fail('Nie udało się przygotować wysyłki skanu.', 500);
    }
    pages.push({ path, signedUrl: data.signedUrl, token: data.token });
  }
  return { scanId, pages };
}

/**
 * Skan z telefonu, krok 2: PDF ze stron → wybrany folder (Koszty — dokument spoza KSeF z odczytem AI; Dokumenty spółki —
 * dokument z nazwą `title` albo „Skan dd.mm.rrrr gg.mm”; umowa stała — plik umowy). Strony znikają z magazynu zawsze.
 */
export async function driveCompleteScan(ctx: NativeContext, body: Row): Promise<DriveUploadResult> {
  const owner = await scanTarget(ctx, body.parentId);
  const count = scanPages(body.pages);
  const scanId = text(body.scanId).toLowerCase();
  if (!SCAN_ID.test(scanId)) fail('Nieprawidłowy skan.', 400);
  const admin = createSupabaseAdminClient();
  const paths = Array.from({ length: count }, (_, index) => scanPagePath(owner.company.id, scanId, index + 1));
  try {
    const images: Uint8Array[] = [];
    for (const path of paths) {
      const { data, error } = await admin.storage.from(SCANS_BUCKET).download(path);
      if (error || !data) fail('Nie wszystkie strony skanu dotarły na serwer. Spróbuj ponownie.', 409);
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (!bytes.length || bytes.length > DRIVE_SCAN_LIMITS.page) fail('Strona skanu jest pusta albo za duża (do 15 MB).', 413);
      images.push(bytes);
    }
    const pdf = await scanPdf(images);
    const now = new Date();
    const clock = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' }).format(now).replace(':', '.');
    const title = text(body.title).replace(/\s+/g, ' ').trim().slice(0, 150);
    const name = withExtension(driveName(title || `Skan ${plDate(warsawDay.format(now))} ${clock}`, 'Skan'), 'pdf');
    const content = Buffer.from(pdf);
    if (owner.kind === 'cost') {
      const path = `${randomUUID()}.pdf`;
      const { error } = await admin.storage.from(COSTS_BUCKET).upload(path, content, { contentType: 'application/pdf', upsert: false });
      if (error) fail('Nie udało się zapisać skanu.', 500);
      // Odczyt AI: cały PDF do 10 MB, większy — pierwsza strona.
      const bytes = pdf.length <= AI_LIMIT ? pdf : images[0];
      const mime = pdf.length <= AI_LIMIT ? 'application/pdf' : (images[0][0] === 0x89 ? 'image/png' : 'image/jpeg');
      try {
        return await createCostDocument(ctx, owner, { path, name, bytes, mime, scan: true });
      } catch (error) {
        await admin.storage.from(COSTS_BUCKET).remove([path]);
        throw error;
      }
    }
    const { bucket } = financeUploadPlace(owner);
    const folder = owner.kind === 'corporate' ? owner.company.id : `${owner.company.id}/${owner.contractId}`;
    const path = `${folder}/${Date.now()}-${randomUUID().slice(0, 7)}-${financeObjectName(name)}`;
    const { error } = await admin.storage.from(bucket).upload(path, content, { contentType: 'application/pdf', upsert: false });
    if (error) fail('Nie udało się zapisać skanu.', 500);
    const result = await completeFinance(ctx, owner, { bucket, path, name, size: content.length, mime: 'application/pdf', title: title || undefined });
    return { ...result, notice: owner.kind === 'corporate' ? 'Skan zapisano w Dokumentach spółki.' : 'Skan zapisano w plikach umowy.' };
  } finally {
    const { error } = await admin.storage.from(SCANS_BUCKET).remove(paths);
    if (error) console.error('[native drive] scan pages', error.message);
  }
}

/** Skan przerwany w telefonie — strony znikają z magazynu. */
export async function driveCancelScan(ctx: NativeContext, body: Row) {
  const owner = await scanTarget(ctx, body.parentId);
  const count = scanPages(body.pages);
  const scanId = text(body.scanId).toLowerCase();
  if (!SCAN_ID.test(scanId)) fail('Nieprawidłowy skan.', 400);
  await createSupabaseAdminClient().storage.from(SCANS_BUCKET).remove(Array.from({ length: count }, (_, index) => scanPagePath(owner.company.id, scanId, index + 1)));
  return { ok: true };
}

// MARK: Dodawanie plików — sprzęt w Magazynie, dokumenty pracownika, Dokumenty spółki i Umowy stałe

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

/** Nazwa obiektu w magazynie z nazwy pliku: tylko bezpieczne znaki (jak w CRM). */
const safeObjectName = (name: string) => (name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_').slice(-120)) || 'plik';

type UploadTarget =
  | { kind: 'equipment'; equipmentId: string; parentId: string }
  | { kind: 'employee'; employeeId: string; parentId: string }
  | { kind: 'corporate'; company: FinanceCompany; category: DriveCorporateCategory; parentId: string }
  | { kind: 'agreement'; company: FinanceCompany; contractId: string; parentId: string }
  | { kind: 'cost'; company: FinanceCompany; year: number; month: number; parentId: string };
type FinanceUploadTarget = Extract<UploadTarget, { kind: 'corporate' | 'agreement' }>;
type CostTarget = Extract<UploadTarget, { kind: 'cost' }>;

/**
 * Folder, do którego można dodać plik: sprzęt w Magazynie (`warehouse:item:<id>`, prawo „Zarządzanie magazynem”), dokumenty
 * pracownika (`employees:<id>:documents` — sam pracownik, administrator, „Pracownicy — zarządzanie”), kategoria Dokumentów spółki
 * albo umowa stała (`finance:<firma>:corporate:<kategoria>`, `finance:<firma>:contracts:<umowa>`) i Koszty miesiąca
 * (`finance:<firma>:books:RRRR-MM:costs` — dokument spoza KSeF) — „Finanse — zarządzanie”.
 */
async function uploadTarget(ctx: NativeContext, parentValue: unknown): Promise<UploadTarget> {
  const node = parseDriveNode(parentValue);
  if (node?.section === 'finance' && node.companyId && node.group === 'costs' && node.year !== null && node.month !== null) {
    const company = (await financeCompanies(ctx)).find((entry) => entry.id === node.companyId);
    if (!company) fail('Nie masz dostępu do finansów tej firmy.', 403, { code: 'forbidden' });
    if (!company.manage) fail('Dokumenty kosztowe dodaje osoba z poziomem „Finanse — zarządzanie” w tej firmie.', 403, { code: 'forbidden' });
    return { kind: 'cost', company, year: node.year, month: node.month, parentId: driveFinanceNodeId(company.id, { year: node.year, month: node.month, group: 'costs' }) };
  }
  if (node?.section === 'finance' && node.companyId && (node.category || node.contractId)) {
    const company = (await financeCompanies(ctx)).find((entry) => entry.id === node.companyId);
    if (!company?.finance) fail('Nie masz dostępu do finansów tej firmy.', 403, { code: 'forbidden' });
    if (!company.manage) fail('Pliki w Finansach dodaje osoba z poziomem „Finanse — zarządzanie” w tej firmie.', 403, { code: 'forbidden' });
    if (node.category) return { kind: 'corporate', company, category: node.category, parentId: driveCorporateNodeId(company.id, node.category) };
    const contractId = node.contractId!;
    const { data, error } = await ctx.supabase.from('finance_recurring_contracts').select('id,my_company_id').eq('id', contractId).maybeSingle();
    check(error, 'Nie udało się sprawdzić umowy.');
    if (!data || lower((data as Row).my_company_id) !== company.id) fail('Nie znaleziono tej umowy albo nie masz do niej dostępu.', 404);
    return { kind: 'agreement', company, contractId, parentId: driveAgreementsNodeId(company.id, contractId) };
  }
  if (node?.section === 'employees' && node.employeeId && node.group === 'documents') {
    if (!canSeeDocuments(ctx, node.employeeId)) {
      fail('Dokumenty pracownika dodaje on sam albo osoba z prawem „Pracownicy — zarządzanie”.', 403, { code: 'forbidden' });
    }
    const employee = await employeeById(ctx, node.employeeId);
    return { kind: 'employee', employeeId: employee.id, parentId: driveEmployeeDocumentsNode(employee.id) };
  }
  if (!node || node.section !== 'warehouse' || !node.equipmentId) {
    fail('Pliki można dodawać do sprzętu w Magazynie, do dokumentów pracownika oraz w Finansach do Kosztów, Dokumentów spółki i umów stałych.', 400, { code: 'readonly' });
  }
  if (!warehouseWriter(ctx)) fail('Dodawanie plików do sprzętu wymaga prawa „Zarządzanie magazynem”.', 403, { code: 'forbidden' });
  const { data, error } = await ctx.supabase.from('equipment_items').select('id,name').eq('id', node.equipmentId).is('deleted_at', null).maybeSingle();
  check(error, 'Nie udało się sprawdzić sprzętu.');
  if (!data) fail('Nie znaleziono sprzętu.', 404);
  return { kind: 'equipment', equipmentId: node.equipmentId, parentId: `warehouse:item:${node.equipmentId}` };
}

function uploadKind(ctx: NativeContext, name: string, mime: string, size: number): 'image' | 'file' {
  const ext = urlExtension(name);
  return galleryWriter(ctx) && mime.startsWith('image/') && IMAGE_EXTENSIONS.has(ext) && size <= DRIVE_UPLOAD_LIMITS.image ? 'image' : 'file';
}

async function signedUpload(ctx: NativeContext, bucket: string, path: string) {
  const { data, error } = await ctx.supabase.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) {
    console.error('[native drive] upload url', bucket, error?.message);
    if (bucket === DOCUMENTS_BUCKET && /not.?found/i.test(error?.message || '')) fail(DOCUMENTS_PENDING, 503, { code: 'pending' });
    if (bucket === CORPORATE_BUCKET && /not.?found/i.test(error?.message || '')) fail(CORPORATE_PENDING, 503, { code: 'pending' });
    fail('Nie udało się przygotować wysyłki pliku.', 500);
  }
  return data;
}

/**
 * Podpisany adres wysyłki: zdjęcie (JPG, PNG, WebP, GIF do 10 MB) do galerii sprzętu, pozostałe pliki (do 50 MB) do plików
 * sprzętu — jak w CRM; dokument pracownika (do 50 MB) do prywatnego bucketu `employee-documents`; dokument spółki i plik umowy
 * stałej (do 50 MB) do `company-documents` i `finance-contracts`.
 */
export async function drivePrepareUpload(ctx: NativeContext, body: Row): Promise<DriveUpload> {
  const owner = await uploadTarget(ctx, body.parentId);
  const name = driveName(body.name, '');
  if (!name) fail('Podaj nazwę pliku.');
  const size = Math.max(0, Number(body.size) || 0);
  const mime = text(body.mime).toLowerCase() || EXTENSION_MIME[urlExtension(name)] || 'application/octet-stream';
  const stamp = `${Date.now()}-${randomUUID().slice(0, 7)}`;
  if (owner.kind === 'cost') {
    if (size > DRIVE_UPLOAD_LIMITS.file) fail(`Plik „${name}” przekracza 50 MB — limit dokumentów w Finansach.`, 413, { code: 'tooLarge' });
    // Jak „Dokumenty spoza KSeF” w CRM: `external-invoices/<uuid>.<rozszerzenie>`.
    const path = `${randomUUID()}.${urlExtension(name) || 'pdf'}`;
    const data = await signedUpload(ctx, COSTS_BUCKET, path);
    return { bucket: COSTS_BUCKET, path, signedUrl: data.signedUrl, token: data.token, target: 'file' };
  }
  if (owner.kind === 'corporate' || owner.kind === 'agreement') {
    if (size > DRIVE_UPLOAD_LIMITS.file) fail(`Plik „${name}” przekracza 50 MB — limit dokumentów w Finansach.`, 413, { code: 'tooLarge' });
    const bucket = owner.kind === 'corporate' ? CORPORATE_BUCKET : AGREEMENTS_BUCKET;
    const folder = owner.kind === 'corporate' ? owner.company.id : `${owner.company.id}/${owner.contractId}`;
    const path = `${folder}/${stamp}-${financeObjectName(name)}`;
    const data = await signedUpload(ctx, bucket, path);
    return { bucket, path, signedUrl: data.signedUrl, token: data.token, target: 'file' };
  }
  if (owner.kind === 'employee') {
    if (size > DRIVE_UPLOAD_LIMITS.file) fail(`Plik „${name}” przekracza 50 MB — limit dokumentów pracownika.`, 413, { code: 'tooLarge' });
    const path = `${owner.employeeId}/${stamp}-${safeObjectName(name)}`;
    const data = await signedUpload(ctx, DOCUMENTS_BUCKET, path);
    return { bucket: DOCUMENTS_BUCKET, path, signedUrl: data.signedUrl, token: data.token, target: 'file' };
  }
  const target = uploadKind(ctx, name, mime, size);
  if (target === 'file' && size > DRIVE_UPLOAD_LIMITS.file) fail(`Plik „${name}” przekracza 50 MB — limit plików sprzętu.`, 413, { code: 'tooLarge' });
  const bucket = target === 'image' ? 'equipment-images' : 'equipment-files';
  const path = target === 'image' ? `${owner.equipmentId}/${stamp}.${urlExtension(name) || 'jpg'}` : `${owner.equipmentId}/${stamp}-${safeObjectName(name)}`;
  const data = await signedUpload(ctx, bucket, path);
  return { bucket, path, signedUrl: data.signedUrl, token: data.token, target };
}

const objectPattern = (equipmentId: string) => new RegExp(`^${equipmentId}/\\d+-[0-9a-f]{7}(\\.[a-z0-9]{2,5}|-[A-Za-z0-9._-]{1,120})$`);
const documentPattern = (employeeId: string) => new RegExp(`^${employeeId}/\\d+-[0-9a-f]{7}-[A-Za-z0-9._-]{1,120}$`);

/** Data `RRRR-MM-DD` (termin ważności dokumentu) albo `null`. */
function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : null;
}

/**
 * Wpis dokumentu pracownika po wysyłce. Opcjonalnie z formularza (CRM, Mac — profil → Dokumenty): `title` (nazwa dokumentu;
 * domyślnie nazwa pliku bez rozszerzenia), `documentType`, `description`, `expiryDate` (RRRR-MM-DD).
 */
async function completeDocument(ctx: NativeContext, owner: Extract<UploadTarget, { kind: 'employee' }>, body: Row): Promise<{ file: DriveFile }> {
  const path = text(body.path);
  if (text(body.bucket) !== DOCUMENTS_BUCKET || !documentPattern(owner.employeeId).test(path)) fail('Nieprawidłowa wysyłka.', 400);
  const fileName = driveName(body.name, 'Plik').slice(0, 255);
  const ext = urlExtension(fileName);
  const title = (text(body.title) || (ext ? fileName.slice(0, -(ext.length + 1)) : fileName)).replace(/\s+/g, ' ').trim().slice(0, EMPLOYEE_DOCUMENT_LIMITS.name) || 'Dokument';
  const size = Math.max(0, Number(body.size) || 0);
  const mime = text(body.mime).toLowerCase() || EXTENSION_MIME[ext] || 'application/octet-stream';
  const { data, error } = await ctx.supabase.from('employee_documents').insert({
    employee_id: owner.employeeId, name: title, document_type: employeeDocumentType(body.documentType),
    description: text(body.description).slice(0, EMPLOYEE_DOCUMENT_LIMITS.description), storage_path: path, file_name: fileName, mime_type: mime,
    size_bytes: size || null, expiry_date: isoDate(body.expiryDate),
  }).select(DOCUMENT_COLUMNS).single();
  if (error || !data) {
    await ctx.supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    if (documentsMissing(error)) fail(DOCUMENTS_PENDING, 503, { code: 'pending' });
    check(error || { message: 'insert' }, 'Nie udało się dodać dokumentu.');
  }
  return { file: documentFileFrom(data as Row) };
}

/** Bucket i wzór ścieżki wysyłki do Finansów (dokument spółki albo plik umowy stałej). */
const financeUploadPlace = (owner: FinanceUploadTarget) => (owner.kind === 'corporate'
  ? { bucket: CORPORATE_BUCKET, pattern: corporatePattern(owner.company.id), table: 'company_documents' }
  : { bucket: AGREEMENTS_BUCKET, pattern: agreementPattern(owner.company.id, owner.contractId), table: 'finance_recurring_contract_files' });

/**
 * Wpis dokumentu spółki albo pliku umowy stałej po wysyłce. Dokument spółki opcjonalnie z formularza: `title` (domyślnie nazwa
 * pliku bez rozszerzenia), `documentDate` (RRRR-MM-DD), `description`. Przy błędzie obiekt znika z magazynu.
 */
async function completeFinance(ctx: NativeContext, owner: FinanceUploadTarget, body: Row): Promise<{ file: DriveFile }> {
  const { bucket, pattern } = financeUploadPlace(owner);
  const path = text(body.path);
  if (text(body.bucket) !== bucket || !pattern.test(path)) fail('Nieprawidłowa wysyłka.', 400);
  const fileName = driveName(body.name, 'Plik').slice(0, 255);
  const ext = urlExtension(fileName);
  const size = Math.max(0, Number(body.size) || 0);
  const mime = text(body.mime).toLowerCase() || EXTENSION_MIME[ext] || 'application/octet-stream';
  const drop = async () => { await ctx.supabase.storage.from(bucket).remove([path]); };
  if (owner.kind === 'corporate') {
    const title = (text(body.title) || (ext ? fileName.slice(0, -(ext.length + 1)) : fileName)).replace(/\s+/g, ' ').trim().slice(0, 200) || 'Dokument';
    const { data, error } = await ctx.supabase.from('company_documents').insert({
      my_company_id: owner.company.id, category: owner.category, title, document_date: isoDate(body.documentDate),
      description: text(body.description).slice(0, 2000), storage_path: path, file_name: fileName, mime_type: mime, size_bytes: size || null,
    }).select(CORPORATE_COLUMNS).single();
    if (error || !data) {
      await drop();
      if (documentsMissing(error)) fail(CORPORATE_PENDING, 503, { code: 'pending' });
      check(error || { message: 'insert' }, 'Nie udało się dodać dokumentu spółki.');
    }
    return { file: corporateFile(data as Row, owner.company) };
  }
  const { data: id, error } = await ctx.supabase.rpc('add_finance_recurring_contract_file', {
    p_contract_id: owner.contractId, p_storage_path: path, p_file_name: fileName, p_mime_type: mime, p_file_size: size || null,
  });
  if (error || !id) {
    await drop();
    check(error || { message: 'insert' }, 'Nie udało się dodać pliku umowy.');
  }
  const [{ data: row }, { data: contract }] = await Promise.all([
    ctx.supabase.from('finance_recurring_contract_files').select(AGREEMENT_FILE_COLUMNS).eq('id', String(id)).maybeSingle(),
    ctx.supabase.from('finance_recurring_contracts').select(AGREEMENT_COLUMNS).eq('id', owner.contractId).maybeSingle(),
  ]);
  if (!row || !contract) fail('Plik dodano, ale nie udało się go odczytać — odśwież widok.', 500);
  return { file: agreementFile(row as Row, contract as Row, owner.company) };
}

/** Wpis pliku po wysyłce (zdjęcie → galeria sprzętu, inne → pliki sprzętu, dokument pracownika, Finanse); przy błędzie obiekt znika z magazynu. */
export async function driveCompleteUpload(ctx: NativeContext, body: Row): Promise<DriveUploadResult> {
  const owner = await uploadTarget(ctx, body.parentId);
  if (owner.kind === 'cost') return completeCost(ctx, owner, body);
  if (owner.kind === 'corporate' || owner.kind === 'agreement') return completeFinance(ctx, owner, body);
  if (owner.kind === 'employee') return completeDocument(ctx, owner, body);
  const { equipmentId } = owner;
  const bucket = text(body.bucket);
  const path = text(body.path);
  if (!['equipment-images', 'equipment-files'].includes(bucket) || !objectPattern(equipmentId).test(path)) fail('Nieprawidłowa wysyłka.', 400);
  if (bucket === 'equipment-images' && !galleryWriter(ctx)) fail('Nieprawidłowa wysyłka.', 400);
  const name = driveName(body.name, 'Plik');
  const size = Math.max(0, Number(body.size) || 0);
  const mime = text(body.mime).toLowerCase() || EXTENSION_MIME[urlExtension(name)] || 'application/octet-stream';
  const publicUrl = ctx.supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  const drop = async () => { await ctx.supabase.storage.from(bucket).remove([path]); };
  let fileId = '';
  if (bucket === 'equipment-images') {
    const { count } = await ctx.supabase.from('equipment_images').select('id', { count: 'exact', head: true }).eq('equipment_id', equipmentId);
    const { data, error } = await ctx.supabase.from('equipment_images').insert({
      equipment_id: equipmentId, image_url: publicUrl, title: name, is_primary: !count, sort_order: count || 0, uploaded_by: ctx.employee.id,
    }).select('id').single();
    if (error || !data) { await drop(); check(error || { message: 'insert' }, 'Nie udało się dodać zdjęcia.'); }
    fileId = `equipment-image:${(data as Row).id}`;
  } else {
    const { data, error } = await ctx.supabase.from('equipment_files').insert({
      // `equipment_files.uploaded_by` wskazuje konto (auth.users), `equipment_images.uploaded_by` — pracownika.
      equipment_id: equipmentId, file_name: name, file_path: path, file_url: publicUrl, file_size: size || null, mime_type: mime, uploaded_by: ctx.employee.authUserId,
    }).select('id').single();
    if (error || !data) { await drop(); check(error || { message: 'insert' }, 'Nie udało się dodać pliku.'); }
    fileId = `equipment-file:${(data as Row).id}`;
  }
  const catalog = await warehouseCatalog(ctx);
  const item = catalog.items.find((entry) => entry.id === equipmentId);
  const files = item ? await equipmentFiles(ctx, item) : [];
  const file = files.find((entry) => entry.id === fileId);
  if (!file) fail('Plik dodano, ale nie udało się go odczytać — odśwież widok.', 500);
  return { file };
}

/** Przerwana wysyłka — obiekt bez wpisu znika z magazynu. */
export async function driveCancelUpload(ctx: NativeContext, body: Row) {
  const owner = await uploadTarget(ctx, body.parentId);
  const bucket = text(body.bucket);
  const path = text(body.path);
  if (owner.kind === 'cost') {
    if (bucket !== COSTS_BUCKET || !COST_PATTERN.test(path)) fail('Nieprawidłowa wysyłka.', 400);
    const { data, error } = await ctx.supabase.from('external_invoices').select('id').eq('file_url', path).limit(1);
    if (!error && !data?.length) await createSupabaseAdminClient().storage.from(COSTS_BUCKET).remove([path]);
    return { ok: true };
  }
  if (owner.kind === 'corporate' || owner.kind === 'agreement') {
    const place = financeUploadPlace(owner);
    if (bucket !== place.bucket || !place.pattern.test(path)) fail('Nieprawidłowa wysyłka.', 400);
    const { data, error } = await ctx.supabase.from(place.table).select('id').eq('storage_path', path).limit(1);
    if ((!error && !data?.length) || documentsMissing(error)) await ctx.supabase.storage.from(bucket).remove([path]);
    return { ok: true };
  }
  if (owner.kind === 'employee') {
    if (bucket !== DOCUMENTS_BUCKET || !documentPattern(owner.employeeId).test(path)) fail('Nieprawidłowa wysyłka.', 400);
    const { data, error } = await ctx.supabase.from('employee_documents').select('id').eq('storage_path', path).limit(1);
    if (!error && !data?.length) await ctx.supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    if (documentsMissing(error)) await ctx.supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    return { ok: true };
  }
  const { equipmentId } = owner;
  if (!['equipment-images', 'equipment-files'].includes(bucket) || !objectPattern(equipmentId).test(path)) fail('Nieprawidłowa wysyłka.', 400);
  const column = bucket === 'equipment-images' ? 'image_url' : 'file_path';
  const table = bucket === 'equipment-images' ? 'equipment_images' : 'equipment_files';
  const value = bucket === 'equipment-images' ? ctx.supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl : path;
  const { data } = await ctx.supabase.from(table).select('id').eq(column, value).limit(1);
  if (!data?.length) await ctx.supabase.storage.from(bucket).remove([path]);
  return { ok: true };
}

/**
 * Usunięcie dokumentu pracownika (CRM i Mac: profil → Dokumenty): administrator i „Pracownicy — zarządzanie”, a pracownik —
 * dokument, który sam dodał (RLS); dokumentu spółki i pliku umowy stałej — „Finanse — zarządzanie” w firmie. Pozostałe pliki
 * Dysku usuwa się tam, gdzie powstają (sprzęt, oferta, umowa…).
 */
export async function driveDeleteFile(ctx: NativeContext, body: Row) {
  const ref = parseDriveFileId(body.id);
  if (ref?.type === 'company-document') {
    const { data, error } = await ctx.supabase.from('company_documents').select('id,storage_path').eq('id', ref.id).maybeSingle();
    if (documentsMissing(error)) fail(CORPORATE_PENDING, 503, { code: 'pending' });
    check(error, 'Nie udało się pobrać dokumentu spółki.');
    if (!data) fail('Nie znaleziono dokumentu albo nie masz do niego dostępu.', 404);
    const { data: removed, error: deleteError } = await ctx.supabase.from('company_documents').delete().eq('id', ref.id).select('id');
    check(deleteError, 'Nie udało się usunąć dokumentu spółki.');
    if (!removed?.length) fail('Dokumenty spółki usuwa osoba z poziomem „Finanse — zarządzanie” w tej firmie.', 403, { code: 'forbidden' });
    const { error: storageError } = await ctx.supabase.storage.from(CORPORATE_BUCKET).remove([text((data as Row).storage_path)]);
    if (storageError) console.error('[native drive] company document object', storageError.message);
    return { ok: true };
  }
  if (ref?.type === 'agreement-file') {
    const { data: path, error } = await ctx.supabase.rpc('remove_finance_recurring_contract_file', { p_file_id: ref.id });
    check(error, 'Nie udało się usunąć pliku umowy.');
    if (typeof path === 'string' && path) {
      const { error: storageError } = await ctx.supabase.storage.from(AGREEMENTS_BUCKET).remove([path]);
      if (storageError) console.error('[native drive] agreement object', storageError.message);
    }
    return { ok: true };
  }
  if (!ref || ref.type !== 'employee-document') {
    fail('Z Dysku można usuwać dokumenty pracownika, dokumenty spółki i pliki umów stałych.', 400, { code: 'readonly' });
  }
  const { data, error } = await ctx.supabase.from('employee_documents').select('id,storage_path').eq('id', ref.id).maybeSingle();
  if (documentsMissing(error)) fail(DOCUMENTS_PENDING, 503, { code: 'pending' });
  check(error, 'Nie udało się pobrać dokumentu.');
  if (!data) fail('Nie znaleziono dokumentu albo nie masz do niego dostępu.', 404);
  const { data: removed, error: deleteError } = await ctx.supabase.from('employee_documents').delete().eq('id', ref.id).select('id');
  check(deleteError, 'Nie udało się usunąć dokumentu.');
  if (!removed?.length) fail('Ten dokument usuwa osoba, która go dodała, albo osoba z prawem „Pracownicy — zarządzanie”.', 403, { code: 'forbidden' });
  const { error: storageError } = await ctx.supabase.storage.from(DOCUMENTS_BUCKET).remove([text((data as Row).storage_path)]);
  if (storageError) console.error('[native drive] document object', storageError.message);
  return { ok: true };
}

// MARK: Miejsce na Dysku — tylko administrator (migracja 20261126120000_drive_storage_usage.sql)

const STORAGE_PENDING = 'Zestawienie miejsca wymaga migracji 20261126120000_drive_storage_usage.sql — uruchom ją w Supabase.';

function storageFail(error: any, fallback: string): never {
  const code = String(error?.code || '');
  if (code === 'PGRST202' || code === '42883' || code === '42P01') fail(STORAGE_PENDING, 503, { code: 'pending' });
  if (code === '42501') fail('Miejsce na Dysku widzi i zmienia tylko administrator.', 403, { code: 'forbidden' });
  if (code === '22023') fail(String(error?.message || fallback), 400);
  console.error('[native drive] storage', code, error?.message);
  fail(fallback, 500);
}

/** Pakiet i zajętość: pliki (magazyn, z podziałem na rodzaje) i baza danych. */
export async function driveStorage(ctx: NativeContext): Promise<DriveStorageUsage> {
  if (!ctx.employee.isAdmin) fail('Miejsce na Dysku widzi tylko administrator.', 403, { code: 'forbidden' });
  const { data, error } = await ctx.supabase.rpc('crm_storage_usage');
  if (error) storageFail(error, 'Nie udało się odczytać zajętości miejsca.');
  return driveStorageUsage(data);
}

/** Zmiana pakietu (nazwa, limit plików i bazy w GB) — zwraca nowe zestawienie. */
export async function driveSetStoragePlan(ctx: NativeContext, body: Row): Promise<DriveStorageUsage> {
  if (!ctx.employee.isAdmin) fail('Pakiet miejsca na Dysku zmienia tylko administrator.', 403, { code: 'forbidden' });
  const name = text(body.name).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80);
  const filesGb = Number(body.filesGb);
  const databaseGb = Number(body.databaseGb);
  const valid = (value: number) => Number.isFinite(value) && value >= 1 && value <= 100_000;
  if (!valid(filesGb) || !valid(databaseGb)) fail('Podaj limity od 1 do 100 000 GB.');
  const { data, error } = await ctx.supabase.rpc('crm_set_storage_plan', {
    p_name: name || 'Pakiet', p_files_gb: Math.round(filesGb * 100) / 100, p_database_gb: Math.round(databaseGb * 100) / 100,
  });
  if (error) storageFail(error, 'Nie udało się zapisać pakietu.');
  return driveStorageUsage(data);
}
