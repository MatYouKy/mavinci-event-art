'use client';

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  getClippedTimelinePosition,
  getFleetTimelineScale,
  isWithinBounds,
} from '@/lib/timeline';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Calendar,
  Wrench,
  MapPin,
  User,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

interface VehicleTimelineEntry {
  id: string;
  type: 'event' | 'maintenance';
  start_date: string;
  end_date: string;
  title: string;
  description: string;
  status: string;
  color: string;
  related_id: string;
  event_name?: string;
  driver_name?: string;
  location?: string;
}

type ZoomLevel = 'day' | 'week' | 'month';

interface VehicleSingleTimelineProps {
  vehicleId: string;
}

export default function VehicleSingleTimeline({ vehicleId }: VehicleSingleTimelineProps) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [timeline, setTimeline] = useState<VehicleTimelineEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('week');
  const timelineScale = useMemo(
    () => getFleetTimelineScale(currentDate, zoomLevel),
    [currentDate, zoomLevel],
  );

  const fetchTimeline = async () => {
    try {
      setIsLoading(true);

      const { start: startDate, end: endDate } = timelineScale;

      const { data, error } = await supabase.rpc('get_vehicle_timeline', {
        p_vehicle_id: vehicleId,
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
      });

      if (error) throw error;

      const entries = (data || []) as VehicleTimelineEntry[];
      const eventIds = entries
        .filter((entry) => entry.type === 'event')
        .map((entry) => entry.related_id);
      const { data: eventBounds, error: boundsError } = eventIds.length
        ? await supabase.from('event_timeline_bounds').select('event_id, timeline_start, timeline_end').in('event_id', eventIds)
        : { data: [], error: null };
      if (boundsError) throw boundsError;
      const boundsByEvent = new Map(
        (eventBounds || []).map((bounds: any) => [bounds.event_id, bounds]),
      );
      setTimeline(entries.map((entry) => {
        const bounds: any = entry.type === 'event' ? boundsByEvent.get(entry.related_id) : null;
        return bounds ? { ...entry, start_date: bounds.timeline_start, end_date: bounds.timeline_end } : entry;
      }));
    } catch (error) {
      console.error('Error fetching timeline:', error);
      showSnackbar('Błąd podczas ładowania timeline', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTimeline();
  }, [vehicleId, timelineScale]);

  const { columns, columnWidth, totalWidth } = timelineScale;

  const navigatePrevious = () => {
    const newDate = new Date(currentDate);
    if (zoomLevel === 'day') {
      newDate.setDate(newDate.getDate() - 7);
    } else if (zoomLevel === 'week') {
      newDate.setDate(newDate.getDate() - 28);
    } else {
      newDate.setMonth(newDate.getMonth() - 3);
    }
    setCurrentDate(newDate);
  };

  const navigateNext = () => {
    const newDate = new Date(currentDate);
    if (zoomLevel === 'day') {
      newDate.setDate(newDate.getDate() + 7);
    } else if (zoomLevel === 'week') {
      newDate.setDate(newDate.getDate() + 28);
    } else {
      newDate.setMonth(newDate.getMonth() + 3);
    }
    setCurrentDate(newDate);
  };

  const navigateToday = () => {
    setCurrentDate(new Date());
  };

  const getEntryPosition = (startDate: string, endDate: string) =>
    getClippedTimelinePosition(
      new Date(startDate),
      new Date(endDate),
      timelineScale,
      totalWidth,
      columnWidth * 0.25,
    );

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const handleEntryClick = (entry: VehicleTimelineEntry) => {
    if (entry.type === 'event' && entry.related_id) {
      router.push(`/crm/events/${entry.related_id}`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[#d3bb73]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[#e5e4e2]">Timeline wykorzystania</h3>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Widok wykorzystania pojazdu na wydarzeniach i w serwisie
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Nawigacja dat */}
          <div className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-1">
            <button
              onClick={navigatePrevious}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Poprzedni okres"
            >
              <ChevronLeft className="h-4 w-4 text-[#e5e4e2]" />
            </button>

            <button
              onClick={navigateToday}
              className="rounded px-3 py-2 text-sm font-medium text-[#e5e4e2] hover:bg-[#d3bb73]/10"
            >
              Dzisiaj
            </button>

            <button
              onClick={navigateNext}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Następny okres"
            >
              <ChevronRight className="h-4 w-4 text-[#e5e4e2]" />
            </button>
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-1">
            <button
              onClick={() => setZoomLevel('day')}
              className={`rounded px-3 py-2 text-sm font-medium transition-colors ${
                zoomLevel === 'day'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2] hover:bg-[#d3bb73]/10'
              }`}
              title="Widok dzienny"
            >
              <ZoomIn className="h-4 w-4" />
            </button>

            <button
              onClick={() => setZoomLevel('week')}
              className={`rounded px-3 py-2 text-sm font-medium transition-colors ${
                zoomLevel === 'week'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2] hover:bg-[#d3bb73]/10'
              }`}
              title="Widok tygodniowy"
            >
              <Calendar className="h-4 w-4" />
            </button>

            <button
              onClick={() => setZoomLevel('month')}
              className={`rounded px-3 py-2 text-sm font-medium transition-colors ${
                zoomLevel === 'month'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'text-[#e5e4e2] hover:bg-[#d3bb73]/10'
              }`}
              title="Widok miesięczny"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Timeline Grid */}
      <div className="overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="overflow-x-auto">
          {/* Header z datami */}
          <div className="flex border-b border-[#d3bb73]/20 bg-[#0f1119]">
            {columns.map((date, idx) => (
              <div
                key={idx}
                className={`flex-shrink-0 border-r border-[#d3bb73]/10 p-2 text-center ${
                  isToday(date) ? 'bg-[#d3bb73]/20' : ''
                }`}
                style={{ width: `${columnWidth}px` }}
              >
                <div className="text-xs font-medium text-[#e5e4e2]">
                  {date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}
                </div>
                <div className="text-xs text-[#e5e4e2]/60">
                  {date.toLocaleDateString('pl-PL', { weekday: 'short' })}
                </div>
              </div>
            ))}
          </div>

          {/* Timeline Content */}
          <div className="relative min-h-[200px]">
            {/* Today indicator */}
            {(() => {
              if (!isWithinBounds(new Date(), timelineScale)) return null;
              const todayPosition = getClippedTimelinePosition(
                new Date(),
                new Date(Date.now() + 1),
                timelineScale,
                totalWidth,
              )?.offset;
              return (
                <div
                  className="pointer-events-none absolute top-0 z-20 h-full w-0.5 bg-red-500"
                  style={{ left: `${todayPosition}px` }}
                />
              );
            })()}

            {/* Grid lines */}
            {columns.map((_, idx) => (
              <div
                key={idx}
                className="absolute top-0 h-full border-r border-[#d3bb73]/5"
                style={{ left: `${idx * columnWidth}px`, width: `${columnWidth}px` }}
              />
            ))}

            {/* Timeline entries */}
            <div
              className="relative py-4"
              style={{ width: `${columns.length * columnWidth}px`, minHeight: '200px' }}
            >
              {timeline.length === 0 ? (
                <div className="flex h-32 items-center justify-center">
                  <p className="text-sm text-[#e5e4e2]/60">
                    Brak wydarzeń w wybranym okresie czasu
                  </p>
                </div>
              ) : (
                <>
                  {timeline.map((entry, index) => {
                    const position = getEntryPosition(entry.start_date, entry.end_date);
                    if (!position) return null;
                    const top = 20 + (index % 3) * 60;

                    return (
                      <div
                        key={entry.id}
                        className="absolute cursor-pointer overflow-hidden rounded px-2 py-2 text-xs text-white transition-all hover:z-10 hover:shadow-lg"
                        style={{
                          left: `${position.offset}px`,
                          top: `${top}px`,
                          width: `${position.size}px`,
                          backgroundColor: entry.color,
                        }}
                        onClick={() => handleEntryClick(entry)}
                        title={`${entry.title}\n${entry.description}`}
                      >
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1 font-medium">
                            {entry.type === 'event' ? (
                              <Calendar className="h-3 w-3 flex-shrink-0" />
                            ) : (
                              <Wrench className="h-3 w-3 flex-shrink-0" />
                            )}
                            <span className="truncate">{entry.title}</span>
                          </div>

                          {entry.location && position.size > 100 && (
                            <div className="flex items-center gap-1 text-[10px] opacity-80">
                              <MapPin className="h-2.5 w-2.5 flex-shrink-0" />
                              <span className="truncate">{entry.location}</span>
                            </div>
                          )}

                          {entry.driver_name && position.size > 150 && (
                            <div className="flex items-center gap-1 text-[10px] opacity-80">
                              <User className="h-2.5 w-2.5 flex-shrink-0" />
                              <span className="truncate">{entry.driver_name}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-4 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-[#3b82f6]" />
          <span className="text-sm text-[#e5e4e2]/80">Wydarzenie zaplanowane</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-[#10b981]" />
          <span className="text-sm text-[#e5e4e2]/80">Wydarzenie potwierdzone</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-[#f59e0b]" />
          <span className="text-sm text-[#e5e4e2]/80">Serwis w trakcie</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-[#ef4444]" />
          <span className="text-sm text-[#e5e4e2]/80">Anulowane/Niepomyślne</span>
        </div>
      </div>
    </div>
  );
}
