'use client';

import { useState, useRef, useEffect } from 'react';
import { MoreVertical, Reply, Trash2, UserPlus, FolderInput } from 'lucide-react';

interface MessageActionsMenuProps {
  messageId: string;
  messageType: 'contact_form' | 'sent' | 'received';
  onReply: () => void;
  onAssign: () => void;
  onDelete: () => void;
  onMove: () => void;
  canManage: boolean;
}

export default function MessageActionsMenu({
  messageId,
  messageType,
  onReply,
  onAssign,
  onDelete,
  onMove,
  canManage,
}: MessageActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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

  const handleAction = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] hover:bg-[#0f1119] rounded-lg transition-colors"
        title="Akcje"
      >
        <MoreVertical className="w-5 h-5" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg shadow-xl z-50 py-2">
          <button
            onClick={() => handleAction(onReply)}
            className="w-full px-4 py-2 text-left text-[#e5e4e2] hover:bg-[#0f1119] transition-colors flex items-center gap-3"
          >
            <Reply className="w-4 h-4" />
            <span>Odpowiedz</span>
          </button>

          <button
            onClick={() => handleAction(onAssign)}
            className="w-full px-4 py-2 text-left text-[#e5e4e2] hover:bg-[#0f1119] transition-colors flex items-center gap-3"
          >
            <UserPlus className="w-4 h-4" />
            <span>Przypisz pracownika</span>
          </button>

          {messageType === 'received' && (
            <button
              onClick={() => handleAction(onMove)}
              className="w-full px-4 py-2 text-left text-[#e5e4e2] hover:bg-[#0f1119] transition-colors flex items-center gap-3"
            >
              <FolderInput className="w-4 h-4" />
              <span>Przenieś do folderu</span>
            </button>
          )}

          {canManage && (
            <>
              <div className="my-2 border-t border-[#d3bb73]/10" />
              <button
                onClick={() => handleAction(onDelete)}
                className="w-full px-4 py-2 text-left text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-3"
              >
                <Trash2 className="w-4 h-4" />
                <span>Usuń wiadomość</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
