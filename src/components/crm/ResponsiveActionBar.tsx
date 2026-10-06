'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { DropdownPosition } from '@/hooks/usePortalDropdown';
import { PortalDropdownMenu } from '@/components/UI/PortalDropdownMenu/PortalDropdownMenu';

export interface Action {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  variant?: 'default' | 'primary' | 'danger';
  show?: boolean;
  disabled?: boolean;
  /** Keep this action visible on desktop while remaining actions go to the menu. */
  pin?: boolean;
}

interface ResponsiveActionBarProps {
  actions: Action[];
  mobileBreakpoint?: number;
  disabledBackground?: boolean;
  compact?: boolean;
  alwaysDropdown?: boolean;
  menuZIndex?: number;
  portalWithinDialog?: boolean;
}

export default function ResponsiveActionBar({
  actions,
  mobileBreakpoint = 768,
  disabledBackground = false,
  compact = false,
  alwaysDropdown = false,
  menuZIndex,
  portalWithinDialog = false,
}: ResponsiveActionBarProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<DropdownPosition | null>(null);

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
      if (target instanceof Element && target.closest('[data-portal-dropdown="true"]')) return;

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

  useEffect(() => {
    if (!showMenu || !portalWithinDialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setShowMenu(false); buttonRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [showMenu, portalWithinDialog]);

  if (filteredActions.length === 0) return null;

  const getButtonClasses = (variant?: string) => {
    const baseClasses = compact
      ? 'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors'
      : 'flex items-center gap-2 rounded-lg px-4 py-2 transition-colors';

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

  const pinnedActions = filteredActions.filter((action) => action.pin);
  const overflowActions = filteredActions.filter((action) => !action.pin);
  const usePinnedDesktopLayout =
    !alwaysDropdown && !isMobile && pinnedActions.length > 0 && overflowActions.length > 0;
  const menuActions = usePinnedDesktopLayout ? overflowActions : filteredActions;
  const shouldUseDropdown = alwaysDropdown || isMobile || (filteredActions.length > 4 && !usePinnedDesktopLayout);

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    setPortalContainer(portalWithinDialog ? e.currentTarget.closest<HTMLDialogElement>('dialog') : null);
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 224;
    setPosition({
      top: rect.bottom + 8,
      anchorTop: rect.top,
      anchorBottom: rect.bottom,
      offsetY: 8,
      left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
      width: menuWidth,
    });

    setShowMenu((prev) => !prev);
  };

  const dropdownMenu = (
    <PortalDropdownMenu
      open={showMenu}
      position={position}
      zIndex={menuZIndex}
      portalContainer={portalContainer}
      className="rounded-xl"
      content={
        <div
          ref={portalMenuRef}
          className="py-1"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {menuActions.map((action, index) => (
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
  );

  const dropdownButton = (
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
          ? `flex items-center justify-center bg-transparent text-[#e5e4e2]/70 transition-colors hover:text-[#e5e4e2] ${
              compact ? 'h-8 w-8 rounded-md' : 'h-10 w-10 rounded-lg'
            }`
          : `flex items-center justify-center bg-[#d3bb73]/10 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20 ${
              compact ? 'h-8 w-8 rounded-md' : 'h-10 w-10 rounded-lg'
            }`
      }
      aria-label="Więcej akcji"
    >
      <MoreVertical className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
    </button>
  );

  if (usePinnedDesktopLayout) {
    return (
      <div className="flex items-center gap-2">
        {pinnedActions.map((action, index) => (
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
        {dropdownButton}
        {dropdownMenu}
      </div>
    );
  }

  if (shouldUseDropdown) {
    return (
      <>
        {dropdownButton}
        {dropdownMenu}
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
