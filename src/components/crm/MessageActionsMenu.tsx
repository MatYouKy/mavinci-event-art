'use client';

import { useState, useRef, useEffect } from 'react';
import { MoreVertical, Reply, Trash2, UserPlus, FolderInput, Forward, Star, Archive, Paperclip } from 'lucide-react';

interface MessageActionsMenuProps {
  messageId: string;
  messageType: 'contact_form' | 'sent' | 'received';
  isStarred?: boolean;
  onReply: () => void;
  onForward?: () => void;
  onAssign: () => void;
  onDelete: () => void;
  onMove: () => void;
  onStar?: () => void;
  onArchive?: () => void;
  onViewAttachments?: () => void;
  hasAttachments?: boolean;
  canManage: boolean;
}

export default function MessageActionsMenu({
  messageId,
  messageType,
  isStarred,
  onReply,
  onForward,
  onAssign,
  onDelete,
  onMove,
  onStar,
  onArchive,
  onViewAttachments,
  hasAttachments,
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
        <div className="fixed right-4 mt-2 w-56 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg shadow-xl z-[100] py-2"
             style={{
               top: menuRef.current?.getBoundingClientRect().bottom ?? 0,
               right: window.innerWidth - (menuRef.current?.getBoundingClientRect().right ?? 0),
             }}
        >
          <button
            onClick={() => handleAction(onReply)}
            className="w-full px-4 py-2 text-left text-[#e5e4e2] hover:bg-[#0f1119] transition-colors flex items-center gap-3"
          >
            <Reply className="w-4 h-4" />
            <span>Odpowiedz</span>
          </button>

          {onForward && (
            <button
              onClick={() => handleAction(onForward)}
              className="w-full px-4 py-2 text-left text-[#e5e4e2] hover:bg-[#0f1119] transition-colors flex items-center gap-3"
            >
              <Forward className="w-4 h-4" />
              <span>Przekaż dalej</span>
            </button>
          )}

          {hasAttachments && onViewAttachments && (
            <button
              onClick={() => handleAction(onViewAttachments)}
              className="w-full px-4 py-2 text-left text-[#e5e4e2] hover:bg-[#0f1119] transition-colors flex items-center gap-3"
            >
              <Paperclip className="w-4 h-4" />
              <span>Załączniki</span>
            </button>
          )}

          <div className="my-2 border-t border-[#d3bb73]/10" />

          {onStar && (
            <button
              onClick={() => handleAction(onStar)}
              className="w-full px-4 py-2 text-left text-[#e5e4e2] hover:bg-[#0f1119] transition-colors flex items-center gap-3"
            >
              <Star className={`w-4 h-4 ${isStarred ? 'fill-yellow-500 text-yellow-500' : ''}`} />
            </button>
          )}

          <button
            onClick={() => handleAction(onAssign)}
            className="w-full px-4 py-2 text-left text-[#e5e4e2] hover:bg-[#0f1119] transition-colors flex items-center gap-3"
          >
            <UserPlus className="w-4 h-4" />
            <span>Przypisz pracownika</span>
          </button>

          {messageType === 'received' && onArchive && (
            <button
              onClick={() => handleAction(onArchive)}
              className="w-full px-4 py-2 text-left text-[#e5e4e2] hover:bg-[#0f1119] transition-colors flex items-center gap-3"
            >
              <Archive className="w-4 h-4" />
              <span>Archiwizuj</span>
            </button>
          )}

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
