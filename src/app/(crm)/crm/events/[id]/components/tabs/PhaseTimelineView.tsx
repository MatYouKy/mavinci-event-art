'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Trash2, GripVertical, AlertTriangle } from 'lucide-react';
import { EventPhase } from '@/store/api/eventPhasesApi';
import { TimelineTooltip, TooltipContent } from './TimelineTooltip';
import {
  DAY_MS,
  generateTimeMarkers,
  getClippedTimelinePosition,
  getTimeMarkerInterval,
} from '@/lib/timeline';
import { useTimelineDrag, type DragMode } from './useTimelineDrag';

interface PhaseTimelineViewProps {
  phases: EventPhase[];
  timelineBounds: { start: Date; end: Date };
  zoomLevel: 'days' | 'hours' | 'quarter_hours';
  selectedPhase: EventPhase | null;
  phaseConflicts: Record<string, boolean>;
  onPhaseClick: (phase: EventPhase) => void;
  onPhaseDoubleClick?: (phase: EventPhase) => void;
  onPhaseContextMenu?: (phase: EventPhase) => void;
  onPhaseResize: (phaseId: string, newStart: Date, newEnd: Date) => void;
  onPhaseDelete: (phaseId: string) => void;
  eventStartDate?: string;
  eventEndDate?: string;
}

export const PhaseTimelineView: React.FC<PhaseTimelineViewProps> = ({
  phases,
  timelineBounds,
  zoomLevel,
  selectedPhase,
  phaseConflicts,
  onPhaseClick,
  onPhaseDoubleClick,
  onPhaseContextMenu,
  onPhaseResize,
  onPhaseDelete,
  eventStartDate,
  eventEndDate,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const timeAxisRef = useRef<HTMLDivElement>(null);
  const [dragPreview, setDragPreview] = useState<{
    phaseId: string;
    start: Date;
    end: Date;
  } | null>(null);
  const [activePhaseId, setActivePhaseId] = useState<string | null>(null);
  const activePhaseIdRef = useRef<string | null>(null);
  const dragHasMovedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const [hoveredPhase, setHoveredPhase] = useState<string | null>(null);
  const [tooltipState, setTooltipState] = useState<{ x: number; y: number; phase: EventPhase | null }>({ x: 0, y: 0, phase: null });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [trackWidth, setTrackWidth] = useState(1200);

  const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();

  const { dragMode, startDrag } = useTimelineDrag({
    timelineBounds,
    zoomLevel,
    onDragMove: (start, end) => {
      const phaseId = activePhaseIdRef.current;
      if (!phaseId) return;
      dragHasMovedRef.current = true;
      setDragPreview({ phaseId, start, end });
    },
    onDragEnd: (start, end) => {
      const phaseId = activePhaseIdRef.current;
      if (phaseId && dragHasMovedRef.current) {
        suppressClickRef.current = true;
        onPhaseResize(phaseId, start, end);
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      activePhaseIdRef.current = null;
      dragHasMovedRef.current = false;
      setActivePhaseId(null);
      setDragPreview(null);
    },
  });

  const getPhasePosition = (phase: EventPhase) => {
    const preview = dragPreview?.phaseId === phase.id ? dragPreview : null;
    const minimumWidthPercent = Math.min(1, (12 / Math.max(trackWidth, 1)) * 100);
    const position = getClippedTimelinePosition(
      preview?.start ?? new Date(phase.start_time),
      preview?.end ?? new Date(phase.end_time),
      timelineBounds,
      100,
      minimumWidthPercent,
    );
    return position
      ? { left: `${position.offset}%`, width: `${position.size}%` }
      : { left: '0%', width: '0%' };
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

  const timeMarkers = useMemo(
    () => generateTimeMarkers(timelineBounds, zoomLevel, trackWidth),
    [timelineBounds, zoomLevel, trackWidth],
  );
  const markerInterval = useMemo(
    () => getTimeMarkerInterval(timelineBounds, zoomLevel, trackWidth),
    [timelineBounds, zoomLevel, trackWidth],
  );

  const formatMarkerLabel = (date: Date): string => {
    if (markerInterval >= DAY_MS) {
      return date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
    }
    if (totalDuration > DAY_MS && date.getHours() === 0 && date.getMinutes() === 0) {
      return date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
    }
    if (markerInterval < 60 * 60 * 1000 && date.getMinutes() !== 0) {
      return `:${date.getMinutes().toString().padStart(2, '0')}`;
    }
    return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateWidth = () => setTrackWidth(container.getBoundingClientRect().width || 1200);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

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

  const handlePhaseDragStart = (
    phase: EventPhase,
    mode: Exclude<DragMode, null>,
    e: React.MouseEvent,
  ) => {
    if (e.button !== 0 || !containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    activePhaseIdRef.current = phase.id;
    dragHasMovedRef.current = false;
    setActivePhaseId(phase.id);
    setHoveredPhase(null);
    setTooltipState({ x: 0, y: 0, phase: null });
    startDrag(
      mode,
      e.clientX,
      new Date(phase.start_time),
      new Date(phase.end_time),
      containerRef.current,
    );
  };

  const getPhaseDuration = (phase: EventPhase): string => {
    const preview = dragPreview?.phaseId === phase.id ? dragPreview : null;
    const start = preview?.start ?? new Date(phase.start_time);
    const end = preview?.end ?? new Date(phase.end_time);
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
    <div className="relative h-full py-6">
      <div ref={containerRef} className="relative">
        {/* Time Axis */}
        <div
          ref={timeAxisRef}
          className="relative z-10 mb-6 h-10 border-b-2 border-[#d3bb73]/20 bg-[#0f1119]"
        >
          {eventStartDate && eventEndDate && (
            <div
              className="absolute top-0 h-full border-l-2 border-r-2 border-[#d3bb73]/30 bg-[#d3bb73]/5"
              style={{
                left: `${((new Date(eventStartDate).getTime() - timelineBounds.start.getTime()) / totalDuration) * 100}%`,
                width: `${((new Date(eventEndDate).getTime() - new Date(eventStartDate).getTime()) / totalDuration) * 100}%`,
              }}
              title="Główne godziny wydarzenia (agenda dla klienta)"
            >
              <div className="absolute left-2 top-0 rounded-b bg-[#1c1f33] px-1 text-[10px] font-semibold text-[#d3bb73]">
                Agenda
              </div>
            </div>
          )}

          {timeMarkers.map((marker) => {
            const left =
              ((marker.getTime() - timelineBounds.start.getTime()) / totalDuration) * 100;
            return (
              <div
                key={marker.getTime()}
                className="absolute top-0 h-full border-l border-[#d3bb73]/25"
                style={{ left: `${left}%` }}
              >
                <span className="absolute left-1 top-2 whitespace-nowrap text-[11px] font-medium text-[#e5e4e2]/65">
                  {formatMarkerLabel(marker)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Linie skali przechodzą przez cały obszar faz */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-10 z-0">
          {timeMarkers.map((marker) => {
            const left =
              ((marker.getTime() - timelineBounds.start.getTime()) / totalDuration) * 100;
            return (
              <div
                key={`grid-${marker.getTime()}`}
                className="absolute inset-y-0 border-l border-[#d3bb73]/10"
                style={{ left: `${left}%` }}
              />
            );
          })}
        </div>

        {nowPosition !== null && (
          <div
            className="pointer-events-none absolute bottom-0 top-0 z-40 w-[2px] bg-red-500"
            style={{ left: `${nowPosition}%` }}
          >
            <div className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded bg-red-500 px-1 text-[10px] font-bold text-white">
              Teraz
            </div>
          </div>
        )}

        <div className="relative z-10" style={{ minHeight: `${containerHeight}px` }}>
          {phases.map((phase, index) => {
            const position = getPhasePosition(phase);
            const isSelected = selectedPhase?.id === phase.id;
            const isHovered = hoveredPhase === phase.id;
            const isDragging = activePhaseId === phase.id && Boolean(dragMode);
            const hasConflict = phaseConflicts[phase.id];
            const phaseColor = phase.color || phase.phase_type?.color || '#3b82f6';
            const overlappingPhases = getOverlappingPhases(phase);
            const preview = dragPreview?.phaseId === phase.id ? dragPreview : null;
            const displayedStart = preview?.start ?? new Date(phase.start_time);
            const displayedEnd = preview?.end ?? new Date(phase.end_time);

            return (
              <div
                key={phase.id}
                data-timeline-interactive="true"
                onMouseDown={(event) => {
                  if ((event.target as HTMLElement).closest('[data-phase-control="true"]')) return;
                  handlePhaseDragStart(phase, 'move', event);
                }}
                onMouseEnter={(event) => {
                  if (!dragMode) {
                    setHoveredPhase(phase.id);
                    setTooltipState({ x: event.clientX, y: event.clientY, phase });
                  }
                }}
                onMouseMove={(event) => {
                  if (!dragMode && isHovered) {
                    setTooltipState({ x: event.clientX, y: event.clientY, phase });
                  }
                }}
                onMouseLeave={() => {
                  if (!dragMode) {
                    setHoveredPhase(null);
                    setTooltipState({ x: 0, y: 0, phase: null });
                  }
                }}
                onClick={() => {
                  if (!suppressClickRef.current) onPhaseClick(phase);
                }}
                onDoubleClick={() => onPhaseDoubleClick?.(phase)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onPhaseContextMenu?.(phase);
                }}
                className={`absolute flex items-center overflow-hidden rounded-lg border-l-4 px-2 transition-[box-shadow,background-color] ${
                  isDragging ? 'cursor-grabbing shadow-xl' : 'cursor-grab'
                } ${isSelected ? 'shadow-xl' : isHovered ? 'shadow-lg' : 'shadow'} border-[var(--phase-color-border)] bg-[var(--phase-color)]`}
                style={{
                  top: '10px',
                  left: position.left,
                  width: position.width,
                  height: '60px',
                  zIndex: isSelected || isDragging ? 30 : isHovered ? 20 : 10 + index,
                  '--phase-color': `${phaseColor}20`,
                  '--phase-color-border': phaseColor,
                  borderLeftColor: phaseColor,
                } as React.CSSProperties}
                title="Przeciągnij, aby przesunąć. Prawy przycisk otwiera edycję."
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
                data-phase-control="true"
                onMouseDown={(event) => handlePhaseDragStart(phase, 'resize-start', event)}
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
              <div className="pointer-events-none flex-1 overflow-hidden px-2">
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
                  {formatTimeLabel(displayedStart)} - {formatTimeLabel(displayedEnd)}
                  <span className="ml-2 text-[#e5e4e2]/50">({getPhaseDuration(phase)})</span>
                </div>
              </div>

              {/* Delete Button */}
              {isHovered && (
                <button
                  data-phase-control="true"
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
                data-phase-control="true"
                onMouseDown={(event) => handlePhaseDragStart(phase, 'resize-end', event)}
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
        </div>
      </div>

      {/* Tooltip */}
      <TimelineTooltip
        x={tooltipState.x}
        y={tooltipState.y}
        visible={!!tooltipState.phase && !dragMode}
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
