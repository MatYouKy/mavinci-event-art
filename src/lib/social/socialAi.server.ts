import 'server-only';
import { fail } from './socialCommon.server';
import { SOCIAL_LIMITS, normalizeHashtags, type SocialChannel } from './socialShared';

/*
 * Opisy AI do postów (2–3 wersje opisu, hashtagi, tytuł i podpis grafiki) na konfiguracji OpenAI marketingu
 * (`OPENAI_API_KEY`, `OPENAI_MARKETING_MODEL`). Włącza je akceptujący w ustawieniach social media marki
 * (`social_settings.ai_captions_enabled`). Do AI trafiają tylko treści realizacji bez danych osobowych: rodzaj wydarzenia,
 * miejsce, miesiąc, opis realizacji ze strony; nazwa wydarzenia i klient — wyłącznie przy zgodzie klienta na publikację.
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
  headline: string;
  subline: string;
  styleNote: string;
  defaultHashtags: string[];
};

export type SocialAiSuggestion = { caption: string; hashtags: string[]; headline: string; subline: string };

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

export async function generateSocialSuggestions(context: SocialAiContext): Promise<{ suggestions: SocialAiSuggestion[]; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) fail('Opisy AI wymagają konfiguracji OPENAI_API_KEY po stronie serwera.', 503);
  const model = process.env.OPENAI_MARKETING_MODEL || 'gpt-5.4';
  const facts = Object.fromEntries(Object.entries({
    marka: context.brand,
    kanały: context.channels,
    wydarzenie: context.eventName,
    klient: context.clientName,
    rodzaj: context.category,
    miejsce: context.venue,
    miasto: context.city,
    miesiąc: context.month,
    realizacja: context.portfolioTitle,
    opisRealizacji: context.portfolioDescription ? context.portfolioDescription.slice(0, 1200) : null,
    obecnyOpis: context.draftCaption ? context.draftCaption.slice(0, 1200) : null,
    tytułGrafiki: context.headline || null,
    podpisGrafiki: context.subline || null,
    stałeHashtagi: context.defaultHashtags.length ? context.defaultHashtags : null,
  }).filter(([, value]) => value !== null && value !== '' && !(Array.isArray(value) && !value.length)));

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        {
          role: 'system',
          content: [
            'Jesteś copywriterem social media polskiej agencji eventowej klasy premium. Piszesz po polsku, subtelnie i z klasą:',
            'krótko, konkretnie, bez wykrzykników i bez nadmiaru emoji (najwyżej jedno, tylko gdy pasuje).',
            'Używasz wyłącznie podanych faktów — nie wymyślasz liczby gości, nazwisk, nagród ani szczegółów, których nie ma w danych.',
            'Nie podawaj nazwy klienta ani wydarzenia, jeśli nie ma ich w danych. Bez danych osobowych.',
            `Tytuł grafiki: hasło do ${SOCIAL_LIMITS.headlineRecommended} znaków (zostanie zapisane wersalikami).`,
            `Podpis grafiki: do ${SOCIAL_LIMITS.sublineRecommended} znaków, np. „Nazwa realizacji · miejsce” (elementy rozdzielaj „ · ”).`,
            'Opis posta: 2–4 krótkie zdania (najwyżej 600 znaków), opcjonalnie wezwanie do kontaktu na końcu.',
            'Hashtagi: 8–15 trafnych, po polsku i angielsku, bez spacji, z „#”; uwzględnij stałe hashtagi marki, jeśli są.',
            'Przygotuj 3 wyraźnie różne wersje (np. emocjonalna, rzeczowa, krótka).',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Dane posta (JSON):\n${JSON.stringify(facts)}`,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'social_post_suggestions',
          strict: true,
          schema: {
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
          },
        },
      },
    }),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[social-ai]', response.status, body?.error?.message);
    fail('Usługa AI nie przygotowała opisów. Spróbuj ponownie za chwilę.', 502);
  }
  const raw = extractResponseText(body);
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail('Usługa AI zwróciła nieczytelną odpowiedź.', 502);
  }
  const suggestions = (Array.isArray(parsed?.suggestions) ? parsed.suggestions : [])
    .slice(0, 3)
    .map((item: any) => ({
      caption: String(item?.caption || '').trim().slice(0, SOCIAL_LIMITS.caption),
      hashtags: normalizeHashtags([...(Array.isArray(item?.hashtags) ? item.hashtags : []), ...context.defaultHashtags]).slice(0, SOCIAL_LIMITS.hashtags),
      headline: String(item?.headline || '').trim().slice(0, SOCIAL_LIMITS.headline),
      subline: String(item?.subline || '').trim().slice(0, SOCIAL_LIMITS.subline),
    }))
    .filter((item: SocialAiSuggestion) => item.caption);
  if (!suggestions.length) fail('Usługa AI nie przygotowała opisów.', 502);
  return { suggestions, model };
}
