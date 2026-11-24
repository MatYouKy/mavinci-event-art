import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { materialShareEmails, materialShareStatus, type MaterialShareAccess, type MaterialShareItemKind } from './materialsShared';
import { shareContents, type ShareContents, type ShareFile, type ShareItemRow } from './materialShareContents.server';
import { SHARE_TOKEN, newSessionKey, sha256Hex, shareCookieName, verifySharePassword } from './materialShareCrypto.server';
import { ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, uniqueZipPaths, zipSafeName, zipStream, type ZipEntry } from './zipStream';

/*
 * Strona `/pobierz/<token>` — link do pobrania z Materiałów dla osoby spoza firmy. Klucz serwisowy (odbiorca nie ma konta),
 * więc każde zapytanie ogranicza się do marki linku, a dostęp sprawdzamy tutaj: link istnieje, nie wygasł, nie jest wyłączony,
 * a link z hasłem — ma ważną sesję (ciasteczko `mvs_…` po podaniu e-maila z listy i hasła). Pliki z prywatnego bucketu
 * `materials` — krótkie podpisane adresy (miniatury 1 h, pobranie 15 min), archiwum ZIP — strumieniem przez serwer.
 * Próby hasła: najwyżej 8 nieudanych z jednego adresu i 30 łącznie w ciągu 15 minut.
 */

type Row = Record<string, any>;
/** Prywatny bucket Materiałów (jak `MATERIALS_BUCKET` w `materials.server.ts`). */
const MATERIALS_BUCKET = 'materials';
const LINK_COLUMNS = 'id,company_id,token,title,message,access_mode,allowed_emails,password_hash,expires_at,revoked_at';
const THUMB_TTL = 3600;
const FILE_TTL = 15 * 60;
const ZIP_SIGN_TTL = 3 * 3600;
const SESSION_DAYS = 7;
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const ATTEMPTS_PER_CLIENT = 8;
const ATTEMPTS_PER_LINK = 30;

export type ShareBrand = {
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  logoUrl: string | null;
  accent: string;
  headingFontFamily: string | null;
  headingFontUrl: string | null;
};

export type PublicShareFile = Omit<ShareFile, 'storagePath' | 'thumbnailPath'> & { thumbnailUrl: string | null };
export type PublicShareSection = { key: string; kind: MaterialShareItemKind | 'files'; title: string; bytes: number; files: PublicShareFile[] };

export type PublicShareView =
  | { status: 'missing' }
  | { status: 'expired' | 'revoked'; brand: ShareBrand; title: string }
  | { status: 'locked'; brand: ShareBrand; title: string; expiresAt: string }
  | {
    status: 'open';
    brand: ShareBrand;
    title: string;
    message: string;
    expiresAt: string;
    access: MaterialShareAccess;
    email: string | null;
    sections: PublicShareSection[];
    fileCount: number;
    totalBytes: number;
    truncated: boolean;
    zipMaxBytes: number;
  };

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const isUrl = (value: string) => /^https?:\/\//i.test(value);
const HEX = /^#[0-9a-f]{6}$/i;

async function linkByToken(admin: SupabaseClient, token: string) {
  if (!SHARE_TOKEN.test(token)) return null;
  const { data, error } = await admin.from('material_share_links').select(LINK_COLUMNS).eq('token', token).maybeSingle();
  if (error) {
    console.error('[material-share] link', error.code, error.message);
    throw new Error('Nie udało się otworzyć linku. Spróbuj ponownie za chwilę.');
  }
  return (data as Row | null) || null;
}

/** Marka linku z księgi znaku: nazwa i kontakt, domyślne logo, kolor akcentu, font nagłówków. */
async function brandOf(admin: SupabaseClient, companyId: string): Promise<ShareBrand> {
  const [company, logos, colors, fonts] = await Promise.all([
    admin.from('my_companies').select('name,email,phone,website,logo_url').eq('id', companyId).maybeSingle(),
    admin.from('company_brandbook_logos').select('url,is_default,background,order_index').eq('company_id', companyId)
      .order('is_default', { ascending: false }).order('order_index'),
    admin.from('company_brandbook_colors').select('hex,role').eq('company_id', companyId),
    admin.from('company_brandbook_fonts').select('family,role,file_url,storage_path,order_index').eq('company_id', companyId).order('order_index'),
  ]);
  const row = (company.data || {}) as Row;
  const publicUrl = (path: string) => admin.storage.from('company-logos').getPublicUrl(path).data.publicUrl;
  const logoRows = (logos.data || []) as Row[];
  const logo = logoRows.find((entry) => entry.is_default) || logoRows.find((entry) => entry.background === 'transparent') || logoRows[0];
  const rawLogo = text(logo?.url || row.logo_url);
  const palette = new Map(((colors.data || []) as Row[]).map((color) => [text(color.role).toLowerCase(), text(color.hex)]));
  const accent = [palette.get('accent'), palette.get('gold'), palette.get('secondary')].find((hex) => hex && HEX.test(hex)) || '#d3bb73';
  const fontRows = (fonts.data || []) as Row[];
  const heading = fontRows.find((font) => text(font.role).toLowerCase() === 'heading' && (font.file_url || font.storage_path));
  const headingUrl = heading ? text(heading.file_url) || (heading.storage_path ? publicUrl(text(heading.storage_path)) : '') : '';
  return {
    name: text(row.name) || 'Mavinci',
    email: text(row.email) || null,
    phone: text(row.phone) || null,
    website: text(row.website) || null,
    logoUrl: rawLogo ? (isUrl(rawLogo) ? rawLogo : publicUrl(rawLogo)) : null,
    accent,
    headingFontFamily: heading ? text(heading.family).replace(/[^\p{L}\p{N} _-]/gu, '').trim() || null : null,
    headingFontUrl: headingUrl && /^https:\/\//i.test(headingUrl) ? headingUrl : null,
  };
}

/** Sesja linku z hasłem z ciasteczka (`null` — brak albo wygasła). */
async function sessionOf(admin: SupabaseClient, link: Row, cookie: string | null | undefined) {
  if (!cookie || !/^[A-Za-z0-9_-]{32,64}$/.test(cookie)) return null;
  const { data } = await admin.from('material_share_sessions').select('id,email,expires_at')
    .eq('link_id', link.id).eq('session_hash', sha256Hex(cookie)).gt('expires_at', new Date().toISOString()).maybeSingle();
  const row = data as Row | null;
  // Adres usunięty z listy linku — sesja przestaje działać.
  if (!row || !(link.allowed_emails || []).includes(text(row.email))) return null;
  return row;
}

type Access =
  | { ok: false; view: PublicShareView }
  | { ok: true; admin: SupabaseClient; link: Row; email: string | null };

async function access(token: string, cookie: string | null | undefined, withBrand: boolean): Promise<Access> {
  const admin = createSupabaseAdminClient();
  const link = await linkByToken(admin, token);
  if (!link) return { ok: false, view: { status: 'missing' } };
  const status = materialShareStatus({ expiresAt: String(link.expires_at), revokedAt: link.revoked_at ?? null });
  if (status !== 'active') {
    return { ok: false, view: withBrand ? { status, brand: await brandOf(admin, String(link.company_id)), title: text(link.title) } : { status: 'missing' } };
  }
  if (link.access_mode === 'password') {
    const session = await sessionOf(admin, link, cookie);
    if (!session) {
      return {
        ok: false,
        view: withBrand
          ? { status: 'locked', brand: await brandOf(admin, String(link.company_id)), title: text(link.title), expiresAt: String(link.expires_at) }
          : { status: 'missing' },
      };
    }
    return { ok: true, admin, link, email: text(session.email) };
  }
  return { ok: true, admin, link, email: null };
}

async function itemsOf(admin: SupabaseClient, link: Row): Promise<ShareItemRow[]> {
  const { data, error } = await admin.from('material_share_link_items').select('kind,item_id,sort_order').eq('link_id', link.id);
  if (error) throw new Error('Nie udało się odczytać zawartości linku.');
  return ((data || []) as Row[]).map((row): ShareItemRow => ({
    kind: row.kind as MaterialShareItemKind, item_id: String(row.item_id), sort_order: Number(row.sort_order || 0),
  }));
}

async function contentsOf(admin: SupabaseClient, link: Row): Promise<ShareContents> {
  return shareContents(admin, String(link.company_id), await itemsOf(admin, link));
}

/**
 * Czy plik jest w linku (bez liczenia całej zawartości — podgląd i pobranie pojedynczego pliku): wskazany wprost, w albumie
 * linku albo w udostępnionym folderze (także w podfolderze). Zwraca wiersz pliku marki linku albo `null`.
 */
async function fileInShare(admin: SupabaseClient, link: Row, fileId: string): Promise<Row | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)) return null;
  const companyId = String(link.company_id);
  const [{ data: fileData }, items] = await Promise.all([
    admin.from('material_files').select('id,folder_id,name,storage_path').eq('id', fileId).eq('company_id', companyId).eq('status', 'ready').maybeSingle(),
    itemsOf(admin, link),
  ]);
  const file = fileData as Row | null;
  if (!file?.storage_path) return null;
  if (items.some((item) => item.kind === 'file' && item.item_id === fileId)) return file;
  const albumIds = items.filter((item) => item.kind === 'album').map((item) => item.item_id);
  if (albumIds.length) {
    const { data } = await admin.from('material_album_items').select('album_id').eq('file_id', fileId).eq('company_id', companyId).in('album_id', albumIds).limit(1);
    if ((data || []).length) return file;
  }
  const folderIds = new Set(items.filter((item) => item.kind === 'folder').map((item) => item.item_id));
  let current: string | null = file.folder_id ? String(file.folder_id) : null;
  for (let depth = 0; current && depth < 40; depth += 1) {
    if (folderIds.has(current)) return file;
    const { data } = await admin.from('material_folders').select('parent_id').eq('id', current).eq('company_id', companyId).maybeSingle();
    current = (data as Row | null)?.parent_id ? String((data as Row).parent_id) : null;
  }
  return null;
}

async function signed(admin: SupabaseClient, paths: string[], ttl: number) {
  const urls = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 100) {
    const { data } = await admin.storage.from(MATERIALS_BUCKET).createSignedUrls(unique.slice(i, i + 100), ttl);
    for (const item of data || []) if (item?.signedUrl && item.path) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

const touch = (admin: SupabaseClient, linkId: string, kind: 'view' | 'download') =>
  admin.rpc('material_share_touch', { p_link: linkId, p_kind: kind }).then(() => undefined, () => undefined);

/** Strona linku: stan (brak, wygasł, wyłączony, wymaga hasła) albo pliki w częściach z miniaturami. */
export async function publicShareView(token: string, cookie: string | null | undefined): Promise<PublicShareView> {
  const result = await access(token, cookie, true);
  if (!result.ok) return result.view;
  const { admin, link, email } = result;
  const [brand, contents] = await Promise.all([brandOf(admin, String(link.company_id)), contentsOf(admin, link)]);
  const files = contents.sections.flatMap((section) => section.files);
  const thumbs = await signed(admin, files.map((file) => file.thumbnailPath || ''), THUMB_TTL);
  void touch(admin, String(link.id), 'view');
  return {
    status: 'open',
    brand,
    title: text(link.title),
    message: text(link.message),
    expiresAt: String(link.expires_at),
    access: link.access_mode === 'password' ? 'password' : 'public',
    email,
    sections: contents.sections.map((section) => ({
      key: section.key,
      kind: section.kind,
      title: section.title,
      bytes: section.bytes,
      files: section.files.map(({ storagePath: _path, thumbnailPath, ...file }) => ({
        ...file, thumbnailUrl: thumbnailPath ? thumbs.get(thumbnailPath) || null : null,
      })),
    })),
    fileCount: contents.fileCount,
    totalBytes: contents.totalBytes,
    truncated: contents.truncated,
    zipMaxBytes: ZIP_MAX_BYTES,
  };
}

export type UnlockResult =
  | { ok: true; cookieName: string; cookieValue: string; maxAge: number }
  | { ok: false; status: number; error: string };

/** E-mail z listy linku i hasło → sesja (ciasteczko). `client` — skrót adresu IP (ograniczenie prób). */
export async function unlockShare(token: string, emailValue: unknown, passwordValue: unknown, client: string): Promise<UnlockResult> {
  const admin = createSupabaseAdminClient();
  const link = await linkByToken(admin, token);
  if (!link) return { ok: false, status: 404, error: 'Ten link nie istnieje albo został usunięty.' };
  const status = materialShareStatus({ expiresAt: String(link.expires_at), revokedAt: link.revoked_at ?? null });
  if (status !== 'active') return { ok: false, status: 410, error: status === 'expired' ? 'Ten link wygasł.' : 'Ten link został wyłączony.' };
  if (link.access_mode !== 'password') return { ok: false, status: 400, error: 'Ten link nie wymaga hasła — odśwież stronę.' };

  const clientHash = sha256Hex(`${link.id}:${client}`);
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();
  const [perClient, perLink] = await Promise.all([
    admin.from('material_share_attempts').select('id', { count: 'exact', head: true })
      .eq('link_id', link.id).eq('client_hash', clientHash).eq('succeeded', false).gte('created_at', since),
    admin.from('material_share_attempts').select('id', { count: 'exact', head: true })
      .eq('link_id', link.id).eq('succeeded', false).gte('created_at', since),
  ]);
  if (Number(perClient.count || 0) >= ATTEMPTS_PER_CLIENT || Number(perLink.count || 0) >= ATTEMPTS_PER_LINK) {
    return { ok: false, status: 429, error: 'Za dużo nieudanych prób. Spróbuj ponownie za 15 minut.' };
  }

  const email = materialShareEmails(emailValue).emails[0] || '';
  const password = text(passwordValue);
  const allowed = email && (link.allowed_emails || []).includes(email);
  // Hasło sprawdzamy zawsze (także przy złym e-mailu) — odpowiedź trwa tyle samo.
  const passwordOk = password.length > 0 && password.length <= 200 && await verifySharePassword(password, link.password_hash);
  const succeeded = Boolean(allowed && passwordOk);
  await admin.from('material_share_attempts').insert({ link_id: link.id, client_hash: clientHash, succeeded });
  // Sprzątanie: próby starsze niż doba i wygasłe sesje tego linku.
  void admin.from('material_share_attempts').delete().eq('link_id', link.id).lt('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
    .then(() => undefined, () => undefined);
  void admin.from('material_share_sessions').delete().eq('link_id', link.id).lt('expires_at', new Date().toISOString())
    .then(() => undefined, () => undefined);
  if (!succeeded) return { ok: false, status: 401, error: 'Nieprawidłowy adres e-mail albo hasło.' };

  const key = newSessionKey();
  const expires = Math.min(Date.parse(String(link.expires_at)), Date.now() + SESSION_DAYS * 24 * 3600_000);
  const { error } = await admin.from('material_share_sessions').insert({
    link_id: link.id, session_hash: sha256Hex(key), email, expires_at: new Date(expires).toISOString(), last_seen_at: new Date().toISOString(),
  });
  if (error) return { ok: false, status: 500, error: 'Nie udało się otworzyć linku. Spróbuj ponownie.' };
  return { ok: true, cookieName: shareCookieName(token), cookieValue: key, maxAge: Math.max(60, Math.floor((expires - Date.now()) / 1000)) };
}

/** Adres pliku z linku: podgląd albo pobranie z nazwą (`null` — brak dostępu albo pliku nie ma w linku). */
export async function shareFileUrl(token: string, cookie: string | null | undefined, fileId: string, mode: 'preview' | 'download') {
  const result = await access(token, cookie, false);
  if (!result.ok) return null;
  const { admin, link } = result;
  const file = await fileInShare(admin, link, fileId.toLowerCase());
  if (!file) return null;
  const { data, error } = await admin.storage.from(MATERIALS_BUCKET)
    .createSignedUrl(String(file.storage_path), FILE_TTL, mode === 'download' ? { download: text(file.name) || 'plik' } : undefined);
  if (error || !data?.signedUrl) return null;
  if (mode === 'download') void touch(admin, String(link.id), 'download');
  return data.signedUrl;
}

export type ShareZip =
  | { ok: true; stream: ReadableStream<Uint8Array>; filename: string }
  | { ok: false; status: number; error: string };

/** Archiwum ZIP całego linku (`section` puste) albo jednej części (folder, album, pliki). */
export async function shareZip(token: string, cookie: string | null | undefined, section: string | null): Promise<ShareZip> {
  const result = await access(token, cookie, false);
  if (!result.ok) return { ok: false, status: 404, error: 'Link wygasł, został wyłączony albo wymaga podania hasła.' };
  const { admin, link } = result;
  const contents = await contentsOf(admin, link);
  const sections = section ? contents.sections.filter((entry) => entry.key === section) : contents.sections;
  const files = sections.flatMap((entry) => entry.files.map((file) => ({ section: entry, file })));
  if (!files.length) return { ok: false, status: 404, error: 'Brak plików do pobrania.' };
  const bytes = files.reduce((sum, entry) => sum + entry.file.size, 0);
  if (bytes > ZIP_MAX_BYTES || files.length > ZIP_MAX_ENTRIES) {
    return { ok: false, status: 413, error: 'Za dużo na jedno archiwum (ponad 4 GB) — pobierz foldery osobno albo pliki pojedynczo.' };
  }
  const root = zipSafeName(text(link.title), 'Pliki');
  const single = sections.length === 1;
  const paths = uniqueZipPaths(files.map(({ section: part, file }) => [
    root,
    ...(single || part.kind === 'files' ? [] : [zipSafeName(part.title, 'Folder')]),
    ...file.dir.split('/').filter(Boolean).map((name) => zipSafeName(name, 'Folder')),
    zipSafeName(file.name),
  ].join('/')));

  // Podpisane adresy porcjami po 100, gdy archiwum do nich dojdzie (długie pobieranie — adresy nie wygasają w trakcie).
  const urls = new Map<string, string>();
  const signAround = async (index: number) => {
    const batch = files.slice(index, index + 100).map((entry) => entry.file.storagePath).filter((path) => path && !urls.has(path));
    if (!batch.length) return;
    for (const [path, url] of await signed(admin, batch, ZIP_SIGN_TTL)) urls.set(path, url);
  };
  const entries: ZipEntry[] = files.map(({ file }, index) => ({
    name: paths[index],
    modified: file.updatedAt ? new Date(file.updatedAt) : null,
    open: async () => {
      if (!file.storagePath) return null;
      if (!urls.has(file.storagePath)) await signAround(index);
      const url = urls.get(file.storagePath);
      if (!url) return null;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok || !response.body) return null;
      return response.body as unknown as AsyncIterable<Uint8Array>;
    },
  }));
  void touch(admin, String(link.id), 'download');
  const part = single && sections[0].kind !== 'files' && contents.sections.length > 1 ? ` - ${zipSafeName(sections[0].title, 'Folder')}` : '';
  return {
    ok: true,
    stream: zipStream(entries, (name) => console.warn('[material-share] zip pominięto', name)),
    filename: `${root}${part}.zip`,
  };
}
