export const DEFAULT_TRAVEL_ORIGIN = 'Marcina Kasprzaka 15/66, Olsztyn, Polska';
export const FUEL_PRICE_SOURCE = 'https://www.autocentrum.pl/paliwa/ceny-paliw/';
export const FUEL_TYPES = [
  { value: 'benzyna95', label: 'Benzyna 95' },
  { value: 'benzyna98', label: 'Benzyna 98' },
  { value: 'diesel', label: 'Olej napędowy' },
  { value: 'LPG', label: 'LPG' },
] as const;
export type FuelType = (typeof FUEL_TYPES)[number]['value'];
export type FuelPrices = Partial<Record<FuelType, number>>;

export function calculateFuelCost(distance: number, consumption: number, price: number) {
  if (
    ![distance, consumption, price].every(Number.isFinite) ||
    distance < 0 ||
    consumption <= 0 ||
    price <= 0
  )
    return null;
  return Math.round((distance / 100) * consumption * price * 100) / 100;
}

export function averageFuelConsumption(
  entries: Array<{ avg_consumption: number | null; distance_since_last: number | null }>,
) {
  const valid = entries.filter(
    (entry) => Number(entry.avg_consumption) > 0 && Number(entry.distance_since_last) > 0,
  );
  const distance = valid.reduce((sum, entry) => sum + Number(entry.distance_since_last), 0);
  return distance > 0
    ? Math.round(
        (valid.reduce(
          (sum, entry) => sum + Number(entry.avg_consumption) * Number(entry.distance_since_last),
          0,
        ) /
          distance) *
          100,
      ) / 100
    : null;
}

// Read the national row by fuel-specific links, never by the order of table columns.
export function parseFuelPrices(html: string) {
  const row = html.match(
    /<tr\b[^>]*>(?:(?!<\/tr>)[\s\S])*?>Polska<(?:(?!<\/tr>)[\s\S])*?<\/tr>/i,
  )?.[0];
  const updated = html
    .match(/Ostatnia aktualizacja\s*<strong[^>]*>([^<]+)<\/strong>/i)?.[1]
    ?.trim();
  if (!row || !updated) throw new Error('Nie udało się odczytać aktualnego zestawienia cen paliw.');
  const age = updated.match(/^(\d+)\s*(h|godzin\w*|dni|dzień)\s+temu$/i);
  if (!age || Number(age[1]) * (/^(h|godzin)/i.test(age[2]) ? 1 : 24) > 72) {
    throw new Error('Zestawienie cen paliw nie ma potwierdzonej aktualności. Wpisz cenę ręcznie.');
  }
  const slugs: Record<FuelType, string> = {
    benzyna95: 'pb',
    benzyna98: 'pb-premium',
    diesel: 'on',
    LPG: 'lpg',
  };
  const prices: FuelPrices = {};
  for (const [type, slug] of Object.entries(slugs)) {
    const raw = row.match(
      new RegExp(`href="/paliwa/ceny-paliw/${slug}/"[^>]*>\\s*(\\d+[,.]\\d{2})\\s*</a>`, 'i'),
    )?.[1];
    const price = raw ? Number(raw.replace(',', '.')) : NaN;
    if (Number.isFinite(price) && price > 0 && price < 100) prices[type as FuelType] = price;
  }
  if (!Object.keys(prices).length)
    throw new Error('Brak aktualnych cen paliw. Wpisz cenę ręcznie.');
  return { prices, source: FUEL_PRICE_SOURCE, sourceUpdated: updated };
}
