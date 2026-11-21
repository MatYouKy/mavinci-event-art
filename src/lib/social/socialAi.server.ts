import 'server-only';
import { fail } from './socialCommon.server';
import {
  SOCIAL_AI_GOALS, SOCIAL_AI_HASHTAG_GROUPS, SOCIAL_AI_LENGTHS, SOCIAL_AI_REWRITES, SOCIAL_AI_TONES, SOCIAL_HASHTAGS_RECOMMENDED,
  SOCIAL_CHANNEL_LABELS, SOCIAL_LIMITS, normalizeHashtags,
  type SocialAiGoal, type SocialAiHashtagGroup, type SocialAiHashtagGroupKey, type SocialAiLength, type SocialAiMode, type SocialAiRewrite,
  type SocialAiTone, type SocialChannel,
} from './socialShared';

/*
 * Asystent AI postów social media na konfiguracji OpenAI marketingu (`OPENAI_API_KEY`, `OPENAI_MARKETING_MODEL`).
 * Włącza go akceptujący w ustawieniach social media marki (`social_settings.ai_captions_enabled`, zgoda z datą i osobą).
 * Tryby: 3 wersje opisu z hashtagami, tytułem i podpisem grafiki (temat, cel, ton, długość), przepisanie bieżącego opisu
 * (szybkie poprawki albo własne polecenie) i podpowiedzi hashtagów w grupach. Do AI trafiają tylko treści realizacji bez
 * danych osobowych: temat i opis wpisane w kreatorze, rodzaj wydarzenia, miejsce, miesiąc, opis realizacji ze strony;
 * nazwa wydarzenia i klient — wyłącznie przy zgodzie klienta na publikację; zdjęcie (miniatura 640 px) — tylko na prośbę
 * w kreatorze i gdy zdjęcie ma zgodę klienta na publikację.
 */

export type SocialAiContext = {
  brand: string;
  channels: SocialChannel[];
  eventName: string | null;
  clientName: string | null;
  category: string | null;
  venue: string | null;
  city: string | null;
  month: string | null;
  portfolioTitle: string | null;
  portfolioDescription: string | null;
  draftCaption: string;
  draftHashtags?: string[];
  headline: string;
  subline: string;
  styleNote: string;
  defaultHashtags: string[];
};

export type SocialAiSuggestion = { caption: string; hashtags: string[]; headline: string; subline: string };

export type SocialAssistRequest = {
  mode: SocialAiMode;
  topic: string;
  goal: SocialAiGoal | null;
  tone: SocialAiTone | null;
  length: SocialAiLength | null;
  rewrite: SocialAiRewrite | null;
  instruction: string;
  /** Miniatura zdjęcia jako `data:image/jpeg;base64,…` (tylko za zgodą — decyduje serwer posta). */
  photo: string | null;
};

export type SocialAssistResult = {
  mode: SocialAiMode;
  suggestions: SocialAiSuggestion[];
  hashtagGroups: SocialAiHashtagGroup[];
  usedPhoto: boolean;
  model: string;
};

function extractResponseText(response: any) {
  if (typeof response?.output_text === 'string') return response.output_text;
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

/** Fakty posta dla AI — tylko pola z wartością. */
function factsOf(context: SocialAiContext) {
  return Object.fromEntries(Object.entries({
    marka: context.brand,
    kanały: context.channels.map((channel) => SOCIAL_CHANNEL_LABELS[channel] || channel),
    wydarzenie: context.eventName,
    klient: context.clientName,
    rodzaj: context.category,
    miejsce: context.venue,
    miasto: context.city,
    miesiąc: context.month,
    realizacja: context.portfolioTitle,
    opisRealizacji: context.portfolioDescription ? context.portfolioDescription.slice(0, 1200) : null,
    obecnyOpis: context.draftCaption ? context.draftCaption.slice(0, SOCIAL_LIMITS.caption) : null,
    obecneHashtagi: context.draftHashtags?.length ? context.draftHashtags : null,
    tytułGrafiki: context.headline || null,
    podpisGrafiki: context.subline || null,
    stylMarki: context.styleNote || null,
    stałeHashtagi: context.defaultHashtags.length ? context.defaultHashtags : null,
  }).filter(([, value]) => value !== null && value !== '' && !(Array.isArray(value) && !value.length)));
}

const BASE_RULES = [
  'Jesteś copywriterem social media polskiej agencji eventowej klasy premium. Piszesz po polsku (chyba że polecenie mówi inaczej),',
  'subtelnie i z klasą: konkretnie, bez wykrzykników i bez nadmiaru emoji (najwyżej jedno, tylko gdy pasuje).',
  'Używasz wyłącznie podanych faktów i tego, co widać na zdjęciu — nie wymyślasz liczby gości, nazwisk, nagród, cen, opinii klientów',
  'ani szczegółów, których nie ma w danych. Nie podawaj nazwy klienta ani wydarzenia, jeśli nie ma ich w danych. Bez danych osobowych;',
  'osób na zdjęciu nie identyfikuj z imienia ani nazwiska. Jeśli podano styl marki — trzymaj się go.',
  `Tytuł grafiki: hasło do ${SOCIAL_LIMITS.headlineRecommended} znaków (zostanie zapisane wersalikami).`,
  `Podpis grafiki: do ${SOCIAL_LIMITS.sublineRecommended} znaków, np. „Nazwa realizacji · miejsce” (elementy rozdzielaj „ · ”).`,
  'Hashtagi: z „#”, bez spacji, w formie, w jakiej ludzie je faktycznie wyszukują; uwzględnij stałe hashtagi marki, jeśli są.',
  'Jeden opis trafia na wszystkie podane kanały — gdy jest wśród nich LinkedIn, pisz tak, żeby pasował też do profilu firmowego (rzeczowo, bez slangu).',
].join(' ');

const LENGTH_RULES: Record<SocialAiLength, string> = {
  short: 'Opis posta: 1–2 krótkie zdania (najwyżej 220 znaków).',
  medium: 'Opis posta: 2–4 zdania (najwyżej 600 znaków), opcjonalnie wezwanie do kontaktu na końcu.',
  long: 'Opis posta: 4–7 zdań w 2–3 krótkich akapitach (najwyżej 1200 znaków), z wezwaniem do kontaktu na końcu.',
};

const TONE_RULES: Record<SocialAiTone, string> = {
  elegant: 'Ton elegancki i oszczędny w słowach.',
  warm: 'Ton ciepły i osobisty, ale wciąż z klasą.',
  factual: 'Ton rzeczowy: co, gdzie, jaki zakres usług.',
  energetic: 'Ton dynamiczny i radosny, ale bez krzykliwości i bez wykrzykników.',
};

const GOAL_RULES: Record<SocialAiGoal, string> = {
  realization: 'Cel: pokazać zrealizowane wydarzenie i zakres naszej pracy.',
  backstage: 'Cel: pokazać kulisy przygotowań (montaż, próby, ekipa, technika) — od strony wykonawcy.',
  announcement: 'Cel: zapowiedź nadchodzącego wydarzenia lub nowości, zachęta do śledzenia profilu.',
  offer: 'Cel: przedstawić usługę lub ofertę (bez cen, jeśli nie podano) i zachęcić do kontaktu.',
  team: 'Cel: pokazać zespół lub sprzęt i to, co dzięki nim zyskuje klient.',
  inspiration: 'Cel: inspiracja dla osób planujących wydarzenie (pomysł, motyw, nastrój).',
};

const REWRITE_RULES: Record<SocialAiRewrite, string> = {
  shorter: 'Skróć opis o około połowę, zachowując sens i najważniejsze fakty.',
  elegant: 'Przepisz opis bardziej elegancko i oszczędnie, w stylu agencji premium.',
  cta: 'Zostaw treść, a na końcu dodaj krótkie, eleganckie zaproszenie do kontaktu (np. wiadomość prywatna lub link w profilu).',
  story: 'Przepisz opis jako krótką historię wydarzenia (początek, kulminacja, finał), bez wymyślania faktów.',
  fix: 'Popraw tylko język: pisownię, interpunkcję i płynność — bez zmiany treści i długości.',
  english: 'Przetłumacz opis na naturalny angielski w tym samym stylu; hashtagi zostaw polskie i dodaj kilka angielskich.',
};

const SUGGESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          caption: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
          headline: { type: 'string' },
          subline: { type: 'string' },
        },
        required: ['caption', 'hashtags', 'headline', 'subline'],
      },
    },
  },
  required: ['suggestions'],
};

const HASHTAG_KEYS = Object.keys(SOCIAL_AI_HASHTAG_GROUPS) as SocialAiHashtagGroupKey[];

const HASHTAG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(HASHTAG_KEYS.map((key) => [key, { type: 'array', items: { type: 'string' } }])),
  required: HASHTAG_KEYS,
};

type UserContent = Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'low' }>;

async function callOpenAI(system: string, content: UserContent, name: string, schema: object): Promise<{ parsed: any; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) fail('Asystent AI wymaga konfiguracji OPENAI_API_KEY po stronie serwera.', 503);
  const model = process.env.OPENAI_MARKETING_MODEL || 'gpt-5.4';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      text: { format: { type: 'json_schema', name, strict: true, schema } },
    }),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[social-ai]', response.status, body?.error?.message);
    fail('Asystent AI nie odpowiedział. Spróbuj ponownie za chwilę.', 502);
  }
  try {
    return { parsed: JSON.parse(extractResponseText(body)), model };
  } catch {
    fail('Asystent AI zwrócił nieczytelną odpowiedź. Spróbuj ponownie.', 502);
  }
}

function suggestionsOf(parsed: any, context: SocialAiContext, limit: number, keepGraphicText: boolean): SocialAiSuggestion[] {
  return (Array.isArray(parsed?.suggestions) ? parsed.suggestions : [])
    .slice(0, limit)
    .map((item: any) => ({
      caption: String(item?.caption || '').trim().slice(0, SOCIAL_LIMITS.caption),
      hashtags: normalizeHashtags([...(Array.isArray(item?.hashtags) ? item.hashtags : []), ...context.defaultHashtags]).slice(0, SOCIAL_LIMITS.hashtags),
      headline: keepGraphicText ? '' : String(item?.headline || '').trim().slice(0, SOCIAL_LIMITS.headline),
      subline: keepGraphicText ? '' : String(item?.subline || '').trim().slice(0, SOCIAL_LIMITS.subline),
    }))
    .filter((item: SocialAiSuggestion) => item.caption);
}

/** 3 wersje opisu z danych realizacji (pierwsza wersja asystenta — `op=suggest`, propozycje zapisane w poście). */
export async function generateSocialSuggestions(context: SocialAiContext): Promise<{ suggestions: SocialAiSuggestion[]; model: string }> {
  const system = [
    BASE_RULES,
    LENGTH_RULES.medium,
    'Hashtagi: 8–15 trafnych, po polsku i angielsku.',
    'Przygotuj 3 wyraźnie różne wersje (np. emocjonalna, rzeczowa, krótka).',
  ].join(' ');
  const { parsed, model } = await callOpenAI(system, [{ type: 'input_text', text: `Dane posta (JSON):\n${JSON.stringify(factsOf(context))}` }],
    'social_post_suggestions', SUGGESTION_SCHEMA);
  const suggestions = suggestionsOf(parsed, context, 3, false);
  if (!suggestions.length) fail('Asystent AI nie przygotował opisów.', 502);
  return { suggestions, model };
}

/** Asystent w kreatorze: opisy, poprawka opisu albo hashtagi w grupach. Wynik nie jest zapisywany w poście. */
export async function assistSocial(context: SocialAiContext, request: SocialAssistRequest): Promise<SocialAssistResult> {
  const facts = factsOf(context);
  const brief = Object.fromEntries(Object.entries({
    temat: request.topic || null,
    cel: request.goal ? SOCIAL_AI_GOALS[request.goal] : null,
    ton: request.tone ? SOCIAL_AI_TONES[request.tone] : null,
    długość: request.length ? SOCIAL_AI_LENGTHS[request.length] : null,
    poprawka: request.rewrite ? SOCIAL_AI_REWRITES[request.rewrite] : null,
    polecenie: request.instruction || null,
  }).filter(([, value]) => value));
  const content: UserContent = [
    { type: 'input_text', text: `Dane posta (JSON):\n${JSON.stringify(facts)}\n\nZlecenie (JSON):\n${JSON.stringify(brief)}` },
  ];
  if (request.photo) {
    content.push({ type: 'input_text', text: 'Zdjęcie posta (opisz tylko to, co na nim widać — wystrój, scena, światło, nastrój):' });
    content.push({ type: 'input_image', image_url: request.photo, detail: 'low' });
  }

  if (request.mode === 'hashtags') {
    const system = [
      BASE_RULES,
      'Zaproponuj hashtagi w czterech grupach: brand — marka i jej stałe hashtagi; industry — branża eventowa (np. eventy firmowe,',
      'gale, konferencje, technika sceniczna); local — miasto i region z danych (jeśli brak — ogólnopolskie); topic — temat tego posta',
      '(rodzaj wydarzenia, motyw, to co na zdjęciu). W każdej grupie 4–8 trafnych hashtagów, bez powtórzeń między grupami,',
      'unikaj hashtagów zbanowanych i zbyt ogólnych (#love, #instagood).',
    ].join(' ');
    const { parsed, model } = await callOpenAI(system, content, 'social_hashtag_groups', HASHTAG_SCHEMA);
    const seen = new Set<string>();
    const hashtagGroups = HASHTAG_KEYS.map((key) => {
      const source = key === 'brand' ? [...context.defaultHashtags, ...(Array.isArray(parsed?.[key]) ? parsed[key] : [])] : (Array.isArray(parsed?.[key]) ? parsed[key] : []);
      const tags = normalizeHashtags(source).filter((tag) => {
        const lower = tag.toLocaleLowerCase('pl');
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
      }).slice(0, 10);
      return { key, label: SOCIAL_AI_HASHTAG_GROUPS[key], tags };
    }).filter((group) => group.tags.length);
    if (!hashtagGroups.length) fail('Asystent AI nie zaproponował hashtagów.', 502);
    return { mode: 'hashtags', suggestions: [], hashtagGroups, usedPhoto: !!request.photo, model };
  }

  if (request.mode === 'rewrite') {
    if (!context.draftCaption.trim()) fail('Najpierw wpisz opis — asystent go poprawi.', 400);
    if (!request.rewrite && !request.instruction) fail('Wybierz poprawkę albo wpisz własne polecenie.', 400);
    const system = [
      BASE_RULES,
      'Zadanie: przepisz „obecnyOpis” zgodnie z poprawką lub poleceniem ze zlecenia. Zachowaj fakty z opisu i danych.',
      request.rewrite ? REWRITE_RULES[request.rewrite] : '',
      'Hashtagi: zostaw obecne (i stałe marki), chyba że polecenie dotyczy hashtagów albo języka.',
      'Tytuł i podpis grafiki zostaw puste (nie zmieniamy grafiki).',
      'Przygotuj 2 wersje różniące się sformułowaniami.',
    ].filter(Boolean).join(' ');
    const { parsed, model } = await callOpenAI(system, content, 'social_caption_rewrite', SUGGESTION_SCHEMA);
    const suggestions = suggestionsOf(parsed, { ...context, defaultHashtags: [] }, 2, true)
      .map((item) => ({ ...item, hashtags: item.hashtags.length ? item.hashtags : normalizeHashtags(context.draftHashtags || []) }));
    if (!suggestions.length) fail('Asystent AI nie przygotował poprawionego opisu.', 502);
    return { mode: 'rewrite', suggestions, hashtagGroups: [], usedPhoto: !!request.photo, model };
  }

  const system = [
    BASE_RULES,
    LENGTH_RULES[request.length || 'medium'],
    request.tone ? TONE_RULES[request.tone] : TONE_RULES.elegant,
    request.goal ? GOAL_RULES[request.goal] : '',
    'Jeśli podano temat — to on jest najważniejszy; dane realizacji tylko go uzupełniają.',
    `Hashtagi: ${SOCIAL_HASHTAGS_RECOMMENDED.min + 3}–${SOCIAL_HASHTAGS_RECOMMENDED.max} trafnych, po polsku i angielsku.`,
    'Przygotuj 3 wyraźnie różne wersje (inne otwarcie i akcent).',
  ].filter(Boolean).join(' ');
  const { parsed, model } = await callOpenAI(system, content, 'social_post_assistant', SUGGESTION_SCHEMA);
  const suggestions = suggestionsOf(parsed, context, 3, false);
  if (!suggestions.length) fail('Asystent AI nie przygotował opisów.', 502);
  return { mode: 'write', suggestions, hashtagGroups: [], usedPhoto: !!request.photo, model };
}
