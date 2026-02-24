'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Box, Typography, Tooltip, IconButton, Paper } from '@mui/material';
import { Delete, DragIndicator, Warning } from '@mui/icons-material';
import { EventPhase } from '@/store/api/eventPhasesApi';

interface PhaseTimelineViewProps {
  phases: EventPhase[];
  timelineBounds: { start: Date; end: Date };
  zoomLevel: 'days' | 'hours' | 'minutes';
  selectedPhase: EventPhase | null;
  phaseConflicts: Record<string, boolean>;
  onPhaseClick: (phase: EventPhase) => void;
  onPhaseResize: (phaseId: string, newStart: Date, newEnd: Date) => void;
  onPhaseDelete: (phaseId: string) => void;
}

type ResizeHandle = 'start' | 'end' | null;

export const PhaseTimelineView: React.FC<PhaseTimelineViewProps> = ({
  phases,
  timelineBounds,
  zoomLevel,
  selectedPhase,
  phaseConflicts,
  onPhaseClick,
  onPhaseResize,
  onPhaseDelete,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState<{ phaseId: string; handle: ResizeHandle }>({
    phaseId: '',
    handle: null,
  });
  const [hoveredPhase, setHoveredPhase] = useState<string | null>(null);

  const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();

  // Calculate position and width for a phase
  const getPhasePosition = (phase: EventPhase) => {
    const start = new Date(phase.start_time).getTime();
    const end = new Date(phase.end_time).getTime();

    const left = ((start - timelineBounds.start.getTime()) / totalDuration) * 100;
    const width = ((end - start) / totalDuration) * 100;

    return { left: `${left}%`, width: `${width}%` };
  };

  // Format time label based on zoom level
  const formatTimeLabel = (date: Date): string => {
    if (zoomLevel === 'days') {
      return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
    } else if (zoomLevel === 'hours') {
      return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  };

  // Generate time markers
  const generateTimeMarkers = () => {
    const markers: Date[] = [];
    const start = new Date(timelineBounds.start);
    const end = new Date(timelineBounds.end);

    let interval: number;
    if (zoomLevel === 'days') {
      interval = 24 * 60 * 60 * 1000; // 1 day
    } else if (zoomLevel === 'hours') {
      interval = 60 * 60 * 1000; // 1 hour
    } else {
      interval = 15 * 60 * 1000; // 15 minutes
    }

    let current = new Date(Math.ceil(start.getTime() / interval) * interval);
    while (current <= end) {
      markers.push(new Date(current));
      current = new Date(current.getTime() + interval);
    }

    return markers;
  };

  const timeMarkers = generateTimeMarkers();

  // Handle resize start
  const handleResizeStart = (phaseId: string, handle: 'start' | 'end', e: React.MouseEvent) => {
    e.stopPropagation();
    setResizing({ phaseId, handle });
  };

  // Handle mouse move during resize
  useEffect(() => {
    if (!resizing.phaseId || !resizing.handle || !containerRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(1, x / rect.width));
      const newTime = new Date(
        timelineBounds.start.getTime() + percent * totalDuration
      );

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

  // Calculate phase duration text
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

  return (
    <Box ref={containerRef} sx={{ p: 3, height: '100%', position: 'relative' }}>
      {/* Time Axis */}
      <Box
        sx={{
          position: 'relative',
          height: 40,
          borderBottom: 2,
          borderColor: 'divider',
          mb: 3,
        }}
      >
        {timeMarkers.map((marker, index) => {
          const left =
            ((marker.getTime() - timelineBounds.start.getTime()) / totalDuration) * 100;

          return (
            <Box
              key={index}
              sx={{
                position: 'absolute',
                left: `${left}%`,
                top: 0,
                height: '100%',
                borderLeft: 1,
                borderColor: 'divider',
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  position: 'absolute',
                  left: 4,
                  top: 8,
                  fontSize: '0.7rem',
                  color: 'text.secondary',
                }}
              >
                {formatTimeLabel(marker)}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* Phases */}
      <Box sx={{ position: 'relative', minHeight: 200 }}>
        {phases.map((phase, index) => {
          const position = getPhasePosition(phase);
          const isSelected = selectedPhase?.id === phase.id;
          const isHovered = hoveredPhase === phase.id;
          const hasConflict = phaseConflicts[phase.id];
          const phaseColor = phase.color || phase.phase_type?.color || '#3b82f6';

          return (
            <Paper
              key={phase.id}
              elevation={isSelected ? 8 : isHovered ? 4 : 2}
              onMouseEnter={() => setHoveredPhase(phase.id)}
              onMouseLeave={() => setHoveredPhase(null)}
              onClick={() => onPhaseClick(phase)}
              sx={{
                position: 'absolute',
                top: index * 80,
                left: position.left,
                width: position.width,
                height: 60,
                backgroundColor: hasConflict ? '#fee' : phaseColor + '20',
                borderLeft: 4,
                borderColor: hasConflict ? '#dc2626' : phaseColor,
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                px: 1,
                '&:hover': {
                  transform: 'translateY(-2px)',
                },
              }}
            >
              {/* Resize Handle - Start */}
              <Box
                onMouseDown={(e) => handleResizeStart(phase.id, 'start', e)}
                sx={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 8,
                  cursor: 'ew-resize',
                  backgroundColor: isHovered ? phaseColor + '40' : 'transparent',
                  transition: 'background-color 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  '&:hover': {
                    backgroundColor: phaseColor + '60',
                  },
                }}
              >
                {isHovered && <DragIndicator sx={{ fontSize: 12, color: phaseColor }} />}
              </Box>

              {/* Phase Content */}
              <Box sx={{ flex: 1, px: 1, overflow: 'hidden' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                  <Typography
                    variant="body2"
                    fontWeight="bold"
                    sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {phase.name}
                  </Typography>
                  {hasConflict && (
                    <Tooltip title="Faza nakłada się z inną fazą!">
                      <Warning sx={{ fontSize: 16, color: '#dc2626' }} />
                    </Tooltip>
                  )}
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {formatTimeLabel(new Date(phase.start_time))} -{' '}
                  {formatTimeLabel(new Date(phase.end_time))}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  ({getPhaseDuration(phase)})
                </Typography>
              </Box>

              {/* Delete Button */}
              {isHovered && (
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPhaseDelete(phase.id);
                  }}
                  sx={{ mr: 1 }}
                >
                  <Delete fontSize="small" />
                </IconButton>
              )}

              {/* Resize Handle - End */}
              <Box
                onMouseDown={(e) => handleResizeStart(phase.id, 'end', e)}
                sx={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: 8,
                  cursor: 'ew-resize',
                  backgroundColor: isHovered ? phaseColor + '40' : 'transparent',
                  transition: 'background-color 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  '&:hover': {
                    backgroundColor: phaseColor + '60',
                  },
                }}
              >
                {isHovered && <DragIndicator sx={{ fontSize: 12, color: phaseColor }} />}
              </Box>
            </Paper>
          );
        })}
      </Box>
    </Box>
  );
};
