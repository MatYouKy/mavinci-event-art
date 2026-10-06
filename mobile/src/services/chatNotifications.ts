import { fetchUnreadChatCounts } from './unreadChat';
import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { useForegroundEffect } from '../hooks/useForegroundEffect';
import { createRefreshQueue } from '../lib/refreshQueue';
import { subscribeToIncomingChatMessages } from './realtimeNotifications';

let _activeConversationId: string | null = null;
let _onConversationLeave: (() => void) | null = null;
let _onConversationRead:
  | ((unreadCount: number, persisted: boolean) => void)
  | null = null;
const _recentlyNotifiedMessageIds = new Set<string>();

export function notifyChatConversationOpened(unreadCount: number) {
  _onConversationRead?.(Math.max(0, unreadCount), false);
}

export function notifyChatReadPersisted() {
  _onConversationRead?.(0, true);
}

export function setActiveChatConversation(conversationId: string | null) {
  const wasActive = _activeConversationId;
  _activeConversationId = conversationId;

  if (conversationId) {
    dismissChatNotificationsForConversation(conversationId);
  }

  if (wasActive && !conversationId && _onConversationLeave) {
    _onConversationLeave();
  }
}

async function dismissChatNotificationsForConversation(conversationId: string) {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => {
          const data = n.request.content.data;
          return data?.type === 'chat_message' && data?.conversation_id === conversationId;
        })
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {}
}

export function getActiveConversationId(): string | null {
  return _activeConversationId;
}

export function setupChatNotificationFilter() {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data;

      // Suppress if viewing the same conversation
      if (
        AppState.currentState === 'active' &&
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

      // Deduplicate: if we already showed a notification for this message, suppress
      if (data?.type === 'chat_message' && data?.message_id) {
        const msgId = data.message_id as string;
        if (_recentlyNotifiedMessageIds.has(msgId)) {
          return {
            shouldShowBanner: false,
            shouldShowList: false,
            shouldPlaySound: false,
            shouldSetBadge: false,
          };
        }
        _recentlyNotifiedMessageIds.add(msgId);
        // Clean up after 10s
        setTimeout(() => _recentlyNotifiedMessageIds.delete(msgId), 10000);
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
    _activeConversationId = null;
    _recentlyNotifiedMessageIds.clear();
    setupChatNotificationFilter();
    return () => { _activeConversationId = null; };
  }, [employeeId]);
}

export function useUnreadChatCount(employeeId: string | undefined) {
  const [unreadCount, setUnreadCount] = useState(0);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const refetch = useCallback(async () => { await refreshRef.current?.(); }, []);

  useEffect(() => { setUnreadCount(0); }, [employeeId]);
  useEffect(() => {
    void Notifications.setBadgeCountAsync(unreadCount).catch(() => {});
  }, [unreadCount]);

  useForegroundEffect((signal) => {
    if (!employeeId) return;
    const queue = createRefreshQueue(signal, async (requestSignal) => {
      const counts = await fetchUnreadChatCounts(supabase, employeeId, requestSignal);
      if (signal.aborted || requestSignal.aborted) return;
      setUnreadCount([...counts.values()].reduce((sum, count) => sum + count, 0));
    });
    refreshRef.current = queue.refresh;
    void queue.refresh();

    const onRead = (readCount: number, persisted: boolean) => {
      if (signal.aborted) return;
      if (readCount > 0) setUnreadCount((previous) => Math.max(0, previous - readCount));
      if (persisted) queue.schedule();
    };
    _onConversationLeave = queue.refresh;
    _onConversationRead = onRead;

    const removeMessageListener = subscribeToIncomingChatMessages((recipientId) => {
      if (recipientId === employeeId && !signal.aborted) queue.schedule();
    });
    const pushSubscription = Notifications.addNotificationReceivedListener((notification) => {
      if (notification.request.content.data?.type === 'chat_message') queue.schedule();
    });
    const channel = supabase.channel(`chat_unread_badge_${employeeId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'employee_conversation_participants',
        filter: `employee_id=eq.${employeeId}`,
      }, queue.schedule)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') queue.schedule();
      });
    const polling = setInterval(queue.schedule, 60_000);

    return () => {
      clearInterval(polling);
      removeMessageListener();
      pushSubscription.remove();
      if (refreshRef.current === queue.refresh) refreshRef.current = null;
      if (_onConversationLeave === queue.refresh) _onConversationLeave = null;
      if (_onConversationRead === onRead) _onConversationRead = null;
      return supabase.removeChannel(channel);
    };
  }, [employeeId]);

  return { unreadCount, refetch };
}
