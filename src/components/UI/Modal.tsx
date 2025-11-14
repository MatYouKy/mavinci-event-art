import React from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
}

export const Modal: React.FC<ModalProps> = ({ open, onClose, children, title }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-[#1c1f33] shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-[#d3bb73]/20 bg-[#1c1f33] p-6">
          {title && <h2 className="text-2xl font-light text-[#e5e4e2]">{title}</h2>}
          <button
            onClick={onClose}
            className="text-[#e5e4e2] transition-colors hover:text-[#d3bb73]"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};
