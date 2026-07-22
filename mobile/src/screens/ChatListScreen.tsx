import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '../theme';
import { supabase, Employee } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import PermissionGate from '../components/PermissionGate';
import EmployeeAvatar from '../components/EmployeeAvatar';

export interface Conversation {
  id: string;
  title: string | null;
  is_group: boolean;
  created_by: string;
  last_message_at: string;
  last_message_preview: string | null;
  created_at: string;
  participants: ConversationParticipant[];
  unread_count: number;
}

interface ConversationParticipant {
  id: string;
  employee_id: string;
  last_read_at: string;
  employee?: {
    id: string;
    name: string;
    surname: string;
    nickname?: string | null;
    avatar_url?: string | null;
    avatar_metadata?: any;
  };
}

interface OnlineStatus {
  employee_id: string;
  is_online: boolean;
  last_seen_at: string;
}

interface Props {
  onConversationPress: (conversation: Conversation) => void;
  onNewChat: () => void;
}

function ChatListContent({ onConversationPress, onNewChat }: Props) {
  const { employee } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [onlineStatuses, setOnlineStatuses] = useState<Map<string, OnlineStatus>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const updateOnlineStatus = useCallback(async () => {
    if (!employee) return;
    await supabase.from('employee_online_status').upsert({
      employee_id: employee.id,
      is_online: true,
      last_seen_at: new Date().toISOString(),
    });
  }, [employee]);

  const fetchOnlineStatuses = useCallback(async () => {
    const { data } = await supabase.from('employee_online_status').select('*');
    if (data) {
      const map = new Map<string, OnlineStatus>();
      data.forEach((s: OnlineStatus) => map.set(s.employee_id, s));
      setOnlineStatuses(map);
    }
  }, []);

  const fetchConversations = useCallback(async () => {
    if (!employee) return;

    const { data: participations } = await supabase
      .from('employee_conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('employee_id', employee.id);

    if (!participations || participations.length === 0) {
      setConversations([]);
      return;
    }

    const conversationIds = participations.map((p) => p.conversation_id);
    const lastReadMap = new Map(participations.map((p) => [p.conversation_id, p.last_read_at]));

    const { data: convos } = await supabase
      .from('employee_conversations')
      .select('*')
      .in('id', conversationIds)
      .order('last_message_at', { ascending: false });

    if (!convos) {
      setConversations([]);
      return;
    }

    const { data: allParticipants } = await supabase
      .from('employee_conversation_participants')
      .select('id, conversation_id, employee_id, last_read_at')
      .in('conversation_id', conversationIds);

    const participantEmployeeIds = [
      ...new Set((allParticipants || []).map((p) => p.employee_id)),
    ];

    const { data: employeesData } = await supabase
      .from('employees')
      .select('id, name, surname, nickname, avatar_url, avatar_metadata')
      .in('id', participantEmployeeIds);

    const employeeMap = new Map((employeesData || []).map((e) => [e.id, e]));

    const enrichedConversations: Conversation[] = await Promise.all(
      convos.map(async (conv) => {
        const parts = (allParticipants || [])
          .filter((p) => p.conversation_id === conv.id)
          .map((p) => ({ ...p, employee: employeeMap.get(p.employee_id) }));

        const lastRead = lastReadMap.get(conv.id);
        let unreadCount = 0;
        if (lastRead) {
          const { count } = await supabase
            .from('employee_messages')
            .select('*', { count: 'exact', head: true })
            .eq('conversation_id', conv.id)
            .neq('sender_id', employee.id)
            .gt('created_at', lastRead);
          unreadCount = count || 0;
        }

        return { ...conv, participants: parts, unread_count: unreadCount };
      })
    );

    setConversations(enrichedConversations);
  }, [employee]);

  const loadAll = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setIsLoading(true);
      try {
        await Promise.all([fetchConversations(), fetchOnlineStatuses()]);
      } finally {
        setIsLoading(false);
        setRefreshing(false);
      }
    },
    [fetchConversations, fetchOnlineStatuses]
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Heartbeat for online status
  useEffect(() => {
    updateOnlineStatus();
    heartbeatRef.current = setInterval(updateOnlineStatus, 30000);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (employee) {
        supabase.from('employee_online_status').upsert({
          employee_id: employee.id,
          is_online: false,
          last_seen_at: new Date().toISOString(),
        });
      }
    };
  }, [employee, updateOnlineStatus]);

  // Realtime subscription for new messages
  useEffect(() => {
    const channel = supabase
      .channel('chat-list-updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'employee_messages' },
        () => {
          fetchConversations();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'employee_online_status' },
        (payload) => {
          if (payload.new) {
            const status = payload.new as OnlineStatus;
            setOnlineStatuses((prev) => {
              const next = new Map(prev);
              next.set(status.employee_id, status);
              return next;
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchConversations]);

  const getConversationName = (conv: Conversation): string => {
    if (conv.title) return conv.title;
    const otherParticipants = conv.participants.filter(
      (p) => p.employee_id !== employee?.id
    );
    if (otherParticipants.length === 0) return 'Notatki';
    return otherParticipants
      .map((p) => p.employee?.nickname || `${p.employee?.name} ${p.employee?.surname}`)
      .join(', ');
  };

  const getOtherParticipant = (conv: Conversation) => {
    if (conv.is_group) return null;
    return conv.participants.find((p) => p.employee_id !== employee?.id);
  };

  const isParticipantOnline = (employeeId: string): boolean => {
    const status = onlineStatuses.get(employeeId);
    if (!status) return false;
    if (!status.is_online) return false;
    const lastSeen = new Date(status.last_seen_at).getTime();
    return Date.now() - lastSeen < 120000; // 2 min threshold
  };

  const formatTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'teraz';
    if (diffMins < 60) return `${diffMins} min`;
    if (diffMins < 1440) {
      return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    }
    if (diffMins < 10080) {
      return date.toLocaleDateString('pl-PL', { weekday: 'short' });
    }
    return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
  };

  const filteredConversations = conversations.filter((conv) => {
    if (!search.trim()) return true;
    const name = getConversationName(conv).toLowerCase();
    const preview = conv.last_message_preview?.toLowerCase() || '';
    const q = search.toLowerCase();
    return name.includes(q) || preview.includes(q);
  });

  const renderConversation = ({ item }: { item: Conversation }) => {
    const name = getConversationName(item);
    const other = getOtherParticipant(item);
    const online = other ? isParticipantOnline(other.employee_id) : false;
    const hasUnread = item.unread_count > 0;

    return (
      <TouchableOpacity
        style={[styles.conversationCard, hasUnread && styles.conversationUnread]}
        onPress={() => onConversationPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.avatarContainer}>
          {item.is_group ? (
            <View style={styles.groupAvatar}>
              <Feather name="users" size={22} color={colors.primary.gold} />
            </View>
          ) : other?.employee ? (
            <EmployeeAvatar
              avatarUrl={other.employee.avatar_url}
              avatarMetadata={other.employee.avatar_metadata}
              employeeName={other.employee.nickname || other.employee.name}
              size={50}
            />
          ) : (
            <View style={styles.groupAvatar}>
              <Feather name="user" size={22} color={colors.text.tertiary} />
            </View>
          )}
          {/* Online indicator */}
          {!item.is_group && (
            <View
              style={[
                styles.onlineIndicator,
                { backgroundColor: online ? '#22C55E' : colors.text.tertiary },
              ]}
            />
          )}
        </View>

        <View style={styles.conversationInfo}>
          <View style={styles.conversationHeader}>
            <Text style={[styles.conversationName, hasUnread && styles.textBold]} numberOfLines={1}>
              {name}
            </Text>
            <Text style={[styles.timeText, hasUnread && styles.timeUnread]}>
              {formatTime(item.last_message_at)}
            </Text>
          </View>
          <View style={styles.conversationFooter}>
            <Text
              style={[styles.previewText, hasUnread && styles.previewUnread]}
              numberOfLines={1}
            >
              {item.last_message_preview || 'Rozpocznij rozmowę...'}
            </Text>
            {hasUnread && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>
                  {item.unread_count > 99 ? '99+' : item.unread_count}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
        <Text style={styles.loadingText}>Ładowanie konwersacji...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Czat</Text>
        <TouchableOpacity style={styles.newChatButton} onPress={onNewChat}>
          <Feather name="edit" size={20} color={colors.primary.gold} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Feather name="search" size={16} color={colors.text.tertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Szukaj rozmowy..."
          placeholderTextColor={colors.text.tertiary}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Feather name="x" size={16} color={colors.text.tertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Online now strip */}
      <OnlineStrip
        onlineStatuses={onlineStatuses}
        currentEmployeeId={employee?.id || ''}
        conversations={conversations}
        onConversationPress={onConversationPress}
      />

      {/* Conversations list */}
      <FlatList
        data={filteredConversations}
        renderItem={renderConversation}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadAll(true)}
            tintColor={colors.primary.gold}
            colors={[colors.primary.gold]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="message-circle" size={48} color={colors.text.tertiary} />
            <Text style={styles.emptyTitle}>Brak konwersacji</Text>
            <Text style={styles.emptySubtitle}>
              Rozpocznij nowy czat z pracownikiem
            </Text>
            <TouchableOpacity style={styles.startChatBtn} onPress={onNewChat}>
              <Feather name="plus" size={18} color="#fff" />
              <Text style={styles.startChatText}>Nowy czat</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

// Online users horizontal strip
function OnlineStrip({
  onlineStatuses,
  currentEmployeeId,
  conversations,
  onConversationPress,
}: {
  onlineStatuses: Map<string, OnlineStatus>;
  currentEmployeeId: string;
  conversations: Conversation[];
  onConversationPress: (conv: Conversation) => void;
}) {
  const [onlineEmployees, setOnlineEmployees] = useState<any[]>([]);

  useEffect(() => {
    const fetchOnline = async () => {
      const onlineIds = Array.from(onlineStatuses.entries())
        .filter(
          ([id, s]) =>
            id !== currentEmployeeId &&
            s.is_online &&
            Date.now() - new Date(s.last_seen_at).getTime() < 120000
        )
        .map(([id]) => id);

      if (onlineIds.length === 0) {
        setOnlineEmployees([]);
        return;
      }

      const { data } = await supabase
        .from('employees')
        .select('id, name, surname, nickname, avatar_url, avatar_metadata')
        .in('id', onlineIds);

      setOnlineEmployees(data || []);
    };
    fetchOnline();
  }, [onlineStatuses, currentEmployeeId]);

  if (onlineEmployees.length === 0) return null;

  const handlePress = (emp: any) => {
    const existingConv = conversations.find(
      (c) =>
        !c.is_group &&
        c.participants.some((p) => p.employee_id === emp.id)
    );
    if (existingConv) {
      onConversationPress(existingConv);
    }
  };

  return (
    <View style={styles.onlineStrip}>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={onlineEmployees}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: spacing.md }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.onlineUser} onPress={() => handlePress(item)}>
            <View style={styles.onlineAvatarWrap}>
              <EmployeeAvatar
                avatarUrl={item.avatar_url}
                avatarMetadata={item.avatar_metadata}
                employeeName={item.nickname || item.name}
                size={44}
              />
              <View style={styles.onlineDot} />
            </View>
            <Text style={styles.onlineUserName} numberOfLines={1}>
              {item.nickname || item.name}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

export default function ChatListScreen(props: Props) {
  return (
    <PermissionGate module="messages">
      <ChatListContent {...props} />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.fontSizes.sm,
    color: colors.text.tertiary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: typography.fontSizes.xxl,
    fontWeight: typography.fontWeights.bold as any,
    color: colors.text.primary,
  },
  newChatButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary.gold + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.secondary,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.md,
    height: 38,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing.sm,
    fontSize: typography.fontSizes.sm,
    color: colors.text.primary,
  },
  onlineStrip: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  onlineUser: {
    alignItems: 'center',
    marginRight: spacing.md,
    width: 56,
  },
  onlineAvatarWrap: {
    position: 'relative',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: colors.background.primary,
  },
  onlineUserName: {
    fontSize: 10,
    color: colors.text.secondary,
    marginTop: 4,
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  conversationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  conversationUnread: {
    backgroundColor: colors.primary.gold + '08',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: spacing.md,
  },
  groupAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.background.tertiary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.background.primary,
  },
  conversationInfo: {
    flex: 1,
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  conversationName: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.medium as any,
    color: colors.text.primary,
    flex: 1,
    marginRight: spacing.sm,
  },
  textBold: {
    fontWeight: typography.fontWeights.bold as any,
  },
  timeText: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },
  timeUnread: {
    color: colors.primary.gold,
    fontWeight: typography.fontWeights.semibold as any,
  },
  conversationFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.tertiary,
    flex: 1,
    marginRight: spacing.sm,
  },
  previewUnread: {
    color: colors.text.secondary,
    fontWeight: typography.fontWeights.medium as any,
  },
  unreadBadge: {
    backgroundColor: colors.primary.gold,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadText: {
    fontSize: 11,
    fontWeight: typography.fontWeights.bold as any,
    color: '#fff',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl * 2,
  },
  emptyTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold as any,
    color: colors.text.primary,
    marginTop: spacing.md,
  },
  emptySubtitle: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.tertiary,
    marginTop: spacing.xs,
  },
  startChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary.gold,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.lg,
  },
  startChatText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.semibold as any,
    color: '#fff',
  },
});
