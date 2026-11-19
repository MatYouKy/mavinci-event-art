/*
 * Social media (Marketing → „Social media”) — wspólne dla CRM, serwera Next i aplikacji mobilnej
 * (kopia: mobile/src/lib/socialShared.ts, pilnuje scripts/ci/check-shared-copies.mjs). Bez importów.
 * Formaty grafik, kanały, statusy, zgody klienta, kadry (prostokąt znormalizowany do zdjęcia 0…1) i hashtagi —
 * te same reguły co w bazie (migracje 20261119200000_marketing_social_media.sql i 20261119220000_social_media_publishing.sql).
 */

export const SOCIAL_FORMATS = ['4:5', '1:1', '9:16', '1.91:1'] as const;
export type SocialFormat = (typeof SOCIAL_FORMATS)[number];

export const SOCIAL_FORMAT_INFO: Record<SocialFormat, { width: number; height: number; label: string; hint: string }> = {
  '4:5': { width: 1080, height: 1350, label: 'Post 4:5', hint: 'Instagram i Facebook — najlepszy zasięg w feedzie' },
  '1:1': { width: 1080, height: 1080, label: 'Kwadrat 1:1', hint: 'Instagram i Facebook' },
  '9:16': { width: 1080, height: 1920, label: 'Relacja 9:16', hint: 'Relacje — strefy bezpieczne u góry i u dołu' },
  '1.91:1': { width: 1200, height: 628, label: 'Poziomy 1,91:1', hint: 'Facebook — post poziomy' },
};

export const isSocialFormat = (value: unknown): value is SocialFormat =>
  typeof value === 'string' && (SOCIAL_FORMATS as readonly string[]).includes(value);

/** Proporcja szerokość / wysokość formatu. */
export const formatAspect = (format: SocialFormat) => SOCIAL_FORMAT_INFO[format].width / SOCIAL_FORMAT_INFO[format].height;

/** Nazwa pliku bez dwukropka: „4x5”, „1x1”, „9x16”, „1.91x1”. */
export const formatSlug = (format: SocialFormat) => format.replace(':', 'x');

export const SOCIAL_CHANNELS = ['instagram_feed', 'instagram_story', 'facebook_feed'] as const;
export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];

export const isSocialChannel = (value: unknown): value is SocialChannel =>
  typeof value === 'string' && (SOCIAL_CHANNELS as readonly string[]).includes(value);

export const SOCIAL_CHANNEL_LABELS: Record<SocialChannel, string> = {
  instagram_feed: 'Instagram — post',
  instagram_story: 'Instagram — relacja',
  facebook_feed: 'Facebook — post',
};

/** Formaty grafiki kanału w kolejności wyboru (pierwszy istniejący trafia do publikacji). */
export const SOCIAL_CHANNEL_FORMATS: Record<SocialChannel, SocialFormat[]> = {
  instagram_feed: ['4:5', '1:1'],
  instagram_story: ['9:16'],
  facebook_feed: ['1.91:1', '4:5', '1:1'],
};

/** Format grafiki, który trafi do kanału (z formatów posta ze zdjęciem) albo `null`. */
export function channelFormat(channel: SocialChannel, formats: SocialFormat[]): SocialFormat | null {
  return SOCIAL_CHANNEL_FORMATS[channel].find((format) => formats.includes(format)) || null;
}

/** Formaty proponowane dla kanałów nowego posta (feed i Facebook — 4:5, relacja — 9:16). */
export function defaultFormatsForChannels(channels: SocialChannel[]): SocialFormat[] {
  const formats = new Set<SocialFormat>();
  if (channels.includes('instagram_feed') || channels.includes('facebook_feed')) formats.add('4:5');
  if (channels.includes('instagram_story')) formats.add('9:16');
  if (!formats.size) formats.add('4:5');
  return SOCIAL_FORMATS.filter((format) => formats.has(format));
}

export const SOCIAL_POST_STATUSES = [
  'draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'publishing', 'failed', 'published', 'cancelled',
] as const;
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];

export const SOCIAL_POST_STATUS_LABELS: Record<SocialPostStatus, string> = {
  draft: 'Szkic',
  in_review: 'Do akceptacji',
  changes_requested: 'Do poprawy',
  approved: 'Zatwierdzony',
  scheduled: 'Zaplanowany',
  publishing: 'Publikowanie…',
  failed: 'Błąd publikacji',
  published: 'Opublikowany',
  cancelled: 'Anulowany',
};

/** Etykieta statusu (także nieznanego — np. ze starszej wersji aplikacji). */
export const socialPostStatusLabel = (status: string) =>
  (SOCIAL_POST_STATUS_LABELS as Record<string, string>)[status] || status;

/** Treść posta można zmieniać (opublikowany, anulowany i publikowany — nie; po części opublikowanych kanałów — tylko kopia). */
export const socialPostEditable = (status: SocialPostStatus) =>
  status !== 'published' && status !== 'cancelled' && status !== 'publishing';

export type SocialPostAction = 'submit' | 'approve' | 'request_changes' | 'reopen' | 'cancel' | 'schedule' | 'unschedule' | 'publish';

export const SOCIAL_POST_ACTION_LABELS: Record<SocialPostAction, string> = {
  submit: 'Wyślij do akceptacji',
  approve: 'Zatwierdź',
  request_changes: 'Do poprawy',
  reopen: 'Przywróć do szkicu',
  cancel: 'Anuluj post',
  schedule: 'Zaplanuj publikację',
  unschedule: 'Wstrzymaj publikację',
  publish: 'Oznacz jako opublikowany',
};

export const SOCIAL_POST_ACTION_SUCCESS: Record<SocialPostAction, string> = {
  submit: 'Wysłano post do akceptacji',
  approve: 'Post zatwierdzony',
  request_changes: 'Post wrócił do poprawy',
  reopen: 'Post jest znowu szkicem',
  cancel: 'Post anulowany',
  schedule: 'Publikacja zaplanowana',
  unschedule: 'Publikacja wstrzymana — post jest zatwierdzony',
  publish: 'Post oznaczony jako opublikowany',
};

/** Stan publikacji kanału w Meta. */
export const SOCIAL_PUBLICATION_STATUS_LABELS: Record<string, string> = {
  pending: 'Czeka',
  sending: 'Wysyłanie',
  published: 'Opublikowano',
  failed: 'Błąd',
};

export type SocialAccess = {
  view: boolean;
  create: boolean;
  consent: boolean;
  approve: boolean;
  publish: boolean;
  admin: boolean;
  employeeId: string | null;
};

export const NO_SOCIAL_ACCESS: SocialAccess = {
  view: false, create: false, consent: false, approve: false, publish: false, admin: false, employeeId: null,
};

/**
 * Akcje dostępne dla posta (te same reguły co `social_post_transition`; ostateczną decyzję podejmuje baza).
 * `partial` — część kanałów jest już opublikowana w Meta (wtedy bez cofania do szkicu, poprawek i anulowania).
 * „Opublikuj teraz” i „Ponów publikację” — `socialCanPublishNow`.
 */
export function socialPostActions(
  post: { status: SocialPostStatus; authorId: string | null; revision: number; approvedRevision: number | null },
  access: SocialAccess,
  options: { partial?: boolean } = {},
): SocialPostAction[] {
  const actions: SocialPostAction[] = [];
  const own = Boolean(access.employeeId && post.authorId === access.employeeId);
  const approvedVersion = post.approvedRevision === post.revision;
  const partial = options.partial === true;
  if (access.create && (post.status === 'draft' || post.status === 'changes_requested')) actions.push('submit');
  if (access.approve && post.status === 'in_review' && (!own || access.admin)) actions.push('approve');
  if (access.approve && !partial && ['in_review', 'approved', 'scheduled', 'failed'].includes(post.status)) actions.push('request_changes');
  if (access.publish && (post.status === 'approved' || post.status === 'failed') && approvedVersion) actions.push('schedule');
  if (access.publish && (post.status === 'scheduled' || post.status === 'failed')) actions.push('unschedule');
  if (access.publish && ['approved', 'scheduled', 'failed'].includes(post.status) && approvedVersion) actions.push('publish');
  if (access.create && !partial && ['changes_requested', 'approved', 'cancelled', 'in_review', 'scheduled', 'failed'].includes(post.status)) {
    actions.push('reopen');
  }
  if (access.create && !partial && !['published', 'cancelled', 'publishing'].includes(post.status)) actions.push('cancel');
  return actions;
}

/** „Opublikuj teraz” (zatwierdzony, zaplanowany) albo „Ponów publikację” (błąd) — publikujący, zatwierdzona wersja. */
export const socialCanPublishNow = (
  post: { status: SocialPostStatus; revision: number; approvedRevision: number | null },
  access: SocialAccess,
) => access.publish && ['approved', 'scheduled', 'failed'].includes(post.status) && post.approvedRevision === post.revision;

export const SOCIAL_CONSENT_STATUSES = ['inherit', 'unknown', 'requested', 'granted', 'denied', 'not_required'] as const;
export type SocialConsentStatus = (typeof SOCIAL_CONSENT_STATUSES)[number];
export type SocialConsentSource = 'asset' | 'event' | 'organization' | 'none';
export const SOCIAL_CONSENT_PLATFORMS = ['instagram', 'facebook', 'website'] as const;
export type SocialConsentPlatform = (typeof SOCIAL_CONSENT_PLATFORMS)[number];

export const SOCIAL_CONSENT_LABELS: Record<SocialConsentStatus, string> = {
  inherit: 'Jak dla wydarzenia i klienta',
  unknown: 'Nieustalona',
  requested: 'Czeka na odpowiedź klienta',
  granted: 'Jest zgoda',
  denied: 'Brak zgody',
  not_required: 'Niepotrzebna',
};

export const SOCIAL_CONSENT_SOURCE_LABELS: Record<SocialConsentSource, string> = {
  asset: 'ustawiona dla zdjęcia',
  event: 'z wydarzenia',
  organization: 'z klienta',
  none: 'brak ustaleń',
};

export const SOCIAL_CONSENT_PLATFORM_LABELS: Record<SocialConsentPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  website: 'Strona WWW',
};

/** Zgoda pozwala na publikację (jak w bazie: „jest” albo „niepotrzebna”). */
export const socialConsentAllows = (status: string) => status === 'granted' || status === 'not_required';

export const SOCIAL_ASSET_STATUSES = ['uploading', 'proposed', 'ready', 'archived'] as const;
export type SocialAssetStatus = (typeof SOCIAL_ASSET_STATUSES)[number];
export const SOCIAL_ASSET_STATUS_LABELS: Record<SocialAssetStatus, string> = {
  uploading: 'Wgrywanie',
  proposed: 'Propozycja',
  ready: 'W bibliotece',
  archived: 'Archiwum',
};

export type SocialAssetSource = 'upload' | 'event_file' | 'portfolio' | 'camera' | 'mac';
export const SOCIAL_ASSET_SOURCE_LABELS: Record<SocialAssetSource, string> = {
  upload: 'Z dysku',
  event_file: 'Z plików wydarzenia',
  portfolio: 'Z realizacji na stronie',
  camera: 'Z telefonu',
  mac: 'Z Maca',
};

/** Limity jak w bazie. */
export const SOCIAL_LIMITS = {
  title: 160,
  caption: 2200,
  hashtags: 30,
  headline: 80,
  subline: 120,
  /** Zalecana długość tytułu na grafice (dłuższy tytuł jest zmniejszany, żeby zmieścił się w marginesach). */
  headlineRecommended: 30,
  sublineRecommended: 60,
  note: 1000,
  /** Odpowiedź na komentarz (Facebook i Instagram). */
  reply: 1000,
  uploadBytes: 40 * 1024 * 1024,
} as const;

export const SOCIAL_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

// Kadry ------------------------------------------------------------------------------------------------------------------

export type SocialCrop = { x: number; y: number; w: number; h: number };
export type SocialCrops = Partial<Record<SocialFormat, SocialCrop>>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 10000) / 10000;

export function isSocialCrop(value: unknown): value is SocialCrop {
  if (!value || typeof value !== 'object') return false;
  const crop = value as Record<string, unknown>;
  return ['x', 'y', 'w', 'h'].every((key) => typeof crop[key] === 'number' && Number.isFinite(crop[key] as number))
    && (crop.x as number) >= 0 && (crop.y as number) >= 0 && (crop.w as number) > 0.01 && (crop.h as number) > 0.01
    && (crop.x as number) + (crop.w as number) <= 1.0001 && (crop.y as number) + (crop.h as number) <= 1.0001;
}

/** Największy kadr formatu pośrodku zdjęcia. */
export function centerCrop(imageWidth: number, imageHeight: number, format: SocialFormat): SocialCrop {
  const aspect = formatAspect(format);
  const imageAspect = imageWidth / imageHeight;
  if (imageAspect > aspect) {
    const w = aspect / imageAspect;
    return { x: round((1 - w) / 2), y: 0, w: round(w), h: 1 };
  }
  const h = imageAspect / aspect;
  return { x: 0, y: round((1 - h) / 2), w: 1, h: round(h) };
}

/**
 * Kadr dopasowany do proporcji formatu i granic zdjęcia: zachowuje środek i szerokość (o ile się mieści),
 * najmniejszy kadr — 8% szerokości zdjęcia.
 */
export function fitCrop(crop: SocialCrop, imageWidth: number, imageHeight: number, format: SocialFormat): SocialCrop {
  const aspect = formatAspect(format);
  const centerX = crop.x + crop.w / 2;
  const centerY = crop.y + crop.h / 2;
  let widthPx = clamp(crop.w, 0.08, 1) * imageWidth;
  let heightPx = widthPx / aspect;
  if (heightPx > imageHeight) {
    heightPx = imageHeight;
    widthPx = heightPx * aspect;
  }
  if (widthPx > imageWidth) {
    widthPx = imageWidth;
    heightPx = widthPx / aspect;
  }
  const w = widthPx / imageWidth;
  const h = heightPx / imageHeight;
  return {
    x: round(clamp(centerX - w / 2, 0, 1 - w)),
    y: round(clamp(centerY - h / 2, 0, 1 - h)),
    w: round(w),
    h: round(h),
  };
}

/** Przesunięcie kadru o (dx, dy) w ułamkach zdjęcia. */
export const moveCrop = (crop: SocialCrop, dx: number, dy: number): SocialCrop => ({
  ...crop,
  x: round(clamp(crop.x + dx, 0, 1 - crop.w)),
  y: round(clamp(crop.y + dy, 0, 1 - crop.h)),
});

/** Powiększenie (factor < 1 — przybliżenie) wokół środka kadru, w granicach zdjęcia. */
export function zoomCrop(crop: SocialCrop, factor: number, imageWidth: number, imageHeight: number, format: SocialFormat): SocialCrop {
  return fitCrop({ ...crop, w: crop.w * factor, h: crop.h * factor, x: crop.x + (crop.w - crop.w * factor) / 2, y: crop.y + (crop.h - crop.h * factor) / 2 },
    imageWidth, imageHeight, format);
}

/** Kadr wariantu: własny, propozycja zdjęcia albo środek. */
export function effectiveCrop(
  own: SocialCrop | null | undefined,
  proposals: SocialCrops | null | undefined,
  imageWidth: number,
  imageHeight: number,
  format: SocialFormat,
): SocialCrop {
  if (own && isSocialCrop(own)) return own;
  const proposal = proposals?.[format];
  if (proposal && isSocialCrop(proposal)) return proposal;
  return centerCrop(imageWidth, imageHeight, format);
}

// Tekst ------------------------------------------------------------------------------------------------------------------

/** Hashtagi jak w bazie: „#” na początku, bez spacji i interpunkcji, bez powtórzeń, w kolejności wpisania. */
export function normalizeHashtags(input: string | readonly string[] | null | undefined): string[] {
  const raw = typeof input === 'string' ? input.split(/[\s,;]+/) : Array.from(input || []);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const tag = `#${String(item || '').replace(/[\]\[\s#.,;:!?"'()<>{}/\\|]+/g, '')}`;
    if (tag === '#' || seen.has(tag.toLocaleLowerCase('pl'))) continue;
    seen.add(tag.toLocaleLowerCase('pl'));
    result.push(tag);
  }
  return result;
}

/** Tekst do publikacji: opis i hashtagi (oddzielone pustą linią). */
export function socialPublicationText(caption: string, hashtags: readonly string[]): string {
  const body = caption.trim();
  const tags = hashtags.join(' ').trim();
  return body && tags ? `${body}\n\n${tags}` : body || tags;
}

/** Tytuł i podpis na grafice — wersaliki jak w szablonie marki. */
export const socialGraphicText = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('pl-PL');

/** Termin w kalendarzu: „pt 21.11, 18:30” (strefa Warszawa). */
export function socialDateLabel(value: string | null | undefined): string {
  if (!value) return 'Bez terminu';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Bez terminu';
  return date.toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
