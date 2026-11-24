/*
 * Materiały — wspólne stałe i funkcje CRM (web), serwera Next i — od etapu 3 — telefonu (kopia w `mobile/src/lib`).
 * Bez importów: plik musi działać w przeglądarce, na serwerze i w React Native.
 */

/** Największy plik w Materiałach (bucket `materials`, kolumna `material_files.size_bytes`). */
export const MATERIALS_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
/** Ile dni element czeka w koszu, zanim zniknie na zawsze. */
export const MATERIALS_TRASH_DAYS = 30;
/**
 * Najwięcej elementów w jednym zapytaniu operacji zbiorczej (przenoszenie, kopiowanie, kosz, albumy). Większe zaznaczenie aplikacje
 * wysyłają w kolejnych porcjach (`materialChunks`, `mergeMaterialReplies`) — serwer resztę ponad limit by pominął.
 */
export const MATERIALS_MAX_BATCH = 100;
/**
 * Najwięcej plików w jednej wysyłce. Pliki idą po kolei, każdy osobno, więc to tylko zabezpieczenie przed przypadkowym upuszczeniem
 * ogromnego folderu (np. całej biblioteki zdjęć); miejsce na Dysku sprawdza serwer przy każdym pliku.
 */
export const MATERIALS_MAX_UPLOAD = 2000;

export type MaterialAccess = { view: boolean; manage: boolean; admin: boolean; employeeId: string | null };
export const NO_MATERIAL_ACCESS: MaterialAccess = { view: false, manage: false, admin: false, employeeId: null };

export type MaterialSystemFolder = 'brand' | 'photos' | 'video' | 'presentations' | 'documents' | 'social';
/** Domyślne foldery każdej marki (tworzy je baza — `material_default_folders`). */
export const MATERIAL_SYSTEM_FOLDERS: Record<MaterialSystemFolder, string> = {
  brand: 'Logotypy i księga znaku',
  photos: 'Zdjęcia',
  video: 'Wideo',
  presentations: 'Prezentacje i oferty',
  documents: 'Dokumenty',
  social: 'Social media',
};

export type MaterialKind =
  | 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'design' | 'archive' | 'font' | 'other';

export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  image: 'Zdjęcie',
  video: 'Wideo',
  audio: 'Dźwięk',
  pdf: 'PDF',
  document: 'Dokument',
  spreadsheet: 'Arkusz',
  presentation: 'Prezentacja',
  design: 'Projekt graficzny',
  archive: 'Archiwum',
  font: 'Font',
  other: 'Plik',
};

const EXTENSION_KINDS: Record<string, MaterialKind> = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', heic: 'image', heif: 'image', avif: 'image', bmp: 'image',
  tif: 'image', tiff: 'image', svg: 'image', raw: 'image', cr2: 'image', cr3: 'image', nef: 'image', arw: 'image', dng: 'image',
  mp4: 'video', mov: 'video', m4v: 'video', avi: 'video', mkv: 'video', webm: 'video', mxf: 'video', mpg: 'video', mpeg: 'video',
  mp3: 'audio', wav: 'audio', aac: 'audio', m4a: 'audio', flac: 'audio', aif: 'audio', aiff: 'audio', ogg: 'audio',
  pdf: 'pdf',
  doc: 'document', docx: 'document', odt: 'document', rtf: 'document', txt: 'document', md: 'document', pages: 'document',
  xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet', csv: 'spreadsheet', numbers: 'spreadsheet',
  ppt: 'presentation', pptx: 'presentation', odp: 'presentation', key: 'presentation',
  psd: 'design', ai: 'design', eps: 'design', indd: 'design', fig: 'design', sketch: 'design', xd: 'design', afdesign: 'design',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font',
};

/** Rozszerzenie nazwy pliku małymi literami (bez kropki) albo pusty tekst. */
export function materialExtension(name: string | null | undefined): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(name || ''));
  return match && match.index > 0 ? match[1].toLowerCase() : '';
}

/** Rodzaj pliku z typu MIME i rozszerzenia (ikona, filtr, podgląd). */
export function materialKind(mime: string | null | undefined, name?: string | null): MaterialKind {
  const type = String(mime || '').toLowerCase();
  if (type === 'application/pdf') return 'pdf';
  const byExtension = EXTENSION_KINDS[materialExtension(name)];
  if (byExtension) return byExtension;
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('font/')) return 'font';
  if (/zip|rar|7z|tar|gzip/.test(type)) return 'archive';
  if (/spreadsheet|excel|csv/.test(type)) return 'spreadsheet';
  if (/presentation|powerpoint|keynote/.test(type)) return 'presentation';
  if (/word|opendocument\.text|rtf|text\//.test(type)) return 'document';
  return 'other';
}

/** Czy przeglądarka pokaże plik w podglądzie (zdjęcie, PDF, wideo, dźwięk). */
export function materialPreviewable(kind: MaterialKind, mime: string | null | undefined, name?: string | null): boolean {
  const ext = materialExtension(name);
  if (kind === 'image') return !['heic', 'heif', 'tif', 'tiff', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng'].includes(ext);
  if (kind === 'pdf') return true;
  if (kind === 'video') return ['mp4', 'm4v', 'mov', 'webm'].includes(ext) || /^video\/(mp4|webm|quicktime)$/.test(String(mime || ''));
  if (kind === 'audio') return ['mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext);
  return false;
}

/** Rozmiar pliku po polsku: „824 KB”, „1,4 MB”, „2 GB”. */
export function formatMaterialBytes(bytes: number | null | undefined): string {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = size >= 100 || unit === 0 ? 0 : 1;
  return `${size.toFixed(digits).replace('.', ',').replace(/,0$/, '')} ${units[unit]}`;
}

/** Czas trwania „1:05” / „1:02:03”. */
export function formatMaterialDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Nazwa pliku lub folderu jak w bazie: bez znaków sterujących, bez spacji na początku i końcu, do 255 znaków,
 * nie „.” ani „..”. `null`, gdy nic nie zostaje.
 */
export function cleanMaterialName(value: unknown): string | null {
  const name = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255).trim();
  if (!name || name === '.' || name === '..') return null;
  return name;
}

/** „Nazwa (2).pdf” — kolejna wolna nazwa przy konflikcie (`n` od 2). */
export function numberedMaterialName(name: string, n: number): string {
  const ext = materialExtension(name);
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  const suffix = ` (${n})`;
  const room = 255 - suffix.length - (ext ? ext.length + 1 : 0);
  return `${base.slice(0, Math.max(1, room)).trimEnd()}${suffix}${ext ? `.${name.slice(-ext.length)}` : ''}`;
}

/** Albumy (Materiały → Albumy): odnośniki do plików marki, bez kopiowania. */
export const MATERIAL_ALBUM_LIMITS = { name: 120, description: 1000, batch: 500 } as const;

/** Nazwa albumu jak w bazie: jedna linia, bez znaków sterujących, do 120 znaków; `null`, gdy nic nie zostaje. */
export function cleanMaterialAlbumName(value: unknown): string | null {
  const name = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MATERIAL_ALBUM_LIMITS.name).trim();
  return name || null;
}

/** Tagi jak w bazie: przycięte, do 40 znaków, bez powtórzeń (bez względu na wielkość liter), najwięcej 30. */
export function cleanMaterialTags(value: unknown): string[] {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of list) {
    const tag = String(raw ?? '').replace(/^#+/, '').trim().slice(0, 40).trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length >= 30) break;
  }
  return tags;
}

/** Porcje listy po `size` elementów (operacje zbiorcze — serwer przyjmuje najwyżej `MATERIALS_MAX_BATCH` naraz). */
export function materialChunks<T>(list: readonly T[], size: number = MATERIALS_MAX_BATCH): T[][] {
  const step = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let i = 0; i < list.length; i += step) chunks.push(list.slice(i, i + step));
  return chunks;
}

/** Odpowiedzi kolejnych porcji tej samej operacji jako jedna: liczby się sumują, listy łączą, pozostałe pola — z pierwszej odpowiedzi. */
export function mergeMaterialReplies<T extends object>(replies: readonly T[]): T {
  const merged: Record<string, unknown> = {};
  for (const reply of replies) {
    for (const [key, value] of Object.entries(reply as Record<string, unknown>)) {
      const current = merged[key];
      if (typeof value === 'number' && (current === undefined || typeof current === 'number')) {
        merged[key] = (typeof current === 'number' ? current : 0) + value;
      } else if (Array.isArray(value)) {
        merged[key] = Array.isArray(current) ? [...current, ...value] : [...value];
      } else if (!(key in merged)) {
        merged[key] = value;
      }
    }
  }
  return merged as T;
}

/** „1 plik”, „2 pliki”, „5 plików”; „1 folder”, „3 foldery”, „12 folderów”. */
export function materialCountLabel(count: number, kind: 'file' | 'folder'): string {
  const [one, few, many] = kind === 'file' ? ['plik', 'pliki', 'plików'] : ['folder', 'foldery', 'folderów'];
  const last = count % 10;
  const tens = count % 100;
  if (count === 1) return `1 ${one}`;
  return `${count} ${last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? few : many}`;
}

/** Opis zaznaczenia: „10 plików · 2 foldery · 24,3 MB” (rozmiar — samych plików). */
export function materialSelectionSummary(files: number, folders: number, bytes: number): string {
  return [
    files ? materialCountLabel(files, 'file') : null,
    folders ? materialCountLabel(folders, 'folder') : null,
    files ? formatMaterialBytes(bytes) : null,
  ].filter(Boolean).join(' · ');
}

// MARK: Linki do pobrania (udostępnianie na zewnątrz)

/*
 * „Udostępnij link” — folder, album albo wybrane pliki Materiałów do pobrania przez osobę spoza firmy (np. zdjęcia z fotobudki
 * dla pary młodej): link ważny kilka dni, otwarty dla każdego, kto go ma, albo po podaniu e-maila i hasła. Strona
 * `/pobierz/<token>` pokazuje miniatury i pozwala pobrać pliki pojedynczo albo wszystkie w jednym archiwum ZIP. Folder
 * w linku jest „na żywo” — pliki dodane później też są do pobrania. Linki tworzy i wyłącza „Materiały — zarządzanie”.
 * Serwer — `src/lib/materials/materialShares.server.ts` (zarządzanie) i `materialSharePublic.server.ts` (strona publiczna).
 */

export type MaterialShareAccess = 'public' | 'password';
export type MaterialShareItemKind = 'folder' | 'file' | 'album';
export type MaterialShareStatus = 'active' | 'expired' | 'revoked';

/** Ważność do wyboru (dni) i domyślna. */
export const MATERIAL_SHARE_DAYS = [1, 3, 7, 14, 30] as const;
export const MATERIAL_SHARE_DEFAULT_DAYS = 3;
export const MATERIAL_SHARE_LIMITS = {
  title: 120,
  message: 2000,
  /** Adresy e-mail odbiorców linku z hasłem. */
  emails: 10,
  passwordMin: 8,
  passwordMax: 64,
  /** Najdłuższa ważność od teraz (dni). */
  maxDays: 90,
  /** Elementy (foldery, albumy, pliki) w jednym linku. */
  items: 500,
  /** Najwięcej plików do pobrania z jednego linku. */
  files: 5000,
} as const;

/** Element linku z nazwą (`missing` — usunięty z Materiałów, nie trafia na stronę). */
export type MaterialShareItem = { kind: MaterialShareItemKind; id: string; name: string; missing: boolean };

/** Link na liście „Udostępnione linki”. */
export type MaterialShare = {
  id: string;
  companyId: string;
  url: string;
  title: string;
  message: string;
  access: MaterialShareAccess;
  emails: string[];
  expiresAt: string;
  revokedAt: string | null;
  status: MaterialShareStatus;
  items: MaterialShareItem[];
  fileCount: number;
  totalBytes: number;
  viewCount: number;
  downloadCount: number;
  lastViewedAt: string | null;
  lastDownloadedAt: string | null;
  /** Adresy e-mail, którymi otwarto link z hasłem (ostatnie najpierw). */
  openedBy: string[];
  createdAt: string;
  createdBy: string | null;
};

/** Odpowiedź po utworzeniu linku albo nowym haśle: link i hasło do przekazania (hasła nie da się później odczytać). */
export type MaterialShareCreated = { share: MaterialShare; password: string | null };

export const MATERIAL_SHARE_ACCESS_LABELS: Record<MaterialShareAccess, string> = {
  public: 'Każdy, kto ma link',
  password: 'Po podaniu e-maila i hasła',
};

export const MATERIAL_SHARE_STATUS_LABELS: Record<MaterialShareStatus, string> = {
  active: 'Aktywny',
  expired: 'Wygasł',
  revoked: 'Wyłączony',
};

/** Stan linku w chwili `now`. */
export function materialShareStatus(share: { expiresAt: string; revokedAt: string | null }, now: number = Date.now()): MaterialShareStatus {
  if (share.revokedAt) return 'revoked';
  const expires = Date.parse(share.expiresAt);
  return Number.isFinite(expires) && expires > now ? 'active' : 'expired';
}

/** „1 dzień”, „3 dni”, „30 dni”. */
export function materialShareDaysLabel(days: number): string {
  return days === 1 ? '1 dzień' : `${days} dni`;
}

/** Koniec ważności: teraz + `days` dni (najwyżej `maxDays`). */
export function materialShareExpiry(days: number, from: number = Date.now()): string {
  const safe = Math.min(MATERIAL_SHARE_LIMITS.maxDays, Math.max(1, Math.round(Number(days) || MATERIAL_SHARE_DEFAULT_DAYS)));
  return new Date(from + safe * 24 * 3600_000).toISOString();
}

/** „27.11.2026, 15:40” (czas urządzenia albo `timeZone`, np. `Europe/Warsaw` na serwerze). */
export function materialShareDateLabel(value: string | null | undefined, timeZone?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', ...(timeZone ? { timeZone } : {}),
  });
}

const SHARE_EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

/** Adresy e-mail z pola (przecinki, średniki, spacje, nowe linie): małe litery, bez powtórzeń; `invalid` — niepoprawne. */
export function materialShareEmails(value: unknown): { emails: string[]; invalid: string[] } {
  const list = Array.isArray(value) ? value.map(String) : String(value ?? '').split(/[\s,;]+/);
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const raw of list) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    if (!SHARE_EMAIL.test(email) || email.length > 254) invalid.push(raw.trim());
    else if (!emails.includes(email)) emails.push(email);
  }
  return { emails, invalid };
}

/** „248 plików · 1,2 GB”. */
export function materialShareSummary(fileCount: number, totalBytes: number): string {
  return fileCount ? `${materialCountLabel(fileCount, 'file')} · ${formatMaterialBytes(totalBytes)}` : 'Brak plików';
}

/**
 * Wiadomość dla odbiorcy (e-mail, SMS, komunikator): link, ważność i — przy linku z hasłem — e-mail i hasło.
 * `password` — tylko zaraz po utworzeniu linku albo ustawieniu nowego hasła (później hasła nie da się odczytać).
 */
export function materialShareMessage(input: {
  url: string; title: string; expiresAt: string; access: MaterialShareAccess; emails: string[]; password?: string | null; companyName?: string | null;
}): string {
  const lines = [
    'Dzień dobry,',
    '',
    `przesyłamy link do pobrania plików „${input.title}”:`,
    input.url,
    '',
    `Link jest ważny do ${materialShareDateLabel(input.expiresAt)}. Pliki można pobrać pojedynczo albo wszystkie naraz (ZIP).`,
  ];
  if (input.access === 'password') {
    lines.push('');
    lines.push(input.emails.length === 1
      ? `Aby otworzyć stronę, podaj adres e-mail: ${input.emails[0]}`
      : 'Aby otworzyć stronę, podaj swój adres e-mail (ten, na który przyszła ta wiadomość).');
    lines.push(input.password ? `Hasło: ${input.password}` : 'Hasło przekażemy osobno.');
  }
  lines.push('', 'Pozdrawiamy', ...(input.companyName ? [input.companyName] : []));
  return lines.join('\n');
}
