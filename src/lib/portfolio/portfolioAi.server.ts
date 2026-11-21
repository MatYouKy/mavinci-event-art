import 'server-only';
import { fail } from '@/lib/social/socialCommon.server';
import { PORTFOLIO_ICONS, PORTFOLIO_LIMITS, type PortfolioContent } from './portfolioShared';

/*
 * Asystent AI realizacji (Marketing → Realizacje) na konfiguracji OpenAI marketingu (`OPENAI_API_KEY`,
 * `OPENAI_MARKETING_MODEL`): z krótkiego opisu i danych realizacji pisze teksty na stronę — tytuł, krótki i szczegółowy opis,
 * opis w Google, słowa kluczowe, elementy realizacji i opisy zdjęć (alt). Wynik wraca do kreatora jako propozycja (nic nie
 * jest zapisywane, dopóki pracownik jej nie użyje). Do AI trafia treść realizacji, dane wydarzenia (rodzaj, miejsce, data)
 * i — gdy zaznaczone — zdjęcia z kopii roboczej (publiczne adresy zdjęć strony, mała rozdzielczość). Bez danych osobowych.
 */

export type PortfolioAiField = 'title' | 'description' | 'detailedDescription' | 'metaDescription' | 'keywords' | 'features' | 'alts';
export const PORTFOLIO_AI_FIELDS: PortfolioAiField[] = ['title', 'description', 'detailedDescription', 'metaDescription', 'keywords', 'features', 'alts'];

export type PortfolioAiContext = {
  content: PortfolioContent;
  brief: string;
  event: { name: string; category: string | null; venue: string | null; city: string | null; date: string | null } | null;
  cityName: string | null;
  fields: PortfolioAiField[];
  /** Zdjęcia do opisu: `url` — miniatura dla AI, `src` — zdjęcie w treści realizacji. */
  photos: Array<{ index: number; url: string; src: string }>;
};

export type PortfolioAiResult = {
  title?: string;
  description?: string;
  detailedDescription?: string;
  metaDescription?: string;
  keywords?: string[];
  features?: Array<{ icon: string; title: string; description: string }>;
  alts?: Array<{ src: string; alt: string }>;
  model: string;
  usedPhotos: boolean;
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

const RULES = [
  'Jesteś copywriterem i specjalistą SEO polskiej agencji eventowej klasy premium (MAVINCI). Piszesz po polsku,',
  'konkretnie i z klasą, bez wykrzykników i emoji. Używasz wyłącznie podanych faktów i tego, co widać na zdjęciach —',
  'nie wymyślasz liczby gości, nazwisk, nagród, cen, opinii ani usług, których nie ma w danych. Osób na zdjęciach nie',
  'identyfikujesz z imienia ani nazwiska. Naturalnie wplatasz frazy z długim ogonem (rodzaj wydarzenia + miasto + usługa),',
  'bez upychania słów kluczowych.',
].join(' ');

const FIELD_RULES: Record<PortfolioAiField, string> = {
  title: 'title: tytuł realizacji do 60 znaków, rzeczowy i elegancki (np. „Jubileusz 30 lat marki w Olsztynie”).',
  description: 'description: krótki opis na kartę realizacji, 1–2 zdania (do 220 znaków): co, dla kogo, gdzie.',
  detailedDescription: 'detailedDescription: szczegółowy opis realizacji, 3–5 akapitów rozdzielonych pustą linią (około 900–1600 znaków): '
    + 'cel i charakter wydarzenia, zakres naszej pracy (scena, technika, oprawa, program), przebieg i efekt; bez nagłówków i list.',
  metaDescription: `metaDescription: opis w wynikach Google ${PORTFOLIO_LIMITS.metaMin}–${PORTFOLIO_LIMITS.metaMax} znaków z najważniejszą frazą i miastem.`,
  keywords: 'keywords: 5–8 fraz kluczowych (2–5 słów, małe litery), takich, jakie wpisuje klient szukający agencji eventowej.',
  features: `features: 3–6 elementów realizacji (krótki tytuł do 30 znaków, opis do 80 znaków) z ikoną z listy: ${PORTFOLIO_ICONS.map((icon) => icon.name).join(', ')}.`,
  alts: 'alts: opis alternatywny każdego zdjęcia (indeks z listy zdjęć) do 120 znaków: co widać, rodzaj wydarzenia i miejsce; bez „zdjęcie przedstawia”.',
};

function schemaFor(fields: PortfolioAiField[]) {
  const properties: Record<string, unknown> = {};
  if (fields.includes('title')) properties.title = { type: 'string' };
  if (fields.includes('description')) properties.description = { type: 'string' };
  if (fields.includes('detailedDescription')) properties.detailedDescription = { type: 'string' };
  if (fields.includes('metaDescription')) properties.metaDescription = { type: 'string' };
  if (fields.includes('keywords')) properties.keywords = { type: 'array', items: { type: 'string' } };
  if (fields.includes('features')) {
    properties.features = {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { icon: { type: 'string', enum: PORTFOLIO_ICONS.map((icon) => icon.name) }, title: { type: 'string' }, description: { type: 'string' } },
        required: ['icon', 'title', 'description'],
      },
    };
  }
  if (fields.includes('alts')) {
    properties.alts = {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { index: { type: 'integer' }, alt: { type: 'string' } }, required: ['index', 'alt'] },
    };
  }
  return { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) };
}

/** Propozycje tekstów realizacji (wybrane pola). */
export async function portfolioAssist(context: PortfolioAiContext): Promise<PortfolioAiResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) fail('Asystent AI wymaga konfiguracji OPENAI_API_KEY po stronie serwera.', 503);
  const fields = context.fields.filter((field) => field !== 'alts' || context.photos.length > 0);
  if (!fields.length) fail('Wybierz, co ma przygotować asystent (przy opisach zdjęć — dodaj zdjęcia).', 400);
  const model = process.env.OPENAI_MARKETING_MODEL || 'gpt-5.4';
  const { content } = context;
  const facts = Object.fromEntries(Object.entries({
    tytuł: content.title || null,
    kategoria: content.category || null,
    klient: content.client || null,
    miejsce: content.location || null,
    miasto: context.cityName,
    data: content.eventDate,
    krótkiOpis: content.description || null,
    szczegółowyOpis: content.detailedDescription ? content.detailedDescription.slice(0, 4000) : null,
    słowaKluczowe: content.keywords.length ? content.keywords : null,
    elementy: content.features.length ? content.features.map((feature) => feature.title) : null,
    wydarzenie: context.event ? {
      rodzaj: context.event.category, obiekt: context.event.venue, miasto: context.event.city, data: context.event.date,
    } : null,
  }).filter(([, value]) => value !== null && value !== ''));
  const system = [RULES, 'Przygotuj:', ...fields.map((field) => FIELD_RULES[field])].join(' ');
  const userContent: Array<Record<string, unknown>> = [{
    type: 'input_text',
    text: `Dane realizacji (JSON):\n${JSON.stringify(facts)}\n\nOpis od pracownika:\n${context.brief || '(brak — korzystaj z danych)'}`
      + (context.photos.length ? `\n\nZdjęcia (indeksy): ${context.photos.map((photo) => photo.index).join(', ')}` : ''),
  }];
  for (const photo of context.photos) {
    userContent.push({ type: 'input_text', text: `Zdjęcie ${photo.index}:` });
    userContent.push({ type: 'input_image', image_url: photo.url, detail: 'low' });
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      input: [{ role: 'system', content: system }, { role: 'user', content: userContent }],
      text: { format: { type: 'json_schema', name: 'portfolio_texts', strict: true, schema: schemaFor(fields) } },
    }),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[portfolio-ai]', response.status, body?.error?.message);
    fail('Asystent AI nie odpowiedział. Spróbuj ponownie za chwilę.', 502);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(extractResponseText(body));
  } catch {
    fail('Asystent AI zwrócił nieczytelną odpowiedź. Spróbuj ponownie.', 502);
  }
  const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);
  const result: PortfolioAiResult = { model, usedPhotos: context.photos.length > 0 };
  if (fields.includes('title')) result.title = clean(parsed.title, PORTFOLIO_LIMITS.title).replace(/\s+/g, ' ');
  if (fields.includes('description')) result.description = clean(parsed.description, PORTFOLIO_LIMITS.description);
  if (fields.includes('detailedDescription')) result.detailedDescription = clean(parsed.detailedDescription, PORTFOLIO_LIMITS.detailedDescription);
  if (fields.includes('metaDescription')) result.metaDescription = clean(parsed.metaDescription, PORTFOLIO_LIMITS.metaDescription).replace(/\s+/g, ' ');
  if (fields.includes('keywords')) {
    result.keywords = (Array.isArray(parsed.keywords) ? parsed.keywords : []).map((item: unknown) => clean(item, PORTFOLIO_LIMITS.keyword).replace(/\s+/g, ' '))
      .filter(Boolean).slice(0, PORTFOLIO_LIMITS.keywords);
  }
  if (fields.includes('features')) {
    result.features = (Array.isArray(parsed.features) ? parsed.features : []).map((item: any) => ({
      icon: PORTFOLIO_ICONS.some((icon) => icon.name === item?.icon) ? String(item.icon) : 'Star',
      title: clean(item?.title, PORTFOLIO_LIMITS.featureTitle),
      description: clean(item?.description, PORTFOLIO_LIMITS.featureDescription),
    })).filter((item: { title: string }) => item.title).slice(0, PORTFOLIO_LIMITS.features);
  }
  if (fields.includes('alts')) {
    const byIndex = new Map(context.photos.map((photo) => [photo.index, photo.src]));
    result.alts = (Array.isArray(parsed.alts) ? parsed.alts : []).flatMap((item: any) => {
      const src = byIndex.get(Number(item?.index));
      const alt = clean(item?.alt, PORTFOLIO_LIMITS.alt).replace(/\s+/g, ' ');
      return src && alt ? [{ src, alt }] : [];
    });
  }
  return result;
}
