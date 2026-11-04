import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Wydarzenia sprzedane przez innych sprzedawców (migracja 20261105110000_sales_colleague_visibility):
 * sprzedawca nie czyta wiersza `events` kolegi — lista i kalendarz dostają wybrane pola z RPC
 * get_sales_colleague_events (tylko wydarzenia spoza pełnego zakresu osoby). Bez kwot, notatek i dokumentów.
 */
export type SalesColleagueEvent = {
  id: string;
  name: string;
  event_date: string | null;
  event_end_date: string | null;
  location: string | null;
  status: string | null;
  category: { id: string | null; name: string | null; color: string | null } | null;
  client_name: string | null;
  sold_by: string[];
  sales_colleague: true;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function parseSalesColleagueEvents(data: unknown): SalesColleagueEvent[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && typeof (row as any).id === 'string')
    .map(row => {
      const category = row.category && typeof row.category === 'object' ? (row.category as Record<string, unknown>) : null;
      return {
        id: String(row.id),
        name: text(row.name) ?? 'Wydarzenie',
        event_date: text(row.event_date),
        event_end_date: text(row.event_end_date),
        location: text(row.location),
        status: text(row.status),
        category: category ? { id: text(category.id), name: text(category.name), color: text(category.color) } : null,
        client_name: text(row.client_name),
        sold_by: Array.isArray(row.sold_by)
          ? row.sold_by.filter((name): name is string => typeof name === 'string' && !!name.trim())
          : [],
        sales_colleague: true as const,
      };
    });
}

/**
 * Wydarzenia innych sprzedawców w zakresie dat (null = bez ograniczenia). Brak funkcji w bazie (przed migracją)
 * albo błąd = pusta lista — widok działa bez oznaczeń.
 */
export async function fetchSalesColleagueEvents(
  client: SupabaseClient,
  from: string | null = null,
  to: string | null = null,
): Promise<SalesColleagueEvent[]> {
  const { data, error } = await client.rpc('get_sales_colleague_events', { p_from: from, p_to: to });
  if (error) {
    if (!['PGRST202', '42883'].includes(error.code ?? '')) {
      console.warn('[fetchSalesColleagueEvents]', error.message);
    }
    return [];
  }
  return parseSalesColleagueEvents(data);
}

/** „Jan Kowalski, Anna Nowak” albo null. */
export function salesColleagueSellerLabel(event: { sold_by?: string[] | null }): string | null {
  return event.sold_by?.length ? event.sold_by.join(', ') : null;
}
