'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, X, Minus } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useAuth } from '@/contexts/AuthContext';
import { IEmployee } from '@/app/(crm)/crm/employees/type';
import ChatConversationList from './ChatConversationList';
import ChatConversationView from './ChatConversationView';
import ChatNewConversation from './ChatNewConversation';

export interface Conversation {
  id: string;
  title: string | null;
  is_group: boolean;
  created_by: string;
  last_message_at: string;
  last_message_preview: string | null;
  created_at: string;
  participants: ConversationParticipant[];
  unread_count: number;
}

export interface ConversationParticipant {
  id: string;
  conversation_id: string;
  employee_id: string;
  last_read_at: string | null;
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
}

type WidgetView = 'list' | 'conversation' | 'new';

export default function ChatWidget({ employee }: { employee: IEmployee }) {
  const { isOnline, employeeId } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [view, setView] = useState<WidgetView>('list');
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [totalUnread, setTotalUnread] = useState(0);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);

  const currentEmployeeId = employeeId || employee.id;

  // Request browser notification permission early
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const fetchConversations = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data: participations } = await supabase
        .from('employee_conversation_participants')
        .select('conversation_id, last_read_at')
        .eq('employee_id', currentEmployeeId);

      if (!participations || participations.length === 0) {
        setConversations([]);
        setTotalUnread(0);
        setIsLoading(false);
        return;
      }

      const convIds = participations.map((p) => p.conversation_id);
      const lastReadMap = new Map(participations.map((p) => [p.conversation_id, p.last_read_at]));

      const { data: convs } = await supabase
        .from('employee_conversations')
        .select('*')
        .in('id', convIds)
        .order('last_message_at', { ascending: false });

      if (!convs) {
        setConversations([]);
        setIsLoading(false);
        return;
      }

      const { data: allParticipants } = await supabase
        .from('employee_conversation_participants')
        .select('id, conversation_id, employee_id, last_read_at')
        .in('conversation_id', convIds);

      const empIds = Array.from(new Set((allParticipants || []).map((p) => p.employee_id)));
      const { data: employees } = await supabase
        .from('employees')
        .select('id, name, surname, nickname, avatar_url')
        .in('id', empIds);

      const empMap = new Map((employees || []).map((e) => [e.id, e]));

      let unreadTotal = 0;
      const enriched: Conversation[] = convs.map((conv) => {
        const parts = (allParticipants || [])
          .filter((p) => p.conversation_id === conv.id)
          .map((p) => ({ ...p, employee: empMap.get(p.employee_id) }));

        const lastRead = lastReadMap.get(conv.id);
        let unreadCount = 0;
        if (conv.last_message_at && (!lastRead || new Date(conv.last_message_at) > new Date(lastRead))) {
          unreadCount = 1;
        }
        unreadTotal += unreadCount;

        return { ...conv, participants: parts, unread_count: unreadCount };
      });

      setConversations(enriched);
      setTotalUnread(unreadTotal);
    } catch (err) {
      console.error('[ChatWidget] fetchConversations error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentEmployeeId]);

  useEffect(() => {
    if (!currentEmployeeId) return;
    fetchConversations();
  }, [currentEmployeeId, fetchConversations]);

  const activeConversationRef = useRef<string | null>(null);
  activeConversationRef.current = activeConversation?.id ?? null;

  // Pre-load notification sound
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const audio = new Audio('/sounds/chat-notification.wav');
    audio.volume = 0.5;
    audio.preload = 'auto';
    audioRef.current = audio;

    // Unlock audio context on first user interaction
    const unlock = () => {
      if (!audioUnlockedRef.current && audioRef.current) {
        audioRef.current.play().then(() => {
          audioRef.current!.pause();
          audioRef.current!.currentTime = 0;
          audioUnlockedRef.current = true;
        }).catch(() => {});
      }
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('click', unlock);
    document.addEventListener('keydown', unlock);

    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
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
        silent: false,
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

    const channel = supabase
      .channel('chat_widget_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'employee_messages' },
        (payload) => {
          const msg = payload.new as ChatMessage;
          const isOwnMessage = msg.sender_id === currentEmployeeId;
          const isActiveConv = activeConversationRef.current === msg.conversation_id;

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
              unread_count:
                !isOwnMessage && !isActiveConv
                  ? updated[idx].unread_count + 1
                  : updated[idx].unread_count,
            };
            updated.sort(
              (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime(),
            );
            return updated;
          });

          if (!isOwnMessage && !isActiveConv) {
            setTotalUnread((u) => u + 1);
            playChatSound();
            showBrowserNotificationRef.current(msg);
          }
        },
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentEmployeeId, fetchConversations, playChatSound]);

  const openConversation = (conv: Conversation) => {
    setActiveConversation(conv);
    setView('conversation');
    setConversations((prev) =>
      prev.map((c) => (c.id === conv.id ? { ...c, unread_count: 0 } : c)),
    );
    setTotalUnread((u) => Math.max(0, u - conv.unread_count));
  };

  const handleBack = () => {
    setView('list');
    setActiveConversation(null);
    fetchConversations();
  };

  const handleNewConversation = () => {
    setView('new');
  };

  const handleConversationCreated = (conv: Conversation) => {
    setActiveConversation(conv);
    setView('conversation');
    fetchConversations();
  };

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
