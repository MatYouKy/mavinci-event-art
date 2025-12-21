'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Clock, MapPin, Building2, Tag } from 'lucide-react';
import { CalendarEvent } from './types';
import { STATUS_COLORS, STATUS_LABELS, DAYS_OF_WEEK_SHORT } from './constants';

interface MobileCalendarViewProps {
  events: CalendarEvent[];
  currentDate: Date;
  onDateChange: (direction: 'prev' | 'next') => void;
}

export default function MobileCalendarView({
  events,
  currentDate,
  onDateChange,
}: MobileCalendarViewProps) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = (firstDay.getDay() + 6) % 7;

    const days: (Date | null)[] = [];

    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }

    return days;
  };

  const days = getDaysInMonth(currentDate);

  const getEventsForDate = (date: Date): CalendarEvent[] => {
    return events.filter((event) => {
      const eventDate = new Date(event.event_date);
      return (
        eventDate.getDate() === date.getDate() &&
        eventDate.getMonth() === date.getMonth() &&
        eventDate.getFullYear() === date.getFullYear()
      );
    });
  };

  const eventsForSelectedDate = useMemo(() => {
    return getEventsForDate(selectedDate);
  }, [selectedDate, events]);

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const isSameDay = (date1: Date, date2: Date) => {
    return (
      date1.getDate() === date2.getDate() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getFullYear() === date2.getFullYear()
    );
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleEventClick = (event: CalendarEvent) => {
    if ((event as any).is_meeting) {
      alert(
        `Spotkanie: ${event.name}\n\nData: ${new Date(event.event_date).toLocaleString('pl-PL')}\nLokalizacja: ${event.location || 'Brak'}\n\nNotatki: ${(event as any).meeting_data?.notes || 'Brak'}`,
      );
    } else {
      router.push(`/crm/events/${event.id}`);
    }
  };

  const selectedDateFormatted = selectedDate.toLocaleDateString('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="flex h-[calc(100vh-180px)] flex-col">
      <div className="flex-shrink-0 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-4">
          <button
            onClick={() => onDateChange('prev')}
            className="rounded-lg p-2 text-[#e5e4e2] transition-colors hover:bg-[#0f1119]"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h3 className="text-lg font-light text-[#e5e4e2]">
            {currentDate.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })}
          </h3>
          <button
            onClick={() => onDateChange('next')}
            className="rounded-lg p-2 text-[#e5e4e2] transition-colors hover:bg-[#0f1119]"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 border-b border-[#d3bb73]/10">
          {DAYS_OF_WEEK_SHORT.map((day) => (
            <div
              key={day}
              className="p-2 text-center text-xs font-medium text-[#d3bb73]/70"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((date, index) => {
            if (!date) {
              return <div key={index} className="h-12 bg-[#0f1119]/30" />;
            }

            const dayEvents = getEventsForDate(date);
            const today = isToday(date);
            const selected = isSameDay(date, selectedDate);

            return (
              <button
                key={index}
                onClick={() => setSelectedDate(date)}
                className={`relative h-12 border border-[#d3bb73]/5 p-2 transition-all ${
                  selected
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : today
                      ? 'bg-[#d3bb73]/20 text-[#e5e4e2]'
                      : 'bg-[#0f1119] text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10'
                }`}
              >
                <div className="text-sm">{date.getDate()}</div>
                {dayEvents.length > 0 && (
                  <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5">
                    {dayEvents.slice(0, 3).map((event, idx) => (
                      <div
                        key={idx}
                        className={`h-1 w-1 rounded-full ${
                          selected ? 'bg-[#1c1f33]' : 'bg-[#d3bb73]'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-1 flex-col overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
        <div className="flex-shrink-0 border-b border-[#d3bb73]/10 px-3 py-2">
          <h3 className="text-xs font-medium capitalize text-[#e5e4e2]">
            {selectedDateFormatted}
          </h3>
          <p className="text-[10px] text-[#e5e4e2]/60">
            {eventsForSelectedDate.length}{' '}
            {eventsForSelectedDate.length === 1 ? 'wydarzenie' : 'wydarzeń'}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {eventsForSelectedDate.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="rounded-full bg-[#d3bb73]/10 p-3">
                <Clock className="h-6 w-6 text-[#d3bb73]/50" />
              </div>
              <p className="mt-3 text-xs text-[#e5e4e2]/60">Brak wydarzeń</p>
              <p className="mt-1 text-[10px] text-[#e5e4e2]/40">
                Nie masz żadnych wydarzeń zaplanowanych na ten dzień
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {eventsForSelectedDate.map((event) => {
                const statusColor =
                  event.category?.color || STATUS_COLORS[event.status] || '#d3bb73';

                return (
                  <button
                    key={event.id}
                    onClick={() => handleEventClick(event)}
                    className="w-full rounded-lg bg-[#0f1119] p-3 text-left transition-colors hover:bg-[#0f1119]/50"
                  >
                    <div className="flex items-start gap-2">
                      <div
                        className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: statusColor }}
                      />
                      <div className="flex-1">
                        <h4 className="mb-1.5 text-sm font-medium text-[#e5e4e2]">
                          {event.name}
                        </h4>

                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-[11px] text-[#e5e4e2]/70">
                            <Clock className="h-3 w-3" />
                            <span>
                              {formatTime(event.event_date)}
                              {event.event_end_date && ` - ${formatTime(event.event_end_date)}`}
                            </span>
                          </div>

                          {event.location && (
                            <div className="flex items-center gap-1.5 text-[11px] text-[#e5e4e2]/70">
                              <MapPin className="h-3 w-3 flex-shrink-0" />
                              <span className="line-clamp-1">{event.location}</span>
                            </div>
                          )}

                          {(event.organization || event.contact_person) && (
                            <div className="flex items-center gap-1.5 text-[11px] text-[#e5e4e2]/70">
                              <Building2 className="h-3 w-3 flex-shrink-0" />
                              <span className="line-clamp-1">
                                {event.organization
                                  ? event.organization.alias || event.organization.name
                                  : event.contact_person?.full_name}
                              </span>
                            </div>
                          )}

                          {event.category && (
                            <div className="flex items-center gap-1.5 text-[11px] text-[#e5e4e2]/70">
                              <Tag className="h-3 w-3" />
                              <span>{event.category.name}</span>
                            </div>
                          )}
                        </div>

                        <div className="mt-2">
                          <span
                            className="inline-block rounded border px-1.5 py-0.5 text-[10px]"
                            style={{
                              borderColor: statusColor,
                              backgroundColor: `${statusColor}20`,
                              color: statusColor,
                            }}
                          >
                            {STATUS_LABELS[event.status]}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
