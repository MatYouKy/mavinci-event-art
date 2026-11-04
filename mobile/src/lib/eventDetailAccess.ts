import { supabase } from './supabase';
import { EVENT_ACCESS_NONE, type EventAccess, parseEventAccess } from './eventAccess';

/*
 * Obszary danych wydarzenia w aplikacji mobilnej — te same RPC i reguły co CRM (get_event_access,
 * get_event_onsite_contacts, event_financials; migracje 20261105090000 i 20261105100000).
 * Mapowanie obszarów na zakładki jest we wspólnej kopii `eventAccess.ts`; tu są tylko odczyty z bazy
 * i decyzja, które sekcje ekranu wydarzenia pokazać. Baza i tak wymusza reguły (RLS) — interfejs nigdy
 * nie pokazuje więcej niż CRM tej samej osobie.
 */

/** Funkcja / tabela jeszcze niewdrożona (przed uruchomieniem migracji). */
export function isMissingDatabaseObject(error: { code?: string } | null | undefined): boolean {
  return ['PGRST202', '42883', 'PGRST205', '42P01'].includes(error?.code ?? '');
}

/**
 * ready  — baza zwróciła obszary,
 * legacy — RPC get_event_access nie jest wdrożone: ekran działa jak dotąd,
 * error  — chwilowy błąd odczytu: ekran ukrywa dane klienta i kwoty do czasu odświeżenia.
 */
export type EventAccessResult =
  | { mode: 'ready'; access: EventAccess }
  | { mode: 'legacy'; access: null }
  | { mode: 'error'; access: EventAccess };

export async function fetchEventAccess(eventId: string): Promise<EventAccessResult> {
  try {
    const { data, error } = await supabase.rpc('get_event_access', { p_event_id: eventId });
    if (error) {
      if (['PGRST202', '42883'].includes(error.code ?? '')) return { mode: 'legacy', access: null };
      console.warn('Error loading event access:', error);
      return { mode: 'error', access: EVENT_ACCESS_NONE };
    }
    return { mode: 'ready', access: parseEventAccess(data) };
  } catch (error) {
    console.warn('Error loading event access:', error);
    return { mode: 'error', access: EVENT_ACCESS_NONE };
  }
}

/** Które sekcje ekranu wydarzenia pokazać. */
export type EventDetailVisibility = {
  mode: EventAccessResult['mode'];
  /** Organizacja, osoba kontaktowa, e-mail i telefon klienta, połączenia z kartą klienta. */
  client: boolean;
  /** „Kontakt na miejscu” (imię, rola, telefon) — gdy nie ma pełnych danych klienta. */
  onsiteContact: boolean;
  /** Kwoty: budżet, przychód. */
  values: boolean;
  /** Sposób rozliczenia, nabywca / płatnik, kontakty rozliczeniowe, notatki handlowe. */
  billing: boolean;
  /** Oferta, umowa, formalności (linki do CRM). */
  commercialDocs: boolean;
};

/**
 * `legacyCommercials` — wynik can_view_event_commercials (dotychczasowa reguła), używany przed wdrożeniem
 * migracji obszarów i przy chwilowym błędzie odczytu obszarów.
 */
export function eventDetailVisibility(
  result: EventAccessResult | null | undefined,
  legacyCommercials: boolean,
): EventDetailVisibility {
  if (!result || result.mode === 'error') {
    return { mode: result?.mode ?? 'error', client: false, onsiteContact: false, values: false, billing: legacyCommercials, commercialDocs: false };
  }
  if (result.mode === 'legacy') {
    return { mode: 'legacy', client: true, onsiteContact: false, values: legacyCommercials, billing: legacyCommercials, commercialDocs: true };
  }
  const { areas } = result.access;
  return {
    mode: 'ready',
    client: areas.client,
    onsiteContact: areas.onsite_contact,
    values: areas.values,
    billing: areas.billing,
    commercialDocs: areas.commercial_docs,
  };
}

export type EventOnsiteContactSource = 'client' | 'event' | 'venue';

export type EventOnsiteContact = {
  source: EventOnsiteContactSource;
  name: string;
  role: string | null;
  phone: string | null;
  notes: string | null;
  is_primary: boolean;
};

const ONSITE_SOURCES: EventOnsiteContactSource[] = ['client', 'event', 'venue'];

const cleanText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Bezpieczne odczytanie wyniku get_event_onsite_contacts. */
export function parseEventOnsiteContacts(data: unknown): EventOnsiteContact[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item): EventOnsiteContact[] => {
    if (!item || typeof item !== 'object') return [];
    const raw = item as Record<string, unknown>;
    const phone = cleanText(raw.phone);
    const name = cleanText(raw.name) || (phone ? 'Osoba kontaktowa' : null);
    if (!name) return [];
    const source = ONSITE_SOURCES.includes(raw.source as EventOnsiteContactSource)
      ? (raw.source as EventOnsiteContactSource)
      : 'event';
    return [{ source, name, role: cleanText(raw.role), phone, notes: cleanText(raw.notes), is_primary: raw.is_primary === true }];
  });
}

/** Kontakt na miejscu; brak obszaru (42501), brak funkcji albo błąd = pusta lista. */
export async function fetchEventOnsiteContacts(eventId: string): Promise<EventOnsiteContact[]> {
  try {
    const { data, error } = await supabase.rpc('get_event_onsite_contacts', { p_event_id: eventId });
    if (error) {
      if (error.code !== '42501' && !isMissingDatabaseObject(error)) {
        console.warn('Error loading onsite contacts:', error);
      }
      return [];
    }
    return parseEventOnsiteContacts(data);
  } catch (error) {
    console.warn('Error loading onsite contacts:', error);
    return [];
  }
}

export type EventAmounts = { budget: number | null; expected_revenue: number | null };

const EMPTY_AMOUNTS: EventAmounts = { budget: null, expected_revenue: null };

const toAmount = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * Kwoty wydarzenia z `event_financials` (odczyt tylko z obszarem „kwoty”). Kolumny w `events` są puste po
 * migracji 20261105100000; dopóki tabeli nie ma, kwoty czytamy jeszcze z `events`.
 */
export async function fetchEventAmounts(eventId: string): Promise<EventAmounts> {
  try {
    const financials = await supabase
      .from('event_financials')
      .select('budget, expected_revenue')
      .eq('event_id', eventId)
      .maybeSingle();
    if (!financials.error) {
      return {
        budget: toAmount(financials.data?.budget),
        expected_revenue: toAmount(financials.data?.expected_revenue),
      };
    }
    if (!isMissingDatabaseObject(financials.error)) {
      console.warn('Error loading event amounts:', financials.error);
      return EMPTY_AMOUNTS;
    }
    const legacy = await supabase.from('events').select('budget, expected_revenue').eq('id', eventId).maybeSingle();
    if (legacy.error) return EMPTY_AMOUNTS;
    return {
      budget: toAmount((legacy.data as any)?.budget),
      expected_revenue: toAmount((legacy.data as any)?.expected_revenue),
    };
  } catch (error) {
    console.warn('Error loading event amounts:', error);
    return EMPTY_AMOUNTS;
  }
}
