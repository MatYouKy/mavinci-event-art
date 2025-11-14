'use client';

import { CalendarViewProps } from './types';
import { STATUS_COLORS } from './constants';
import { Calendar, MapPin, Users } from 'lucide-react';

interface EmployeeViewProps extends CalendarViewProps {
  employees: any[];
}

export default function EmployeeView({
  currentDate,
  events,
  onEventClick,
  employees,
}: EmployeeViewProps) {
  const getEmployeeEvents = (employeeId: string) => {
    return events.filter((event) =>
      event.employees?.some((emp: any) => emp.employee_id === employeeId),
    );
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-6">
      {employees.length === 0 ? (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
          <Users className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="text-[#e5e4e2]/60">Brak pracowników do wyświetlenia</p>
        </div>
      ) : (
        employees.map((employee) => {
          const employeeEvents = getEmployeeEvents(employee.id);
          const sortedEvents = employeeEvents.sort(
            (a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime(),
          );

          return (
            <div
              key={employee.id}
              className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]"
            >
              <div className="border-b border-[#d3bb73]/10 bg-[#0f1119] px-6 py-4">
                <h3 className="text-lg font-light text-[#e5e4e2]">
                  {employee.nickname || `${employee.name} ${employee.surname}`}
                </h3>
                <p className="mt-1 text-sm text-[#e5e4e2]/60">
                  {employeeEvents.length}{' '}
                  {employeeEvents.length === 1
                    ? 'wydarzenie'
                    : employeeEvents.length < 5
                      ? 'wydarzenia'
                      : 'wydarzeń'}
                </p>
              </div>

              {sortedEvents.length === 0 ? (
                <div className="p-8 text-center">
                  <Calendar className="mx-auto mb-2 h-8 w-8 text-[#e5e4e2]/20" />
                  <p className="text-sm text-[#e5e4e2]/40">Brak przypisanych wydarzeń</p>
                </div>
              ) : (
                <div className="space-y-2 p-4">
                  {sortedEvents.map((event) => {
                    const assignment = event.employees?.find(
                      (emp: any) => emp.employee_id === employee.id,
                    );

                    return (
                      <button
                        key={event.id}
                        onClick={() => onEventClick(event)}
                        className="group w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 text-left transition-all hover:border-[#d3bb73]/30 hover:bg-[#d3bb73]/5"
                      >
                        <div className="flex items-start gap-4">
                          <div
                            className="h-full w-1 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: STATUS_COLORS[event.status] || '#6B7280' }}
                          />

                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex items-start justify-between gap-4">
                              <h4 className="flex items-center gap-2 font-medium text-[#e5e4e2] transition-colors group-hover:text-[#d3bb73]">
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
                              <span className="whitespace-nowrap text-xs text-[#e5e4e2]/60">
                                {formatDate(event.event_date)}
                              </span>
                            </div>

                            {assignment?.role && (
                              <div className="flex items-center gap-2">
                                <span className="rounded bg-[#d3bb73]/10 px-2 py-1 text-xs text-[#d3bb73]">
                                  {assignment.role}
                                </span>
                              </div>
                            )}

                            {event.location && (
                              <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                                <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                                <span className="truncate">{event.location}</span>
                              </div>
                            )}

                            {(event.organization || event.contact_person) && (
                              <div className="text-sm text-[#e5e4e2]/60">
                                Klient:{' '}
                                {event.organization
                                  ? event.organization.alias || event.organization.name
                                  : event.contact_person?.full_name}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
