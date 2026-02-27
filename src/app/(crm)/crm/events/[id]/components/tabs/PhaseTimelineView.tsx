'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Trash2, GripVertical, AlertTriangle } from 'lucide-react';
import { EventPhase } from '@/store/api/eventPhasesApi';
import { TimelineTooltip, TooltipContent } from './TimelineTooltip';

interface PhaseTimelineViewProps {
  phases: EventPhase[];
  timelineBounds: { start: Date; end: Date };
  zoomLevel: 'days' | 'hours' | 'quarter_hours';
  selectedPhase: EventPhase | null;
  phaseConflicts: Record<string, boolean>;
  onPhaseClick: (phase: EventPhase) => void;
  onPhaseDoubleClick?: (phase: EventPhase) => void;
  onPhaseResize: (phaseId: string, newStart: Date, newEnd: Date) => void;
  onPhaseDelete: (phaseId: string) => void;
  eventStartDate?: string;
  eventEndDate?: string;
}

type ResizeHandle = 'start' | 'end' | null;

export const PhaseTimelineView: React.FC<PhaseTimelineViewProps> = ({
  phases,
  timelineBounds,
  zoomLevel,
  selectedPhase,
  phaseConflicts,
  onPhaseClick,
  onPhaseDoubleClick,
  onPhaseResize,
  onPhaseDelete,
  eventStartDate,
  eventEndDate,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const timeAxisRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState<{ phaseId: string; handle: ResizeHandle }>({
    phaseId: '',
    handle: null,
  });
  const [hoveredPhase, setHoveredPhase] = useState<string | null>(null);
  const [tooltipState, setTooltipState] = useState<{ x: number; y: number; phase: EventPhase | null }>({ x: 0, y: 0, phase: null });
  const [currentTime, setCurrentTime] = useState(new Date());

  const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();

  const getPhasePosition = (phase: EventPhase) => {
    const start = new Date(phase.start_time).getTime();
    const end = new Date(phase.end_time).getTime();

    const left = ((start - timelineBounds.start.getTime()) / totalDuration) * 100;
    const width = ((end - start) / totalDuration) * 100;

    return { left: `${Math.max(0, left)}%`, width: `${Math.max(1, width)}%` };
  };

  const formatTimeLabel = (date: Date): string => {
    if (zoomLevel === 'days') {
      return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
    } else if (zoomLevel === 'hours') {
      return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    } else {
      // W widoku kwadransa pokazuj pełne godziny z godziną, a kwadransy tylko minuty
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

    let interval: number;
    if (zoomLevel === 'days') {
      interval = 24 * 60 * 60 * 1000;
    } else if (zoomLevel === 'hours') {
      interval = 60 * 60 * 1000;
    } else {
      interval = 15 * 60 * 1000;
    }

    let current = new Date(Math.ceil(start.getTime() / interval) * interval);
    while (current <= end) {
      markers.push(new Date(current));
      current = new Date(current.getTime() + interval);
    }

    return markers;
  };

  const timeMarkers = generateTimeMarkers();

  // Update current time every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  // Calculate "NOW" line position
  const nowPosition = useMemo(() => {
    const now = currentTime.getTime();
    const start = timelineBounds.start.getTime();
    const end = timelineBounds.end.getTime();

    if (now < start || now > end) return null;

    const position = ((now - start) / totalDuration) * 100;
    return position;
  }, [currentTime, timelineBounds, totalDuration]);

  // Wykryj nakładające się fazy
  const getOverlappingPhases = (phase: EventPhase): EventPhase[] => {
    const phaseStart = new Date(phase.start_time).getTime();
    const phaseEnd = new Date(phase.end_time).getTime();

    return phases.filter(p => {
      if (p.id === phase.id) return false;
      const pStart = new Date(p.start_time).getTime();
      const pEnd = new Date(p.end_time).getTime();
      return (phaseStart < pEnd && phaseEnd > pStart);
    });
  };

  const handleResizeStart = (phaseId: string, handle: 'start' | 'end', e: React.MouseEvent) => {
    e.stopPropagation();
    setResizing({ phaseId, handle });
    setHoveredPhase(null); // Zatrzymaj hover podczas resizing
  };

  useEffect(() => {
    if (!resizing.phaseId || !resizing.handle || !containerRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(1, x / rect.width));
      const newTime = new Date(timelineBounds.start.getTime() + percent * totalDuration);

      const phase = phases.find((p) => p.id === resizing.phaseId);
      if (!phase) return;

      const startTime = new Date(phase.start_time);
      const endTime = new Date(phase.end_time);

      if (resizing.handle === 'start') {
        if (newTime < endTime) {
          onPhaseResize(resizing.phaseId, newTime, endTime);
        }
      } else {
        if (newTime > startTime) {
          onPhaseResize(resizing.phaseId, startTime, newTime);
        }
      }
    };

    const handleMouseUp = () => {
      setResizing({ phaseId: '', handle: null });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, phases, timelineBounds, totalDuration, onPhaseResize]);

  const getPhaseDuration = (phase: EventPhase): string => {
    const start = new Date(phase.start_time);
    const end = new Date(phase.end_time);
    const duration = end.getTime() - start.getTime();

    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  };

  // Algorytm układania faz w liniach (rows) - fazy nakładające się trafiają do różnych linii
  // USUNIĘTE - system rzędów zastąpiony nakładaniem
  const getPhaseLayoutOLD = (): Map<string, number> => {
    const layout = new Map<string, number>();
    const rows: Array<{ endTime: number; phases: EventPhase[] }> = [];

    // Sortuj fazy według czasu rozpoczęcia
    const sortedPhases = [...phases].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    sortedPhases.forEach((phase) => {
      const phaseStart = new Date(phase.start_time).getTime();
      const phaseEnd = new Date(phase.end_time).getTime();

      // Znajdź pierwszy rząd, gdzie faza się zmieści (nie nakłada się z żadną fazą w tym rzędzie)
      let rowIndex = rows.findIndex((row) => row.endTime <= phaseStart);

      if (rowIndex === -1) {
        // Brak wolnego rzędu - utwórz nowy
        rowIndex = rows.length;
        rows.push({ endTime: phaseEnd, phases: [phase] });
      } else {
        // Dodaj do istniejącego rzędu
        rows[rowIndex].endTime = phaseEnd;
        rows[rowIndex].phases.push(phase);
      }

      layout.set(phase.id, rowIndex);
    });

    return layout;
  };

  // Stała wysokość dla pojedynczego paska faz (wszystkie nakładają się)
  const containerHeight = 80;

  return (
    <div ref={containerRef} className="relative h-full p-6">
      {/* Time Axis - Sticky */}
      <div ref={timeAxisRef} className="top-0 z-10 bg-[#0f1119] relative mb-6 h-10 border-b-2 border-[#d3bb73]/20">
        {/* Główne godziny wydarzenia (agenda/deklaracja dla klienta) */}
        {eventStartDate && eventEndDate && (
          <div
            className="absolute top-0 h-full bg-[#d3bb73]/5 border-l-2 border-r-2 border-[#d3bb73]/30"
            style={{
              left: `${((new Date(eventStartDate).getTime() - timelineBounds.start.getTime()) / totalDuration) * 100}%`,
              width: `${((new Date(eventEndDate).getTime() - new Date(eventStartDate).getTime()) / totalDuration) * 100}%`,
            }}
            title="Główne godziny wydarzenia (agenda dla klienta)"
          >
            <div className="absolute left-2 top-0 text-[10px] font-semibold text-[#d3bb73] bg-[#1c1f33] px-1 rounded-b">
              Agenda
            </div>
          </div>
        )}

        {timeMarkers.map((marker, index) => {
          const left =
            ((marker.getTime() - timelineBounds.start.getTime()) / totalDuration) * 100;

          // Grubsza linia dla głównych godzin w widoku minut
          const isMainHour = zoomLevel === 'quarter_hours' && marker.getMinutes() % 15 === 0;
          const borderOpacity = isMainHour ? '20' : '10';

          return (
            <div
              key={index}
              className={`absolute top-0 h-full border-l border-[#d3bb73]/${borderOpacity}`}
              style={{ left: `${left}%` }}
            >
              <span className={`absolute left-1 top-2 text-xs ${isMainHour ? 'text-[#e5e4e2]/70 font-semibold' : 'text-[#e5e4e2]/50'}`}>
                {formatTimeLabel(marker)}
              </span>
            </div>
          );
        })}
      </div>

      {/* NOW Line - przez całą wysokość timeline */}
      {nowPosition !== null && (
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-20 pointer-events-none"
          style={{ left: `calc(${nowPosition}% + 24px)` }}
        >
          <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[10px] font-bold px-1 rounded whitespace-nowrap">
            Teraz
          </div>
        </div>
      )}

      {/* Phases - wszystkie na jednej wysokości z nakładaniem */}
      <div className="relative" style={{ minHeight: `${containerHeight}px` }}>
        {phases.map((phase, index) => {
          const position = getPhasePosition(phase);
          const isSelected = selectedPhase?.id === phase.id;
          const isHovered = hoveredPhase === phase.id;
          const hasConflict = phaseConflicts[phase.id];
          const phaseColor = phase.color || phase.phase_type?.color || '#3b82f6';
          const overlappingPhases = getOverlappingPhases(phase);

          return (
            <div
              key={phase.id}
              onMouseEnter={(e) => {
                if (!resizing.phaseId) {
                  setHoveredPhase(phase.id);
                  setTooltipState({ x: e.clientX, y: e.clientY, phase });
                }
              }}
              onMouseMove={(e) => {
                if (!resizing.phaseId && isHovered) {
                  setTooltipState({ x: e.clientX, y: e.clientY, phase });
                }
              }}
              onMouseLeave={() => {
                if (!resizing.phaseId) {
                  setHoveredPhase(null);
                  setTooltipState({ x: 0, y: 0, phase: null });
                }
              }}
              onClick={() => onPhaseClick(phase)}
              onDoubleClick={() => onPhaseDoubleClick?.(phase)}
              className={`absolute flex cursor-pointer items-center rounded-lg border-l-4 px-2 transition-all overflow-hidden ${
                isSelected ? 'shadow-xl' : isHovered ? 'shadow-lg' : 'shadow'
              } border-[var(--phase-color-border)] bg-[var(--phase-color)]`}
              style={{
                top: '10px',
                left: position.left,
                width: position.width,
                height: '60px',
                zIndex: isSelected ? 30 : isHovered ? 20 : 10 + index,
                '--phase-color': `${phaseColor}20`,
                '--phase-color-border': phaseColor,
                borderLeftColor: phaseColor,
              } as React.CSSProperties}
            >
              {/* Overlapping areas - przekreślone */}
              {overlappingPhases.map(overlappingPhase => {
                const phaseStart = new Date(phase.start_time).getTime();
                const phaseEnd = new Date(phase.end_time).getTime();
                const overlapStart = new Date(overlappingPhase.start_time).getTime();
                const overlapEnd = new Date(overlappingPhase.end_time).getTime();

                const intersectionStart = Math.max(phaseStart, overlapStart);
                const intersectionEnd = Math.min(phaseEnd, overlapEnd);

                if (intersectionStart >= intersectionEnd) return null;

                const phaseDuration = phaseEnd - phaseStart;
                const leftPercent = ((intersectionStart - phaseStart) / phaseDuration) * 100;
                const widthPercent = ((intersectionEnd - intersectionStart) / phaseDuration) * 100;

                return (
                  <div
                    key={overlappingPhase.id}
                    className="absolute top-0 bottom-0 pointer-events-none"
                    style={{
                      left: `${leftPercent}%`,
                      width: `${widthPercent}%`,
                      background: `repeating-linear-gradient(
                        45deg,
                        rgba(220, 38, 38, 0.15),
                        rgba(220, 38, 38, 0.15) 8px,
                        transparent 8px,
                        transparent 16px
                      )`,
                      borderLeft: '2px solid rgba(220, 38, 38, 0.5)',
                      borderRight: '2px solid rgba(220, 38, 38, 0.5)',
                    }}
                  />
                );
              })}

              {/* Resize Handle - Start */}
              <div
                onMouseDown={(e) => handleResizeStart(phase.id, 'start', e)}
                className={`absolute left-0 top-0 bottom-0 flex w-2 cursor-ew-resize items-center justify-center transition-colors ${
                  isHovered ? 'bg-[var(--phase-color-60)]' : 'bg-transparent'
                }`}
                style={{
                  '--phase-color-60': `${phaseColor}60`,
                } as React.CSSProperties}
              >
                {isHovered && (
                  <GripVertical
                    className="h-3 w-3"
                    style={{ color: phaseColor }}
                  />
                )}
              </div>

              {/* Phase Content */}
              <div className="flex-1 overflow-hidden px-2">
                <div className="mb-1 flex items-center gap-1">
                  <span className="truncate text-sm font-bold text-[#e5e4e2]">{phase.name}</span>
                  {hasConflict && (
                    <div className="group relative">
                      <AlertTriangle className="h-4 w-4 text-red-400" />
                      <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[#1c1f33] px-2 py-1 text-xs text-[#e5e4e2] shadow-lg group-hover:block">
                        Faza nakłada się z inną fazą!
                      </div>
                    </div>
                  )}
                </div>
                <div className="text-xs text-[#e5e4e2]/70">
                  {formatTimeLabel(new Date(phase.start_time))} -{' '}
                  {formatTimeLabel(new Date(phase.end_time))}
                  <span className="ml-2 text-[#e5e4e2]/50">({getPhaseDuration(phase)})</span>
                </div>
              </div>

              {/* Delete Button */}
              {isHovered && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onPhaseDelete(phase.id);
                  }}
                  className="mr-2 rounded p-1 text-[#e5e4e2]/60 transition-colors hover:bg-red-500/20 hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}

              {/* Resize Handle - End */}
              <div
                onMouseDown={(e) => handleResizeStart(phase.id, 'end', e)}
                className={`absolute right-0 top-0 bottom-0 flex w-2 cursor-ew-resize items-center justify-center transition-colors ${
                  isHovered ? 'bg-[var(--phase-color-60)]' : 'bg-transparent'
                }`}
                style={{
                  '--phase-color-60': `${phaseColor}60`,
                } as React.CSSProperties}
              >
                {isHovered && (
                  <GripVertical
                    className="h-3 w-3"
                    style={{ color: phaseColor }}
                  />
                )}
              </div>
            </div>
          );
        })}

        {/* NOW Line in phases area */}
        {nowPosition !== null && (
          <div
            className="absolute top-0 w-[2px] bg-red-500 pointer-events-none z-30"
            style={{ left: `${nowPosition}%`, height: `${containerHeight}px` }}
          />
        )}
      </div>

      {/* Tooltip */}
      <TimelineTooltip
        x={tooltipState.x}
        y={tooltipState.y}
        visible={!!tooltipState.phase && !resizing.phaseId}
        content={
          tooltipState.phase ? (
            <TooltipContent
              title={tooltipState.phase.name}
              startTime={formatTimeLabel(new Date(tooltipState.phase.start_time))}
              endTime={formatTimeLabel(new Date(tooltipState.phase.end_time))}
              details={[
                { label: 'Typ', value: tooltipState.phase.phase_type?.name || 'Nieokreślony' },
                { label: 'Czas trwania', value: getPhaseDuration(tooltipState.phase) },
              ]}
            />
          ) : null
        }
      />
    </div>
  );
};
