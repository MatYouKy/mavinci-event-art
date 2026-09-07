export const DAY_MS = 24 * 60 * 60 * 1000;

export type TimelineBounds = { start: Date; end: Date };

export function startOfLocalDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function addLocalDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

export function getWeekBounds(value: Date): TimelineBounds {
  const start = startOfLocalDay(value);
  const weekday = start.getDay();
  start.setDate(start.getDate() - (weekday === 0 ? 6 : weekday - 1));
  return { start, end: addLocalDays(start, 7) };
}

export function getFleetTimelineScale(
  currentDate: Date,
  zoom: 'day' | 'week' | 'month',
) {
  const anchor = startOfLocalDay(currentDate);
  const before = zoom === 'day' ? 3 : zoom === 'week' ? 14 : 30;
  const days = zoom === 'day' ? 7 : zoom === 'week' ? 28 : 90;
  const columnWidth = zoom === 'day' ? 120 : zoom === 'week' ? 60 : 30;
  const start = addLocalDays(anchor, -before);
  const end = addLocalDays(start, days);

  return {
    start,
    end,
    days,
    columnWidth,
    totalWidth: days * columnWidth,
    columns: Array.from({ length: days }, (_, index) => addLocalDays(start, index)),
  };
}

export function getClippedTimelinePosition(
  itemStart: Date,
  itemEnd: Date,
  bounds: TimelineBounds,
  size: number,
  minimumSize = 2,
): { offset: number; size: number } | null {
  const boundsStart = bounds.start.getTime();
  const boundsEnd = bounds.end.getTime();
  const start = Math.max(itemStart.getTime(), boundsStart);
  const rawEnd = itemEnd.getTime();
  const end = Math.min(rawEnd > itemStart.getTime() ? rawEnd : itemStart.getTime() + 1, boundsEnd);

  if (start >= boundsEnd || end <= boundsStart || end <= start) return null;

  const duration = boundsEnd - boundsStart;
  const offset = ((start - boundsStart) / duration) * size;
  return { offset, size: Math.min(size - offset, Math.max(minimumSize, ((end - start) / duration) * size)) };
}

export function isWithinBounds(value: Date, bounds: TimelineBounds): boolean {
  const time = value.getTime();
  return time >= bounds.start.getTime() && time < bounds.end.getTime();
}

export function generateTimeMarkers(
  bounds: TimelineBounds,
  zoom: 'days' | 'hours' | 'quarter_hours',
  availableWidth?: number,
): Date[] {
  const interval = getTimeMarkerInterval(bounds, zoom, availableWidth);
  const dayStart = startOfLocalDay(bounds.start).getTime();
  const startTime = bounds.start.getTime();
  const alignedTime = dayStart + Math.ceil((startTime - dayStart) / interval) * interval;
  const current = new Date(alignedTime);

  const markers: Date[] = [];
  while (current <= bounds.end) {
    markers.push(new Date(current));
    current.setTime(current.getTime() + interval);
  }
  return markers;
}

const TIME_MARKER_INTERVALS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
  2 * 60 * 60 * 1000,
  3 * 60 * 60 * 1000,
  4 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
  DAY_MS,
  2 * DAY_MS,
  7 * DAY_MS,
  14 * DAY_MS,
  30 * DAY_MS,
];

export function getTimeMarkerInterval(
  bounds: TimelineBounds,
  zoom: 'days' | 'hours' | 'quarter_hours',
  availableWidth = 1200,
): number {
  const duration = Math.max(1, bounds.end.getTime() - bounds.start.getTime());
  const minimumSpacing = zoom === 'quarter_hours' ? 42 : zoom === 'hours' ? 58 : 88;
  const maximumMarkers = Math.max(2, Math.floor(availableWidth / minimumSpacing));
  const minimumInterval =
    zoom === 'quarter_hours'
      ? 5 * 60 * 1000
      : zoom === 'hours'
        ? 15 * 60 * 1000
        : 60 * 60 * 1000;

  return (
    TIME_MARKER_INTERVALS.find(
      (interval) => interval >= minimumInterval && duration / interval <= maximumMarkers,
    ) || TIME_MARKER_INTERVALS[TIME_MARKER_INTERVALS.length - 1]
  );
}
