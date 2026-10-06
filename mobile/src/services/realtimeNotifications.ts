import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { useForegroundEffect } from '../hooks/useForegroundEffect';

type EmployeeMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: string;
  created_at: string;
};

// One incoming-message subscription serves local chat alerts and the unread badge.
type MessageListener = (employeeId: string, message: EmployeeMessageRow) => void;
const messageListeners = new Set<MessageListener>();
export function subscribeToIncomingChatMessages(listener: MessageListener) {
  messageListeners.add(listener);
  return () => { messageListeners.delete(listener); };
}

export function useRealtimePushNotifications(employeeId: string | undefined) {
  useForegroundEffect((signal) => {
    if (!employeeId) return;
    let conversationIds = new Set<string>();
    let conversationRequest: Promise<Set<string>> | null = null;
    const seen = new Set<string>();

    const fetchConversationIds = (): Promise<Set<string>> => {
      if (signal.aborted) return Promise.resolve(new Set<string>());
      if (conversationRequest) return conversationRequest;
      conversationRequest = (async () => {
        const { data, error } = await supabase.from('employee_conversation_participants')
          .select('conversation_id').eq('employee_id', employeeId).abortSignal(signal);
        if (signal.aborted) return new Set<string>();
        if (error) throw error;
        conversationIds = new Set((data || []).map((row) => row.conversation_id));
        return conversationIds;
      })().finally(() => { conversationRequest = null; });
      return conversationRequest;
    };

    const handleMessage = async (message: EmployeeMessageRow) => {
      if (signal.aborted || message.sender_id === employeeId || seen.has(message.id)) return;
      seen.add(message.id);
      if (seen.size > 1000) {
        const oldest = seen.values().next().value;
        if (oldest) seen.delete(oldest);
      }

      // Check membership even when RLS grants broader visibility to an administrator.
      if (!conversationIds.has(message.conversation_id)) {
        // Concurrent messages share one membership query, including newly joined chats.
        const updated = await fetchConversationIds();
        if (signal.aborted || !updated.has(message.conversation_id)) return;
      }
      for (const listener of messageListeners) listener(employeeId, message);
      if (signal.aborted) return;

      const [senderResult, conversationResult] = await Promise.all([
        supabase.from('employees').select('id, name, surname, nickname')
          .eq('id', message.sender_id).maybeSingle().abortSignal(signal),
        supabase.from('employee_conversations').select('title, is_group')
          .eq('id', message.conversation_id).maybeSingle().abortSignal(signal),
      ]);
      if (signal.aborted) return;
      const sender = senderResult.data;
      const conversation = conversationResult.data;
      const senderName = sender?.nickname
        || [sender?.name, sender?.surname].filter(Boolean).join(' ') || 'Nowa wiadomość';
      const title = conversation?.is_group && conversation.title ? conversation.title : senderName;
      const body = message.message_type === 'text' ? message.content?.trim() || 'Nowa wiadomość'
        : message.message_type === 'image' ? 'Przesłano zdjęcie'
          : message.message_type === 'file' ? 'Przesłano plik' : 'Nowa wiadomość';

      await Notifications.scheduleNotificationAsync({
        content: {
          title, body, sound: 'default',
          data: {
            type: 'chat_message',
            conversation_id: message.conversation_id,
            message_id: message.id,
            sender_id: message.sender_id,
          },
        },
        trigger: null,
      });
    };

    const refreshMembership = () => {
      void fetchConversationIds().catch((error) => {
        if (!signal.aborted) console.error('[Notifications] Membership refresh failed:', error);
      });
    };
    refreshMembership();

    const channel = supabase.channel(`realtime_notifications_${employeeId}`)
      // CRM alerts already arrive via remote push; do not subscribe just to ignore them.
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'employee_conversation_participants',
        filter: `employee_id=eq.${employeeId}`,
      }, refreshMembership)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'employee_messages',
      }, (payload) => {
        void handleMessage(payload.new as EmployeeMessageRow).catch((error) => {
          if (!signal.aborted) console.error('[Notifications] Message handling failed:', error);
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && !signal.aborted) refreshMembership();
      });

    return () => supabase.removeChannel(channel);
  }, [employeeId]);
}
