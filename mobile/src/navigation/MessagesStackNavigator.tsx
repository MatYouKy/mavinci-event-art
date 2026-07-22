import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import ChatListScreen, { Conversation } from '../screens/ChatListScreen';
import ChatScreen from '../screens/ChatScreen';
import NewChatModal from '../screens/NewChatModal';

export default function MessagesStackNavigator() {
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);

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
