'use client';

import { CalendarViewProps } from './types';
import { getEventsForDate, formatTime, getEventPosition } from './utils';
import { STATUS_COLORS, STATUS_LABELS, HOURS } from './constants';
import { Clock, MapPin, Building2, DollarSign } from 'lucide-react';

export default function DayView({
  currentDate,
  events,
  onDateClick,
  onEventClick,
  onEventHover,
}: CalendarViewProps) {
  const dayEvents = getEventsForDate(currentDate, events).sort(
    (a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime()
  );

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[#d3bb73]/10 bg-[#0f1119]">
          <h3 className="text-lg font-light text-[#e5e4e2]">
            {currentDate.toLocaleDateString('pl-PL', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </h3>
        </div>

        <div className="relative overflow-y-auto max-h-[700px]">
          <div className="flex">
            <div className="w-20 bg-[#0f1119] border-r border-[#d3bb73]/10 flex-shrink-0">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="h-[80px] flex items-start justify-end pr-3 text-sm text-[#e5e4e2]/40 border-b border-[#d3bb73]/5 pt-1"
                >
                  {hour.toString().padStart(2, '0')}:00
                </div>
              ))}
            </div>

            <div className="flex-1 relative bg-[#1c1f33]">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="h-[80px] border-b border-[#d3bb73]/5 hover:bg-[#d3bb73]/5 transition-colors cursor-pointer"
                  onClick={() => onDateClick(currentDate)}
                />
              ))}

              {dayEvents.map((event) => {
                const { top, height } = getEventPosition(event);
                return (
                  <div
                    key={event.id}
                    className="absolute left-2 right-2 rounded border p-3 cursor-pointer hover:opacity-90 transition-opacity z-10"
                    style={{
                      top: `${top}px`,
                      minHeight: `${Math.max(height, 60)}px`,
                      ...(event.category?.color
                        ? {
                            backgroundColor: `${event.category.color}20`,
                            borderColor: `${event.category.color}50`,
                            color: event.category.color,
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
                    <div className="text-sm font-medium mb-1">{event.name}</div>
                    <div className="flex items-center gap-2 text-xs opacity-80">
                      <Clock className="w-3 h-3" />
                      <span>{formatTime(event.event_date)}</span>
                    </div>
                    {event.location && (
                      <div className="flex items-center gap-2 text-xs opacity-80 mt-1">
                        <MapPin className="w-3 h-3" />
                        <span className="truncate">{event.location}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4">
          <h3 className="text-lg font-light text-[#e5e4e2] mb-4">
            Wydarzenia dnia ({dayEvents.length})
          </h3>

          {dayEvents.length === 0 ? (
            <div className="text-center py-8 text-[#e5e4e2]/40">
              <p className="text-sm">Brak wydarzeń tego dnia</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dayEvents.map((event) => {
                const clientName =
                  event.client?.company_name ||
                  `${event.client?.first_name || ''} ${event.client?.last_name || ''}`.trim() ||
                  'Brak klienta';

                return (
                  <div
                    key={event.id}
                    className="p-3 bg-[#0f1119] rounded-lg hover:bg-[#0f1119]/50 transition-colors cursor-pointer"
                    onClick={() => onEventClick(event)}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h4 className="text-sm font-medium text-[#e5e4e2] flex-1">{event.name}</h4>
                      {event.category && (
                        <span
                          className="text-[10px] px-2 py-0.5 rounded border whitespace-nowrap"
                          style={{
                            backgroundColor: `${event.category.color}20`,
                            borderColor: `${event.category.color}50`,
                            color: event.category.color,
                          }}
                        >
                          {event.category.name}
                        </span>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
                        <Building2 className="w-3 h-3" />
                        <span className="truncate">{clientName}</span>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
                        <Clock className="w-3 h-3" />
                        <span>{formatTime(event.event_date)}</span>
                        {event.event_end_date && (
                          <span>- {formatTime(event.event_end_date)}</span>
                        )}
                      </div>

                      {event.location && (
                        <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
                          <MapPin className="w-3 h-3" />
                          <span className="truncate">{event.location}</span>
                        </div>
                      )}

                      {event.budget && event.budget > 0 && (
                        <div className="flex items-center gap-2 text-xs text-[#d3bb73]">
                          <DollarSign className="w-3 h-3" />
                          <span>{event.budget.toLocaleString('pl-PL')} PLN</span>
                        </div>
                      )}
                    </div>

                    {(event.equipment && event.equipment.length > 0) ||
                    (event.employees && event.employees.length > 0) ? (
                      <div className="mt-2 pt-2 border-t border-[#d3bb73]/10 flex gap-3 text-xs text-[#e5e4e2]/60">
                        {event.equipment && event.equipment.length > 0 && (
                          <span>{event.equipment.length} sprzętów</span>
                        )}
                        {event.employees && event.employees.length > 0 && (
                          <span>{event.employees.length} pracowników</span>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4">
          <h3 className="text-lg font-light text-[#e5e4e2] mb-3">Statystyki</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#e5e4e2]/70">Całkowity budżet:</span>
              <span className="text-[#d3bb73] font-medium">
                {dayEvents
                  .reduce((sum, e) => sum + (e.budget || 0), 0)
                  .toLocaleString('pl-PL')}{' '}
                PLN
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#e5e4e2]/70">Zasobów sprzętowych:</span>
              <span className="text-[#e5e4e2] font-medium">
                {dayEvents.reduce((sum, e) => sum + (e.equipment?.length || 0), 0)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#e5e4e2]/70">Przypisanych pracowników:</span>
              <span className="text-[#e5e4e2] font-medium">
                {dayEvents.reduce((sum, e) => sum + (e.employees?.length || 0), 0)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
