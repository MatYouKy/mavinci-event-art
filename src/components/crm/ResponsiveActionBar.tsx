'use client';

import { useState, useRef, useEffect } from 'react';
import { MoreVertical } from 'lucide-react';

export interface Action {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  variant?: 'default' | 'primary' | 'danger';
  show?: boolean;
}

interface ResponsiveActionBarProps {
  actions: Action[];
  mobileBreakpoint?: number;
}

export default function ResponsiveActionBar({
  actions,
  mobileBreakpoint = 768
}: ResponsiveActionBarProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < mobileBreakpoint);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, [mobileBreakpoint]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const filteredActions = actions.filter(action => action.show !== false);

  if (filteredActions.length === 0) {
    return null;
  }

  const getButtonClasses = (variant?: string) => {
    const baseClasses = 'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors';

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
    const baseClasses = 'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors';

    switch (variant) {
      case 'danger':
        return `${baseClasses} text-red-400 hover:bg-red-500/10`;
      default:
        return `${baseClasses} text-[#e5e4e2] hover:bg-[#d3bb73]/10`;
    }
  };

  if (isMobile) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="flex items-center justify-center w-10 h-10 bg-[#d3bb73]/10 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors"
          aria-label="Akcje"
        >
          <MoreVertical className="w-5 h-5" />
        </button>

        {showMenu && (
          <div className="absolute right-0 top-full mt-2 w-56 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl shadow-xl z-50 overflow-hidden">
            {filteredActions.map((action, index) => (
              <button
                key={index}
                onClick={() => {
                  action.onClick();
                  setShowMenu(false);
                }}
                className={getMenuItemClasses(action.variant)}
              >
                {action.icon && (
                  <span className="flex-shrink-0">
                    {action.icon}
                  </span>
                )}
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {filteredActions.map((action, index) => (
        <button
          key={index}
          onClick={action.onClick}
          className={getButtonClasses(action.variant)}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
    </div>
  );
}
