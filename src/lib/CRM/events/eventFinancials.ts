import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Kwoty wydarzenia (budżet, przychód, koszty, gotówka) są w tabeli `event_financials`
 * (migracja 20261105100000_event_financials.sql). Odczyt tylko z obszarem „kwoty” (RLS: can_view_event_area(..., 'values')).
 * Kolumny o tych nazwach w `events` są zawsze puste — zapis do nich nadal działa (wyzwalacz przenosi wartość).
 * Brak dostępu albo brak tabeli (przed wdrożeniem migracji) = brak wiersza, więc kwot się nie pokazuje.
 */
export const EVENT_FINANCIAL_FIELDS = [
  'budget',
  'final_cost',
  'expected_revenue',
  'actual_revenue',
  'estimated_costs',
  'actual_costs',
  'cash_budget',
  'actual_cash_revenue',
] as const;

export type EventFinancialField = (typeof EVENT_FINANCIAL_FIELDS)[number];

export type EventFinancials = {
  event_id: string;
  updated_at: string | null;
} & Record<EventFinancialField, number | null>;

const EVENT_FINANCIALS_SELECT = `event_id, ${EVENT_FINANCIAL_FIELDS.join(', ')}, updated_at`;
const CHUNK_SIZE = 100;

function toAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function normalizeEventFinancials(row: Record<string, unknown>): EventFinancials {
  const result = {
    event_id: String(row.event_id),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
  } as EventFinancials;
  for (const field of EVENT_FINANCIAL_FIELDS) result[field] = toAmount(row[field]);
  return result;
}

/** Kwoty jednego wydarzenia albo null (brak obszaru „kwoty”, brak wiersza lub tabeli). */
export async function fetchEventFinancials(
  client: SupabaseClient,
  eventId: string | null | undefined,
): Promise<EventFinancials | null> {
  if (!eventId) return null;
  const { data, error } = await client
    .from('event_financials')
    .select(EVENT_FINANCIALS_SELECT)
    .eq('event_id', eventId)
    .maybeSingle();
  if (error || !data) return null;
  return normalizeEventFinancials(data as unknown as Record<string, unknown>);
}

/** Kwoty wielu wydarzeń (mapa event_id → kwoty). Wydarzenia bez dostępu po prostu nie trafiają do mapy. */
export async function fetchEventFinancialsMap(
  client: SupabaseClient,
  eventIds: Array<string | null | undefined>,
): Promise<Map<string, EventFinancials>> {
  const ids = Array.from(new Set(eventIds.filter((id): id is string => typeof id === 'string' && id.length > 0)));
  const result = new Map<string, EventFinancials>();
  for (let offset = 0; offset < ids.length; offset += CHUNK_SIZE) {
    const { data, error } = await client
      .from('event_financials')
      .select(EVENT_FINANCIALS_SELECT)
      .in('event_id', ids.slice(offset, offset + CHUNK_SIZE));
    if (error) return result;
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const normalized = normalizeEventFinancials(row);
      result.set(normalized.event_id, normalized);
    }
  }
  return result;
}

/**
 * Kwota wydarzenia: z event_financials, a przed wdrożeniem migracji — z dotychczasowej kolumny `events`
 * (po migracji ta kolumna jest zawsze pusta, więc nie ujawnia kwot osobom bez obszaru „kwoty”).
 */
export function eventMoney(
  event: Partial<Record<EventFinancialField, unknown>> | null | undefined,
  financials: EventFinancials | null | undefined,
  field: EventFinancialField,
): number | null {
  const fromTable = financials?.[field];
  if (fromTable !== null && fromTable !== undefined) return fromTable;
  return toAmount(event?.[field]);
}

/** Rekord wydarzenia z kwotami podmienionymi na wartości z event_financials (pola bez wartości zostają bez zmian). */
export function withEventFinancials<T extends object>(event: T, financials: EventFinancials | null | undefined): T {
  if (!financials) return event;
  const next = { ...event } as Record<string, unknown>;
  for (const field of EVENT_FINANCIAL_FIELDS) {
    if (financials[field] !== null) next[field] = financials[field];
  }
  return next as T;
}
