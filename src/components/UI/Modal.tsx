'use client';

import OverlayPortal from './OverlayPortal';
import React from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  scrollBody?: boolean;
}

export const Modal: React.FC<ModalProps> = ({ open, onClose, children, title, scrollBody = false }) => {
  if (!open) return null;

  return (
    <OverlayPortal>
    <div data-app-overlay="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={`relative bg-[#1c1f33] rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] ${scrollBody ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}>
        <div className={`${scrollBody ? 'relative shrink-0' : 'sticky top-0'} z-10 bg-[#1c1f33] border-b border-[#d3bb73]/20 p-6 flex items-center justify-between`}>
          {title && <h2 className="text-2xl font-light text-[#e5e4e2]">{title}</h2>}
          <button
            onClick={onClose}
            className="text-[#e5e4e2] hover:text-[#d3bb73] transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className={scrollBody ? 'min-h-0 overflow-y-auto overscroll-contain p-6' : 'p-6'}>{children}</div>
      </div>
    </div>
    </OverlayPortal>
  );
};
