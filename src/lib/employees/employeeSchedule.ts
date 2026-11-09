/**
 * Plan pracowników (RPC get_employee_schedule, migracja 20261109140000_employee_schedule.sql): typy, odczyt,
 * etykiety i obliczenia układu dla osi czasu zespołu i widoku dnia / tygodnia w profilu pracownika.
 * Kto co widzi, liczy baza (swój plan; administrator i employees_manage — każdy).
 */
import { supabase } from '@/lib/supabase/browser';

export type ScheduleKind = 'event' | 'phase' | 'meeting' | 'inquiry' | 'task' | 'call' | 'absence';

export type ScheduleItem = {
  employee_id: string;
  kind: ScheduleKind;
  item_id: string;
  title: string;
  subtitle: string | null;
  start: number;
  end: number;
  all_day: boolean;
  status: string | null;
  color: string;
  url: string | null;
};

export const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
  event: 'Wydarzenie',
  phase: 'Faza wydarzenia',
  meeting: 'Spotkanie',
  inquiry: 'Kontakt w zapytaniu',
  task: 'Zadanie',
  call: 'Oddzwonienie',
  absence: 'Nieobecność',
};

/** Grupy w filtrach widoku (lejek = zapytania, zadania i oddzwonienia). */
export type ScheduleGroup = 'events' | 'meetings' | 'funnel' | 'absences';
export const SCHEDULE_GROUPS: { id: ScheduleGroup; label: string; kinds: ScheduleKind[]; color: string }[] = [
  { id: 'events', label: 'Wydarzenia i fazy', kinds: ['event', 'phase'], color: '#3b82f6' },
  { id: 'meetings', label: 'Spotkania', kinds: ['meeting'], color: '#0ea5e9' },
  { id: 'funnel', label: 'Lejek i zadania', kinds: ['inquiry', 'task', 'call'], color: '#f59e0b' },
  { id: 'absences', label: 'Nieobecności', kinds: ['absence'], color: '#10b981' },
];

export const STATUS_LABELS: Record<string, string> = {
  pending: 'czeka na potwierdzenie',
  accepted: 'potwierdzone',
  approved: 'zatwierdzona',
  todo: 'do zrobienia',
  in_progress: 'w toku',
  review: 'do sprawdzenia',
  new: 'nowe',
  contacted: 'po kontakcie',
  qualified: 'zakwalifikowane',
  proposal: 'oferta',
};

const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const KINDS = new Set<ScheduleKind>(['event', 'phase', 'meeting', 'inquiry', 'task', 'call', 'absence']);

function parseRows(data: unknown): ScheduleItem[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row: any) => {
    const kind = String(row?.kind ?? '') as ScheduleKind;
    const start = Date.parse(row?.starts_at);
    const end = Date.parse(row?.ends_at);
    if (!KINDS.has(kind) || !Number.isFinite(start) || !Number.isFinite(end) || !row?.employee_id) return [];
    return [{
      employee_id: String(row.employee_id),
      kind,
      item_id: String(row.item_id ?? ''),
      title: typeof row.title === 'string' && row.title.trim() ? row.title : SCHEDULE_KIND_LABELS[kind],
      subtitle: typeof row.subtitle === 'string' && row.subtitle.trim() ? row.subtitle : null,
      start,
      end: Math.max(end, start + 15 * MINUTE),
      all_day: row.all_day === true,
      status: typeof row.status === 'string' ? row.status : null,
      color: typeof row.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(row.color) ? row.color : '#64748b',
      url: typeof row.url === 'string' && row.url.startsWith('/') ? row.url : null,
    }];
  });
}

/** Dawna oś czasu (przed migracją): wydarzenia, fazy i nieobecności z get_employee_timeline_data. */
function parseLegacyRows(data: unknown): ScheduleItem[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row: any) => {
    const kind: ScheduleKind | null = row?.item_type === 'event' ? 'event' : row?.item_type === 'phase' ? 'phase' : row?.item_type === 'absence' ? 'absence' : null;
    const start = Date.parse(row?.item_start);
    const end = Date.parse(row?.item_end);
    if (!kind || !Number.isFinite(start) || !Number.isFinite(end)) return [];
    const eventId = kind === 'event' ? row.item_id : row?.item_metadata?.event_id;
    return [{
      employee_id: String(row.employee_id),
      kind,
      item_id: String(row.item_id ?? ''),
      title: String(row.item_title || SCHEDULE_KIND_LABELS[kind]),
      subtitle: row?.item_metadata?.location || null,
      start,
      end: Math.max(end, start + 15 * MINUTE),
      all_day: kind !== 'phase',
      status: row.item_status ?? null,
      color: typeof row.item_color === 'string' ? row.item_color : '#64748b',
      url: eventId ? `/crm/events/${eventId}` : null,
    }];
  });
}

export type ScheduleResult = { items: ScheduleItem[]; legacy: boolean };

export async function fetchEmployeeSchedule(employeeIds: string[], from: Date, to: Date): Promise<ScheduleResult> {
  if (!employeeIds.length) return { items: [], legacy: false };
  const { data, error } = await supabase.rpc('get_employee_schedule', {
    p_employee_ids: employeeIds,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (!error) return { items: parseRows(data), legacy: false };
  if (error.code !== 'PGRST202' && error.code !== '42883') throw new Error(error.message || 'Nie udało się wczytać planu.');
  const legacy = await supabase.rpc('get_employee_timeline_data', {
    p_employee_ids: employeeIds,
    p_start_date: from.toISOString(),
    p_end_date: to.toISOString(),
  });
  if (legacy.error) throw new Error(legacy.error.message || 'Nie udało się wczytać planu.');
  return { items: parseLegacyRows(legacy.data), legacy: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Daty (czas lokalny przeglądarki)
// ---------------------------------------------------------------------------------------------------------------
export const startOfDay = (value: Date | number) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};
export const addDays = (value: Date | number, days: number) => {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
};
/** Poniedziałek tygodnia. */
export const startOfWeek = (value: Date | number) => {
  const date = startOfDay(value);
  const shift = (date.getDay() + 6) % 7;
  return addDays(date, -shift);
};
export const startOfMonth = (value: Date | number) => {
  const date = startOfDay(value);
  date.setDate(1);
  return date;
};
export const isSameDay = (a: Date | number, b: Date | number) => startOfDay(a).getTime() === startOfDay(b).getTime();

/** Data w adresie (?date=2026-11-09) — dzień lokalny. */
export const toDateParam = (value: Date | number) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
export const parseDateParam = (value: string | null | undefined): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Wielka litera tylko na początku (polskie nazwy dni i miesięcy). */
export const capitalizeFirst = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

export const formatTime = (value: number | Date) =>
  new Date(value).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

export function formatItemTime(item: ScheduleItem): string {
  if (item.all_day) {
    const lastDay = new Date(item.end - 1);
    return isSameDay(item.start, lastDay)
      ? 'cały dzień'
      : `${new Date(item.start).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })} – ${lastDay.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}`;
  }
  const sameDay = isSameDay(item.start, item.end - 1);
  return sameDay
    ? `${formatTime(item.start)}–${formatTime(item.end)}`
    : `${new Date(item.start).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} – ${new Date(item.end).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

export function itemTooltip(item: ScheduleItem): string {
  return [
    `${SCHEDULE_KIND_LABELS[item.kind]}: ${item.title}`,
    formatItemTime(item),
    item.subtitle,
    item.status && STATUS_LABELS[item.status] ? `Status: ${STATUS_LABELS[item.status]}` : null,
  ].filter(Boolean).join('\n');
}

/** Tło pozycji: przyciemniony kolor; oczekujące — w paski (bez obramowań). */
export function itemBackground(item: ScheduleItem, alpha = '40'): string {
  const base = `${item.color}${alpha}`;
  return item.status === 'pending'
    ? `repeating-linear-gradient(135deg, ${base} 0 6px, ${item.color}1a 6px 12px)`
    : base;
}

// ---------------------------------------------------------------------------------------------------------------
// Układ: wiersze osi czasu (pasy bez nakładania) i kolumny dnia (nakładające się obok siebie, jak w Teams)
// ---------------------------------------------------------------------------------------------------------------
/** Przydział pasów na osi czasu; minSpan = minimalna szerokość pozycji w ms (żeby etykiety się nie nakładały). */
export function assignLanes<T extends { start: number; end: number }>(items: T[], minSpan: number): { item: T; lane: number }[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const laneEnds: number[] = [];
  return sorted.map((item) => {
    const visualEnd = Math.max(item.end, item.start + minSpan);
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(visualEnd);
    } else {
      laneEnds[lane] = visualEnd;
    }
    return { item, lane };
  });
}

export type DayBlock = { item: ScheduleItem; start: number; end: number; column: number; columns: number };

/** Bloki jednego dnia: przycięte do dnia, nakładające się — w kolumnach obok siebie. dayEnd = następna północ (zmiana czasu). */
export function layoutDay(items: ScheduleItem[], dayStart: number, minDuration: number, dayEnd = dayStart + DAY): DayBlock[] {
  const blocks = items
    .filter((item) => !item.all_day && item.start < dayEnd && item.end > dayStart)
    .map((item) => ({ item, start: Math.max(item.start, dayStart), end: Math.min(item.end, dayEnd), column: 0, columns: 1 }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: DayBlock[] = [];
  let clusterEnd = -Infinity;
  const columnEnds: number[] = [];
  const flush = () => {
    const columns = Math.max(1, columnEnds.length);
    cluster.forEach((block) => { block.columns = columns; });
    cluster = [];
    columnEnds.length = 0;
  };
  for (const block of blocks) {
    const visualEnd = Math.max(block.end, block.start + minDuration);
    if (block.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let column = columnEnds.findIndex((end) => end <= block.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(visualEnd);
    } else {
      columnEnds[column] = visualEnd;
    }
    block.column = column;
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, visualEnd);
  }
  flush();
  return blocks;
}
