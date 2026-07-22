import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
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

export function setupChatNotificationFilter() {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data;

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

export function useChatNotifications(employeeId: string | undefined) {
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
      // Single query: get participations with last_read_at
      const { data: participations } = await supabase
        .from('employee_conversation_participants')
        .select('conversation_id, last_read_at')
        .eq('employee_id', employeeId);

      if (!participations || participations.length === 0) {
        setUnreadCount(0);
        return;
      }

      // Build a single query with OR conditions for all conversations
      const conversationIds = participations.map((p) => p.conversation_id);

      // Get all unread messages in one query
      const { count } = await supabase
        .from('employee_messages')
        .select('*', { count: 'exact', head: true })
        .in('conversation_id', conversationIds)
        .neq('sender_id', employeeId)
        .gt('created_at', getOldestReadAt(participations));

      // For precise count we need per-conversation filtering
      // but for instant badge we use the fast approximation above
      // then do precise count in background
      if (count !== null) {
        // Precise count: only messages newer than per-conversation last_read_at
        let precise = 0;
        const readMap = new Map(participations.map((p) => [p.conversation_id, p.last_read_at]));

        // Use a single query with all conversations, filter client-side
        const { data: unreadMessages } = await supabase
          .from('employee_messages')
          .select('conversation_id, created_at')
          .in('conversation_id', conversationIds)
          .neq('sender_id', employeeId)
          .gt('created_at', getOldestReadAt(participations))
          .order('created_at', { ascending: false })
          .limit(500);

        if (unreadMessages) {
          for (const msg of unreadMessages) {
            const lastRead = readMap.get(msg.conversation_id);
            if (!lastRead || msg.created_at > lastRead) {
              precise++;
            }
          }
        }
        setUnreadCount(precise);
      } else {
        setUnreadCount(0);
      }
    } catch (err) {
      console.error('Error fetching unread chat count:', err);
    }
  }, [employeeId]);

  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  useEffect(() => {
    _onConversationLeave = fetchUnreadCount;
    return () => {
      _onConversationLeave = null;
    };
  }, [fetchUnreadCount]);

  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        fetchUnreadCount();
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [fetchUnreadCount]);

  // Realtime: instant increment on new message
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
  }, [employeeId]);

  // Increment on remote push received
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      if (data?.type === 'chat_message' && data.conversation_id !== _activeConversationId) {
        setUnreadCount((prev) => prev + 1);
      }
    });
    return () => sub.remove();
  }, []);

  // Polling fallback every 60s (not 30s - less aggressive)
  useEffect(() => {
    if (!employeeId) return;
    const interval = setInterval(fetchUnreadCount, 60000);
    return () => clearInterval(interval);
  }, [employeeId, fetchUnreadCount]);

  return { unreadCount, refetch: fetchUnreadCount };
}

function getOldestReadAt(participations: { last_read_at: string | null }[]): string {
  let oldest = new Date().toISOString();
  for (const p of participations) {
    if (!p.last_read_at) {
      return '1970-01-01T00:00:00Z';
    }
    if (p.last_read_at < oldest) {
      oldest = p.last_read_at;
    }
  }
  return oldest;
}
