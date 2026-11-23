import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/*
 * Oś czasu w aplikacji (Spotkania, Eventy, Zespół, Flota): zakresy dnia / tygodnia / miesiąca, rozkład pozycji na tory i odczyt
 * planu pracowników (RPC `get_employee_schedule`, jak oś czasu zespołu w CRM — `src/lib/employees/employeeSchedule.ts`) oraz
 * rezerwacji aut (RPC `get_vehicle_timeline` + `event_timeline_bounds`, jak `VehiclesTimelineView` w CRM). Kto co widzi, liczy baza.
 * Czas lokalny urządzenia; tydzień od poniedziałku.
 */

export type TimelineZoom = 'day' | 'week' | 'month';
export type ScreenView = 'list' | 'timeline';

export const TIMELINE_ZOOMS: ReadonlyArray<{ id: TimelineZoom; label: string }> = [
  { id: 'day', label: 'Dzień' },
  { id: 'week', label: 'Tydzień' },
  { id: 'month', label: 'Miesiąc' },
];

export const SCREEN_VIEWS: ReadonlyArray<{ id: ScreenView; label: string }> = [
  { id: 'list', label: 'Lista' },
  { id: 'timeline', label: 'Timeline' },
];

/** Powiększenie osi („lupka”): mnożnik szerokości kolumn dnia / godziny. */
export const TIMELINE_SCALES = [1, 1.5, 2, 3, 4] as const;
export const timelineScaleLabel = (scale: number) => `${String(scale).replace('.', ',')}×`;
const timelineScale = (value: unknown): number => (TIMELINE_SCALES as readonly number[]).includes(Number(value)) ? Number(value) : 1;

/** Pozycja na osi: wiersz (pracownik, auto) albo — bez wierszy — wspólny tor (spotkania, eventy). */
export type TimelineEntry = {
  id: string;
  rowId?: string | null;
  start: number;
  end: number;
  title: string;
  subtitle?: string | null;
  color: string;
  /** Odwołane, odrzucone — przygaszone. */
  dimmed?: boolean;
  allDay?: boolean;
};

export type TimelineRow = {
  id: string;
  label: string;
  sublabel?: string | null;
  /** Zdjęcie pracownika (bez `icon`) albo ikona (np. auto). */
  avatarUrl?: string | null;
  avatarMetadata?: unknown;
  icon?: 'truck' | 'user';
};

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const startOfDay = (value: Date | number) => {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};
export const addDays = (value: Date | number, days: number) => {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
};
export const startOfWeek = (value: Date | number) => {
  const day = startOfDay(value);
  return addDays(day, -((day.getDay() + 6) % 7));
};
export const startOfMonth = (value: Date | number) => {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), 1);
};
export const isSameDay = (a: Date | number, b: Date | number) => startOfDay(a).getTime() === startOfDay(b).getTime();

/** Zakres osi: doba, tydzień (pn–nd) albo cały miesiąc; `days` — kolumny dni (dla doby — jeden dzień). */
export function timelineRange(zoom: TimelineZoom, anchor: Date): { start: Date; end: Date; days: Date[] } {
  const start = zoom === 'day' ? startOfDay(anchor) : zoom === 'week' ? startOfWeek(anchor) : startOfMonth(anchor);
  const end = zoom === 'day' ? addDays(start, 1) : zoom === 'week' ? addDays(start, 7) : new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const days: Date[] = [];
  for (let day = start; day < end; day = addDays(day, 1)) days.push(day);
  return { start, end, days };
}

/** Poprzedni / następny okres. */
export function shiftAnchor(zoom: TimelineZoom, anchor: Date, direction: -1 | 1): Date {
  if (zoom === 'day') return addDays(anchor, direction);
  if (zoom === 'week') return addDays(anchor, 7 * direction);
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

const capitalize = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);
const MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const MONTHS_NOMINATIVE = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
export const WEEKDAYS_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
const WEEKDAYS_LONG = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

/** „Poniedziałek, 23 listopada 2026”, „17–23 listopada 2026”, „30 listopada – 6 grudnia 2026”, „Listopad 2026”. */
export function timelineRangeLabel(zoom: TimelineZoom, anchor: Date): string {
  const { start, end } = timelineRange(zoom, anchor);
  if (zoom === 'day') return `${capitalize(WEEKDAYS_LONG[start.getDay()])}, ${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
  if (zoom === 'month') return `${MONTHS_NOMINATIVE[start.getMonth()]} ${start.getFullYear()}`;
  const last = addDays(end, -1);
  if (start.getMonth() === last.getMonth()) return `${start.getDate()}–${last.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
  return `${start.getDate()} ${MONTHS[start.getMonth()]}${start.getFullYear() !== last.getFullYear() ? ` ${start.getFullYear()}` : ''} – ${last.getDate()} ${MONTHS[last.getMonth()]} ${last.getFullYear()}`;
}

const pad = (value: number) => String(value).padStart(2, '0');
export const formatClock = (value: number | Date) => {
  const date = new Date(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** „14:00–16:30”, „pt. 14.11 – nd. 16.11”, „cały dzień”. */
export function formatEntryTime(entry: Pick<TimelineEntry, 'start' | 'end' | 'allDay'>): string {
  const start = new Date(entry.start);
  const end = new Date(entry.end);
  const dayLabel = (date: Date) => `${WEEKDAYS_SHORT[date.getDay()].toLowerCase()}. ${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
  if (entry.allDay) {
    const last = new Date(entry.end - 1);
    return isSameDay(start, last) ? `${dayLabel(start)}, cały dzień` : `${dayLabel(start)} – ${dayLabel(last)}`;
  }
  if (isSameDay(start, end) || entry.end - entry.start < DAY && end.getHours() === 0 && end.getMinutes() === 0) {
    return `${dayLabel(start)}, ${formatClock(start)}–${formatClock(end)}`;
  }
  return `${dayLabel(start)} ${formatClock(start)} – ${dayLabel(end)} ${formatClock(end)}`;
}

/** Pozycje w torach bez nakładania (`minSpan` — najmniejsza szerokość pozycji w ms, żeby krótkie się nie zasłaniały). */
export function assignLanes<T extends { start: number; end: number }>(items: T[], minSpan: number): { item: T; lane: number }[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const ends: number[] = [];
  return sorted.map((item) => {
    const end = Math.max(item.end, item.start + minSpan);
    let lane = ends.findIndex((laneEnd) => laneEnd <= item.start);
    if (lane < 0) { lane = ends.length; ends.push(end); } else ends[lane] = end;
    return { item, lane };
  });
}

/** Kolor z przezroczystością (`#rrggbb` / `#rgb` → rgba). */
export function withOpacity(color: string | null | undefined, opacity: number): string {
  const hex = (color || '#d3bb73').replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex.slice(0, 6);
  const value = Number.parseInt(full, 16);
  if (!/^[0-9a-f]{6}$/i.test(full) || Number.isNaN(value)) return `rgba(211, 187, 115, ${opacity})`;
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

// ---------------------------------------------------------------------------------------------------------------
// Widok ekranu (lista / timeline), skala i powiększenie — zapamiętane na urządzeniu osobno dla każdego ekranu
// ---------------------------------------------------------------------------------------------------------------

type ScreenTimelineState = { view: ScreenView; zoom: TimelineZoom; scale: number };
const memory = new Map<string, ScreenTimelineState>();

export function useScreenTimeline(screen: 'meetings' | 'events' | 'employees' | 'fleet', defaultZoom: TimelineZoom = 'week') {
  const key = `mavinci.timeline.${screen}`;
  const [state, setState] = useState<ScreenTimelineState>(() => memory.get(key) ?? { view: 'list', zoom: defaultZoom, scale: 1 });
  const [anchor, setAnchor] = useState(() => new Date());
  useEffect(() => {
    if (memory.has(key)) return;
    let active = true;
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (!active || !raw) return;
        const saved = JSON.parse(raw) as { view?: unknown; zoom?: unknown; scale?: unknown };
        const next: ScreenTimelineState = {
          view: saved.view === 'timeline' ? 'timeline' : 'list',
          zoom: saved.zoom === 'day' || saved.zoom === 'week' || saved.zoom === 'month' ? saved.zoom : defaultZoom,
          scale: timelineScale(saved.scale),
        };
        memory.set(key, next);
        setState(next);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [key, defaultZoom]);
  const update = (patch: Partial<ScreenTimelineState>) => {
    setState((current) => {
      const next = { ...current, ...patch };
      memory.set(key, next);
      void AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  };
  return {
    view: state.view,
    zoom: state.zoom,
    /** Powiększenie osi (`TIMELINE_SCALES`). */
    scale: state.scale,
    anchor,
    setView: (view: ScreenView) => update({ view }),
    setZoom: (zoom: TimelineZoom) => update({ zoom }),
    setScale: (scale: number) => update({ scale: timelineScale(scale) }),
    setAnchor,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Plan pracowników (Zespół) — RPC get_employee_schedule (swój plan; administrator i employees_manage — każdy)
// ---------------------------------------------------------------------------------------------------------------

export type ScheduleKind = 'event' | 'phase' | 'meeting' | 'inquiry' | 'task' | 'call' | 'absence';

export const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
  event: 'Event',
  phase: 'Faza eventu',
  meeting: 'Spotkanie',
  inquiry: 'Kontakt w zapytaniu',
  task: 'Zadanie',
  call: 'Oddzwonienie',
  absence: 'Nieobecność',
};

export const SCHEDULE_LEGEND: ReadonlyArray<{ label: string; color: string }> = [
  { label: 'Eventy i fazy', color: '#3b82f6' },
  { label: 'Spotkania', color: '#0ea5e9' },
  { label: 'Lejek i zadania', color: '#f59e0b' },
  { label: 'Nieobecności', color: '#10b981' },
];

export type ScheduleEntry = TimelineEntry & {
  kind: ScheduleKind;
  itemId: string;
  status: string | null;
  /** Adres CRM (np. `/crm/events/<id>`) — przejście z aplikacji do eventu. */
  url: string | null;
};

const KINDS = new Set<ScheduleKind>(['event', 'phase', 'meeting', 'inquiry', 'task', 'call', 'absence']);

function scheduleRows(data: unknown): ScheduleEntry[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row: any, index: number) => {
    const kind = String(row?.kind ?? '') as ScheduleKind;
    const start = Date.parse(row?.starts_at);
    const end = Date.parse(row?.ends_at);
    if (!KINDS.has(kind) || !Number.isFinite(start) || !Number.isFinite(end) || !row?.employee_id) return [];
    return [{
      id: `${kind}-${row.item_id ?? index}-${row.employee_id}-${start}`,
      rowId: String(row.employee_id),
      kind,
      itemId: String(row.item_id ?? ''),
      title: typeof row.title === 'string' && row.title.trim() ? row.title : SCHEDULE_KIND_LABELS[kind],
      subtitle: typeof row.subtitle === 'string' && row.subtitle.trim() ? row.subtitle : SCHEDULE_KIND_LABELS[kind],
      start,
      end: Math.max(end, start + 15 * MINUTE),
      allDay: row.all_day === true,
      status: typeof row.status === 'string' ? row.status : null,
      color: typeof row.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(row.color) ? row.color : '#64748b',
      url: typeof row.url === 'string' && row.url.startsWith('/') ? row.url : null,
    }];
  });
}

/** Dawna oś czasu (przed migracją 20261109140000): eventy, fazy i nieobecności z get_employee_timeline_data. */
function legacyScheduleRows(data: unknown): ScheduleEntry[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row: any, index: number) => {
    const kind: ScheduleKind | null = row?.item_type === 'event' ? 'event' : row?.item_type === 'phase' ? 'phase' : row?.item_type === 'absence' ? 'absence' : null;
    const start = Date.parse(row?.item_start);
    const end = Date.parse(row?.item_end);
    if (!kind || !Number.isFinite(start) || !Number.isFinite(end) || !row?.employee_id) return [];
    const eventId = kind === 'event' ? row.item_id : row?.item_metadata?.event_id;
    return [{
      id: `${kind}-${row.item_id ?? index}-${row.employee_id}-${start}`,
      rowId: String(row.employee_id),
      kind,
      itemId: String(row.item_id ?? ''),
      title: String(row.item_title || SCHEDULE_KIND_LABELS[kind]),
      subtitle: row?.item_metadata?.location || SCHEDULE_KIND_LABELS[kind],
      start,
      end: Math.max(end, start + 15 * MINUTE),
      allDay: kind !== 'phase',
      status: row.item_status ?? null,
      color: typeof row.item_color === 'string' ? row.item_color : '#64748b',
      url: eventId ? `/crm/events/${eventId}` : null,
    }];
  });
}

export async function fetchEmployeeSchedule(employeeIds: string[], from: Date, to: Date): Promise<ScheduleEntry[]> {
  if (!employeeIds.length) return [];
  const { data, error } = await supabase.rpc('get_employee_schedule', {
    p_employee_ids: employeeIds,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (!error) return scheduleRows(data);
  if (error.code !== 'PGRST202' && error.code !== '42883') throw new Error(error.message || 'Nie udało się wczytać planu zespołu.');
  const legacy = await supabase.rpc('get_employee_timeline_data', {
    p_employee_ids: employeeIds,
    p_start_date: from.toISOString(),
    p_end_date: to.toISOString(),
  });
  if (legacy.error) throw new Error(legacy.error.message || 'Nie udało się wczytać planu zespołu.');
  return legacyScheduleRows(legacy.data);
}

/** Identyfikator eventu z adresu CRM pozycji planu (`/crm/events/<id>…`). */
export function scheduleEventId(entry: Pick<ScheduleEntry, 'url'>): string | null {
  const match = /^\/crm\/events\/([0-9a-f-]{36})/i.exec(entry.url || '');
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Rezerwacje aut (Flota) — RPC get_vehicle_timeline dla każdego auta, eventy w granicach `event_timeline_bounds`
// ---------------------------------------------------------------------------------------------------------------

export type VehicleEntry = TimelineEntry & {
  kind: 'event' | 'maintenance';
  relatedId: string | null;
  status: string | null;
  driver: string | null;
  location: string | null;
  description: string | null;
};

/** „2026-11-22T00:00:00+00:00” → północ 22.11 w strefie urządzenia (dzień z daty, bez przesunięcia strefy). */
function localDay(value: unknown): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof value === 'string' ? value : '');
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() : Number.NaN;
}

export async function fetchVehicleTimelines(vehicleIds: string[], from: Date, to: Date): Promise<VehicleEntry[]> {
  if (!vehicleIds.length) return [];
  const results = await Promise.all(vehicleIds.map(async (vehicleId) => {
    const { data, error } = await supabase.rpc('get_vehicle_timeline', {
      p_vehicle_id: vehicleId,
      p_start_date: from.toISOString(),
      p_end_date: to.toISOString(),
    });
    if (error) {
      if (['PGRST202', '42883'].includes(error.code ?? '')) throw new Error('Oś czasu floty wymaga aktualizacji bazy (funkcja get_vehicle_timeline).');
      return [] as VehicleEntry[];
    }
    return ((Array.isArray(data) ? data : []) as any[]).flatMap((row, index): VehicleEntry[] => {
      // Kolumny funkcji: `timeline_id`, `timeline_type` (starsze wersje: `id`, `type`).
      const kind = (row?.timeline_type ?? row?.type) === 'maintenance' ? 'maintenance' : 'event';
      // Serwisy i przeglądy mają w bazie same daty (północ UTC) — na osi jako całe dni w strefie urządzenia.
      const start = kind === 'maintenance' ? localDay(row?.start_date) : Date.parse(row?.start_date);
      const rawEnd = kind === 'maintenance' ? localDay(row?.end_date) : Date.parse(row?.end_date);
      const end = kind === 'maintenance' && Number.isFinite(start) && !(rawEnd > start) ? start + DAY : rawEnd;
      if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
      return [{
        id: `${vehicleId}-${row?.timeline_id ?? row?.id ?? index}-${start}`,
        rowId: vehicleId,
        kind,
        relatedId: row?.related_id ? String(row.related_id) : null,
        title: String(row?.event_name || row?.title || (kind === 'maintenance' ? 'Serwis' : 'Event')),
        subtitle: [row?.driver_name ? `Kierowca: ${row.driver_name}` : '', row?.location || ''].filter(Boolean).join(' · ') || null,
        start,
        end: Math.max(end, start + 30 * MINUTE),
        color: typeof row?.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(row.color) ? row.color : kind === 'maintenance' ? '#f97316' : '#3b82f6',
        status: row?.status ? String(row.status) : null,
        driver: row?.driver_name ? String(row.driver_name) : null,
        location: row?.location ? String(row.location) : null,
        description: row?.description ? String(row.description) : null,
        allDay: kind === 'maintenance',
      }];
    });
  }));
  const entries = results.flat();
  // Eventy na osi w granicach planu realizacji (wyjazd–powrót), jak w CRM.
  const eventIds = Array.from(new Set(entries.filter((entry) => entry.kind === 'event' && entry.relatedId).map((entry) => entry.relatedId as string)));
  if (!eventIds.length) return entries;
  const { data: bounds } = await supabase.from('event_timeline_bounds').select('event_id, timeline_start, timeline_end').in('event_id', eventIds);
  const byEvent = new Map(((bounds || []) as any[]).map((row) => [String(row.event_id), row]));
  return entries.map((entry) => {
    const row = entry.kind === 'event' && entry.relatedId ? byEvent.get(entry.relatedId) : null;
    const start = row ? Date.parse(row.timeline_start) : NaN;
    const end = row ? Date.parse(row.timeline_end) : NaN;
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? { ...entry, start, end } : entry;
  });
}
