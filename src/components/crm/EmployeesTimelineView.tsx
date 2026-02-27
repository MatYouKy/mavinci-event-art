'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar, SlidersHorizontal, X, Users, Clock, Filter } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { IEmployee } from '@/app/(crm)/crm/employees/type';
import { EmployeeAvatar } from '../EmployeeAvatar';

type ZoomLevel = 'month' | 'week' | 'day' | 'hours';

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
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('week');
  const [prevZoomLevel, setPrevZoomLevel] = useState<ZoomLevel>('week');
  const [timelineBounds, setTimelineBounds] = useState<TimelineBounds>({
    start: (() => {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      return now;
    })(),
    end: (() => {
      const end = new Date();
      end.setDate(end.getDate() + 7);
      end.setHours(23, 59, 59, 999);
      return end;
    })(),
  });
  const [timelineData, setTimelineData] = useState<Record<string, TimelineItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [selectedAbsenceTypes, setSelectedAbsenceTypes] = useState<string[]>([]);
  const [quickDateRange, setQuickDateRange] = useState<'week' | 'month' | 'custom'>('week');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const filteredEmployees = useMemo(() => {
    if (selectedEmployeeIds.length === 0) return employees;
    return employees.filter((e) => selectedEmployeeIds.includes(e.id));
  }, [employees, selectedEmployeeIds]);

  const employeeIds = useMemo(() => filteredEmployees.map((e) => e.id), [filteredEmployees]);

  useEffect(() => {
    fetchTimelineData();
  }, [employeeIds, timelineBounds]);

  useEffect(() => {
    if (zoomLevel !== prevZoomLevel) {
      adjustTimelineForZoom();
      setPrevZoomLevel(zoomLevel);
    }
  }, [zoomLevel]);

  const adjustTimelineForZoom = () => {
    const now = new Date();
    const isToday =
      timelineBounds.start.getDate() === now.getDate() &&
      timelineBounds.start.getMonth() === now.getMonth() &&
      timelineBounds.start.getFullYear() === now.getFullYear();

    if (!isToday) return;

    now.setHours(0, 0, 0, 0);

    switch (zoomLevel) {
      case 'month':
        const monthEnd = new Date(now);
        monthEnd.setDate(monthEnd.getDate() + 30);
        monthEnd.setHours(23, 59, 59, 999);
        setTimelineBounds({ start: now, end: monthEnd });
        break;

      case 'week':
        const weekEnd = new Date(now);
        weekEnd.setDate(weekEnd.getDate() + 7);
        weekEnd.setHours(23, 59, 59, 999);
        setTimelineBounds({ start: now, end: weekEnd });
        break;

      case 'day':
        const dayEnd = new Date(now);
        dayEnd.setHours(23, 59, 59, 999);
        setTimelineBounds({ start: now, end: dayEnd });
        break;

      case 'hours':
        const nowWithTime = new Date();
        const hoursStart = new Date(nowWithTime);
        hoursStart.setMinutes(0, 0, 0);
        const hoursEnd = new Date(hoursStart);
        hoursEnd.setHours(hoursStart.getHours() + 12);
        setTimelineBounds({ start: hoursStart, end: hoursEnd });
        break;
    }
  };

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

        if (selectedAbsenceTypes.length > 0 && item.item_type === 'absence') {
          if (!selectedAbsenceTypes.includes(item.item_metadata?.absence_type)) {
            return;
          }
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

  const getPixelsPerDay = () => {
    const durationInDays = (timelineBounds.end.getTime() - timelineBounds.start.getTime()) / (1000 * 60 * 60 * 24);

    switch (zoomLevel) {
      case 'month':
        return 40;
      case 'week':
        return 120;
      case 'day':
        return 1200;
      case 'hours':
        return 2400;
      default:
        return 120;
    }
  };

  const getMinWidth = () => {
    const durationInDays = (timelineBounds.end.getTime() - timelineBounds.start.getTime()) / (1000 * 60 * 60 * 24);
    const pixelsPerDay = getPixelsPerDay();
    return `${Math.max(1200, durationInDays * pixelsPerDay)}px`;
  };

  const shiftTimeline = (direction: 'left' | 'right') => {
    const duration = timelineBounds.end.getTime() - timelineBounds.start.getTime();
    const shift = duration;

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
    setQuickDateRange('custom');
  };

  const setQuickRange = (range: 'week' | 'month') => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (range === 'week') {
      const end = new Date(now);
      end.setDate(end.getDate() + 7);
      end.setHours(23, 59, 59, 999);
      setTimelineBounds({ start: now, end });
      setZoomLevel('week');
    } else if (range === 'month') {
      const end = new Date(now);
      end.setDate(end.getDate() + 30);
      end.setHours(23, 59, 59, 999);
      setTimelineBounds({ start: now, end });
      setZoomLevel('month');
    }
    setQuickDateRange(range);
  };

  const applyCustomDateRange = () => {
    if (customStartDate && customEndDate) {
      const start = new Date(customStartDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(customEndDate);
      end.setHours(23, 59, 59, 999);

      if (start < end) {
        setTimelineBounds({ start, end });
        setQuickDateRange('custom');
        setShowFilters(false);
      }
    }
  };

  const resetToToday = () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    switch (zoomLevel) {
      case 'month':
        const monthEnd = new Date(now);
        monthEnd.setDate(monthEnd.getDate() + 30);
        monthEnd.setHours(23, 59, 59, 999);
        setTimelineBounds({ start: now, end: monthEnd });
        break;

      case 'week':
        const weekEnd = new Date(now);
        weekEnd.setDate(weekEnd.getDate() + 7);
        weekEnd.setHours(23, 59, 59, 999);
        setTimelineBounds({ start: now, end: weekEnd });
        break;

      case 'day':
        const dayEnd = new Date(now);
        dayEnd.setHours(23, 59, 59, 999);
        setTimelineBounds({ start: now, end: dayEnd });
        break;

      case 'hours':
        const nowWithTime = new Date();
        const hoursStart = new Date(nowWithTime);
        hoursStart.setMinutes(0, 0, 0);
        const hoursEnd = new Date(hoursStart);
        hoursEnd.setHours(hoursStart.getHours() + 12);
        setTimelineBounds({ start: hoursStart, end: hoursEnd });
        break;

      default:
        const defaultEnd = new Date(now);
        defaultEnd.setDate(defaultEnd.getDate() + 7);
        defaultEnd.setHours(23, 59, 59, 999);
        setTimelineBounds({ start: now, end: defaultEnd });
    }

    setQuickDateRange('custom');
  };

  const getItemPosition = (item: TimelineItem) => {
    const start = new Date(item.item_start).getTime();
    const end = new Date(item.item_end).getTime();
    const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();

    const left = ((start - timelineBounds.start.getTime()) / totalDuration) * 100;
    const width = ((end - start) / totalDuration) * 100;

    return {
      left: `${Math.max(0, left)}%`,
      width: `${Math.max(0.5, width)}%`,
    };
  };

  const formatTimeLabel = (date: Date): string => {
    switch (zoomLevel) {
      case 'month':
        return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
      case 'week':
        return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
      case 'day':
        return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      case 'hours':
        return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      default:
        return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
    }
  };

  const generateTimeMarkers = () => {
    const markers: Date[] = [];
    const start = new Date(timelineBounds.start);
    const end = new Date(timelineBounds.end);
    let current = new Date(start);

    switch (zoomLevel) {
      case 'month':
        current.setHours(0, 0, 0, 0);
        while (current <= end) {
          markers.push(new Date(current));
          current.setDate(current.getDate() + 1);
        }
        break;
      case 'week':
        current.setHours(0, 0, 0, 0);
        while (current <= end) {
          markers.push(new Date(current));
          current.setDate(current.getDate() + 1);
        }
        break;
      case 'day':
        current.setMinutes(0, 0, 0);
        while (current <= end) {
          markers.push(new Date(current));
          current.setHours(current.getHours() + 1);
        }
        break;
      case 'hours':
        current.setMinutes(0, 0, 0);
        while (current <= end) {
          markers.push(new Date(current));
          current.setMinutes(current.getMinutes() + 30);
        }
        break;
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

  const absenceTypes = [
    { value: 'vacation', label: 'Urlop wypoczynkowy' },
    { value: 'sick_leave', label: 'Zwolnienie lekarskie' },
    { value: 'unpaid_leave', label: 'Urlop bezpłatny' },
    { value: 'training', label: 'Szkolenie' },
    { value: 'remote_work', label: 'Praca zdalna' },
    { value: 'other', label: 'Inne' },
  ];

  const toggleEmployeeFilter = (employeeId: string) => {
    setSelectedEmployeeIds((prev) =>
      prev.includes(employeeId) ? prev.filter((id) => id !== employeeId) : [...prev, employeeId]
    );
  };

  const toggleAbsenceTypeFilter = (type: string) => {
    setSelectedAbsenceTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const clearAllFilters = () => {
    setSelectedEmployeeIds([]);
    setSelectedAbsenceTypes([]);
    setQuickRange('week');
  };

  const formatDateRange = () => {
    const start = timelineBounds.start.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
    const end = timelineBounds.end.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
    return `${start} - ${end}`;
  };

  const getDateButtonLabel = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(timelineBounds.start);
    startDate.setHours(0, 0, 0, 0);

    const dayDiff = Math.round((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    switch (zoomLevel) {
      case 'month':
        return startDate.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });

      case 'week':
        if (dayDiff === 0) return 'Obecny tydzień';
        if (dayDiff === 7) return 'Przyszły tydzień';
        if (dayDiff === -7) return 'Poprzedni tydzień';
        return startDate.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' });

      case 'day':
        if (dayDiff === 0) return 'Dzisiaj';
        if (dayDiff === 1) return 'Jutro';
        if (dayDiff === 2) return 'Pojutrze';
        if (dayDiff === -1) return 'Wczoraj';
        if (dayDiff === -2) return 'Przedwczoraj';
        return startDate.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' });

      case 'hours':
        const now = new Date();
        const hoursDiff = Math.abs(Math.round((timelineBounds.start.getTime() - now.getTime()) / (1000 * 60 * 60)));

        if (hoursDiff < 1) return 'Teraz';
        if (dayDiff === 0) return 'Dzisiaj';
        if (dayDiff === 1) return 'Jutro';
        if (dayDiff === -1) return 'Wczoraj';
        return startDate.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' });

      default:
        return 'Dzisiaj';
    }
  };

  const minWidth = getMinWidth();

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
      {/* Header with date range and filters */}
      <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-[#e5e4e2]">Oś czasu pracowników</h3>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">{formatDateRange()}</p>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtry
            {(selectedEmployeeIds.length > 0 || selectedAbsenceTypes.length > 0) && (
              <span className="rounded-full bg-[#d3bb73] px-2 py-0.5 text-xs text-[#1c1f33]">
                {selectedEmployeeIds.length + selectedAbsenceTypes.length}
              </span>
            )}
          </button>
        </div>

        {/* Active Filters Summary */}
        {(selectedEmployeeIds.length > 0 || selectedAbsenceTypes.length > 0 || quickDateRange === 'custom') && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#d3bb73]/10 pt-3">
            <span className="text-xs text-[#e5e4e2]/60">Aktywne filtry:</span>
            {selectedEmployeeIds.map((id) => {
              const emp = employees.find((e) => e.id === id);
              return (
                <span
                  key={id}
                  className="flex items-center gap-1 rounded bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#e5e4e2]"
                >
                  {emp?.nickname || `${emp?.name} ${emp?.surname}`}
                  <X
                    className="h-3 w-3 cursor-pointer hover:text-[#d3bb73]"
                    onClick={() => toggleEmployeeFilter(id)}
                  />
                </span>
              );
            })}
            {selectedAbsenceTypes.map((type) => {
              const typeLabel = absenceTypes.find((t) => t.value === type)?.label;
              return (
                <span
                  key={type}
                  className="flex items-center gap-1 rounded bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#e5e4e2]"
                >
                  {typeLabel}
                  <X
                    className="h-3 w-3 cursor-pointer hover:text-[#d3bb73]"
                    onClick={() => toggleAbsenceTypeFilter(type)}
                  />
                </span>
              );
            })}
            {quickDateRange === 'custom' && (
              <span className="flex items-center gap-1 rounded bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#e5e4e2]">
                <Calendar className="h-3 w-3" />
                Niestandardowy zakres
              </span>
            )}
            <button
              onClick={clearAllFilters}
              className="ml-auto text-xs text-[#d3bb73] hover:underline"
            >
              Wyczyść wszystkie
            </button>
          </div>
        )}
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-lg font-medium text-[#e5e4e2]">Filtry</h4>
            <button
              onClick={() => setShowFilters(false)}
              className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-6">
            {/* Quick Date Ranges */}
            <div>
              <label className="mb-3 block text-sm font-medium text-[#e5e4e2]">Zakres czasowy</label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setQuickRange('week')}
                  className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                    quickDateRange === 'week'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'bg-[#d3bb73]/10 text-[#e5e4e2] hover:bg-[#d3bb73]/20'
                  }`}
                >
                  Tydzień
                </button>
                <button
                  onClick={() => setQuickRange('month')}
                  className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                    quickDateRange === 'month'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'bg-[#d3bb73]/10 text-[#e5e4e2] hover:bg-[#d3bb73]/20'
                  }`}
                >
                  Miesiąc
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-2 block text-xs text-[#e5e4e2]/60">Data początkowa</label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs text-[#e5e4e2]/60">Data końcowa</label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>
              </div>
              {customStartDate && customEndDate && (
                <button
                  onClick={applyCustomDateRange}
                  className="mt-2 w-full rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                >
                  Zastosuj niestandardowy zakres
                </button>
              )}
            </div>

            {/* Employee Filter */}
            <div>
              <label className="mb-3 flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
                <Users className="h-4 w-4" />
                Pracownicy ({selectedEmployeeIds.length}/{employees.length})
              </label>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3">
                {employees.map((employee) => (
                  <label
                    key={employee.id}
                    className="flex cursor-pointer items-center gap-3 rounded p-2 transition-colors hover:bg-[#d3bb73]/10"
                  >
                    <input
                      type="checkbox"
                      checked={selectedEmployeeIds.includes(employee.id)}
                      onChange={() => toggleEmployeeFilter(employee.id)}
                      className="h-4 w-4 rounded border-[#d3bb73]/30"
                    />
                    <EmployeeAvatar employee={employee} size={32} />
                    <span className="text-sm text-[#e5e4e2]">
                      {employee.nickname || `${employee.name} ${employee.surname}`}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Absence Type Filter */}
            <div>
              <label className="mb-3 flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
                <Filter className="h-4 w-4" />
                Typy nieobecności ({selectedAbsenceTypes.length}/{absenceTypes.length})
              </label>
              <div className="space-y-2 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3">
                {absenceTypes.map((type) => (
                  <label
                    key={type.value}
                    className="flex cursor-pointer items-center gap-3 rounded p-2 transition-colors hover:bg-[#d3bb73]/10"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAbsenceTypes.includes(type.value)}
                      onChange={() => toggleAbsenceTypeFilter(type.value)}
                      className="h-4 w-4 rounded border-[#d3bb73]/30"
                    />
                    <span className="text-sm text-[#e5e4e2]">{type.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

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
            className="min-w-[140px] rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/20"
            title="Przejdź do bieżącego okresu"
          >
            <Calendar className="mr-2 inline h-4 w-4" />
            {getDateButtonLabel()}
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
          {(['month', 'week', 'day', 'hours'] as ZoomLevel[]).map((level) => (
            <button
              key={level}
              onClick={() => setZoomLevel(level)}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                zoomLevel === level
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#d3bb73]/10 text-[#e5e4e2] hover:bg-[#d3bb73]/20'
              }`}
            >
              {level === 'month' ? 'Miesiąc' : level === 'week' ? 'Tydzień' : level === 'day' ? 'Dzień' : 'Godziny'}
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
            <div className="sticky top-0 z-10 flex border-b border-[#d3bb73]/10 bg-[#1c1f33]">
              {/* Empty space for employee info column */}
              <div className="w-64 flex-shrink-0 border-r border-[#d3bb73]/10" />

              {/* Timeline header */}
              <div className="relative h-16 flex-1">
                {timeMarkers.map((marker, idx) => {
                  const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();
                  const left = ((marker.getTime() - timelineBounds.start.getTime()) / totalDuration) * 100;
                  const isFullDay = marker.getHours() === 0;
                  const isFullHour = marker.getMinutes() === 0;

                  return (
                    <div
                      key={idx}
                      className="absolute top-0 h-full"
                      style={{ left: `${left}%` }}
                    >
                      <div
                        className={`h-full border-l ${
                          isFullDay
                            ? 'border-[#e5e4e2]/30'
                            : isFullHour
                            ? 'border-[#e5e4e2]/10'
                            : 'border-[#e5e4e2]/3'
                        }`}
                      />
                      <div
                        className={`absolute left-2 top-2 whitespace-nowrap text-xs ${
                          isFullDay ? 'font-semibold text-[#e5e4e2]' : 'text-[#e5e4e2]/60'
                        }`}
                      >
                        {formatTimeLabel(marker)}
                      </div>
                    </div>
                  );
                })}

                {/* Today/Now indicator line */}
                {(() => {
                  const now = new Date();
                  const nowTime = now.getTime();
                  const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();

                  if (nowTime >= timelineBounds.start.getTime() && nowTime <= timelineBounds.end.getTime()) {
                    const leftPos = ((nowTime - timelineBounds.start.getTime()) / totalDuration) * 100;
                    return (
                      <div
                        className="absolute top-0 h-full"
                        style={{ left: `${leftPos}%` }}
                      >
                        <div className="h-full w-0.5 bg-[#d3bb73] shadow-lg shadow-[#d3bb73]/50" />
                        <div className="absolute -top-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[#d3bb73] px-2 py-0.5 text-xs font-semibold text-[#1c1f33]">
                          Teraz
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>

            {/* Employee rows */}
            {filteredEmployees.map((employee) => {
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
                        const isFullDay = marker.getHours() === 0;
                        const isFullHour = marker.getMinutes() === 0;
                        return (
                          <div
                            key={idx}
                            className={`absolute top-0 h-full border-l ${
                              isFullDay
                                ? 'border-[#e5e4e2]/12'
                                : isFullHour
                                ? 'border-[#e5e4e2]/6'
                                : 'border-[#e5e4e2]/2'
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

                      {/* Today/Now indicator line for this row */}
                      {(() => {
                        const now = new Date();
                        const nowTime = now.getTime();
                        const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();

                        if (nowTime >= timelineBounds.start.getTime() && nowTime <= timelineBounds.end.getTime()) {
                          const leftPos = ((nowTime - timelineBounds.start.getTime()) / totalDuration) * 100;
                          return (
                            <div
                              className="pointer-events-none absolute top-0 h-full"
                              style={{ left: `${leftPos}%` }}
                            >
                              <div className="h-full w-0.5 bg-[#d3bb73] opacity-50" />
                            </div>
                          );
                        }
                        return null;
                      })()}
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
        <div className="flex items-center gap-2">
          <div className="h-3 w-0.5 bg-[#d3bb73]" />
          <span className="text-[#e5e4e2]/80">Bieżąca data/czas</span>
        </div>
        <div className="ml-auto text-[#e5e4e2]/60">
          Wyświetlam {filteredEmployees.length} pracowników
        </div>
      </div>
    </div>
  );
};

export default EmployeesTimelineView;
