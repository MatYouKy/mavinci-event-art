import React from 'react';
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
};

export const PortalDropdownMenu: React.FC<PortalDropdownMenuProps> = ({
  open,
  position,
  content,
  className,
}) => {
  if (!open || !position) return null;

  return createPortal(
    <div
      className={[
        'rounded-md border border-[#d3bb73]/30 bg-[#1c1f33]',
        'shadow-[0_12px_32px_rgba(0,0,0,0.55)]',
        'animate-[portalDropdownFadeIn_0.15s_ease-out]',
        className ?? '',
      ].join(' ')}
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        width: position.width ? `${position.width}px` : undefined,
        zIndex: 10000,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {content}
    </div>,
    document.body,
  );
};