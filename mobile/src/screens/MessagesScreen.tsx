import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import PermissionGate from '../components/PermissionGate';

interface Message {
  id: string;
  subject: string | null;
  from_address: string | null;
  from_name: string | null;
  received_at: string;
  is_read: boolean;
  snippet: string | null;
}

function MessagesContent() {
  const { employee } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMessages = useCallback(async (isRefresh = false) => {
    if (!employee?.id) return;

    if (isRefresh) setRefreshing(true);
    else setIsLoading(true);

    try {
      const { data, error } = await supabase
        .from('received_emails')
        .select('id, subject, from_address, from_name, received_at, is_read, snippet')
        .order('received_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setMessages(data || []);
    } catch (err) {
      console.error('Error fetching messages:', err);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [employee?.id]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' });
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <TouchableOpacity style={[styles.messageRow, !item.is_read && styles.messageUnread]} activeOpacity={0.7}>
      <View style={styles.messageAvatar}>
        <Feather name="mail" size={16} color={item.is_read ? colors.text.tertiary : colors.primary.gold} />
      </View>
      <View style={styles.messageContent}>
        <View style={styles.messageHeader}>
          <Text style={[styles.messageSender, !item.is_read && styles.messageTextBold]} numberOfLines={1}>
            {item.from_name || item.from_address || 'Nieznany'}
          </Text>
          <Text style={styles.messageDate}>{formatDate(item.received_at)}</Text>
        </View>
        <Text style={[styles.messageSubject, !item.is_read && styles.messageTextBold]} numberOfLines={1}>
          {item.subject || '(brak tematu)'}
        </Text>
        {item.snippet && (
          <Text style={styles.messageSnippet} numberOfLines={1}>
            {item.snippet}
          </Text>
        )}
      </View>
      {!item.is_read && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchMessages(true)}
            tintColor={colors.primary.gold}
          />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="inbox" size={48} color={colors.text.tertiary} />
            <Text style={styles.emptyText}>Brak wiadomości</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.primary,
  },
  listContent: {
    paddingBottom: 20,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    gap: 12,
  },
  messageUnread: {
    backgroundColor: colors.primary.gold + '08',
  },
  messageAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageContent: {
    flex: 1,
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  messageSender: {
    fontSize: 13,
    color: colors.text.primary,
    flex: 1,
    marginRight: 8,
  },
  messageDate: {
    fontSize: 11,
    color: colors.text.tertiary,
  },
  messageSubject: {
    fontSize: 13,
    color: colors.text.primary,
  },
  messageSnippet: {
    fontSize: 12,
    color: colors.text.tertiary,
    marginTop: 2,
  },
  messageTextBold: {
    fontWeight: '700',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary.gold,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    color: colors.text.tertiary,
  },
});

export default function MessagesScreen() {
  return (
    <PermissionGate module="messages">
      <MessagesContent />
    </PermissionGate>
  );
}
