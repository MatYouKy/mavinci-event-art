import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '../theme';
import ChatListScreen, { Conversation } from '../screens/ChatListScreen';
import ChatScreen from '../screens/ChatScreen';
import NewChatModal from '../screens/NewChatModal';

export default function MessagesStackNavigator() {
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);

  if (activeConversation) {
    return (
      <View style={styles.container}>
        <ChatScreen
          conversation={activeConversation}
          onBack={() => setActiveConversation(null)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
});
