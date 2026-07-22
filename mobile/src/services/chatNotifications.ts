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

export function getActiveConversationId(): string | null {
  return _activeConversationId;
}

/**
 * Suppresses push notifications for the active conversation.
 * Must be called BEFORE any other setNotificationHandler.
 */
export function setupChatNotificationFilter() {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data;

      // Suppress notification if user is currently viewing this conversation
      if (
        data?.type === 'chat_message' &&
        data?.conversation_id === _activeConversationId
      ) {
        return {
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      }

      return {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      };
    },
  });
}

/**
 * Hook that listens to realtime for badge increment + refetches badge on conversation leave.
 * Push notifications are handled by the send-chat-push Edge Function (remote push).
 */
export function useChatNotifications(employeeId: string | undefined) {
  // Remote push is handled by the Edge Function trigger.
  // This hook just ensures the notification handler is set up to suppress active conv.
  useEffect(() => {
    setupChatNotificationFilter();
  }, []);
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

  // Realtime: increment on new message
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
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [employeeId, fetchUnreadCount]);

  // Refetch when a push notification for chat arrives (remote push received)
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      if (data?.type === 'chat_message') {
        // If it's for the active conversation, don't increment (already suppressed)
        if (data.conversation_id !== _activeConversationId) {
          setUnreadCount((prev) => prev + 1);
        }
      }
    });
    return () => sub.remove();
  }, []);

  // Polling fallback every 30s
  useEffect(() => {
    if (!employeeId) return;
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [employeeId, fetchUnreadCount]);

  return { unreadCount, refetch: fetchUnreadCount };
}
