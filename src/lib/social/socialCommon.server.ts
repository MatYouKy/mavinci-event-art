import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NativeContext } from '@/lib/native/auth';
import { NO_SOCIAL_ACCESS, type SocialAccess } from './socialShared';

/*
 * Wspólne narzędzia modułu social media na serwerze Next (`/bridge/native/v1/social` — web CRM, Mac i telefon):
 * błędy z kodem HTTP, komunikaty bazy po polsku, zakresy pracownika w marce (`social_media_access` — te same reguły co RLS),
 * marki, nazwiska pracowników i podpisane linki do prywatnego bucketu `social-media`.
 */

export type Row = Record<string, any>;
export const SOCIAL_BUCKET = 'social-media';
export const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

export const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
export const uuidOrNull = (value: unknown) => (isUuid(value) ? value.toLowerCase() : null);
export const isObject = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);

export function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

/** Komunikat bazy (RAISE EXCEPTION) albo czytelny zamiennik dla błędów technicznych PostgREST. */
export function check(error: { message?: string; code?: string; details?: string } | null | undefined, fallback: string) {
  if (!error) return;
  const code = error.code || '';
  if (code === '42501') fail(error.message && !/permission denied|row-level security/i.test(error.message) ? error.message : 'Nie masz uprawnień do tej operacji w social media.', 403);
  if (code === '40001') fail(error.message || 'Dane zmieniono w innym oknie. Odśwież widok.', 409);
  if (code === 'P0002') fail(error.message || 'Nie znaleziono.', 404);
  if (code === '23503') fail('Ten element jest używany w postach — zamiast usuwać, przenieś go do archiwum.', 409);
  if (code === '23505') fail('Taki element już istnieje.', 409);
  if (code === '23514') fail(fallback);
  if (code.startsWith('PGRST') || /row-level security/i.test(error.message || '')) fail(fallback, 403);
  fail(error.message || fallback);
}

export const httpStatus = (error: unknown) => {
  const status = (error as { status?: number } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 600 ? status : 500;
};

/** Zakresy bieżącego pracownika w marce. */
export async function socialAccess(ctx: NativeContext, companyId: string): Promise<SocialAccess> {
  const { data, error } = await ctx.supabase.rpc('social_media_access', { p_company: companyId });
  if (error || !isObject(data)) return { ...NO_SOCIAL_ACCESS, employeeId: ctx.employee.id };
  return {
    view: data.view === true,
    create: data.create === true,
    consent: data.consent === true,
    approve: data.approve === true,
    publish: data.publish === true,
    admin: data.admin === true,
    employeeId: text(data.employeeId) || ctx.employee.id,
  };
}

export async function requireAccess(ctx: NativeContext, companyId: string, scope: keyof Omit<SocialAccess, 'employeeId' | 'admin'>) {
  const access = await socialAccess(ctx, companyId);
  if (!access[scope]) {
    fail(scope === 'view' ? 'Nie masz dostępu do social media tej marki.' : 'Nie masz uprawnień do tej operacji w social media.', 403);
  }
  return access;
}

export type SocialCompany = { id: string; name: string; isDefault: boolean };

/** Marki z dostępem do social media (domyślna marka pierwsza). */
export async function socialCompanies(ctx: NativeContext): Promise<SocialCompany[]> {
  const { data, error } = await ctx.supabase.from('my_companies').select('id, name, is_default, is_active').order('name');
  check(error, 'Nie udało się pobrać marek.');
  const rows = (data || []).filter((row: Row) => row.is_active !== false);
  const allowed = await Promise.all(rows.map(async (row: Row) => ({ row, access: await socialAccess(ctx, String(row.id)) })));
  return allowed
    .filter((item) => item.access.view)
    .map(({ row }) => ({ id: String(row.id), name: text(row.name) || 'Marka', isDefault: row.is_default === true }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name, 'pl'));
}

/** Imię i nazwisko pracowników (`employees.id`). */
export async function employeeNames(supabase: SupabaseClient, ids: unknown[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(isUuid).map((id) => id.toLowerCase())));
  const names = new Map<string, string>();
  if (!unique.length) return names;
  const { data } = await supabase.from('employees').select('id, name, surname').in('id', unique);
  for (const row of (data || []) as Row[]) {
    names.set(String(row.id).toLowerCase(), `${text(row.name)} ${text(row.surname)}`.trim() || 'Pracownik');
  }
  return names;
}

/** Podpisane linki (1 h) do plików w `social-media`; brak pliku albo błąd — brak linku. */
export async function signedUrls(supabase: SupabaseClient, paths: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = Array.from(new Set(paths.filter((path): path is string => typeof path === 'string' && path.length > 0)));
  const urls = new Map<string, string>();
  for (let start = 0; start < unique.length; start += 100) {
    const chunk = unique.slice(start, start + 100);
    const { data } = await supabase.storage.from(SOCIAL_BUCKET).createSignedUrls(chunk, 3600);
    for (const item of data || []) {
      if (item?.signedUrl && item.path) urls.set(item.path, item.signedUrl);
    }
  }
  return urls;
}

export async function downloadSocialFile(supabase: SupabaseClient, path: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(SOCIAL_BUCKET).download(path);
  if (error || !data) fail('Nie udało się pobrać pliku z biblioteki.', 502);
  return Buffer.from(await data.arrayBuffer());
}

/** Zapis nowego pliku (bez nadpisywania); plik o tej samej nazwie już jest — traktujemy jak zapisany (ta sama treść). */
export async function uploadSocialFile(supabase: SupabaseClient, path: string, bytes: Buffer, contentType: string) {
  const { error } = await supabase.storage.from(SOCIAL_BUCKET).upload(path, bytes, { contentType, upsert: false, cacheControl: '31536000' });
  if (error && !/exists|duplicate/i.test(error.message || '')) {
    console.error('[social-upload]', error.message);
    fail('Nie udało się zapisać pliku w bibliotece.', 502);
  }
}

export async function removeSocialFiles(supabase: SupabaseClient, paths: Array<string | null | undefined>) {
  const list = Array.from(new Set(paths.filter((path): path is string => typeof path === 'string' && path.length > 0)));
  if (!list.length) return;
  const { error } = await supabase.storage.from(SOCIAL_BUCKET).remove(list);
  if (error) console.warn('[social-remove]', error.message);
}

/** Publiczny adres pliku z księgi znaku (bucket `company-logos`) — ścieżka albo pełny adres http(s). */
export function brandbookPublicUrl(value: unknown): string | null {
  const raw = text(value).trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? `${base}/storage/v1/object/public/company-logos/${raw.replace(/^\/+/, '')}` : null;
}

/** Adres pliku publicznego z naszego Supabase Storage (ochrona przed pobieraniem dowolnych adresów przez serwer). */
export function isOwnPublicStorageUrl(value: string) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(base) && value.startsWith(`${base}/storage/v1/object/public/`) && !value.includes('..');
}

/** Pobranie pliku publicznego z naszego Storage (logo, font, zdjęcia realizacji) z limitem rozmiaru. */
export async function fetchPublicStorageFile(url: string, maxBytes: number): Promise<{ bytes: Buffer; contentType: string }> {
  if (!isOwnPublicStorageUrl(url)) fail('Nieobsługiwany adres pliku.', 400);
  const response = await fetch(url, { cache: 'no-store', redirect: 'error' });
  if (!response.ok) fail('Nie udało się pobrać pliku.', 502);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > maxBytes) fail('Plik jest za duży.', 413);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) fail('Plik jest za duży.', 413);
  return { bytes, contentType: (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() };
}

/** Rodzaj obrazu po pierwszych bajtach (nie ufamy rozszerzeniu ani nagłówkowi). */
export function sniffImageType(bytes: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length > 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/** Wymiary PNG z nagłówka (proporcje logo w nakładce edytora kadru). */
export function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (sniffImageType(bytes) !== 'image/png' || bytes.length < 24) return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Bezpieczna nazwa pliku do paczki („Gala-Tymbark-4x5.jpg”). */
export function safeFileName(value: string, fallback: string) {
  const ascii = value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');
  const cleaned = ascii.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
  return cleaned || fallback;
}
