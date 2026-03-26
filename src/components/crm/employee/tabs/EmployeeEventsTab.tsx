import React from 'react';
import { Calendar, Clock } from 'lucide-react';

interface EmployeeEventAssignment {
  id: string;
  role_in_event?: string | null;
  hours_worked?: number | null;
  hourly_rate?: number | null;
  event: {
    id: string;
    name: string;
    event_date: string;
  };
}

interface EmployeeEventsTabProps {
  events: EmployeeEventAssignment[];
  onOpenEvent: (eventId: string) => void;
}

export default function EmployeeEventsTab({
  events,
  onOpenEvent,
}: EmployeeEventsTabProps) {
  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h3 className="mb-6 text-lg font-light text-[#e5e4e2]">Wydarzenia</h3>

      {events.length === 0 ? (
        <div className="py-12 text-center">
          <Calendar className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="text-[#e5e4e2]/60">Brak przypisanych wydarzeń</p>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((assignment) => (
            <div
              key={assignment.id}
              className="cursor-pointer rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 transition-all hover:border-[#d3bb73]/30"
              onClick={() => onOpenEvent(assignment.event.id)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="mb-1 font-medium text-[#e5e4e2]">{assignment.event.name}</h4>

                  <p className="mb-2 text-sm text-[#d3bb73]">
                    Rola: {assignment.role_in_event || 'Brak'}
                  </p>

                  <div className="flex items-center gap-3 text-xs text-[#e5e4e2]/60">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(assignment.event.event_date).toLocaleDateString('pl-PL')}
                    </span>

                    {assignment.hours_worked ? (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {assignment.hours_worked}h
                      </span>
                    ) : null}

                    {assignment.hourly_rate ? (
                      <span>Stawka: {assignment.hourly_rate} zł/h</span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}