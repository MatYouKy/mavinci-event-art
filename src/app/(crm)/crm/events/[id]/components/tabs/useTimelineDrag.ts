import { useEffect, useRef, useState } from 'react';

export type DragMode = 'move' | 'resize-start' | 'resize-end' | null;

interface UseTimelineDragProps {
  timelineBounds: { start: Date; end: Date };
  zoomLevel: 'days' | 'hours' | 'quarter_hours';
  onDragMove?: (newStart: Date, newEnd: Date) => void;
  onDragEnd?: (newStart: Date, newEnd: Date) => void;
}

export const useTimelineDrag = ({
  timelineBounds,
  zoomLevel,
  onDragMove,
  onDragEnd,
}: UseTimelineDragProps) => {
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragStart, setDragStart] = useState<{ x: number; originalStart: Date; originalEnd: Date } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const latestRangeRef = useRef<{ start: Date; end: Date } | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const onDragMoveRef = useRef(onDragMove);
  const onDragEndRef = useRef(onDragEnd);

  useEffect(() => {
    onDragMoveRef.current = onDragMove;
    onDragEndRef.current = onDragEnd;
  }, [onDragMove, onDragEnd]);

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
    latestRangeRef.current = null;
    setDragMode(mode);
    setDragStart({ x, originalStart: startTime, originalEnd: endTime });
    containerRef.current = container;
  };

  useEffect(() => {
    if (!dragMode || !dragStart || !containerRef.current) return;

    const container = containerRef.current;
    const totalDuration = timelineBounds.end.getTime() - timelineBounds.start.getTime();
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
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

      const range = { start: new Date(newStart), end: new Date(newEnd) };
      latestRangeRef.current = range;
      container.setAttribute('data-drag-start', range.start.toISOString());
      container.setAttribute('data-drag-end', range.end.toISOString());

      if (animationFrameRef.current === null) {
        animationFrameRef.current = requestAnimationFrame(() => {
          animationFrameRef.current = null;
          const latestRange = latestRangeRef.current;
          if (latestRange) onDragMoveRef.current?.(latestRange.start, latestRange.end);
        });
      }
    };

    const handleMouseUp = () => {
      const latestRange = latestRangeRef.current;
      if (latestRange) {
        onDragEndRef.current?.(latestRange.start, latestRange.end);
      }
      if (containerRef.current) {
        containerRef.current.removeAttribute('data-drag-start');
        containerRef.current.removeAttribute('data-drag-end');
      }

      latestRangeRef.current = null;
      document.body.style.userSelect = previousUserSelect;
      setDragMode(null);
      setDragStart(null);
      containerRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      document.body.style.userSelect = previousUserSelect;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragMode, dragStart, timelineBounds, zoomLevel]);

  return { dragMode, startDrag };
};
