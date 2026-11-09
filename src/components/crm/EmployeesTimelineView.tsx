'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { IEmployee } from '@/app/(crm)/crm/employees/type';
import { EmployeeAvatar } from '../EmployeeAvatar';
import {
  DAY,
  HOUR,
  SCHEDULE_GROUPS,
  addDays,
  assignLanes,
  capitalizeFirst,
  fetchEmployeeSchedule,
  formatItemTime,
  itemBackground,
  itemTooltip,
  startOfDay,
  startOfMonth,
  startOfWeek,
  toDateParam,
  type ScheduleGroup,
  type ScheduleItem,
} from '@/lib/employees/employeeSchedule';

type Zoom = 'month' | 'week' | 'day';

const LABEL_WIDTH = 224;
const LANE_HEIGHT = 30;
const ROW_PADDING = 10;
const MIN_ROW_HEIGHT = 56;
const MIN_ITEM_PX = 28;
const SPAN: Record<Zoom, number> = { day: DAY, week: 7 * DAY, month: 31 * DAY };
const WEEKDAY_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
/** Długość miesiąca (ms) — widok miesiąca obejmuje dokładnie wybrany miesiąc; przy przeciąganiu długość się nie zmienia. */
const monthSpanOf = (t: number) => {
  const start = startOfMonth(t);
  return new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime() - start.getTime();
};
const positionsLabel = (count: number) => {
  const tens = count % 100;
  const ones = count % 10;
  return `${count} ${count === 1 ? 'pozycja' : ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? 'pozycje' : 'pozycji'}`;
};

/** Pozycja na osi: pojedyncza albo (widok miesiąca) krótkie pozycje jednego dnia zebrane w komórkę dnia. */
type Entry = { key: string; start: number; end: number; items: ScheduleItem[]; day: number | null };

function buildEntries(list: ScheduleItem[], zoom: Zoom): Entry[] {
  if (zoom !== 'month') return list.map((item) => ({ key: `${item.kind}-${item.item_id}-${item.start}`, start: item.start, end: item.end, items: [item], day: null }));
  const entries: Entry[] = [];
  const byDay = new Map<number, ScheduleItem[]>();
  list.forEach((item) => {
    if (item.all_day || item.end - item.start >= 20 * HOUR) {
      entries.push({ key: `${item.kind}-${item.item_id}-${item.start}`, start: item.start, end: item.end, items: [item], day: null });
    } else {
      const day = startOfDay(item.start).getTime();
      byDay.set(day, [...(byDay.get(day) || []), item]);
    }
  });
  byDay.forEach((dayItems, day) => {
    dayItems.sort((a, b) => a.start - b.start);
    entries.push({ key: `day-${day}`, start: day, end: addDays(day, 1).getTime(), items: dayItems, day });
  });
  return entries;
}
const ZOOM_LABELS: Record<Zoom, string> = { month: 'Miesiąc', week: 'Tydzień', day: 'Dzień' };

const alignStart = (zoom: Zoom, focus: Date | number) =>
  zoom === 'day' ? startOfDay(focus) : zoom === 'week' ? startOfWeek(focus) : startOfMonth(focus);

/** day = początek dnia, który otwiera kliknięcie etykiety (przejście do widoku dnia). */
type Tick = { t: number; label: string | null; strong?: boolean; day?: number };
type Shade = { from: number; to: number };

/** Podziałka dopasowana do powiększenia i szerokości: górny wiersz (dni / miesiące) i dolny (godziny / dni). */
function buildScale(zoom: Zoom, viewStart: number, viewEnd: number, pxPerMs: number) {
  const major: Tick[] = [];
  const minor: Tick[] = [];
  const shades: Shade[] = [];
  const pxPerHour = pxPerMs * HOUR;
  const pxPerDay = pxPerMs * DAY;

  if (zoom === 'month') {
    for (let d = startOfMonth(viewStart - DAY); d.getTime() < viewEnd; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      major.push({ t: d.getTime(), label: capitalizeFirst(d.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })) });
    }
    const every = pxPerDay >= 18 ? 1 : 2;
    for (let d = startOfDay(viewStart - DAY), i = 0; d.getTime() < viewEnd; d = addDays(d, 1), i += 1) {
      const weekday = d.getDay();
      if (weekday === 0 || weekday === 6) shades.push({ from: d.getTime(), to: addDays(d, 1).getTime() });
      const label = i % every === 0
        ? pxPerDay >= 34
          ? `${WEEKDAY_SHORT[weekday]} ${d.getDate()}`
          : String(d.getDate())
        : null;
      minor.push({ t: d.getTime(), label, strong: weekday === 1, day: d.getTime() });
    }
  } else if (zoom === 'week') {
    for (let d = startOfDay(viewStart - DAY); d.getTime() < viewEnd; d = addDays(d, 1)) {
      const weekday = d.getDay();
      if (weekday === 0 || weekday === 6) shades.push({ from: d.getTime(), to: addDays(d, 1).getTime() });
      major.push({ t: d.getTime(), label: capitalizeFirst(d.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' })), day: d.getTime() });
      const step = pxPerDay >= 320 ? 3 : 6;
      for (let h = step; h < 24; h += step) {
        const tick = new Date(d);
        tick.setHours(h);
        minor.push({ t: tick.getTime(), label: pxPerDay >= 160 ? `${String(h).padStart(2, '0')}:00` : null });
      }
    }
  } else {
    for (let d = startOfDay(viewStart - DAY); d.getTime() < viewEnd; d = addDays(d, 1)) {
      major.push({ t: d.getTime(), label: capitalizeFirst(d.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })) });
      // Noc przyciemniona (wydarzenia trwają też wieczorami, więc nie „godziny pracy”).
      const morning = new Date(d); morning.setHours(7);
      const night = new Date(d); night.setHours(22);
      shades.push({ from: d.getTime(), to: morning.getTime() }, { from: night.getTime(), to: addDays(d, 1).getTime() });
      const labelEvery = pxPerHour >= 44 ? 1 : 2;
      for (let h = 0; h < 24; h += 1) {
        const tick = new Date(d);
        tick.setHours(h);
        if (h > 0) minor.push({ t: tick.getTime(), label: h % labelEvery === 0 ? `${String(h).padStart(2, '0')}:00` : null, strong: true });
        if (pxPerHour >= 90) {
          const half = new Date(tick);
          half.setMinutes(30);
          minor.push({ t: half.getTime(), label: pxPerHour >= 180 ? `${String(h).padStart(2, '0')}:30` : null });
        }
      }
    }
  }
  return { major, minor, shades };
}

function rangeLabel(zoom: Zoom, start: number, end: number): string {
  const s = new Date(start);
  const e = new Date(end - 1);
  if (zoom === 'day') return capitalizeFirst(s.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  const sameYear = s.getFullYear() === e.getFullYear();
  return `${s.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) })} – ${e.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

interface EmployeesTimelineViewProps {
  employees: IEmployee[];
}

/**
 * Oś czasu zespołu (administrator): przeciąganie myszą lub gestem przewija oś, powiększenie miesiąc / tydzień / dzień,
 * podziałka dopasowana do szerokości ekranu. Dane: get_employee_schedule (plan pracownika), pozycje bez nakładania.
 */
const EmployeesTimelineView: React.FC<EmployeesTimelineViewProps> = ({ employees }) => {
  const router = useRouter();
  const [zoom, setZoom] = useState<Zoom>('week');
  const [viewStart, setViewStart] = useState<number>(() => alignStart('week', Date.now()).getTime());
  const [groups, setGroups] = useState<Set<ScheduleGroup>>(() => new Set<ScheduleGroup>(['events', 'meetings', 'absences']));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showPeople, setShowPeople] = useState(false);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loaded, setLoaded] = useState<{ from: number; to: number; key: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [reload, setReload] = useState(0);
  const [timelineWidth, setTimelineWidth] = useState(900);
  const [now, setNow] = useState(() => Date.now());
  const [dragging, setDragging] = useState(false);
  const [monthSpan, setMonthSpan] = useState(() => monthSpanOf(Date.now()));

  const widthRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; start: number; moved: boolean; pointerId: number } | null>(null);
  const suppressClickRef = useRef(false);
  const sequence = useRef(0);

  const span = zoom === 'month' ? monthSpan : SPAN[zoom];
  const viewEnd = viewStart + span;
  const pxPerMs = timelineWidth / span;

  const visibleEmployees = useMemo(
    () => (selectedIds.length ? employees.filter((employee) => selectedIds.includes(employee.id)) : employees),
    [employees, selectedIds],
  );
  const employeeIds = useMemo(() => visibleEmployees.map((employee) => employee.id), [visibleEmployees]);
  const idsKey = employeeIds.join(',');

  // Szerokość osi = cała dostępna szerokość (bez kolumny pracowników).
  useEffect(() => {
    const element = widthRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setTimelineWidth(Math.max(320, Math.floor(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Dane z zapasem (okno widoku ± jedno okno); nowe pobranie, gdy widok wyjedzie poza wczytany zakres.
  useEffect(() => {
    const covered = loaded && loaded.key === idsKey && viewStart >= loaded.from && viewEnd <= loaded.to;
    if (covered && reload === 0) return;
    const request = ++sequence.current;
    const timer = window.setTimeout(async () => {
      const from = viewStart - span;
      const to = viewEnd + span;
      setLoading(true);
      try {
        const result = await fetchEmployeeSchedule(employeeIds, new Date(from), new Date(to));
        if (request !== sequence.current) return;
        setItems(result.items);
        setLegacy(result.legacy);
        setLoaded({ from, to, key: idsKey });
        setError('');
      } catch (cause) {
        if (request !== sequence.current) return;
        setError(cause instanceof Error ? cause.message : 'Nie udało się wczytać osi czasu.');
      } finally {
        if (request === sequence.current) {
          setLoading(false);
          setReload(0);
        }
      }
    }, loaded ? 200 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewStart, viewEnd, idsKey, reload]);

  // Zmiany przypisań, nieobecności i spotkań odświeżają oś.
  useEffect(() => {
    if (!employeeIds.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setReload((value) => value + 1), 400);
    };
    const channel = supabase.channel(`employee_timeline_${Date.now()}`);
    ['employee_assignments', 'employee_absences', 'event_phase_assignments', 'meeting_participants', 'meetings'].forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
    });
    channel.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [idsKey]);

  const activeKinds = useMemo(
    () => new Set(SCHEDULE_GROUPS.filter((group) => groups.has(group.id)).flatMap((group) => group.kinds)),
    [groups],
  );
  const itemsByEmployee = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    items.forEach((item) => {
      if (!activeKinds.has(item.kind)) return;
      const list = map.get(item.employee_id) || [];
      list.push(item);
      map.set(item.employee_id, list);
    });
    return map;
  }, [items, activeKinds]);

  // Pasy liczone dla całego wczytanego zakresu — przy przesuwaniu wiersze nie skaczą.
  const minSpan = MIN_ITEM_PX / pxPerMs;
  const lanesByEmployee = useMemo(() => {
    const map = new Map<string, { item: Entry; lane: number }[]>();
    itemsByEmployee.forEach((list, id) => map.set(id, assignLanes(buildEntries(list, zoom), minSpan)));
    return map;
  }, [itemsByEmployee, minSpan, zoom]);

  const scale = useMemo(() => buildScale(zoom, viewStart, viewEnd, pxPerMs), [zoom, viewStart, viewEnd, pxPerMs]);
  const toX = useCallback((t: number) => (t - viewStart) * pxPerMs, [viewStart, pxPerMs]);

  const changeZoom = (next: Zoom) => {
    if (next === zoom) return;
    const center = viewStart + span / 2;
    const focus = now >= viewStart && now < viewEnd ? now : center;
    setZoom(next);
    setViewStart(alignStart(next, focus).getTime());
    if (next === 'month') setMonthSpan(monthSpanOf(focus));
  };
  const goToday = () => {
    setViewStart(alignStart(zoom, Date.now()).getTime());
    if (zoom === 'month') setMonthSpan(monthSpanOf(Date.now()));
  };
  const shift = (direction: -1 | 1) => {
    if (zoom === 'month') {
      const base = startOfMonth(viewStart + span / 2);
      const target = new Date(base.getFullYear(), base.getMonth() + direction, 1).getTime();
      setViewStart(target);
      setMonthSpan(monthSpanOf(target));
    } else {
      setViewStart(alignStart(zoom, viewStart + span / 2 + direction * span).getTime());
    }
  };

  // Przeciąganie (grab): przesunięcie myszy o x pikseli przesuwa oś o x / (px na ms).
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-timeline-label]')) return;
    dragRef.current = { x: event.clientX, start: viewStart, moved: false, pointerId: event.pointerId };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 4) {
      drag.moved = true;
      setDragging(true);
      // Przechwycenie dopiero po ruchu — zwykłe kliknięcie w pozycję dalej działa.
      try { event.currentTarget.setPointerCapture(drag.pointerId); } catch { /* starsza przeglądarka */ }
    }
    if (drag.moved) setViewStart(drag.start - dx / pxPerMs);
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      try { event.currentTarget.releasePointerCapture(drag.pointerId); } catch { /* już zwolnione */ }
    }
    setDragging(false);
  };

  // Gest poziomy na gładziku / Shift + kółko przewija oś (pionowe przewijanie strony bez zmian).
  useEffect(() => {
    const element = areaRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (!horizontal && !event.shiftKey) return;
      event.preventDefault();
      const delta = horizontal ? event.deltaX : event.deltaY;
      setViewStart((current) => current + delta / pxPerMs);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [pxPerMs]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); setViewStart((current) => current - span / 8); }
    if (event.key === 'ArrowRight') { event.preventDefault(); setViewStart((current) => current + span / 8); }
  };

  const openItem = (item: ScheduleItem, event: React.MouseEvent) => {
    if (suppressClickRef.current || !item.url) return;
    if (event.metaKey || event.ctrlKey) window.open(item.url, '_blank', 'noopener');
    else router.push(item.url);
  };

  const toggleGroup = (id: ScheduleGroup) =>
    setGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const openDayZoom = (day: number) => {
    if (suppressClickRef.current) return;
    setZoom('day');
    setViewStart(startOfDay(day).getTime());
  };
  // Dzień przekazywany do planu pracownika: dziś, jeśli widoczny, inaczej początek widoku.
  const focusDate = toDateParam(now >= viewStart && now < viewEnd ? now : viewStart + (zoom === 'day' ? span / 2 : 0));

  const nowX = now >= viewStart && now <= viewEnd ? toX(now) : null;
  const gridLines = scale.minor.filter((tick) => tick.t > viewStart && tick.t < viewEnd);
  const majorLines = scale.major.filter((tick) => tick.t > viewStart && tick.t < viewEnd);

  return (
    <div className="flex flex-col gap-3">
      {/* Sterowanie */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-[#1c1f33] p-3">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => shift(-1)} className="rounded-lg bg-[#d3bb73]/10 p-2 text-[#e5e4e2] hover:bg-[#d3bb73]/20" title="Wcześniej" aria-label="Wcześniej">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={goToday} className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/20">
            Dziś
          </button>
          <button type="button" onClick={() => shift(1)} className="rounded-lg bg-[#d3bb73]/10 p-2 text-[#e5e4e2] hover:bg-[#d3bb73]/20" title="Później" aria-label="Później">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[#e5e4e2]">{rangeLabel(zoom, viewStart, viewEnd)}</p>
          <p className="text-[11px] text-[#e5e4e2]/45">Przeciągnij oś myszą albo przesuń dwoma palcami na gładziku</p>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" aria-label="Wczytywanie" />}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {SCHEDULE_GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              aria-pressed={groups.has(group.id)}
              onClick={() => toggleGroup(group.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                groups.has(group.id) ? 'bg-white/10 text-[#e5e4e2]' : 'bg-white/[0.03] text-[#e5e4e2]/40 hover:bg-white/[0.06]'
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: group.color, opacity: groups.has(group.id) ? 1 : 0.35 }} />
              {group.label}
            </button>
          ))}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPeople((value) => !value)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-xs text-[#e5e4e2] hover:bg-white/10"
            >
              <Users className="h-3.5 w-3.5" />
              {selectedIds.length ? `${selectedIds.length} z ${employees.length}` : 'Wszyscy'}
            </button>
            {showPeople && (
              <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-xl bg-[#1c1f33] p-2 shadow-2xl">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-xs text-[#e5e4e2]/60">Pracownicy na osi</span>
                  <div className="flex items-center gap-2">
                    {selectedIds.length > 0 && (
                      <button type="button" onClick={() => setSelectedIds([])} className="text-xs text-[#d3bb73]">Wszyscy</button>
                    )}
                    <button type="button" onClick={() => setShowPeople(false)} aria-label="Zamknij" className="rounded p-1 text-[#e5e4e2]/60 hover:bg-white/5">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {employees.map((employee) => (
                    <label key={employee.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(employee.id)}
                        onChange={() => setSelectedIds((current) => current.includes(employee.id) ? current.filter((id) => id !== employee.id) : [...current, employee.id])}
                        className="h-4 w-4 accent-[#d3bb73]"
                      />
                      <EmployeeAvatar employee={employee} size={24} />
                      <span className="truncate text-sm text-[#e5e4e2]">{employee.nickname || `${employee.name} ${employee.surname}`}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="mx-1 h-5 w-px bg-white/10" />
          {(['month', 'week', 'day'] as Zoom[]).map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={zoom === level}
              onClick={() => changeZoom(level)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                zoom === level ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#d3bb73]/10 text-[#e5e4e2] hover:bg-[#d3bb73]/20'
              }`}
            >
              {ZOOM_LABELS[level]}
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</p>}
      {legacy && (
        <p className="rounded-xl bg-amber-400/10 px-4 py-2 text-xs text-amber-100/80">
          Spotkania, kontakty z lejka i zadania pojawią się na osi po aktualizacji bazy.
        </p>
      )}

      {/* Oś */}
      <div
        ref={areaRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`relative max-h-[calc(100vh-15rem)] select-none overflow-y-auto overflow-x-hidden rounded-xl bg-[#0f1119] outline-none focus-visible:ring-1 focus-visible:ring-[#d3bb73]/40 ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        aria-label="Oś czasu pracowników — strzałki w lewo i w prawo przesuwają oś"
      >
        {/* Nagłówek z podziałką */}
        <div className="sticky top-0 z-20 flex bg-[#1c1f33]">
          <div data-timeline-label className="flex shrink-0 items-end px-4 pb-2 text-xs text-[#e5e4e2]/45" style={{ width: LABEL_WIDTH }}>
            {visibleEmployees.length} {visibleEmployees.length === 1 ? 'osoba' : 'osób'}
          </div>
          <div ref={widthRef} className="relative h-14 min-w-0 flex-1 overflow-hidden">
            {scale.major.map((tick, index) => {
              const next = scale.major[index + 1]?.t ?? Infinity;
              const left = toX(tick.t);
              const right = Math.min(toX(next), timelineWidth);
              if (right <= 0 || left >= timelineWidth) return null;
              // Etykieta przyklejona do lewej krawędzi, dopóki jej przedział jest widoczny.
              const labelLeft = Math.max(0, Math.min(left, right - 140));
              return (
                <div key={`major-${tick.t}`}>
                  {left > 0 && <div className="absolute top-0 h-full w-px bg-white/15" style={{ left }} />}
                  <div
                    onClick={tick.day !== undefined ? () => openDayZoom(tick.day as number) : undefined}
                    title={tick.day !== undefined ? 'Pokaż ten dzień' : undefined}
                    className={`absolute top-1.5 whitespace-nowrap rounded px-2 text-xs font-medium text-[#e5e4e2] ${tick.day !== undefined ? 'cursor-pointer hover:bg-white/10' : ''}`}
                    style={{ left: labelLeft }}
                  >
                    {tick.label}
                  </div>
                </div>
              );
            })}
            {scale.minor.map((tick) => {
              const left = toX(tick.t);
              if (left < -40 || left > timelineWidth + 40 || !tick.label) return null;
              // Godziny pod znacznikiem „teraz” ukryte, żeby się nie nakładały.
              if (nowX !== null && zoom !== 'month' && tick.day === undefined && Math.abs(left - nowX) < 34) return null;
              return (
                <div
                  key={`minor-${tick.t}`}
                  onClick={tick.day !== undefined ? () => openDayZoom(tick.day as number) : undefined}
                  title={tick.day !== undefined ? 'Pokaż ten dzień' : undefined}
                  className={`absolute bottom-1.5 whitespace-nowrap rounded px-0.5 text-[10px] tabular-nums text-[#e5e4e2]/55 ${
                    tick.day !== undefined ? 'cursor-pointer hover:bg-white/10 hover:text-[#e5e4e2]' : '-translate-x-1/2'
                  }`}
                  style={{ left: tick.day !== undefined ? left + 2 : left }}
                >
                  {tick.label}
                </div>
              );
            })}
            {nowX !== null && (
              <div className="pointer-events-none absolute top-0 h-full" style={{ left: nowX }}>
                <div className="h-full w-0.5 bg-[#d3bb73]" />
                {zoom !== 'month' && <div className="absolute bottom-0 left-1 whitespace-nowrap rounded bg-[#d3bb73] px-1.5 text-[10px] font-semibold text-[#1c1f33]">
                  {new Date(now).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                </div>}
              </div>
            )}
          </div>
        </div>

        {/* Wiersze pracowników */}
        {visibleEmployees.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-[#e5e4e2]/50">Wybierz pracowników, aby zobaczyć ich plan.</div>
        ) : (
          visibleEmployees.map((employee, rowIndex) => {
            const placed = lanesByEmployee.get(employee.id) || [];
            const lanes = placed.reduce((max, entry) => Math.max(max, entry.lane + 1), 0);
            const height = Math.max(MIN_ROW_HEIGHT, lanes * LANE_HEIGHT + ROW_PADDING * 2);
            const visible = placed.filter(({ item }) => item.end > viewStart && item.start < viewEnd);
            return (
              <div key={employee.id} className={`flex ${rowIndex % 2 ? 'bg-white/[0.015]' : ''}`}>
                <Link
                  data-timeline-label
                  href={`/crm/employees/${employee.id}?tab=timeline&date=${focusDate}`}
                  className="flex shrink-0 cursor-pointer items-center gap-3 px-4 py-2 hover:bg-white/[0.04]"
                  style={{ width: LABEL_WIDTH }}
                  title="Plan dnia pracownika"
                >
                  <EmployeeAvatar employee={employee} size={36} showActivityStatus />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[#e5e4e2]">{employee.nickname || `${employee.name} ${employee.surname}`}</span>
                    <span className="block truncate text-xs text-[#e5e4e2]/50">{employee.occupation || employee.role}</span>
                  </span>
                </Link>
                <div className="relative min-w-0 flex-1 overflow-hidden" style={{ height }}>
                  {scale.shades.map((shade) => {
                    const left = toX(shade.from);
                    const right = toX(shade.to);
                    if (right <= 0 || left >= timelineWidth) return null;
                    return <div key={`shade-${shade.from}`} className="absolute top-0 h-full bg-black/25" style={{ left: Math.max(0, left), width: Math.min(right, timelineWidth) - Math.max(0, left) }} />;
                  })}
                  {gridLines.map((tick) => (
                    <div key={`grid-${tick.t}`} className={`absolute top-0 h-full w-px ${tick.strong ? 'bg-white/[0.07]' : 'bg-white/[0.035]'}`} style={{ left: toX(tick.t) }} />
                  ))}
                  {majorLines.map((tick) => (
                    <div key={`gridmajor-${tick.t}`} className="absolute top-0 h-full w-px bg-white/[0.12]" style={{ left: toX(tick.t) }} />
                  ))}
                  {visible.map(({ item: entry, lane }) => {
                    const rawLeft = toX(entry.start);
                    const rawRight = toX(entry.end);
                    const left = Math.max(0, rawLeft);
                    // Minimalna szerokość = ta sama, którą liczy przydział pasów (krótkie pozycje da się kliknąć).
                    const width = Math.max(MIN_ITEM_PX - 4, Math.min(Math.max(rawRight, rawLeft + MIN_ITEM_PX - 4), timelineWidth + 4) - left);
                    const single = entry.items.length === 1 ? entry.items[0] : null;
                    const first = entry.items[0];
                    // Kilka pozycji jednego dnia (widok miesiąca): kliknięcie otwiera ten dzień.
                    const onClick = single
                      ? (event: React.MouseEvent) => openItem(single, event)
                      : () => entry.day !== null && openDayZoom(entry.day);
                    const clickable = single ? !!single.url : true;
                    return (
                      <div
                        key={entry.key}
                        role={clickable ? 'link' : undefined}
                        onClick={onClick}
                        title={single ? itemTooltip(single) : `${positionsLabel(entry.items.length)} — kliknij, aby zobaczyć dzień\n${entry.items.map((item) => `${formatItemTime(item)} ${item.title}`).join('\n')}`}
                        className={`absolute flex items-center overflow-hidden rounded-md ${clickable ? 'hover:brightness-125' : ''}`}
                        style={{ top: ROW_PADDING + lane * LANE_HEIGHT, height: LANE_HEIGHT - 4, left, width, background: single ? itemBackground(single) : `${first.color}33` }}
                      >
                        <span className="h-full w-[3px] shrink-0" style={{ backgroundColor: first.color }} />
                        {width > 26 && (
                          <span className="min-w-0 truncate px-1.5 text-[11px] leading-tight text-[#e5e4e2]">
                            {single && width > 150 && !single.all_day && zoom !== 'month' && <span className="mr-1 tabular-nums text-[#e5e4e2]/60">{formatItemTime(single)}</span>}
                            {single ? single.title : positionsLabel(entry.items.length)}
                          </span>
                        )}
                        {!single && width > 70 && (
                          <span className="ml-auto flex shrink-0 gap-0.5 pr-1.5">
                            {Array.from(new Set(entry.items.map((item) => item.color))).slice(0, 4).map((color) => (
                              <span key={color} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                            ))}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {nowX !== null && <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-[#d3bb73]/50" style={{ left: nowX }} />}
                  {visible.length === 0 && !loading && (
                    <div className="absolute inset-0 flex items-center pl-4 text-xs text-[#e5e4e2]/30">Brak planu w tym okresie</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-[#e5e4e2]/50">
        <span>Kliknij pozycję, aby ją otworzyć (Ctrl/⌘ — w nowej karcie). Kliknij pracownika — jego plan dnia.</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-sm" style={{ background: 'repeating-linear-gradient(135deg, #3b82f640 0 4px, #3b82f61a 4px 8px)' }} />
          czeka na potwierdzenie
        </span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-[#d3bb73]" /> teraz</span>
      </div>
    </div>
  );
};

export default EmployeesTimelineView;
