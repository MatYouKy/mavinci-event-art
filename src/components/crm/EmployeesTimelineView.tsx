'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar, ZoomIn, ZoomOut } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { IEmployee } from '@/app/(crm)/crm/employees/type';
import { EmployeeAvatar } from '../EmployeeAvatar';


type ZoomLevel = 'days' | 'hours' | 'quarter_hours';

interface TimelineItem {
  employee_id: string;
  employee_name: string;
  item_type: 'event' | 'absence';
  item_id: string;
  item_title: string;
  item_start: string;
  item_end: string;
  item_status: string;
  item_color: string;
  item_metadata: Record<string, any>;
}

interface TimelineBounds {
  start: Date;
  end: Date;
}

interface EmployeesTimelineViewProps {
  employees: IEmployee[];
}

const EmployeesTimelineView: React.FC<EmployeesTimelineViewProps> = ({ employees }) => {
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('days');
  const [timelineBounds, setTimelineBounds] = useState<TimelineBounds>({
    start: new Date(),
    end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 dni
  });
  const [timelineData, setTimelineData] = useState<Record<string, TimelineItem[]>>({});
  const [loading, setLoading] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const employeeIds = useMemo(() => employees.map((e) => e.id), [employees]);

  useEffect(() => {
    fetchTimelineData();
  }, [employeeIds, timelineBounds]);

  const fetchTimelineData = async () => {
    if (employeeIds.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_employee_timeline_data', {
        p_employee_ids: employeeIds,
        p_start_date: timelineBounds.start.toISOString(),
        p_end_date: timelineBounds.end.toISOString(),
      });

      if (error) throw error;

      const grouped: Record<string, TimelineItem[]> = {};
      (data || []).forEach((item: TimelineItem) => {
        if (!grouped[item.employee_id]) {
          grouped[item.employee_id] = [];
        }
        grouped[item.employee_id].push(item);
      });

      setTimelineData(grouped);
    } catch (error) {
      console.error('Error fetching timeline data:', error);
    } finally {
      setLoading(false);
    }
  };

  const shiftTimeline = (direction: 'left' | 'right') => {
    const duration = timelineBounds.end.getTime() - timelineBounds.start.getTime();
    const shift = duration * 0.5;

    if (direction === 'left') {
      setTimelineBounds({
        start: new Date(timelineBounds.start.getTime() - shift),
        end: new Date(timelineBounds.end.getTime() - shift),
      });
    } else {
      setTimelineBounds({
        start: new Date(timelineBounds.start.getTime() + shift),
        end: new Date(timelineBounds.end.getTime() + shift),
      });
    }
  };

  const resetToToday = () => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 30);
    setTimelineBounds({ start, end });
  };

  const getItemPosition = (item: TimelineItem) => {
    const start = new Date(item.item_start).getTime();
    const end = new Date(item.item_end).getTime();
    const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();

    const left = ((start - timelineBounds.start.getTime()) / totalDuration) * 100;
    const width = ((end - start) / totalDuration) * 100;

    return {
      left: `${Math.max(0, left)}%`,
      width: `${Math.max(1, width)}%`,
    };
  };

  const formatTimeLabel = (date: Date): string => {
    if (zoomLevel === 'days') {
      return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
    } else if (zoomLevel === 'hours') {
      return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    } else {
      const minutes = date.getMinutes();
      if (minutes === 0) {
        return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      } else {
        return `:${minutes.toString().padStart(2, '0')}`;
      }
    }
  };

  const generateTimeMarkers = () => {
    const markers: Date[] = [];
    const start = new Date(timelineBounds.start);
    const end = new Date(timelineBounds.end);

    let current = new Date(start);

    if (zoomLevel === 'days') {
      current.setHours(0, 0, 0, 0);
      while (current <= end) {
        markers.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
    } else if (zoomLevel === 'hours') {
      current.setMinutes(0, 0, 0);
      while (current <= end) {
        markers.push(new Date(current));
        current.setHours(current.getHours() + 1);
      }
    } else {
      current.setSeconds(0, 0);
      while (current <= end) {
        markers.push(new Date(current));
        current.setMinutes(current.getMinutes() + 15);
      }
    }

    return markers;
  };

  const timeMarkers = generateTimeMarkers();

  const getItemTypeLabel = (type: string) => {
    return type === 'event' ? 'Wydarzenie' : 'Nieobecność';
  };

  const getStatusColor = (status: string, type: string) => {
    if (type === 'absence') {
      if (status === 'pending') return 'border-yellow-500/50';
      if (status === 'approved') return 'border-green-500/50';
      return 'border-red-500/50';
    }
    return 'border-blue-500/50';
  };

  const minWidth = zoomLevel === 'days' ? '1200px' : zoomLevel === 'hours' ? '2400px' : '9600px';

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[#d3bb73] border-t-transparent" />
          <p className="text-[#e5e4e2]/60">Ładowanie osi czasu...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftTimeline('left')}
            className="rounded-lg bg-[#d3bb73]/10 p-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
            title="Wcześniej"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={resetToToday}
            className="rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
            title="Dzisiaj"
          >
            <Calendar className="mr-2 inline h-4 w-4" />
            Dzisiaj
          </button>
          <button
            onClick={() => shiftTimeline('right')}
            className="rounded-lg bg-[#d3bb73]/10 p-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
            title="Później"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="mr-2 text-sm text-[#e5e4e2]/60">Zoom:</span>
          {(['days', 'hours', 'quarter_hours'] as ZoomLevel[]).map((level) => (
            <button
              key={level}
              onClick={() => setZoomLevel(level)}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                zoomLevel === level
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#d3bb73]/10 text-[#e5e4e2] hover:bg-[#d3bb73]/20'
              }`}
            >
              {level === 'days' ? 'Dni' : level === 'hours' ? 'Godziny' : 'Kwadranse'}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119]">
        <div
          ref={scrollContainerRef}
          className="overflow-x-auto overflow-y-auto scroll-smooth"
          style={{ maxHeight: '70vh' }}
        >
          <div style={{ minWidth, paddingBottom: '24px' }}>
            {/* Time markers header */}
            <div className="sticky top-0 z-10 border-b border-[#d3bb73]/10 bg-[#1c1f33]">
              <div className="relative h-16">
                {timeMarkers.map((marker, idx) => {
                  const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();
                  const left = ((marker.getTime() - timelineBounds.start.getTime()) / totalDuration) * 100;
                  const isFullHour = zoomLevel === 'quarter_hours' && marker.getMinutes() % 15 === 0;

                  return (
                    <div
                      key={idx}
                      className="absolute top-0 h-full"
                      style={{ left: `${left}%` }}
                    >
                      <div
                        className={`h-full border-l ${
                          isFullHour ? 'border-[#e5e4e2]/20' : 'border-[#e5e4e2]/10'
                        }`}
                      />
                      <div
                        className={`absolute left-2 top-2 whitespace-nowrap text-xs ${
                          isFullHour ? 'font-semibold text-[#e5e4e2]' : 'text-[#e5e4e2]/60'
                        }`}
                      >
                        {formatTimeLabel(marker)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Employee rows */}
            {employees.map((employee) => {
              const items = timelineData[employee.id] || [];
              return (
                <div
                  key={employee.id}
                  className="border-b border-[#d3bb73]/10 hover:bg-[#1c1f33]/50"
                >
                  <div className="flex">
                    {/* Employee info - sticky */}
                    <div className="sticky left-0 z-10 w-64 border-r border-[#d3bb73]/10 bg-[#1c1f33] p-4">
                      <div className="flex items-center gap-3">
                        <EmployeeAvatar
                          employee={employee}
                          size={80}
                          showActivityStatus
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[#e5e4e2]">
                            {employee.nickname || `${employee.name} ${employee.surname}`}
                          </p>
                          <p className="truncate text-xs text-[#e5e4e2]/60">
                            {employee.occupation || employee.role}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Timeline items */}
                    <div className="relative min-h-[80px] flex-1 p-2">
                      {/* Grid lines */}
                      {timeMarkers.map((marker, idx) => {
                        const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();
                        const left = ((marker.getTime() - timelineBounds.start.getTime()) / totalDuration) * 100;
                        const isFullHour = zoomLevel === 'quarter_hours' && marker.getMinutes() % 15 === 0;
                        return (
                          <div
                            key={idx}
                            className={`absolute top-0 h-full border-l ${
                              isFullHour ? 'border-[#e5e4e2]/10' : 'border-[#e5e4e2]/5'
                            }`}
                            style={{ left: `${left}%` }}
                          />
                        );
                      })}

                      {/* Items */}
                      {items.map((item, idx) => {
                        const pos = getItemPosition(item);
                        return (
                          <div
                            key={`${item.item_id}-${idx}`}
                            className={`absolute top-2 h-12 overflow-hidden rounded border-l-4 ${getStatusColor(
                              item.item_status,
                              item.item_type
                            )} group cursor-pointer transition-all hover:z-20 hover:shadow-lg`}
                            style={{
                              left: pos.left,
                              width: pos.width,
                              backgroundColor: item.item_color + '40',
                            }}
                            title={`${getItemTypeLabel(item.item_type)}: ${item.item_title}\nStatus: ${item.item_status}`}
                          >
                            <div className="flex h-full items-center px-2">
                              <span className="truncate text-xs font-medium text-[#e5e4e2]">
                                {item.item_title}
                              </span>
                            </div>
                          </div>
                        );
                      })}

                      {items.length === 0 && (
                        <div className="flex h-full items-center justify-center">
                          <span className="text-xs text-[#e5e4e2]/40">Brak zajętości</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4 text-xs">
        <span className="text-[#e5e4e2]/60">Legenda:</span>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded border-l-4 border-blue-500/50 bg-blue-500/40" />
          <span className="text-[#e5e4e2]/80">Wydarzenie</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded border-l-4 border-green-500/50 bg-green-500/40" />
          <span className="text-[#e5e4e2]/80">Nieobecność (zatwierdzona)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded border-l-4 border-yellow-500/50 bg-yellow-500/40" />
          <span className="text-[#e5e4e2]/80">Nieobecność (oczekująca)</span>
        </div>
      </div>
    </div>
  );
};

export default EmployeesTimelineView;
