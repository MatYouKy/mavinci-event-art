'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import {
  HOUR,
  SCHEDULE_GROUPS,
  SCHEDULE_KIND_LABELS,
  addDays,
  capitalizeFirst,
  fetchEmployeeSchedule,
  formatTime,
  isSameDay,
  itemBackground,
  itemTooltip,
  layoutDay,
  startOfDay,
  startOfWeek,
  type ScheduleGroup,
  type ScheduleItem,
} from '@/lib/employees/employeeSchedule';

export type ScheduleView = 'day' | 'week';

const HOUR_HEIGHT = 52;
const GUTTER = 56;
const MIN_BLOCK_MINUTES = 30;
const NIGHT_BEFORE = 7;
const NIGHT_AFTER = 22;
const VIEW_LABELS: Record<ScheduleView, string> = { day: 'Dzień', week: 'Tydzień' };

const readStoredView = (key: string): ScheduleView | null => {
  try {
    const value = window.localStorage.getItem(key);
    return value === 'day' || value === 'week' ? value : null;
  } catch {
    return null;
  }
};
const storeView = (key: string, view: ScheduleView) => {
  try { window.localStorage.setItem(key, view); } catch { /* tryb prywatny */ }
};

/** Minuty od północy danego dnia (czas lokalny; poprawnie także w dni zmiany czasu). */
const minutesInDay = (t: number, dayStart: number, dayEnd: number) => {
  if (t <= dayStart) return 0;
  if (t >= dayEnd) return 24 * 60;
  const date = new Date(t);
  return date.getHours() * 60 + date.getMinutes();
};

interface EmployeeScheduleCalendarProps {
  employeeId: string;
  /** Widok startowy: własny profil — tydzień, profil innej osoby (administrator) — dzień. */
  defaultView: ScheduleView;
  /** Dzień do pokazania (np. z ?date= po kliknięciu pracownika na osi zespołu). */
  initialDate?: Date | null;
  /** Klucz zapamiętanego widoku w przeglądarce. */
  storageKey?: string;
}

/**
 * Plan pracownika jak w Teams: godziny od góry do dołu, widok dnia albo tygodnia (poniedziałek–niedziela),
 * pasek „cały dzień” nad siatką, nakładające się pozycje obok siebie. Dane: get_employee_schedule.
 */
const EmployeeScheduleCalendar: React.FC<EmployeeScheduleCalendarProps> = ({
  employeeId,
  defaultView,
  initialDate,
  storageKey = 'crm.employee-schedule.view',
}) => {
  const router = useRouter();
  const [chosenView, setChosenView] = useState<ScheduleView | null>(null);
  const [anchor, setAnchor] = useState<number>(() => startOfDay(initialDate || Date.now()).getTime());
  const [groups, setGroups] = useState<Set<ScheduleGroup>>(() => new Set<ScheduleGroup>(SCHEDULE_GROUPS.map((group) => group.id)));
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef('');

  useEffect(() => {
    setChosenView(readStoredView(storageKey));
  }, [storageKey]);

  const view: ScheduleView = chosenView || defaultView;
  const changeView = (next: ScheduleView) => {
    setChosenView(next);
    storeView(storageKey, next);
  };

  const days = useMemo(() => {
    if (view === 'day') return [startOfDay(anchor)];
    const monday = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  }, [view, anchor]);
  const rangeStart = days[0].getTime();
  const rangeEnd = addDays(days[days.length - 1], 1).getTime();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchEmployeeSchedule([employeeId], new Date(rangeStart), new Date(rangeEnd))
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setLegacy(result.legacy);
        setError('');
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Nie udało się wczytać planu.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [employeeId, rangeStart, rangeEnd, reload]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setReload((value) => value + 1), 400);
    };
    const channel = supabase.channel(`employee_schedule_${employeeId}_${Date.now()}`);
    ['employee_assignments', 'employee_absences', 'event_phase_assignments', 'meeting_participants', 'meetings', 'tasks'].forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
    });
    channel.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [employeeId]);

  const activeKinds = useMemo(
    () => new Set(SCHEDULE_GROUPS.filter((group) => groups.has(group.id)).flatMap((group) => group.kinds)),
    [groups],
  );
  const visibleItems = useMemo(() => items.filter((item) => activeKinds.has(item.kind)), [items, activeKinds]);

  const columns = useMemo(() => days.map((day) => {
    const dayStart = day.getTime();
    const dayEnd = addDays(day, 1).getTime();
    const allDay = visibleItems
      .filter((item) => item.all_day && item.start < dayEnd && item.end > dayStart)
      .sort((a, b) => a.start - b.start || b.end - a.end);
    const blocks = layoutDay(visibleItems, dayStart, MIN_BLOCK_MINUTES * 60_000, dayEnd);
    return { day, dayStart, dayEnd, allDay, blocks };
  }), [days, visibleItems]);

  const allDayRows = Math.max(0, ...columns.map((column) => column.allDay.length));
  const [allDayExpanded, setAllDayExpanded] = useState(false);
  const allDayLimit = view === 'day' || allDayExpanded ? Infinity : 3;

  // Przewinięcie siatki: dziś — godzinę przed teraz; inny dzień — do pierwszej pozycji albo 7:00.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || loading || scrolledFor.current === `${view}-${rangeStart}`) return;
    scrolledFor.current = `${view}-${rangeStart}`;
    const showsToday = now >= rangeStart && now < rangeEnd;
    const earliest = columns.reduce((min, column) => {
      const first = column.blocks[0];
      return first ? Math.min(min, minutesInDay(first.start, column.dayStart, column.dayEnd)) : min;
    }, Infinity);
    const minutes = showsToday
      ? Math.max(0, (new Date(now).getHours() - 2) * 60 + 30)
      : Math.min(NIGHT_BEFORE * 60, Number.isFinite(earliest) ? Math.max(0, earliest - 30) : NIGHT_BEFORE * 60);
    element.scrollTop = (minutes / 60) * HOUR_HEIGHT;
  }, [view, rangeStart, rangeEnd, loading, columns, now]);

  const shift = (direction: -1 | 1) =>
    setAnchor((current) => addDays(current, direction * (view === 'day' ? 1 : 7)).getTime());
  const goToday = () => setAnchor(startOfDay(Date.now()).getTime());
  const openDay = (day: Date) => {
    setAnchor(day.getTime());
    changeView('day');
  };
  const openItem = useCallback((item: ScheduleItem, event: React.MouseEvent) => {
    if (!item.url) return;
    if (event.metaKey || event.ctrlKey) window.open(item.url, '_blank', 'noopener');
    else router.push(item.url);
  }, [router]);
  const toggleGroup = (id: ScheduleGroup) =>
    setGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const label = view === 'day'
    ? capitalizeFirst(days[0].toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
    : `${days[0].toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })} – ${days[6].toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  const counts = SCHEDULE_GROUPS.map((group) => ({
    group,
    count: items.filter((item) => group.kinds.includes(item.kind)).length,
  }));
  const gridTemplate = `${GUTTER}px repeat(${days.length}, minmax(${view === 'week' ? 112 : 0}px, 1fr))`;
  const nowMinutes = new Date(now).getHours() * 60 + new Date(now).getMinutes();

  return (
    <div className="rounded-xl bg-[#1c1f33] p-4">
      {/* Sterowanie */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => shift(-1)} className="rounded-lg bg-[#d3bb73]/10 p-2 text-[#e5e4e2] hover:bg-[#d3bb73]/20" aria-label={view === 'day' ? 'Poprzedni dzień' : 'Poprzedni tydzień'}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={goToday} className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/20">Dziś</button>
          <button type="button" onClick={() => shift(1)} className="rounded-lg bg-[#d3bb73]/10 p-2 text-[#e5e4e2] hover:bg-[#d3bb73]/20" aria-label={view === 'day' ? 'Następny dzień' : 'Następny tydzień'}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <h3 className="text-base font-light text-[#e5e4e2]">{label}</h3>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" aria-label="Wczytywanie" />}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {counts.map(({ group, count }) => (
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
              <span className="tabular-nums text-[#e5e4e2]/50">{count}</span>
            </button>
          ))}
          <div className="mx-1 h-5 w-px bg-white/10" />
          {(['day', 'week'] as ScheduleView[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => changeView(option)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                view === option ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#d3bb73]/10 text-[#e5e4e2] hover:bg-[#d3bb73]/20'
              }`}
            >
              {VIEW_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
      {legacy && (
        <p className="mb-3 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-100/80">
          Spotkania, kontakty z lejka i zadania pojawią się po aktualizacji bazy.
        </p>
      )}

      <div ref={scrollRef} className="relative max-h-[calc(100vh-18rem)] min-h-[460px] overflow-auto rounded-lg bg-[#0f1119]">
        <div style={{ minWidth: view === 'week' ? GUTTER + 7 * 112 : undefined }}>
          <div className="sticky top-0 z-20 bg-[#161a2b]">
          {/* Nagłówki dni */}
          <div className="grid" style={{ gridTemplateColumns: gridTemplate }}>
            <div className="sticky left-0 z-10 bg-[#161a2b]" />
            {columns.map(({ day }) => {
              const today = isSameDay(day, now);
              return (
                <button
                  key={day.getTime()}
                  type="button"
                  onClick={() => view === 'week' && openDay(day)}
                  className={`flex items-baseline gap-2 px-3 py-2 text-left ${view === 'week' ? 'hover:bg-white/[0.04]' : 'cursor-default'}`}
                  title={view === 'week' ? 'Pokaż ten dzień' : undefined}
                >
                  <span className={`text-2xl font-light tabular-nums ${today ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'}`}>{day.getDate()}</span>
                  <span className={`text-xs capitalize ${today ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/55'}`}>
                    {day.toLocaleDateString('pl-PL', { weekday: view === 'day' ? 'long' : 'short' })}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Cały dzień */}
          {allDayRows > 0 && (
            <div className="grid bg-black/20" style={{ gridTemplateColumns: gridTemplate }}>
              <div className="sticky left-0 z-10 flex flex-col items-end justify-start gap-1 bg-[#131726] px-2 py-1.5 text-[10px] leading-tight text-[#e5e4e2]/45">
                cały dzień
                {view === 'week' && allDayRows > 3 && (
                  <button type="button" onClick={() => setAllDayExpanded((value) => !value)} className="text-[#d3bb73]">
                    {allDayExpanded ? 'mniej' : 'więcej'}
                  </button>
                )}
              </div>
              {columns.map(({ dayStart, allDay }) => (
                <div key={dayStart} className="flex min-w-0 flex-col gap-1 p-1">
                  {allDay.slice(0, allDayLimit).map((item) => (
                    <button
                      key={`${item.kind}-${item.item_id}`}
                      type="button"
                      onClick={(event) => openItem(item, event)}
                      title={itemTooltip(item)}
                      className={`flex min-w-0 items-center overflow-hidden rounded text-left ${item.url ? 'hover:brightness-125' : 'cursor-default'}`}
                      style={{ background: itemBackground(item, '4d') }}
                    >
                      <span className="w-[3px] self-stretch" style={{ backgroundColor: item.color }} />
                      <span className="min-w-0 truncate px-1.5 py-0.5 text-[11px] text-[#e5e4e2]">{item.title}</span>
                    </button>
                  ))}
                  {allDay.length > allDayLimit && (
                    <button type="button" onClick={() => setAllDayExpanded(true)} className="px-1 text-left text-[10px] text-[#d3bb73]">
                      +{allDay.length - allDayLimit} więcej
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          </div>

          {/* Siatka godzin */}
            <div className="grid" style={{ gridTemplateColumns: gridTemplate, height: 24 * HOUR_HEIGHT }}>
              <div className="sticky left-0 z-10 bg-[#0f1119]">
                {Array.from({ length: 23 }, (_, index) => index + 1).map((hour) => (
                  <span key={hour} className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-[#e5e4e2]/45" style={{ top: hour * HOUR_HEIGHT }}>
                    {String(hour).padStart(2, '0')}:00
                  </span>
                ))}
              </div>
              {columns.map(({ day, dayStart, dayEnd, blocks }) => {
                const weekend = day.getDay() === 0 || day.getDay() === 6;
                const today = isSameDay(day, now);
                return (
                  <div
                    key={dayStart}
                    className="relative min-w-0"
                    style={{
                      backgroundColor: weekend ? 'rgba(255,255,255,0.015)' : undefined,
                      backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.28) 0, rgba(0,0,0,0.28) ${NIGHT_BEFORE * HOUR_HEIGHT}px, transparent ${NIGHT_BEFORE * HOUR_HEIGHT}px, transparent ${NIGHT_AFTER * HOUR_HEIGHT}px, rgba(0,0,0,0.28) ${NIGHT_AFTER * HOUR_HEIGHT}px), repeating-linear-gradient(to bottom, rgba(255,255,255,0.07) 0 1px, transparent 1px ${HOUR_HEIGHT / 2}px, rgba(255,255,255,0.03) ${HOUR_HEIGHT / 2}px ${HOUR_HEIGHT / 2 + 1}px, transparent ${HOUR_HEIGHT / 2 + 1}px ${HOUR_HEIGHT}px), linear-gradient(to right, rgba(255,255,255,0.06) 0 1px, transparent 1px)`,
                    }}
                  >
                    {blocks.map((block) => {
                      const top = (minutesInDay(block.start, dayStart, dayEnd) / 60) * HOUR_HEIGHT;
                      const bottom = (minutesInDay(block.end, dayStart, dayEnd) / 60) * HOUR_HEIGHT;
                      const height = Math.max(bottom - top, (MIN_BLOCK_MINUTES / 60) * HOUR_HEIGHT) - 2;
                      const { item } = block;
                      const continuesBefore = item.start < dayStart;
                      const continuesAfter = item.end > dayEnd;
                      return (
                        <button
                          key={`${item.kind}-${item.item_id}-${block.start}`}
                          type="button"
                          onClick={(event) => openItem(item, event)}
                          title={itemTooltip(item)}
                          className={`absolute flex overflow-hidden rounded-md text-left ${item.url ? 'hover:brightness-125' : 'cursor-default'}`}
                          style={{
                            top: top + 1,
                            height,
                            left: `calc(${(block.column / block.columns) * 100}% + 2px)`,
                            width: `calc(${100 / block.columns}% - 4px)`,
                            background: itemBackground(item, '3d'),
                          }}
                        >
                          <span className="w-[3px] shrink-0" style={{ backgroundColor: item.color }} />
                          <span className="min-w-0 flex-1 px-1.5 py-1">
                            <span className="block truncate text-xs font-medium leading-tight text-[#e5e4e2]">{item.title}</span>
                            {height >= 34 && (
                              <span className="block truncate text-[10px] leading-tight text-[#e5e4e2]/60">
                                {continuesBefore ? '… ' : ''}{formatTime(block.start)}–{continuesAfter ? '…' : formatTime(block.end)}
                                {view === 'day' && ` · ${SCHEDULE_KIND_LABELS[item.kind]}`}
                              </span>
                            )}
                            {height >= 52 && item.subtitle && (
                              <span className="block truncate text-[10px] leading-tight text-[#e5e4e2]/50">{item.subtitle}</span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                    {today && (
                      <div className="pointer-events-none absolute left-0 right-0 z-10" style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}>
                        <div className="h-0.5 bg-[#d3bb73]" />
                        <div className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-[#d3bb73]" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
        </div>
      </div>

      {view === 'day' && !loading && visibleItems.length === 0 && (
        <p className="mt-3 text-center text-sm text-[#e5e4e2]/45">Brak zaplanowanych pozycji tego dnia.</p>
      )}
      {view === 'week' && !loading && visibleItems.length === 0 && (
        <p className="mt-3 text-center text-sm text-[#e5e4e2]/45">Brak zaplanowanych pozycji w tym tygodniu.</p>
      )}
      <p className="mt-3 text-[11px] text-[#e5e4e2]/45">
        Kliknij pozycję, aby ją otworzyć (Ctrl/⌘ — w nowej karcie){view === 'week' ? ', a nagłówek dnia — aby zobaczyć cały dzień' : ''}. Pozycje w paski czekają na potwierdzenie.
      </p>
    </div>
  );
};

export default EmployeeScheduleCalendar;
