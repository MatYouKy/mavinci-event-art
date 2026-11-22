import * as FileSystem from 'expo-file-system/legacy';
import { Linking, Platform, Share } from 'react-native';
import { supabase } from './supabase';
import type { DriveDownload, DriveFile, DriveListing, DriveRoot, DriveScanUpload, DriveStorageUsage, DriveUpload, DriveUploadResult } from './driveShared';
import type { PickedMaterial } from './materialsApi';

/*
 * Dysk w aplikacji — to samo API co CRM, Mac i Finder: `/bridge/native/v1/drive` (Oferty, Kalkulacje, Umowy, Magazyn, księga
 * znaku) i `/bridge/native/v1/files` (Eventy: rok → wydarzenie → pliki z zakładki Pliki). Token sesji pracownika,
 * `x-mavinci-client: phone`; które działy i pliki widać — serwer i RLS jak w CRM. Pliki do sprzętu idą z telefonu prosto do
 * magazynu (podpisany adres, postęp). Skaner Finansów (`uploadDriveScan`): zdjęcia stron → serwer składa PDF i zapisuje go
 * w wybranym folderze Finansów.
 */

const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL || 'https://mavinci.pl').replace(/\/+$/, '');
const DRIVE_ENDPOINT = `${CRM_URL}/bridge/native/v1/drive`;
const FILES_ENDPOINT = `${CRM_URL}/bridge/native/v1/files`;

export type DriveEvent = { id: string; name: string; date: string | null; endDate: string | null; status: string | null };
export type DriveEventFolder = { id: string; eventId: string; parentId: string | null; name: string; formal: boolean; system: boolean };
export type DriveEventFile = {
  id: string; eventId: string; parentId: string | null; name: string; size: number; mime: string; updatedAt: string | null; createdAt: string | null;
};
export type DriveEventListing = { event: DriveEvent; folders: DriveEventFolder[]; files: DriveEventFile[] };

type ApiError = Error & { status?: number; code?: string };

async function headers(json: boolean): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw Object.assign(new Error('Zaloguj się ponownie.'), { status: 401 });
  return {
    Authorization: `Bearer ${session.access_token}`,
    'x-mavinci-client': 'phone',
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!response.ok) {
    throw Object.assign(new Error(body?.error || `Operacja nie powiodła się (HTTP ${response.status}).`), { status: response.status, code: body?.code }) as ApiError;
  }
  return body as T;
}

async function get<T>(endpoint: string, op: string, params: Record<string, string | null | undefined> = {}): Promise<T> {
  const query = Object.entries({ op, ...params })
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  let response: Response;
  try {
    response = await fetch(`${endpoint}?${query}`, { headers: await headers(false) });
  } catch {
    throw new Error('Brak połączenia. Spróbuj ponownie za chwilę.');
  }
  return parse<T>(response);
}

async function post<T>(op: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(DRIVE_ENDPOINT, { method: 'POST', headers: await headers(true), body: JSON.stringify({ ...body, op }) });
  } catch {
    throw new Error('Brak połączenia. Spróbuj ponownie za chwilę.');
  }
  return parse<T>(response);
}

export const driveErrorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
export const driveErrorStatus = (error: unknown) => (error as ApiError | null)?.status;

/** Działy Dysku z dostępem i prawem dodawania plików. */
export const fetchDriveRoot = () => get<DriveRoot>(DRIVE_ENDPOINT, 'root');
/** Miejsce na Dysku (tylko administrator): pakiet i zajętość plików oraz bazy. */
export const fetchDriveStorage = () => get<DriveStorageUsage>(DRIVE_ENDPOINT, 'storage');
/** Folder: `offers`, `offers:2026`, `offers:2026-11`, `warehouse`, `warehouse:cat:<id>`, `warehouse:item:<id>`, `brand:<firma>`. */
export const fetchDriveListing = (node: string) => get<DriveListing>(DRIVE_ENDPOINT, 'list', { node });
/** Adres pliku Dysku (podpisany na godzinę albo publiczny). */
export const fetchDriveUrl = (id: string, download = false) => get<DriveDownload>(DRIVE_ENDPOINT, 'download', { id, mode: download ? 'download' : 'preview' });
/** Eventy: wszystkie wydarzenia z dostępem (rok → wydarzenie). */
export const fetchDriveEvents = () => get<{ events: DriveEvent[] }>(FILES_ENDPOINT, 'events');
/** Foldery i pliki z zakładki Pliki jednego wydarzenia. */
export const fetchDriveEventListing = (eventId: string) => get<DriveEventListing>(FILES_ENDPOINT, 'list', { event: eventId });
/** Adres pliku wydarzenia (podpisany na godzinę). */
export const fetchDriveEventUrl = (fileId: string) => get<{ url: string }>(FILES_ENDPOINT, 'download', { id: fileId });

/** Plik do otwarcia, udostępnienia albo zapisania: Dysk (`drive`) albo plik wydarzenia (`event`). */
export type DriveTarget = { source: 'drive' | 'event'; id: string; name: string; mime: string; version: string };

export const driveTargetOf = (file: DriveFile): DriveTarget => ({ source: 'drive', id: file.id, name: file.name, mime: file.mime, version: file.version });
export const eventTargetOf = (file: DriveEventFile): DriveTarget => ({
  source: 'event', id: file.id, name: file.name, mime: file.mime, version: file.updatedAt || file.createdAt || String(file.size),
});

export async function driveTargetUrl(target: DriveTarget, download = false): Promise<string> {
  if (target.source === 'event') return (await fetchDriveEventUrl(target.id)).url;
  return (await fetchDriveUrl(target.id, download)).url;
}

/** Kopia pliku w pamięci podręcznej telefonu (jedna na wersję treści). */
export async function driveLocalCopy(target: DriveTarget): Promise<string> {
  if (!FileSystem.cacheDirectory) throw new Error('Brak miejsca na pobranie pliku.');
  const key = `${target.source}-${target.id}-${target.version}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 160);
  const folder = `${FileSystem.cacheDirectory}dysk/${key}/`;
  const safe = target.name.replace(/[/:\\]/g, '-') || 'plik';
  const path = `${folder}${safe}`;
  const existing = await FileSystem.getInfoAsync(path).catch(() => null);
  if (existing?.exists) return path;
  const url = await driveTargetUrl(target);
  await FileSystem.makeDirectoryAsync(folder, { intermediates: true }).catch(() => undefined);
  const result = await FileSystem.downloadAsync(url, path);
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
    throw new Error('Nie udało się pobrać pliku. Spróbuj ponownie.');
  }
  return result.uri;
}

/** Udostępnienie (iOS — sam plik; Android — odnośnik ważny godzinę). */
export async function shareDriveTarget(target: DriveTarget): Promise<void> {
  if (Platform.OS === 'ios') {
    const local = await driveLocalCopy(target);
    await Share.share({ url: local, title: target.name });
    return;
  }
  const url = await driveTargetUrl(target, true);
  await Share.share({ message: `${target.name}\n${url}`, title: target.name });
}

/**
 * PDF na ekranie: iOS — przeglądarka PDF w aplikacji (ekran `PdfViewer`), Android — systemowa przeglądarka plików
 * (WebView na Androidzie nie wyświetla PDF-ów).
 */
export function openPdf(navigation: { navigate: (screen: string, params?: object) => void }, url: string, title?: string) {
  if (Platform.OS === 'ios') navigation.navigate('PdfViewer', { url, title });
  else void Linking.openURL(url).catch(() => undefined);
}

/**
 * Plik do sprzętu w Magazynie: podpisany adres → plik prosto do magazynu (z postępem) → wpis (zdjęcie do galerii sprzętu,
 * inny plik do plików sprzętu, jak w CRM); błąd sprząta obiekt.
 */
export async function uploadDriveFile(parentId: string, file: PickedMaterial, onProgress?: (sent: number) => void): Promise<DriveFile> {
  const prepared = await post<DriveUpload>('prepareUpload', { parentId, name: file.name, size: file.size, mime: file.mimeType });
  try {
    const task = FileSystem.createUploadTask(prepared.signedUrl, file.uri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': file.mimeType || 'application/octet-stream', 'x-upsert': 'false' },
    }, (progress) => onProgress?.(progress.totalBytesSent));
    const result = await task.uploadAsync();
    if (!result || result.status < 200 || result.status >= 300) {
      throw new Error(result?.status === 413 ? 'Plik jest za duży dla magazynu.' : 'Nie udało się wysłać pliku. Sprawdź połączenie i spróbuj ponownie.');
    }
    const done = await post<{ file: DriveFile }>('completeUpload', {
      parentId, bucket: prepared.bucket, path: prepared.path, name: file.name, size: file.size, mime: file.mimeType,
    });
    return done.file;
  } catch (error) {
    await post('cancelUpload', { parentId, bucket: prepared.bucket, path: prepared.path }).catch(() => undefined);
    throw error;
  }
}

/**
 * Skan do Finansów: podpisane adresy stron → zdjęcia prosto do magazynu (`finance-scans`) → serwer składa PDF i zapisuje go
 * w folderze `parentId` (Koszty miesiąca — dokument spoza KSeF z odczytem AI, kategoria Dokumentów spółki, umowa stała).
 * `onProgress` — wysłane strony, potem `saving` (składanie i zapis); błąd sprząta strony na serwerze.
 */
export async function uploadDriveScan(
  parentId: string,
  pages: Array<{ uri: string; mimeType: string }>,
  title: string,
  onProgress?: (done: number, total: number, stage: 'pages' | 'saving') => void,
): Promise<DriveUploadResult> {
  const prepared = await post<DriveScanUpload>('prepareScan', { parentId, pages: pages.length });
  try {
    for (const [index, page] of pages.entries()) {
      onProgress?.(index, pages.length, 'pages');
      const slot = prepared.pages[index];
      if (!slot) throw new Error('Serwer nie przygotował miejsca na wszystkie strony. Spróbuj ponownie.');
      const result = await FileSystem.uploadAsync(slot.signedUrl, page.uri, {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { 'Content-Type': page.mimeType === 'image/png' ? 'image/png' : 'image/jpeg', 'x-upsert': 'false' },
      });
      if (result.status < 200 || result.status >= 300) {
        throw new Error(result.status === 413 ? 'Zdjęcie strony jest za duże (do 15 MB).' : 'Nie udało się wysłać strony skanu. Sprawdź połączenie i spróbuj ponownie.');
      }
    }
    onProgress?.(pages.length, pages.length, 'saving');
    return await post<DriveUploadResult>('completeScan', { parentId, scanId: prepared.scanId, pages: pages.length, title });
  } catch (error) {
    await post('cancelScan', { parentId, scanId: prepared.scanId, pages: pages.length }).catch(() => undefined);
    throw error;
  }
}
