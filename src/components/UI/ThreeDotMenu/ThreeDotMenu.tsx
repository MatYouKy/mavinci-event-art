import React, { useState } from 'react';
import { MoreVertical } from 'lucide-react';

export type ThreeDotPosition = 'right-top' | 'right-bottom' | 'left-top' | 'left-bottom';

interface MenuItem {
  children: React.ReactNode;
  onClick: () => void;
}

interface ThreeDotMenuProps {
  menuPosition?: ThreeDotPosition;
  menu_items: MenuItem[];
  menuAction?: boolean;
  menuActionContent?: React.ReactNode;
}

export const ThreeDotMenu: React.FC<ThreeDotMenuProps> = ({
  menuPosition = 'right-bottom',
  menu_items,
  menuAction = false,
  menuActionContent,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const getPositionClasses = () => {
    switch (menuPosition) {
      case 'right-top':
        return 'top-4 right-4';
      case 'right-bottom':
        return 'bottom-0 right-4';
      case 'left-top':
        return 'top-4 left-4';
      case 'left-bottom':
        return 'bottom-0 left-4';
      default:
        return 'bottom-0 right-4';
    }
  };

  const getDropdownClasses = () => {
    const verticalPosition = menuPosition.includes('top') ? 'top-full mt-2' : 'bottom-full mb-2';
    const horizontalPosition = menuPosition.includes('left') ? 'left-0' : 'right-0';
    return `${verticalPosition} ${horizontalPosition}`;
  };

  React.useEffect(() => {
    if (menuAction) {
      setIsOpen(false);
    }
  }, [menuAction]);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleMenuItemClick = (onClick: () => void, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
    // Nie zamykamy od razu - useEffect z menuAction to zrobi
  };

  return (
    <div ref={menuRef} className={`absolute ${getPositionClasses()} z-[9999]`}>
      {menuAction ? (
        <div className="z-[10000] rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33]/95 p-1 shadow-xl backdrop-blur-md">
          {menuActionContent}
        </div>
      ) : (
        <>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d3bb73]/30 bg-[#1c1f33]/80 backdrop-blur-md transition-all duration-300 hover:bg-[#d3bb73]"
          >
            <MoreVertical className="h-5 w-5 text-[#e5e4e2]" />
          </button>

          {isOpen && (
            <div
              className={`absolute ${getDropdownClasses()} z-[9999] w-56 overflow-hidden rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33]/95 shadow-xl backdrop-blur-md`}
            >
              {menu_items.map((item, index) => (
                <button
                  key={index}
                  onClick={(e) => handleMenuItemClick(item.onClick, e)}
                  className="w-full border-b border-[#d3bb73]/10 px-4 py-3 text-left text-[#e5e4e2] transition-colors last:border-b-0 hover:bg-[#d3bb73]/20"
                >
                  {item.children}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
