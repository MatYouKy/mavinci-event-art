import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import EmployeeAvatar from '../components/EmployeeAvatar';
import { Conversation } from './ChatListScreen';

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: string;
  attachment_url: string | null;
  is_edited: boolean;
  created_at: string;
}

interface SenderInfo {
  id: string;
  name: string;
  surname: string;
  nickname?: string | null;
  avatar_url?: string | null;
  avatar_metadata?: any;
}

interface Props {
  conversation: Conversation;
  onBack: () => void;
}

export default function ChatScreen({ conversation, onBack }: Props) {
  const { employee } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [senders, setSenders] = useState<Map<string, SenderInfo>>(new Map());
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const otherParticipant = conversation.participants.find(
    (p) => p.employee_id !== employee?.id
  );

  const conversationTitle =
    conversation.title ||
    (otherParticipant?.employee
      ? otherParticipant.employee.nickname ||
        `${otherParticipant.employee.name} ${otherParticipant.employee.surname}`
      : 'Czat');

  const fetchMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from('employee_messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })
      .limit(100);

    if (!error && data) {
      setMessages(data);

      const senderIds = [...new Set(data.map((m) => m.sender_id))];
      const { data: sendersData } = await supabase
        .from('employees')
        .select('id, name, surname, nickname, avatar_url, avatar_metadata')
        .in('id', senderIds);

      if (sendersData) {
        const map = new Map<string, SenderInfo>();
        sendersData.forEach((s) => map.set(s.id, s));
        setSenders(map);
      }
    }
  }, [conversation.id]);

  const markAsRead = useCallback(async () => {
    if (!employee) return;
    await supabase
      .from('employee_conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversation.id)
      .eq('employee_id', employee.id);
  }, [employee, conversation.id]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await fetchMessages();
      await markAsRead();
      setIsLoading(false);
    };
    load();
  }, [fetchMessages, markAsRead]);

  // Realtime messages
  useEffect(() => {
    const channel = supabase
      .channel(`chat-${conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'employee_messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        async (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => [...prev, newMsg]);

          if (!senders.has(newMsg.sender_id)) {
            const { data } = await supabase
              .from('employees')
              .select('id, name, surname, nickname, avatar_url, avatar_metadata')
              .eq('id', newMsg.sender_id)
              .maybeSingle();
            if (data) {
              setSenders((prev) => new Map(prev).set(data.id, data));
            }
          }

          markAsRead();
          setTimeout(() => {
            flatListRef.current?.scrollToEnd({ animated: true });
          }, 100);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'employee_messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const updated = payload.new as Message;
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? updated : m))
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'employee_messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const deleted = payload.old as { id: string };
          setMessages((prev) => prev.filter((m) => m.id !== deleted.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation.id, markAsRead, senders]);

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || !employee || isSending) return;

    setIsSending(true);
    setInputText('');
    Keyboard.dismiss();

    const { error } = await supabase.from('employee_messages').insert({
      conversation_id: conversation.id,
      sender_id: employee.id,
      content: text,
      message_type: 'text',
    });

    if (error) {
      setInputText(text);
      console.error('Failed to send:', error.message);
    }

    setIsSending(false);
  };

  const formatMessageTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateSeparator = (dateStr: string): string => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Dzisiaj';
    if (date.toDateString() === yesterday.toDateString()) return 'Wczoraj';
    return date.toLocaleDateString('pl-PL', {
      day: 'numeric',
      month: 'long',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
  };

  const shouldShowDateSeparator = (index: number): boolean => {
    if (index === 0) return true;
    const curr = new Date(messages[index].created_at).toDateString();
    const prev = new Date(messages[index - 1].created_at).toDateString();
    return curr !== prev;
  };

  const shouldShowAvatar = (index: number): boolean => {
    if (index === messages.length - 1) return true;
    return messages[index].sender_id !== messages[index + 1].sender_id;
  };

  const isConsecutive = (index: number): boolean => {
    if (index === 0) return false;
    const prev = messages[index - 1];
    const curr = messages[index];
    if (prev.sender_id !== curr.sender_id) return false;
    const timeDiff =
      new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
    return timeDiff < 60000; // 1 minute
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const isMine = item.sender_id === employee?.id;
    const sender = senders.get(item.sender_id);
    const showAvatar = !isMine && shouldShowAvatar(index);
    const showDateSep = shouldShowDateSeparator(index);
    const consecutive = isConsecutive(index);

    return (
      <View>
        {showDateSep && (
          <View style={styles.dateSeparator}>
            <View style={styles.dateLine} />
            <Text style={styles.dateText}>{formatDateSeparator(item.created_at)}</Text>
            <View style={styles.dateLine} />
          </View>
        )}

        <View
          style={[
            styles.messageRow,
            isMine && styles.messageRowMine,
            consecutive && styles.messageConsecutive,
          ]}
        >
          {!isMine && (
            <View style={styles.avatarSlot}>
              {showAvatar && sender ? (
                <EmployeeAvatar
                  avatarUrl={sender.avatar_url}
                  avatarMetadata={sender.avatar_metadata}
                  employeeName={sender.nickname || sender.name}
                  size={28}
                />
              ) : (
                <View style={{ width: 28 }} />
              )}
            </View>
          )}

          <View style={styles.bubbleWrapper}>
            {/* Show sender name in group chats */}
            {conversation.is_group && !isMine && !consecutive && sender && (
              <Text style={styles.senderName}>
                {sender.nickname || sender.name}
              </Text>
            )}
            <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
              <Text style={[styles.messageText, isMine && styles.messageTextMine]}>
                {item.content}
              </Text>
            </View>
            {showAvatar && (
              <Text style={[styles.messageTime, isMine && styles.messageTimeMine]}>
                {formatMessageTime(item.created_at)}
                {item.is_edited && ' (edytowane)'}
              </Text>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Feather name="chevron-left" size={26} color={colors.text.primary} />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          {!conversation.is_group && otherParticipant?.employee ? (
            <EmployeeAvatar
              avatarUrl={otherParticipant.employee.avatar_url}
              avatarMetadata={otherParticipant.employee.avatar_metadata}
              employeeName={otherParticipant.employee.nickname || otherParticipant.employee.name}
              size={36}
            />
          ) : (
            <View style={styles.headerGroupIcon}>
              <Feather name="users" size={16} color={colors.primary.gold} />
            </View>
          )}
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {conversationTitle}
            </Text>
            {!conversation.is_group && (
              <Text style={styles.headerSubtitle}>
                {isTyping ? 'pisze...' : 'aktywny(a)'}
              </Text>
            )}
          </View>
        </View>

        <TouchableOpacity style={styles.headerAction}>
          <Feather name="more-vertical" size={20} color={colors.text.secondary} />
        </TouchableOpacity>
      </View>

      {/* Messages */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary.gold} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => {
            flatListRef.current?.scrollToEnd({ animated: false });
          }}
          ListEmptyComponent={
            <View style={styles.emptyMessages}>
              <Feather name="message-circle" size={40} color={colors.text.tertiary} />
              <Text style={styles.emptyMessagesText}>
                Rozpocznij rozmowę!
              </Text>
            </View>
          }
        />
      )}

      {/* Input */}
      <View style={styles.inputContainer}>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.textInput}
            placeholder="Aa"
            placeholderTextColor={colors.text.tertiary}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={2000}
          />
          {inputText.trim().length > 0 ? (
            <TouchableOpacity
              style={styles.sendButton}
              onPress={sendMessage}
              disabled={isSending}
            >
              {isSending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather name="send" size={18} color="#fff" />
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.attachButton}>
              <Feather name="plus-circle" size={24} color={colors.primary.gold} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
    backgroundColor: colors.background.secondary,
  },
  backButton: {
    padding: spacing.xs,
  },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.xs,
    gap: spacing.sm,
  },
  headerGroupIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary.gold + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.bold as any,
    color: colors.text.primary,
  },
  headerSubtitle: {
    fontSize: typography.fontSizes.xs,
    color: colors.status.success,
  },
  headerAction: {
    padding: spacing.sm,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messagesList: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  dateLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border.default,
  },
  dateText: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
    paddingHorizontal: spacing.sm,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 2,
    paddingRight: 60,
  },
  messageRowMine: {
    flexDirection: 'row-reverse',
    paddingRight: 0,
    paddingLeft: 60,
  },
  messageConsecutive: {
    marginBottom: 1,
  },
  avatarSlot: {
    width: 32,
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  bubbleWrapper: {
    maxWidth: '80%',
  },
  senderName: {
    fontSize: 11,
    color: colors.text.tertiary,
    marginBottom: 2,
    marginLeft: 12,
    fontWeight: typography.fontWeights.medium as any,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  bubbleMine: {
    backgroundColor: colors.primary.gold,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: colors.background.tertiary,
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: typography.fontSizes.md,
    color: colors.text.primary,
    lineHeight: 20,
  },
  messageTextMine: {
    color: '#fff',
  },
  messageTime: {
    fontSize: 10,
    color: colors.text.tertiary,
    marginTop: 3,
    marginLeft: 12,
  },
  messageTimeMine: {
    textAlign: 'right',
    marginLeft: 0,
    marginRight: 12,
  },
  emptyMessages: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 40,
  },
  emptyMessagesText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.tertiary,
    marginTop: spacing.sm,
  },
  inputContainer: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.default,
    backgroundColor: colors.background.secondary,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.background.tertiary,
    borderRadius: 22,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 4,
    minHeight: 42,
  },
  textInput: {
    flex: 1,
    fontSize: typography.fontSizes.md,
    color: colors.text.primary,
    maxHeight: 100,
    paddingVertical: 8,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary.gold,
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachButton: {
    padding: 5,
  },
});
