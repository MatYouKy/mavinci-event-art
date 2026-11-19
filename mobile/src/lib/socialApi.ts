import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';
import type {
  SocialAccess, SocialAssetStatus, SocialChannel, SocialConsentSource, SocialCrop, SocialFormat, SocialPostAction, SocialPostStatus,
} from './socialShared';

/*
 * Social media w aplikacji — to samo API co CRM i Mac (`/bridge/native/v1/social`, token sesji pracownika,
 * `x-mavinci-client: phone`). Uprawnienia, zgody klienta i statusy sprawdza serwer i baza. Na telefonie: zdjęcie
 * z wydarzenia do biblioteki (członek zespołu — jako propozycja), szybki post lub relacja z szablonu marki (kadr
 * automatyczny), akceptacja szkiców, oznaczenie publikacji, zapis grafiki w Zdjęciach i kopiowanie opisu.
 */

const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL || 'https://mavinci.pl').replace(/\/+$/, '');
const ENDPOINT = `${CRM_URL}/bridge/native/v1/social`;

export type SocialConsentState = { status: string; channels: string[]; source: SocialConsentSource };
export type SocialAssetItem = {
  id: string; companyId: string; status: SocialAssetStatus; title: string; originalName: string; thumbnailUrl: string | null;
  workUrl: string | null; width: number | null; height: number | null; eventId: string | null; eventName: string | null;
  consent: SocialConsentState; usedIn: number; updatedAt: string;
};
export type SocialPostItem = {
  id: string; companyId: string; title: string; status: SocialPostStatus; channels: SocialChannel[]; scheduledAt: string | null;
  captionPreview: string; thumbnailUrl: string | null; formats: SocialFormat[]; authorId: string | null; authorName: string | null;
  revision: number; approvedRevision: number | null; publishError?: string | null; updatedAt: string;
};
/** Konto Meta marki (bez tokenów) — gotowość kanałów do publikacji i komentarze. */
export type SocialMetaStatus = {
  connected: boolean; pageName: string | null; instagramUsername: string | null;
  channels: Record<SocialChannel, { ready: boolean; problem: string | null }>;
  comments: { facebookRead: boolean; facebookReply: boolean; instagram: boolean };
  missingScopes: string[];
};
export type SocialPublication = {
  channel: SocialChannel; status: string; format: SocialFormat | null; permalink: string | null; error: string | null;
  attempts: number; publishedAt: string | null;
};
export type SocialComment = {
  id: string; platform: 'facebook' | 'instagram'; authorName: string; isOwn: boolean; message: string; commentedAt: string;
  likeCount: number; answeredAt: string | null; repliedByName: string | null;
};
export type SocialCommentThread = SocialComment & {
  postId: string; channel: SocialChannel; permalink: string | null; post: { id: string; title: string; thumbnailUrl: string | null } | null;
  replies: SocialComment[];
};
export type SocialComments = {
  companyId: string; threads: SocialCommentThread[]; unanswered: number; canReply: boolean;
  replyChannels: { facebook: boolean; instagram: boolean };
};
export type SocialHome = {
  companies: Array<{ id: string; name: string; isDefault: boolean }>;
  company: { id: string; name: string; isDefault: boolean };
  access: SocialAccess;
  settings: { aiCaptionsEnabled: boolean; defaultHashtags: string[]; captionStyle: string };
  templates: Array<{ id: string; name: string; isDefault: boolean; ready: boolean; problems: string[] }>;
  posts: SocialPostItem[];
  counts: { inReview: number; changesRequested: number; proposals: number; failed?: number; unansweredComments?: number };
  meta?: SocialMetaStatus | null;
};
export type SocialVariant = {
  id: string; format: SocialFormat; assetId: string | null; crop: SocialCrop | null; headline: string; subline: string; renderedUrl: string | null;
  renderedAt: string | null; upToDate: boolean; asset: SocialAssetItem | null;
};
export type SocialAiSuggestion = { caption: string; hashtags: string[]; headline: string; subline: string };
export type SocialPostDetail = {
  company: { id: string; name: string };
  post: SocialPostItem & {
    caption: string; hashtags: string[]; templateId: string | null; aiSuggestions: SocialAiSuggestion[]; reviewNote: string | null;
    reviewedByName: string | null; publishedUrl: string | null; eventId: string | null;
    scheduledByName?: string | null; publishError?: string | null;
  };
  access: SocialAccess;
  actions: SocialPostAction[];
  canPublishNow?: boolean;
  variants: SocialVariant[];
  problems: { submit: string[]; publish: string[]; meta?: string[] };
  publications?: SocialPublication[];
  meta?: SocialMetaStatus | null;
  comments?: { total: number; unanswered: number };
  /** Wynik „Opublikuj teraz” (tylko w odpowiedzi na tę operację). */
  publishResult?: { status: string; error: string | null };
  history: Array<{ kind: string; actorName: string | null; note: string | null; revision: number | null; createdAt: string }>;
  event: { id: string; name: string; date: string | null; location: string; organizationName: string | null } | null;
  publicationText: string;
  settings: { aiCaptionsEnabled: boolean };
  template: { id: string; name: string; ready: boolean; problems: string[] } | null;
};
export type SocialLibrary = { company: { id: string; name: string }; access: SocialAccess; assets: SocialAssetItem[]; total: number; proposals: number };
export type SocialEventOption = { id: string; name: string; date: string | null; location: string; organizationName: string | null };

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

export async function socialGet<T>(op: string, params: Record<string, string | null | undefined> = {}): Promise<T> {
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

export async function socialPost<T>(op: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, { method: 'POST', headers: await headers(true), body: JSON.stringify({ ...body, op }) });
  } catch {
    throw new Error('Brak połączenia. Spróbuj ponownie za chwilę.');
  }
  return parse<T>(response);
}

export type PickedPhoto = { uri: string; mimeType: string; fileName: string; bytes: number };

/** Zdjęcie z aparatu albo galerii (JPEG — zdjęcia HEIC aplikacja zapisuje jako JPEG). `null` — anulowano. */
export async function pickSocialPhoto(source: 'camera' | 'library'): Promise<PickedPhoto | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Aby zrobić zdjęcie, zezwól aplikacji na dostęp do aparatu w ustawieniach.');
  }
  // `Compatible` — iOS oddaje JPEG zamiast HEIC (serwer przyjmuje JPEG, PNG i WebP).
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'], quality: 0.9, exif: false,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const extension = (asset.uri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
  const mimeType = asset.mimeType && ['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType)
    ? asset.mimeType
    : extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
  const info = await FileSystem.getInfoAsync(asset.uri);
  const bytes = asset.fileSize ?? (info.exists && 'size' in info ? Number(info.size) : 0);
  return { uri: asset.uri, mimeType, fileName: asset.fileName || `zdjecie-${Date.now()}.${mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'}`, bytes };
}

export type UploadResult = { asset?: SocialAssetItem; duplicateOf?: string; message?: string };

/**
 * Zdjęcie do biblioteki: wpis „wgrywanie” → plik przez serwer CRM → analiza (kadry, miniatura). Członek zespołu
 * wydarzenia bez uprawnień social media dodaje propozycję (serwer ustawia status).
 */
export async function uploadSocialPhoto(photo: PickedPhoto, options: { eventId?: string | null; companyId?: string | null }): Promise<UploadResult> {
  const ticket = await socialPost<{ assetId: string; proposal: boolean }>('assetCreate', {
    companyId: options.companyId || null,
    eventId: options.eventId || null,
    fileName: photo.fileName,
    mimeType: photo.mimeType,
    bytes: photo.bytes,
    source: 'camera',
  });
  let result: FileSystem.FileSystemUploadResult;
  try {
    result = await FileSystem.uploadAsync(`${ENDPOINT}?op=upload&id=${encodeURIComponent(ticket.assetId)}`, photo.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { ...(await headers(false)), 'Content-Type': photo.mimeType },
    });
  } catch {
    await socialPost('assetDelete', { id: ticket.assetId }).catch(() => undefined);
    throw new Error('Nie udało się wgrać zdjęcia. Sprawdź połączenie i spróbuj ponownie.');
  }
  let body: (UploadResult & { error?: string }) | null = null;
  try {
    body = JSON.parse(result.body);
  } catch {
    body = null;
  }
  if (result.status < 200 || result.status >= 300) {
    throw new Error(body?.error || `Nie udało się wgrać zdjęcia (HTTP ${result.status}).`);
  }
  return body || {};
}

export const socialErrorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
