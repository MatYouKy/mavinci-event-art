'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarClock, Loader2, RefreshCw } from 'lucide-react';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import {
  SCHEDULE_KIND_LABELS,
  addDays,
  assignLanes,
  capitalizeFirst,
  fetchEmployeeSchedule,
  formatItemTime,
  formatTime,
  isSameDay,
  itemBackground,
  itemTooltip,
  startOfDay,
  type ScheduleItem,
} from '@/lib/employees/employeeSchedule';

/*
 * „Mój plan” na pulpicie: dzisiejszy dzień (i opcjonalnie dwa kolejne) na poziomej osi czasu —
 * wydarzenia, fazy, spotkania, kontakty w zapytaniach, zadania, oddzwonienia i nieobecności pracownika.
 * Dane: get_employee_schedule (to samo co oś czasu w profilu pracownika, docs/employee-schedule.md).
 * Na wąskim ekranie — lista godzin zamiast osi.
 */

type DaysOption = 1 | 3;
const STORAGE_KEY = 'crm.dashboard.myPlan.days';
const LANE_HEIGHT = 46;
/** Krótkie pozycje (np. 15-minutowe oddzwonienie) rysujemy jak godzinne, żeby tytuł był czytelny. */
const MIN_VISUAL_MINUTES = 60;
const DEFAULT_FROM_HOUR = 8;
const DEFAULT_TO_HOUR = 18;

const readDays = (): DaysOption | null => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === '1' ? 1 : value === '3' ? 3 : null;
  } catch {
    return null;
  }
};
const storeDays = (value: DaysOption) => {
  try { window.localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* tryb prywatny */ }
};

/** Minuty od północy dnia (czas lokalny; poprawnie także w dni zmiany czasu). */
const minutesInDay = (t: number, dayStart: number, dayEnd: number) => {
  if (t <= dayStart) return 0;
  if (t >= dayEnd) return 24 * 60;
  const date = new Date(t);
  return date.getHours() * 60 + date.getMinutes();
};

const dayLabel = (day: Date, today: Date) => {
  if (isSameDay(day, today)) return 'Dziś';
  if (isSameDay(day, addDays(today, 1))) return 'Jutro';
  return capitalizeFirst(day.toLocaleDateString('pl-PL', { weekday: 'long' }));
};

type DayRow = {
  start: number;
  end: number;
  date: Date;
  timed: { item: ScheduleItem; from: number; to: number }[];
  allDay: ScheduleItem[];
};

export default function MyDayTimeline({ employeeId: employeeIdProp }: { employeeId?: string }) {
  const router = useRouter();
  const { employee } = useCurrentEmployee();
  const employeeId = employeeIdProp || employee?.id || null;
  const [days, setDays] = useState<DaysOption>(3);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const stored = readDays();
    if (stored) setDays(stored);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const today = useMemo(() => startOfDay(now), [now]);
  const todayKey = today.getTime();

  useEffect(() => {
    if (!employeeId) return;
    let active = true;
    setLoading(true);
    setError(null);
    fetchEmployeeSchedule([employeeId], new Date(todayKey), addDays(todayKey, 3))
      .then((result) => { if (active) setItems(result.items.filter((item) => item.employee_id === employeeId)); })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Nie udało się wczytać planu.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [employeeId, todayKey, reload]);

  const changeDays = useCallback((value: DaysOption) => {
    setDays(value);
    storeDays(value);
  }, []);

  const rows = useMemo<DayRow[]>(() => Array.from({ length: days }, (_, index) => {
    const date = addDays(todayKey, index);
    const start = date.getTime();
    const end = addDays(date, 1).getTime();
    const dayItems = items.filter((item) => item.start < end && item.end > start);
    return {
      start,
      end,
      date,
      allDay: dayItems.filter((item) => item.all_day).sort((a, b) => a.start - b.start),
      timed: dayItems
        .filter((item) => !item.all_day)
        .map((item) => ({ item, from: minutesInDay(item.start, start, end), to: minutesInDay(item.end, start, end) }))
        .sort((a, b) => a.from - b.from),
    };
  }), [days, items, todayKey]);

  // Zakres godzin: zwykły dzień pracy, poszerzony o pozycje wcześniejsze lub późniejsze.
  const [fromHour, toHour] = useMemo(() => {
    const timed = rows.flatMap((row) => row.timed);
    let from = DEFAULT_FROM_HOUR;
    let to = DEFAULT_TO_HOUR;
    for (const entry of timed) {
      from = Math.min(from, Math.floor(entry.from / 60));
      to = Math.max(to, Math.ceil(Math.max(entry.to, entry.from + 30) / 60));
    }
    const nowMinutes = minutesInDay(now, todayKey, addDays(todayKey, 1).getTime());
    if (rows.length && timed.length === 0) {
      from = Math.min(from, Math.floor(nowMinutes / 60));
      to = Math.max(to, Math.ceil(nowMinutes / 60));
    }
    return [Math.max(0, from), Math.min(24, Math.max(to, from + 6))];
  }, [rows, now, todayKey]);

  const span = (toHour - fromHour) * 60;
  const percent = (minutes: number) => ((Math.min(Math.max(minutes, fromHour * 60), toHour * 60) - fromHour * 60) / span) * 100;
  const hours = Array.from({ length: toHour - fromHour + 1 }, (_, index) => fromHour + index);
  const nowMinutes = minutesInDay(now, todayKey, addDays(todayKey, 1).getTime());
  const nowVisible = nowMinutes >= fromHour * 60 && nowMinutes <= toHour * 60;
  const total = rows.reduce((sum, row) => sum + row.timed.length + row.allDay.length, 0);
  const todayCount = rows[0] ? rows[0].timed.length + rows[0].allDay.length : 0;

  const open = (item: ScheduleItem) => { if (item.url) router.push(item.url); };
  const fullPlanHref = employeeId ? `/crm/employees/${employeeId}?tab=timeline` : '/crm/calendar';

  const gridBackground = {
    backgroundImage: `repeating-linear-gradient(to right, rgba(229,228,226,0.06) 0 1px, transparent 1px calc(100% / ${toHour - fromHour}))`,
  };

  return (
    <section aria-label="Mój plan" className="rounded-xl bg-[#1c1f33] p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-lg bg-[#d3bb73]/10 p-2"><CalendarClock className="h-5 w-5 text-[#d3bb73]" /></div>
          <div className="min-w-0">
            <h2 className="text-base uppercase tracking-wide text-[#e5e4e2]">Mój plan</h2>
            <p className="text-xs text-[#e5e4e2]/55">
              {capitalizeFirst(today.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }))}
              {!loading && !error && ` · dziś ${todayCount === 0 ? 'nic nie zaplanowano' : `${todayCount} ${todayCount === 1 ? 'pozycja' : todayCount < 5 ? 'pozycje' : 'pozycji'}`}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Zakres planu" className="flex rounded-lg bg-[#0f1119] p-0.5 text-xs">
            {([1, 3] as DaysOption[]).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={days === value}
                onClick={() => changeDays(value)}
                className={`rounded-md px-3 py-1.5 transition-colors ${days === value ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}
              >
                {value === 1 ? 'Dziś' : '3 dni'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setReload((value) => value + 1)}
            disabled={loading}
            title="Odśwież plan"
            aria-label="Odśwież plan"
            className="rounded-lg p-2 text-[#e5e4e2]/50 transition-colors hover:bg-white/5 hover:text-[#e5e4e2] disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
          <Link href={fullPlanHref} className="rounded-lg px-3 py-1.5 text-xs text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10">
            Pełny plan
          </Link>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-amber-400/10 p-3 text-sm text-amber-200">{error}</p>
      ) : loading && items.length === 0 ? (
        <div className="h-24 animate-pulse rounded-lg bg-[#0f1119]" />
      ) : total === 0 ? (
        <p className="rounded-lg bg-[#0f1119] px-4 py-3 text-sm text-[#e5e4e2]/60">
          {days === 1 ? 'Na dziś nic nie zaplanowano.' : 'Na dziś i dwa kolejne dni nic nie zaplanowano.'}
        </p>
      ) : (
        <>
          {/* Oś czasu — komputer i tablet */}
          <div className="hidden sm:block">
            <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-x-3">
              <div />
              <div className="relative mx-1.5 h-6 text-[11px] text-[#e5e4e2]/45">
                {hours.map((hour, index) => (
                  <span
                    key={hour}
                    className={`absolute -translate-x-1/2 ${index === 0 ? 'translate-x-0' : ''} ${index === hours.length - 1 ? '-translate-x-full' : ''} ${(hour - fromHour) % 2 === 1 ? 'hidden lg:inline' : ''}`}
                    style={{ left: `${((hour - fromHour) / (toHour - fromHour)) * 100}%` }}
                  >
                    {String(hour).padStart(2, '0')}:00
                  </span>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              {rows.map((row, rowIndex) => {
                const lanes = assignLanes(
                  row.timed.map((entry) => ({ ...entry, start: entry.from, end: Math.max(entry.to, entry.from + MIN_VISUAL_MINUTES) })),
                  MIN_VISUAL_MINUTES,
                );
                const laneCount = Math.max(1, ...lanes.map((entry) => entry.lane + 1));
                const isToday = rowIndex === 0;
                return (
                  <div key={row.start} className="grid grid-cols-[112px_minmax(0,1fr)] gap-x-3">
                    <div className="pt-1">
                      <p className={`text-sm ${isToday ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'}`}>{dayLabel(row.date, today)}</p>
                      <p className="text-xs text-[#e5e4e2]/45">
                        {row.date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                    <div className="min-w-0 rounded-lg bg-[#0f1119] p-1.5">
                      {row.allDay.length > 0 && (
                        <div className="mb-1.5 flex flex-wrap gap-1.5">
                          {row.allDay.map((item) => (
                            <button
                              key={`${item.kind}-${item.item_id}`}
                              type="button"
                              onClick={() => open(item)}
                              title={itemTooltip(item)}
                              className="flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-[#e5e4e2] transition-opacity hover:opacity-80"
                              style={{ background: itemBackground(item, '40') }}
                            >
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.color }} />
                              <span className="truncate">{item.title}</span>
                              <span className="shrink-0 text-[#e5e4e2]/50">· {formatItemTime(item)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div
                        className="relative rounded-md"
                        style={{ ...gridBackground, height: laneCount * LANE_HEIGHT }}
                      >
                        {row.timed.length === 0 && (
                          <p className="absolute inset-0 flex items-center px-3 text-xs text-[#e5e4e2]/35">
                            {row.allDay.length ? 'Bez spotkań o określonej godzinie' : 'Nic nie zaplanowano'}
                          </p>
                        )}
                        {lanes.map(({ item: entry, lane }) => {
                          const left = percent(entry.from);
                          const width = Math.max(percent(Math.max(entry.to, entry.from + MIN_VISUAL_MINUTES)) - left, 0.8);
                          const past = entry.item.end <= now;
                          const compact = (Math.max(entry.to, entry.from + MIN_VISUAL_MINUTES) - entry.from) / span < 0.05;
                          return (
                            <button
                              key={`${entry.item.kind}-${entry.item.item_id}-${entry.from}`}
                              type="button"
                              onClick={() => open(entry.item)}
                              title={itemTooltip(entry.item)}
                              className={`absolute flex flex-col justify-center overflow-hidden rounded-md pl-2.5 pr-2 text-left transition-opacity hover:opacity-90 ${past ? 'opacity-50' : ''}`}
                              style={{
                                left: `${left}%`,
                                width: `${width}%`,
                                top: lane * LANE_HEIGHT + 2,
                                height: LANE_HEIGHT - 4,
                                background: itemBackground(entry.item, '55'),
                              }}
                            >
                              <span className="absolute inset-y-1 left-1 w-[3px] rounded-full" style={{ background: entry.item.color }} />
                              <span className="truncate text-xs font-medium text-[#e5e4e2]">{entry.item.title}</span>
                              {!compact && (
                                <span className="truncate text-[11px] text-[#e5e4e2]/60">
                                  {formatTime(entry.item.start)}–{formatTime(entry.item.end)} · {SCHEDULE_KIND_LABELS[entry.item.kind]}
                                </span>
                              )}
                            </button>
                          );
                        })}
                        {isToday && nowVisible && (
                          <div
                            aria-hidden
                            className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-400"
                            style={{ left: `${percent(nowMinutes)}%` }}
                          >
                            <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-red-400" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Lista godzin — telefon */}
          <div className="space-y-4 sm:hidden">
            {rows.map((row, rowIndex) => (
              <div key={row.start}>
                <p className={`mb-2 text-sm ${rowIndex === 0 ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'}`}>
                  {dayLabel(row.date, today)} · {row.date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}
                </p>
                {row.allDay.length + row.timed.length === 0 ? (
                  <p className="text-xs text-[#e5e4e2]/40">Nic nie zaplanowano</p>
                ) : (
                  <ul className="space-y-1.5">
                    {[...row.allDay.map((item) => ({ item, time: formatItemTime(item) })),
                      ...row.timed.map(({ item }) => ({ item, time: `${formatTime(item.start)}–${formatTime(item.end)}` }))]
                      .map(({ item, time }) => (
                        <li key={`${item.kind}-${item.item_id}-${item.start}`}>
                          <button
                            type="button"
                            onClick={() => open(item)}
                            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${item.end <= now ? 'opacity-50' : ''}`}
                            style={{ background: itemBackground(item, '30') }}
                          >
                            <span className="w-24 shrink-0 text-xs text-[#e5e4e2]/70">{time}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-[#e5e4e2]">{item.title}</span>
                              <span className="block truncate text-[11px] text-[#e5e4e2]/50">{SCHEDULE_KIND_LABELS[item.kind]}{item.subtitle ? ` · ${item.subtitle}` : ''}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
