'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface TimelineTooltipProps {
  x: number;
  y: number;
  content: React.ReactNode;
  visible: boolean;
}

export const TimelineTooltip: React.FC<TimelineTooltipProps> = ({ x, y, content, visible }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !visible) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999] rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 shadow-xl"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: 'translate(-50%, -120%)',
      }}
    >
      {content}
    </div>,
    document.body
  );
};

interface TooltipContentProps {
  title: string;
  startTime: string;
  endTime: string;
  details?: Array<{ label: string; value: string | number }>;
}

export const TooltipContent: React.FC<TooltipContentProps> = ({ title, startTime, endTime, details }) => {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-[#e5e4e2]">{title}</p>
      <p className="text-xs text-[#e5e4e2]/70">
        {startTime} - {endTime}
      </p>
      {details && details.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t border-[#d3bb73]/20 pt-1">
          {details.map((detail, idx) => (
            <p key={idx} className="text-xs text-[#e5e4e2]/60">
              <span className="text-[#d3bb73]">{detail.label}:</span> {detail.value}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};
