import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

/*
 * Wydania aplikacji Mavinci na Maca: `yarn dmg` (desktop/mac/scripts/release.sh) buduje aplikację, instalator DMG i paczkę
 * aktualizacji (ZIP z podpisaną aplikacją), a potem wysyła je na serwer CRM do katalogu wydań (poza katalogiem aplikacji
 * Next, więc `yarn deploy` ich nie usuwa) razem z opisem `latest.json`. Aplikacja na Macu sprawdza nowszą wersję
 * i pobiera paczkę aktualizacji, a CRM (Ustawienia → Ogólne) — instalator. Pliki wydaje serwer tylko zalogowanym
 * pracownikom: tokenem sesji albo podpisanym adresem, ważnym godzinę (Dysk → Programy w przeglądarce, na Macu i w Finderze).
 */

const ROOT = process.env.DESKTOP_RELEASES_DIR || '/var/www/mavinci/desktop-releases';
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const SHA = /^[0-9a-f]{64}$/;

export type DesktopPlatform = 'mac';
export type DesktopReleaseFile = { file: string; size: number; sha256: string };
export type DesktopRelease = {
  platform: DesktopPlatform;
  version: string;
  build: string;
  publishedAt: string | null;
  notes: string;
  minimumSystem: string;
  notarized: boolean;
  dmg: DesktopReleaseFile;
  zip: DesktopReleaseFile;
};
export type DesktopDownloadKind = 'dmg' | 'zip';

const releaseFile = (value: unknown): DesktopReleaseFile | null => {
  const row = (value || {}) as Record<string, unknown>;
  const file = String(row.file || '');
  const size = Number(row.size);
  const sha256 = String(row.sha256 || '').toLowerCase();
  if (!FILE.test(file) || !Number.isFinite(size) || size <= 0 || !SHA.test(sha256)) return null;
  return { file, size, sha256 };
};

/** Opis bieżącego wydania (`<katalog wydań>/<platforma>/latest.json`); brak albo błędny opis — `null`. */
export async function latestDesktopRelease(platform: DesktopPlatform = 'mac'): Promise<DesktopRelease | null> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await fs.readFile(path.join(ROOT, platform, 'latest.json'), 'utf8'));
  } catch {
    return null;
  }
  const version = String(raw.version || '');
  const build = String(raw.build || '');
  const dmg = releaseFile(raw.dmg);
  const zip = releaseFile(raw.zip);
  if (!/^\d+(?:\.\d+){1,3}$/.test(version) || !/^\d{8,14}$/.test(build) || !dmg || !zip) {
    console.error('[desktop release] nieprawidłowy opis wydania', platform);
    return null;
  }
  return {
    platform,
    version,
    build,
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : null,
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 4000) : '',
    minimumSystem: typeof raw.minimumSystem === 'string' ? raw.minimumSystem : '14.0',
    notarized: raw.notarized === true,
    dmg,
    zip,
  };
}

/** Porównanie numerów kompilacji (same cyfry, RRRRMMDDGGMM): dłuższy jest większy, przy równej długości — kolejność znaków. */
const compareBuilds = (a: string, b: string) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0);

/** Czy wydanie jest nowsze od kompilacji aplikacji (bez numeru kompilacji — tak). */
export const isNewerBuild = (release: DesktopRelease, build: string | null | undefined) =>
  /^\d{8,14}$/.test(build || '') ? compareBuilds(release.build, String(build)) > 0 : true;

// MARK: Podpisane adresy (Dysk → Programy) — pobranie bez nagłówka z tokenem, np. zwykłym linkiem w przeglądarce

const LINK_TTL = 60 * 60;
const linkSignature = (kind: string, build: string, expires: number) =>
  createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY || '').update(`desktop-download-v1:${kind}:${build}:${expires}`).digest('hex');

/** Adres pliku wydania bez tokenu: ważny godzinę, tylko dla tego wydania (ścieżka względna — pełny adres dopisuje trasa). */
export function signedDesktopLink(release: DesktopRelease, kind: DesktopDownloadKind) {
  const expires = Math.floor(Date.now() / 1000) + LINK_TTL;
  const query = new URLSearchParams({ op: 'file', kind, build: release.build, expires: String(expires), signature: linkSignature(kind, release.build, expires) });
  return `/bridge/native/v1/desktop?${query.toString()}`;
}

/** Sprawdzenie podpisanego adresu: rodzaj pliku, wydanie, termin ważności i podpis (bez klucza serwera — zawsze odmowa). */
export function verifyDesktopLink(params: URLSearchParams): { kind: DesktopDownloadKind; build: string } | null {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const kind = params.get('kind');
  const build = params.get('build') || '';
  const expires = Number(params.get('expires'));
  const signature = params.get('signature') || '';
  if ((kind !== 'dmg' && kind !== 'zip') || !/^\d{8,14}$/.test(build) || !Number.isInteger(expires) || !/^[0-9a-f]{64}$/.test(signature)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (expires < now || expires > now + LINK_TTL + 60) return null;
  const expected = Buffer.from(linkSignature(kind, build, expires), 'hex');
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected) ? { kind, build } : null;
}

/**
 * Publiczny adres serwera CRM dla aplikacji na Macu i Findera — host z nagłówków serwera pośredniczącego. Aplikacja łączy się
 * z CRM wyłącznie przez HTTPS (poza serwerem lokalnym), a Next za serwerem pośredniczącym może widzieć „http”, więc poza
 * localhost adres zawsze ma https.
 */
export function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').split(',')[0].trim();
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) return url.origin;
  if (!/^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i.test(host)) return `https://${host}`;
  const forwarded = (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
  return `${/^https?$/.test(forwarded) ? forwarded : url.protocol.replace(':', '')}://${host}`;
}

/** Plik wydania jako odpowiedź do pobrania (strumień z dysku serwera). */
export async function desktopDownload(release: DesktopRelease, kind: DesktopDownloadKind): Promise<Response | null> {
  const entry = kind === 'dmg' ? release.dmg : release.zip;
  const target = path.join(ROOT, release.platform, entry.file);
  let size: number;
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) return null;
    size = stat.size;
  } catch {
    return null;
  }
  const name = `Mavinci-${release.version}${kind === 'dmg' ? '.dmg' : '.zip'}`;
  const stream = Readable.toWeb(createReadStream(target)) as unknown as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      'Content-Type': kind === 'dmg' ? 'application/x-apple-diskimage' : 'application/zip',
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-SHA256': entry.sha256,
    },
  });
}
