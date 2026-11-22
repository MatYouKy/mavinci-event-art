import 'server-only';
import { fail } from '@/lib/social/socialCommon.server';
import {
  SHOWCASE_LIMITS, showcaseLine, showcaseText, type ShowcaseAiField, type ShowcaseAiSuggestion, type ShowcasePoint, type ShowcaseProductView,
} from './showcaseShared';

/*
 * Asystent AI treści karty prezentacji (Strefa sprzedawcy → Prezentacje): po dodaniu produktu z katalogu proponuje hasło,
 * wstęp, korzyści, kroki przygotowania, specyfikację i pytania klientów — wyłącznie z danych produktu (Oferty → Produkty)
 * i opisu od sprzedawcy. Na serwerze Next (klucz `OPENAI_API_KEY` nie trafia do aplikacji), odpowiedź w schemacie JSON.
 * Propozycje nie zapisują się same — sprzedawca wybiera, co wstawić, i zapisuje kartę.
 */

export type ShowcaseAiContext = {
  title: string;
  tagline: string;
  lead: string;
  brief: string;
  products: ShowcaseProductView[];
  fields: ShowcaseAiField[];
};

const RULES = [
  'Jesteś doświadczonym handlowcem i copywriterem polskiej agencji eventowej klasy premium (MAVINCI). Przygotowujesz treść',
  'karty prezentacji pokazywanej klientowi na tablecie podczas spotkania. Piszesz po polsku, krótko, językiem korzyści klienta,',
  'bez wykrzykników, emoji i pustych przymiotników („wyjątkowy”, „niezapomniany”). Używasz wyłącznie podanych faktów —',
  'nie wymyślasz cen, wymiarów, czasów, liczby osób, certyfikatów ani realizacji, których nie ma w danych. Gdy czegoś brakuje,',
  'piszesz ogólniej zamiast zgadywać. Bez nazw własnych klientów.',
].join(' ');

const FIELD_RULES: Record<ShowcaseAiField, string> = {
  tagline: '„tagline”: jedno zdanie pod tytułem (do 120 znaków) — najważniejsza korzyść.',
  lead: '„lead”: 1–3 zdania (do 400 znaków): co klient dostaje i dlaczego warto.',
  benefits: '„benefits”: 3–6 korzyści; „title” do 60 znaków, „text” jedno zdanie z konkretem.',
  steps: '„steps”: 3–5 kroków przygotowania po stronie agencji i obiektu (z danych przygotowania i wymagań); „title” krótko, „text” jedno zdanie.',
  specs: '„specs”: do 8 parametrów technicznych tylko z danych (np. wymiary, zasilanie, czas montażu); „title” — nazwa parametru, „text” — wartość. Bez danych — pusta lista.',
  faq: '„faq”: 4–6 pytań, które klient zadaje przed zamówieniem, z krótkimi odpowiedziami z danych; „title” — pytanie, „text” — odpowiedź.',
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

const pointsSchema = { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title', 'text'] } };

function schemaFor(fields: ShowcaseAiField[]) {
  const properties: Record<string, unknown> = {};
  for (const field of fields) properties[field] = field === 'tagline' || field === 'lead' ? { type: 'string' } : pointsSchema;
  return { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) };
}

/** Dane produktów dla asystenta (bez zdjęć i identyfikatorów). */
function productFacts(product: ShowcaseProductView) {
  const price = (value: number | null) => (value != null ? `${Math.round(value)} zł netto` : null);
  return Object.fromEntries(Object.entries({
    nazwa: product.name,
    kategoria: product.category || null,
    krótkiOpis: product.shortDescription || null,
    opis: product.description ? product.description.slice(0, 3000) : null,
    jednostka: product.unit || null,
    korzyści: product.benefits.length ? product.benefits.map((point) => [point.title, point.text].filter(Boolean).join(' — ')) : null,
    warianty: product.variants.length ? product.variants.map((variant) => ({
      nazwa: variant.name, opis: variant.shortDescription || variant.description.slice(0, 400) || null, korzyści: variant.benefits, cena: price(variant.priceNet),
    })) : null,
    pakiety: product.packages.length ? product.packages.map((pack) => ({
      nazwa: pack.name, opis: pack.description.slice(0, 400) || null, zakres: pack.scope || null, bonus: pack.bonus || null,
      cena: pack.priceOnRequest ? 'wycena indywidualna' : price(pack.priceNet),
    })) : null,
    wymaganiaObiektu: product.requirements.length ? product.requirements.map((point) => [point.title, point.text].filter(Boolean).join(' — ')) : null,
    ustaleniaZObiektem: product.preparation.length ? product.preparation.map((step) => [step.title, step.details, step.leadDays != null ? `${step.leadDays} dni wcześniej` : ''].filter(Boolean).join(' — ')) : null,
    montażGodziny: product.setupHours,
    demontażGodziny: product.teardownHours,
  }).filter(([, value]) => value !== null && value !== ''));
}

const points = (value: unknown, limit: number): ShowcasePoint[] => (Array.isArray(value) ? value : [])
  .map((item) => ({ title: showcaseLine((item as any)?.title, SHOWCASE_LIMITS.rowTitle), text: showcaseText((item as any)?.text, SHOWCASE_LIMITS.rowText) }))
  .filter((item) => item.title || item.text)
  .slice(0, limit);

/** Propozycje treści karty (wybrane pola). Błąd 503 — brak klucza, 502 — asystent nie odpowiedział. */
export async function showcaseAiSuggest(context: ShowcaseAiContext): Promise<ShowcaseAiSuggestion> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) fail('Asystent AI wymaga konfiguracji OPENAI_API_KEY po stronie serwera.', 503);
  if (!context.fields.length) fail('Wybierz, co ma przygotować asystent.', 400);
  if (!context.products.length && !context.brief.trim() && !context.title.trim()) {
    fail('Dodaj produkt z katalogu albo opisz, co pokazujesz — asystent pisze tylko z podanych danych.', 400);
  }
  const model = process.env.OPENAI_MARKETING_MODEL || 'gpt-5.4';
  const facts = {
    karta: Object.fromEntries(Object.entries({ tytuł: context.title, hasło: context.tagline, wstęp: context.lead }).filter(([, value]) => value)),
    produkty: context.products.slice(0, 6).map(productFacts),
  };
  const system = [RULES, 'Przygotuj:', ...context.fields.map((field) => FIELD_RULES[field])].join(' ');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: `Dane (JSON):\n${JSON.stringify(facts)}\n\nOpis od sprzedawcy:\n${context.brief.trim().slice(0, 2000) || '(brak — korzystaj z danych)'}` },
      ],
      text: { format: { type: 'json_schema', name: 'showcase_card', strict: true, schema: schemaFor(context.fields) } },
    }),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[showcase-ai]', response.status, body?.error?.message);
    fail('Asystent AI nie odpowiedział. Spróbuj ponownie za chwilę.', 502);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(extractResponseText(body));
  } catch {
    fail('Asystent AI zwrócił nieczytelną odpowiedź. Spróbuj ponownie.', 502);
  }
  const result: ShowcaseAiSuggestion = { model };
  if (context.fields.includes('tagline')) result.tagline = showcaseLine(parsed?.tagline, SHOWCASE_LIMITS.tagline);
  if (context.fields.includes('lead')) result.lead = showcaseText(parsed?.lead, SHOWCASE_LIMITS.lead);
  if (context.fields.includes('benefits')) result.benefits = points(parsed?.benefits, 6);
  if (context.fields.includes('steps')) result.steps = points(parsed?.steps, 6);
  if (context.fields.includes('specs')) result.specs = points(parsed?.specs, 8);
  if (context.fields.includes('faq')) result.faq = points(parsed?.faq, 6);
  return result;
}
