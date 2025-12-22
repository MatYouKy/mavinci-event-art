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
    <div className="bg-[#0f1117] border border-[#d3bb73]/10 rounded-xl overflow-hidden">
      <div className="grid grid-cols-7 bg-[#1c1f33]">
        {DAYS_OF_WEEK.map((day) => (
          <div
            key={day}
            className="p-3 text-center text-sm font-medium text-[#d3bb73] border-b border-[#d3bb73]/10"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((date, index) => {
          if (!date) {
            return <div key={index} className="bg-[#1c1f33] h-[130px]" />;
          }

          const dayEvents = getEventsForDate(date, events);
          const today = isToday(date);
          const eventCount = dayEvents.length;

          return (
            <div
              key={index}
              className={`bg-[#0f1117] h-[130px] p-2 relative hover:bg-[#d3bb73]/5 cursor-pointer transition-all border border-[#d3bb73]/5 hover:border-[#d3bb73]/20 flex flex-col group`}
              onClick={() => onDateClick(date)}
            >
              <div className="flex items-start justify-between mb-2">
                <div
                  className={`text-sm ${
                    today
                      ? 'w-7 h-7 flex items-center justify-center bg-[#d3bb73] text-[#1c1f33] rounded-full font-medium'
                      : 'text-[#e5e4e2]/70'
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
                    className="flex items-center gap-1 px-2 py-0.5 bg-[#d3bb73]/20 hover:bg-[#d3bb73]/30 rounded-full transition-colors"
                  >
                    <Layers className="w-3 h-3 text-[#d3bb73]" />
                    <span className="text-xs font-medium text-[#d3bb73]">{eventCount}</span>
                  </button>
                )}
              </div>

              {eventCount === 0 && (
                <div className="flex items-center justify-center flex-1">
                  <div className="text-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Plus className="w-6 h-6 text-[#d3bb73] mx-auto mb-1" />
                    <span className="text-xs text-[#d3bb73]">Dodaj event</span>
                  </div>
                </div>
              )}

              {eventCount > 0 && (
                <div className="relative flex-1 flex flex-col">
                  <div className="space-y-1 flex-1 overflow-hidden">
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
                                  className="absolute inset-0 bg-[#0f1119] border border-[#d3bb73]/20 rounded"
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
                            className="text-xs p-1.5 rounded border truncate hover:opacity-80 transition-opacity relative z-10 cursor-pointer font-medium"
                            style={
                              event.is_meeting
                                ? {
                                    backgroundColor: '#FFFFFF20',
                                    borderColor: '#FFFFFF40',
                                    color: '#FFFFFF',
                                  }
                                : event.category?.color
                                ? {
                                    backgroundColor: `${event.category.color}15`,
                                    borderColor: `${event.category.color}40`,
                                    color: event.category.color,
                                  }
                                : {
                                    backgroundColor: '#d3bb7320',
                                    borderColor: '#d3bb7340',
                                    color: '#d3bb73',
                                  }
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
                                  className="inline-flex w-3 h-3 flex-shrink-0"
                                  dangerouslySetInnerHTML={{ __html: event.category.custom_icon.svg_code }}
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

                  <div className="flex items-center justify-center mt-auto pt-2">
                    <Plus className="w-4 h-4 text-[#e5e4e2]/30 hover:text-[#e5e4e2]/50 transition-colors" />
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
