import { supabase } from './supabase';

/*
 * Czas pracy zespołu w aplikacji (administrator) — to samo API co Mac (`/bridge/native/v1/time`, token sesji pracownika,
 * `x-mavinci-client: phone`): raport zespołu z aktywnymi licznikami (`op=dashboard`), strona pracownika (`op=employee`)
 * i historia zmian wpisu (`op=history`). Dostęp rozstrzyga serwer i baza (raport zespołu — tylko administrator).
 */

const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL || 'https://mavinci.pl').replace(/\/+$/, '');
const ENDPOINT = `${CRM_URL}/bridge/native/v1/time`;

/** Kadrowanie zdjęcia pracownika z serwera (`imageCrop`). */
export type TimeAvatarCrop = { x: number; y: number; scale: number; fit: string } | null;

/** Wpis czasu (`entryItem` w `src/lib/native/timeTracking.ts`). */
export type TimeEntryItem = {
  id: string; employeeId: string; employeeName: string; taskId: string | null; taskTitle: string; eventId: string | null; eventName: string;
  title: string; description: string; start: string; end: string | null; minutes: number | null; billable: boolean; rate: number | null;
  currency: string; rateBasis: string; contractId: string | null; edits: number; updatedAt: string | null;
};
export type TimeActiveItem = TimeEntryItem & { avatarUrl: string | null; avatar: TimeAvatarCrop };
export type TimePerson = {
  id: string; name: string; avatarUrl: string | null; avatar: TimeAvatarCrop; minutes: number; billableMinutes: number; revenue: number;
  entries: number; days: number; active: TimeEntryItem | null;
};
export type TimeEmployeeOption = { id: string; name: string; avatarUrl?: string | null; avatar?: TimeAvatarCrop };
export type TimeDay = { date: string; minutes: number; entries: number; employees: number };
export type TimeDashboard = {
  range: { from: string; to: string };
  employees: TimeEmployeeOption[];
  /** Wszystkie włączone liczniki (starszy serwer — brak pola; wtedy z `people`). */
  active?: TimeActiveItem[];
  people: TimePerson[];
  daily: TimeDay[];
  totals: { minutes: number; billableMinutes: number; revenue: number; employees: number };
};
export type TimeFieldChange = { field: string; label: string; before: string; after: string };
/** Zmiana wpisu (`admin_time_entries_history_view`). */
export type TimeChange = {
  id: string; entryId: string; action: string; at: string | null; actor: string; actorId: string | null; title: string; changes: TimeFieldChange[];
};
export type TimeTaskStat = { taskId: string | null; title: string; eventName: string; minutes: number; entries: number; last: string };
export type TimeEmployeePage = {
  me: { id: string; isAdmin: boolean };
  range: { from: string; to: string };
  employee: { id: string; name: string; email: string; phone: string; avatarUrl: string | null; avatar: TimeAvatarCrop };
  active: TimeEntryItem | null;
  entries: TimeEntryItem[];
  tasks: TimeTaskStat[];
  history: TimeChange[];
  totals: { minutes: number; billableMinutes: number; revenue: number; entries: number };
};

async function headers(json: boolean): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Zaloguj się ponownie.');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'x-mavinci-client': 'phone',
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error || `Operacja nie powiodła się (HTTP ${response.status}).`);
  return body as T;
}

export async function timeGet<T>(op: string, params: Record<string, string | null | undefined> = {}): Promise<T> {
  const query = Object.entries({ op, ...params })
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}?${query}`, { headers: await headers(false) });
  } catch {
    throw new Error('Brak połączenia. Spróbuj ponownie za chwilę.');
  }
  return parse<T>(response);
}

export async function timePost<T>(op: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, { method: 'POST', headers: await headers(true), body: JSON.stringify({ ...body, op }) });
  } catch {
    throw new Error('Brak połączenia. Spróbuj ponownie za chwilę.');
  }
  return parse<T>(response);
}

// MARK: Okres raportu — jak „Okres” na Macu (tydzień / miesiąc / rok z przesuwaniem), w aplikacji także dzień

export type TimePeriodKind = 'day' | 'week' | 'month' | 'year';
export const TIME_PERIOD_KINDS: { key: TimePeriodKind; label: string }[] = [
  { key: 'day', label: 'Dzień' }, { key: 'week', label: 'Tydzień' }, { key: 'month', label: 'Miesiąc' }, { key: 'year', label: 'Rok' },
];
export type TimePeriod = { kind: TimePeriodKind; offset: number };

const pad = (value: number) => String(value).padStart(2, '0');
/** `RRRR-MM-DD` dnia w czasie urządzenia. */
export const dayString = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** Południe dnia `RRRR-MM-DD` (bez przesunięć przy zmianie czasu). */
export const dayDate = (day: string) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 12);

/** Zakres okresu (`RRRR-MM-DD`), `offset` — przesunięcie od bieżącego. */
export function timePeriodRange({ kind, offset }: TimePeriod): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  if (kind === 'day') {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, 12);
    return { from: dayString(day), to: dayString(day) };
  }
  if (kind === 'week') {
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7) + offset * 7, 12);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 12);
    return { from: dayString(monday), to: dayString(sunday) };
  }
  if (kind === 'year') {
    const year = today.getFullYear() + offset;
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1, 12);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12);
  return { from: dayString(first), to: dayString(last) };
}

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase('pl-PL') + text.slice(1);

/** Etykieta okresu: „Dziś”, „sobota, 21 listopada 2026”, „17 lis – 23 lis 2026”, „Listopad 2026”, „2026”. */
export function timePeriodLabel(period: TimePeriod): string {
  const { from, to } = timePeriodRange(period);
  const start = dayDate(from);
  if (period.kind === 'day') {
    if (period.offset === 0) return 'Dziś';
    if (period.offset === -1) return 'Wczoraj';
    return start.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  if (period.kind === 'week') {
    const end = dayDate(to);
    const short = (date: Date) => date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
    return `${short(start)} – ${short(end)} ${end.getFullYear()}`;
  }
  if (period.kind === 'year') return String(start.getFullYear());
  return capitalize(start.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }));
}

// MARK: Formatowanie — jak `WorkTimeFormat` na Macu

/** „2h 5m” (minuty zaokrąglone). */
export const formatWorkMinutes = (value: number | null | undefined) => {
  const total = Math.max(0, Math.round(value ?? 0));
  return `${Math.floor(total / 60)}h ${total % 60}m`;
};
/** Licznik „GG:MM:SS” od początku wpisu. */
export const workClock = (start: string, now: number) => {
  const seconds = Math.max(0, Math.floor((now - new Date(start).getTime()) / 1000));
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
};
export const workTime = (iso: string) => new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
export const workDateTime = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
/** Godziny wpisu: „08:00 – 12:30” albo „08:00 – w trakcie”. */
export const workSpan = (entry: TimeEntryItem) => `${workTime(entry.start)} – ${entry.end ? workTime(entry.end) : 'w trakcie'}`;
export const workMoney = (value: number, currency = 'PLN') =>
  `${value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'PLN' ? 'zł' : currency}`;
/** „45 PLN/h netto” (stawka z warunków umowy). */
export const workRate = (entry: TimeEntryItem) => (entry.rate === null
  ? null
  : `${entry.rate.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} ${entry.currency}/h${entry.rateBasis ? ` ${entry.rateBasis}` : ''}`);
/** Nazwa wpisu: zadanie, tytuł albo „Praca”. */
export const workLabel = (entry: TimeEntryItem) => entry.taskTitle || entry.title || 'Praca';
/** Dzień rozpoczęcia wpisu (`RRRR-MM-DD`, czas urządzenia — w Polsce jak na serwerze). */
export const workDay = (entry: TimeEntryItem) => dayString(new Date(entry.start));

/** Zmiana wpisu: etykieta akcji i kolor (jak na Macu). */
export const TIME_CHANGE_ACTIONS: Record<string, { label: string; color: string }> = {
  created: { label: 'Utworzono', color: '#4ade80' },
  updated: { label: 'Edytowano', color: '#60a5fa' },
  deleted: { label: 'Usunięto', color: '#f87171' },
};
export const changeActor = (change: TimeChange) => change.actor || 'Autor niedostępny (starszy wpis lub system)';

/** Kadrowanie z serwera → `avatarMetadata` komponentu `EmployeeAvatar`. */
export const avatarMetadata = (crop: TimeAvatarCrop | undefined) => (crop
  ? { desktop: { position: { posX: crop.x, posY: crop.y, scale: crop.scale }, objectFit: crop.fit } }
  : null);

/** Liczebnik: „1 wpis”, „3 wpisy”, „5 wpisów”. */
export const plural = (count: number, one: string, few: string, many: string) => {
  const tens = count % 100;
  const units = count % 10;
  const word = count === 1 ? one : units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many;
  return `${count} ${word}`;
};
