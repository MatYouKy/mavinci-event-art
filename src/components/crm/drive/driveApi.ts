import { supabase } from '@/lib/supabase/browser';
import type { DriveDownload, DriveUpload, DriveUploadResult } from '@/lib/drive/driveShared';

/*
 * Klient API Dysku w CRM — to samo API co Finder, aplikacja na Maca i telefon (`/bridge/native/v1/drive`, token sesji
 * pracownika, `x-mavinci-client: web`). Eventy i Materiały mają własne API (`/bridge/native/v1/files`, `…/materials`).
 */

const ENDPOINT = '/bridge/native/v1/drive';
const FILES_ENDPOINT = '/bridge/native/v1/files';

type ApiError = Error & { status?: number; code?: string };

async function headers(json: boolean) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw Object.assign(new Error('Sesja wygasła. Zaloguj się ponownie.'), { status: 401 });
  return { Authorization: `Bearer ${token}`, 'x-mavinci-client': 'web', ...(json ? { 'Content-Type': 'application/json' } : {}) };
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body?.error || 'Operacja nie powiodła się.'), { status: response.status, code: body?.code }) as ApiError;
  return body as T;
}

function query(op: string, params: Record<string, string | null | undefined>) {
  const search = new URLSearchParams({ op });
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

export async function driveGet<T>(op: string, params: Record<string, string | null | undefined> = {}): Promise<T> {
  return parse<T>(await fetch(`${ENDPOINT}?${query(op, params)}`, { headers: await headers(false), cache: 'no-store' }));
}

export async function drivePost<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
  return parse<T>(await fetch(ENDPOINT, { method: 'POST', headers: await headers(true), body: JSON.stringify({ ...body, op }) }));
}

/** Pliki wydarzeń (to samo API co Finder): lista wydarzeń i zawartość jednego wydarzenia. */
export async function eventFilesGet<T>(op: 'events' | 'list', params: Record<string, string | null | undefined> = {}): Promise<T> {
  return parse<T>(await fetch(`${FILES_ENDPOINT}?${query(op, params)}`, { headers: await headers(false), cache: 'no-store' }));
}

/** Pobranie pliku Dysku przez przeglądarkę (podpisany albo publiczny adres; publiczny — w nowej karcie). */
export async function downloadDriveFile(id: string) {
  const result = await driveGet<DriveDownload>('download', { id, mode: 'download' });
  const link = document.createElement('a');
  link.href = result.url;
  link.rel = 'noopener';
  link.download = result.name;
  // Podpisany adres magazynu albo instalator z Programów (ten sam serwer) — pobranie w tej karcie; inne adresy — nowa karta.
  if (!result.url.includes('/object/sign/') && !result.url.startsWith('/bridge/native/v1/desktop')) link.target = '_blank';
  document.body.appendChild(link);
  link.click();
  link.remove();
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

/**
 * Plik do sprzętu w Magazynie albo do dokumentów pracownika: podpisany adres → wysyłka z postępem → wpis (zdjęcie do galerii,
 * inny plik do plików sprzętu; dokument pracownika — z `details`: tytuł, rodzaj, opis, termin ważności).
 */
export async function uploadDriveFile(parentId: string, file: File, onProgress: (loaded: number) => void, signal: AbortSignal,
  details: { title?: string; documentType?: string; description?: string; expiryDate?: string } = {}): Promise<DriveUploadResult> {
  const mime = file.type || 'application/octet-stream';
  const prepared = await drivePost<DriveUpload>('prepareUpload', { parentId, name: file.name, size: file.size, mime });
  try {
    await putObject(prepared.signedUrl, file, mime, onProgress, signal);
    return await drivePost<DriveUploadResult>('completeUpload', {
      ...details, parentId, bucket: prepared.bucket, path: prepared.path, name: file.name, size: file.size, mime,
    });
  } catch (error) {
    await drivePost('cancelUpload', { parentId, bucket: prepared.bucket, path: prepared.path }).catch(() => undefined);
    throw error;
  }
}

/** Usunięcie dokumentu pracownika (profil → Dokumenty); kto może — decyduje baza (RLS). */
export async function deleteDriveFile(id: string) {
  await drivePost<{ ok: true }>('deleteFile', { id });
}
