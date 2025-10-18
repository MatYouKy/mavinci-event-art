'use client';

import { useState, useRef, useEffect, ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  delay?: number;
}

export default function Tooltip({ content, children, delay = 200 }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isVisible && tooltipRef.current && triggerRef.current) {
      const updatePosition = () => {
        if (!triggerRef.current || !tooltipRef.current) return;

        const rect = triggerRef.current.getBoundingClientRect();
        const tooltipRect = tooltipRef.current.getBoundingClientRect();
        const gap = 12;

        let x = rect.left + rect.width / 2 - tooltipRect.width / 2;
        let y = rect.top - tooltipRect.height - gap;

        if (x < 10) {
          x = 10;
        } else if (x + tooltipRect.width > window.innerWidth - 10) {
          x = window.innerWidth - tooltipRect.width - 10;
        }

        if (rect.top - tooltipRect.height - gap < 0) {
          y = rect.bottom + gap;
        }

        setPosition({ x, y });
      };

      updatePosition();
    }
  }, [isVisible]);

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
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

      {isVisible && createPortal(
        <div
          ref={tooltipRef}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{
            position: 'fixed',
            left: `${position.x}px`,
            top: `${position.y}px`,
            zIndex: 2147483647,
            pointerEvents: 'auto',
          }}
        >
          <div className="bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg shadow-2xl">
            {content}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
