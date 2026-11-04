'use client';

import SalesColleagueBadge from '@/components/crm/events/SalesColleagueBadge';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { fetchEventFinancialsMap } from '@/lib/CRM/events/eventFinancials';
import { CalendarViewProps } from './types';
import { getEventsForDate, formatTime, getEventPosition } from './utils';
import { STATUS_COLORS, STATUS_LABELS, HOURS } from './constants';
import { Clock, MapPin, Building2, DollarSign } from 'lucide-react';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Budżety z event_financials (RLS: obszar „kwoty”) — bez dostępu kwoty się nie pokazują.
  const budgetEventIdsKey = dayEvents
    .filter((event) => !event.is_meeting && !event.is_inquiry && !event.sales_colleague && UUID_PATTERN.test(event.id))
    .map((event) => event.id)
    .join(',');
  const [budgets, setBudgets] = useState<Map<string, number>>(() => new Map());
  useEffect(() => {
    let active = true;
    const ids = budgetEventIdsKey ? budgetEventIdsKey.split(',') : [];
    if (!ids.length) {
      setBudgets(new Map());
      return;
    }
    void fetchEventFinancialsMap(supabase, ids).then((rows) => {
      if (!active) return;
      const next = new Map<string, number>();
      rows.forEach((row, id) => {
        if (row.budget != null) next.set(id, row.budget);
      });
      setBudgets(next);
    });
    return () => {
      active = false;
    };
  }, [budgetEventIdsKey]);
  const totalBudget = Array.from(budgets.values()).reduce((sum, value) => sum + value, 0);

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
                    className={`absolute left-2 right-2 z-10 cursor-pointer rounded border p-3 transition-opacity hover:opacity-90 ${
                      event.is_inquiry ? 'border-dashed' : ''
                    }`}
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
                      {event.sales_colleague && <SalesColleagueBadge compact seller={event.sales_colleague_seller} />}
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
            Plan dnia ({dayEvents.length})
          </h3>

          {dayEvents.length === 0 ? (
            <div className="py-8 text-center text-[#e5e4e2]/40">
              <p className="text-sm">Brak wydarzeń i potencjalnych zapytań tego dnia</p>
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
                    className={`cursor-pointer rounded-lg border bg-[#0f1119] p-3 transition-colors hover:bg-[#0f1119]/50 ${
                      event.is_inquiry
                        ? 'border-dashed border-amber-400/40'
                        : 'border-transparent'
                    }`}
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
                        {event.sales_colleague && <SalesColleagueBadge seller={event.sales_colleague_seller} />}
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

                      {(budgets.get(event.id) ?? 0) > 0 && (
                        <div className="flex items-center gap-2 text-xs text-[#d3bb73]">
                          <DollarSign className="h-3 w-3" />
                          <span>{(budgets.get(event.id) ?? 0).toLocaleString('pl-PL')} PLN</span>
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
            {budgets.size > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-[#e5e4e2]/70">Całkowity budżet:</span>
                <span className="font-medium text-[#d3bb73]">{totalBudget.toLocaleString('pl-PL')} PLN</span>
              </div>
            )}
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
