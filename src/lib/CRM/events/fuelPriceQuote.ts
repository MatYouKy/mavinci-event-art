import { FUEL_PRICE_SOURCE, parseFuelPrices } from './travelEstimate';
type Quote = ReturnType<typeof parseFuelPrices> & { fetchedAt: string };
let cache: { expires: number; data: Quote } | null = null;
let pending: Promise<Quote> | null = null;
export async function getFuelPriceQuote(): Promise<Quote> {
  if (cache && cache.expires > Date.now()) return cache.data;
  if (pending) return pending;
  pending = (async () => {
    const response = await fetch(FUEL_PRICE_SOURCE, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Nie udało się pobrać cen paliw. Wpisz cenę ręcznie lub spróbuj ponownie.');
    const data = { ...parseFuelPrices(await response.text()), fetchedAt: new Date().toISOString() };
    cache = { data, expires: Date.now() + 60 * 60 * 1000 };
    return data;
  })();
  try { return await pending; } finally { pending = null; }
}
