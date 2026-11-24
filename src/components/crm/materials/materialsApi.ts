import { supabase } from '@/lib/supabase/browser';
import {
  materialChunks, mergeMaterialReplies, type MaterialAccess, type MaterialKind, type MaterialShare, type MaterialShareAccess, type MaterialShareCreated,
  type MaterialShareItemKind, type MaterialSystemFolder,
} from '@/lib/materials/materialsShared';
import { OFFER_IMAGE_SIDES, BROCHURE_IMAGE_SIDE, type ProductImageSource } from '@/lib/CRM/Offers/productImageSource';
import { optimizeOfferImage } from '@/lib/optimizeOfferImage';
import type { ProductDuplicateResult } from '@/lib/CRM/Offers/productDuplicate';

export type { MaterialAccess };

/*
 * Klient API Materiałów w CRM — to samo API co (w kolejnych etapach) Finder, Mac i telefon (`/bridge/native/v1/materials`,
 * token sesji pracownika, `x-mavinci-client: web`). Pliki idą z przeglądarki prosto do prywatnego bucketu `materials`
 * (podpisany adres, postęp wysyłki), miniaturę zdjęcia, PDF-a i wideo przygotowuje przeglądarka.
 */

export type MaterialCompany = { id: string; name: string; isDefault: boolean; access: MaterialAccess };
export type MaterialFolder = {
  id: string; companyId: string; parentId: string | null; name: string; systemKey: MaterialSystemFolder | null; sortOrder: number;
  createdAt: string | null; updatedAt: string | null; metaVersion: number;
};
export type MaterialFile = {
  id: string; companyId: string; folderId: string | null; name: string; status: 'uploading' | 'ready'; mime: string; kind: MaterialKind;
  size: number; sha256: string | null; contentVersion: number; metaVersion: number; width: number | null; height: number | null;
  duration: number | null; description: string; tags: string[]; eventId: string | null; sourceEventFileId: string | null;
  thumbnailUrl: string | null; createdAt: string | null; createdById: string | null; createdBy: string | null; updatedAt: string | null;
  updatedById: string | null; updatedBy: string | null;
};
export type MaterialsHome = {
  companies: MaterialCompany[]; company: MaterialCompany; access: MaterialAccess; folders: MaterialFolder[]; trashCount: number;
  eventsAccess: boolean; maxBytes: number;
};
export type MaterialsListing = {
  companyId: string; access: MaterialAccess; folder: MaterialFolder | null; path: MaterialFolder[]; folders: MaterialFolder[];
  files: MaterialFile[]; total: number; offset: number; limit: number;
};
export type MaterialSearchHit = MaterialFile & { companyName: string; path: Array<{ id: string; name: string }> };
export type EventFileHit = {
  id: string; eventId: string; eventName: string; eventDate: string | null; folderId: string | null; folderName: string | null;
  name: string; mime: string; kind: MaterialKind; size: number; createdAt: string | null; thumbnailUrl: string | null;
};
export type MaterialsSearch = { q: string; scope: 'materials' | 'events'; materials: MaterialSearchHit[]; events: EventFileHit[] };
export type MaterialVersion = {
  id: string; contentVersion: number; size: number; mime: string; width: number | null; height: number | null; replacedAt: string | null;
  replacedBy: string | null;
};
export type MaterialFileDetail = {
  file: MaterialFile; access: MaterialAccess; path: MaterialFolder[]; event: { id: string; name: string; date: string | null } | null;
  versions: MaterialVersion[];
};
export type MaterialTrashItem = {
  id: string; kind: 'file' | 'folder'; itemId: string; parentId: string | null; insideFolder: boolean; location: string | null;
  contains: number; name: string; size: number; mime: string; fileKind: MaterialKind; thumbnailUrl: string | null; batch: string;
  deletedAt: string; deletedBy: string | null; mine: boolean; purgeAfter: string;
};
export type MaterialUrl = { url: string; name: string; mime: string; size: number; kind: MaterialKind };
export type MaterialItemRef = { kind: 'file' | 'folder'; id: string; name: string };
/** Album (Materiały → Albumy): odnośniki do plików marki, bez kopii; `coverUrl` — miniatura okładki. */
export type MaterialAlbum = {
  id: string; companyId: string; name: string; description: string; coverFileId: string | null; sortOrder: number; count: number;
  coverUrl: string | null; createdAt: string | null; updatedAt: string | null;
};
export type MaterialBatchResult = { moved?: number; removed?: number; failed: Array<{ id: string; name: string; error: string }> };

const ENDPOINT = '/bridge/native/v1/materials';

type ApiError = Error & { status?: number; code?: string; file?: MaterialFile };

async function headers(json: boolean) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw Object.assign(new Error('Sesja wygasła. Zaloguj się ponownie.'), { status: 401 });
  return { Authorization: `Bearer ${token}`, 'x-mavinci-client': 'web', ...(json ? { 'Content-Type': 'application/json' } : {}) };
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body?.error || 'Operacja nie powiodła się.'), { status: response.status, code: body?.code, file: body?.file }) as ApiError;
  }
  return body as T;
}

export async function materialsGet<T>(op: string, params: Record<string, string | number | null | undefined> = {}): Promise<T> {
  const query = new URLSearchParams({ op });
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') query.set(key, String(value));
  return parse<T>(await fetch(`${ENDPOINT}?${query.toString()}`, { headers: await headers(false), cache: 'no-store' }));
}

export async function materialsPost<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
  return parse<T>(await fetch(ENDPOINT, { method: 'POST', headers: await headers(true), body: JSON.stringify({ ...body, op }) }));
}

// MARK: Linki do pobrania (`op=shares`, `shareCreate`, `shareUpdate`, `shareDelete`)

export type { MaterialShare, MaterialShareCreated };
/** Element do udostępnienia (folder z podfolderami, album albo plik) z nazwą do opisu w oknie. */
export type MaterialShareTarget = { kind: MaterialShareItemKind; id: string; name: string };
export type MaterialShareInput = {
  companyId: string; items: Array<{ kind: MaterialShareItemKind; id: string }>; title: string; message: string; days: number;
  access: MaterialShareAccess; emails: string[]; password: string;
};
export type MaterialShareChange = {
  id: string; title?: string; message?: string; days?: number; revoked?: boolean; access?: MaterialShareAccess; emails?: string[];
  newPassword?: boolean; password?: string;
};

export const materialShares = (companyId: string) => materialsGet<{ companyId: string; shares: MaterialShare[] }>('shares', { company: companyId });
export const createMaterialShare = (input: MaterialShareInput) => materialsPost<MaterialShareCreated>('shareCreate', input);
export const updateMaterialShare = (change: MaterialShareChange) => materialsPost<MaterialShareCreated>('shareUpdate', change);
export const deleteMaterialShare = (id: string) => materialsPost<{ ok: true; id: string }>('shareDelete', { id });

const PRODUCTS_ENDPOINT = '/bridge/native/v1/products';

/** Zdjęcie produktu z Dysku: serwer przygotowuje lekką wersję WebP z pliku Materiałów (oryginał zostaje w Dysku). */
export async function productImageFromMaterial(productId: string, fileId: string) {
  return parse<{ path: string; url: string | null; source: ProductImageSource | null }>(await fetch(PRODUCTS_ENDPOINT, {
    method: 'POST', headers: await headers(true), body: JSON.stringify({ op: 'imageFromMaterial', id: productId, fileId }),
  }));
}

/** Skąd jest zdjęcie produktu (plik Dysku, miejsce, nowsza wersja w Dysku); zdjęcie z komputera — `null`. */
export async function productImageSourceInfo(path: string) {
  const query = new URLSearchParams({ op: 'imageSource', path });
  return (await parse<{ source: ProductImageSource | null }>(await fetch(`${PRODUCTS_ENDPOINT}?${query.toString()}`, {
    headers: await headers(false), cache: 'no-store',
  }))).source;
}

const UPLOAD_LIMIT = 10 * 1024 * 1024;

/** Zawartość pliku w base64 (bez nagłówka `data:`). */
async function base64Of(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...Array.from(bytes.subarray(index, index + 0x8000)));
  return btoa(binary);
}

/** Plik zmniejszony w przeglądarce do `side` px (wysoka jakość — serwer i tak zapisze lekkie WebP), najwyżej 10 MB. */
async function preparedImage(file: File, maxWidth: number, maxHeight: number) {
  const prepared = await optimizeOfferImage(file, { maxWidth, maxHeight, quality: 0.92 });
  if (prepared.size > UPLOAD_LIMIT) throw new Error('Zdjęcie po zmniejszeniu ma ponad 10 MB. Zapisz je jako JPG i spróbuj ponownie.');
  return prepared;
}

export type OfferImageTarget = keyof typeof OFFER_IMAGE_SIDES;

/**
 * Zdjęcie z komputera do produktu (`product`), wariantu/elementu (`variant`) albo pakietu (`package`): przeglądarka zmniejsza plik,
 * serwer zapisuje lekką wersję WebP w magazynie zdjęć produktów i zwraca ścieżkę — zapis ścieżki w produkcie robi karta produktu.
 */
export async function productImageUpload(productId: string, file: File, target: OfferImageTarget = 'product', targetId?: string) {
  const side = OFFER_IMAGE_SIDES[target];
  const prepared = await preparedImage(file, side, side);
  return parse<{ path: string; url: string | null }>(await fetch(PRODUCTS_ENDPOINT, {
    method: 'POST', headers: await headers(true),
    body: JSON.stringify({ op: 'image', id: productId, target, ...(targetId ? { targetId } : {}), data: await base64Of(prepared) }),
  }));
}

/** Własne zdjęcie broszury → lekkie WebP w bibliotece broszury (jak „Dodaj swoje zdjęcie” na Macu). */
export async function brochureImageUpload(brochureId: string, file: File) {
  const prepared = await preparedImage(file, 1600, BROCHURE_IMAGE_SIDE);
  return parse<{ path: string; bucket: string; url: string | null; message?: string }>(await fetch('/bridge/native/v1/brochures', {
    method: 'POST', headers: await headers(true),
    body: JSON.stringify({ op: 'imageUpload', id: brochureId, data: await base64Of(prepared) }),
  }));
}

/** Ile zdjęć produktów, wariantów i pakietów jest jeszcze w JPG/PNG (`canEdit` — czy można je zamienić). */
export async function productImagesPending() {
  return parse<{ count: number; canEdit: boolean }>(await fetch(`${PRODUCTS_ENDPOINT}?op=imagesPending`, {
    headers: await headers(false), cache: 'no-store',
  }));
}

export type ProductImagesConversion = { converted: number; failed: Array<{ key: string; label: string; error: string }>; remaining: number };

/** „Duplikuj” — nowy, nieaktywny produkt z kopią całej karty (`src/lib/native/productDuplicate.ts`). */
export async function productDuplicate(productId: string) {
  return parse<ProductDuplicateResult>(await fetch(PRODUCTS_ENDPOINT, {
    method: 'POST', headers: await headers(true), body: JSON.stringify({ op: 'duplicate', id: productId }),
  }));
}

/** Porcja zamiany starszych zdjęć JPG/PNG na WebP; `skip` — zdjęcia, których nie udało się zamienić w tej serii. */
export async function convertProductImages(skip: string[]) {
  return parse<ProductImagesConversion>(await fetch(PRODUCTS_ENDPOINT, {
    method: 'POST', headers: await headers(true), body: JSON.stringify({ op: 'imagesConvert', skip, limit: 4 }),
  }));
}

/** Wynik operacji zbiorczej w porcjach; `interrupted` — błąd kolejnej porcji (wcześniejsze porcje są już zapisane). */
export type MaterialBatched<T> = T & { interrupted?: string };

/**
 * Operacja na wielu elementach w porcjach po `MATERIALS_MAX_BATCH` (tyle serwer przyjmuje w jednym zapytaniu — resztę by pominął):
 * lista z pola `key` w kolejnych zapytaniach, odpowiedzi złączone (`mergeMaterialReplies`: liczby zsumowane, listy połączone). Błąd
 * pierwszej porcji — wyjątek (nic się nie zmieniło), dalszej — wynik dotychczasowych porcji z komunikatem `interrupted`.
 */
export async function materialsPostInBatches<T extends object>(
  op: string,
  key: string,
  list: readonly unknown[],
  body: Record<string, unknown> = {},
): Promise<MaterialBatched<T>> {
  const replies: T[] = [];
  for (const chunk of materialChunks(list)) {
    try {
      replies.push(await materialsPost<T>(op, { ...body, [key]: chunk }));
    } catch (error) {
      if (!replies.length) throw error;
      const message = error instanceof Error && error.message ? error.message : 'Nie udało się dokończyć operacji.';
      return { ...mergeMaterialReplies(replies), interrupted: message };
    }
  }
  return mergeMaterialReplies(replies);
}

/** Pobranie pliku przez przeglądarkę (podpisany adres z nazwą pliku). */
export async function downloadMaterial(kind: 'material' | 'version' | 'trash' | 'event', id: string) {
  const { url } = await materialsGet<MaterialUrl>('url', { kind, id, mode: 'download' });
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// MARK: Wysyłka

type ClientThumbnail = { blob: Blob | null; width: number | null; height: number | null; duration: number | null };

const THUMB_SIDE = 640;
const THUMB_IMAGE_MAX_BYTES = 80 * 1024 * 1024;
const THUMB_PDF_MAX_BYTES = 60 * 1024 * 1024;
const SHA_MAX_BYTES = 100 * 1024 * 1024;

function canvasJpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  const scale = Math.min(1, THUMB_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const g = canvas.getContext('2d');
  if (!g) return Promise.resolve(null);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82));
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    promise.then((value) => { window.clearTimeout(timer); resolve(value); }, () => { window.clearTimeout(timer); resolve(fallback); });
  });
}

async function imageThumbnail(file: File): Promise<ClientThumbnail | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    if (!width || !height) return null;
    return { blob: await canvasJpeg(img, width, height), width, height, duration: null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function mediaThumbnail(file: File, video: boolean): Promise<ClientThumbnail | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(video ? 'video' : 'audio');
    const done = (value: ClientThumbnail | null) => {
      URL.revokeObjectURL(url);
      media.removeAttribute('src');
      resolve(value);
    };
    media.preload = 'metadata';
    media.muted = true;
    if (video) (media as HTMLVideoElement).playsInline = true;
    media.onerror = () => done(null);
    media.onloadedmetadata = () => {
      const duration = Number.isFinite(media.duration) ? media.duration : null;
      if (!video) return done({ blob: null, width: null, height: null, duration });
      const v = media as HTMLVideoElement;
      v.onseeked = async () => {
        const blob = v.videoWidth && v.videoHeight ? await canvasJpeg(v, v.videoWidth, v.videoHeight).catch(() => null) : null;
        done({ blob, width: v.videoWidth || null, height: v.videoHeight || null, duration });
      };
      v.currentTime = duration ? Math.min(1, duration / 2) : 0;
    };
    media.src = url;
  });
}

async function pdfThumbnail(file: File): Promise<ClientThumbnail | null> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, THUMB_SIDE / Math.max(base.width, base.height, 1)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82));
    return { blob, width: null, height: null, duration: null };
  } finally {
    await pdf.destroy();
  }
}

/** Miniatura i wymiary przygotowane w przeglądarce (zdjęcie, wideo, PDF, dźwięk); błąd — bez miniatury. */
async function clientThumbnail(file: File, kind: MaterialKind): Promise<ClientThumbnail | null> {
  try {
    if (kind === 'image' && file.size <= THUMB_IMAGE_MAX_BYTES) return await withTimeout(imageThumbnail(file), 20_000, null);
    if (kind === 'video') return await withTimeout(mediaThumbnail(file, true), 15_000, null);
    if (kind === 'audio') return await withTimeout(mediaThumbnail(file, false), 10_000, null);
    if (kind === 'pdf' && file.size <= THUMB_PDF_MAX_BYTES) return await withTimeout(pdfThumbnail(file), 20_000, null);
  } catch {
    return null;
  }
  return null;
}

async function sha256(file: File): Promise<string | null> {
  if (file.size > SHA_MAX_BYTES || typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** PUT na podpisany adres magazynu z postępem (XHR); przerwanie przez `signal`. */
function putObject(url: string, body: Blob, contentType: string, onProgress: (loaded: number) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      signal.removeEventListener('abort', abort);
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(xhr.status === 413 ? 'Plik jest za duży dla magazynu.' : 'Nie udało się wysłać pliku. Sprawdź połączenie i spróbuj ponownie.'));
    };
    xhr.onerror = () => {
      signal.removeEventListener('abort', abort);
      reject(new Error('Przerwano połączenie podczas wysyłki pliku.'));
    };
    xhr.onabort = () => {
      signal.removeEventListener('abort', abort);
      reject(Object.assign(new Error('Anulowano wysyłkę.'), { name: 'AbortError' }));
    };
    if (signal.aborted) {
      xhr.abort();
      return;
    }
    signal.addEventListener('abort', abort);
    xhr.send(body);
  });
}

type PreparedUpload = {
  fileId: string; name: string; replace: boolean; contentVersion: number; path: string; uploadUrl: string;
  thumbPath: string | null; thumbUploadUrl: string | null;
};

export type UploadTarget = { companyId: string; folderId: string | null } | { replaceId: string; baseContentVersion: number };

/** Plik już jest w Materiałach marki (wysyłka z `skipDuplicates` — ta sama treść, a bez skrótu nazwa i rozmiar w folderze); nic nie wysłano. */
export class MaterialDuplicateError extends Error {
  readonly file: MaterialFile;

  constructor(file: MaterialFile) {
    super(`Ten plik już jest w Materiałach: ${file.name}`);
    this.name = 'MaterialDuplicateError';
    this.file = file;
  }
}

/**
 * Wysyłka jednego pliku: miniatura i skrót w przeglądarce → wpis i podpisane adresy → plik (z postępem) i miniatura
 * do magazynu → potwierdzenie na serwerze. Błąd albo anulowanie sprząta wpis i wysłane obiekty. `skipDuplicates` (nowy plik) —
 * plik, który już jest w Materiałach marki, nie jest wysyłany (`MaterialDuplicateError` z istniejącym plikiem).
 */
export async function uploadMaterial(
  file: File,
  kind: MaterialKind,
  target: UploadTarget,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
  options: { skipDuplicates?: boolean } = {},
): Promise<MaterialFile> {
  const [thumb, sha] = await Promise.all([clientThumbnail(file, kind), sha256(file)]);
  if (signal.aborted) throw Object.assign(new Error('Anulowano wysyłkę.'), { name: 'AbortError' });
  const reply = await materialsPost<PreparedUpload | { duplicate: true; file: MaterialFile }>('prepareUpload', {
    ...('replaceId' in target
      ? { replaceId: target.replaceId, baseContentVersion: target.baseContentVersion }
      : { companyId: target.companyId, folderId: target.folderId, skipDuplicates: options.skipDuplicates === true }),
    name: file.name, size: file.size, mime: file.type || 'application/octet-stream', sha256: sha, thumbnail: !!thumb?.blob,
  });
  if ('duplicate' in reply && reply.duplicate) throw new MaterialDuplicateError(reply.file);
  const prepared = reply as PreparedUpload;
  let thumbPath: string | null = null;
  try {
    await putObject(prepared.uploadUrl, file, file.type || 'application/octet-stream', onProgress, signal);
    if (thumb?.blob && prepared.thumbUploadUrl && prepared.thumbPath) {
      try {
        await putObject(prepared.thumbUploadUrl, thumb.blob, 'image/jpeg', () => undefined, signal);
        thumbPath = prepared.thumbPath;
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') throw error;
      }
    }
    const done = await materialsPost<{ file: MaterialFile }>('completeUpload', {
      fileId: prepared.fileId, path: prepared.path, thumbPath, width: thumb?.width ?? null, height: thumb?.height ?? null,
      duration: thumb?.duration ?? null, sha256: sha,
      ...('replaceId' in target ? { baseContentVersion: target.baseContentVersion } : {}),
    });
    return done.file;
  } catch (error) {
    await materialsPost('cancelUpload', { fileId: prepared.fileId, path: prepared.path, thumbPath: prepared.thumbPath }).catch(() => undefined);
    throw error;
  }
}
