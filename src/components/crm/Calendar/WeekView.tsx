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
    <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl overflow-hidden">
      <div className="grid grid-cols-8 border-b border-[#d3bb73]/10">
        <div className="p-4 bg-[#0f1119]"></div>
        {weekDays.map((day, index) => {
          const today = isToday(day);
          return (
            <div
              key={index}
              className={`p-4 text-center border-l border-[#d3bb73]/10 ${
                today ? 'bg-[#d3bb73]/5' : 'bg-[#1c1f33]'
              }`}
            >
              <div className="text-xs text-[#e5e4e2]/60 mb-1">{DAYS_OF_WEEK_FULL[index]}</div>
              <div
                className={`text-lg font-light ${
                  today
                    ? 'w-8 h-8 mx-auto flex items-center justify-center bg-[#d3bb73] text-[#1c1f33] rounded-full'
                    : 'text-[#e5e4e2]'
                }`}
              >
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      <div className="relative overflow-y-auto max-h-[600px]">
        <div className="grid grid-cols-8">
          <div className="bg-[#0f1119] border-r border-[#d3bb73]/10">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="h-[60px] flex items-start justify-end pr-2 text-xs text-[#e5e4e2]/40 border-b border-[#d3bb73]/5"
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
                    className="h-[60px] border-b border-[#d3bb73]/5 hover:bg-[#d3bb73]/5 transition-colors cursor-pointer"
                  />
                ))}

                {dayEvents.map((event) => {
                  const { top, height } = getEventPosition(event);
                  return (
                    <div
                      key={event.id}
                      className="absolute left-1 right-1 rounded border p-2 cursor-pointer hover:opacity-80 transition-opacity overflow-hidden z-10"
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
                      <div className="text-xs font-medium truncate">{event.name}</div>
                      {height > 40 && (
                        <>
                          <div className="flex items-center gap-1 text-[10px] mt-1 opacity-80">
                            <Clock className="w-3 h-3" />
                            <span>{formatTime(event.event_date)}</span>
                          </div>
                          {height > 60 && event.location && (
                            <div className="flex items-center gap-1 text-[10px] mt-0.5 opacity-80 truncate">
                              <MapPin className="w-3 h-3" />
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
