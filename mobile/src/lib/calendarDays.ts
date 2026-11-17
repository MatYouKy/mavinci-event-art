/**
 * Dni kalendarza zajmowane przez wydarzenie — jedna reguła dla kalendarza CRM (miesiąc, widok telefonu, lista dnia),
 * aplikacji mobilnej (kopia `mobile/src/lib/calendarDays.ts`) i aplikacji na Maca (`CalendarDates.daySpan` w
 * `desktop/mac/Sources/Mavinci/NativeCalendarView.swift`).
 *
 * Noc należy do dnia, który się w niej kończy: jeśli wydarzenie kończy się po północy najpóźniej o 5:00, ostatni dzień
 * się nie liczy. Impreza 18:00–02:00 zajmuje więc tylko dzień rozpoczęcia (w widoku miesiąca nie wygląda jak dwa
 * zarezerwowane terminy), a wydarzenie od 16.12 10:00 do 18.12 04:00 — 16 i 17 grudnia. Godziny bez zmian — reguła
 * dotyczy tylko przypisania do dni. Daty w strefie czasu urządzenia (CRM pracuje w czasie polskim).
 */

/** Najpóźniejsze zakończenie nocy (minuty od północy): 5:00. */
export const OVERNIGHT_END_LIMIT_MINUTES = 5 * 60;

export type CalendarDaySpan = { startDay: Date; totalDays: number };

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** Numer dnia kalendarzowego (niezależny od zmiany czasu letni / zimowy). */
const dayNumber = (date: Date) => Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);

/** Klucz dnia `YYYY-MM-DD` w strefie czasu urządzenia. */
export function calendarDayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Pierwszy dzień i liczba dni kalendarza zajmowanych przez wydarzenie (co najmniej 1). */
export function calendarDaySpan(start: Date | string, end?: Date | string | null): CalendarDaySpan {
  const from = toDate(start) ?? new Date(NaN);
  if (Number.isNaN(from.getTime())) return { startDay: from, totalDays: 1 };
  const startDay = startOfDay(from);
  const to = toDate(end);
  if (!to || to.getTime() <= from.getTime()) return { startDay, totalDays: 1 };
  let extraDays = dayNumber(to) - dayNumber(from);
  if (extraDays > 0 && to.getHours() * 60 + to.getMinutes() <= OVERNIGHT_END_LIMIT_MINUTES) extraDays -= 1;
  return { startDay, totalDays: Math.max(extraDays, 0) + 1 };
}

/** Który to dzień wydarzenia (1…totalDays) dla danego dnia kalendarza albo `null`, gdy wydarzenie go nie zajmuje. */
export function calendarDayIndex(day: Date, start: Date | string, end?: Date | string | null): number | null {
  const { startDay, totalDays } = calendarDaySpan(start, end);
  if (Number.isNaN(startDay.getTime())) return null;
  const diff = dayNumber(day) - dayNumber(startDay);
  return diff >= 0 && diff < totalDays ? diff + 1 : null;
}

/** Czy wydarzenie zajmuje dany dzień kalendarza. */
export function occupiesCalendarDay(day: Date, start: Date | string, end?: Date | string | null): boolean {
  return calendarDayIndex(day, start, end) !== null;
}

/** Klucze `YYYY-MM-DD` wszystkich dni zajmowanych przez wydarzenie (do znaczników w kalendarzu miesiąca; najwyżej rok). */
export function calendarDayKeys(start: Date | string, end?: Date | string | null): string[] {
  const { startDay, totalDays } = calendarDaySpan(start, end);
  if (Number.isNaN(startDay.getTime())) return [];
  return Array.from({ length: Math.min(totalDays, 366) }, (_, index) =>
    calendarDayKey(new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() + index)),
  );
}
