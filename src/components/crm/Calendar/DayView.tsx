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
    (a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime(),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] lg:col-span-2">
        <div className="border-b border-[#d3bb73]/10 bg-[#0f1119] p-4">
          <h3 className="text-lg font-light text-[#e5e4e2]">
            {currentDate.toLocaleDateString('pl-PL', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </h3>
        </div>

        <div className="relative max-h-[700px] overflow-y-auto">
          <div className="flex">
            <div className="w-20 flex-shrink-0 border-r border-[#d3bb73]/10 bg-[#0f1119]">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="flex h-[60px] items-start justify-end border-b border-[#d3bb73]/5 pr-3 pt-1 text-sm text-[#e5e4e2]/40"
                >
                  {hour.toString().padStart(2, '0')}:00
                </div>
              ))}
            </div>

            <div className="relative flex-1 bg-[#1c1f33]">
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="h-[60px] cursor-pointer border-b border-[#d3bb73]/5 transition-colors hover:bg-[#d3bb73]/5"
                  onClick={() => onDateClick(currentDate)}
                />
              ))}

              {dayEvents.map((event) => {
                const { top, height } = getEventPosition(event);
                return (
                  <div
                    key={event.id}
                    className="absolute left-2 right-2 z-10 cursor-pointer rounded border p-3 transition-opacity hover:opacity-90"
                    style={{
                      top: `${top}px`,
                      minHeight: `${Math.max(height, 60)}px`,
                      ...(event.is_meeting
                        ? {
                            backgroundColor: '#FFFFFF20',
                            borderColor: '#FFFFFF50',
                            color: '#FFFFFF',
                          }
                        : event.category?.color
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
                    <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                      {event.category?.custom_icon?.svg_code && (
                        <span
                          className="inline-flex h-4 w-4 flex-shrink-0"
                          dangerouslySetInnerHTML={{ __html: event.category.custom_icon.svg_code }}
                          style={{ color: event.category.color }}
                        />
                      )}
                      <span>{event.name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs opacity-80">
                      <Clock className="h-3 w-3" />
                      <span>{formatTime(event.event_date)}</span>
                    </div>
                    {event.location && (
                      <div className="mt-1 flex items-center gap-2 text-xs opacity-80">
                        <MapPin className="h-3 w-3" />
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
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">
            Wydarzenia dnia ({dayEvents.length})
          </h3>

          {dayEvents.length === 0 ? (
            <div className="py-8 text-center text-[#e5e4e2]/40">
              <p className="text-sm">Brak wydarzeń tego dnia</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dayEvents.map((event) => {
                const clientName = event.organization
                  ? event.organization.alias || event.organization.name
                  : event.contact_person?.full_name || 'Brak klienta';

                return (
                  <div
                    key={event.id}
                    className="cursor-pointer rounded-lg bg-[#0f1119] p-3 transition-colors hover:bg-[#0f1119]/50"
                    onClick={() => onEventClick(event)}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <h4 className="flex flex-1 items-center gap-2 text-sm font-medium text-[#e5e4e2]">
                        {event.category?.custom_icon?.svg_code && (
                          <span
                            className="inline-flex h-4 w-4 flex-shrink-0"
                            dangerouslySetInnerHTML={{
                              __html: event.category.custom_icon.svg_code,
                            }}
                            style={{ color: event.category.color }}
                          />
                        )}
                        <span>{event.name}</span>
                      </h4>
                      {event.is_meeting && (
                        <span
                          className="whitespace-nowrap rounded border px-2 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: '#FFFFFF20',
                            borderColor: '#FFFFFF50',
                            color: '#FFFFFF',
                          }}
                        >
                          Spotkanie
                        </span>
                      )}
                      {!event.is_meeting && event.category && (
                        <span
                          className="whitespace-nowrap rounded border px-2 py-0.5 text-[10px]"
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
                        <Building2 className="h-3 w-3" />
                        <span className="truncate">{clientName}</span>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
                        <Clock className="h-3 w-3" />
                        <span>{formatTime(event.event_date)}</span>
                        {event.event_end_date && <span>- {formatTime(event.event_end_date)}</span>}
                      </div>

                      {event.location && (
                        <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/70">
                          <MapPin className="h-3 w-3" />
                          <span className="truncate">{event.location}</span>
                        </div>
                      )}

                      {event.budget && event.budget > 0 && (
                        <div className="flex items-center gap-2 text-xs text-[#d3bb73]">
                          <DollarSign className="h-3 w-3" />
                          <span>{event.budget.toLocaleString('pl-PL')} PLN</span>
                        </div>
                      )}
                    </div>

                    {(event.equipment && event.equipment.length > 0) ||
                    (event.employees && event.employees.length > 0) ? (
                      <div className="mt-2 flex gap-3 border-t border-[#d3bb73]/10 pt-2 text-xs text-[#e5e4e2]/60">
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

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <h3 className="mb-3 text-lg font-light text-[#e5e4e2]">Statystyki</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#e5e4e2]/70">Całkowity budżet:</span>
              <span className="font-medium text-[#d3bb73]">
                {dayEvents.reduce((sum, e) => sum + (e.budget || 0), 0).toLocaleString('pl-PL')} PLN
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#e5e4e2]/70">Zasobów sprzętowych:</span>
              <span className="font-medium text-[#e5e4e2]">
                {dayEvents.reduce((sum, e) => sum + (e.equipment?.length || 0), 0)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#e5e4e2]/70">Przypisanych pracowników:</span>
              <span className="font-medium text-[#e5e4e2]">
                {dayEvents.reduce((sum, e) => sum + (e.employees?.length || 0), 0)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
