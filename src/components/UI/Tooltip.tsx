'use client';

import { useEffect, useRef, useState, useCallback, ReactNode, useMemo } from 'react';
import { createPortal } from 'react-dom';

type Placement = 'top' | 'bottom';

interface PopoverProps {
  trigger?: ReactNode;
  children?: ReactNode;
  content?: ReactNode;

  /**
   * - "hover": desktop hover + focus
   * - "click": toggle on click
   * - "auto": hover na urządzeniach z hoverem, click na touch/mobile
   */
  openOn?: 'hover' | 'click' | 'auto';

  offset?: number;
  placement?: Placement;
  className?: string;

  /** touch/mobile: przytrzymaj X ms żeby otworzyć (dla openOn="auto" albo "click") */
  holdToOpenMs?: number;

  /** touch/mobile: automatyczne zamknięcie po czasie (0 = nie zamykaj automatycznie) */
  autoCloseMs?: number;
}

function ensureRoot(): HTMLElement {
  let el = document.getElementById('overlay-root') as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = 'overlay-root';
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
    document.body.appendChild(el);
  }
  return el;
}

const isPointInRect = (x: number, y: number, r: DOMRect) =>
  x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

export default function Popover({
  trigger: triggerProp,
  children: childrenProp,
  content: contentProp,
  openOn = 'hover',
  offset = 10,
  placement = 'top',
  className = '',
  holdToOpenMs = 320,
  autoCloseMs = 0,
}: PopoverProps) {
  const trigger = triggerProp ?? childrenProp;
  const popoverContent = contentProp ?? childrenProp;

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ left: 0, top: 0 });
  const [side, setSide] = useState<Placement>(placement);

  const triggerRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  const closeTimer = useRef<number | null>(null);
  const openTimer = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const autoCloseTimer = useRef<number | null>(null);
  const moveGuardCleanup = useRef<(() => void) | null>(null);

  const [isTouchLike, setIsTouchLike] = useState(false);

  // detect "touch-like" environment (no hover / coarse pointer)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mqHover = window.matchMedia?.('(hover: hover) and (pointer: fine)');
    const mqCoarse = window.matchMedia?.('(pointer: coarse)');
    const calc = () => {
      const hoverFine = !!mqHover?.matches;
      const coarse = !!mqCoarse?.matches;
      setIsTouchLike(!hoverFine || coarse);
    };
    calc();
    mqHover?.addEventListener?.('change', calc);
    mqCoarse?.addEventListener?.('change', calc);
    return () => {
      mqHover?.removeEventListener?.('change', calc);
      mqCoarse?.removeEventListener?.('change', calc);
    };
  }, []);

  useEffect(() => {
    rootRef.current = ensureRoot();
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      if (openTimer.current) window.clearTimeout(openTimer.current);
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
      if (autoCloseTimer.current) window.clearTimeout(autoCloseTimer.current);
      if (moveGuardCleanup.current) moveGuardCleanup.current();
    };
  }, []);

  const compute = useCallback(() => {
    const t = triggerRef.current;
    const p = popRef.current;
    if (!t || !p) return;

    const r = t.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    let top = placement === 'top' ? r.top - pr.height - offset : r.bottom + offset;
    let left = r.left + r.width / 2 - pr.width / 2;

    let finalSide = placement;

    // flip if needed
    if (placement === 'top' && top < 8 && r.bottom + pr.height + offset < vh - 8) {
      finalSide = 'bottom';
      top = r.bottom + offset;
    }
    if (placement === 'bottom' && top + pr.height > vh - 8 && r.top - pr.height - offset > 8) {
      finalSide = 'top';
      top = r.top - pr.height - offset;
    }

    // clamp
    left = Math.min(Math.max(left, 8), vw - pr.width - 8);
    if (top < 8) top = 8;
    if (top + pr.height > vh - 8) top = Math.max(8, vh - pr.height - 8);

    setSide(finalSide);
    setCoords({ left, top });
  }, [offset, placement]);

  // portal listeners while open
  useEffect(() => {
    if (!open) return;

    compute();

    const onScroll = () => compute();
    const onResize = () => compute();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    const ro = new ResizeObserver(() => compute());
    if (popRef.current) ro.observe(popRef.current);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);

    const onDocDown = (e: MouseEvent | TouchEvent) => {
      const t = triggerRef.current;
      const p = popRef.current;
      if (!t || !p) return;

      const target = e.target as Node | null;
      if (!target) return;

      if (!t.contains(target) && !p.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('touchstart', onDocDown, true);

    // optional autoclose for mobile
    if (autoCloseMs > 0) {
      if (autoCloseTimer.current) window.clearTimeout(autoCloseTimer.current);
      autoCloseTimer.current = window.setTimeout(() => setOpen(false), autoCloseMs);
    }

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('touchstart', onDocDown, true);
      ro.disconnect();
      if (autoCloseTimer.current) window.clearTimeout(autoCloseTimer.current);
      autoCloseTimer.current = null;
    };
  }, [open, compute, autoCloseMs]);

  const startOpen = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), 40);
  }, []);

  // ✅ hover-gap fix: grace + mousemove guard
  const startClose = useCallback(() => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);

    if (moveGuardCleanup.current) moveGuardCleanup.current();

    const onMove = (e: MouseEvent) => {
      const p = popRef.current;
      if (!p) return;
      const pr = p.getBoundingClientRect();

      if (isPointInRect(e.clientX, e.clientY, pr)) {
        if (closeTimer.current) window.clearTimeout(closeTimer.current);
        moveGuardCleanup.current?.();
        moveGuardCleanup.current = null;
        setOpen(true);
      }
    };

    window.addEventListener('mousemove', onMove, true);
    moveGuardCleanup.current = () => {
      window.removeEventListener('mousemove', onMove, true);
      moveGuardCleanup.current = null;
    };

    closeTimer.current = window.setTimeout(() => {
      moveGuardCleanup.current?.();
      setOpen(false);
    }, 220);
  }, []);

  const effectiveOpenOn: 'hover' | 'click' = useMemo(() => {
    if (openOn === 'auto') return isTouchLike ? 'click' : 'hover';
    return openOn;
  }, [openOn, isTouchLike]);

  const cancelHold = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const beginHoldToOpen = () => {
    cancelHold();
    holdTimer.current = window.setTimeout(() => {
      setOpen(true);
      holdTimer.current = null;
    }, holdToOpenMs);
  };

  const triggerProps =
    effectiveOpenOn === 'hover'
      ? {
          onMouseEnter: startOpen,
          onMouseLeave: startClose,
          onFocus: () => setOpen(true),
          onBlur: () => setOpen(false),
        }
      : {
          onClick: () => setOpen((v) => !v),
          // mobile: przytrzymanie (działa też w auto/click)
          onTouchStart: () => beginHoldToOpen(),
          onTouchEnd: () => cancelHold(),
          onTouchCancel: () => cancelHold(),
        };

  const node = (
    <div
      ref={popRef}
      role="dialog"
      aria-modal="false"
      style={{
        position: 'fixed',
        left: `${coords.left}px`,
        top: `${coords.top}px`,
        pointerEvents: 'auto',
      }}
      // hover: utrzymuj otwarte przy przejściu na popover
      onMouseEnter={effectiveOpenOn === 'hover' ? startOpen : undefined}
      onMouseLeave={effectiveOpenOn === 'hover' ? startClose : undefined}
      className="max-w-[320px]"
    >
      <div
        aria-hidden
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          top: side === 'bottom' ? -8 : undefined,
          bottom: side === 'top' ? -8 : undefined,
        }}
      >
        <span
          className="block h-0 w-0"
          style={{
            borderLeft: '8px solid transparent',
            borderRight: '8px solid transparent',
            borderTop: side === 'bottom' ? '8px solid #0f1119' : undefined,
            borderBottom: side === 'top' ? '8px solid #0f1119' : undefined,
          }}
        />
      </div>

      <div
        className={[
          'bg-[#0f1119]',
          'border border-[#d3bb73]/35',
          'rounded-xl',
          'shadow-2xl',
          'px-3 py-2',
          'text-sm text-neutral-200',
          'backdrop-blur',
          className,
        ].join(' ')}
      >
        {popoverContent}
      </div>
    </div>
  );

  return (
    <>
      <div ref={triggerRef} className="inline-flex align-middle" {...(triggerProps as any)} tabIndex={0}>
        {trigger}
      </div>
      {open && rootRef.current && createPortal(node, rootRef.current)}
    </>
  );
}