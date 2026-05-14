'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { PortalDropdownMenu } from '@/components/UI/PortalDropdownMenu/PortalDropdownMenu';

export interface Action {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  variant?: 'default' | 'primary' | 'danger';
  show?: boolean;
  disabled?: boolean;
}

interface ResponsiveActionBarProps {
  actions: Action[];
  mobileBreakpoint?: number;
  disabledBackground?: boolean;
}

export default function ResponsiveActionBar({
  actions,
  mobileBreakpoint = 768,
  disabledBackground = false,
}: ResponsiveActionBarProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width?: number;
  } | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const portalMenuRef = useRef<HTMLDivElement | null>(null);

  const filteredActions = useMemo(
    () => actions.filter((action) => action.show !== false),
    [actions],
  );

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < mobileBreakpoint);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, [mobileBreakpoint]);

  useEffect(() => {
    if (!showMenu) return;

    const handleScroll = (event: Event) => {
      const target = event.target as Node | null;

      if (target && portalMenuRef.current && portalMenuRef.current.contains(target)) {
        return;
      }

      setShowMenu(false);
    };

    window.addEventListener('scroll', handleScroll, true);

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [showMenu]);

  useEffect(() => {
    if (!showMenu) return;

    const close = () => setShowMenu(false);

    window.addEventListener('resize', close);
    document.addEventListener('mousedown', close);

    return () => {
      window.removeEventListener('resize', close);
      document.removeEventListener('mousedown', close);
    };
  }, [showMenu]);

  if (filteredActions.length === 0) return null;

  const getButtonClasses = (variant?: string) => {
    const baseClasses = 'flex items-center gap-2 rounded-lg px-4 py-2 transition-colors';

    switch (variant) {
      case 'primary':
        return `${baseClasses} bg-[#d3bb73] text-[#1c1f33] hover:bg-[#d3bb73]/90`;
      case 'danger':
        return `${baseClasses} bg-red-500/10 text-red-400 hover:bg-red-500/20`;
      default:
        return `${baseClasses} bg-[#d3bb73]/10 text-[#d3bb73] hover:bg-[#d3bb73]/20`;
    }
  };

  const getMenuItemClasses = (variant?: string) => {
    const baseClasses =
      'flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors';

    switch (variant) {
      case 'danger':
        return `${baseClasses} text-red-400 hover:bg-red-500/10`;
      case 'primary':
        return `${baseClasses} text-[#d3bb73] hover:bg-[#d3bb73]/10`;
      default:
        return `${baseClasses} text-[#e5e4e2] hover:bg-[#d3bb73]/10`;
    }
  };

  const shouldUseDropdown = isMobile || filteredActions.length > 4;

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 224;
    const menuHeight = Math.min(filteredActions.length * 44 + 8, 260);

    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < menuHeight && rect.top > menuHeight;

    setPosition({
      top: openUpward ? rect.top - menuHeight - 8 : rect.bottom + 8,
      left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
      width: menuWidth,
    });

    setShowMenu((prev) => !prev);
  };

  if (shouldUseDropdown) {
    return (
      <>
        <button
          ref={buttonRef}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={openMenu}
          className={
            disabledBackground
              ? 'flex h-10 w-10 items-center justify-center rounded-lg bg-transparent text-[#e5e4e2]/70 transition-colors hover:text-[#e5e4e2]'
              : 'flex h-10 w-10 items-center justify-center rounded-lg bg-[#d3bb73]/10 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20'
          }
          aria-label="Akcje"
        >
          <MoreVertical className="h-5 w-5" />
        </button>

        <PortalDropdownMenu
          open={showMenu}
          position={position}
          className="rounded-xl"
          content={
            <div
              ref={portalMenuRef}
              className="max-h-[260px] overflow-y-auto"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {filteredActions.map((action, index) => (
                <button
                  key={`${action.label}-${index}`}
                  type="button"
                  disabled={action.disabled}
                  onClick={() => {
                    if (action.disabled) return;
                    action.onClick();
                    setShowMenu(false);
                  }}
                  className={`${getMenuItemClasses(action.variant)} ${
                    action.disabled ? 'cursor-not-allowed opacity-50' : ''
                  }`}
                >
                  {action.icon && <span className="h-5 w-5 flex-shrink-0">{action.icon}</span>}
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          }
        />
      </>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {filteredActions.map((action, index) => (
        <button
          key={`${action.label}-${index}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            action.onClick();
          }}
          disabled={action.disabled}
          className={`${getButtonClasses(action.variant)} ${
            action.disabled ? 'cursor-not-allowed opacity-50' : ''
          }`}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
    </div>
  );
}
