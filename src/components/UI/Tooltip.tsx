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
  const [mounted, setMounted] = useState(false);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setMounted(true);

    let root = document.getElementById('tooltip-portal-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'tooltip-portal-root';
      root.style.position = 'fixed';
      root.style.top = '0';
      root.style.left = '0';
      root.style.width = '0';
      root.style.height = '0';
      root.style.zIndex = '2147483647';
      root.style.pointerEvents = 'none';
      document.body.appendChild(root);
    }
    setPortalRoot(root);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const updatePosition = () => {
    if (!triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const tooltipWidth = 300;
    const tooltipHeight = 100;
    const gap = 12;

    let x = rect.left + rect.width / 2;
    let y = rect.top - gap;

    if (x - tooltipWidth / 2 < 0) {
      x = tooltipWidth / 2 + 10;
    } else if (x + tooltipWidth / 2 > window.innerWidth) {
      x = window.innerWidth - tooltipWidth / 2 - 10;
    }

    if (y - tooltipHeight < 0) {
      y = rect.bottom + gap;
    }

    setPosition({ x, y });
  };

  const handleMouseEnter = () => {
    updatePosition();
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

      {mounted && isVisible && portalRoot && createPortal(
        <div
          style={{
            position: 'fixed',
            left: `${position.x}px`,
            top: `${position.y}px`,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'auto',
          }}
        >
          <div className="bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg shadow-2xl animate-in fade-in duration-200">
            {content}
          </div>
        </div>,
        portalRoot
      )}
    </>
  );
}
