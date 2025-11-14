import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, typography, borderRadius } from '../theme';

interface Notification {
  id: string;
  title: string;
  message: string;
  category: string;
  created_at: string;
  is_read: boolean;
  related_entity_type?: string;
  related_entity_id?: string;
}

export default function NotificationsScreen() {
  const navigation = useNavigation();
  const { employee } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (employee?.id) {
      fetchNotifications();

      const channel = supabase
        .channel('notifications_screen_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notification_recipients',
            filter: `user_id=eq.${employee.id}`,
          },
          () => {
            fetchNotifications();
          },
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [employee?.id]);

  const fetchNotifications = async () => {
    if (!employee?.id) return;

    try {
      const { data, error } = await supabase
        .from('notification_recipients')
        .select(
          `
          id,
          is_read,
          notification:notifications(
            id,
            title,
            message,
            category,
            related_entity_type,
            related_entity_id,
            created_at
          )
        `,
        )
        .eq('user_id', employee.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedNotifications = data
        .filter((item: any) => item.notification)
        .map((item: any) => ({
          ...item.notification,
          is_read: item.is_read,
          recipient_id: item.id,
        }));

      setNotifications(formattedNotifications);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const markAsRead = async (notificationId: string, recipientId: string) => {
    try {
      await supabase
        .from('notification_recipients')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', recipientId);

      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n)),
      );
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    if (!employee?.id) return;

    try {
      await supabase
        .from('notification_recipients')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', employee.id)
        .eq('is_read', false);

      fetchNotifications();
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  const handleNotificationPress = (notification: Notification) => {
    markAsRead(notification.id, (notification as any).recipient_id);

    if (notification.related_entity_type === 'task' && notification.related_entity_id) {
      navigation.navigate(
        'Tasks' as never,
        {
          screen: 'TaskDetail',
          params: { taskId: notification.related_entity_id },
        } as never,
      );
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchNotifications();
  };

  const renderNotification = ({ item }: { item: Notification }) => {
    const timeDiff = new Date().getTime() - new Date(item.created_at).getTime();
    const hours = Math.floor(timeDiff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    let timeText = '';
    if (days > 0) {
      timeText = `${days}d temu`;
    } else if (hours > 0) {
      timeText = `${hours}h temu`;
    } else {
      timeText = 'Teraz';
    }

    return (
      <TouchableOpacity
        style={[styles.notificationItem, !item.is_read && styles.unreadNotification]}
        onPress={() => handleNotificationPress(item)}
      >
        <View style={styles.notificationIcon}>
          <Feather
            name={item.is_read ? 'check-circle' : 'bell'}
            color={item.is_read ? colors.text.tertiary : colors.primary.gold}
            size={24}
          />
        </View>
        <View style={styles.notificationContent}>
          <Text style={styles.notificationTitle}>{item.title}</Text>
          <Text style={styles.notificationMessage} numberOfLines={2}>
            {item.message}
          </Text>
          <Text style={styles.notificationTime}>{timeText}</Text>
        </View>
        {!item.is_read && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {notifications.length > 0 && (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            Powiadomienia ({notifications.filter((n) => !n.is_read).length})
          </Text>
          <TouchableOpacity onPress={markAllAsRead} style={styles.markAllButton}>
            <Text style={styles.markAllText}>Oznacz wszystkie</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={notifications}
        renderItem={renderNotification}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary.gold}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Feather name="bell-off" color={colors.text.tertiary} size={48} />
            <Text style={styles.emptyText}>Brak powiadomień</Text>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  headerTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold,
    color: colors.text.primary,
  },
  markAllButton: {
    padding: spacing.sm,
  },
  markAllText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: typography.fontWeights.medium,
    color: colors.primary.gold,
  },
  listContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  notificationItem: {
    flexDirection: 'row',
    backgroundColor: colors.background.secondary,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    gap: spacing.md,
  },
  unreadNotification: {
    backgroundColor: colors.primary.gold + '10',
    borderColor: colors.primary.gold + '40',
  },
  notificationIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationContent: {
    flex: 1,
    gap: spacing.xs,
  },
  notificationTitle: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.semibold,
    color: colors.text.primary,
  },
  notificationMessage: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
    lineHeight: 18,
  },
  notificationTime: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary.gold,
    alignSelf: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl * 2,
    gap: spacing.lg,
  },
  emptyText: {
    fontSize: typography.fontSizes.md,
    color: colors.text.tertiary,
  },
});
