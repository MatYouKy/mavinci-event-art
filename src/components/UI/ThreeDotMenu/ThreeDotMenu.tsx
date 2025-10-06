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

  const getPositionClasses = () => {
    switch (menuPosition) {
      case 'right-top':
        return 'top-4 right-4';
      case 'right-bottom':
        return 'bottom-4 right-4';
      case 'left-top':
        return 'top-4 left-4';
      case 'left-bottom':
        return 'bottom-4 left-4';
      default:
        return 'bottom-4 right-4';
    }
  };

  return (
    <div className={`absolute ${getPositionClasses()} z-50`}>
      {menuAction ? (
        <div className="bg-[#1c1f33]/95 backdrop-blur-md rounded-lg shadow-xl border border-[#d3bb73]/30 p-2">
          {menuActionContent}
        </div>
      ) : (
        <>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="w-10 h-10 rounded-full bg-[#1c1f33]/80 backdrop-blur-md flex items-center justify-center hover:bg-[#d3bb73] transition-all duration-300 border border-[#d3bb73]/30"
          >
            <MoreVertical className="w-5 h-5 text-[#e5e4e2]" />
          </button>

          {isOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-[#1c1f33]/95 backdrop-blur-md rounded-lg shadow-xl border border-[#d3bb73]/30 overflow-hidden">
              {menu_items.map((item, index) => (
                <button
                  key={index}
                  onClick={() => {
                    item.onClick();
                    setIsOpen(false);
                  }}
                  className="w-full px-4 py-3 text-left text-[#e5e4e2] hover:bg-[#d3bb73]/20 transition-colors border-b border-[#d3bb73]/10 last:border-b-0"
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
