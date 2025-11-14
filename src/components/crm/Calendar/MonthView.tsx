'use client';

import { CalendarViewProps } from './types';
import { getDaysInMonth, getEventsForDate, isToday } from './utils';
import { STATUS_COLORS } from './constants';
import { DAYS_OF_WEEK } from './constants';
import { Plus, Layers } from 'lucide-react';

interface MonthViewProps extends CalendarViewProps {
  onShowAllEvents?: (date: Date) => void;
}

export default function MonthView({
  currentDate,
  events,
  onDateClick,
  onEventClick,
  onEventHover,
  onShowAllEvents,
}: MonthViewProps) {
  const days = getDaysInMonth(currentDate);
  const maxVisibleEvents = 2;

  return (
    <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
      <div className="grid grid-cols-7 gap-px bg-[#d3bb73]/10">
        {DAYS_OF_WEEK.map((day) => (
          <div
            key={day}
            className="bg-[#1c1f33] p-3 text-center text-sm font-medium text-[#e5e4e2]/60"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px bg-[#d3bb73]/10">
        {days.map((date, index) => {
          if (!date) {
            return <div key={index} className="h-[130px] bg-[#1c1f33]" />;
          }

          const dayEvents = getEventsForDate(date, events);
          const today = isToday(date);
          const eventCount = dayEvents.length;

          return (
            <div
              key={index}
              className={`relative flex h-[130px] cursor-pointer flex-col bg-[#1c1f33] p-2 transition-colors hover:bg-[#1c1f33]/50`}
              onClick={() => onDateClick(date)}
            >
              <div className="mb-2 flex items-start justify-between">
                <div
                  className={`text-sm ${
                    today
                      ? 'flex h-7 w-7 items-center justify-center rounded-full bg-[#d3bb73] font-medium text-[#1c1f33]'
                      : 'text-[#e5e4e2]/60'
                  }`}
                >
                  {date.getDate()}
                </div>

                {eventCount > 0 && onShowAllEvents && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onShowAllEvents(date);
                    }}
                    className="group flex items-center gap-1 rounded-full bg-[#d3bb73]/20 px-2 py-0.5 transition-colors hover:bg-[#d3bb73]/30"
                  >
                    <Layers className="h-3 w-3 text-[#d3bb73]" />
                    <span className="text-xs font-medium text-[#d3bb73]">{eventCount}</span>
                  </button>
                )}
              </div>

              {eventCount === 0 && (
                <div className="flex flex-1 items-center justify-center">
                  <Plus className="h-6 w-6 text-[#e5e4e2]/20" />
                </div>
              )}

              {eventCount > 0 && (
                <div className="relative flex flex-1 flex-col">
                  <div className="flex-1 space-y-1 overflow-hidden">
                    {dayEvents.slice(0, maxVisibleEvents).map((event, idx) => {
                      const isLast = idx === maxVisibleEvents - 1;
                      const remainingCount = eventCount - maxVisibleEvents;
                      const showStack = isLast && remainingCount > 0;

                      return (
                        <div
                          key={event.id}
                          className="relative"
                          style={{
                            transform: showStack ? `translateY(-${remainingCount * 2}px)` : 'none',
                          }}
                        >
                          {showStack && remainingCount > 0 && (
                            <>
                              {[...Array(Math.min(remainingCount, 2))].map((_, stackIdx) => (
                                <div
                                  key={`stack-${stackIdx}`}
                                  className="absolute inset-0 rounded border border-[#d3bb73]/20 bg-[#0f1119]"
                                  style={{
                                    transform: `translateY(-${(stackIdx + 1) * 2}px)`,
                                    zIndex: -(stackIdx + 1),
                                    opacity: 0.5 - stackIdx * 0.15,
                                  }}
                                />
                              ))}
                            </>
                          )}

                          <div
                            className="relative z-10 cursor-pointer truncate rounded border p-1.5 text-xs font-medium transition-opacity hover:opacity-80"
                            style={
                              event.category?.color
                                ? {
                                    backgroundColor: `${event.category.color}20`,
                                    borderColor: `${event.category.color}50`,
                                    color: '#d3bb73',
                                  }
                                : {}
                            }
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
                            <span className="flex items-center gap-1">
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
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-auto flex items-center justify-center pt-2">
                    <Plus className="h-4 w-4 text-[#e5e4e2]/30 transition-colors hover:text-[#e5e4e2]/50" />
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
