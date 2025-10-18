'use client';

import { useState, useRef, useEffect, ReactNode, useCallback } from 'react';
import { createPortal } from 'react-dom';

type Placement = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  delay?: number;
  placement?: Placement;
  offset?: number; // odstęp między triggerem a tooltipem
  className?: string; // dodatkowe klasy dla pudełka tooltipa
}

function ensurePortalRoot(): HTMLElement {
  let root = document.getElementById('tooltip-root') as HTMLElement | null;
  if (!root) {
    root = document.createElement('div');
    root.id = 'tooltip-root';
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      pointerEvents: 'none', // kontener nie łapie eventów
    });
    document.body.appendChild(root);
  }
  return root;
}

export default function Tooltip({
  content,
  children,
  delay = 150,
  placement = 'top',
  offset = 12,
  className = '',
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [actualPlacement, setActualPlacement] = useState<Placement>(placement);

  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<number | null>(null);
  const portalRootRef = useRef<HTMLElement | null>(null);

  // Wyczyść timeout na unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  // Zapewnij portal root
  useEffect(() => {
    portalRootRef.current = ensurePortalRoot();
  }, []);

  const computePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const rect = trigger.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // Funkcje pomocnicze dla poszczególnych pozycji
    const placements: Record<Placement, () => { left: number; top: number }> = {
      top: () => ({
        left: rect.left + rect.width / 2 - tipRect.width / 2,
        top: rect.top - tipRect.height - offset,
      }),
      bottom: () => ({
        left: rect.left + rect.width / 2 - tipRect.width / 2,
        top: rect.bottom + offset,
      }),
      left: () => ({
        left: rect.left - tipRect.width - offset,
        top: rect.top + rect.height / 2 - tipRect.height / 2,
      }),
      right: () => ({
        left: rect.right + offset,
        top: rect.top + rect.height / 2 - tipRect.height / 2,
      }),
    };

    // Najpierw spróbuj z żądanym placementem
    let pos = placements[placement]();

    // Dokonaj „clampu” w poziomie (padding 10px)
    const clampX = (x: number) => Math.min(Math.max(x, 10), vw - tipRect.width - 10);
    // I pionie — ale jeśli zabraknie miejsca, zrób flip pionowy/poziomy
    const hasSpaceTop = rect.top >= tipRect.height + offset + 8;
    const hasSpaceBottom = vh - rect.bottom >= tipRect.height + offset + 8;
    const hasSpaceLeft = rect.left >= tipRect.width + offset + 8;
    const hasSpaceRight = vw - rect.right >= tipRect.width + offset + 8;

    let finalPlacement: Placement = placement;

    if (placement === 'top' && !hasSpaceTop && hasSpaceBottom) finalPlacement = 'bottom';
    if (placement === 'bottom' && !hasSpaceBottom && hasSpaceTop) finalPlacement = 'top';
    if (placement === 'left' && !hasSpaceLeft && hasSpaceRight) finalPlacement = 'right';
    if (placement === 'right' && !hasSpaceRight && hasSpaceLeft) finalPlacement = 'left';

    if (finalPlacement !== placement) {
      pos = placements[finalPlacement]();
    }

    // Ostateczny clamp
    const left = clampX(pos.left);
    let top = pos.top;

    // Jeśli nadal poza ekranem pionowo, „dosuń”
    if (top < 8) top = 8;
    if (top + tipRect.height > vh - 8) top = Math.max(8, vh - tipRect.height - 8);

    setActualPlacement(finalPlacement);
    setCoords({ left, top });
  }, [offset, placement]);

  // Aktualizuj pozycję, kiedy tooltip widoczny
  useEffect(() => {
    if (!isVisible) return;
    computePosition();

    const handleScroll = () => computePosition();
    const handleResize = () => computePosition();

    // Reaguj na scroll całego dokumentu i okna
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    // Reaguj na zmiany rozmiaru samego tooltipsa (np. async content)
    const ro = new ResizeObserver(() => computePosition());
    if (tooltipRef.current) ro.observe(tooltipRef.current);

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
      ro.disconnect();
    };
  }, [isVisible, computePosition]);

  // Opóźnione otwarcie
  const handleOpen = () => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setIsVisible(true), delay);
  };

  // Zamknięcie z niewielkim marginesem (by nie migało)
  const handleClose = () => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    // mały debounce, by dać czas na wejście myszą w tooltip
    timeoutRef.current = window.setTimeout(() => setIsVisible(false), 80);
  };

  // Dla dostępności: otwieraj także na focus
  const handleFocus = () => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    setIsVisible(true);
  };
  const handleBlur = () => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    setIsVisible(false);
  };

  const tipBox = (
    <div
      ref={tooltipRef}
      role="tooltip"
      aria-hidden={!isVisible}
      onMouseEnter={handleOpen}
      onMouseLeave={handleClose}
      style={{
        position: 'fixed',
        left: `${coords.left}px`,
        top: `${coords.top}px`,
        // kluczowe: sam tooltip ma pointer-events:auto, ale kontener portalu – none
        pointerEvents: 'auto',
      }}
      className={['max-w-[320px]'].join(' ')}
    >
      {/* Strzałka */}
      <div
        aria-hidden
        className="absolute"
        style={{
          left:
            actualPlacement === 'top' || actualPlacement === 'bottom'
              ? '50%'
              : undefined,
          top:
            actualPlacement === 'left' || actualPlacement === 'right'
              ? '50%'
              : undefined,
          transform:
            actualPlacement === 'top' || actualPlacement === 'bottom'
              ? 'translateX(-50%)'
              : 'translateY(-50%)',
        }}
      >
        <span
          className="block w-0 h-0"
          style={{
            borderLeft:
              actualPlacement === 'top' || actualPlacement === 'bottom'
                ? '8px solid transparent'
                : undefined,
            borderRight:
              actualPlacement === 'top' || actualPlacement === 'bottom'
                ? '8px solid transparent'
                : undefined,
            borderTop:
              actualPlacement === 'bottom' ? '8px solid #0f1119' : undefined,
            borderBottom:
              actualPlacement === 'top' ? '8px solid #0f1119' : undefined,
            borderY:
              actualPlacement === 'left' || actualPlacement === 'right'
                ? undefined
                : undefined,
            borderTopColor: actualPlacement === 'bottom' ? '#0f1119' : undefined,
          }}
        />
      </div>

      {/* Pudełko tooltipa */}
      <div
        className={[
          'bg-[#0f1119]',
          'border',
          'border-[#d3bb73]/30',
          'rounded-lg',
          'shadow-2xl',
          'px-3',
          'py-2',
          'text-sm',
          'text-neutral-200',
          'backdrop-blur',
          className,
        ].join(' ')}
      >
        {content}
      </div>
    </div>
  );

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className="inline-block align-middle"
        tabIndex={0} // fokus z klawiatury
      >
        {children}
      </div>

      {isVisible && portalRootRef.current && createPortal(tipBox, portalRootRef.current)}
    </>
  );
}