import { supabase } from '@/lib/supabase/browser';
import type { SocialAccess, SocialAssetSource, SocialAssetStatus, SocialChannel, SocialConsentSource, SocialConsentStatus, SocialCrop, SocialCrops, SocialFormat, SocialMetricValues, SocialPostAction, SocialPostStatus } from '@/lib/social/socialShared';
import type { SocialTemplateSettings } from '@/lib/social/socialGraphic';

/*
 * Klient API social media w CRM — to samo API co Mac i telefon (`/bridge/native/v1/social`, token sesji pracownika,
 * `x-mavinci-client: web`). Pliki zdjęć trafiają do prywatnego bucketu `social-media` bezpośrednio z przeglądarki.
 */

export type SocialCompany = { id: string; name: string; isDefault: boolean };
export type SocialSettings = {
  aiCaptionsEnabled: boolean; aiConsentAt: string | null; aiReportsEnabled?: boolean; aiReportsConsentAt?: string | null;
  defaultHashtags: string[]; captionStyle: string; updatedAt: string | null;
};
export type SocialTemplate = {
  id: string; name: string; isDefault: boolean; ready: boolean; problems: string[];
  logoId: string | null; titleFontId: string | null; captionFontId: string | null;
  overlayColorId: string | null; accentColorId: string | null; textColorId: string | null;
  colors: { overlay: string | null; accent: string | null; text: string | null };
  logoUrl: string | null; titleFontLabel: string; captionFontLabel: string; updatedAt: string;
};
export type SocialPostItem = {
  id: string; companyId: string; title: string; status: SocialPostStatus; channels: SocialChannel[]; scheduledAt: string | null;
  captionPreview: string; thumbnailUrl: string | null; formats: SocialFormat[]; authorId: string | null; authorName: string | null;
  revision: number; approvedRevision: number | null; eventId: string | null; publishedAt: string | null; publishedUrl: string | null;
  publishError: string | null; updatedAt: string;
};
/** Konto Meta marki (bez tokenów): strona, Instagram, gotowość kanałów, komentarze, brakujące uprawnienia. */
export type SocialMetaStatus = {
  connected: boolean; pageId: string | null; pageName: string | null; instagramId: string | null; instagramUsername: string | null;
  channels: Record<SocialChannel, { ready: boolean; problem: string | null }>;
  comments: { facebookRead: boolean; facebookReply: boolean; instagram: boolean };
  /** Statystyki postów: Facebook `read_insights`, Instagram `instagram_manage_insights` (Etap 3). */
  insights?: { facebook: boolean; instagram: boolean };
  missingScopes: string[]; lastError: string | null;
};
export type SocialHome = {
  companies: SocialCompany[]; company: SocialCompany; access: SocialAccess; range: { from: string; to: string };
  settings: SocialSettings; templates: SocialTemplate[]; posts: SocialPostItem[];
  counts: { inReview: number; changesRequested: number; failed: number; proposals: number; unansweredComments: number };
  meta: SocialMetaStatus | null;
};
export type SocialPublication = {
  channel: SocialChannel; status: string; format: SocialFormat | null; permalink: string | null; error: string | null; attempts: number;
  publishedAt: string | null; attemptedAt: string | null;
  /** Wyniki z Meta (Etap 3) — stan narastająco od publikacji. */
  metrics?: SocialMetricValues; rate?: number | null; metricsSyncedAt?: string | null; metricsError?: string | null;
};
/** Suma wyników publikacji (`posts` — posty, `publications` — kanały, `rate` — interakcje / zasięg). */
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
/** Zakładka „Statystyki” (`op=stats`). */
export type SocialStats = {
  companies: SocialCompany[]; company: SocialCompany; access: SocialAccess; range: { days: number; from: string; to: string };
  totals: SocialTotals; previous: SocialTotals; channels: Array<{ channel: SocialChannel; totals: SocialTotals }>;
  timeline: Array<{ date: string; views: number; interactions: number }>;
  bestTimes: { sample: number; minSample: number; cells: SocialBestTime[]; top: SocialBestTime[] };
  topPosts: SocialTopPost[];
  sync: { publications: number; withMetrics: number; lastSyncedAt: string | null; problems: string[] };
  insights: { connected: boolean; facebook: boolean; instagram: boolean; missingScopes: string[] };
  reports: SocialReportSummary[]; report: SocialReport | null;
  settings: { aiReportsEnabled: boolean; aiReportsConsentAt: string | null };
  canRefresh: boolean; canGenerate: boolean; lastWeekStart: string;
};
export type SocialComment = {
  id: string; platform: 'facebook' | 'instagram'; authorName: string; isOwn: boolean; message: string; commentedAt: string; likeCount: number;
  answeredAt: string | null; repliedByName: string | null;
};
export type SocialCommentThread = SocialComment & {
  postId: string; channel: SocialChannel; permalink: string | null; post: { id: string; title: string; thumbnailUrl: string | null } | null;
  replies: SocialComment[];
};
export type SocialComments = {
  companyId: string; threads: SocialCommentThread[]; unanswered: number; canReply: boolean;
  replyChannels: { facebook: boolean; instagram: boolean };
};
export type SocialConsentState = { status: string; channels: string[]; source: SocialConsentSource };
export type SocialAsset = {
  id: string; companyId: string; kind: string; source: SocialAssetSource; status: SocialAssetStatus; title: string; note: string;
  originalName: string; width: number | null; height: number | null; thumbnailUrl: string | null; workUrl: string | null; crops: SocialCrops;
  eventId: string | null; eventName: string | null; eventDate: string | null; organizationId: string | null; organizationName: string | null;
  portfolioProjectId: string | null; portfolioTitle: string | null; visibleBrands: string[]; consentStatus: SocialConsentStatus;
  consentChannels: string[]; consentNote: string; consentBy: string | null; consentAt: string | null; consent: SocialConsentState;
  createdBy: string | null; createdByName: string | null; createdAt: string; updatedAt: string; usedIn: number;
};
export type SocialLibrary = {
  companies: SocialCompany[]; company: SocialCompany; access: SocialAccess; assets: SocialAsset[]; total: number; offset: number; limit: number; proposals: number;
};
export type SocialAssetDetail = { asset: SocialAsset; access: SocialAccess; posts: Array<{ id: string; title: string; status: string; scheduledAt: string | null }>; duplicateOf?: string; message?: string };
export type SocialGuides = { logo: GuideRect; text: GuideRect; unsafeTop: GuideRect | null; unsafeBottom: GuideRect | null };
type GuideRect = { x: number; y: number; w: number; h: number };
export type SocialSpec = {
  templateId: string; ready: boolean; logo: { src: string; aspect: number | null } | null;
  titleFont: { family: string; src: string | null }; captionFont: { family: string; src: string | null };
  colors: { overlay: string; accent: string; text: string }; settings: SocialTemplateSettings; guides: Record<SocialFormat, SocialGuides>;
};
export type SocialVariant = {
  id: string; format: SocialFormat; assetId: string | null; crop: SocialCrop | null; effectiveCrop: SocialCrop | null; headline: string; subline: string;
  renderedUrl: string | null; renderedAt: string | null; upToDate: boolean; asset: SocialAsset | null;
};
export type SocialAiSuggestion = { caption: string; hashtags: string[]; headline: string; subline: string; model?: string; createdAt?: string };
export type SocialPostDetail = {
  company: { id: string; name: string };
  post: SocialPostItem & {
    caption: string; hashtags: string[]; templateId: string | null; portfolioProjectId: string | null; aiSuggestions: SocialAiSuggestion[];
    submittedAt: string | null; reviewedAt: string | null; reviewedByName: string | null; reviewNote: string | null; publishedByName: string | null;
    scheduledByName: string | null; publishAttempts: number; createdAt: string;
  };
  access: SocialAccess; actions: SocialPostAction[]; canPublishNow: boolean; variants: SocialVariant[];
  channelFormats: Partial<Record<SocialChannel, SocialFormat | null>>;
  problems: { submit: string[]; publish: string[]; meta: string[] };
  publications: SocialPublication[]; meta: SocialMetaStatus | null; comments: { total: number; unanswered: number };
  /** Wynik „Opublikuj teraz” (tylko w odpowiedzi na tę operację). */
  publishResult?: { status: string; error: string | null };
  history: Array<{ kind: string; actorName: string | null; note: string | null; revision: number | null; createdAt: string }>;
  template: SocialTemplate | null; templates: SocialTemplate[]; spec: SocialSpec | null;
  event: { id: string; name: string; date: string | null; location: string; organizationName: string | null } | null;
  portfolio: { id: string; title: string } | null;
  grid: Array<{ id: string; status: SocialPostStatus; imageUrl: string | null; date: string | null; source?: 'crm' | 'instagram'; permalink?: string | null }>;
  publicationText: string; settings: SocialSettings;
};
export type SocialConsent = { id: string; eventId: string | null; organizationId: string | null; status: string; channels: string[]; note: string; decidedAt: string | null };
export type SocialEventOption = {
  id: string; name: string; date: string | null; location: string; organizationId: string | null; organizationName: string | null;
  eventConsent: SocialConsent | null; organizationConsent: SocialConsent | null;
};
export type SocialBrandbook = {
  logos: Array<{ id: string; label: string; variant: string; background: string; url: string | null }>;
  fonts: Array<{ id: string; label: string; family: string; role: string; hasFile: boolean }>;
  colors: Array<{ id: string; label: string; hex: string; role: string }>;
};

const ENDPOINT = '/bridge/native/v1/social';

async function headers(json: boolean) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw Object.assign(new Error('Sesja wygasła. Zaloguj się ponownie.'), { status: 401 });
  return { Authorization: `Bearer ${token}`, 'x-mavinci-client': 'web', ...(json ? { 'Content-Type': 'application/json' } : {}) };
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body?.error || 'Operacja nie powiodła się.'), { status: response.status });
  return body as T;
}

export async function socialGet<T>(op: string, params: Record<string, string | number | null | undefined> = {}): Promise<T> {
  const query = new URLSearchParams({ op });
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') query.set(key, String(value));
  return parse<T>(await fetch(`${ENDPOINT}?${query.toString()}`, { headers: await headers(false), cache: 'no-store' }));
}

export async function socialPost<T>(op: string, body: Record<string, unknown>): Promise<T> {
  return parse<T>(await fetch(ENDPOINT, { method: 'POST', headers: await headers(true), body: JSON.stringify({ ...body, op }) }));
}

/** Paczka posta (ZIP) — zapis przez przeglądarkę. */
export async function downloadSocialPackage(id: string, fallbackName: string) {
  const response = await fetch(`${ENDPOINT}?op=package&id=${encodeURIComponent(id)}`, { headers: await headers(false), cache: 'no-store' });
  if (!response.ok) await parse(response);
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Zdjęcie z dysku: wpis w bibliotece → plik do `social-media` → analiza na serwerze. */
export async function uploadSocialPhoto(file: File, options: { companyId?: string | null; eventId?: string | null }): Promise<SocialAssetDetail> {
  const created = await socialPost<{ assetId: string; bucket: string; path: string }>('assetCreate', {
    companyId: options.companyId || null, eventId: options.eventId || null, fileName: file.name, mimeType: file.type, bytes: file.size, source: 'upload',
  });
  const { error } = await supabase.storage.from(created.bucket).upload(created.path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
  if (error) {
    await socialPost('assetDelete', { id: created.assetId }).catch(() => undefined);
    throw new Error('Nie udało się wgrać zdjęcia. Sprawdź połączenie i spróbuj ponownie.');
  }
  return socialPost<SocialAssetDetail>('assetFinish', { id: created.assetId });
}
