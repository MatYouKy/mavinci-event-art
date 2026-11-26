'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageCircle, Paperclip } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  meetingChatFileSize,
  meetingChatMessagesLabel,
  meetingChatUnreadLabel,
  parseMeetingChat,
  type MeetingChatInfo,
} from '@/lib/meetings/meetingChat';

/*
 * Szczegóły spotkania → „Czat spotkania” (`docs/meeting-chat.md`): rozmowa organizatora i zaproszonych pracowników
 * w Komunikatorze — także przed odpowiedzią na zaproszenie (prośba o inny termin, ustalenia, agenda). „Otwórz czat”
 * zakłada rozmowę przy pierwszym otwarciu i otwiera ją w panelu Komunikatora (`crm-chat-open-conversation`); pliki dodaje
 * się w czacie, a tu widać ostatnie z nich. Tylko dla uczestników i organizatora (sprawdza też baza).
 */

const FILES_SHOWN = 5;
const dateFormatter = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function MeetingChatSection({ meetingId, compact = false }: { meetingId: string; compact?: boolean }) {
  const { showSnackbar } = useSnackbar();
  const [info, setInfo] = useState<MeetingChatInfo | null>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('meeting_chat', { p_meeting_id: meetingId, p_create: false });
    if (!error) setInfo(parseMeetingChat(data));
  }, [meetingId]);

  useEffect(() => {
    setInfo(null);
    void load();
  }, [load]);

  // Po powrocie do karty (np. z czatu w innym oknie) — świeże liczniki i pliki.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  const open = async () => {
    setOpening(true);
    const { data, error } = await supabase.rpc('meeting_chat', { p_meeting_id: meetingId, p_create: true });
    setOpening(false);
    if (error) {
      showSnackbar(error.message || 'Nie udało się otworzyć czatu spotkania', 'error');
      return;
    }
    const next = parseMeetingChat(data);
    setInfo(next);
    if (next.conversationId) {
      window.dispatchEvent(new CustomEvent('crm-chat-open-conversation', { detail: { conversationId: next.conversationId } }));
    }
  };

  const messages = info?.member ? info.messages : 0;
  const unread = info?.member ? info.unread : 0;
  const files = info?.member ? info.files : [];

  return (
    <div className={compact ? '' : 'rounded-lg border border-[#d3bb73]/20 bg-[#13161f] p-4'}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-[#d3bb73]">
            <MessageCircle className="h-4 w-4" />
            Czat spotkania
          </p>
          <p className="mt-1 text-xs text-[#e5e4e2]/60">
            {messages > 0
              ? `${meetingChatMessagesLabel(messages)}${unread > 0 ? ` · ${meetingChatUnreadLabel(unread)}` : ''}`
              : 'Napisz do organizatora i uczestników — np. prośba o inny termin, ustalenia albo agenda (pliki dodasz w czacie).'}
          </p>
        </div>
        <button
          type="button"
          onClick={open}
          disabled={opening}
          className="relative flex shrink-0 items-center gap-1.5 rounded-lg bg-[#d3bb73]/15 px-3 py-1.5 text-xs font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/25 disabled:opacity-50"
        >
          {opening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
          Otwórz czat
          {unread > 0 && (
            <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </div>
      {files.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-[#e5e4e2]/45">Pliki z czatu</p>
          {files.slice(0, FILES_SHOWN).map((file) => (
            <a
              key={file.id}
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md bg-white/[0.03] px-2.5 py-1.5 text-sm text-[#e5e4e2]/85 transition-colors hover:bg-white/[0.07]"
              title={file.name}
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-[#d3bb73]" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-[11px] text-[#e5e4e2]/45">
                {[meetingChatFileSize(file.size), file.sender, file.createdAt ? dateFormatter.format(new Date(file.createdAt)) : '']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </a>
          ))}
          {files.length > FILES_SHOWN && (
            <p className="text-xs text-[#e5e4e2]/45">…i {files.length - FILES_SHOWN} więcej w czacie</p>
          )}
        </div>
      )}
    </div>
  );
}
