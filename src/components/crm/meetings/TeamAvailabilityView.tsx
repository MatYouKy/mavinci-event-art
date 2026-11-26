'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Lock, Search, Users, X } from 'lucide-react';
import { layoutTimeline } from '@/lib/CRM/meetings/meetingStatus';
import {
  availabilityColor,
  availabilityKindLabel,
  availabilityTime,
  availabilityTitle,
  departmentLabel,
  peopleByDepartment,
  schedulePersonName,
  type AvailabilityBlock,
  type Department,
  type SchedulePerson,
} from '@/lib/CRM/meetings/teamAvailability';
import { fetchAvailability, fetchSchedulePeople } from './teamAvailabilityApi';

/*
 * Spotkania → „Pracownicy” (jak widok planowania w Teams / Outlooku): wybrany dzień, kolumna dla każdej wybranej osoby
 * z zakresu planu (`get_schedule_people`) — spotkania, eventy, fazy i nieobecności (`get_team_availability`). Tytuły według
 * zakresu; spotkania prywatne innych osób — „Zajęty”. Zaznaczenie wolnego czasu w kolumnie zakłada spotkanie z tą osobą.
 * Wybór osób zapamiętuje przeglądarka. Opis: docs/team-availability.md.
 */

const HOUR = 52;
const SNAP = 15;
const LABEL_WIDTH = 56;
const WORK_START = 8;
const WORK_END = 18;
const COLUMN_MIN = 150;
const STORAGE_KEY = 'mavinci:meetings:people';
const MAX_PEOPLE = 20;

const pad = (value: number) => String(value).padStart(2, '0');
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const minutesOfDay = (date: Date) => date.getHours() * 60 + date.getMinutes();
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function alpha(color: string, opacity: number): string {
  const value = Number.parseInt(color.replace('#', '').slice(0, 6), 16);
  if (Number.isNaN(value)) return `rgba(138, 143, 156, ${opacity})`;
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

function readSelection(): string[] | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    return Array.isArray(value) ? value.map(String) : null;
  } catch {
    return null;
  }
}

function writeSelection(ids: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Pamięć przeglądarki niedostępna — wybór wróci do domyślnego.
  }
}

function initials(person: SchedulePerson) {
  const source = person.nickname.trim() || `${person.name} ${person.surname}`;
  return source.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

interface Selection {
  column: number;
  anchor: number;
  from: number;
  to: number;
}

export default function TeamAvailabilityView({
  day,
  refreshKey,
  onOpenMeeting,
  onOpenEvent,
  onCreate,
}: {
  day: Date;
  /** Zmienia się po zapisie spotkania — odświeża zajętość. */
  refreshKey: number;
  onOpenMeeting: (id: string) => void;
  onOpenEvent: (id: string) => void;
  /** Nowe spotkanie w zaznaczonym czasie z osobą z kolumny (bez siebie). */
  onCreate: (start: Date, end: Date, employeeIds: string[]) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [people, setPeople] = useState<SchedulePerson[]>([]);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSchedulePeople()
      .then((list) => {
        if (cancelled) return;
        setPeople(list);
        setPeopleError(null);
        const known = new Set(list.map((person) => person.id));
        const self = list.find((person) => person.isSelf);
        const stored = readSelection()?.filter((id) => known.has(id));
        if (stored && stored.length) {
          setSelected(stored.slice(0, MAX_PEOPLE));
        } else {
          // Domyślnie: ja i mój dział (najwyżej 8 osób).
          const mine = list.filter((person) => !person.isSelf && self && person.department === self.department).slice(0, 7);
          setSelected([...(self ? [self.id] : []), ...mine.map((person) => person.id)]);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setPeopleError(error instanceof Error ? error.message : 'Nie udało się wczytać pracowników.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const columns = useMemo(() => selected.map((id) => byId.get(id)).filter((person): person is SchedulePerson => !!person), [selected, byId]);
  const dayStart = useMemo(() => new Date(day.getFullYear(), day.getMonth(), day.getDate()), [day]);
  const dayEnd = useMemo(() => addDays(dayStart, 1), [dayStart]);
  const columnKey = columns.map((person) => person.id).join(',');

  const load = useCallback(async (quiet: boolean) => {
    if (!columnKey) {
      setBlocks([]);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      setBlocks(await fetchAvailability(columnKey.split(','), dayStart, dayEnd));
    } catch {
      if (!quiet) setBlocks([]);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [columnKey, dayStart, dayEnd]);

  useEffect(() => {
    void load(false);
  }, [load, refreshKey]);

  // Zmiany z innych urządzeń — co minutę i po powrocie do karty.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.clearInterval(timer);
    };
  }, [load]);

  // Przewiń do początku dnia pracy albo do „teraz”.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const today = sameDay(dayStart, new Date());
    element.scrollTop = (today ? Math.max(0, new Date().getHours() - 2) : WORK_START - 1) * HOUR;
  }, [dayStart]);

  const updateSelected = (next: string[]) => {
    const limited = next.slice(0, MAX_PEOPLE);
    setSelected(limited);
    writeSelection(limited);
  };

  const toggle = (id: string) => updateSelected(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  const selectDepartment = (department: Department) => {
    const ids = people.filter((person) => person.department === department).map((person) => person.id);
    updateSelected([...selected, ...ids.filter((id) => !selected.includes(id))]);
  };

  const allDayBlocks = useMemo(
    () => blocks.filter((block) => block.allDay || Date.parse(block.end) - Date.parse(block.start) >= 24 * 60 * 60 * 1000),
    [blocks],
  );
  const placed = useMemo(() => {
    const timed = blocks.filter((block) => !allDayBlocks.includes(block));
    return columns.map((person) =>
      layoutTimeline(
        timed
          .filter((block) => block.employeeId === person.id)
          .map((block, index) => {
            const start = new Date(block.start);
            const end = new Date(block.end);
            const from = start < dayStart ? 0 : minutesOfDay(start);
            const to = end >= dayEnd ? 24 * 60 : Math.max(from + SNAP, (end.getTime() - dayStart.getTime()) / 60000);
            return { key: `${block.kind}-${block.itemId ?? index}-${block.start}`, block, start: from, end: Math.min(24 * 60, to) };
          }),
      ),
    );
  }, [blocks, allDayBlocks, columns, dayStart, dayEnd]);

  const open = (block: AvailabilityBlock) => {
    if (!block.detailed || !block.itemId) return;
    if (block.kind === 'meeting') onOpenMeeting(block.itemId);
    else if (block.kind === 'event' || block.kind === 'phase') onOpenEvent(block.itemId);
  };

  // ── Zaznaczenie wolnego czasu → spotkanie z osobą z kolumny ───────────────────────────
  const slotAt = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = ((event.clientY - rect.top) / HOUR) * 60;
    return Math.max(0, Math.min(24 * 60 - SNAP, Math.floor(minute / SNAP) * SNAP));
  };
  const beginSelection = (event: React.PointerEvent<HTMLDivElement>, column: number) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const minute = slotAt(event);
    setSelection({ column, anchor: minute, from: minute, to: minute + SNAP });
  };
  const extendSelection = (event: React.PointerEvent<HTMLDivElement>, column: number) => {
    if (!selection || selection.column !== column) return;
    const minute = slotAt(event);
    setSelection({ ...selection, from: Math.min(selection.anchor, minute), to: Math.max(selection.anchor, minute) + SNAP });
  };
  const finishSelection = (column: number) => {
    if (!selection || selection.column !== column) return;
    const single = selection.to - selection.from <= SNAP;
    const from = single ? Math.floor(selection.from / 30) * 30 : selection.from;
    const to = single ? from + 60 : selection.to;
    setSelection(null);
    const person = columns[column];
    onCreate(
      new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 0, from),
      new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 0, to),
      person && !person.isSelf ? [person.id] : [],
    );
  };

  const query = search.trim().toLowerCase();
  const groups = peopleByDepartment(
    people.filter((person) => !query || `${schedulePersonName(person)} ${person.name} ${person.surname} ${person.occupation}`.toLowerCase().includes(query)),
  );
  const template = `${LABEL_WIDTH}px repeat(${Math.max(1, columns.length)}, minmax(${COLUMN_MIN}px, 1fr))`;
  const today = sameDay(dayStart, now);
  const nowMinute = minutesOfDay(now);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="relative flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPickerOpen((value) => !value)}
          className="flex items-center gap-2 rounded-lg bg-[#1c1f33] px-3 py-1.5 text-sm text-[#e5e4e2] hover:bg-[#22263d]"
        >
          <Users className="h-4 w-4 text-[#d3bb73]" />
          Osoby ({columns.length})
        </button>
        <span className="text-xs text-[#8a8f9c]">
          Zajętość w planie: spotkania, eventy i nieobecności. Spotkania prywatne innych osób — „Zajęty”. Zaznacz wolny czas w kolumnie,
          aby zaplanować spotkanie z tą osobą.
        </span>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" />}

        {pickerOpen && (
          <div className="absolute left-0 top-full z-40 mt-2 w-[min(420px,calc(100vw-2rem))] rounded-xl border border-[#d3bb73]/15 bg-[#0f1119] p-3 shadow-2xl">
            <div className="mb-2 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a8f9c]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Szukaj osoby…"
                  className="w-full rounded-lg bg-[#1c1f33] py-1.5 pl-8 pr-3 text-sm text-[#e5e4e2] outline-none"
                  autoFocus
                />
              </div>
              <button type="button" onClick={() => setPickerOpen(false)} className="rounded-lg p-1.5 text-[#8a8f9c] hover:bg-white/5" aria-label="Zamknij">
                <X className="h-4 w-4" />
              </button>
            </div>
            {peopleError && <p className="mb-2 text-xs text-red-300">{peopleError}</p>}
            <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
              {groups.map((group) => (
                <div key={group.department}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[#8a8f9c]">{group.label}</span>
                    <button type="button" onClick={() => selectDepartment(group.department)} className="text-xs text-[#d3bb73] hover:underline">
                      Cały dział
                    </button>
                  </div>
                  {group.people.map((person) => {
                    const checked = selected.includes(person.id);
                    return (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => toggle(person.id)}
                        disabled={!checked && selected.length >= MAX_PEOPLE}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-[#e5e4e2] hover:bg-white/5 disabled:opacity-40"
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-[#d3bb73] bg-[#d3bb73]' : 'border-white/25'}`}>
                          {checked && <Check className="h-3 w-3 text-[#13161f]" />}
                        </span>
                        <span className="truncate">{schedulePersonName(person)}{person.isSelf ? ' (Ty)' : ''}</span>
                        {person.isSubordinate && <span className="ml-auto shrink-0 text-[10px] text-[#d3bb73]/80">Podwładny</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
              {!groups.length && !peopleError && <p className="text-sm text-[#8a8f9c]">Brak osób do wyboru.</p>}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2 text-xs text-[#8a8f9c]">
              <span>Najwyżej {MAX_PEOPLE} osób naraz.</span>
              <button
                type="button"
                onClick={() => updateSelected(people.filter((person) => person.isSelf).map((person) => person.id))}
                className="text-[#d3bb73] hover:underline"
              >
                Tylko ja
              </button>
            </div>
          </div>
        )}
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto rounded-xl bg-[#13161f]">
        <div style={{ minWidth: LABEL_WIDTH + Math.max(1, columns.length) * COLUMN_MIN }}>
          {/* Nagłówek osób + całodniowe */}
          <div className="sticky top-0 z-30 bg-[#161929]/95 backdrop-blur">
            <div className="grid" style={{ gridTemplateColumns: template }}>
              <div />
              {columns.map((person) => (
                <div key={person.id} className="flex min-w-0 items-center gap-2 px-2 py-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#d3bb73]/15 text-xs font-semibold text-[#d3bb73]">
                    {person.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={person.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      initials(person)
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#e5e4e2]">{schedulePersonName(person)}{person.isSelf ? ' (Ty)' : ''}</p>
                    <p className="truncate text-[11px] text-[#8a8f9c]">{person.occupation || departmentLabel(person.department)}</p>
                  </div>
                </div>
              ))}
              {!columns.length && <p className="px-2 py-3 text-sm text-[#8a8f9c]">Wybierz osoby, których plan chcesz zobaczyć.</p>}
            </div>
            {allDayBlocks.length > 0 && (
              <div className="grid pb-1" style={{ gridTemplateColumns: template }}>
                <div className="pr-2 pt-1 text-right text-[10px] uppercase tracking-wide text-[#8a8f9c]">Cały dzień</div>
                {columns.map((person) => (
                  <div key={person.id} className="space-y-1 px-1">
                    {allDayBlocks.filter((block) => block.employeeId === person.id).map((block, index) => {
                      const color = availabilityColor(block);
                      return (
                        <button
                          key={`${block.kind}-${block.itemId ?? index}-${block.start}`}
                          type="button"
                          onClick={() => open(block)}
                          title={`${availabilityTitle(block)} · ${availabilityTime(block)}${block.subtitle ? ` · ${block.subtitle}` : ''}`}
                          className={`block w-full truncate rounded-md px-2 py-1 text-left text-xs text-[#e5e4e2] ${block.detailed && block.itemId ? '' : 'cursor-default'}`}
                          style={{
                            backgroundColor: alpha(color, block.tentative ? 0.14 : 0.28),
                            backgroundImage: block.tentative ? 'repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0 6px, transparent 6px 12px)' : undefined,
                            boxShadow: `inset 3px 0 0 ${color}`,
                          }}
                        >
                          {!block.detailed && <Lock className="mr-1 inline h-3 w-3" />}
                          {availabilityTitle(block)}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
            <div className="h-px bg-white/[0.06]" />
          </div>

          {/* Siatka godzin */}
          <div className="relative grid" style={{ gridTemplateColumns: template, height: 24 * HOUR }}>
            <div className="relative">
              {Array.from({ length: 24 }, (_, hour) => (
                <span key={hour} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-[#8a8f9c]" style={{ top: hour * HOUR }}>
                  {hour === 0 ? '' : `${pad(hour)}:00`}
                </span>
              ))}
            </div>
            {columns.map((person, columnIndex) => (
              <div
                key={person.id}
                className={`relative ${today ? 'bg-[#d3bb73]/[0.02]' : ''}`}
                style={{
                  backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), repeating-linear-gradient(to bottom, rgba(255,255,255,0.06) 0 1px, transparent 1px ${HOUR / 2}px, rgba(255,255,255,0.025) ${HOUR / 2}px ${HOUR / 2 + 1}px, transparent ${HOUR / 2 + 1}px ${HOUR}px)`,
                }}
                onPointerDown={(event) => beginSelection(event, columnIndex)}
                onPointerMove={(event) => extendSelection(event, columnIndex)}
                onPointerUp={() => finishSelection(columnIndex)}
                onPointerCancel={() => setSelection(null)}
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/[0.18]" style={{ height: WORK_START * HOUR }} />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/[0.18]" style={{ height: (24 - WORK_END) * HOUR }} />

                {selection && selection.column === columnIndex && (
                  <div
                    className="pointer-events-none absolute inset-x-1 rounded-md bg-[#d3bb73]/25"
                    style={{ top: (selection.from / 60) * HOUR, height: ((selection.to - selection.from) / 60) * HOUR }}
                  >
                    <span className="block px-2 py-1 text-[11px] font-medium text-[#e5e4e2]">
                      {pad(Math.floor(selection.from / 60))}:{pad(selection.from % 60)}–{pad(Math.floor(selection.to / 60) % 24)}:{pad(selection.to % 60)}
                    </span>
                  </div>
                )}

                {placed[columnIndex]?.map((item) => {
                  const { block } = item;
                  const color = availabilityColor(block);
                  const top = (item.start / 60) * HOUR;
                  const height = Math.max(18, ((item.end - item.start) / 60) * HOUR - 2);
                  const width = 100 / item.columns;
                  const compact = height < 38;
                  const clickable = block.detailed && !!block.itemId;
                  return (
                    <div
                      key={item.key}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={() => open(block)}
                      onKeyDown={(event) => {
                        if (clickable && (event.key === 'Enter' || event.key === ' ')) open(block);
                      }}
                      title={`${availabilityTitle(block)} · ${availabilityTime(block)}${block.subtitle ? ` · ${block.subtitle}` : ''}${
                        block.detailed ? ` · ${availabilityKindLabel(block.kind)}` : ''}${block.tentative ? ' · niepotwierdzone' : ''}`}
                      className={`absolute z-10 overflow-hidden rounded-md px-2 py-1 text-left text-[#e5e4e2] ${clickable ? 'cursor-pointer hover:z-20 hover:shadow-lg' : 'cursor-default'}`}
                      style={{
                        top,
                        height,
                        left: `calc(${item.column * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                        backgroundColor: alpha(color, block.tentative ? 0.14 : 0.28),
                        backgroundImage: block.tentative ? 'repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0 6px, transparent 6px 12px)' : undefined,
                        boxShadow: `inset 3px 0 0 ${color}`,
                      }}
                    >
                      <div className="flex items-center gap-1">
                        {!block.detailed && <Lock className="h-3 w-3 shrink-0 text-[#e5e4e2]/70" />}
                        <span className="truncate text-xs font-semibold">{availabilityTitle(block)}</span>
                        {compact && <span className="shrink-0 text-[11px] text-[#e5e4e2]/60">{availabilityTime(block)}</span>}
                      </div>
                      {!compact && <p className="truncate text-[11px] text-[#e5e4e2]/65">{availabilityTime(block)}{block.tentative ? ' · niepotwierdzone' : ''}</p>}
                      {!compact && height > 58 && block.subtitle && <p className="truncate text-[11px] text-[#e5e4e2]/50">{block.subtitle}</p>}
                    </div>
                  );
                })}

                {today && (
                  <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: (nowMinute / 60) * HOUR }}>
                    <div className="h-0.5 bg-[#ef4444]" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
