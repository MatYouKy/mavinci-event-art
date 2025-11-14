import { CalendarEvent } from './types';

export const getDaysInMonth = (date: Date): (Date | null)[] => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const days: (Date | null)[] = [];

  for (let i = 0; i < (startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1); i++) {
    days.push(null);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    days.push(new Date(year, month, day));
  }

  return days;
};

export const getWeekDays = (date: Date): Date[] => {
  const currentDay = date.getDay();
  const monday = new Date(date);
  const diff = currentDay === 0 ? -6 : 1 - currentDay;
  monday.setDate(date.getDate() + diff);

  const weekDays: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    weekDays.push(day);
  }

  return weekDays;
};

export const getEventsForDate = (date: Date, events: CalendarEvent[]): CalendarEvent[] => {
  return events.filter((event) => {
    const eventDate = new Date(event.event_date);
    return (
      eventDate.getDate() === date.getDate() &&
      eventDate.getMonth() === date.getMonth() &&
      eventDate.getFullYear() === date.getFullYear()
    );
  });
};

export const getEventsForDateRange = (
  startDate: Date,
  endDate: Date,
  events: CalendarEvent[],
): CalendarEvent[] => {
  return events.filter((event) => {
    const eventStart = new Date(event.event_date);
    const eventEnd = event.event_end_date ? new Date(event.event_end_date) : eventStart;

    return (
      (eventStart >= startDate && eventStart <= endDate) ||
      (eventEnd >= startDate && eventEnd <= endDate) ||
      (eventStart <= startDate && eventEnd >= endDate)
    );
  });
};

export const isSameDay = (date1: Date, date2: Date): boolean => {
  return (
    date1.getDate() === date2.getDate() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getFullYear() === date2.getFullYear()
  );
};

export const isToday = (date: Date): boolean => {
  return isSameDay(date, new Date());
};

export const formatTime = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
};

export const formatDate = (date: Date | string, options?: Intl.DateTimeFormatOptions): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('pl-PL', options);
};

export const formatDateRange = (
  startDate: Date | string,
  endDate?: Date | string | null,
): string => {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;

  if (!endDate) {
    return formatDate(start, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const end = typeof endDate === 'string' ? new Date(endDate) : endDate;

  if (isSameDay(start, end)) {
    return `${formatDate(start, { day: 'numeric', month: 'short' })} ${formatTime(start)} - ${formatTime(end)}`;
  }

  return `${formatDate(start, { day: 'numeric', month: 'short' })} - ${formatDate(end, { day: 'numeric', month: 'short' })}`;
};

export const getEventDuration = (event: CalendarEvent): number => {
  const start = new Date(event.event_date);
  const end = event.event_end_date ? new Date(event.event_end_date) : start;
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60));
};

export const getEventPosition = (event: CalendarEvent): { top: number; height: number } => {
  const startDate = new Date(event.event_date);
  const startHour = startDate.getHours();
  const startMinute = startDate.getMinutes();
  const duration = getEventDuration(event);

  const top = (startHour + startMinute / 60) * 60;
  const height = Math.max(duration * 60, 30);

  return { top, height };
};
