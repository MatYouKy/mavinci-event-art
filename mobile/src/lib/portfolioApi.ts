import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';
import type { PortfolioContent, PortfolioPhoto, PortfolioStatus } from './portfolioShared';

/*
 * Marketing → „Realizacje” w aplikacji — to samo API co CRM i Mac (`/bridge/native/v1/portfolio`, token sesji pracownika,
 * `x-mavinci-client: phone`). Dostęp (edycja strony), wersje kopii roboczych i publikację sprawdza serwer i baza.
 * Zdjęcia z telefonu idą na serwer — wersje WebP strony (komputer, telefon, miniatura) powstają na serwerze.
 */

const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL || 'https://mavinci.pl').replace(/\/+$/, '');
const ENDPOINT = `${CRM_URL}/bridge/native/v1/portfolio`;

export type PortfolioListItem = {
  id: string; title: string; slug: string; status: PortfolioStatus; category: string; location: string; eventDate: string | null;
  thumbnailUrl: string | null; photos: number; isFeatured: boolean; orderIndex: number; eventId: string | null; eventName: string | null;
  siteUrl: string | null; publishedAt: string | null; updatedAt: string; problems: number;
};
export type PortfolioCity = { locality: string; name: string };
export type PortfolioHome = {
  items: PortfolioListItem[]; categories: string[]; cities: PortfolioCity[];
  counts: { draft: number; published: number; changed: number }; siteUrl: string;
};
export type PortfolioEvent = { id: string; name: string; date: string | null; location: string; category: string | null };
export type PortfolioItem = {
  id: string; version: number; status: PortfolioStatus; content: PortfolioContent; eventId: string | null; companyId: string | null;
  portfolioProjectId: string | null; publishedSlug: string | null; siteUrl: string | null; publishedAt: string | null;
  publishedByName: string | null; createdAt: string; createdByName: string | null; updatedAt: string; updatedByName: string | null;
  problems: string[]; siteContent: PortfolioContent | null;
};
export type PortfolioDetail = { item: PortfolioItem; event: PortfolioEvent | null };
export type PortfolioPhotoSource = 'event' | 'material' | 'social';
export type PortfolioPhotoOption = { id: string; name: string; thumbnailUrl: string | null; width: number | null; height: number | null; bytes: number | null };
export type PortfolioAiResult = {
  title?: string; description?: string; detailedDescription?: string; metaDescription?: string; keywords?: string[];
  features?: Array<{ icon: string; title: string; description: string }>; alts?: Array<{ src: string; alt: string }>;
  model: string; usedPhotos: boolean;
};

async function headers(json: boolean): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Zaloguj się ponownie.');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'x-mavinci-client': 'phone',
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error || `Operacja nie powiodła się (HTTP ${response.status}).`);
  return body as T;
}

export async function portfolioGet<T>(op: string, params: Record<string, string | null | undefined> = {}): Promise<T> {
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

export async function portfolioPost<T>(op: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, { method: 'POST', headers: await headers(true), body: JSON.stringify({ ...body, op }) });
  } catch {
    throw new Error('Brak połączenia. Spróbuj ponownie za chwilę.');
  }
  return parse<T>(response);
}

export type PickedPortfolioPhoto = { uri: string; mimeType: string; fileName: string };

/**
 * Zdjęcia z aparatu (jedno) albo z galerii (do 20 naraz). JPEG — zdjęcia HEIC system oddaje jako JPEG. Pusta lista — anulowano.
 */
export async function pickPortfolioPhotos(source: 'camera' | 'library'): Promise<PickedPortfolioPhoto[]> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Aby zrobić zdjęcie, zezwól aplikacji na dostęp do aparatu w ustawieniach.');
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'], quality: 0.9, exif: false,
    allowsMultipleSelection: source === 'library', selectionLimit: source === 'library' ? 20 : 1,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return [];
  return result.assets.map((asset, index) => {
    const extension = (asset.uri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
    const mimeType = asset.mimeType && ['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType)
      ? asset.mimeType
      : extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
    return { uri: asset.uri, mimeType, fileName: asset.fileName || `zdjecie-${Date.now()}-${index + 1}.jpg` };
  });
}

/** Zdjęcie z telefonu → wersje WebP strony (serwer) → zdjęcie do dodania w kopii roboczej. */
export async function uploadPortfolioPhoto(itemId: string, photo: PickedPortfolioPhoto): Promise<PortfolioPhoto> {
  let result: FileSystem.FileSystemUploadResult;
  try {
    result = await FileSystem.uploadAsync(`${ENDPOINT}?op=upload&id=${encodeURIComponent(itemId)}`, photo.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { ...(await headers(false)), 'Content-Type': photo.mimeType },
    });
  } catch {
    throw new Error('Nie udało się wgrać zdjęcia. Sprawdź połączenie i spróbuj ponownie.');
  }
  let body: { photo?: PortfolioPhoto; error?: string } | null = null;
  try {
    body = JSON.parse(result.body);
  } catch {
    body = null;
  }
  if (result.status < 200 || result.status >= 300 || !body?.photo) {
    throw new Error(body?.error || `Nie udało się wgrać zdjęcia (HTTP ${result.status}).`);
  }
  return body.photo;
}

export const portfolioErrorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
