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
}

export default function ResponsiveActionBar({
  actions
}: ResponsiveActionBarProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const getMenuItemClasses = (variant?: string) => {
    const baseClasses = 'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors';

    switch (variant) {
      case 'danger':
        return `${baseClasses} text-red-400 hover:bg-red-500/10`;
      default:
        return `${baseClasses} text-[#e5e4e2] hover:bg-[#d3bb73]/10`;
    }
  };

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
                <span className="flex-shrink-0 w-5 h-5">
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
