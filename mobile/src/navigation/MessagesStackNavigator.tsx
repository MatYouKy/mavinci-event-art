import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import ChatListScreen, { Conversation } from '../screens/ChatListScreen';
import ChatScreen from '../screens/ChatScreen';
import NewChatModal from '../screens/NewChatModal';
import { setActiveChatConversation } from '../services/chatNotifications';
import { consumeNotificationTarget } from '../../App';
import { supabase } from '../lib/supabase';
import * as Notifications from 'expo-notifications';

export default function MessagesStackNavigator() {
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const hasCheckedTarget = useRef(false);

  useEffect(() => {
    setActiveChatConversation(activeConversation?.id ?? null);
    return () => setActiveChatConversation(null);
  }, [activeConversation?.id]);

  const navigateToConversation = useCallback(async (conversationId: string) => {
    const { data } = await supabase
      .from('employee_conversations')
      .select('id, title, is_group, created_by, last_message_at, last_message_preview, created_at')
      .eq('id', conversationId)
      .maybeSingle();

    if (data) {
      setActiveConversation({
        id: data.id,
        title: data.title || 'Rozmowa',
        is_group: data.is_group ?? false,
        created_by: data.created_by ?? '',
        last_message_at: data.last_message_at ?? data.created_at,
        last_message_preview: data.last_message_preview ?? null,
        created_at: data.created_at,
        participants: [],
        unread_count: 0,
      });
    }
  }, []);

  // Check for pending notification target on mount
  useEffect(() => {
    if (hasCheckedTarget.current) return;
    hasCheckedTarget.current = true;

    const target = consumeNotificationTarget();
    if (target?.type === 'chat_message' && target.conversation_id) {
      navigateToConversation(target.conversation_id);
    }
  }, [navigateToConversation]);

  // Listen for notification taps while this screen is active
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.type === 'chat_message' && data?.conversation_id) {
        navigateToConversation(data.conversation_id as string);
      }
    });
    return () => sub.remove();
  }, [navigateToConversation]);

  if (activeConversation) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ChatScreen
          conversation={activeConversation}
          onBack={() => setActiveConversation(null)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ChatListScreen
        onConversationPress={(conv) => setActiveConversation(conv)}
        onNewChat={() => setShowNewChat(true)}
      />
      <NewChatModal
        visible={showNewChat}
        onClose={() => setShowNewChat(false)}
        onConversationCreated={(conv) => {
          setShowNewChat(false);
          setActiveConversation(conv);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.secondary,
  },
});
