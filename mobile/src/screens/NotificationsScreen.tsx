import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, typography, borderRadius } from '../theme';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

type TasksStackParamList = {
  Tasks: {
    screen: 'TaskDetail';
    params: {
      taskId: string;
    };
  };
  TaskDetail: {
    taskId: string;
  };
};

interface NotificationMetadata {
  assignment_id?: string;
  requires_response?: boolean;
  assignment_status?: string;
  responded_at?: string;
  [key: string]: any;
}

interface Notification {
  id: string;
  title: string;
  message: string;
  category: string;
  created_at: string;
  is_read: boolean;
  related_entity_type?: string;
  related_entity_id?: string;
  metadata?: NotificationMetadata;
  recipient_id: string;
}

type TasksNavigationProp = NativeStackNavigationProp<TasksStackParamList, 'Tasks'>;

export default function NotificationsScreen() {
  const navigation = useNavigation<TasksNavigationProp>();
  const { employee } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);

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
          }
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
        .select(`
          id,
          is_read,
          notification:notifications(
            id,
            title,
            message,
            category,
            related_entity_type,
            related_entity_id,
            created_at,
            metadata
          )
        `)
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
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
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

  const handleAssignmentResponse = async (
    notification: Notification,
    status: 'accepted' | 'rejected'
  ) => {
    const assignmentId = notification.metadata?.assignment_id;
    if (!assignmentId) return;

    setRespondingId(assignmentId);
    try {
      const { error } = await supabase
        .from('employee_assignments')
        .update({
          status,
          responded_at: new Date().toISOString(),
        })
        .eq('id', assignmentId);

      if (error) throw error;

      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notification.id
            ? {
                ...n,
                metadata: {
                  ...n.metadata,
                  requires_response: false,
                  assignment_status: status,
                  responded_at: new Date().toISOString(),
                },
              }
            : n
        )
      );

      Alert.alert(
        status === 'accepted' ? 'Zaakceptowano' : 'Odrzucono',
        status === 'accepted'
          ? 'Zaproszenie do wydarzenia zostało zaakceptowane.'
          : 'Zaproszenie do wydarzenia zostało odrzucone.'
      );
    } catch (error) {
      console.error('Error responding to assignment:', error);
      Alert.alert('Błąd', 'Nie udało się zaktualizować statusu zaproszenia.');
    } finally {
      setRespondingId(null);
    }
  };

  const handleAccept = (notification: Notification) => {
    Alert.alert(
      'Akceptacja zaproszenia',
      'Czy na pewno chcesz zaakceptować zaproszenie do tego wydarzenia?',
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Akceptuj', onPress: () => handleAssignmentResponse(notification, 'accepted') },
      ]
    );
  };

  const handleReject = (notification: Notification) => {
    Alert.alert(
      'Odrzucenie zaproszenia',
      'Czy na pewno chcesz odrzucić zaproszenie do tego wydarzenia?',
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Odrzuć', style: 'destructive', onPress: () => handleAssignmentResponse(notification, 'rejected') },
      ]
    );
  };

  const handleNotificationPress = (notification: Notification) => {
    markAsRead(notification.id, notification.recipient_id);

    if (notification.related_entity_type === 'task' && notification.related_entity_id) {
      navigation.navigate('Tasks', {
        screen: 'TaskDetail',
        params: { taskId: notification.related_entity_id },
      });
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchNotifications();
  };

  const renderInvitationActions = (item: Notification) => {
    const metadata = item.metadata;
    if (!metadata?.assignment_id) return null;

    const isResponding = respondingId === metadata.assignment_id;

    if (metadata.requires_response) {
      return (
        <View style={styles.invitationActions}>
          <TouchableOpacity
            style={styles.acceptButton}
            onPress={() => handleAccept(item)}
            disabled={isResponding}
          >
            {isResponding ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Feather name="check-circle" size={14} color="#fff" />
                <Text style={styles.acceptButtonText}>Akceptuj</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.rejectButton}
            onPress={() => handleReject(item)}
            disabled={isResponding}
          >
            <Feather name="x-circle" size={14} color="#ef4444" />
            <Text style={styles.rejectButtonText}>Odrzuć</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (metadata.assignment_status === 'accepted') {
      return (
        <View style={styles.statusBadgeAccepted}>
          <Feather name="check-circle" size={13} color="#22c55e" />
          <Text style={styles.statusBadgeAcceptedText}>Zaakceptowano</Text>
          {metadata.responded_at && (
            <Text style={styles.statusBadgeDate}>
              {new Date(metadata.responded_at).toLocaleDateString('pl-PL', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          )}
        </View>
      );
    }

    if (metadata.assignment_status === 'rejected') {
      return (
        <View style={styles.statusBadgeRejected}>
          <Feather name="x-circle" size={13} color="#ef4444" />
          <Text style={styles.statusBadgeRejectedText}>Odrzucono</Text>
          {metadata.responded_at && (
            <Text style={styles.statusBadgeDateRed}>
              {new Date(metadata.responded_at).toLocaleDateString('pl-PL', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          )}
        </View>
      );
    }

    return null;
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

    const hasInvitation = !!item.metadata?.assignment_id;

    return (
      <TouchableOpacity
        style={[
          styles.notificationItem,
          !item.is_read && styles.unreadNotification,
          hasInvitation && item.metadata?.requires_response && styles.invitationNotification,
        ]}
        onPress={() => handleNotificationPress(item)}
      >
        <View style={styles.notificationIcon}>
          <Feather
            name={
              hasInvitation && item.metadata?.requires_response
                ? 'user-plus'
                : item.is_read
                  ? 'check-circle'
                  : 'bell'
            }
            color={
              hasInvitation && item.metadata?.requires_response
                ? '#f59e0b'
                : item.is_read
                  ? colors.text.tertiary
                  : colors.primary.gold
            }
            size={24}
          />
        </View>
        <View style={styles.notificationContent}>
          <Text style={styles.notificationTitle}>{item.title}</Text>
          <Text style={styles.notificationMessage} numberOfLines={2}>
            {item.message}
          </Text>
          {renderInvitationActions(item)}
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
  invitationNotification: {
    borderColor: '#f59e0b',
    backgroundColor: '#fef3c7' + '20',
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
  // Invitation actions
  invitationActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  acceptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#22c55e',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  acceptButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  rejectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  rejectButtonText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
  statusBadgeAccepted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  statusBadgeAcceptedText: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '600',
  },
  statusBadgeDate: {
    color: '#166534',
    fontSize: 10,
    opacity: 0.7,
    marginLeft: 4,
  },
  statusBadgeRejected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#fee2e2',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  statusBadgeRejectedText: {
    color: '#991b1b',
    fontSize: 12,
    fontWeight: '600',
  },
  statusBadgeDateRed: {
    color: '#991b1b',
    fontSize: 10,
    opacity: 0.7,
    marginLeft: 4,
  },
});
