'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle, Loader2, Lock, MapPin, Repeat } from 'lucide-react';
import {
  layoutTimeline,
  meetingStatus,
  myMeetingResponse,
  type MeetingParticipantLike,
} from '@/lib/CRM/meetings/meetingStatus';

/** Spotkanie w osi czasu (dzień / tydzień roboczy / tydzień) — jak kalendarz w Teams. */
export interface TimelineMeeting {
  id: string;
  title: string;
  datetime_start: string;
  datetime_end: string | null;
  is_all_day: boolean | null;
  color: string | null;
  is_private?: boolean | null;
  status?: string | null;
  series_id?: string | null;
  created_by?: string | null;
  location_label?: string | null;
  participants?: MeetingParticipantLike[] | null;
}

interface MeetingsTimelineProps {
  days: Date[];
  meetings: TimelineMeeting[];
  employeeId: string | null;
  savingIds: ReadonlySet<string>;
  holidays?: ReadonlyMap<string, string>;
  canEdit: (meeting: TimelineMeeting) => boolean;
  onOpen: (meeting: TimelineMeeting) => void;
  onCreate: (start: Date, end: Date) => void;
  onMove: (meeting: TimelineMeeting, start: Date, end: Date) => void;
}

const HOUR = 52;
const SNAP = 15;
const LABEL_WIDTH = 56;
const WORK_START = 8;
const WORK_END = 18;

const timeFormatter = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const weekdayFormatter = new Intl.DateTimeFormat('pl-PL', { weekday: 'short' });

const pad = (value: number) => String(value).padStart(2, '0');
export const isoDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const sameDay = (a: Date, b: Date) => isoDay(a) === isoDay(b);
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const minutesOfDay = (date: Date) => date.getHours() * 60 + date.getMinutes();

function alpha(color: string | null | undefined, opacity: number): string {
  const hex = (color || '#d3bb73').replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6);
  const value = Number.parseInt(full, 16);
  if (Number.isNaN(value)) return `rgba(211, 187, 115, ${opacity})`;
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

function meetingEnd(meeting: TimelineMeeting): Date {
  const start = new Date(meeting.datetime_start);
  const end = meeting.datetime_end ? new Date(meeting.datetime_end) : new Date(start.getTime() + 60 * 60 * 1000);
  return end.getTime() > start.getTime() ? end : new Date(start.getTime() + 30 * 60 * 1000);
}

interface DragState {
  meeting: TimelineMeeting;
  mode: 'move' | 'resize';
  originX: number;
  originY: number;
  start: Date;
  end: Date;
  moved: boolean;
}

interface Selection {
  day: number;
  anchor: number;
  from: number;
  to: number;
}

export default function MeetingsTimeline({
  days,
  meetings,
  employeeId,
  savingIds,
  holidays,
  canEdit,
  onOpen,
  onCreate,
  onMove,
}: MeetingsTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<{ id: string; start: Date; end: Date } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const previewRef = useRef<{ id: string; start: Date; end: Date } | null>(null);

  const showPreview = (value: { id: string; start: Date; end: Date } | null) => {
    previewRef.current = value;
    setPreview(value);
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const showsToday = days.some((day) => sameDay(day, now));

  // Przewiń do początku dnia pracy (albo do „teraz”, gdy widać dzisiejszy dzień).
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const hour = showsToday ? Math.max(0, now.getHours() - 2) : WORK_START - 1;
    element.scrollTop = hour * HOUR;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDay?.getTime(), days.length]);

  const rangeStart = firstDay ? new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate()) : new Date();
  const rangeEnd = lastDay ? addDays(lastDay, 1) : new Date();

  const visible = useMemo(() => {
    return meetings
      .map((meeting) => {
        const override = preview && preview.id === meeting.id ? preview : null;
        const start = override ? override.start : new Date(meeting.datetime_start);
        const end = override ? override.end : meetingEnd(meeting);
        return { meeting, start, end };
      })
      .filter(({ start, end }) => start < rangeEnd && end > rangeStart);
  }, [meetings, preview, rangeStart.getTime(), rangeEnd.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const allDay = useMemo(
    () => visible.filter(({ meeting, start, end }) => meeting.is_all_day || end.getTime() - start.getTime() >= 24 * 60 * 60 * 1000),
    [visible],
  );

  const columns = useMemo(() => {
    return days.map((day) => {
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      const dayEnd = addDays(dayStart, 1);
      const segments = visible
        .filter((item) => !allDay.includes(item))
        .filter(({ start, end }) => start < dayEnd && end > dayStart)
        .map(({ meeting, start, end }) => {
          const segmentStart = start < dayStart ? 0 : minutesOfDay(start);
          const segmentEnd = end > dayEnd ? 24 * 60 : Math.max(segmentStart + SNAP, (end.getTime() - dayStart.getTime()) / 60000);
          return { id: meeting.id, meeting, start: segmentStart, end: Math.min(24 * 60, segmentEnd), realStart: start, realEnd: end };
        });
      return layoutTimeline(segments);
    });
  }, [days, visible, allDay]);

  // ── Przeciąganie i zmiana długości spotkań ──────────────────────────────────────────
  const columnWidth = useCallback(() => {
    const grid = gridRef.current;
    if (!grid || days.length === 0) return 1;
    return (grid.getBoundingClientRect().width - LABEL_WIDTH) / days.length;
  }, [days.length]);

  useEffect(() => {
    if (!drag) return;
    const handleMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const dx = event.clientX - current.originX;
      const dy = event.clientY - current.originY;
      if (!current.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      current.moved = true;
      const minutes = Math.round((dy / HOUR) * 60 / SNAP) * SNAP;
      if (current.mode === 'resize') {
        const end = new Date(current.end.getTime() + minutes * 60000);
        const minEnd = new Date(current.start.getTime() + SNAP * 60000);
        showPreview({ id: current.meeting.id, start: current.start, end: end < minEnd ? minEnd : end });
        return;
      }
      const dayShift = days.length > 1 ? Math.round(dx / columnWidth()) : 0;
      const start = new Date(current.start);
      start.setDate(start.getDate() + dayShift);
      start.setMinutes(start.getMinutes() + minutes);
      const end = new Date(start.getTime() + (current.end.getTime() - current.start.getTime()));
      showPreview({ id: current.meeting.id, start, end });
    };
    const handleUp = () => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!current) return;
      const value = previewRef.current;
      showPreview(null);
      if (!current.moved) {
        onOpen(current.meeting);
        return;
      }
      if (value && (value.start.getTime() !== current.start.getTime() || value.end.getTime() !== current.end.getTime())) {
        onMove(current.meeting, value.start, value.end);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      dragRef.current = null;
      setDrag(null);
      showPreview(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('keydown', handleKey);
    };
  }, [drag, days.length, columnWidth, onMove, onOpen]);

  const startDrag = (event: React.PointerEvent, meeting: TimelineMeeting, start: Date, end: Date, mode: 'move' | 'resize') => {
    event.stopPropagation();
    // Bez uprawnień do zmiany kliknięcie tylko otwiera szczegóły (onClick).
    if (event.button !== 0 || !canEdit(meeting) || savingIds.has(meeting.id) || meeting.is_all_day) return;
    event.preventDefault();
    const state: DragState = { meeting, mode, originX: event.clientX, originY: event.clientY, start, end, moved: false };
    dragRef.current = state;
    setDrag(state);
  };

  // ── Zaznaczenie wolnego czasu → nowe spotkanie ───────────────────────────────────────
  const slotAt = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = ((event.clientY - rect.top) / HOUR) * 60;
    return Math.max(0, Math.min(24 * 60 - SNAP, Math.floor(minute / SNAP) * SNAP));
  };

  const beginSelection = (event: React.PointerEvent<HTMLDivElement>, day: number) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const minute = slotAt(event);
    setSelection({ day, anchor: minute, from: minute, to: minute + SNAP });
  };

  const extendSelection = (event: React.PointerEvent<HTMLDivElement>, day: number) => {
    if (!selection || selection.day !== day) return;
    const minute = slotAt(event);
    setSelection({
      ...selection,
      from: Math.min(selection.anchor, minute),
      to: Math.max(selection.anchor, minute) + SNAP,
    });
  };

  const finishSelection = (day: number) => {
    if (!selection || selection.day !== day) return;
    const base = days[day];
    const single = selection.to - selection.from <= SNAP;
    const from = single ? Math.floor(selection.from / 30) * 30 : selection.from;
    const to = single ? from + 60 : selection.to;
    setSelection(null);
    onCreate(
      new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, from),
      new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, to),
    );
  };

  const template = `${LABEL_WIDTH}px repeat(${days.length}, minmax(0, 1fr))`;
  const nowMinute = minutesOfDay(now);

  return (
    <div
      ref={scrollRef}
      className={`relative h-full overflow-y-auto overflow-x-hidden rounded-xl bg-[#13161f] ${drag ? 'select-none' : ''}`}
      style={{ cursor: drag ? (drag.mode === 'resize' ? 'ns-resize' : 'grabbing') : undefined }}
    >
      {/* Nagłówek dni + spotkania całodniowe */}
      <div className="sticky top-0 z-30 bg-[#161929]/95 backdrop-blur">
        <div className="grid" style={{ gridTemplateColumns: template }}>
          <div />
          {days.map((day) => {
            const today = sameDay(day, now);
            const weekend = day.getDay() === 0 || day.getDay() === 6;
            const holiday = holidays?.get(isoDay(day));
            return (
              <div key={isoDay(day)} className={`px-2 py-2 ${weekend || holiday ? 'bg-white/[0.02]' : ''}`}>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`flex h-8 min-w-[2rem] items-center justify-center rounded-full px-1.5 text-lg font-semibold ${
                      today ? 'bg-[#d3bb73] text-[#13161f]' : 'text-[#e5e4e2]'
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  <span className={`text-xs uppercase tracking-wide ${today ? 'text-[#d3bb73]' : 'text-[#8a8f9c]'}`}>
                    {weekdayFormatter.format(day)}
                  </span>
                </div>
                {holiday && <p className="mt-0.5 truncate text-[11px] text-red-300/80" title={holiday}>{holiday}</p>}
              </div>
            );
          })}
        </div>
        {allDay.length > 0 && (
          <div className="grid pb-1" style={{ gridTemplateColumns: template }}>
            <div className="pr-2 pt-1 text-right text-[10px] uppercase tracking-wide text-[#8a8f9c]">Cały dzień</div>
            {days.map((day) => {
              const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
              const dayEnd = addDays(dayStart, 1);
              return (
                <div key={isoDay(day)} className="space-y-1 px-1">
                  {allDay
                    .filter(({ start, end }) => start < dayEnd && end > dayStart)
                    .map(({ meeting }) => (
                      <button
                        key={meeting.id}
                        type="button"
                        onClick={() => onOpen(meeting)}
                        className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-[#e5e4e2]"
                        style={{ backgroundColor: alpha(meeting.color, 0.28), boxShadow: `inset 3px 0 0 ${meeting.color || '#d3bb73'}` }}
                      >
                        {meeting.is_private && <Lock className="mr-1 inline h-3 w-3" />}
                        {meeting.title}
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        )}
        <div className="h-px bg-white/[0.06]" />
      </div>

      {/* Siatka godzin */}
      <div ref={gridRef} className="relative grid" style={{ gridTemplateColumns: template, height: 24 * HOUR }}>
        <div className="relative">
          {Array.from({ length: 24 }, (_, hour) => (
            <span
              key={hour}
              className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-[#8a8f9c]"
              style={{ top: hour * HOUR }}
            >
              {hour === 0 ? '' : `${pad(hour)}:00`}
            </span>
          ))}
        </div>

        {days.map((day, dayIndex) => {
          const today = sameDay(day, now);
          const weekend = day.getDay() === 0 || day.getDay() === 6 || holidays?.has(isoDay(day));
          return (
            <div
              key={isoDay(day)}
              className={`relative ${today ? 'bg-[#d3bb73]/[0.035]' : weekend ? 'bg-white/[0.015]' : ''}`}
              style={{
                backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), repeating-linear-gradient(to bottom, rgba(255,255,255,0.06) 0 1px, transparent 1px ${HOUR / 2}px, rgba(255,255,255,0.025) ${HOUR / 2}px ${HOUR / 2 + 1}px, transparent ${HOUR / 2 + 1}px ${HOUR}px)`,
              }}
              onPointerDown={(event) => beginSelection(event, dayIndex)}
              onPointerMove={(event) => extendSelection(event, dayIndex)}
              onPointerUp={() => finishSelection(dayIndex)}
              onPointerCancel={() => setSelection(null)}
            >
              {/* Poza godzinami pracy */}
              <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/[0.18]" style={{ height: WORK_START * HOUR }} />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/[0.18]" style={{ height: (24 - WORK_END) * HOUR }} />

              {selection && selection.day === dayIndex && (
                <div
                  className="pointer-events-none absolute inset-x-1 rounded-md bg-[#d3bb73]/25"
                  style={{ top: (selection.from / 60) * HOUR, height: ((selection.to - selection.from) / 60) * HOUR }}
                >
                  <span className="block px-2 py-1 text-[11px] font-medium text-[#e5e4e2]">
                    {pad(Math.floor(selection.from / 60))}:{pad(selection.from % 60)}–{pad(Math.floor(selection.to / 60) % 24)}:{pad(selection.to % 60)}
                  </span>
                </div>
              )}

              {columns[dayIndex].map((item) => {
                const { meeting } = item;
                const status = meetingStatus(meeting.status);
                const mine = myMeetingResponse(meeting, employeeId);
                const cancelled = status === 'cancelled';
                const declined = mine === 'declined';
                const hatched = status === 'tentative' || mine === 'tentative';
                const pending = mine === 'pending' && !cancelled;
                const top = (item.start / 60) * HOUR;
                const height = Math.max(18, ((item.end - item.start) / 60) * HOUR - 2);
                const width = 100 / item.columns;
                const color = meeting.color || '#d3bb73';
                const dragging = preview?.id === meeting.id;
                const saving = savingIds.has(meeting.id);
                const editable = canEdit(meeting) && !meeting.is_all_day;
                const compact = height < 38;
                const continues = item.realEnd.getTime() - (new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() + item.end * 60000) > 0;
                return (
                  <div
                    key={`${meeting.id}-${dayIndex}`}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') onOpen(meeting);
                    }}
                    onPointerDown={(event) => startDrag(event, meeting, item.realStart, item.realEnd, 'move')}
                    onClick={() => {
                      if (!editable || saving) onOpen(meeting);
                    }}
                    title={`${meeting.title} · ${timeFormatter.format(item.realStart)}–${timeFormatter.format(item.realEnd)}`}
                    className={`group absolute overflow-hidden rounded-md px-2 py-1 text-left text-[#e5e4e2] transition-shadow ${
                      editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                    } ${dragging ? 'z-20 shadow-2xl ring-1 ring-[#d3bb73]/60' : 'z-10 hover:z-20 hover:shadow-lg'} ${
                      cancelled || declined ? 'opacity-55' : ''
                    }`}
                    style={{
                      top,
                      height,
                      left: `calc(${item.column * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                      backgroundColor: alpha(color, pending ? 0.1 : cancelled || declined ? 0.12 : 0.26),
                      backgroundImage: hatched
                        ? 'repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0 6px, transparent 6px 12px)'
                        : undefined,
                      boxShadow: `inset 3px 0 0 ${color}`,
                    }}
                  >
                    <div className={`flex items-center gap-1 ${compact ? '' : 'mb-0.5'}`}>
                      {meeting.is_private && <Lock className="h-3 w-3 shrink-0 text-[#e5e4e2]/80" />}
                      {pending && <HelpCircle className="h-3 w-3 shrink-0 text-[#d3bb73]" />}
                      {meeting.series_id && !compact && <Repeat className="h-3 w-3 shrink-0 text-[#e5e4e2]/50" />}
                      <span className={`truncate text-xs font-semibold ${cancelled || declined ? 'line-through' : ''}`}>
                        {meeting.title}
                      </span>
                      {compact && (
                        <span className="shrink-0 text-[11px] text-[#e5e4e2]/60">{timeFormatter.format(item.realStart)}</span>
                      )}
                      {saving && <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin text-[#d3bb73]" />}
                    </div>
                    {!compact && (
                      <p className="truncate text-[11px] text-[#e5e4e2]/65">
                        {timeFormatter.format(item.realStart)}–{timeFormatter.format(item.realEnd)}
                        {cancelled ? ' · Odwołane' : status === 'tentative' ? ' · Wstępne' : ''}
                        {!cancelled && declined ? ' · Odrzucone' : ''}
                        {!cancelled && pending ? ' · Odpowiedz' : ''}
                      </p>
                    )}
                    {!compact && height > 58 && meeting.location_label && (
                      <p className="flex items-center gap-1 truncate text-[11px] text-[#e5e4e2]/50">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{meeting.location_label}</span>
                      </p>
                    )}
                    {editable && !continues && (
                      <div
                        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100"
                        onPointerDown={(event) => startDrag(event, meeting, item.realStart, item.realEnd, 'resize')}
                      >
                        <div className="mx-auto mt-0.5 h-1 w-8 rounded-full bg-[#e5e4e2]/40" />
                      </div>
                    )}
                  </div>
                );
              })}

              {today && (
                <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: (nowMinute / 60) * HOUR }}>
                  <div className="relative h-0.5 bg-[#ef4444]">
                    <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-[#ef4444]" />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
