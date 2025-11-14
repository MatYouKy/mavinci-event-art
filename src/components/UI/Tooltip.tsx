'use client';

import { useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Placement = 'top' | 'bottom';

interface PopoverProps {
  trigger?: ReactNode;
  children?: ReactNode;
  content?: ReactNode;
  openOn?: 'hover' | 'click';
  offset?: number;
  placement?: Placement;
  className?: string;
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

export default function Popover({
  trigger: triggerProp,
  children: childrenProp,
  content: contentProp,
  openOn = 'hover',
  offset = 10,
  placement = 'top',
  className = '',
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

  useEffect(() => {
    rootRef.current = ensureRoot();
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      if (openTimer.current) window.clearTimeout(openTimer.current);
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
    if (placement === 'top' && top < 8 && r.bottom + pr.height + offset < vh - 8) {
      finalSide = 'bottom';
      top = r.bottom + offset;
    }
    if (placement === 'bottom' && top + pr.height > vh - 8 && r.top - pr.height - offset > 8) {
      finalSide = 'top';
      top = r.top - pr.height - offset;
    }

    left = Math.min(Math.max(left, 8), vw - pr.width - 8);
    if (top < 8) top = 8;
    if (top + pr.height > vh - 8) top = Math.max(8, vh - pr.height - 8);

    setSide(finalSide);
    setCoords({ left, top });
  }, [offset, placement]);

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

    const onDocDown = (e: MouseEvent) => {
      const t = triggerRef.current;
      const p = popRef.current;
      if (!t || !p) return;
      if (!t.contains(e.target as Node) && !p.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown, true);

    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocDown, true);
      ro.disconnect();
    };
  }, [open, compute]);

  const startOpen = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), 120);
  };
  const startClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  const triggerProps =
    openOn === 'hover'
      ? {
          onMouseEnter: startOpen,
          onMouseLeave: startClose,
          onFocus: () => setOpen(true),
          onBlur: () => setOpen(false),
        }
      : {
          onClick: () => setOpen((v) => !v),
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
      onMouseEnter={openOn === 'hover' ? startOpen : undefined}
      onMouseLeave={openOn === 'hover' ? startClose : undefined}
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
      <div ref={triggerRef} className="inline-flex align-middle" {...triggerProps} tabIndex={0}>
        {trigger}
      </div>
      {open && rootRef.current && createPortal(node, rootRef.current)}
    </>
  );
}
