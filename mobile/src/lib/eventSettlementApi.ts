import { supabase } from './supabase';
import { type EventSettlement, type MyCommissions, parseEventSettlement, parseMyCommissions } from './eventSettlement';

/*
 * Odczyt i zapis podsumowania wydarzenia oraz „Moje prowizje” w aplikacji — te same RPC co CRM
 * (migracja 20261105130000_event_settlement_commissions.sql): get_event_settlement, submit_event_settlement,
 * get_my_commissions. Wszystko liczy baza; tu tylko wywołanie, odczyt wyniku (wspólna kopia eventSettlement.ts)
 * i rozpoznanie sytuacji: brak funkcji przed wdrożeniem migracji, brak dostępu (42501), chwilowy błąd.
 */

/** Komunikat, gdy RPC nie jest jeszcze wdrożone (pokazywany tylko tam, gdzie osoba sama otworzyła funkcję). */
export const SETTLEMENT_DATABASE_UPDATE_MESSAGE = 'Wymaga aktualizacji bazy';

type RpcError = { code?: string; message?: string } | null | undefined;

/** Funkcja jeszcze niewdrożona (PGRST202 / 42883). */
export function isSettlementRpcMissing(error: RpcError): boolean {
  return ['PGRST202', '42883'].includes(error?.code ?? '');
}

/** Komunikat błędu po polsku: baza zwraca czytelne komunikaty, błąd sieci zamieniamy na „Brak połączenia”. */
export function settlementErrorMessage(error: unknown, fallback: string): string {
  const message =
    error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
  if (/Failed to fetch|Network request failed|fetch failed/i.test(message)) {
    return 'Brak połączenia. Spróbuj ponownie za chwilę.';
  }
  return message || fallback;
}

export type SettlementRpcResult<T> =
  | { status: 'ready'; data: T }
  /** RPC niewdrożone — funkcja ukryta (albo „Wymaga aktualizacji bazy”, gdy osoba sama ją otworzyła). */
  | { status: 'missing' }
  /** Brak dostępu (42501) — funkcja ukryta. */
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string };

/** Podsumowanie wydarzenia; wymaga obszaru „kwoty” wydarzenia (inaczej 42501). */
export async function fetchEventSettlement(eventId: string): Promise<SettlementRpcResult<EventSettlement>> {
  const fallback = 'Nie udało się pobrać podsumowania wydarzenia.';
  try {
    const { data, error } = await supabase.rpc('get_event_settlement', { p_event_id: eventId });
    if (error) {
      if (isSettlementRpcMissing(error)) return { status: 'missing' };
      if (error.code === '42501') return { status: 'denied', message: settlementErrorMessage(error, fallback) };
      console.warn('Error loading event settlement:', error);
      return { status: 'error', message: settlementErrorMessage(error, fallback) };
    }
    const parsed = parseEventSettlement(data);
    return parsed ? { status: 'ready', data: parsed } : { status: 'error', message: fallback };
  } catch (error) {
    console.warn('Error loading event settlement:', error);
    return { status: 'error', message: settlementErrorMessage(error, fallback) };
  }
}

/**
 * „Wyślij do zatwierdzenia” — z kluczem danych, które osoba widziała (`source_key`): baza odrzuca wysłanie, gdy dane
 * zmieniły się w międzyczasie. Zwraca nowe podsumowanie (wynik RPC) albo rzuca Error z komunikatem po polsku.
 */
export async function submitEventSettlement(
  eventId: string,
  note: string | null,
  expectedSourceKey: string,
): Promise<EventSettlement | null> {
  const { data, error } = await supabase.rpc('submit_event_settlement', {
    p_event_id: eventId,
    p_note: note && note.trim() ? note.trim() : null,
    p_expected_source_key: expectedSourceKey || null,
  });
  if (error) {
    if (isSettlementRpcMissing(error)) throw new Error(SETTLEMENT_DATABASE_UPDATE_MESSAGE);
    throw new Error(settlementErrorMessage(error, 'Nie udało się wysłać podsumowania. Spróbuj ponownie.'));
  }
  return parseEventSettlement(data);
}

/** Prowizje zalogowanego pracownika (konto prowizji pracownika). */
export async function fetchMyCommissions(): Promise<SettlementRpcResult<MyCommissions>> {
  const fallback = 'Nie udało się pobrać Twoich prowizji.';
  try {
    const { data, error } = await supabase.rpc('get_my_commissions');
    if (error) {
      if (isSettlementRpcMissing(error)) return { status: 'missing' };
      if (error.code === '42501') return { status: 'denied', message: settlementErrorMessage(error, fallback) };
      console.warn('Error loading my commissions:', error);
      return { status: 'error', message: settlementErrorMessage(error, fallback) };
    }
    const parsed = parseMyCommissions(data);
    return parsed ? { status: 'ready', data: parsed } : { status: 'error', message: fallback };
  } catch (error) {
    console.warn('Error loading my commissions:', error);
    return { status: 'error', message: settlementErrorMessage(error, fallback) };
  }
}
