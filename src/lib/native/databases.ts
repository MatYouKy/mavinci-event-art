import 'server-only';
import type { NativeContext } from './auth';
import { can } from './auth';
import { imageCrop } from './team';
import { allRows } from './page';

/*
 * Bazy danych na Macu (`/crm/databases`, `/crm/databases/[id]`): własne arkusze (`custom_databases`, kolumny
 * `custom_database_columns`, rekordy `custom_database_records` z danymi w JSON według identyfikatora kolumny)
 * i udostępnianie pracownikom (`database_shares` + `custom_databases.shared_user_ids`). Tokenem pracownika — RLS jak
 * w przeglądarce: zarządzanie dla administratora i `databases_manage`, usuwanie bazy tylko administrator.
 */

type Row = Record<string, any>;
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const TYPES = ['text', 'number', 'date', 'boolean', 'phone', 'email'] as const;
const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const person = (value: Row | null | undefined) => [value?.name, value?.surname].filter(Boolean).join(' ');

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const check = (error: { message?: string; code?: string } | null | undefined, message: string) => {
  if (error) fail(message, error.code === '42501' ? 403 : 400);
};
const requireId = (value: unknown, message: string) => {
  const id = text(value);
  if (!UUID.test(id)) fail(message);
  return id;
};

export function databasesAccess(ctx: NativeContext) {
  return { canManage: ctx.employee.isAdmin || can(ctx.employee, 'databases_manage'), isAdmin: ctx.employee.isAdmin };
}
function requireManage(ctx: NativeContext) {
  if (!databasesAccess(ctx).canManage) fail('Brak uprawnień do zarządzania bazami danych.', 403);
}

const databaseItem = (row: Row) => ({
  id: String(row.id), name: text(row.name), description: text(row.description), createdAt: text(row.created_at), updatedAt: text(row.updated_at),
});
const columnItem = (row: Row) => ({
  id: String(row.id), name: text(row.name), type: TYPES.includes(row.column_type) ? row.column_type : 'text',
  order: Number(row.order_index) || 0, width: Math.max(100, Number(row.column_width) || 200),
});
const recordItem = (row: Row) => ({
  id: String(row.id), data: row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {},
  order: Number(row.order_index) || 0, createdAt: text(row.created_at), updatedAt: text(row.updated_at),
});

export async function databasesList(ctx: NativeContext) {
  const { data, error } = await ctx.supabase.from('custom_databases').select('id,name,description,created_at,updated_at').order('name');
  check(error, 'Błąd podczas ładowania baz danych');
  return { access: databasesAccess(ctx), databases: ((data ?? []) as Row[]).map(databaseItem) };
}

async function columnsOf(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.from('custom_database_columns').select('*').eq('database_id', id).order('order_index').order('created_at');
  check(error, 'Błąd podczas ładowania kolumn');
  return ((data ?? []) as Row[]).map(columnItem);
}

/** Baza z kolumnami i wszystkimi rekordami (kolejność `order_index` jak w CRM). */
export async function databaseDetail(ctx: NativeContext, id: string) {
  const s = ctx.supabase;
  const { data: database, error } = await s.from('custom_databases').select('id,name,description,created_at,updated_at').eq('id', id).maybeSingle();
  check(error, 'Błąd podczas ładowania bazy danych');
  if (!database) fail('Nie znaleziono bazy danych', 404);
  const [columns, records] = await Promise.all([
    columnsOf(ctx, id),
    allRows<Row>((c) => c.from('custom_database_records').select('*').eq('database_id', id).order('order_index').order('created_at').order('id'), s),
  ]);
  return { access: databasesAccess(ctx), database: databaseItem(database as Row), columns, records: records.map(recordItem) };
}

export async function createDatabase(ctx: NativeContext, body: Row) {
  requireManage(ctx);
  const name = text(body.name).trim();
  if (!name) fail('Wprowadź nazwę bazy danych');
  if (name.length > 200) fail('Nazwa może mieć najwyżej 200 znaków.');
  const description = text(body.description).trim();
  const { data, error } = await ctx.supabase.from('custom_databases').insert({ name, description: description || null }).select('id').single();
  check(error, 'Błąd podczas tworzenia bazy danych');
  return { ok: true, id: String((data as Row).id), message: 'Baza danych utworzona' };
}

export async function renameDatabase(ctx: NativeContext, id: string, value: unknown) {
  requireManage(ctx);
  const name = text(value).trim();
  if (!name) fail('Wprowadź nazwę bazy danych');
  if (name.length > 200) fail('Nazwa może mieć najwyżej 200 znaków.');
  const { data, error } = await ctx.supabase.from('custom_databases').update({ name }).eq('id', id).select('id');
  check(error, 'Błąd podczas aktualizacji nazwy');
  if (!data?.length) fail('Nie znaleziono bazy danych', 404);
  return { ok: true, message: 'Nazwa zaktualizowana' };
}

export async function deleteDatabase(ctx: NativeContext, id: string) {
  if (!ctx.employee.isAdmin) fail('Tylko administrator może usunąć bazę danych.', 403);
  const { data, error } = await ctx.supabase.from('custom_databases').delete().eq('id', id).select('id');
  check(error, 'Błąd podczas usuwania bazy danych');
  if (!data?.length) fail('Nie udało się usunąć bazy danych (brak uprawnień albo baza już nie istnieje).', 403);
  return { ok: true, message: 'Baza danych usunięta' };
}

// MARK: Kolumny

const columnName = (value: unknown) => {
  const name = text(value).trim();
  if (!name) fail('Wprowadź nazwę kolumny');
  if (name.length > 200) fail('Nazwa kolumny może mieć najwyżej 200 znaków.');
  return name;
};

export async function addColumn(ctx: NativeContext, databaseId: string, body: Row) {
  requireManage(ctx);
  const name = columnName(body.name);
  const type = TYPES.includes(body.type) ? body.type : 'text';
  const columns = await columnsOf(ctx, databaseId);
  const { data, error } = await ctx.supabase.from('custom_database_columns').insert({
    database_id: databaseId, name, column_type: type, order_index: columns.reduce((max, c) => Math.max(max, c.order + 1), columns.length),
  }).select('*').single();
  check(error, 'Błąd podczas dodawania kolumny');
  return { ok: true, column: columnItem(data as Row), message: 'Kolumna dodana' };
}

export async function updateColumn(ctx: NativeContext, id: string, body: Row) {
  requireManage(ctx);
  const patch: Row = {};
  if (body.name !== undefined) patch.name = columnName(body.name);
  if (body.width !== undefined) {
    const width = Math.round(Number(body.width));
    if (!Number.isFinite(width)) fail('Nieprawidłowa szerokość kolumny.');
    patch.column_width = Math.min(2000, Math.max(100, width));
  }
  if (!Object.keys(patch).length) fail('Brak zmian.');
  const { data, error } = await ctx.supabase.from('custom_database_columns').update(patch).eq('id', id).select('*');
  check(error, 'Błąd podczas aktualizacji kolumny');
  if (!data?.length) fail('Nie znaleziono kolumny', 404);
  return { ok: true, column: columnItem((data as Row[])[0]), message: patch.name ? 'Kolumna zaktualizowana' : undefined };
}

export async function deleteColumn(ctx: NativeContext, id: string) {
  requireManage(ctx);
  const { data, error } = await ctx.supabase.from('custom_database_columns').delete().eq('id', id).select('id');
  check(error, 'Błąd podczas usuwania kolumny');
  if (!data?.length) fail('Nie znaleziono kolumny', 404);
  return { ok: true, message: 'Kolumna usunięta' };
}

/** Nowa kolejność kolumn (przeciąganie nagłówków) — `order_index` po kolei jak w CRM. */
export async function reorderColumns(ctx: NativeContext, databaseId: string, ids: unknown) {
  requireManage(ctx);
  const order = Array.isArray(ids) ? ids.map(text) : [];
  const columns = await columnsOf(ctx, databaseId);
  const known = new Set(columns.map((c) => c.id));
  if (order.length !== columns.length || new Set(order).size !== order.length || order.some((id) => !known.has(id))) {
    fail('Kolumny zmieniły się w międzyczasie. Odśwież bazę i spróbuj ponownie.', 409);
  }
  for (const [index, id] of order.entries()) {
    const { error } = await ctx.supabase.from('custom_database_columns').update({ order_index: index }).eq('id', id);
    check(error, 'Błąd podczas zmiany kolejności');
  }
  return { ok: true, message: 'Kolejność kolumn zaktualizowana' };
}

// MARK: Rekordy

export async function addRecord(ctx: NativeContext, databaseId: string) {
  requireManage(ctx);
  const s = ctx.supabase;
  const columns = await columnsOf(ctx, databaseId);
  const { data: last, error: lastError } = await s.from('custom_database_records').select('order_index').eq('database_id', databaseId)
    .order('order_index', { ascending: false }).limit(1).maybeSingle();
  check(lastError, 'Błąd podczas dodawania rekordu');
  const { data, error } = await s.from('custom_database_records').insert({
    database_id: databaseId, data: Object.fromEntries(columns.map((c) => [c.id, ''])),
    order_index: last ? (Number((last as Row).order_index) || 0) + 1 : 0,
  }).select('*').single();
  check(error, 'Błąd podczas dodawania rekordu');
  return { ok: true, record: recordItem(data as Row), message: 'Rekord dodany' };
}

/** Wartość jednej komórki: dopisana do aktualnych danych rekordu (inne komórki zmienione w międzyczasie zostają). */
export async function updateCell(ctx: NativeContext, recordId: string, columnId: string, value: unknown) {
  requireManage(ctx);
  if (!UUID.test(columnId)) fail('Nieprawidłowa kolumna.');
  if (!(typeof value === 'string' || typeof value === 'boolean' || value === null)) fail('Nieprawidłowa wartość.');
  if (typeof value === 'string' && value.length > 10_000) fail('Wartość może mieć najwyżej 10 000 znaków.');
  const s = ctx.supabase;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: current, error } = await s.from('custom_database_records').select('id,database_id,data,updated_at').eq('id', recordId).maybeSingle();
    check(error, 'Błąd podczas aktualizacji komórki');
    if (!current) fail('Rekord został usunięty. Odśwież bazę.', 404);
    const row = current as Row;
    const { data: column } = await s.from('custom_database_columns').select('id').eq('id', columnId).eq('database_id', row.database_id).maybeSingle();
    if (!column) fail('Kolumna została usunięta. Odśwież bazę.', 404);
    const merged = { ...(row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {}), [columnId]: value };
    const { data, error: updateError } = await s.from('custom_database_records').update({ data: merged })
      .eq('id', recordId).eq('updated_at', row.updated_at).select('*');
    check(updateError, 'Błąd podczas aktualizacji komórki');
    if (data?.length) return { ok: true, record: recordItem((data as Row[])[0]) };
  }
  fail('Rekord zmienia się równocześnie w innym miejscu. Odśwież bazę i spróbuj ponownie.', 409);
}

export async function deleteRecord(ctx: NativeContext, id: string) {
  requireManage(ctx);
  const { data, error } = await ctx.supabase.from('custom_database_records').delete().eq('id', id).select('id');
  check(error, 'Błąd podczas usuwania rekordu');
  if (!data?.length) fail('Nie znaleziono rekordu', 404);
  return { ok: true, message: 'Rekord usunięty' };
}

// MARK: Udostępnianie

const personItem = (row: Row | null) => ({
  id: text(row?.id), name: person(row), avatarUrl: row?.avatar_url || null, avatar: imageCrop(row?.avatar_metadata),
});

/** Udostępnienia bazy i pracownicy, którym można ją udostępnić (aktywni, bez administratorów — jak w CRM). */
export async function databaseShares(ctx: NativeContext, databaseId: string) {
  requireManage(ctx);
  const s = ctx.supabase;
  const [employeesRes, sharesRes] = await Promise.all([
    s.from('employees').select('id, name, surname, avatar_url, avatar_metadata').eq('is_active', true).neq('role', 'admin').order('name'),
    s.from('database_shares').select('id, employee_id, can_edit_records, shared_at, employee:employees!database_shares_employee_id_fkey(id, name, surname, avatar_url, avatar_metadata)')
      .eq('database_id', databaseId),
  ]);
  check(employeesRes.error, 'Błąd podczas ładowania danych udostępniania');
  check(sharesRes.error, 'Błąd podczas ładowania danych udostępniania');
  const shares = ((sharesRes.data ?? []) as Row[]).map((share) => ({
    id: String(share.id), employeeId: text(share.employee_id), canEdit: share.can_edit_records === true,
    employee: personItem(one(share.employee) as Row | null),
  }));
  const shared = new Set(shares.map((share) => share.employeeId));
  return {
    shares,
    employees: ((employeesRes.data ?? []) as Row[]).filter((e) => !shared.has(String(e.id))).map(personItem),
  };
}

async function sharedIds(ctx: NativeContext, databaseId: string) {
  const { data, error } = await ctx.supabase.from('custom_databases').select('shared_user_ids').eq('id', databaseId).maybeSingle();
  check(error, 'Błąd podczas udostępniania bazy danych');
  if (!data) fail('Nie znaleziono bazy danych', 404);
  return (Array.isArray((data as Row).shared_user_ids) ? (data as Row).shared_user_ids : []).map(text) as string[];
}

export async function shareDatabase(ctx: NativeContext, databaseId: string, employeeId: string) {
  requireManage(ctx);
  const s = ctx.supabase;
  const { error } = await s.from('database_shares').insert({ database_id: databaseId, employee_id: employeeId, can_edit_records: false, shared_by: ctx.employee.id });
  if (error?.code === '23505') fail('Ten pracownik ma już dostęp do tej bazy');
  check(error, 'Błąd podczas udostępniania bazy danych');
  const ids = await sharedIds(ctx, databaseId);
  const { error: updateError } = await s.from('custom_databases').update({ shared_user_ids: [...new Set([...ids, employeeId])] }).eq('id', databaseId);
  check(updateError, 'Błąd podczas udostępniania bazy danych');
  return { ok: true, message: 'Baza danych udostępniona' };
}

export async function revokeShare(ctx: NativeContext, databaseId: string, employeeId: string) {
  requireManage(ctx);
  const s = ctx.supabase;
  const { error } = await s.from('database_shares').delete().eq('database_id', databaseId).eq('employee_id', employeeId);
  check(error, 'Błąd podczas odbierania dostępu');
  const { data: employee } = await s.from('employees').select('id, auth_user_id').eq('id', employeeId).maybeSingle();
  // Usuwamy zarówno identyfikator pracownika, jak i konta logowania (CRM zapisuje pierwszy, a usuwał drugi).
  const remove = new Set([employeeId, text((employee as Row | null)?.auth_user_id)].filter(Boolean));
  const ids = await sharedIds(ctx, databaseId);
  const { error: updateError } = await s.from('custom_databases').update({ shared_user_ids: ids.filter((id) => !remove.has(id)) }).eq('id', databaseId);
  check(updateError, 'Błąd podczas odbierania dostępu');
  return { ok: true, message: 'Dostęp odebrany' };
}

export { requireId };
