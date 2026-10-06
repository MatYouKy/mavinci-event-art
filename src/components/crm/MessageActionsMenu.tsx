'use client';

import ResponsiveActionBar from './ResponsiveActionBar';
import { Reply, Trash2, UserPlus, FolderInput, Forward, Star, Archive, Paperclip, ClipboardList, ListPlus } from 'lucide-react';

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
  onCreateInquiry?: () => void;
  onCreateTask?: () => void;
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
  onCreateInquiry,
  onCreateTask,
  hasAttachments,
  canManage,
}: MessageActionsMenuProps) {
  return <ResponsiveActionBar alwaysDropdown disabledBackground actions={[
    { label: 'Odpowiedz', icon: <Reply className="h-4 w-4" />, onClick: onReply },
    { label: 'Przekaż dalej', icon: <Forward className="h-4 w-4" />, onClick: () => onForward?.(), show: Boolean(onForward) },
    { label: 'Załączniki', icon: <Paperclip className="h-4 w-4" />, onClick: () => onViewAttachments?.(), show: Boolean(hasAttachments && onViewAttachments) },
    { label: isStarred ? 'Usuń gwiazdkę' : 'Oznacz gwiazdką', icon: <Star className={`h-4 w-4 ${isStarred ? 'fill-yellow-500 text-yellow-500' : ''}`} />, onClick: () => onStar?.(), show: Boolean(onStar) },
    { label: 'Przypisz pracownika', icon: <UserPlus className="h-4 w-4" />, onClick: onAssign },
    { label: 'Powiąż z zapytaniem', icon: <ClipboardList className="h-4 w-4" />, onClick: () => onCreateInquiry?.(), show: Boolean(onCreateInquiry) },
    { label: 'Utwórz zadanie', icon: <ListPlus className="h-4 w-4" />, onClick: () => onCreateTask?.(), show: Boolean(onCreateTask) },
    { label: 'Archiwizuj', icon: <Archive className="h-4 w-4" />, onClick: () => onArchive?.(), show: messageType === 'received' && Boolean(onArchive) },
    { label: 'Przenieś do folderu', icon: <FolderInput className="h-4 w-4" />, onClick: onMove, show: messageType === 'received' },
    { label: 'Usuń wiadomość', icon: <Trash2 className="h-4 w-4" />, onClick: onDelete, show: canManage, variant: 'danger' },
  ]} />;
}
