import { useEffect, useRef, useState } from 'react';

export type DragMode = 'move' | 'resize-start' | 'resize-end' | null;

interface UseTimelineDragProps {
  timelineBounds: { start: Date; end: Date };
  zoomLevel: 'days' | 'hours' | 'quarter_hours';
  onDragEnd?: (newStart: Date, newEnd: Date) => void;
}

export const useTimelineDrag = ({ timelineBounds, zoomLevel, onDragEnd }: UseTimelineDragProps) => {
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragStart, setDragStart] = useState<{ x: number; originalStart: Date; originalEnd: Date } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const getSnapInterval = (): number => {
    switch (zoomLevel) {
      case 'quarter_hours':
        return 5 * 60 * 1000; // 5 min
      case 'hours':
        return 15 * 60 * 1000; // 15 min
      case 'days':
        return 60 * 60 * 1000; // 60 min
      default:
        return 15 * 60 * 1000;
    }
  };

  const getMinDuration = (): number => {
    switch (zoomLevel) {
      case 'quarter_hours':
        return 5 * 60 * 1000; // 5 min
      case 'hours':
        return 15 * 60 * 1000; // 15 min
      case 'days':
        return 60 * 60 * 1000; // 1h
      default:
        return 15 * 60 * 1000;
    }
  };

  const snapToGrid = (time: number): number => {
    const interval = getSnapInterval();
    return Math.round(time / interval) * interval;
  };

  const clampToBounds = (time: number): number => {
    return Math.max(timelineBounds.start.getTime(), Math.min(timelineBounds.end.getTime(), time));
  };

  const startDrag = (mode: DragMode, x: number, startTime: Date, endTime: Date, container: HTMLDivElement) => {
    setDragMode(mode);
    setDragStart({ x, originalStart: startTime, originalEnd: endTime });
    containerRef.current = container;
  };

  useEffect(() => {
    if (!dragMode || !dragStart || !containerRef.current) return;

    const container = containerRef.current;
    const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const deltaX = e.clientX - dragStart.x;
      const deltaPercent = deltaX / rect.width;
      const deltaTime = deltaPercent * totalDuration;

      let newStart = dragStart.originalStart.getTime();
      let newEnd = dragStart.originalEnd.getTime();

      if (dragMode === 'move') {
        newStart = snapToGrid(clampToBounds(dragStart.originalStart.getTime() + deltaTime));
        const duration = dragStart.originalEnd.getTime() - dragStart.originalStart.getTime();
        newEnd = newStart + duration;

        // Ensure end doesn't exceed bounds
        if (newEnd > timelineBounds.end.getTime()) {
          newEnd = timelineBounds.end.getTime();
          newStart = newEnd - duration;
        }
      } else if (dragMode === 'resize-start') {
        newStart = snapToGrid(clampToBounds(dragStart.originalStart.getTime() + deltaTime));
        const minDuration = getMinDuration();
        if (newEnd - newStart < minDuration) {
          newStart = newEnd - minDuration;
        }
      } else if (dragMode === 'resize-end') {
        newEnd = snapToGrid(clampToBounds(dragStart.originalEnd.getTime() + deltaTime));
        const minDuration = getMinDuration();
        if (newEnd - newStart < minDuration) {
          newEnd = newStart + minDuration;
        }
      }

      // Prevent invalid ranges
      if (newStart >= newEnd) return;

      // Store preview state if needed
      container.setAttribute('data-drag-start', new Date(newStart).toISOString());
      container.setAttribute('data-drag-end', new Date(newEnd).toISOString());
    };

    const handleMouseUp = () => {
      if (containerRef.current) {
        const dragStartStr = containerRef.current.getAttribute('data-drag-start');
        const dragEndStr = containerRef.current.getAttribute('data-drag-end');

        if (dragStartStr && dragEndStr && onDragEnd) {
          onDragEnd(new Date(dragStartStr), new Date(dragEndStr));
        }

        containerRef.current.removeAttribute('data-drag-start');
        containerRef.current.removeAttribute('data-drag-end');
      }

      setDragMode(null);
      setDragStart(null);
      containerRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragMode, dragStart, timelineBounds, zoomLevel, onDragEnd]);

  return { dragMode, startDrag };
};
