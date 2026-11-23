// Termin zadania (`tasks.due_date`) — dzień i opcjonalna godzina w czasie polskim; wspólne dla CRM, serwera i aplikacji mobilnej.
// Identyczna kopia: mobile/src/lib/taskDue.ts (pilnuje scripts/ci/check-shared-copies.mjs). Bez importów.
//
// Bez godziny = termin na cały dzień: zapis 23:59 czasu polskiego (koniec dnia — po terminie dopiero po jego upływie; plan
// pracownika w bazie, `get_employee_schedule`, pokazuje go jako cały dzień). Północ czasu polskiego i dokładna północ UTC
// (dawny zapis samej daty — wyzwalacz bazy `task_due_date_end_of_day` zamienia ją na 23:59) też znaczą „cały dzień”.

export const TASK_DUE_END_OF_DAY = '23:59';
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTE = 60_000;
const pad = (value: number) => String(value).padStart(2, '0');
const WEEKDAYS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'so'];

/** Przesunięcie czasu polskiego względem UTC w minutach (czas letni: od ostatniej niedzieli marca do ostatniej niedzieli października, 01:00 UTC). */
export function warsawOffsetMinutes(utcMs: number): number {
  const year = new Date(utcMs).getUTCFullYear();
  const lastSunday = (month: number) => {
    const last = new Date(Date.UTC(year, month + 1, 0));
    return Date.UTC(year, month, last.getUTCDate() - last.getUTCDay(), 1);
  };
  return utcMs >= lastSunday(2) && utcMs < lastSunday(9) ? 120 : 60;
}

/** Dzisiejszy dzień w czasie polskim (`YYYY-MM-DD`). */
export const warsawToday = (now: number = Date.now()) => new Date(now + warsawOffsetMinutes(now) * MINUTE).toISOString().slice(0, 10);

/** Czy tekst to godzina `HH:MM`. */
export const isTaskDueTime = (value: unknown): value is string => typeof value === 'string' && TIME.test(value);

export type TaskDueParts = { day: string; time: string | null };

/** Zapis w bazie (znacznik czasu albo sam dzień) → dzień i godzina w czasie polskim; `time: null` — cały dzień. */
export function taskDueParts(value: string | null | undefined): TaskDueParts | null {
  if (!value) return null;
  if (DAY.test(value)) return { day: value, time: null };
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const utc = new Date(ms);
  if (utc.getUTCHours() === 0 && utc.getUTCMinutes() === 0 && utc.getUTCSeconds() === 0) return { day: utc.toISOString().slice(0, 10), time: null };
  const local = new Date(ms + warsawOffsetMinutes(ms) * MINUTE);
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  return { day: local.toISOString().slice(0, 10), time: time === TASK_DUE_END_OF_DAY || time === '00:00' ? null : time };
}

/**
 * Dzień (`YYYY-MM-DD`) i godzina (`HH:MM`; `null` / pusta — cały dzień, 23:59) w czasie polskim → znacznik ISO (UTC) do zapisu;
 * `null` — błędne dane. Godzina wypadająca dokładnie na północ UTC (01:00 zimą, 02:00 latem) dostaje 1 s, żeby baza nie wzięła
 * jej za zapis samej daty.
 */
export function taskDueIso(day: string, time?: string | null): string | null {
  const date = DAY.exec(day);
  const clock = TIME.exec(time || TASK_DUE_END_OF_DAY);
  if (!date || !clock) return null;
  const naive = Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), Number(clock[1]), Number(clock[2]));
  let utc = naive - warsawOffsetMinutes(naive - 120 * MINUTE) * MINUTE;
  utc = naive - warsawOffsetMinutes(utc) * MINUTE;
  if (utc % 86_400_000 === 0) utc += 1000;
  return new Date(utc).toISOString();
}

/**
 * Termin z formularza albo aplikacji → wartość `due_date`: `null` — bez terminu, ISO — termin, `undefined` — błędne dane.
 * `due`: `YYYY-MM-DD` (godzina w `time`), `YYYY-MM-DDTHH:MM` (czas polski) albo znacznik ISO ze strefą; `time`: `HH:MM`,
 * `null` / pusta — cały dzień.
 */
export function taskDueFromInput(due: unknown, time?: unknown): string | null | undefined {
  if (due === null || due === undefined || due === '') return null;
  const text = String(due).trim();
  if (DAY.test(text)) {
    if (time !== null && time !== undefined && time !== '' && !isTaskDueTime(time)) return undefined;
    return taskDueIso(text, typeof time === 'string' && time ? time : null) ?? undefined;
  }
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(text);
  if (local) return taskDueIso(local[1], local[2]) ?? undefined;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }
  return undefined;
}

/** Chwila terminu (ms) — termin na cały dzień: koniec dnia (23:59 czasu polskiego). */
export function taskDueMoment(value: string | null | undefined): number | null {
  const parts = taskDueParts(value);
  const iso = parts ? taskDueIso(parts.day, parts.time) : null;
  return iso ? Date.parse(iso) : null;
}

/** Czy termin minął (cały dzień — po jego końcu). */
export const taskDueOverdue = (value: string | null | undefined, now: number = Date.now()) => {
  const moment = taskDueMoment(value);
  return moment !== null && moment < now;
};

/** „pt. 14.11.2026, 18:00” albo „pt. 14.11.2026” (cały dzień); `weekday: false` — bez dnia tygodnia, `year: false` — bez roku. */
export function taskDueLabel(value: string | null | undefined, options: { weekday?: boolean; year?: boolean } = {}): string {
  const parts = taskDueParts(value);
  if (!parts) return '';
  const [year, month, day] = parts.day.split('-');
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()];
  const date = `${day}.${month}${options.year === false ? '' : `.${year}`}`;
  return `${options.weekday === false ? '' : `${weekday}. `}${date}${parts.time ? `, ${parts.time}` : ''}`;
}
