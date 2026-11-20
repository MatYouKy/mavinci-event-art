import { supabase } from '@/lib/supabase/browser';
import type { MaterialAccess, MaterialKind, MaterialSystemFolder } from '@/lib/materials/materialsShared';

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

/**
 * Wysyłka jednego pliku: miniatura i skrót w przeglądarce → wpis i podpisane adresy → plik (z postępem) i miniatura
 * do magazynu → potwierdzenie na serwerze. Błąd albo anulowanie sprząta wpis i wysłane obiekty.
 */
export async function uploadMaterial(
  file: File,
  kind: MaterialKind,
  target: UploadTarget,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<MaterialFile> {
  const [thumb, sha] = await Promise.all([clientThumbnail(file, kind), sha256(file)]);
  if (signal.aborted) throw Object.assign(new Error('Anulowano wysyłkę.'), { name: 'AbortError' });
  const prepared = await materialsPost<PreparedUpload>('prepareUpload', {
    ...('replaceId' in target
      ? { replaceId: target.replaceId, baseContentVersion: target.baseContentVersion }
      : { companyId: target.companyId, folderId: target.folderId }),
    name: file.name, size: file.size, mime: file.type || 'application/octet-stream', sha256: sha, thumbnail: !!thumb?.blob,
  });
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
