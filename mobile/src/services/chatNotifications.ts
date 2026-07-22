import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';

interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: string;
  created_at: string;
}

let _activeConversationId: string | null = null;
let _onConversationLeave: (() => void) | null = null;

export function setActiveChatConversation(conversationId: string | null) {
  const wasActive = _activeConversationId;
  _activeConversationId = conversationId;

  if (wasActive && !conversationId && _onConversationLeave) {
    _onConversationLeave();
  }
}

export function useChatNotifications(employeeId: string | undefined) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!employeeId) return;

    const channel = supabase
      .channel(`chat_push_${employeeId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'employee_messages',
        },
        async (payload) => {
          const msg = payload.new as ChatMessage;

          if (msg.sender_id === employeeId) return;
          if (msg.conversation_id === _activeConversationId) return;

          const isParticipant = await checkParticipation(employeeId, msg.conversation_id);
          if (!isParticipant) return;

          const senderName = await getSenderName(msg.sender_id);

          const notificationBody =
          msg.message_type === 'image'
            ? 'Przesłano zdjęcie'
            : msg.message_type === 'file'
              ? 'Przesłano plik'
              : msg.content?.trim() || 'Nowa wiadomość';
        
        await Notifications.scheduleNotificationAsync({
          content: {
            title: senderName,
            body:
              notificationBody.length > 100
                ? `${notificationBody.slice(0, 100)}...`
                : notificationBody,
            sound: 'default',
            data: {
              type: 'chat_message',
              conversation_id: msg.conversation_id,
              message_id: msg.id,
            },
            ...(Platform.OS === 'android' && {
              channelId: 'default',
            }),
          },
          trigger: null,
        });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [employeeId]);
}

export function useUnreadChatCount(employeeId: string | undefined) {
  const [unreadCount, setUnreadCount] = useState(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchUnreadCount = useCallback(async () => {
    if (!employeeId) {
      setUnreadCount(0);
      return;
    }

    try {
      const { data: participations } = await supabase
        .from('employee_conversation_participants')
        .select('conversation_id, last_read_at')
        .eq('employee_id', employeeId);

      if (!participations || participations.length === 0) {
        setUnreadCount(0);
        return;
      }

      let total = 0;
      for (const p of participations) {
        const query = supabase
          .from('employee_messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', p.conversation_id)
          .neq('sender_id', employeeId);

        if (p.last_read_at) {
          query.gt('created_at', p.last_read_at);
        }

        const { count } = await query;
        total += count || 0;
      }

      setUnreadCount(total);
    } catch (err) {
      console.error('Error fetching unread chat count:', err);
    }
  }, [employeeId]);

  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  // Refetch when leaving a conversation (user marked it as read)
  useEffect(() => {
    _onConversationLeave = fetchUnreadCount;
    return () => {
      _onConversationLeave = null;
    };
  }, [fetchUnreadCount]);

  // Refetch when app comes to foreground
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        fetchUnreadCount();
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [fetchUnreadCount]);

  // Realtime: increment on new message, refetch on participant update
  useEffect(() => {
    if (!employeeId) return;

    const channel = supabase
      .channel(`chat_unread_badge_${employeeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'employee_messages' },
        (payload) => {
          const msg = payload.new as ChatMessage;
          if (msg.sender_id !== employeeId && msg.conversation_id !== _activeConversationId) {
            setUnreadCount((prev) => prev + 1);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'employee_conversation_participants' },
        (payload) => {
          const updated = payload.new as { employee_id: string; last_read_at: string };
          if (updated.employee_id === employeeId) {
            fetchUnreadCount();
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [employeeId, fetchUnreadCount]);

  // Polling fallback every 30s in case realtime isn't enabled
  useEffect(() => {
    if (!employeeId) return;
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [employeeId, fetchUnreadCount]);

  return { unreadCount, refetch: fetchUnreadCount };
}

async function checkParticipation(employeeId: string, conversationId: string): Promise<boolean> {
  const { data } = await supabase
    .from('employee_conversation_participants')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('conversation_id', conversationId)
    .maybeSingle();

  return !!data;
}

async function getSenderName(senderId: string): Promise<string> {
  const { data } = await supabase
    .from('employees')
    .select('name, surname, nickname')
    .eq('id', senderId)
    .maybeSingle();

  if (!data) return 'Nowa wiadomość';

  return (
    data.nickname ||
    [data.name, data.surname].filter(Boolean).join(' ') ||
    'Nowa wiadomość'
  );
}