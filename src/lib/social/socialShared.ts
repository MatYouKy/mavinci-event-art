/*
 * Social media (Marketing → „Social media”) — wspólne dla CRM, serwera Next i aplikacji mobilnej
 * (kopia: mobile/src/lib/socialShared.ts, pilnuje scripts/ci/check-shared-copies.mjs). Bez importów.
 * Formaty grafik, kanały, statusy, zgody klienta, kadry (prostokąt znormalizowany do zdjęcia 0…1) i hashtagi —
 * te same reguły co w bazie (migracje 20261119200000_marketing_social_media.sql, 20261119220000_social_media_publishing.sql,
 * 20261119230000_social_media_insights.sql, 20261120140000_social_graphic_styles.sql i 20261121120000_social_carousels.sql).
 * Statystyki: metryki, pory publikacji i formatowanie liczb (bez `Intl`). Style grafik i napis nad tytułem. Karuzele.
 * LinkedIn (`linkedin_page`, migracja 20261121140000_social_linkedin.sql).
 */

export const SOCIAL_FORMATS = ['4:5', '1:1', '9:16', '1.91:1'] as const;
export type SocialFormat = (typeof SOCIAL_FORMATS)[number];

export const SOCIAL_FORMAT_INFO: Record<SocialFormat, { width: number; height: number; label: string; hint: string }> = {
  '4:5': { width: 1080, height: 1350, label: 'Post 4:5', hint: 'Instagram, Facebook i LinkedIn — najlepszy zasięg w feedzie' },
  '1:1': { width: 1080, height: 1080, label: 'Kwadrat 1:1', hint: 'Instagram, Facebook i LinkedIn' },
  '9:16': { width: 1080, height: 1920, label: 'Relacja 9:16', hint: 'Relacje — strefy bezpieczne u góry i u dołu' },
  '1.91:1': { width: 1200, height: 628, label: 'Poziomy 1,91:1', hint: 'Facebook i LinkedIn — post poziomy' },
};

export const isSocialFormat = (value: unknown): value is SocialFormat =>
  typeof value === 'string' && (SOCIAL_FORMATS as readonly string[]).includes(value);

/** Proporcja szerokość / wysokość formatu. */
export const formatAspect = (format: SocialFormat) => SOCIAL_FORMAT_INFO[format].width / SOCIAL_FORMAT_INFO[format].height;

/** Nazwa pliku bez dwukropka: „4x5”, „1x1”, „9x16”, „1.91x1”. */
export const formatSlug = (format: SocialFormat) => format.replace(':', 'x');

export const SOCIAL_CHANNELS = ['instagram_feed', 'instagram_story', 'facebook_feed', 'linkedin_page'] as const;
export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];

export const isSocialChannel = (value: unknown): value is SocialChannel =>
  typeof value === 'string' && (SOCIAL_CHANNELS as readonly string[]).includes(value);

export const SOCIAL_CHANNEL_LABELS: Record<SocialChannel, string> = {
  instagram_feed: 'Instagram — post',
  instagram_story: 'Instagram — relacja',
  facebook_feed: 'Facebook — post',
  linkedin_page: 'LinkedIn — post',
};

/** Formaty grafiki kanału w kolejności wyboru (pierwszy istniejący trafia do publikacji). */
export const SOCIAL_CHANNEL_FORMATS: Record<SocialChannel, SocialFormat[]> = {
  instagram_feed: ['4:5', '1:1'],
  instagram_story: ['9:16'],
  facebook_feed: ['1.91:1', '4:5', '1:1'],
  linkedin_page: ['1.91:1', '4:5', '1:1'],
};

/** Kanały publikowane przez Meta (Facebook, Instagram); LinkedIn — osobna integracja marki. */
export const isMetaChannel = (channel: SocialChannel) => channel !== 'linkedin_page';
/** Platforma kanału (zgoda klienta, komentarze). */
export const socialChannelPlatform = (channel: SocialChannel): 'instagram' | 'facebook' | 'linkedin' =>
  channel.startsWith('instagram') ? 'instagram' : channel === 'linkedin_page' ? 'linkedin' : 'facebook';

/** Format grafiki, który trafi do kanału (z formatów posta ze zdjęciem) albo `null`. */
export function channelFormat(channel: SocialChannel, formats: SocialFormat[]): SocialFormat | null {
  return SOCIAL_CHANNEL_FORMATS[channel].find((format) => formats.includes(format)) || null;
}

/** Formaty proponowane dla kanałów nowego posta (feed i Facebook — 4:5, relacja — 9:16). */
export function defaultFormatsForChannels(channels: SocialChannel[]): SocialFormat[] {
  const formats = new Set<SocialFormat>();
  if (channels.includes('instagram_feed') || channels.includes('facebook_feed') || channels.includes('linkedin_page')) formats.add('4:5');
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
export const SOCIAL_CONSENT_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'website'] as const;
export type SocialConsentPlatform = (typeof SOCIAL_CONSENT_PLATFORMS)[number];

export const SOCIAL_CONSENT_LABELS: Record<SocialConsentStatus, string> = {
  inherit: 'Jak dla eventu i klienta',
  unknown: 'Nieustalona',
  requested: 'Czeka na odpowiedź klienta',
  granted: 'Jest zgoda',
  denied: 'Brak zgody',
  not_required: 'Niepotrzebna',
};

export const SOCIAL_CONSENT_SOURCE_LABELS: Record<SocialConsentSource, string> = {
  asset: 'ustawiona dla zdjęcia',
  event: 'z eventu',
  organization: 'z klienta',
  none: 'brak ustaleń',
};

export const SOCIAL_CONSENT_PLATFORM_LABELS: Record<SocialConsentPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  website: 'Strona WWW',
};

/** Platforma komentarza (skrzynka komentarzy): Facebook, Instagram albo LinkedIn. */
export type SocialCommentPlatform = 'facebook' | 'instagram' | 'linkedin';
export const socialCommentPlatform = (value: unknown): SocialCommentPlatform =>
  value === 'facebook' || value === 'linkedin' ? value : 'instagram';
export const SOCIAL_COMMENT_PLATFORM_LABELS: Record<SocialCommentPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
};
/** Komunikat po opublikowaniu odpowiedzi marki. */
export const SOCIAL_REPLY_SUCCESS: Record<SocialCommentPlatform, string> = {
  facebook: 'Odpowiedź opublikowana na Facebooku',
  instagram: 'Odpowiedź opublikowana na Instagramie',
  linkedin: 'Odpowiedź opublikowana na LinkedInie',
};
/** Kto odpowiada (podpowiedź pola odpowiedzi). */
export const SOCIAL_REPLY_AUTHOR: Record<SocialCommentPlatform, string> = {
  facebook: 'strona marki',
  instagram: 'profil marki',
  linkedin: 'strona firmowa marki',
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
  event_file: 'Z plików eventu',
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
  /** Napis nad tytułem (np. „Realizacja”, „Za kulisami”). */
  kicker: 40,
  kickerRecommended: 22,
  note: 1000,
  /** Odpowiedź na komentarz (Facebook i Instagram). */
  reply: 1000,
  uploadBytes: 40 * 1024 * 1024,
  /** Kolejne zdjęcia karuzeli (poza okładką) — Instagram przyjmuje najwyżej 10 zdjęć w poście. */
  slides: 9,
} as const;

/** Formaty z karuzelą (feed Instagram i Facebook); relacja (9:16) ma jedno zdjęcie. */
export const SOCIAL_SLIDE_FORMATS: SocialFormat[] = ['4:5', '1:1', '1.91:1'];
export const isSocialSlideFormat = (format: SocialFormat) => SOCIAL_SLIDE_FORMATS.includes(format);

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

// Asystent AI (opisy i hashtagi) ----------------------------------------------------------------------------------------------

/** Cel posta — podpowiada asystentowi AI, o czym pisać. */
export const SOCIAL_AI_GOALS = {
  realization: 'Realizacja',
  backstage: 'Za kulisami',
  announcement: 'Zapowiedź',
  offer: 'Oferta i usługi',
  team: 'Zespół i sprzęt',
  inspiration: 'Inspiracja',
} as const;
export type SocialAiGoal = keyof typeof SOCIAL_AI_GOALS;

export const SOCIAL_AI_TONES = {
  elegant: 'Elegancki',
  warm: 'Ciepły',
  factual: 'Rzeczowy',
  energetic: 'Energiczny',
} as const;
export type SocialAiTone = keyof typeof SOCIAL_AI_TONES;

export const SOCIAL_AI_LENGTHS = {
  short: 'Krótki',
  medium: 'Średni',
  long: 'Dłuższy',
} as const;
export type SocialAiLength = keyof typeof SOCIAL_AI_LENGTHS;

/** Szybkie poprawki opisu (asystent przepisuje bieżący opis). */
export const SOCIAL_AI_REWRITES = {
  shorter: 'Krócej',
  elegant: 'Bardziej elegancko',
  cta: 'Dodaj zaproszenie do kontaktu',
  story: 'Jak krótka historia',
  fix: 'Popraw język',
  english: 'Po angielsku',
} as const;
export type SocialAiRewrite = keyof typeof SOCIAL_AI_REWRITES;

export type SocialAiMode = 'write' | 'rewrite' | 'hashtags';

/** Grupy podpowiedzi hashtagów: marka, branża, lokalne, temat posta. */
export const SOCIAL_AI_HASHTAG_GROUPS = {
  brand: 'Marka',
  industry: 'Branża',
  local: 'Lokalne',
  topic: 'Temat posta',
} as const;
export type SocialAiHashtagGroupKey = keyof typeof SOCIAL_AI_HASHTAG_GROUPS;
export type SocialAiHashtagGroup = { key: SocialAiHashtagGroupKey; label: string; tags: string[] };

/** Zalecana liczba hashtagów w poście (Instagram pozwala na 30, najlepiej działa kilka trafnych). */
export const SOCIAL_HASHTAGS_RECOMMENDED = { min: 3, max: 12 } as const;

const isKey = <T extends Record<string, string>>(map: T) => (value: unknown): value is keyof T & string =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(map, value);
export const isSocialAiGoal = isKey(SOCIAL_AI_GOALS);
export const isSocialAiTone = isKey(SOCIAL_AI_TONES);
export const isSocialAiLength = isKey(SOCIAL_AI_LENGTHS);
export const isSocialAiRewrite = isKey(SOCIAL_AI_REWRITES);

/** Przełącza hashtag w liście (dodaje na końcu albo usuwa) — bez względu na wielkość liter. */
export function toggleHashtag(current: readonly string[], tag: string): string[] {
  const [normalized] = normalizeHashtags([tag]);
  if (!normalized) return [...current];
  const key = normalized.toLocaleLowerCase('pl');
  return current.some((item) => item.toLocaleLowerCase('pl') === key)
    ? current.filter((item) => item.toLocaleLowerCase('pl') !== key)
    : [...current, normalized];
}

// Style grafik -----------------------------------------------------------------------------------------------------------

/**
 * Style grafiki posta — ten sam HTML na serwerze (render), w podglądzie na żywo CRM i w warstwie podglądu Maca.
 * Logo, kolory i fonty zawsze z szablonu marki (księga znaku); styl zmienia tylko układ, ramki, maski i cienie.
 * Zdjęcie zawsze wypełnia całą grafikę pod pozostałymi warstwami (passe-partout i kinowe pasy je zasłaniają).
 */
export const SOCIAL_GRAPHIC_STYLES = {
  classic: 'Klasyczny',
  frame: 'Rama',
  mat: 'Passe-partout',
  cinema: 'Kino',
  vignette: 'Winieta',
  cover: 'Okładka',
} as const;
export type SocialGraphicStyle = keyof typeof SOCIAL_GRAPHIC_STYLES;
export const SOCIAL_GRAPHIC_STYLE_LIST = Object.keys(SOCIAL_GRAPHIC_STYLES) as SocialGraphicStyle[];

export const SOCIAL_GRAPHIC_STYLE_HINTS: Record<SocialGraphicStyle, string> = {
  classic: 'Zdjęcie na całej grafice, przyciemniona góra i dół, logo u góry, tytuł i podpis na dole.',
  frame: 'Jak klasyczny, z cienką ramką w kolorze akcentu i miękkim cieniem przy krawędziach.',
  mat: 'Zdjęcie w passe-partout w kolorze marki z linią akcentu; tytuł i podpis na pasie pod zdjęciem.',
  cinema: 'Kinowe pasy u góry i u dołu: logo na górnym pasie, tytuł i podpis na dolnym.',
  vignette: 'Ciemna winieta wokół kadru — mocniejszy nastrój i uwaga na środku zdjęcia.',
  cover: 'Układ okładki: logo w rogu, duży tytuł wyrównany do lewej.',
};

/** Podpowiedzi napisu nad tytułem (wpisać można dowolny). */
export const SOCIAL_KICKER_SUGGESTIONS = ['Realizacja', 'Za kulisami', 'Zapowiedź', 'Case study', 'Nowość'] as const;

export const isSocialGraphicStyle = isKey(SOCIAL_GRAPHIC_STYLES);

/** Termin w kalendarzu: „pt 21.11, 18:30” (strefa Warszawa). */
export function socialDateLabel(value: string | null | undefined): string {
  if (!value) return 'Bez terminu';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Bez terminu';
  return date.toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

// Statystyki (Etap 3) ------------------------------------------------------------------------------------------------------

/** Metryki opublikowanych postów (stan narastająco od publikacji). Klucze w bazie: snake_case (`profile_visits`). */
export const SOCIAL_METRICS = [
  'views', 'reach', 'interactions', 'saves', 'profileVisits', 'shares', 'likes', 'comments', 'follows', 'clicks', 'replies',
] as const;
export type SocialMetricKey = (typeof SOCIAL_METRICS)[number];
export type SocialMetricValues = Partial<Record<SocialMetricKey, number>>;

export const SOCIAL_METRIC_LABELS: Record<SocialMetricKey, string> = {
  views: 'Wyświetlenia',
  reach: 'Zasięg',
  interactions: 'Interakcje',
  saves: 'Zapisania',
  profileVisits: 'Wejścia na profil',
  shares: 'Udostępnienia',
  likes: 'Polubienia i reakcje',
  comments: 'Komentarze',
  follows: 'Nowi obserwujący',
  clicks: 'Kliknięcia',
  replies: 'Odpowiedzi na relację',
};

export const SOCIAL_METRIC_HINTS: Record<SocialMetricKey, string> = {
  views: 'Ile razy treść została wyświetlona (z powtórzeniami).',
  reach: 'Liczba osób (kont), które zobaczyły treść — na Facebooku: unikalne wyświetlenia.',
  interactions: 'Polubienia, komentarze, zapisania i udostępnienia razem.',
  saves: 'Ile osób zapisało post na Instagramie.',
  profileVisits: 'Wejścia na profil Instagram z tego posta lub relacji.',
  shares: 'Udostępnienia posta.',
  likes: 'Polubienia (Instagram) i reakcje (Facebook).',
  comments: 'Komentarze pod postem.',
  follows: 'Konta, które zaczęły obserwować profil po tym poście.',
  clicks: 'Kliknięcia w post na Facebooku.',
  replies: 'Odpowiedzi na relację Instagram.',
};

/** Kafelki podsumowania (web, Mac, telefon). */
export const SOCIAL_KPI_METRICS: SocialMetricKey[] = ['views', 'reach', 'interactions', 'saves', 'profileVisits'];

export const SOCIAL_METRIC_COLUMNS: Record<SocialMetricKey, string> = {
  views: 'views', reach: 'reach', interactions: 'interactions', saves: 'saves', profileVisits: 'profile_visits', shares: 'shares',
  likes: 'likes', comments: 'comments', follows: 'follows', clicks: 'clicks', replies: 'replies',
};

/** Metryki z wiersza bazy (`social_publications.metrics` / `social_post_metrics_daily`) — tylko liczby ≥ 0. */
export function socialMetricsFromRow(row: Record<string, unknown> | null | undefined): SocialMetricValues {
  const result: SocialMetricValues = {};
  if (!row) return result;
  for (const key of SOCIAL_METRICS) {
    const value = Number(row[SOCIAL_METRIC_COLUMNS[key]]);
    if (row[SOCIAL_METRIC_COLUMNS[key]] != null && Number.isFinite(value) && value >= 0) result[key] = value;
  }
  return result;
}

/** Wskaźnik zaangażowania: interakcje / zasięg (gdy brak zasięgu — / wyświetlenia); `null` — brak danych. */
export function socialEngagementRate(metrics: SocialMetricValues): number | null {
  const base = metrics.reach && metrics.reach > 0 ? metrics.reach : metrics.views && metrics.views > 0 ? metrics.views : 0;
  return base > 0 && metrics.interactions != null ? metrics.interactions / base : null;
}

/** Pory publikacji (godziny w strefie Warszawa) do „Najlepszych godzin”. */
export const SOCIAL_TIME_BANDS = [
  { id: 'night', from: 0, to: 6, label: '0–6' },
  { id: 'morning', from: 6, to: 9, label: '6–9' },
  { id: 'forenoon', from: 9, to: 12, label: '9–12' },
  { id: 'noon', from: 12, to: 15, label: '12–15' },
  { id: 'afternoon', from: 15, to: 18, label: '15–18' },
  { id: 'evening', from: 18, to: 21, label: '18–21' },
  { id: 'late', from: 21, to: 24, label: '21–24' },
] as const;

export const socialTimeBand = (hour: number) =>
  Math.max(0, SOCIAL_TIME_BANDS.findIndex((band) => hour >= band.from && hour < band.to));

/** Dni tygodnia od poniedziałku (0 = poniedziałek). */
export const SOCIAL_WEEKDAYS = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'] as const;
export const SOCIAL_WEEKDAYS_SHORT = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'] as const;

export const socialSlotLabel = (weekday: number, band: number) =>
  `${SOCIAL_WEEKDAYS[weekday] || ''} ${SOCIAL_TIME_BANDS[band]?.label || ''}`.trim();

/** Najmniej opublikowanych postów z wynikami, by pokazać najlepsze pory (i najmniej postów w jednej porze). */
export const SOCIAL_BEST_TIMES_MIN_SAMPLE = 5;
export const SOCIAL_BEST_TIMES_MIN_POSTS = 2;

/** Zakresy statystyk (dni). */
export const SOCIAL_STATS_RANGES = [7, 28, 90] as const;

/** Liczba: „1 234”, „12,3 tys.”, „1,2 mln”; brak danych — „—”. */
export function formatSocialNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace('.', ',')} mln`;
  if (abs >= 10_000) return `${sign}${(abs / 1000).toFixed(1).replace('.', ',')} tys.`;
  return `${sign}${String(Math.round(abs)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')}`;
}

/** Odsetek: „4,2%”. */
export const formatSocialPercent = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1).replace('.', ',')}%`;

/** Zmiana wobec poprzedniego okresu: „+12%”, „−5%”, „nowe” (poprzednio 0), `null` — brak porównania. */
export function socialChangeLabel(current: number | null | undefined, previous: number | null | undefined): string | null {
  if (current == null || previous == null) return null;
  if (previous === 0) return current > 0 ? 'nowe' : null;
  const change = Math.round(((current - previous) / previous) * 100);
  return change === 0 ? '0%' : change > 0 ? `+${change}%` : `−${Math.abs(change)}%`;
}

/** Okres raportu z dat „RRRR-MM-DD”: „10–16.11.2026”, „27.10–02.11.2026”, „29.12.2025–04.01.2026”. */
export function socialPeriodLabel(start: string, end: string): string {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(start || '');
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(end || '');
  if (!a || !b) return [start, end].filter(Boolean).join(' – ');
  if (a[1] !== b[1]) return `${a[3]}.${a[2]}.${a[1]}–${b[3]}.${b[2]}.${b[1]}`;
  if (a[2] !== b[2]) return `${a[3]}.${a[2]}–${b[3]}.${b[2]}.${b[1]}`;
  return `${a[3]}–${b[3]}.${b[2]}.${b[1]}`;
}

/** Odmiana: 1 post, 2 posty, 5 postów. */
export function socialPlural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.trunc(count));
  if (n === 1) return one;
  return n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
}

export const SOCIAL_RECOMMENDATION_PRIORITY_LABELS: Record<string, string> = { high: 'Wysoki', medium: 'Średni', low: 'Niski' };
