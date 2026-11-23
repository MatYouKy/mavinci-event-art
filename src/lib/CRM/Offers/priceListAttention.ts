import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePriceList, type PriceListSummary } from './seasonPrices';

/*
 * Oferty → Cenniki → „Do sprawdzenia” (migracja `20261129150000_price_list_attention.sql`, funkcja `price_list_attention`):
 * oferty w toku na innym cenniku niż sezon ich terminu (`different` — np. event przeniesiony na inny rok), szkice z terminem
 * bez cennika, choć sezon ma już cennik (`unlinked`), oraz lata z przyszłymi eventami marki bez aktywnego cennika.
 * Ceny ofert nie zmieniają się same (gwarancja ceny) — decyzja („Przelicz według cennika” z podglądem różnic) jest w ofercie.
 * Wspólne dla CRM i serwera Maca.
 */

export type PriceListAttentionOffer = {
  offerId: string;
  offerNumber: string;
  title: string;
  status: string;
  kind: 'different' | 'unlinked';
  date: string;
  priceList: PriceListSummary | null;
  season: PriceListSummary | null;
};

export type PriceListAttentionGap = { companyId: string; companyName: string; year: number; events: number };

export type PriceListAttention = { offers: PriceListAttentionOffer[]; missing: PriceListAttentionGap[] };

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw => (value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {});
const text = (value: unknown) => (value == null ? '' : String(value));
const list = (value: unknown) => (Array.isArray(value) ? value : []).map(record);

export function normalizePriceListAttention(value: unknown): PriceListAttention {
  const raw = record(value);
  const offers = list(raw.offers)
    .filter((row) => text(row.offer_id))
    .map((row): PriceListAttentionOffer => ({
      offerId: text(row.offer_id),
      offerNumber: text(row.offer_number),
      title: text(row.title),
      status: text(row.status),
      kind: row.kind === 'unlinked' ? 'unlinked' : 'different',
      date: text(row.date).slice(0, 10),
      priceList: normalizePriceList(row.price_list),
      season: normalizePriceList(row.season),
    }));
  const missing = list(raw.missing)
    .filter((row) => text(row.company_id))
    .map((row): PriceListAttentionGap => ({
      companyId: text(row.company_id),
      companyName: text(row.company_name) || 'Marka',
      year: Number(row.year) || 0,
      events: Number(row.events) || 0,
    }));
  return { offers, missing };
}

/** „Do sprawdzenia” z bazy; przed migracją albo przy błędzie — `null` (sekcja się nie pokazuje). */
export async function loadPriceListAttention(client: SupabaseClient): Promise<PriceListAttention | null> {
  try {
    const { data, error } = await client.rpc('price_list_attention');
    if (error) return null;
    return normalizePriceListAttention(data);
  } catch {
    return null;
  }
}

const day = (value: string) => {
  const [year, month, date] = value.split('-');
  return year && month && date ? `${date}.${month}.${year}` : value;
};

/** Nagłówek oferty na liście: numer i tytuł (bez numeru — sam tytuł). */
export function priceListAttentionOfferTitle(offer: PriceListAttentionOffer): string {
  const title = offer.title.trim() || 'Oferta bez tytułu';
  return offer.offerNumber ? `${offer.offerNumber} · ${title}` : title;
}

/** Opis oferty do sprawdzenia (CRM i Mac). */
export function priceListAttentionOfferText(offer: PriceListAttentionOffer): string {
  const date = day(offer.date);
  if (offer.kind === 'unlinked') {
    return `Szkic bez cennika — termin ${date} ma cennik „${offer.season?.name || ''}”.`;
  }
  const current = offer.priceList ? `„${offer.priceList.name}”` : '';
  return offer.season
    ? `Cennik oferty ${current}, a termin ${date} ma cennik „${offer.season.name}”.`
    : `Cennik oferty ${current}, a termin ${date} nie ma aktywnego cennika.`;
}

const eventsLabel = (count: number) => {
  if (count === 1) return '1 event';
  const last = count % 10;
  const tens = count % 100;
  return `${count} ${last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? 'eventy' : 'eventów'}`;
};

/** Opis roku bez cennika (CRM i Mac). */
export function priceListAttentionGapText(gap: PriceListAttentionGap): string {
  return `${gap.companyName} — ${gap.year}: ${eventsLabel(gap.events)} bez aktywnego cennika.`;
}

/** Krótka podpowiedź pod listą (CRM i Mac). */
export const PRICE_LIST_ATTENTION_HINT =
  'Ceny ofert nie zmieniają się same — w ofercie „Przelicz według cennika” pokaże różnice przed zmianą. Brakujący sezon: „Kopiuj na kolejny sezon…” z cennika poprzedniego roku.';
