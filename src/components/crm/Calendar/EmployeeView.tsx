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
    return events.filter(event =>
      event.employees?.some((emp: any) => emp.employee_id === employeeId)
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
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-12 text-center">
          <Users className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60">Brak pracowników do wyświetlenia</p>
        </div>
      ) : (
        employees.map((employee) => {
          const employeeEvents = getEmployeeEvents(employee.id);
          const sortedEvents = employeeEvents.sort((a, b) =>
            new Date(a.event_date).getTime() - new Date(b.event_date).getTime()
          );

          return (
            <div
              key={employee.id}
              className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl overflow-hidden"
            >
              <div className="bg-[#0f1119] px-6 py-4 border-b border-[#d3bb73]/10">
                <h3 className="text-lg font-light text-[#e5e4e2]">
                  {employee.nickname || `${employee.name} ${employee.surname}`}
                </h3>
                <p className="text-sm text-[#e5e4e2]/60 mt-1">
                  {employeeEvents.length} {employeeEvents.length === 1 ? 'wydarzenie' : employeeEvents.length < 5 ? 'wydarzenia' : 'wydarzeń'}
                </p>
              </div>

              {sortedEvents.length === 0 ? (
                <div className="p-8 text-center">
                  <Calendar className="w-8 h-8 text-[#e5e4e2]/20 mx-auto mb-2" />
                  <p className="text-sm text-[#e5e4e2]/40">Brak przypisanych wydarzeń</p>
                </div>
              ) : (
                <div className="p-4 space-y-2">
                  {sortedEvents.map((event) => {
                    const assignment = event.employees?.find((emp: any) => emp.employee_id === employee.id);

                    return (
                      <button
                        key={event.id}
                        onClick={() => onEventClick(event)}
                        className="w-full bg-[#0f1119] hover:bg-[#d3bb73]/5 border border-[#d3bb73]/10 hover:border-[#d3bb73]/30 rounded-lg p-4 transition-all text-left group"
                      >
                        <div className="flex items-start gap-4">
                          <div
                            className="w-1 h-full rounded-full flex-shrink-0"
                            style={{ backgroundColor: STATUS_COLORS[event.status] || '#6B7280' }}
                          />

                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-start justify-between gap-4">
                              <h4 className="text-[#e5e4e2] font-medium group-hover:text-[#d3bb73] transition-colors flex items-center gap-2">
                                {event.category?.custom_icon?.svg_code && (
                                  <span
                                    className="inline-flex w-4 h-4 flex-shrink-0"
                                    dangerouslySetInnerHTML={{ __html: event.category.custom_icon.svg_code }}
                                    style={{ color: event.category.color }}
                                  />
                                )}
                                <span>{event.name}</span>
                              </h4>
                              <span className="text-xs text-[#e5e4e2]/60 whitespace-nowrap">
                                {formatDate(event.event_date)}
                              </span>
                            </div>

                            {assignment?.role && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-[#d3bb73] bg-[#d3bb73]/10 px-2 py-1 rounded">
                                  {assignment.role}
                                </span>
                              </div>
                            )}

                            {event.location && (
                              <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                                <span className="truncate">{event.location}</span>
                              </div>
                            )}

                            {event.client && (
                              <div className="text-sm text-[#e5e4e2]/60">
                                Klient: {event.client.company_name || `${event.client.first_name} ${event.client.last_name}`}
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
