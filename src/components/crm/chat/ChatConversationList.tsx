'use client';

import { Search, Plus } from 'lucide-react';
import { useState } from 'react';
import { Conversation } from './ChatWidget';

interface Props {
  conversations: Conversation[];
  isLoading: boolean;
  currentEmployeeId: string;
  isOnline: (id: string) => boolean;
  onSelect: (conv: Conversation) => void;
  onNewChat: () => void;
}

export default function ChatConversationList({
  conversations,
  isLoading,
  currentEmployeeId,
  isOnline,
  onSelect,
  onNewChat,
}: Props) {
  const [search, setSearch] = useState('');

  const getConversationName = (conv: Conversation): string => {
    if (conv.title) return conv.title;
    const others = conv.participants.filter((p) => p.employee_id !== currentEmployeeId);
    if (others.length === 0) return 'Ty';
    return others
      .map((p) => p.employee?.nickname || `${p.employee?.name || ''} ${p.employee?.surname || ''}`.trim())
      .join(', ');
  };

  const getOtherParticipant = (conv: Conversation) => {
    return conv.participants.find((p) => p.employee_id !== currentEmployeeId);
  };

  const getAvatarInitials = (conv: Conversation): string => {
    const other = getOtherParticipant(conv);
    if (!other?.employee) return '?';
    const n = other.employee.nickname || other.employee.name || '';
    const s = other.employee.surname || '';
    return `${n.charAt(0)}${s.charAt(0)}`.toUpperCase();
  };

  const isOtherOnline = (conv: Conversation): boolean => {
    if (conv.is_group) return conv.participants.some((p) => p.employee_id !== currentEmployeeId && isOnline(p.employee_id));
    const other = getOtherParticipant(conv);
    return other ? isOnline(other.employee_id) : false;
  };

  const formatTime = (dateStr: string | null): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'Wczoraj';
    if (days < 7) return date.toLocaleDateString('pl-PL', { weekday: 'short' });
    return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
  };

  const filtered = conversations.filter((conv) => {
    if (!search.trim()) return true;
    const name = getConversationName(conv).toLowerCase();
    return name.includes(search.toLowerCase());
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Search + New Chat */}
      <div className="flex items-center gap-2 border-b border-[#d3bb73]/10 px-3 py-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg bg-[#0f1119]/60 px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-[#e5e4e2]/40" />
          <input
            type="text"
            placeholder="Szukaj..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-xs text-[#e5e4e2] placeholder-[#e5e4e2]/40 outline-none"
          />
        </div>
        <button
          onClick={onNewChat}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#d3bb73]/10 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#d3bb73]/20 border-t-[#d3bb73]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12">
            <MessageCircleIcon />
            <p className="text-xs text-[#e5e4e2]/40">
              {search ? 'Brak wyników' : 'Brak konwersacji'}
            </p>
            {!search && (
              <button
                onClick={onNewChat}
                className="mt-2 rounded-lg bg-[#d3bb73]/10 px-3 py-1.5 text-xs text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
              >
                Rozpocznij czat
              </button>
            )}
          </div>
        ) : (
          filtered.map((conv) => (
            <button
              key={conv.id}
              onClick={() => onSelect(conv)}
              className="flex w-full items-center gap-3 border-b border-[#d3bb73]/5 px-3 py-2.5 text-left transition-colors hover:bg-[#d3bb73]/5"
            >
              {/* Avatar */}
              <div className="relative shrink-0">
                {getOtherParticipant(conv)?.employee?.avatar_url ? (
                  <img
                    src={getOtherParticipant(conv)!.employee!.avatar_url!}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73]/15 text-sm font-semibold text-[#d3bb73]">
                    {conv.is_group ? (
                      <span className="text-xs">{conv.participants.length}</span>
                    ) : (
                      getAvatarInitials(conv)
                    )}
                  </div>
                )}
                {isOtherOnline(conv) && (
                  <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#1c1f33] bg-green-500" />
                )}
              </div>

              {/* Info */}
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center justify-between">
                  <span className={`truncate text-sm ${conv.unread_count > 0 ? 'font-semibold text-[#e5e4e2]' : 'font-medium text-[#e5e4e2]/80'}`}>
                    {getConversationName(conv)}
                  </span>
                  <span className="ml-2 shrink-0 text-[10px] text-[#e5e4e2]/40">
                    {formatTime(conv.last_message_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`truncate text-xs ${conv.unread_count > 0 ? 'text-[#e5e4e2]/70' : 'text-[#e5e4e2]/40'}`}>
                    {conv.last_message_preview || 'Brak wiadomości'}
                  </span>
                  {conv.unread_count > 0 && (
                    <span className="ml-2 flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-[#d3bb73] px-1 text-[9px] font-bold text-[#0f1119]">
                      {conv.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function MessageCircleIcon() {
  return (
    <svg className="h-10 w-10 text-[#e5e4e2]/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}
