import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DropdownPosition } from '@/hooks/usePortalDropdown';



export type PortalDropdownItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
};

type PortalDropdownMenuProps = {
  open: boolean;
  position: DropdownPosition | null;
  content: React.ReactNode;
  className?: string;
  zIndex?: number;
  portalContainer?: HTMLElement | null;
};

export const PortalDropdownMenu: React.FC<PortalDropdownMenuProps> = ({
  open,
  position,
  content,
  className,
  zIndex = 10000,
  portalContainer,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{top: number; left: number; maxHeight: number} | null>(null);
  useLayoutEffect(() => {
    if (!open || !position || !menuRef.current) return;
    const menu = menuRef.current;
    const update = () => {
      const viewport = window.visualViewport;
      const topEdge = (viewport?.offsetTop || 0) + 8;
      const bottomEdge = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight) - 8;
      const leftEdge = (viewport?.offsetLeft || 0) + 8;
      const rightEdge = (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth) - 8;
      const height = menu.scrollHeight + 2;
      const gap = position.offsetY ?? 4;
      const belowTop = position.anchorBottom !== undefined ? position.anchorBottom + gap : position.top;
      const below = Math.max(0, bottomEdge - belowTop);
      const above = Math.max(0, (position.anchorTop ?? position.top) - gap - topEdge);
      const upward = position.anchorTop !== undefined && height > below && above > below;
      const maxHeight = Math.max(0, Math.min(bottomEdge - topEdge, upward ? above : below));
      const top = upward ? position.anchorTop! - gap - Math.min(height, maxHeight) : belowTop;
      const next = {
        top: Math.max(topEdge, Math.min(top, bottomEdge - Math.min(height, maxHeight))),
        left: Math.max(leftEdge, Math.min(position.left, rightEdge - menu.getBoundingClientRect().width)),
        maxHeight,
      };
      setLayout(previous => previous && previous.top === next.top && previous.left === next.left && previous.maxHeight === next.maxHeight ? previous : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(menu);
    if (menu.firstElementChild) observer.observe(menu.firstElementChild);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [open, position]);
  if (!open || !position) return null;

  return createPortal(
    <div
      ref={menuRef}
      data-portal-dropdown="true"
      className={[
        'rounded-md border border-[#d3bb73]/30 bg-[#1c1f33]',
        'shadow-[0_12px_32px_rgba(0,0,0,0.55)]',
        'animate-[portalDropdownFadeIn_0.15s_ease-out]',
        className ?? '',
      ].join(' ')}
      style={{
        position: 'fixed',
        top: layout?.top ?? position.top,
        left: layout?.left ?? position.left,
        width: position.width ? `${position.width}px` : undefined,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: layout?.maxHeight,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        zIndex,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {content}
    </div>,
    portalContainer || document.body,
  );
};
