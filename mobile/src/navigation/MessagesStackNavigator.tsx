import PermissionGate from '../components/PermissionGate';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRoute } from '@react-navigation/native';

import ChatListScreen, { Conversation } from '../screens/ChatListScreen';
import ChatScreen from '../screens/ChatScreen';
import SellerChatScreen from '../screens/SellerChatScreen';
import { Alert } from 'react-native';
import NewChatModal from '../screens/NewChatModal';
import { setActiveChatConversation } from '../services/chatNotifications';
import { supabase } from '../lib/supabase';

function MessagesStackContent() {
  const route = useRoute<any>();
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [sellerConversationId, setSellerConversationId] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const lastNavigationRequest = useRef<string | null>(null);

  useEffect(() => {
    setActiveChatConversation(sellerConversationId ? null : activeConversation?.id ?? null);
    return () => setActiveChatConversation(null);
  }, [activeConversation?.id, sellerConversationId]);

  const navigateToConversation = useCallback(async (conversationId: string) => {
    const version = ++requestVersion.current;
    setSellerConversationId(null);
    setActiveConversation(null);
    const [{ data }, { data: participantRows }] = await Promise.all([
      supabase
        .from('employee_conversations')
        .select(
          'id, title, is_group, created_by, last_message_at, last_message_preview, created_at',
        )
        .eq('id', conversationId)
        .maybeSingle(),
      supabase
        .from('employee_conversation_participants')
        .select('id, conversation_id, employee_id, last_read_at')
        .eq('conversation_id', conversationId),
    ]);

    if (version !== requestVersion.current) return;
    if (data) {
      const employeeIds = (participantRows || []).map((participant) => participant.employee_id);
      const { data: employees } = employeeIds.length
        ? await supabase
            .from('employees')
            .select('id, name, surname, nickname, avatar_url, avatar_metadata')
            .in('id', employeeIds)
        : { data: [] };
      const employeesById = new Map((employees || []).map((item) => [item.id, item]));

      if (version !== requestVersion.current) return;
      setActiveConversation({
        id: data.id,
        title: data.title,
        is_group: data.is_group ?? false,
        created_by: data.created_by ?? '',
        last_message_at: data.last_message_at ?? data.created_at,
        last_message_preview: data.last_message_preview ?? null,
        created_at: data.created_at,
        participants: (participantRows || []).map((participant) => ({
          ...participant,
          employee: employeesById.get(participant.employee_id),
        })),
        unread_count: 0,
      });
    } else {
      Alert.alert('Rozmowa niedostępna', 'Nie udało się otworzyć rozmowy. Sprawdź połączenie i uprawnienia.');
    }
  }, []);

  // Notification routing is owned by MainTabNavigator, including cold starts.
  useEffect(() => {
    const convId = route.params?.conversationId;
    const kind = route.params?.conversationKind || 'employee';
    const requestId = route.params?.chatRequestId ?? 'initial';
    const requestKey = convId ? `${kind}:${convId}:${requestId}` : null;
    if (convId && requestKey !== lastNavigationRequest.current) {
      lastNavigationRequest.current = requestKey;
      setShowNewChat(false);
      if (kind === 'seller') {
        requestVersion.current++;
        setActiveConversation(null);
        setSellerConversationId(convId);
      } else {
        void navigateToConversation(convId);
      }
    }
  }, [route.params?.chatRequestId, route.params?.conversationId, route.params?.conversationKind, navigateToConversation]);

  if (sellerConversationId) {
    return <SellerChatScreen key={sellerConversationId} conversationId={sellerConversationId} onBack={() => setSellerConversationId(null)} />;
  }

  if (activeConversation) {
    return (
      <ChatScreen key={activeConversation.id} conversation={activeConversation} onBack={() => setActiveConversation(null)} />
    );
  }

  return (
    <>
      <ChatListScreen
        onConversationPress={(conv) => {
          requestVersion.current++;
          if (conv.sellerConversation) { setActiveConversation(null); setSellerConversationId(conv.id); }
          else { setSellerConversationId(null); setActiveConversation(conv); }
        }}
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
    </>
  );
}

export default function MessagesStackNavigator() {
  return <PermissionGate module="chat"><MessagesStackContent /></PermissionGate>;
}
