import { supabase, type Employee } from './supabase';
import { isAdmin } from './permissions';
import { EVENT_ACCESS_ROLE_LABELS } from './eventAccess';

/*
 * Wydarzenia sprzedane przez innych sprzedawców (migracja 20261105110000): sprzedawca widzi je od akceptacji oferty
 * — termin, miejsce, kategoria, klient, kto sprzedał — żeby znać zajęte terminy. Wiersza `events` nie czyta
 * (RLS); listę zwraca RPC get_sales_colleague_events (tylko wydarzenia spoza pełnego zakresu osoby, z flagą
 * sales_colleague), a pojedyncze wydarzenie — get_event_access + get_event_sales_overview.
 */

export const SALES_COLLEAGUE_BADGE_LABEL = EVENT_ACCESS_ROLE_LABELS.colleague;

/** Ile dni wstecz pobieramy wydarzenia kolegów do listy i kalendarza. */
export const SALES_COLLEAGUE_LOOKBACK_DAYS = 180;

// Uprawnienia sprzedażowe z event_visible_to_sales_colleague — tylko po to, by nie wołać RPC dla osób,
// którym baza i tak zwróci pustą listę. O tym, co widać, decyduje baza.
const SALES_COLLEAGUE_PERMISSIONS = [
  'offers_view',
  'offers_create',
  'offers_manage',
  'offers_own_only',
  'inquiries_view',
  'inquiries_view_own',
  'inquiries_view_team',
  'inquiries_view_all',
  'inquiries_view_pool',
  'inquiries_manage',
  'inquiries_manage_own',
  'inquiries_manage_team',
  'inquiries_manage_all',
  'events_create',
];

type SalesEmployee = Pick<Employee, 'id' | 'role' | 'access_level' | 'permissions' | 'has_realizations'> | null | undefined;

/**
 * Czy pytać bazę o wydarzenia innych sprzedawców. Administrator i magazyn (wszystkie wydarzenia od akceptacji
 * oferty) widzą je w pełnym zakresie, więc dla nich RPC nie jest potrzebne.
 */
export function seesSalesColleagueEvents(employee: SalesEmployee): boolean {
  if (!employee || isAdmin(employee)) return false;
  const permissions = employee.permissions || [];
  if (permissions.includes('equipment_manage')) return false;
  return permissions.some((permission) => SALES_COLLEAGUE_PERMISSIONS.includes(permission));
}

/** Data początkowa okna wydarzeń kolegów (ISO). */
export function salesColleagueSince(days = SALES_COLLEAGUE_LOOKBACK_DAYS): string {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return since.toISOString();
}

export type SalesColleagueEvent = {
  id: string;
  name: string;
  event_date: string;
  event_end_date: string | null;
  location: string | null;
  status: string;
  category: { id: string | null; name: string | null; color: string | null } | null;
  client_name: string | null;
  sold_by: string[];
  sales_colleague: boolean;
};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Bezpieczne odczytanie wyniku get_sales_colleague_events. */
export function parseSalesColleagueEvents(data: unknown): SalesColleagueEvent[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item): SalesColleagueEvent[] => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const id = text(raw.id);
    const eventDate = text(raw.event_date);
    if (!id || !eventDate) return [];
    const category = raw.category && typeof raw.category === 'object' ? (raw.category as Record<string, unknown>) : null;
    return [
      {
        id,
        name: text(raw.name) || 'Wydarzenie',
        event_date: eventDate,
        event_end_date: text(raw.event_end_date),
        location: text(raw.location),
        status: (text(raw.status) || '').toLowerCase(),
        category: category ? { id: text(category.id), name: text(category.name), color: text(category.color) } : null,
        client_name: text(raw.client_name),
        sold_by: Array.isArray(raw.sold_by)
          ? raw.sold_by.filter((name): name is string => typeof name === 'string' && Boolean(name.trim()))
          : [],
        sales_colleague: raw.sales_colleague === true,
      },
    ];
  });
}

/**
 * Sprzedane wydarzenia innych sprzedawców w oknie dat. Brak funkcji (przed migracją), brak dostępu albo błąd —
 * pusta lista (listy działają jak dotąd).
 */
export async function fetchSalesColleagueEvents(
  from: string | null = salesColleagueSince(),
  to: string | null = null,
): Promise<SalesColleagueEvent[]> {
  try {
    const { data, error } = await supabase.rpc('get_sales_colleague_events', { p_from: from, p_to: to });
    if (error) {
      if (!['PGRST202', '42883', '42501'].includes(error.code ?? '')) {
        console.warn('Error fetching colleague events:', error);
      }
      return [];
    }
    return parseSalesColleagueEvents(data);
  } catch (error) {
    console.warn('Error fetching colleague events:', error);
    return [];
  }
}

/** „Sprzedał(a): Jan Kowalski, Anna Nowak” albo null. */
export function salesColleagueSoldByLabel(event: Pick<SalesColleagueEvent, 'sold_by'>): string | null {
  return event.sold_by.length ? `Sprzedał(a): ${event.sold_by.join(', ')}` : null;
}
