'use client';

import { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Send,
  Paperclip,
  X,
  FileText,
  Film,
  Image as ImageIcon,
  Download,
  MoreVertical,
  Trash2,
  CheckCircle2,
  Circle,
} from 'lucide-react';
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

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

function getMessageType(mimeType: string): string {
  if (ALLOWED_IMAGE_TYPES.includes(mimeType)) return 'image';
  if (ALLOWED_VIDEO_TYPES.includes(mimeType)) return 'video';
  return 'file';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatConversationView({
  conversation,
  currentEmployeeId,
  isOnline,
  onBack,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(true);
  const [senders, setSenders] = useState<Map<string, SenderInfo>>(new Map());
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [showMenu, setShowMenu] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const otherParticipant = conversation.participants.find(
    (p) => p.employee_id !== currentEmployeeId,
  );
  const conversationName =
    conversation.title ||
    conversation.participants
      .filter((p) => p.employee_id !== currentEmployeeId)
      .map(
        (p) =>
          p.employee?.nickname || `${p.employee?.name || ''} ${p.employee?.surname || ''}`.trim(),
      )
      .join(', ') ||
    'Czat';

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

  useEffect(() => {
    return () => {
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    };
  }, [pendingPreview]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchMessages = async () => {
    setIsLoadingMessages(true);

    // Load deleted message IDs from localStorage
    const storageKey = `chat_deleted_${currentEmployeeId}`;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        setDeletedIds(new Set(JSON.parse(stored)));
      }
    } catch {}

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

  const uploadFile = async (
    file: File,
  ): Promise<{ url: string; filename: string; size: number; messageType: string } | null> => {
    const messageType = getMessageType(file.type);
    const ext = file.name.split('.').pop() || 'bin';
    const storagePath = `${conversation.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error } = await supabase.storage
      .from('chat-attachments')
      .upload(storagePath, file, { contentType: file.type });

    if (error) {
      console.error('[Chat] Upload error:', error);
      return null;
    }

    const { data: urlData } = supabase.storage.from('chat-attachments').getPublicUrl(storagePath);
    return { url: urlData.publicUrl, filename: file.name, size: file.size, messageType };
  };

  const sendMessage = async () => {
    const content = newMessage.trim();
    const file = pendingFile;
    if (!content && !file) return;
    if (isSending) return;

    setIsSending(true);
    setNewMessage('');
    setPendingFile(null);
    if (pendingPreview) {
      URL.revokeObjectURL(pendingPreview);
      setPendingPreview(null);
    }

    let attachmentData: Awaited<ReturnType<typeof uploadFile>> = null;
    if (file) {
      attachmentData = await uploadFile(file);
      if (!attachmentData) {
        setIsSending(false);
        setPendingFile(file);
        return;
      }
    }

    const insertPayload: Record<string, unknown> = {
      conversation_id: conversation.id,
      sender_id: currentEmployeeId,
      content: content || (attachmentData?.filename ?? ''),
      message_type: attachmentData ? attachmentData.messageType : 'text',
    };
    if (attachmentData) {
      insertPayload.attachment_url = attachmentData.url;
      insertPayload.attachment_filename = attachmentData.filename;
      insertPayload.attachment_size = attachmentData.size;
    }

    const { data: inserted, error } = await supabase
      .from('employee_messages')
      .insert(insertPayload)
      .select('id, conversation_id, sender_id, content, message_type, created_at')
      .maybeSingle();

    if (error) {
      console.error('[Chat] send error:', error);
      if (content) setNewMessage(content);
      if (file) setPendingFile(file);
    } else if (inserted) {
      triggerPushNotification(inserted);
    }
    setIsSending(false);
    inputRef.current?.focus();
  };

  const triggerPushNotification = (message: {
    id: string;
    conversation_id: string;
    sender_id: string;
    content: string;
    message_type: string;
    created_at: string;
  }) => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    fetch(`${supabaseUrl}/functions/v1/send-chat-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({
        type: 'INSERT',
        table: 'employee_messages',
        schema: 'public',
        record: message,
        old_record: null,
      }),
    }).catch((err) => console.warn('[Chat] Push trigger failed:', err));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      alert(`Plik jest zbyt duży. Maksymalny rozmiar: ${formatFileSize(MAX_FILE_SIZE)}`);
      return;
    }
    setPendingFile(file);
    if (file.type.startsWith('image/')) {
      setPendingPreview(URL.createObjectURL(file));
    } else {
      setPendingPreview(null);
    }
    inputRef.current?.focus();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePendingFile = () => {
    setPendingFile(null);
    if (pendingPreview) {
      URL.revokeObjectURL(pendingPreview);
      setPendingPreview(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

  const deleteSelectedForMe = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = confirm(`Usunąć ${selectedIds.size} wiadomości? (tylko u Ciebie)`);
    if (!confirmed) return;

    const storageKey = `chat_deleted_${currentEmployeeId}`;
    setDeletedIds((prev) => {
      const next = new Set(prev);
      selectedIds.forEach((id) => next.add(id));
      try {
        localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });

    exitSelectMode();
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

  const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍'];
  const [removeReactionMsgId, setRemoveReactionMsgId] = useState<string | null>(null);

  const setReaction = async (messageId: string, emoji: string) => {
    setReactionPickerMsgId(null);
    const msgIndex = messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    const msg = messages[msgIndex];
    const newReaction = { emoji, user_id: currentEmployeeId };

    const updatedMessages = [...messages];
    updatedMessages[msgIndex] = { ...msg, reactions: newReaction };
    setMessages(updatedMessages);

    await supabase
      .from('employee_messages')
      .update({ reactions: newReaction })
      .eq('id', messageId);
  };

  const removeReaction = async (messageId: string) => {
    setRemoveReactionMsgId(null);
    const msgIndex = messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    const msg = messages[msgIndex];
    const updatedMessages = [...messages];
    updatedMessages[msgIndex] = { ...msg, reactions: null };
    setMessages(updatedMessages);

    await supabase
      .from('employee_messages')
      .update({ reactions: null })
      .eq('id', messageId);
  };

  const renderReactions = (msg: ChatMessage, isMine: boolean) => {
    const reaction = msg.reactions as { emoji: string; user_id: string } | null;
    if (!reaction || !reaction.emoji) return null;

    return (
      <div
        className={`absolute bottom-0 z-30 flex translate-y-[15%] ${
          isMine ? '-right-1' : '-left-1'
        }`}
      >
        <div className="relative">
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setRemoveReactionMsgId(msg.id);
            }}
            className={`flex h-6 min-w-6 items-center justify-center rounded-full border border-white/10 bg-[#11131f] px-1.5 text-[12px] shadow-[0_2px_8px_rgba(0,0,0,0.55)] ${
              reaction.user_id === currentEmployeeId ? 'ring-1 ring-[#d3bb73]/70' : ''
            }`}
          >
            <span className="leading-none">{reaction.emoji}</span>
          </button>

          {removeReactionMsgId === msg.id && (
            <div
              onClick={(e) => e.stopPropagation()}
              className={`absolute -top-9 z-50 whitespace-nowrap rounded-lg border border-red-500/20 bg-[#1c1f33] px-3 py-1.5 text-xs text-red-400 shadow-2xl ${
                isMine ? 'right-0' : 'left-0'
              }`}
            >
              <button
                onClick={() => removeReaction(msg.id)}
                className="hover:text-red-300"
              >
                Usuń reakcję
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderAttachment = (msg: ChatMessage, isMine: boolean) => {
    if (!msg.attachment_url) return null;

    const url = msg.attachment_url;
    const filename = (msg.attachment_filename || url || '').toLowerCase();
    const isImage =
      msg.message_type === 'image' ||
      /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?|$)/i.test(filename) ||
      /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?|$)/i.test(url);

    if (isImage) {
      return (
        <button onClick={() => setLightboxUrl(url)} className="block cursor-zoom-in">
          <img
            src={url}
            alt={msg.attachment_filename || 'Obraz'}
            className="max-h-52 max-w-full rounded-lg object-cover"
            loading="lazy"
          />
        </button>
      );
    }

    if (msg.message_type === 'video') {
      return (
        <video
          src={url}
          controls
          className="max-h-52 max-w-full rounded-lg"
          preload="metadata"
        />
      );
    }

    const isPdf =
      /\.pdf(\?|$)/i.test(filename) || /\.pdf(\?|$)/i.test(url);

    return (
      <button
        onClick={() => {
          if (isPdf) {
            setLightboxUrl(url);
          } else {
            const a = document.createElement('a');
            a.href = url;
            a.download = msg.attachment_filename || 'plik';
            a.click();
          }
        }}
        className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
          isMine ? 'bg-[#0f1119]/10 hover:bg-[#0f1119]/20' : 'bg-white/5 hover:bg-white/10'
        }`}
      >
        <FileText className="h-5 w-5 shrink-0 opacity-70" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{msg.attachment_filename || 'Plik'}</p>
          {msg.attachment_size && (
            <p className="text-[10px] opacity-50">{formatFileSize(msg.attachment_size)}</p>
          )}
        </div>
        <Download className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </button>
    );
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
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="rounded-lg p-1 text-[#e5e4e2]/40 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-8 z-50 min-w-[160px] rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] py-1 shadow-xl">
              <button
                onClick={() => {
                  setIsSelectMode(true);
                  setShowMenu(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-[#d3bb73]" />
                Zaznacz wiadomości
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Selection mode header bar */}
      {isSelectMode && (
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#0f1119]/80 px-3 py-2">
          <button
            onClick={exitSelectMode}
            className="rounded-lg px-2 py-1 text-xs text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
          >
            Anuluj
          </button>
          <span className="text-xs text-[#e5e4e2]/50">
            {selectedIds.size > 0
              ? `Zaznaczono: ${selectedIds.size}`
              : 'Zaznacz wiadomości do usunięcia'}
          </span>
          <button
            onClick={deleteSelectedForMe}
            disabled={selectedIds.size === 0}
            className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${
              selectedIds.size > 0
                ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                : 'text-[#e5e4e2]/20'
            }`}
          >
            <Trash2 className="h-3 w-3" />
            Usuń
          </button>
        </div>
      )}

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-3 py-2"
        onClick={() => {
          if (showMenu) setShowMenu(false);
          if (reactionPickerMsgId) setReactionPickerMsgId(null);
          if (removeReactionMsgId) setRemoveReactionMsgId(null);
        }}
      >
        {isLoadingMessages ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d3bb73]/20 border-t-[#d3bb73]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1">
            <p className="text-xs text-[#e5e4e2]/40">Rozpocznij konwersację</p>
          </div>
        ) : (
          messages
            .filter((msg) => !deletedIds.has(msg.id))
            .map((msg, idx, filtered) => {
              const isMine = msg.sender_id === currentEmployeeId;
              const showDate =
                idx === 0 ||
                new Date(msg.created_at).toDateString() !==
                  new Date(filtered[idx - 1].created_at).toDateString();
              const consecutive =
                idx > 0 &&
                msg.sender_id === filtered[idx - 1].sender_id &&
                new Date(msg.created_at).getTime() -
                  new Date(filtered[idx - 1].created_at).getTime() <
                  60000;
              const sender = senders.get(msg.sender_id);
              const hasAttachment = !!msg.attachment_url;
              const hasTextContent = msg.content && msg.message_type === 'text';
              const hasCaption =
                msg.content &&
                msg.message_type !== 'text' &&
                msg.content !== (msg.attachment_filename || '');
              const isSelected = selectedIds.has(msg.id);
              const hasReactions = !!msg.reactions && Object.keys(msg.reactions).length > 0;

              return (
                <div key={msg.id}>
                  {showDate && (
                    <div className="my-3 flex items-center justify-center">
                      <span className="rounded-full bg-[#0f1119]/60 px-3 py-0.5 text-[10px] text-[#e5e4e2]/40">
                        {formatDateSeparator(msg.created_at)}
                      </span>
                    </div>
                  )}
                  <div
                    className={`flex items-center ${isMine ? 'justify-end' : 'justify-start'} ${consecutive ? 'mt-0.5' : 'mt-2'}`}
                    onClick={isSelectMode ? () => toggleSelect(msg.id) : undefined}
                    style={isSelectMode ? { cursor: 'pointer' } : undefined}
                  >
                    {isSelectMode && (
                      <div className="mr-2 shrink-0">
                        {isSelected ? (
                          <CheckCircle2 className="h-5 w-5 text-[#d3bb73]" />
                        ) : (
                          <Circle className="h-5 w-5 text-[#e5e4e2]/20" />
                        )}
                      </div>
                    )}

                    {!isMine && !consecutive && conversation.is_group && !isSelectMode && (
                      <div className="mr-1.5 mt-auto shrink-0">
                        {sender?.avatar_url ? (
                          <img
                            src={sender.avatar_url}
                            alt=""
                            className="h-6 w-6 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#d3bb73]/10 text-[9px] font-semibold text-[#d3bb73]">
                            {(sender?.nickname || sender?.name || '?').charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                    )}
                    {!isMine && consecutive && conversation.is_group && !isSelectMode && (
                      <div className="mr-1.5 w-6 shrink-0" />
                    )}

                    <div
                      className={`group relative max-w-[75%] ${
                        isMine ? '-ml-9 pl-9' : '-mr-9 pr-9'
                      } ${hasReactions ? 'mb-2' : ''} ${isSelected ? 'opacity-70' : ''}`}
                    >
                      {!isMine && !consecutive && conversation.is_group && (
                        <p className="mb-0.5 ml-2 text-[9px] font-medium text-[#d3bb73]/60">
                          {sender?.nickname || sender?.name || 'Unknown'}
                        </p>
                      )}
                      <div className="relative">
                        <div
                          className={`overflow-hidden rounded-2xl px-3 py-1.5 text-[13px] leading-relaxed ${
                            isMine
                              ? 'rounded-br-md bg-gradient-to-br from-[#d3bb73] to-[#c5aa5c] text-[#0f1119]'
                              : 'rounded-bl-md bg-[#262940] text-[#e5e4e2]'
                          } ${hasAttachment ? 'p-2' : ''} ${
                            isSelected ? 'ring-2 ring-[#d3bb73]/50' : ''
                          }`}
                        >
                          {hasAttachment && renderAttachment(msg, isMine)}

                          {hasCaption && <p className="mt-1.5 px-1 text-[13px]">{msg.content}</p>}

                          {hasTextContent && <span>{msg.content}</span>}
                        </div>
                      </div>

                      {/* Hover reaction trigger */}
                      {!isSelectMode && (
                        <div
                          className={`absolute top-0 flex h-full items-start pt-0.5 ${
                            isMine ? 'left-0' : 'right-0'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();

                              setReactionPickerMsgId((current) =>
                                current === msg.id ? null : msg.id,
                              );
                            }}
                            className={`flex h-7 w-7 items-center justify-center rounded-full border border-[#d3bb73]/10 bg-[#1c1f33] text-[13px] shadow-lg transition-all duration-150 hover:scale-110 hover:bg-[#262940] focus:outline-none ${
                              reactionPickerMsgId === msg.id
                                ? 'visible scale-100 opacity-100'
                                : 'invisible scale-90 opacity-0 group-hover:visible group-hover:scale-100 group-hover:opacity-100'
                            } `}
                            aria-label="Dodaj reakcję"
                          >
                            😊
                          </button>
                        </div>
                      )}

                      {/* Reaction picker */}
                      {reactionPickerMsgId === msg.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className={`absolute -top-11 z-50 flex items-center gap-0.5 rounded-full border border-[#d3bb73]/10 bg-[#1c1f33] px-2 py-1.5 shadow-2xl ${
                            isMine ? 'right-9' : 'left-9'
                          } `}
                        >
                          {REACTION_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={(e) => {
                                e.stopPropagation();
                                setReaction(msg.id, emoji);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-full text-[16px] transition-transform hover:scale-125 hover:bg-[#d3bb73]/10"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Reactions display */}
                      {renderReactions(msg, isMine)}

                      <p
                        className={`mt-0.5 text-[9px] text-[#e5e4e2]/30 opacity-0 transition-opacity group-hover:opacity-100 ${isMine ? 'text-right' : 'text-left'}`}
                      >
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

      {/* Pending file preview */}
      {pendingFile && (
        <div className="flex items-center gap-2 border-t border-[#d3bb73]/10 bg-[#0f1119]/50 px-3 py-2">
          {pendingPreview ? (
            <img src={pendingPreview} alt="" className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#d3bb73]/10">
              {pendingFile.type.startsWith('video/') ? (
                <Film className="h-4 w-4 text-[#d3bb73]" />
              ) : (
                <FileText className="h-4 w-4 text-[#d3bb73]" />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-[#e5e4e2]">{pendingFile.name}</p>
            <p className="text-[10px] text-[#e5e4e2]/40">{formatFileSize(pendingFile.size)}</p>
          </div>
          <button
            onClick={removePendingFile}
            className="rounded p-1 text-[#e5e4e2]/40 transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-[#d3bb73]/10 px-3 py-2">
        <div className="flex items-center gap-2 rounded-xl bg-[#0f1119]/60 px-3 py-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,video/mp4,video/quicktime,video/webm,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
            onChange={handleFileSelect}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-[#e5e4e2]/30 transition-colors hover:text-[#d3bb73]"
            title="Dodaj załącznik"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={inputRef}
            type="text"
            placeholder={pendingFile ? 'Dodaj komentarz (opcjonalnie)...' : 'Napisz wiadomość...'}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30 outline-none"
            autoFocus
          />
          <button
            onClick={sendMessage}
            disabled={(!newMessage.trim() && !pendingFile) || isSending}
            className={`rounded-lg p-1.5 transition-all ${
              newMessage.trim() || pendingFile
                ? 'bg-[#d3bb73] text-[#0f1119] hover:bg-[#c5aa5c]'
                : 'text-[#e5e4e2]/20'
            }`}
          >
            {isSending ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#0f1119]/20 border-t-[#0f1119]" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
      {lightboxUrl && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/85 backdrop-blur-sm" onClick={() => setLightboxUrl(null)}>
          <div className="flex items-center justify-end gap-3 p-4">
            <a
              href={lightboxUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded-full bg-black/50 px-3 py-1.5 text-sm text-white/80 transition-colors hover:bg-black/70 hover:text-white"
            >
              Otwórz w nowej karcie
            </a>
            <button
              onClick={() => setLightboxUrl(null)}
              className="rounded-full bg-black/50 p-2 text-white/80 transition-colors hover:bg-black/70 hover:text-white"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden px-4 pb-4" onClick={(e) => e.stopPropagation()}>
            {/\.(pdf)(\?|$)/i.test(lightboxUrl) ? (
              <iframe
                src={lightboxUrl}
                title="Podgląd pliku"
                className="h-full w-full rounded-lg"
              />
            ) : (
              <img
                src={lightboxUrl}
                alt="Podgląd"
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
