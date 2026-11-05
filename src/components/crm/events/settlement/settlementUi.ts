/**
 * Wspólne drobiazgi interfejsu podsumowania wydarzenia i prowizji (CRM).
 * Niczego nie liczy — tylko odczyt błędów bazy, formatowanie dat i wpisywanych kwot.
 */

/** Funkcja jeszcze nie istnieje w bazie (migracja 20261105130000 niewdrożona). */
const MISSING_RPC_CODES = new Set(['PGRST202', '42883']);

export const SETTLEMENT_MIGRATION_NOTICE = 'Podsumowanie wydarzenia wymaga aktualizacji bazy danych.';

type DbError = { code?: string | null; message?: string | null } | null | undefined;

export function isMissingRpc(error: DbError): boolean {
  return MISSING_RPC_CODES.has(error?.code ?? '');
}

/** Komunikat błędu z bazy (RAISE EXCEPTION ma już polskie, zrozumiałe treści). */
export function settlementErrorMessage(error: DbError, fallback = 'Nie udało się zapisać zmian. Odśwież podsumowanie.'): string {
  if (!error) return fallback;
  if (isMissingRpc(error)) return SETTLEMENT_MIGRATION_NOTICE;
  const message = typeof error.message === 'string' ? error.message.trim() : '';
  if (error.code === '42501') return message || 'Brak uprawnień do tej operacji.';
  return message || fallback;
}

export const settlementInputClass =
  'block w-full rounded-lg bg-black/25 px-3 py-2 text-sm text-[#e5e4e2] outline-none placeholder:text-white/30 focus:bg-black/35 focus:ring-1 focus:ring-[#d3bb73]/40 disabled:opacity-60';

export const primaryButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#210811] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50';

export const accentButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#d3bb73]/15 px-3 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/25 disabled:cursor-not-allowed disabled:opacity-50';

export const secondaryButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50';

export const smallButtonClass =
  'inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-[#e5e4e2]/80 transition-colors hover:bg-white/10 hover:text-[#e5e4e2] disabled:cursor-not-allowed disabled:opacity-45';

export const dangerButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50';

/** „5 lis 2026” albo „5 lis 2026, 14:30”. Data bez godziny (RRRR-MM-DD) bez przesunięcia strefy. */
export function formatSettlementDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return withTime
    ? date.toLocaleString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Odczyt wpisanej kwoty netto/brutto („1234,56” albo „1234.56”) z dokładnością do grosza.
 * Kwoty w podsumowaniu nie mogą być ujemne (pilnuje też baza); null, gdy wpis jest niepoprawny.
 */
export function parseMoneyInput(value: string): number | null {
  const text = value.replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

/** Wartość pola liczbowego (input type=number, min=0): „1234.56”. */
export function moneyInputValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return Math.max(0, value).toFixed(2);
}

/** Odczyt wpisanego procentu 0–100 z dokładnością do 0,01; null, gdy wpis jest niepoprawny. */
export function parsePercentInput(value: string): number | null {
  const text = value.replace(/[\s %]/g, '').replace(',', '.');
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return Math.round(parsed * 100) / 100;
}
