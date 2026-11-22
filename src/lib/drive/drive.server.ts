import 'server-only';
import { randomUUID } from 'node:crypto';
import { can, type NativeContext } from '@/lib/native/auth';
import { materialAccess, materialCompanies } from '@/lib/materials/materials.server';
import { materialKind } from '@/lib/materials/materialsShared';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import {
  DRIVE_EMPLOYEE_GROUPS, DRIVE_SECTIONS, DRIVE_TITLE, DRIVE_UPLOAD_LIMITS, EMPLOYEE_DOCUMENT_LIMITS, EMPLOYEE_DOCUMENT_TYPES, driveEmployeeDocumentsNode,
  driveMonthName, driveName, driveUniqueNames, employeeDocumentType, parseDriveFileId, parseDriveNode,
  type DriveBrandColor, type DriveBrandNode, type DriveDocumentSection, type DriveDownload, type DriveEmployeeGroup, type DriveFile, type DriveFolder,
  type DriveListing, type DriveNode, type DriveRoot, type DriveSection, type DriveSectionInfo, type DriveSync, type DriveUpload,
} from './driveShared';

/*
 * Dysk — działy chmury poza Eventami i Materiałami (te mają własne API: `/bridge/native/v1/files`, `/bridge/native/v1/materials`):
 * Oferty, Kalkulacje i Umowy (PDF-y wygenerowane w CRM, rok → miesiąc, tylko do odczytu), Magazyn (kategoria → sprzęt →
 * zdjęcia, pliki, instrukcja; dodawanie plików z prawem „Zarządzanie magazynem”), Pracownicy (pracownik → Zdjęcia, Dokumenty,
 * Umowy — jak zakładki profilu pracownika) i księga znaku marki (logotypy i fonty z Moich firm — w Materiałach w folderze
 * „Logotypy i księga znaku”). Wszystko tokenem pracownika: RLS jak w CRM decyduje, które oferty, kalkulacje, umowy, sprzęt,
 * dokumenty i umowy personelu widać. Treść plików nie przechodzi przez serwer — podpisane albo publiczne adresy magazynu;
 * wyjątek: PDF dokumentu umowy personelu powstaje raz na serwerze z treści zapisanej w CRM (kopia w `employee-documents/contracts/`).
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
  events: EVENT_SCOPES,
  materials: ['materials_view', 'materials_manage'],
  offers: ['offers_view', 'offers_create', 'offers_manage', ...INQUIRY_SCOPES],
  calculations: [...EVENT_SCOPES, 'offers_view', 'offers_create', 'offers_manage', ...INQUIRY_SCOPES],
  contracts: ['contracts_view', 'contracts_manage', 'contracts_create'],
  warehouse: ['equipment_view', 'equipment_manage', 'equipment_create'],
  employees: ['employees_view', 'employees_manage', 'personnel_view', 'personnel_manage'],
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

export function driveSections(ctx: NativeContext): DriveSectionInfo[] {
  return DRIVE_SECTIONS.map((section) => ({
    ...section,
    available: ctx.employee.isAdmin || SECTION_SCOPES[section.key].some((scope) => can(ctx.employee, scope)),
    canUpload: section.key === 'warehouse' ? warehouseWriter(ctx) : section.key === 'employees' ? documentsManager(ctx) : false,
  }));
}

function requireSection(ctx: NativeContext, key: DriveSection) {
  const info = driveSections(ctx).find((section) => section.key === key);
  if (!info?.available) fail('Nie masz dostępu do tego działu Dysku.', 403, { code: 'forbidden' });
  return info;
}

export function driveRoot(ctx: NativeContext): DriveRoot {
  return { title: DRIVE_TITLE, sections: driveSections(ctx) };
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
  pdf: 'application/pdf', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', zip: 'application/zip',
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

/** Całe drzewo działów Ofert, Kalkulacji, Umów i Magazynu oraz księgi znaku marek naraz (Finder trzyma kopię i porównuje wersje). */
export async function driveSync(ctx: NativeContext): Promise<DriveSync> {
  const cursor = new Date().toISOString();
  const sections = driveSections(ctx);
  const available = new Set(sections.filter((section) => section.available).map((section) => section.key));
  const folders: DriveFolder[] = [];
  const files: DriveFile[] = [];
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

// MARK: Dodawanie plików — sprzęt w Magazynie i dokumenty pracownika

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

/** Nazwa obiektu w magazynie z nazwy pliku: tylko bezpieczne znaki (jak w CRM). */
const safeObjectName = (name: string) => (name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_').slice(-120)) || 'plik';

type UploadTarget = { kind: 'equipment'; equipmentId: string; parentId: string } | { kind: 'employee'; employeeId: string; parentId: string };

/**
 * Folder, do którego można dodać plik: sprzęt w Magazynie (`warehouse:item:<id>`, prawo „Zarządzanie magazynem”) albo dokumenty
 * pracownika (`employees:<id>:documents` — sam pracownik, administrator, „Pracownicy — zarządzanie”).
 */
async function uploadTarget(ctx: NativeContext, parentValue: unknown): Promise<UploadTarget> {
  const node = parseDriveNode(parentValue);
  if (node?.section === 'employees' && node.employeeId && node.group === 'documents') {
    if (!canSeeDocuments(ctx, node.employeeId)) {
      fail('Dokumenty pracownika dodaje on sam albo osoba z prawem „Pracownicy — zarządzanie”.', 403, { code: 'forbidden' });
    }
    const employee = await employeeById(ctx, node.employeeId);
    return { kind: 'employee', employeeId: employee.id, parentId: driveEmployeeDocumentsNode(employee.id) };
  }
  if (!node || node.section !== 'warehouse' || !node.equipmentId) {
    fail('Pliki można dodawać do sprzętu w Magazynie i do dokumentów pracownika.', 400, { code: 'readonly' });
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
    fail('Nie udało się przygotować wysyłki pliku.', 500);
  }
  return data;
}

/**
 * Podpisany adres wysyłki: zdjęcie (JPG, PNG, WebP, GIF do 10 MB) do galerii sprzętu, pozostałe pliki (do 50 MB) do plików
 * sprzętu — jak w CRM; dokument pracownika (do 50 MB) do prywatnego bucketu `employee-documents`.
 */
export async function drivePrepareUpload(ctx: NativeContext, body: Row): Promise<DriveUpload> {
  const owner = await uploadTarget(ctx, body.parentId);
  const name = driveName(body.name, '');
  if (!name) fail('Podaj nazwę pliku.');
  const size = Math.max(0, Number(body.size) || 0);
  const mime = text(body.mime).toLowerCase() || EXTENSION_MIME[urlExtension(name)] || 'application/octet-stream';
  const stamp = `${Date.now()}-${randomUUID().slice(0, 7)}`;
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

/** Wpis pliku po wysyłce (zdjęcie → galeria sprzętu, inne → pliki sprzętu, dokument pracownika); przy błędzie obiekt znika z magazynu. */
export async function driveCompleteUpload(ctx: NativeContext, body: Row): Promise<{ file: DriveFile }> {
  const owner = await uploadTarget(ctx, body.parentId);
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
 * dokument, który sam dodał (RLS). Pozostałe pliki Dysku usuwa się tam, gdzie powstają (sprzęt, oferta, umowa…).
 */
export async function driveDeleteFile(ctx: NativeContext, body: Row) {
  const ref = parseDriveFileId(body.id);
  if (!ref || ref.type !== 'employee-document') fail('Z Dysku można usuwać tylko dokumenty pracownika.', 400, { code: 'readonly' });
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
