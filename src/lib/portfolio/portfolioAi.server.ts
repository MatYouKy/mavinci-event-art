import 'server-only';
import { fail } from '@/lib/social/socialCommon.server';
import { PORTFOLIO_ICONS, PORTFOLIO_LIMITS, portfolioSlug, type PortfolioContent } from './portfolioShared';

/*
 * Asystent AI realizacji (Marketing → Realizacje) na konfiguracji OpenAI marketingu (`OPENAI_API_KEY`,
 * `OPENAI_MARKETING_MODEL`): z krótkiego opisu i danych realizacji pisze teksty na stronę — tytuł (także kilka propozycji do
 * wyboru), krótki i szczegółowy opis, opis w Google, słowa kluczowe, tagi, miasto realizacji i priorytetowe miasta (tylko z listy
 * miast strony), elementy realizacji i opisy zdjęć (alt). Wynik wraca do kreatora jako propozycja (nic nie jest zapisywane,
 * dopóki pracownik jej nie użyje). Do AI trafia treść realizacji, dane wydarzenia (rodzaj, miejsce, data) i — gdy zaznaczone —
 * zdjęcia z kopii roboczej (publiczne adresy zdjęć strony, mała rozdzielczość). Bez danych osobowych.
 */

export type PortfolioAiField = 'title' | 'titles' | 'description' | 'detailedDescription' | 'metaDescription' | 'keywords' | 'tags' | 'city'
  | 'referenceCities' | 'features' | 'alts';
export const PORTFOLIO_AI_FIELDS: PortfolioAiField[] = [
  'title', 'titles', 'description', 'detailedDescription', 'metaDescription', 'keywords', 'tags', 'city', 'referenceCities', 'features', 'alts',
];

export type PortfolioAiContext = {
  content: PortfolioContent;
  brief: string;
  event: { name: string; category: string | null; venue: string | null; city: string | null; date: string | null } | null;
  cityName: string | null;
  fields: PortfolioAiField[];
  /** Zdjęcia: `url` — miniatura dla AI, `src` — zdjęcie w treści realizacji, `alt` — do tego zdjęcia AI pisze opis. */
  photos: Array<{ index: number; url: string; src: string; alt: boolean }>;
  /** Miasta stron usług (identyfikator i nazwa) — miasto realizacji i priorytetowe miasta tylko z tej listy. */
  cities: Array<{ locality: string; name: string }>;
  /** Tagi używane w innych realizacjach (spójne nazewnictwo). */
  tagVocabulary: string[];
};

export type PortfolioAiResult = {
  title?: string;
  titles?: string[];
  description?: string;
  detailedDescription?: string;
  metaDescription?: string;
  keywords?: string[];
  tags?: string[];
  eventCitySlug?: string | null;
  referenceCitySlugs?: string[];
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
  'identyfikujesz z imienia ani nazwiska. Pozycjonowanie: fraza główna to rodzaj wydarzenia z motywem i miastem (np.',
  '„urodziny w stylu Gatsby Olsztyn”), frazy uzupełniające — usługi z realizacji (oprawa muzyczna, scena, oświetlenie,',
  'nagłośnienie, dekoracje, atrakcje) z miastem lub regionem. Wplatasz je naturalnie, bez upychania słów kluczowych.',
  'Gdy pole ma już treść, traktujesz ją jako źródło faktów i proponujesz lepszą wersję (te same fakty, lepszy język i SEO).',
].join(' ');

const FIELD_RULES: Record<PortfolioAiField, string> = {
  title: 'title: tytuł realizacji do 60 znaków, rzeczowy i elegancki (np. „Jubileusz 30 lat marki w Olsztynie”).',
  titles: 'titles: 4 różne propozycje tytułu realizacji (każda do 60 znaków, bez cudzysłowów i kropki na końcu): rodzaj wydarzenia '
    + 'z motywem przewodnim, z miastem albo obiektem, gdy są znane (np. „Urodziny w stylu Wielkiego Gatsby’ego w Olsztynie”); '
    + 'różne ujęcia — rzeczowe, z motywem, z miastem, krótkie; bez nazwy klienta, gdy nie jest podana.',
  description: 'description: krótki opis na kartę realizacji, 1–2 zdania (do 220 znaków): co, dla kogo, gdzie.',
  detailedDescription: 'detailedDescription: szczegółowy opis realizacji, 3–5 akapitów rozdzielonych pustą linią (około 900–1600 znaków): '
    + 'cel i charakter wydarzenia, zakres naszej pracy (scena, technika, oprawa, program), przebieg i efekt; bez nagłówków i list.',
  metaDescription: `metaDescription: opis w wynikach Google ${PORTFOLIO_LIMITS.metaMin}–${PORTFOLIO_LIMITS.metaMax} znaków z najważniejszą frazą i miastem.`,
  keywords: 'keywords: 5–8 fraz kluczowych (2–5 słów, małe litery), takich, jakie wpisuje klient szukający agencji eventowej: '
    + 'rodzaj wydarzenia + miasto, rodzaj wydarzenia + motyw, usługa + miasto (bez samych ogólników typu „event”).',
  tags: 'tags: 1–4 tagi kategorii (małe litery, słowa rozdzielone myślnikiem). Wybieraj z tagów innych realizacji (lista w danych); '
    + 'nowy tag tylko wtedy, gdy żaden nie pasuje. „konferencje” — tylko dla konferencji, kongresów, szkoleń i spotkań biznesowych.',
  city: 'eventCitySlug: identyfikator miasta realizacji z listy miast (gdzie odbyło się wydarzenie — z miejsca, obiektu, wydarzenia '
    + 'albo opisu); pusty tekst, gdy miasta nie da się ustalić albo nie ma go na liście.',
  referenceCities: 'referenceCitySlugs: 2–6 identyfikatorów z listy miast, na których stronach usług warto pokazać tę realizację wyżej: '
    + 'miasto realizacji i duże miasta w promieniu około 150 km (ten sam region); pusta lista, gdy miasta realizacji nie da się ustalić.',
  features: `features: 3–6 elementów realizacji (krótki tytuł do 30 znaków, opis do 80 znaków) z ikoną z listy: ${PORTFOLIO_ICONS.map((icon) => icon.name).join(', ')}.`,
  alts: 'alts: opis alternatywny każdego zdjęcia z listy „do opisu” (indeks zdjęcia) do 120 znaków: co widać, rodzaj wydarzenia i miejsce; '
    + 'każdy opis inny, bez „zdjęcie przedstawia”.',
};

function schemaFor(fields: PortfolioAiField[], cities: string[]) {
  const properties: Record<string, unknown> = {};
  if (fields.includes('title')) properties.title = { type: 'string' };
  if (fields.includes('titles')) properties.titles = { type: 'array', items: { type: 'string' } };
  if (fields.includes('description')) properties.description = { type: 'string' };
  if (fields.includes('detailedDescription')) properties.detailedDescription = { type: 'string' };
  if (fields.includes('metaDescription')) properties.metaDescription = { type: 'string' };
  if (fields.includes('keywords')) properties.keywords = { type: 'array', items: { type: 'string' } };
  if (fields.includes('tags')) properties.tags = { type: 'array', items: { type: 'string' } };
  if (fields.includes('city')) properties.eventCitySlug = { type: 'string', enum: ['', ...cities] };
  if (fields.includes('referenceCities')) properties.referenceCitySlugs = { type: 'array', items: { type: 'string', enum: cities } };
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
  const altPhotos = context.photos.filter((photo) => photo.alt);
  const cityIds = context.cities.map((city) => city.locality);
  const fields = context.fields.filter((field) => (field !== 'alts' || altPhotos.length > 0)
    && ((field !== 'city' && field !== 'referenceCities') || cityIds.length > 0));
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
    tagi: content.tags.length ? content.tags : null,
    wydarzenie: context.event ? {
      rodzaj: context.event.category, obiekt: context.event.venue, miasto: context.event.city, data: context.event.date,
    } : null,
  }).filter(([, value]) => value !== null && value !== ''));
  const system = [RULES, 'Przygotuj:', ...fields.map((field) => FIELD_RULES[field])].join(' ');
  const lists: string[] = [];
  if (fields.includes('city') || fields.includes('referenceCities')) {
    lists.push(`Miasta stron usług (identyfikator: nazwa):\n${context.cities.map((city) => `${city.locality}: ${city.name}`).join('\n')}`);
  }
  if (fields.includes('tags')) lists.push(`Tagi innych realizacji: ${context.tagVocabulary.length ? context.tagVocabulary.join(', ') : '(brak)'}`);
  const userContent: Array<Record<string, unknown>> = [{
    type: 'input_text',
    text: `Dane realizacji (JSON):\n${JSON.stringify(facts)}\n\nOpis od pracownika:\n${context.brief || '(brak — korzystaj z danych)'}`
      + (lists.length ? `\n\n${lists.join('\n\n')}` : '')
      + (context.photos.length ? `\n\nZdjęcia (indeksy): ${context.photos.map((photo) => photo.index).join(', ')}` : '')
      + (fields.includes('alts') ? `\nZdjęcia do opisu (alt): ${altPhotos.map((photo) => photo.index).join(', ')}` : ''),
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
      text: { format: { type: 'json_schema', name: 'portfolio_texts', strict: true, schema: schemaFor(fields, cityIds) } },
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
  const unique = (items: string[]) => items.filter((item, index) => item && items.findIndex((other) => other.toLocaleLowerCase('pl-PL') === item.toLocaleLowerCase('pl-PL')) === index);
  if (fields.includes('title')) result.title = clean(parsed.title, PORTFOLIO_LIMITS.title).replace(/\s+/g, ' ');
  if (fields.includes('titles')) {
    // Bez cudzysłowów i kropki na końcu (kropka po liczbie zostaje — „lat 20.”).
    const bare = (value: string) => {
      let next = value.replace(/\s+/g, ' ').trim();
      for (let step = 0; step < 3; step += 1) next = next.replace(/^["„”'«»]+|["„”'«»]+$/g, '').replace(/(?<!\d)\.$/, '').trim();
      return next;
    };
    result.titles = unique((Array.isArray(parsed.titles) ? parsed.titles : []).map((item: unknown) => bare(clean(item, PORTFOLIO_LIMITS.title)))).slice(0, 5);
  }
  if (fields.includes('description')) result.description = clean(parsed.description, PORTFOLIO_LIMITS.description);
  if (fields.includes('detailedDescription')) result.detailedDescription = clean(parsed.detailedDescription, PORTFOLIO_LIMITS.detailedDescription);
  if (fields.includes('metaDescription')) result.metaDescription = clean(parsed.metaDescription, PORTFOLIO_LIMITS.metaDescription).replace(/\s+/g, ' ');
  if (fields.includes('keywords')) {
    result.keywords = (Array.isArray(parsed.keywords) ? parsed.keywords : []).map((item: unknown) => clean(item, PORTFOLIO_LIMITS.keyword).replace(/\s+/g, ' '))
      .filter(Boolean).slice(0, PORTFOLIO_LIMITS.keywords);
  }
  if (fields.includes('tags')) {
    result.tags = unique((Array.isArray(parsed.tags) ? parsed.tags : []).map((item: unknown) => portfolioSlug(clean(item, PORTFOLIO_LIMITS.tag * 2)).slice(0, PORTFOLIO_LIMITS.tag)))
      .slice(0, 4);
  }
  if (fields.includes('city')) result.eventCitySlug = cityIds.includes(String(parsed.eventCitySlug)) ? String(parsed.eventCitySlug) : null;
  if (fields.includes('referenceCities')) {
    result.referenceCitySlugs = unique((Array.isArray(parsed.referenceCitySlugs) ? parsed.referenceCitySlugs : []).map(String))
      .filter((item) => cityIds.includes(item)).slice(0, 8);
  }
  if (fields.includes('features')) {
    result.features = (Array.isArray(parsed.features) ? parsed.features : []).map((item: any) => ({
      icon: PORTFOLIO_ICONS.some((icon) => icon.name === item?.icon) ? String(item.icon) : 'Star',
      title: clean(item?.title, PORTFOLIO_LIMITS.featureTitle),
      description: clean(item?.description, PORTFOLIO_LIMITS.featureDescription),
    })).filter((item: { title: string }) => item.title).slice(0, PORTFOLIO_LIMITS.features);
  }
  if (fields.includes('alts')) {
    const byIndex = new Map(altPhotos.map((photo) => [photo.index, photo.src]));
    result.alts = (Array.isArray(parsed.alts) ? parsed.alts : []).flatMap((item: any) => {
      const src = byIndex.get(Number(item?.index));
      const alt = clean(item?.alt, PORTFOLIO_LIMITS.alt).replace(/\s+/g, ' ');
      return src && alt ? [{ src, alt }] : [];
    });
  }
  return result;
}
