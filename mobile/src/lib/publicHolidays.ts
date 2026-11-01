/**
 * Dni ustawowo wolne i „nietypowe dni” — wspólna logika CRM i aplikacji mobilnej.
 * Identyczne kopie: src/lib/CRM/calendar/publicHolidays.ts ↔ mobile/src/lib/publicHolidays.ts
 * (pilnuje scripts/ci/check-shared-copies.mjs). Lista świąt pochodzi z tabeli public_holidays
 * (ustawa + cotygodniowe porównanie ze źródłem zewnętrznym); wymiar czasu pracy liczony jak
 * public.working_time_norm (art. 130 Kodeksu pracy).
 */

export interface PublicHoliday {
  date: string; // RRRR-MM-DD
  name: string;
  source?: 'statute' | 'external' | 'manual' | string;
  external_confirmed?: boolean | null;
}

export type SpecialDayKind = 'holiday' | 'sunday' | 'saturday' | 'long_weekend' | 'bridge' | 'notable';

export interface SpecialDay {
  date: string;
  kinds: SpecialDayKind[];
  holiday?: PublicHoliday;
  /** Krótka etykieta do kalendarza („Boże Ciało”, „Niedziela”, „Długi weekend”). */
  label: string;
  /** Zdanie do formularza zapytania / wydarzenia. */
  message: string;
  tone: 'danger' | 'warning' | 'info';
}

export interface WorkingTimeNorm {
  year: number;
  month: number;
  weekdays: number;
  workingDays: number;
  hoursFullTime: number;
  saturdayHolidays: number;
  holidays: PublicHoliday[];
}

type QueryClient = { from: (table: string) => any };

const pad = (value: number) => String(value).padStart(2, '0');

/** Data lokalna (bez przesunięcia strefy czasowej) jako RRRR-MM-DD. */
export function toISODate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

const parts = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { y, m, d };
};

/** 1 = poniedziałek … 7 = niedziela. */
export function isoWeekday(iso: string): number {
  const { y, m, d } = parts(iso);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parts(iso);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

const shortDate = (iso: string) => {
  const { m, d } = parts(iso);
  return `${pad(d)}.${pad(m)}`;
};

export type HolidayIndex = Map<string, PublicHoliday>;

export function indexHolidays(list: PublicHoliday[] | null | undefined): HolidayIndex {
  const map: HolidayIndex = new Map();
  (list || []).forEach((h) => map.set(h.date.slice(0, 10), h));
  return map;
}

/** Pobiera dni wolne z bazy (tabela public_holidays, odczyt dla zalogowanych). */
export async function fetchPublicHolidays(client: QueryClient, fromISO: string, toISO: string): Promise<PublicHoliday[]> {
  const { data, error } = await client
    .from('public_holidays')
    .select('holiday_date,name,source,external_confirmed')
    .eq('country', 'PL')
    .gte('holiday_date', fromISO)
    .lte('holiday_date', toISO)
    .order('holiday_date');
  if (error) throw error;
  return ((data || []) as Array<{ holiday_date: string; name: string; source: string; external_confirmed: boolean | null }>)
    .map((row) => ({ date: row.holiday_date, name: row.name, source: row.source, external_confirmed: row.external_confirmed }));
}

const isFreeDay = (iso: string, holidays: HolidayIndex) => holidays.has(iso) || isoWeekday(iso) >= 6;

/** Ciąg kolejnych dni wolnych (weekend + święta), w którym leży data. */
function freeRun(iso: string, holidays: HolidayIndex): { from: string; to: string; length: number } | null {
  if (!isFreeDay(iso, holidays)) return null;
  let from = iso;
  let to = iso;
  while (isFreeDay(addDays(from, -1), holidays)) from = addDays(from, -1);
  while (isFreeDay(addDays(to, 1), holidays)) to = addDays(to, 1);
  let length = 1;
  for (let cursor = from; cursor !== to; cursor = addDays(cursor, 1)) length += 1;
  return { from, to, length };
}

/** Informacja o dniu, który nie jest zwykłym dniem roboczym (null = zwykły dzień). */
export function specialDayInfo(dateISO: string | null | undefined, holidays: HolidayIndex): SpecialDay | null {
  if (!dateISO) return null;
  const iso = dateISO.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const weekday = isoWeekday(iso);
  const holiday = holidays.get(iso);
  const kinds: SpecialDayKind[] = [];
  const run = freeRun(iso, holidays);
  const { m, d } = parts(iso);

  if (holiday) kinds.push('holiday');
  if (weekday === 7) kinds.push('sunday');
  if (weekday === 6) kinds.push('saturday');
  if (run && run.length >= 3) kinds.push('long_weekend');
  // Dzień roboczy między świętem a weekendem (np. piątek po Bożym Ciele) — wiele osób bierze urlop.
  if (!run && weekday <= 5) {
    const prevFree = isFreeDay(addDays(iso, -1), holidays);
    const nextFree = isFreeDay(addDays(iso, 1), holidays);
    const prevHoliday = holidays.has(addDays(iso, -1));
    const nextHoliday = holidays.has(addDays(iso, 1));
    if (prevFree && nextFree && (prevHoliday || nextHoliday)) kinds.push('bridge');
  }
  const notable = m === 12 && d === 31 ? 'Sylwester' : null;
  if (notable) kinds.push('notable');
  if (kinds.length === 0) return null;

  const longWeekend = run && run.length >= 3 ? ` Długi weekend ${shortDate(run.from)}–${shortDate(run.to)} (${run.length} dni wolnych).` : '';
  if (holiday) {
    return {
      date: iso, kinds, holiday, label: holiday.name, tone: 'danger',
      message: `${shortDate(iso)} to dzień ustawowo wolny od pracy: ${holiday.name}.${longWeekend} Sprawdź dostępność ekipy, sprzętu i miejsca oraz czy klient na pewno ma na myśli tę datę.`,
    };
  }
  if (kinds.includes('bridge')) {
    return {
      date: iso, kinds, label: 'Dzień między świętem a weekendem', tone: 'warning',
      message: `${shortDate(iso)} to dzień roboczy między świętem a weekendem — wiele osób bierze urlop, a ceny i dostępność bywają jak w długi weekend.`,
    };
  }
  if (weekday === 7) {
    return {
      date: iso, kinds, label: longWeekend ? 'Niedziela, długi weekend' : 'Niedziela', tone: 'warning',
      message: `${shortDate(iso)} to niedziela.${longWeekend} Praca w niedzielę wymaga dnia wolnego w zamian lub dodatku dla pracowników.`,
    };
  }
  if (weekday === 6) {
    return {
      date: iso, kinds, label: longWeekend ? 'Sobota, długi weekend' : 'Sobota', tone: 'info',
      message: `${shortDate(iso)} to sobota.${longWeekend}`.trim(),
    };
  }
  return {
    date: iso, kinds, label: notable || 'Nietypowy dzień', tone: 'info',
    message: `${shortDate(iso)} — ${notable}. Termin o podwyższonym popycie: sprawdź wcześniej dostępność i stawki.`,
  };
}

/** Nietypowe dni w zakresie (wydarzenie wielodniowe). */
export function specialDaysInRange(fromISO: string | null | undefined, toISO: string | null | undefined, holidays: HolidayIndex, limit = 31): SpecialDay[] {
  if (!fromISO) return [];
  const start = fromISO.slice(0, 10);
  const end = (toISO || fromISO).slice(0, 10) < start ? start : (toISO || fromISO).slice(0, 10);
  const result: SpecialDay[] = [];
  let cursor = start;
  for (let i = 0; i < limit && cursor <= end; i += 1, cursor = addDays(cursor, 1)) {
    const info = specialDayInfo(cursor, holidays);
    if (info && (info.kinds.includes('holiday') || info.kinds.includes('bridge') || info.kinds.includes('sunday') || info.kinds.includes('notable')
      || (start === end && info.kinds.includes('saturday')))) result.push(info);
  }
  return result;
}

/** Wymiar czasu pracy pełnego etatu (art. 130 KP): 8 h × (pn–pt) − 8 h za każde święto poza niedzielą. */
export function workingTimeNorm(year: number, month: number, holidays: HolidayIndex): WorkingTimeNorm {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let weekdays = 0;
  let reducing = 0;
  let saturdayHolidays = 0;
  const inMonth: PublicHoliday[] = [];
  for (let d = 1; d <= days; d += 1) {
    const iso = `${year}-${pad(month)}-${pad(d)}`;
    const weekday = isoWeekday(iso);
    if (weekday <= 5) weekdays += 1;
    const holiday = holidays.get(iso);
    if (holiday) {
      inMonth.push(holiday);
      if (weekday !== 7) reducing += 1;
      if (weekday === 6) saturdayHolidays += 1;
    }
  }
  return { year, month, weekdays, workingDays: weekdays - reducing, hoursFullTime: 8 * (weekdays - reducing), saturdayHolidays, holidays: inMonth };
}

const MONTHS_GENITIVE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

/** „20 dni roboczych · 160 h na pełny etat” + uwaga o święcie w sobotę. */
export function workingTimeNormSentence(norm: WorkingTimeNorm): string {
  const base = `${norm.workingDays} dni roboczych · ${norm.hoursFullTime} h na pełny etat`;
  return norm.saturdayHolidays > 0
    ? `${base} (święto w sobotę — pracownikom należy się inny dzień wolny w okresie rozliczeniowym)`
    : base;
}

export const holidayDateLabel = (holiday: PublicHoliday) => {
  const { m, d } = parts(holiday.date);
  return `${d} ${MONTHS_GENITIVE[m - 1]}`;
};
