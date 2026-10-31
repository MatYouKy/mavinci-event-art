'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, X, Minus } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useAuth } from '@/contexts/AuthContext';
import { IEmployee } from '@/app/(crm)/crm/employees/type';
import ChatConversationList from './ChatConversationList';
import ChatConversationView from './ChatConversationView';
import ChatNewConversation from './ChatNewConversation';
import { fetchChatUnreadCounts, markChatDelivered } from '@/lib/CRM/chat/chatReadState';

export interface Conversation {
  id: string;
  title: string | null;
  is_group: boolean;
  created_by: string;
  last_message_at: string;
  last_message_preview: string | null;
  /** Nadawca ostatniej wiadomości (puste, gdy nadawcy nie ma już wśród pracowników). */
  last_message_sender_id?: string | null;
  created_at: string;
  participants: ConversationParticipant[];
  unread_count: number;
}

export interface ConversationParticipant {
  id: string;
  conversation_id: string;
  employee_id: string;
  last_read_at: string | null;
  last_delivered_at?: string | null;
  employee?: {
    id: string;
    name: string;
    surname: string;
    nickname?: string | null;
    avatar_url?: string | null;
  };
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: string;
  attachment_url: string | null;
  attachment_filename?: string | null;
  attachment_size?: number | null;
  is_edited: boolean;
  created_at: string;
  reactions?: { emoji: string; user_id: string } | null;
}

type WidgetView = 'list' | 'conversation' | 'new';

export default function ChatWidget({ employee }: { employee: IEmployee }) {
  const { isOnline, employeeId } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [initialEmployeeId, setInitialEmployeeId] = useState<string | undefined>();
  const [view, setView] = useState<WidgetView>('list');
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const totalUnread = conversations.reduce((sum, conversation) => sum + conversation.unread_count, 0);
  const [isLoading, setIsLoading] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatSessionStartedAtRef = useRef(Date.now());
  const realtimeReadyRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const recountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Never silently use another session's identity while CRM displays this employee.
  const currentEmployeeId = employeeId === employee.id ? employeeId : null;

  useEffect(() => {
    const openEmployee = (event: Event) => {
      const target = (event as CustomEvent<{employeeId?: string}>).detail?.employeeId;
      if (!currentEmployeeId || !target || target === currentEmployeeId) return;
      const existing = conversations.find(conversation => !conversation.is_group &&
        conversation.participants.length === 2 &&
        conversation.participants.some(participant => participant.employee_id === target));
      setIsOpen(true); setIsMinimized(false);
      if (existing) { setActiveConversation(existing); setView('conversation'); }
      else { setInitialEmployeeId(target); setView('new'); }
    };
    window.addEventListener('crm-chat-open-employee', openEmployee);
    return () => window.removeEventListener('crm-chat-open-employee', openEmployee);
  }, [currentEmployeeId, conversations]);

  // Request browser notification permission early
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const fetchConversations = useCallback(async () => {
    if (!currentEmployeeId) return;
    // Spinner tylko przy pierwszym wczytaniu — odświeżenie listy nie miga.
    if (!hasLoadedRef.current) setIsLoading(true);
    try {
      const { data: participations } = await supabase
        .from('employee_conversation_participants')
        .select('conversation_id')
        .eq('employee_id', currentEmployeeId);

      if (!participations || participations.length === 0) {
        setConversations([]);
        return;
      }

      const convIds = participations.map((p) => p.conversation_id);

      const [{ data: convs }, { data: allParticipants }, unreadCounts] = await Promise.all([
        supabase
          .from('employee_conversations')
          .select('*')
          .in('id', convIds)
          .order('last_message_at', { ascending: false }),
        supabase
          .from('employee_conversation_participants')
          .select('id, conversation_id, employee_id, last_read_at, last_delivered_at')
          .in('conversation_id', convIds),
        // Tylko wiadomości od innych osób, nowsze niż mój znacznik odczytu (liczy serwer).
        fetchChatUnreadCounts(supabase),
      ]);

      if (!convs) {
        setConversations([]);
        return;
      }

      const empIds = Array.from(new Set((allParticipants || []).map((p) => p.employee_id)));
      const { data: employees } = await supabase
        .from('employees')
        .select('id, name, surname, nickname, avatar_url')
        .in('id', empIds);

      const empMap = new Map((employees || []).map((e) => [e.id, e]));

      const enriched: Conversation[] = convs.map((conv) => {
        const parts = (allParticipants || [])
          .filter((p) => p.conversation_id === conv.id)
          .map((p) => ({ ...p, employee: empMap.get(p.employee_id) }));

        return { ...conv, participants: parts, unread_count: unreadCounts.get(conv.id) || 0 };
      });

      setConversations(enriched);
      // CRM jest otwarty, więc wiadomości dotarły — nadawca zobaczy „Dostarczono”.
      void markChatDelivered(supabase);
    } catch (err) {
      console.error('[ChatWidget] fetchConversations error:', err);
    } finally {
      hasLoadedRef.current = true;
      setIsLoading(false);
    }
  }, [currentEmployeeId]);

  // Liczniki z serwera: po przeczytaniu rozmowy w innym oknie lub w aplikacji mobilnej, po powrocie do okna.
  const recountUnread = useCallback(() => {
    if (recountTimerRef.current) clearTimeout(recountTimerRef.current);
    recountTimerRef.current = setTimeout(async () => {
      recountTimerRef.current = null;
      try {
        const counts = await fetchChatUnreadCounts(supabase);
        setConversations((prev) => prev.map((c) => ({ ...c, unread_count: counts.get(c.id) || 0 })));
      } catch (err) {
        console.error('[ChatWidget] recountUnread error:', err);
      }
    }, 300);
  }, []);

  useEffect(() => () => {
    if (recountTimerRef.current) clearTimeout(recountTimerRef.current);
  }, []);

  useEffect(() => {
    if (!currentEmployeeId) return;
    const onActive = () => {
      if (document.visibilityState !== 'visible') return;
      recountUnread();
      void markChatDelivered(supabase);
    };
    window.addEventListener('focus', onActive);
    document.addEventListener('visibilitychange', onActive);
    return () => {
      window.removeEventListener('focus', onActive);
      document.removeEventListener('visibilitychange', onActive);
    };
  }, [currentEmployeeId, recountUnread]);

  useEffect(() => {
    if (!currentEmployeeId) return;
    fetchConversations();
  }, [currentEmployeeId, fetchConversations]);

  const activeConversationRef = useRef<string | null>(null);
  activeConversationRef.current = isOpen && !isMinimized && view === 'conversation' ? activeConversation?.id ?? null : null;

  // Preload only. Playing a silent fragment on the first click caused an
  // audible click in some browsers and made ordinary CRM actions sound.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const audio = new Audio('/sounds/chat-notification.wav');
    audio.volume = 0.5;
    audio.preload = 'auto';
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, []);

  const playChatSound = useCallback(() => {
    try {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }
    } catch {}
  }, []);

  const showBrowserNotification = useCallback(
    (msg: ChatMessage) => {
      if (typeof window === 'undefined') return;
      if (Notification.permission !== 'granted') {
        Notification.requestPermission();
        return;
      }
      const conv = conversations.find((c) => c.id === msg.conversation_id);
      const sender = conv?.participants?.find((p) => p.employee_id === msg.sender_id)?.employee;
      const senderName = sender?.nickname || [sender?.name, sender?.surname].filter(Boolean).join(' ') || 'Nowa wiadomość';
      const title = conv?.is_group && conv?.title ? `${conv.title}` : senderName;
      const body = msg.content?.substring(0, 150) || 'Nowa wiadomość';

      const notification = new Notification(title, {
        body,
        icon: '/logo-mavinci-crm.png',
        tag: `chat-${msg.conversation_id}`,
        // The in-app sound is the single source of audio. This prevents the
        // browser notification and CRM from playing two sounds at once.
        silent: true,
      });
      notification.onclick = () => {
        window.focus();
        setIsOpen(true);
        setIsMinimized(false);
        const targetConv = conversations.find((c) => c.id === msg.conversation_id);
        if (targetConv) {
          setActiveConversation(targetConv);
          setView('conversation');
        }
        notification.close();
      };
    },
    [conversations],
  );

  const showBrowserNotificationRef = useRef(showBrowserNotification);
  showBrowserNotificationRef.current = showBrowserNotification;

  useEffect(() => {
    if (!currentEmployeeId) return;

    chatSessionStartedAtRef.current = Date.now();
    realtimeReadyRef.current = false;

    const channel = supabase
      .channel('chat_widget_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'employee_messages' },
        (payload) => {
          const msg = payload.new as ChatMessage;
          const isOwnMessage = msg.sender_id === currentEmployeeId;
          const isActiveConv = activeConversationRef.current === msg.conversation_id && document.visibilityState === 'visible' && document.hasFocus();
          const messageCreatedAt = Date.parse(msg.created_at || '');
          const isNewInCurrentSession =
            realtimeReadyRef.current &&
            Number.isFinite(messageCreatedAt) &&
            messageCreatedAt >= chatSessionStartedAtRef.current;

          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === msg.conversation_id);
            if (idx === -1) {
              fetchConversations();
              return prev;
            }
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              last_message_at: msg.created_at,
              last_message_preview: msg.content?.substring(0, 100) || null,
              last_message_sender_id: msg.sender_id,
              // Własna wiadomość (także wysłana z telefonu) oznacza przeczytanie rozmowy, jak w Messengerze.
              unread_count: isOwnMessage
                ? 0
                : !isActiveConv
                  ? updated[idx].unread_count + 1
                  : updated[idx].unread_count,
            };
            updated.sort(
              (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime(),
            );
            return updated;
          });

          if (!isOwnMessage && !isActiveConv) {
            void markChatDelivered(supabase, msg.conversation_id);
          }

          if (!isOwnMessage && !isActiveConv && isNewInCurrentSession) {
            if (document.visibilityState === 'visible' && document.hasFocus()) {
              playChatSound();
            }
            showBrowserNotificationRef.current(msg);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'employee_conversation_participants' },
        (payload) => {
          const row = payload.new as {
            conversation_id: string;
            employee_id: string;
            last_read_at: string | null;
            last_delivered_at: string | null;
          };
          // Status „Wyświetlono” na liście rozmów.
          setConversations((prev) =>
            prev.map((c) =>
              c.id !== row.conversation_id
                ? c
                : {
                    ...c,
                    participants: c.participants.map((p) =>
                      p.employee_id === row.employee_id
                        ? { ...p, last_read_at: row.last_read_at, last_delivered_at: row.last_delivered_at }
                        : p,
                    ),
                  },
            ),
          );
          // Mój znacznik zmienił się (to okno, inna karta, telefon) — licznik z serwera.
          if (row.employee_id === currentEmployeeId) recountUnread();
        },
      )
      .subscribe((status) => {
        realtimeReadyRef.current = status === 'SUBSCRIBED';
        // Po ponownym połączeniu mogło coś umknąć.
        if (status === 'SUBSCRIBED') recountUnread();
      });

    channelRef.current = channel;
    return () => {
      realtimeReadyRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [currentEmployeeId, fetchConversations, playChatSound, recountUnread]);

  const openConversation = (conv: Conversation) => {
    setActiveConversation(conv);
    setView('conversation');
    setConversations((prev) =>
      prev.map((c) => (c.id === conv.id ? { ...c, unread_count: 0 } : c)),
    );
  };

  const handleBack = () => {
    setView('list');
    setActiveConversation(null);
    fetchConversations();
  };

  const handleNewConversation = () => {
    setInitialEmployeeId(undefined);
    setView('new');
  };

  const handleConversationCreated = (conv: Conversation) => {
    setActiveConversation(conv);
    setView('conversation');
    fetchConversations();
  };

  if (employeeId && employeeId !== employee.id) return (
    <div role="alert" className="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl bg-[#3a0c20] p-4 text-sm text-white shadow-lg">
      Konto w sesji różni się od konta wyświetlanego w CRM. Odśwież stronę przed korzystaniem z komunikatora.
      <button type="button" onClick={() => window.location.reload()} className="mt-3 block text-[#d3bb73]">Odśwież CRM</button>
    </div>
  );
  if (!currentEmployeeId) return null;

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => { setIsOpen(true); setIsMinimized(false); }}
          className="fixed bottom-6 right-6 z-[9999] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#d3bb73] to-[#b8a050] shadow-lg shadow-[#d3bb73]/20 transition-all duration-200 hover:scale-105 hover:shadow-xl hover:shadow-[#d3bb73]/30"
        >
          <MessageCircle className="h-6 w-6 text-[#0f1119]" />
          {totalUnread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </button>
      )}

      {/* Widget panel */}
      {isOpen && (
        <div
          className={`fixed bottom-6 right-6 z-[9999] flex flex-col overflow-hidden rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl shadow-black/40 transition-all duration-300 ${
            isMinimized ? 'h-14 w-80' : 'h-[560px] w-[380px]'
          }`}
        >
          {/* Header */}
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#d3bb73]/10 bg-[#161829] px-4">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-[#d3bb73]" />
              <span className="text-sm font-semibold text-[#e5e4e2]">Komunikator</span>
              {totalUnread > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                  {totalUnread}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className="rounded-lg p-1.5 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                onClick={() => { setIsOpen(false); setIsMinimized(false); }}
                className="rounded-lg p-1.5 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Content */}
          {!isMinimized && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {view === 'list' && (
                <ChatConversationList
                  conversations={conversations}
                  isLoading={isLoading}
                  currentEmployeeId={currentEmployeeId}
                  isOnline={isOnline}
                  onSelect={openConversation}
                  onNewChat={handleNewConversation}
                />
              )}
              {view === 'conversation' && activeConversation && (
                <ChatConversationView
                  conversation={activeConversation}
                  currentEmployeeId={currentEmployeeId}
                  isOnline={isOnline}
                  onBack={handleBack}
                />
              )}
              {view === 'new' && (
                <ChatNewConversation
                  key={initialEmployeeId || "manual"}
                  initialEmployeeId={initialEmployeeId}
                  currentEmployeeId={currentEmployeeId}
                  onBack={() => setView('list')}
                  onConversationCreated={handleConversationCreated}
                />
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
