'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Send, Paperclip } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { Conversation, ChatMessage } from './ChatWidget';

interface Props {
  conversation: Conversation;
  currentEmployeeId: string;
  isOnline: (id: string) => boolean;
  onBack: () => void;
}

interface SenderInfo {
  id: string;
  name: string;
  surname: string;
  nickname?: string | null;
  avatar_url?: string | null;
}

export default function ChatConversationView({ conversation, currentEmployeeId, isOnline, onBack }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const [senders, setSenders] = useState<Map<string, SenderInfo>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const otherParticipant = conversation.participants.find((p) => p.employee_id !== currentEmployeeId);
  const conversationName = conversation.title ||
    conversation.participants
      .filter((p) => p.employee_id !== currentEmployeeId)
      .map((p) => p.employee?.nickname || `${p.employee?.name || ''} ${p.employee?.surname || ''}`.trim())
      .join(', ') || 'Czat';

  const otherIsOnline = otherParticipant ? isOnline(otherParticipant.employee_id) : false;

  useEffect(() => {
    fetchMessages();
    markAsRead();

    const channel = supabase
      .channel(`chat_messages_${conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'employee_messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const msg = payload.new as ChatMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          if (msg.sender_id !== currentEmployeeId) {
            markAsRead();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation.id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchMessages = async () => {
    setIsLoadingMessages(true);
    const { data } = await supabase
      .from('employee_messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })
      .limit(100);

    setMessages(data || []);

    const senderIds = Array.from(new Set((data || []).map((m: ChatMessage) => m.sender_id)));
    if (senderIds.length > 0) {
      const { data: emps } = await supabase
        .from('employees')
        .select('id, name, surname, nickname, avatar_url')
        .in('id', senderIds);
      const map = new Map<string, SenderInfo>((emps || []).map((e: SenderInfo) => [e.id, e]));
      setSenders(map);
    }

    setIsLoadingMessages(false);
  };

  const markAsRead = async () => {
    await supabase
      .from('employee_conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversation.id)
      .eq('employee_id', currentEmployeeId);
  };

  const sendMessage = async () => {
    const content = newMessage.trim();
    if (!content || isSending) return;

    setIsSending(true);
    setNewMessage('');

    const { data: inserted, error } = await supabase.from('employee_messages').insert({
      conversation_id: conversation.id,
      sender_id: currentEmployeeId,
      content,
    }).select('id, conversation_id, sender_id, content, message_type, created_at').maybeSingle();

    if (error) {
      console.error('[Chat] send error:', error);
      setNewMessage(content);
    } else if (inserted) {
      triggerPushNotification(inserted);
    }
    setIsSending(false);
    inputRef.current?.focus();
  };

  const triggerPushNotification = (message: { id: string; conversation_id: string; sender_id: string; content: string; message_type: string; created_at: string }) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    fetch(`${supabaseUrl}/functions/v1/send-chat-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        type: 'INSERT',
        table: 'employee_messages',
        schema: 'public',
        record: message,
        old_record: null,
      }),
    }).catch((err) => console.warn('[Chat] Push trigger failed:', err));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatMessageTime = (dateStr: string): string => {
    return new Date(dateStr).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateSeparator = (dateStr: string): string => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Dzisiaj';
    if (date.toDateString() === yesterday.toDateString()) return 'Wczoraj';
    return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const shouldShowDateSeparator = (index: number): boolean => {
    if (index === 0) return true;
    const curr = new Date(messages[index].created_at).toDateString();
    const prev = new Date(messages[index - 1].created_at).toDateString();
    return curr !== prev;
  };

  const isConsecutive = (index: number): boolean => {
    if (index === 0) return false;
    const curr = messages[index];
    const prev = messages[index - 1];
    if (curr.sender_id !== prev.sender_id) return false;
    const timeDiff = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
    return timeDiff < 60000;
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[#d3bb73]/10 px-3 py-2">
        <button
          onClick={onBack}
          className="rounded-lg p-1 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="relative">
          {otherParticipant?.employee?.avatar_url ? (
            <img
              src={otherParticipant.employee.avatar_url}
              alt=""
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d3bb73]/15 text-xs font-semibold text-[#d3bb73]">
              {conversationName.charAt(0).toUpperCase()}
            </div>
          )}
          {otherIsOnline && (
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#1c1f33] bg-green-500" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-[#e5e4e2]">{conversationName}</span>
          <span className="text-[10px] text-[#e5e4e2]/40">
            {otherIsOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {isLoadingMessages ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d3bb73]/20 border-t-[#d3bb73]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1">
            <p className="text-xs text-[#e5e4e2]/40">Rozpocznij konwersację</p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isMine = msg.sender_id === currentEmployeeId;
            const showDate = shouldShowDateSeparator(idx);
            const consecutive = isConsecutive(idx);
            const sender = senders.get(msg.sender_id);

            return (
              <div key={msg.id}>
                {showDate && (
                  <div className="my-3 flex items-center justify-center">
                    <span className="rounded-full bg-[#0f1119]/60 px-3 py-0.5 text-[10px] text-[#e5e4e2]/40">
                      {formatDateSeparator(msg.created_at)}
                    </span>
                  </div>
                )}
                <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} ${consecutive ? 'mt-0.5' : 'mt-2'}`}>
                  {/* Other user avatar (only on first msg in group) */}
                  {!isMine && !consecutive && conversation.is_group && (
                    <div className="mr-1.5 mt-auto shrink-0">
                      {sender?.avatar_url ? (
                        <img src={sender.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#d3bb73]/10 text-[9px] font-semibold text-[#d3bb73]">
                          {(sender?.nickname || sender?.name || '?').charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                  )}
                  {!isMine && consecutive && conversation.is_group && <div className="mr-1.5 w-6 shrink-0" />}

                  <div className={`group relative max-w-[75%] ${isMine ? '' : ''}`}>
                    {/* Sender name for group chats */}
                    {!isMine && !consecutive && conversation.is_group && (
                      <p className="mb-0.5 ml-2 text-[9px] font-medium text-[#d3bb73]/60">
                        {sender?.nickname || sender?.name || 'Unknown'}
                      </p>
                    )}
                    <div
                      className={`rounded-2xl px-3 py-1.5 text-[13px] leading-relaxed ${
                        isMine
                          ? 'rounded-br-md bg-gradient-to-br from-[#d3bb73] to-[#c5aa5c] text-[#0f1119]'
                          : 'rounded-bl-md bg-[#262940] text-[#e5e4e2]'
                      }`}
                    >
                      {msg.content}
                    </div>
                    <p className={`mt-0.5 text-[9px] text-[#e5e4e2]/30 opacity-0 transition-opacity group-hover:opacity-100 ${isMine ? 'text-right' : 'text-left'}`}>
                      {formatMessageTime(msg.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[#d3bb73]/10 px-3 py-2">
        <div className="flex items-center gap-2 rounded-xl bg-[#0f1119]/60 px-3 py-2">
          <button className="text-[#e5e4e2]/30 transition-colors hover:text-[#d3bb73]">
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={inputRef}
            type="text"
            placeholder="Napisz wiadomość..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30 outline-none"
            autoFocus
          />
          <button
            onClick={sendMessage}
            disabled={!newMessage.trim() || isSending}
            className={`rounded-lg p-1.5 transition-all ${
              newMessage.trim()
                ? 'bg-[#d3bb73] text-[#0f1119] hover:bg-[#c5aa5c]'
                : 'text-[#e5e4e2]/20'
            }`}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
