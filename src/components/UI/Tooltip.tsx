'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  delay?: number;
}

export default function Tooltip({ content, children, delay = 200 }: TooltipProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const updatePosition = () => {
    if (!triggerRef.current || !dialogRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const dialogRect = dialogRef.current.getBoundingClientRect();
    const gap = 12;

    let x = rect.left + rect.width / 2 - dialogRect.width / 2;
    let y = rect.top - dialogRect.height - gap;

    if (x < 10) {
      x = 10;
    } else if (x + dialogRect.width > window.innerWidth - 10) {
      x = window.innerWidth - dialogRect.width - 10;
    }

    if (y < 10) {
      y = rect.bottom + gap;
    }

    setPosition({ x, y });
  };

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      if (dialogRef.current && !dialogRef.current.open) {
        dialogRef.current.show();
        updatePosition();
      }
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (dialogRef.current && dialogRef.current.open) {
      dialogRef.current.close();
    }
  };

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="inline-block"
      >
        {children}
      </div>

      <dialog
        ref={dialogRef}
        className="bg-transparent border-0 p-0 m-0 backdrop:bg-transparent overflow-visible"
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg shadow-2xl">
          {content}
        </div>
      </dialog>
    </>
  );
}
