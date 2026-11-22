import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as MediaLibrary from 'expo-media-library';
import { Platform, Share } from 'react-native';
import { supabase } from './supabase';
import { materialKind, type MaterialAccess, type MaterialKind, type MaterialSystemFolder } from './materialsShared';

/*
 * Materiały w aplikacji — to samo API co CRM, Mac i Finder (`/bridge/native/v1/materials`, token sesji pracownika,
 * `x-mavinci-client: phone`). Uprawnienia („Materiały — podgląd / zarządzanie”) i zakres marek sprawdza baza (RLS).
 * Pliki idą z telefonu prosto do magazynu (podpisany adres, postęp); miniatury zdjęć robi serwer.
 */

const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL || 'https://mavinci.pl').replace(/\/+$/, '');
const ENDPOINT = `${CRM_URL}/bridge/native/v1/materials`;

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
export type MaterialTrashItem = {
  id: string; kind: 'file' | 'folder'; itemId: string; parentId: string | null; insideFolder: boolean; location: string | null;
  contains: number; name: string; size: number; mime: string; fileKind: MaterialKind; thumbnailUrl: string | null; batch: string;
  deletedAt: string; deletedBy: string | null; mine: boolean; purgeAfter: string;
};
export type MaterialUrl = { url: string; name: string; mime: string; size: number; kind: MaterialKind };
export type MaterialItemRef = { kind: 'file' | 'folder'; id: string; name: string };
export type MaterialBatchResult = { moved?: number; removed?: number; failed: Array<{ id: string; name: string; error: string }> };
/** Album (Materiały → Albumy): odnośniki do plików marki, bez kopii (jak w CRM i na Macu). */
export type MaterialAlbum = {
  id: string; companyId: string; name: string; description: string; coverFileId: string | null; sortOrder: number; count: number;
  coverUrl: string | null; createdAt: string | null; updatedAt: string | null;
};

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

export async function materialsGet<T>(op: string, params: Record<string, string | number | null | undefined> = {}): Promise<T> {
  const query = Object.entries({ op, ...params })
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}?${query}`, { headers: await headers(false) });
  } catch {
    throw new Error('Brak połączenia. Spróbuj ponownie za chwilę.');
  }
  return parse<T>(response);
}

export async function materialsPost<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, { method: 'POST', headers: await headers(true), body: JSON.stringify({ ...body, op }) });
  } catch {
    throw new Error('Brak połączenia. Spróbuj ponownie za chwilę.');
  }
  return parse<T>(response);
}

export const materialsErrorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
export const materialsErrorStatus = (error: unknown) => (error as ApiError | null)?.status;

// MARK: Pliki z telefonu

export type PickedMaterial = {
  uri: string; name: string; mimeType: string; size: number; width: number | null; height: number | null; duration: number | null;
};

async function sizeOf(uri: string, known?: number | null): Promise<number> {
  if (known && known > 0) return known;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && 'size' in info ? Number(info.size) || 0 : 0;
  } catch {
    return 0;
  }
}

/** Zdjęcia i filmy z aparatu (jedno) albo z galerii (do 20 naraz). Pusta lista — anulowano. */
export async function pickMaterialMedia(source: 'camera' | 'library'): Promise<PickedMaterial[]> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Aby zrobić zdjęcie, zezwól aplikacji na dostęp do aparatu w ustawieniach.');
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images', 'videos'], quality: 1, exif: false,
    allowsMultipleSelection: source === 'library', selectionLimit: source === 'library' ? 20 : 1,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return [];
  const picked: PickedMaterial[] = [];
  for (const [index, asset] of result.assets.entries()) {
    const video = asset.type === 'video';
    const extension = (asset.uri.split('?')[0].split('.').pop() || (video ? 'mov' : 'jpg')).toLowerCase();
    const name = asset.fileName || `${video ? 'film' : 'zdjecie'}-${Date.now()}-${index + 1}.${extension}`;
    picked.push({
      uri: asset.uri,
      name,
      mimeType: asset.mimeType || (video ? (extension === 'mp4' ? 'video/mp4' : 'video/quicktime') : extension === 'png' ? 'image/png' : 'image/jpeg'),
      size: await sizeOf(asset.uri, asset.fileSize),
      width: asset.width || null,
      height: asset.height || null,
      duration: asset.duration ? asset.duration / 1000 : null,
    });
  }
  return picked;
}

/** Dowolne pliki z „Plików” (iCloud Drive, dysk telefonu, OneDrive…). */
export async function pickMaterialDocuments(): Promise<PickedMaterial[]> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.length) return [];
  const picked: PickedMaterial[] = [];
  for (const asset of result.assets) {
    picked.push({
      uri: asset.uri, name: asset.name, mimeType: asset.mimeType || 'application/octet-stream', size: await sizeOf(asset.uri, asset.size),
      width: null, height: null, duration: null,
    });
  }
  return picked;
}

type PreparedUpload = { fileId: string; name: string; path: string; uploadUrl: string; thumbPath: string | null; thumbUploadUrl: string | null };

/**
 * Wysyłka jednego pliku: wpis i podpisany adres → plik prosto do magazynu (z postępem) → potwierdzenie; błąd sprząta wpis.
 * Miniaturę zdjęcia robi serwer CRM (jak dla plików z Findera).
 */
export async function uploadMaterial(
  file: PickedMaterial,
  target: { companyId: string; folderId: string | null },
  onProgress?: (sent: number) => void,
): Promise<MaterialFile> {
  const prepared = await materialsPost<PreparedUpload>('prepareUpload', {
    companyId: target.companyId, folderId: target.folderId, name: file.name, size: file.size, mime: file.mimeType, sha256: null, thumbnail: false,
  });
  try {
    const task = FileSystem.createUploadTask(prepared.uploadUrl, file.uri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': file.mimeType, 'x-upsert': 'false', 'cache-control': 'max-age=3600' },
    }, (progress) => onProgress?.(progress.totalBytesSent));
    const result = await task.uploadAsync();
    if (!result || result.status < 200 || result.status >= 300) {
      throw new Error(result?.status === 413 ? 'Plik jest za duży dla magazynu.' : 'Nie udało się wysłać pliku. Sprawdź połączenie i spróbuj ponownie.');
    }
    const done = await materialsPost<{ file: MaterialFile }>('completeUpload', {
      fileId: prepared.fileId, path: prepared.path, thumbPath: null, width: file.width, height: file.height, duration: file.duration, sha256: null,
    });
    return done.file;
  } catch (error) {
    await materialsPost('cancelUpload', { fileId: prepared.fileId, path: prepared.path, thumbPath: prepared.thumbPath }).catch(() => undefined);
    throw error;
  }
}

// MARK: Podgląd, udostępnianie, zapis w Zdjęciach

export const materialUrl = (kind: 'material' | 'version' | 'trash' | 'event', id: string, download = false) =>
  materialsGet<MaterialUrl>('url', { kind, id, mode: download ? 'download' : 'preview' });

/** Kopia pliku w pamięci podręcznej telefonu (jedna na wersję treści). */
export async function materialLocalCopy(kind: 'material' | 'event', id: string, version: number, name: string): Promise<string> {
  if (!FileSystem.cacheDirectory) throw new Error('Brak miejsca na pobranie pliku.');
  const folder = `${FileSystem.cacheDirectory}materialy/${kind}-${id}-${version}/`;
  const safe = name.replace(/[/:\\]/g, '-') || 'plik';
  const target = `${folder}${safe}`;
  const existing = await FileSystem.getInfoAsync(target).catch(() => null);
  if (existing?.exists) return target;
  const { url } = await materialUrl(kind, id);
  await FileSystem.makeDirectoryAsync(folder, { intermediates: true }).catch(() => undefined);
  const result = await FileSystem.downloadAsync(url, target);
  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
    throw new Error('Nie udało się pobrać pliku. Spróbuj ponownie.');
  }
  return result.uri;
}

/** Udostępnienie (iOS — sam plik; Android — odnośnik ważny godzinę). */
export async function shareMaterial(file: { id: string; name: string; contentVersion: number }): Promise<void> {
  if (Platform.OS === 'ios') {
    const local = await materialLocalCopy('material', file.id, file.contentVersion, file.name);
    await Share.share({ url: local, title: file.name });
    return;
  }
  const { url } = await materialUrl('material', file.id, true);
  await Share.share({ message: `${file.name}\n${url}`, title: file.name });
}

export class MaterialPhotosPermissionError extends Error {}

/** Zdjęcie albo film w aplikacji Zdjęcia (Galeria). */
export async function saveMaterialToPhotos(file: { id: string; name: string; contentVersion: number; mime: string }): Promise<void> {
  const kind = materialKind(file.mime, file.name);
  if (kind !== 'image' && kind !== 'video') throw new Error('Do Zdjęć można zapisać tylko zdjęcia i filmy.');
  if (Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) < 29)) {
    const permission = await MediaLibrary.requestPermissionsAsync(true, kind === 'video' ? ['video'] : ['photo']);
    if (!permission.granted) throw new MaterialPhotosPermissionError('Brak zgody na zapis w Zdjęciach.');
  }
  const local = await materialLocalCopy('material', file.id, file.contentVersion, file.name);
  await MediaLibrary.saveToLibraryAsync(local);
}

/** Folder i jego podfoldery (blokada przeniesienia folderu do samego siebie). */
export function materialDescendants(folders: MaterialFolder[], id: string): Set<string> {
  const result = new Set<string>([id]);
  let grown = true;
  while (grown) {
    grown = false;
    for (const folder of folders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        grown = true;
      }
    }
  }
  return result;
}

/** Ścieżka folderu od głównego folderu marki. */
export function materialPath(folders: MaterialFolder[], id: string | null): MaterialFolder[] {
  const path: MaterialFolder[] = [];
  let current = id ? folders.find((f) => f.id === id) : undefined;
  for (let depth = 0; current && depth < 40; depth += 1) {
    path.unshift(current);
    const parent = current.parentId;
    current = parent ? folders.find((f) => f.id === parent) : undefined;
  }
  return path;
}

/** Kolejność folderów: domyślne marki, potem alfabetycznie. */
export const materialFolderOrder = (a: MaterialFolder, b: MaterialFolder) =>
  Number(!a.systemKey) - Number(!b.systemKey) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pl', { numeric: true });
