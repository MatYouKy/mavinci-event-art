import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';
import type {
  SocialAccess, SocialAssetStatus, SocialBrandInterest, SocialChannel, SocialCommentPlatform, SocialConsentSource, SocialCrop, SocialFormat,
  SocialGraphicStyle, SocialMetricValues, SocialPostAction, SocialPostStatus,
} from './socialShared';

/*
 * Social media w aplikacji — to samo API co CRM i Mac (`/bridge/native/v1/social`, token sesji pracownika,
 * `x-mavinci-client: phone`). Uprawnienia, zgody klienta i statusy sprawdza serwer i baza. Na telefonie: zdjęcie
 * z wydarzenia do biblioteki (członek zespołu — jako propozycja), szybki post lub relacja z szablonu marki (kadr
 * automatyczny), akceptacja szkiców, oznaczenie publikacji, zapis grafiki w Zdjęciach i kopiowanie opisu, statystyki z raportem
 * tygodniowym i wyniki posta z Meta.
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
  captionPreview: string; thumbnailUrl: string | null; formats: SocialFormat[]; photos?: number; authorId: string | null; authorName: string | null;
  revision: number; approvedRevision: number | null; publishError?: string | null; updatedAt: string;
  /** Siatka profilu / panorama — rodzaj i liczba kafelków (zwykły post — brak). */
  canvas?: { mode: 'grid' | 'panorama'; tiles: number } | null;
};
/** Konto Meta marki (bez tokenów) — gotowość kanałów do publikacji i komentarze. */
export type SocialMetaStatus = {
  connected: boolean; pageName: string | null; instagramUsername: string | null;
  channels: Record<SocialChannel, { ready: boolean; problem: string | null }>;
  comments: { facebookRead: boolean; facebookReply: boolean; instagram: boolean };
  insights?: { facebook: boolean; instagram: boolean };
  missingScopes: string[];
  /** Strona firmowa LinkedIn (kanał „LinkedIn — post”); gotowość kanału — `channels.linkedin_page`. */
  linkedin?: { connected: boolean; organizationId: string | null; organizationName: string | null; comments: boolean };
};
/** LinkedIn bez połączonej strony — publikacja ręczna (paczka + „Oznacz jako opublikowany”), nie błąd. */
export const socialManualChannel = (meta: SocialMetaStatus | null | undefined, channel: SocialChannel) =>
  channel === 'linkedin_page' && !meta?.linkedin?.connected;
export type SocialPublication = {
  channel: SocialChannel;
  /** Kafelek siatki profilu (osobny post Instagram); 0 albo brak — cały post. */
  tile?: number;
  status: string; format: SocialFormat | null; permalink: string | null; error: string | null;
  attempts: number; publishedAt: string | null;
  /** Wyniki z Meta (stan narastająco od publikacji). */
  metrics?: SocialMetricValues; rate?: number | null; metricsSyncedAt?: string | null; metricsError?: string | null;
};
/** Statystyki (`op=stats`) — jak w CRM i na Macu. */
export type SocialTotals = SocialMetricValues & { posts: number; publications: number; rate: number | null };
export type SocialBestTime = { weekday: number; band: number; label: string; posts: number; rate: number; avgReach: number; avgInteractions: number };
export type SocialTopPost = {
  postId: string; title: string; channels: SocialChannel[]; publishedAt: string | null; permalink: string | null;
  metrics: SocialMetricValues; thumbnailUrl: string | null;
};
export type SocialReportSummary = { id: string; periodStart: string; periodEnd: string; summary: string; aiUsed: boolean; createdAt: string; updatedAt: string | null };
export type SocialReport = SocialReportSummary & {
  trends: string[]; recommendations: Array<{ title: string; rationale: string; priority: 'high' | 'medium' | 'low'; channel: string }>;
  risks: string[]; opportunities: string[]; model: string | null; totals: SocialTotals | null; previous: SocialTotals | null;
  channels: Array<{ channel: SocialChannel; totals: SocialTotals }>; topPosts: SocialTopPost[]; bestTimes: SocialBestTime[];
  comments: { received: number; unanswered: number } | null; scheduledNext: number | null; aiNote: string | null;
};
export type SocialStats = {
  company: { id: string; name: string; isDefault: boolean }; access: SocialAccess; range: { days: number; from: string; to: string };
  totals: SocialTotals; previous: SocialTotals; channels: Array<{ channel: SocialChannel; totals: SocialTotals }>;
  timeline: Array<{ date: string; views: number; interactions: number }>;
  bestTimes: { sample: number; minSample: number; cells: SocialBestTime[]; top: SocialBestTime[] };
  topPosts: SocialTopPost[];
  sync: { publications: number; withMetrics: number; lastSyncedAt: string | null; problems: string[] };
  insights: { connected: boolean; facebook: boolean; instagram: boolean; missingScopes: string[] };
  reports: SocialReportSummary[]; report: SocialReport | null;
  settings: { aiReportsEnabled: boolean; aiReportsConsentAt: string | null };
  canRefresh: boolean; canGenerate: boolean; lastWeekStart: string;
  /** „Zainteresowanie marką” — `null` przed migracją bazy (karta ukryta). */
  brand?: SocialBrandInterest | null;
};
export type SocialComment = {
  id: string; platform: SocialCommentPlatform; authorName: string; isOwn: boolean; message: string; commentedAt: string;
  likeCount: number; answeredAt: string | null; repliedByName: string | null;
};
export type SocialCommentThread = SocialComment & {
  postId: string; channel: SocialChannel; permalink: string | null; post: { id: string; title: string; thumbnailUrl: string | null } | null;
  replies: SocialComment[];
};
export type SocialComments = {
  companyId: string; threads: SocialCommentThread[]; unanswered: number; canReply: boolean;
  replyChannels: { facebook: boolean; instagram: boolean; linkedin?: boolean };
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
  /** Styl grafiki i napis nad tytułem (starszy serwer — brak). */
  style?: SocialGraphicStyle; kicker?: string;
};
/** Kolejne zdjęcie karuzeli (pozycja 1–9; okładka to `variants`) z grafikami w formatach feedu. */
export type SocialSlide = {
  position: number; assetId: string; asset: SocialAssetItem | null;
  formats: Array<{ format: SocialFormat; crop: SocialCrop | null; renderedUrl: string | null; upToDate: boolean }>;
};
/** Układ grafiki do wyboru (układ marki — `id`, gotowy — `key`); `slots` — liczba zdjęć (kolejne niż pierwsze — kolaż). */
export type SocialLayoutOption = {
  id: string | null; key: string | null; name: string; description: string; definition: Record<string, unknown>; slots: number; archived: boolean;
};
export type SocialPostLayout = {
  id: string | null; key: string | null; name: string; definition: Record<string, unknown>; slots: number;
  /** Układ zmieniono po zapisaniu posta (post ma migawkę) — „Wczytaj nową wersję” (`refresh`). */
  outdated?: boolean;
};
/** Zdjęcie kolażu w miejscu 1–3 (miejsce 0 — zdjęcie wariantu). */
export type SocialSlot = {
  slot: number; assetId: string; asset: SocialAssetItem | null;
  formats: Array<{ format: SocialFormat; crop: SocialCrop | null; effectiveCrop: SocialCrop | null; aspect: number }>;
};
/** Duża grafika (siatka profilu — rzędy po 3 kafelki, panorama — slajdy) z karty posta. */
export type SocialCanvasInfo = {
  mode: 'grid' | 'panorama'; rows: number | null; slides: number | null; tiles: number; width: number; height: number; label: string;
};
/** Kafelek / slajd po zapisie (1 — lewy górny); siatka publikuje się od ostatniego. */
export type SocialTile = { position: number; renderedUrl: string | null; upToDate: boolean };
/** Kształt dużej grafiki z definicji układu (`definition.canvas`). */
export type SocialCanvasShape = { mode: 'grid'; rows: number } | { mode: 'panorama'; slides: number };
export function socialCanvasOf(definition: Record<string, unknown> | null | undefined): SocialCanvasShape | null {
  const value = definition?.canvas as { mode?: unknown; rows?: unknown; slides?: unknown } | undefined;
  if (value?.mode === 'grid') return { mode: 'grid', rows: Math.min(3, Math.max(1, Number(value.rows) || 1)) };
  if (value?.mode === 'panorama') return { mode: 'panorama', slides: Math.min(5, Math.max(2, Number(value.slides) || 2)) };
  return null;
}
export const sameSocialCanvas = (a: SocialCanvasShape | null, b: SocialCanvasShape | null) =>
  Boolean(a && b) && a!.mode === b!.mode && (a!.mode === 'grid' ? a!.rows === (b as { rows: number }).rows : a!.slides === (b as { slides: number }).slides);
export const socialCanvasTiles = (shape: SocialCanvasShape) => (shape.mode === 'grid' ? shape.rows * 3 : shape.slides);
/** „Siatka · 6 kafelków”, „Panorama · 3 slajdy” — jak w CRM i na Macu. */
export const socialCanvasLabel = (mode: 'grid' | 'panorama', tiles: number) => (mode === 'grid'
  ? `Siatka · ${tiles} ${tiles === 3 ? 'kafelki' : 'kafelków'}` : `Panorama · ${tiles} ${tiles === 5 ? 'slajdów' : 'slajdy'}`);
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
  /** Karuzela (starszy serwer — brak). */
  slides?: SocialSlide[];
  /** Układ jako dane, układy do wyboru i zdjęcia kolażu (starszy serwer — brak). */
  layout?: SocialPostLayout | null;
  layouts?: SocialLayoutOption[];
  slots?: SocialSlot[];
  /** Siatka profilu / panorama: kształt, kafelki po zapisie i gotowe układy dużej grafiki (starszy serwer — brak). */
  canvas?: SocialCanvasInfo | null;
  tiles?: SocialTile[];
  canvasLayouts?: SocialLayoutOption[];
  channelFormats?: Partial<Record<SocialChannel, SocialFormat | null>>;
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
  template: { id: string; name: string; ready: boolean; problems: string[]; defaultStyle?: SocialGraphicStyle } | null;
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
