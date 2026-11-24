import 'server-only';
import type { NativeContext } from '@/lib/native/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { MaterialsError, materialAccess } from './materials.server';
import {
  MATERIAL_SHARE_DEFAULT_DAYS, MATERIAL_SHARE_LIMITS, materialShareEmails, materialShareStatus, type MaterialShare, type MaterialShareAccess,
  type MaterialShareCreated, type MaterialShareItemKind,
} from './materialsShared';
import { shareContents, type ShareItemRow } from './materialShareContents.server';
import { generateSharePassword, hashSharePassword, newShareToken } from './materialShareCrypto.server';

/*
 * Materiały → „Udostępnij link” (zarządzanie: CRM, Mac, telefon przez `/bridge/native/v1/materials`): lista linków marki,
 * nowy link (folder, album, pliki; ważność, dostęp dla każdego albo po e-mailu i haśle), przedłużenie, wyłączenie i włączenie,
 * zmiana tytułu, wiadomości, dostępu i hasła, usunięcie. Token pracownika — RLS: „Materiały — zarządzanie” marki. Hasło
 * zapisujemy jako skrót; odpowiedź z nowym hasłem zwraca je jeden raz (do przekazania odbiorcy). Strona dla odbiorcy —
 * `materialSharePublic.server.ts`.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set<MaterialShareItemKind>(['folder', 'file', 'album']);
const LIST_LIMIT = 100;
const LINK_COLUMNS = 'id,company_id,token,title,message,access_mode,allowed_emails,expires_at,revoked_at,view_count,download_count,'
  + 'last_viewed_at,last_downloaded_at,created_by,created_at';

function fail(message: string, status = 400, extra: Record<string, unknown> = {}): never {
  throw new MaterialsError(message, status, extra);
}

function dbFail(error: any, fallback: string): never {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  const polish = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(message);
  if (code === '42501') fail('Udostępnianie linków wymaga uprawnienia „Materiały — zarządzanie”.', 403, { code: 'forbidden' });
  if (code === '22023' || code === 'P0001' || code === 'P0002') fail(polish ? message : fallback, 400);
  if (code === '23514') fail(fallback, 400);
  if (code === '42P01' || code === 'PGRST205') fail('Udostępnianie linków wymaga aktualizacji bazy (migracja 20261130120000).', 503, { code: 'migration' });
  console.error('[material-shares]', code, message);
  fail(fallback, 500);
}

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

const uuidOf = (value: unknown, message: string, status = 400) => {
  const id = String(value ?? '').toLowerCase();
  if (!UUID.test(id)) fail(message, status);
  return id;
};

async function requireManage(ctx: NativeContext, companyId: string) {
  const access = await materialAccess(ctx, companyId);
  if (!access.manage) fail('Udostępnianie linków wymaga uprawnienia „Materiały — zarządzanie” tej marki.', 403, { code: 'forbidden' });
}

const shareUrl = (origin: string, token: string) => `${origin.replace(/\/+$/, '')}/pobierz/${token}`;

function cleanTitle(value: unknown) {
  return text(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MATERIAL_SHARE_LIMITS.title).trim();
}

function cleanMessage(value: unknown) {
  return text(value).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, MATERIAL_SHARE_LIMITS.message);
}

function daysOf(value: unknown) {
  const days = Math.round(Number(value));
  if (!Number.isFinite(days) || days < 1 || days > MATERIAL_SHARE_LIMITS.maxDays) {
    fail(`Ważność linku: od 1 do ${MATERIAL_SHARE_LIMITS.maxDays} dni.`);
  }
  return days;
}

/** Hasło podane albo wygenerowane (puste pole). */
function passwordOf(value: unknown) {
  const password = text(value).trim();
  if (!password) return generateSharePassword();
  if (password.length < MATERIAL_SHARE_LIMITS.passwordMin || password.length > MATERIAL_SHARE_LIMITS.passwordMax) {
    fail(`Hasło: od ${MATERIAL_SHARE_LIMITS.passwordMin} do ${MATERIAL_SHARE_LIMITS.passwordMax} znaków (puste pole — wygenerujemy hasło).`);
  }
  return password;
}

function emailsOf(value: unknown) {
  const { emails, invalid } = materialShareEmails(value);
  if (invalid.length) fail(`Niepoprawny adres e-mail: ${invalid.slice(0, 3).join(', ')}.`);
  if (!emails.length) fail('Podaj adres e-mail osoby, która otworzy link (z hasłem).');
  if (emails.length > MATERIAL_SHARE_LIMITS.emails) fail(`Najwyżej ${MATERIAL_SHARE_LIMITS.emails} adresów e-mail w jednym linku.`);
  return emails;
}

async function employeeNames(ctx: NativeContext, ids: unknown[]) {
  const unique = Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && UUID.test(id))));
  const names = new Map<string, string>();
  if (!unique.length) return names;
  const { data } = await ctx.supabase.from('employees').select('id,name,surname').in('id', unique);
  for (const e of (data || []) as Row[]) names.set(String(e.id), `${text(e.name)} ${text(e.surname)}`.trim() || 'Pracownik');
  return names;
}

/** Adresy, którymi otwarto linki z hasłem (sesje czyta tylko serwer — po sprawdzeniu uprawnień pracownika). */
async function openedBy(linkIds: string[]) {
  const result = new Map<string, string[]>();
  if (!linkIds.length) return result;
  try {
    const { data } = await createSupabaseAdminClient().from('material_share_sessions').select('link_id,email,created_at')
      .in('link_id', linkIds).order('created_at', { ascending: false }).limit(1000);
    for (const row of (data || []) as Row[]) {
      const list = result.get(String(row.link_id)) || [];
      const email = text(row.email);
      if (email && !list.includes(email) && list.length < 5) list.push(email);
      result.set(String(row.link_id), list);
    }
  } catch {
    // Bez listy otwarć — reszta danych linku i tak jest.
  }
  return result;
}

async function linkItems(ctx: NativeContext, linkIds: string[]) {
  const map = new Map<string, ShareItemRow[]>();
  if (!linkIds.length) return map;
  const { data, error } = await ctx.supabase.from('material_share_link_items').select('link_id,kind,item_id,sort_order').in('link_id', linkIds);
  if (error) dbFail(error, 'Nie udało się odczytać zawartości linków.');
  for (const row of (data || []) as Row[]) {
    const list = map.get(String(row.link_id)) || [];
    list.push({ kind: row.kind as MaterialShareItemKind, item_id: String(row.item_id), sort_order: Number(row.sort_order || 0) });
    map.set(String(row.link_id), list);
  }
  return map;
}

async function shareViews(ctx: NativeContext, rows: Row[], origin: string): Promise<MaterialShare[]> {
  const ids = rows.map((row) => String(row.id));
  const [items, names, opened] = await Promise.all([linkItems(ctx, ids), employeeNames(ctx, rows.map((row) => row.created_by)), openedBy(ids)]);
  return Promise.all(rows.map(async (row) => {
    const contents = await shareContents(ctx.supabase, String(row.company_id), items.get(String(row.id)) || [])
      .catch(() => ({ items: [], fileCount: 0, totalBytes: 0 }));
    const share = {
      id: String(row.id),
      companyId: String(row.company_id),
      url: shareUrl(origin, String(row.token)),
      title: text(row.title),
      message: text(row.message),
      access: (row.access_mode === 'password' ? 'password' : 'public') as MaterialShareAccess,
      emails: Array.isArray(row.allowed_emails) ? row.allowed_emails.map(String) : [],
      expiresAt: String(row.expires_at),
      revokedAt: row.revoked_at ?? null,
      items: contents.items,
      fileCount: contents.fileCount,
      totalBytes: contents.totalBytes,
      viewCount: Number(row.view_count || 0),
      downloadCount: Number(row.download_count || 0),
      lastViewedAt: row.last_viewed_at ?? null,
      lastDownloadedAt: row.last_downloaded_at ?? null,
      openedBy: opened.get(String(row.id)) || [],
      createdAt: String(row.created_at),
      createdBy: row.created_by ? names.get(String(row.created_by)) || null : null,
    };
    return { ...share, status: materialShareStatus(share) };
  }));
}

async function linkRow(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.from('material_share_links').select(LINK_COLUMNS).eq('id', id).maybeSingle();
  if (error) dbFail(error, 'Nie udało się odczytać linku.');
  if (!data) fail('Nie znaleziono linku (albo nie masz uprawnień do udostępniania w tej marce).', 404);
  return data as Row;
}

/** Linki marki (najnowsze najpierw): aktywne, wygasłe i wyłączone. */
export async function materialSharesList(ctx: NativeContext, params: URLSearchParams, origin: string) {
  const companyId = uuidOf(params.get('company'), 'Wybierz markę.');
  await requireManage(ctx, companyId);
  const { data, error } = await ctx.supabase.from('material_share_links').select(LINK_COLUMNS)
    .eq('company_id', companyId).order('created_at', { ascending: false }).limit(LIST_LIMIT);
  if (error) dbFail(error, 'Nie udało się pobrać linków.');
  return { companyId, shares: await shareViews(ctx, (data || []) as Row[], origin) };
}

/** Nowy link: elementy marki, tytuł, wiadomość, ważność (dni), dostęp i — z hasłem — adresy e-mail i hasło (puste — generowane). */
export async function materialShareCreate(ctx: NativeContext, body: Row, origin: string): Promise<MaterialShareCreated> {
  const companyId = uuidOf(body.companyId, 'Wybierz markę.');
  await requireManage(ctx, companyId);
  const seen = new Set<string>();
  const items: Array<{ kind: MaterialShareItemKind; id: string }> = [];
  for (const raw of Array.isArray(body.items) ? body.items : []) {
    const kind = text(raw?.kind) as MaterialShareItemKind;
    const id = text(raw?.id).toLowerCase();
    if (!KINDS.has(kind) || !UUID.test(id) || seen.has(`${kind}:${id}`)) continue;
    seen.add(`${kind}:${id}`);
    items.push({ kind, id });
  }
  if (!items.length) fail('Wybierz folder, album albo pliki do udostępnienia.');
  if (items.length > MATERIAL_SHARE_LIMITS.items) fail(`Najwyżej ${MATERIAL_SHARE_LIMITS.items} elementów w jednym linku — udostępnij cały folder albo album.`);
  const access: MaterialShareAccess = body.access === 'password' ? 'password' : 'public';
  const emails = access === 'password' ? emailsOf(body.emails) : [];
  const password = access === 'password' ? passwordOf(body.password) : null;
  const days = daysOf(body.days ?? MATERIAL_SHARE_DEFAULT_DAYS);
  const title = cleanTitle(body.title) || 'Pliki do pobrania';
  const { data, error } = await ctx.supabase.from('material_share_links').insert({
    company_id: companyId,
    token: newShareToken(),
    title,
    message: cleanMessage(body.message),
    access_mode: access,
    allowed_emails: emails,
    password_hash: password ? await hashSharePassword(password) : null,
    expires_at: new Date(Date.now() + days * 24 * 3600_000).toISOString(),
    created_by: ctx.employee.id,
  }).select(LINK_COLUMNS).single();
  if (error || !data) dbFail(error, 'Nie udało się utworzyć linku.');
  const row = data as Row;
  const { error: itemsError } = await ctx.supabase.from('material_share_link_items')
    .insert(items.map((item, index) => ({ link_id: row.id, kind: item.kind, item_id: item.id, company_id: companyId, sort_order: index })));
  if (itemsError) {
    await ctx.supabase.from('material_share_links').delete().eq('id', row.id);
    dbFail(itemsError, 'Nie udało się dodać elementów do linku.');
  }
  const [share] = await shareViews(ctx, [row], origin);
  return { share, password };
}

/**
 * Zmiana linku: `title`, `message`, `days` (nowa ważność liczona od teraz), `revoked` (wyłącz / włącz), `access` z `emails`,
 * `emails`, `newPassword` (nowe hasło — podane w `password` albo wygenerowane). Nowe hasło i zmiana dostępu kończą otwarte sesje.
 */
export async function materialShareUpdate(ctx: NativeContext, body: Row, origin: string): Promise<MaterialShareCreated> {
  const id = uuidOf(body.id, 'Nie znaleziono linku.', 404);
  const current = await linkRow(ctx, id);
  await requireManage(ctx, String(current.company_id));
  const patch: Row = {};
  if (body.title !== undefined) patch.title = cleanTitle(body.title) || text(current.title);
  if (body.message !== undefined) patch.message = cleanMessage(body.message);
  if (body.days !== undefined && body.days !== null) patch.expires_at = new Date(Date.now() + daysOf(body.days) * 24 * 3600_000).toISOString();
  if (body.revoked === true) patch.revoked_at = new Date().toISOString();
  if (body.revoked === false) patch.revoked_at = null;
  const currentAccess: MaterialShareAccess = current.access_mode === 'password' ? 'password' : 'public';
  const access: MaterialShareAccess = body.access === 'password' || body.access === 'public' ? body.access : currentAccess;
  let password: string | null = null;
  let endSessions = false;
  if (access === 'public') {
    if (currentAccess !== 'public') {
      Object.assign(patch, { access_mode: 'public', allowed_emails: [], password_hash: null });
      endSessions = true;
    }
  } else {
    if (currentAccess !== 'password' || body.emails !== undefined) patch.allowed_emails = emailsOf(body.emails ?? current.allowed_emails);
    if (currentAccess !== 'password' || body.newPassword === true) {
      password = passwordOf(body.password);
      Object.assign(patch, { access_mode: 'password', password_hash: await hashSharePassword(password) });
      endSessions = true;
    } else if (patch.allowed_emails) {
      endSessions = true;
    }
  }
  if (!Object.keys(patch).length) fail('Brak zmian do zapisania.');
  const { data, error } = await ctx.supabase.from('material_share_links').update(patch).eq('id', id).select(LINK_COLUMNS).maybeSingle();
  if (error) dbFail(error, 'Nie udało się zapisać zmian linku.');
  if (!data) fail('Nie masz uprawnień do zmiany tego linku.', 403, { code: 'forbidden' });
  if (endSessions) {
    // Sesje czyta i usuwa tylko serwer — uprawnienie pracownika sprawdził zapis linku (RLS).
    await createSupabaseAdminClient().from('material_share_sessions').delete().eq('link_id', id).then(() => undefined, () => undefined);
  }
  const [share] = await shareViews(ctx, [data as Row], origin);
  return { share, password };
}

/** Usunięcie linku (adres przestaje działać od razu; pliki zostają w Materiałach). */
export async function materialShareDelete(ctx: NativeContext, body: Row) {
  const id = uuidOf(body.id, 'Nie znaleziono linku.', 404);
  const current = await linkRow(ctx, id);
  await requireManage(ctx, String(current.company_id));
  const { data, error } = await ctx.supabase.from('material_share_links').delete().eq('id', id).select('id');
  if (error) dbFail(error, 'Nie udało się usunąć linku.');
  if (!data?.length) fail('Nie masz uprawnień do usunięcia tego linku.', 403, { code: 'forbidden' });
  return { ok: true, id };
}
