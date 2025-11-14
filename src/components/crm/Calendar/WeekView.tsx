'use client';

import { CalendarViewProps } from './types';
import { getWeekDays, getEventsForDate, isToday, formatTime, getEventPosition } from './utils';
import { STATUS_COLORS, DAYS_OF_WEEK_FULL, HOURS } from './constants';
import { Clock, MapPin } from 'lucide-react';

export default function WeekView({
  currentDate,
  events,
  onDateClick,
  onEventClick,
  onEventHover,
}: CalendarViewProps) {
  const weekDays = getWeekDays(currentDate);

  return (
    <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
      <div className="grid grid-cols-8 border-b border-[#d3bb73]/10">
        <div className="bg-[#0f1119] p-4"></div>
        {weekDays.map((day, index) => {
          const today = isToday(day);
          return (
            <div
              key={index}
              className={`border-l border-[#d3bb73]/10 p-4 text-center ${
                today ? 'bg-[#d3bb73]/5' : 'bg-[#1c1f33]'
              }`}
            >
              <div className="mb-1 text-xs text-[#e5e4e2]/60">{DAYS_OF_WEEK_FULL[index]}</div>
              <div
                className={`text-lg font-light ${
                  today
                    ? 'mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-[#d3bb73] text-[#1c1f33]'
                    : 'text-[#e5e4e2]'
                }`}
              >
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      <div className="relative max-h-[600px] overflow-y-auto">
        <div className="grid grid-cols-8">
          <div className="border-r border-[#d3bb73]/10 bg-[#0f1119]">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="flex h-[60px] items-start justify-end border-b border-[#d3bb73]/5 pr-2 text-xs text-[#e5e4e2]/40"
              >
                {hour.toString().padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {weekDays.map((day, dayIndex) => {
            const dayEvents = getEventsForDate(day, events);
            const today = isToday(day);

            return (
              <div
                key={dayIndex}
                className={`relative border-l border-[#d3bb73]/10 ${
                  today ? 'bg-[#d3bb73]/5' : 'bg-[#1c1f33]'
                }`}
                onClick={() => onDateClick(day)}
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="h-[60px] cursor-pointer border-b border-[#d3bb73]/5 transition-colors hover:bg-[#d3bb73]/5"
                  />
                ))}

                {dayEvents.map((event) => {
                  const { top, height } = getEventPosition(event);
                  return (
                    <div
                      key={event.id}
                      className="absolute left-1 right-1 z-10 cursor-pointer overflow-hidden rounded border p-2 transition-opacity hover:opacity-80"
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        ...(event.category?.color
                          ? {
                              backgroundColor: `${event.category.color}20`,
                              borderColor: `${event.category.color}50`,
                              color: '#d3bb73',
                            }
                          : {}),
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(event);
                      }}
                      onMouseEnter={(e) => {
                        if (onEventHover) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          onEventHover(event, { x: rect.left, y: rect.bottom });
                        }
                      }}
                      onMouseLeave={() => {
                        if (onEventHover) onEventHover(null);
                      }}
                    >
                      <div className="flex items-center gap-1 truncate text-xs font-medium">
                        {event.category?.custom_icon?.svg_code && (
                          <span
                            className="inline-flex h-3 w-3 flex-shrink-0"
                            dangerouslySetInnerHTML={{
                              __html: event.category.custom_icon.svg_code,
                            }}
                            style={{ color: event.category.color }}
                          />
                        )}
                        <span className="truncate">{event.name}</span>
                      </div>
                      {height > 40 && (
                        <>
                          <div className="mt-1 flex items-center gap-1 text-[10px] opacity-80">
                            <Clock className="h-3 w-3" />
                            <span>{formatTime(event.event_date)}</span>
                          </div>
                          {height > 60 && event.location && (
                            <div className="mt-0.5 flex items-center gap-1 truncate text-[10px] opacity-80">
                              <MapPin className="h-3 w-3" />
                              <span className="truncate">{event.location}</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
