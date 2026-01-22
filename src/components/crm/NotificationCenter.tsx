'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Bell,
  X,
  Check,
  ExternalLink,
  Trash2,
  CheckCheck,
  CheckCircle,
  XCircle,
  MessageSquare,
  Mail,
} from 'lucide-react';

import { useRouter } from 'next/navigation';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { supabase } from '@/lib/supabase/browser';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  category: string;
  action_url: string | null;
  created_at: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  metadata: any;
  recipient_id: string;
  is_read: boolean;
  read_at: string | null;
}

export default function NotificationCenter() {
  const router = useRouter();
  const { isAdmin } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showPanel, setShowPanel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const prevUnreadCountRef = useRef<number>(0);
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    fetchNotifications();
    loadUserPreferences();

    const recipientsChannel = supabase
      .channel('notification-recipients-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notification_recipients',
        },
        (payload) => {
          fetchNotifications();
        },
      )
      .subscribe();

    const notificationsChannel = supabase
      .channel('notifications-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
        },
        (payload) => {
          fetchNotifications();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(recipientsChannel);
      supabase.removeChannel(notificationsChannel);
    };
  }, []);

  useEffect(() => {
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      prevUnreadCountRef.current = unreadCount;
      return;
    }

    if (unreadCount > prevUnreadCountRef.current && soundEnabled) {
      playNotificationSound();
    }

    prevUnreadCountRef.current = unreadCount;
  }, [unreadCount, soundEnabled]);

  const loadUserPreferences = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('employees')
        .select('preferences')
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data?.preferences?.notifications?.soundEnabled !== undefined) {
        setSoundEnabled(data.preferences.notifications.soundEnabled);
      }
    } catch (error) {
      console.error('Error loading user preferences:', error);
    }
  };

  const playNotificationSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.1);

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);

      setTimeout(() => {
        audioContext.close();
      }, 400);
    } catch (error) {
      console.error('Error playing notification sound:', error);
    }
  };

  const fetchNotifications = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('notification_recipients')
        .select(
          `
          id,
          is_read,
          read_at,
          notifications (
            id,
            title,
            message,
            type,
            category,
            action_url,
            created_at,
            related_entity_type,
            related_entity_id,
            metadata
          )
        `,
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      if (data) {
        const formattedNotifications = data.map((recipient: any) => ({
          ...recipient.notifications,
          recipient_id: recipient.id,
          is_read: recipient.is_read,
          read_at: recipient.read_at,
        }));
        setNotifications(formattedNotifications);
        setUnreadCount(formattedNotifications.filter((n: any) => !n.is_read).length);
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  const markAsRead = async (recipientId: string) => {
    try {
      const { error } = await supabase
        .from('notification_recipients')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('id', recipientId);

      if (error) throw error;

      setNotifications((prev) =>
        prev.map((n) =>
          n.recipient_id === recipientId
            ? { ...n, is_read: true, read_at: new Date().toISOString() }
            : n,
        ),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const unreadRecipientIds = notifications.filter((n) => !n.is_read).map((n) => n.recipient_id);

      if (unreadRecipientIds.length === 0) return;

      const { error } = await supabase
        .from('notification_recipients')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .in('id', unreadRecipientIds);

      if (error) throw error;

      setNotifications((prev) =>
        prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() })),
      );
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking all as read:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteNotification = async (recipientId: string) => {
    try {
      const notificationToDelete = notifications.find((n) => n.recipient_id === recipientId);

      const { error } = await supabase
        .from('notification_recipients')
        .delete()
        .eq('id', recipientId);

      if (error) throw error;

      setNotifications((prev) => prev.filter((n) => n.recipient_id !== recipientId));

      if (notificationToDelete && !notificationToDelete.is_read) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const deleteAllNotifications = async () => {
    try {
      setDeletingAll(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Pobierz wszystkie recipient_ids użytkownika (nie tylko z bieżącego limitu)
      const { data: allRecipients, error: fetchError } = await supabase
        .from('notification_recipients')
        .select('id')
        .eq('user_id', user.id);

      if (fetchError) throw fetchError;

      if (!allRecipients || allRecipients.length === 0) {
        showSnackbar('Brak powiadomień do usunięcia', 'info');
        return;
      }

      // Usuń wszystkie
      const { error: deleteError } = await supabase
        .from('notification_recipients')
        .delete()
        .eq('user_id', user.id);

      if (deleteError) throw deleteError;

      setNotifications([]);
      setUnreadCount(0);
      showSnackbar(`Usunięto ${allRecipients.length} powiadomień`, 'success');
    } catch (error) {
      console.error('Error deleting all notifications:', error);
      showSnackbar('Błąd podczas usuwania powiadomień', 'error');
    } finally {
      setDeletingAll(false);
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) {
      markAsRead(notification.recipient_id);
    }

    if (notification.action_url) {
      router.push(notification.action_url);
      setShowPanel(false);
    }
  };

  const handleAssignmentResponse = async (
    assignmentId: string,
    status: 'accepted' | 'rejected',
    recipientId: string,
  ) => {
    try {
      const { error } = await supabase
        .from('employee_assignments')
        .update({
          status,
          responded_at: new Date().toISOString(),
        })
        .eq('id', assignmentId);

      if (error) throw error;

      showSnackbar(
        status === 'accepted' ? 'Zaproszenie zaakceptowane' : 'Zaproszenie odrzucone',
        'success',
      );

      // Update the notification in state to show status immediately
      setNotifications((prev) =>
        prev.map((n) =>
          n.recipient_id === recipientId
            ? {
                ...n,
                metadata: {
                  ...n.metadata,
                  requires_response: false,
                  assignment_status: status,
                  responded_at: new Date().toISOString(),
                },
              }
            : n,
        ),
      );

      // Also fetch fresh data to ensure sync
      await fetchNotifications();
    } catch (error) {
      console.error('Error responding to assignment:', error);
      showSnackbar('Błąd podczas odpowiedzi na zaproszenie', 'error');
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'success':
        return 'border-green-500/30 bg-green-500/5';
      case 'error':
        return 'border-red-500/30 bg-red-500/5';
      case 'warning':
        return 'border-yellow-500/30 bg-yellow-500/5';
      default:
        return 'border-blue-500/30 bg-blue-500/5';
    }
  };

  const getTypeIcon = (notification: Notification) => {
    if (
      notification.title === 'Nowy komentarz w zadaniu' ||
      notification.category === 'task_comment'
    ) {
      return <MessageSquare className="h-4 w-4" />;
    }

    if (notification.category === 'email' || notification.category === 'contact_form') {
      return <Mail className="h-4 w-4" />;
    }

    switch (notification.type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      default:
        return 'ℹ️';
    }
  };

  const filteredNotifications =
    filter === 'unread' ? notifications.filter((n) => !n.is_read) : notifications;

  return (
    <div className="relative">
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="relative rounded-lg p-1.5 transition-colors hover:bg-[#1c1f33] md:p-2"
      >
        <Bell className="h-5 w-5 text-[#e5e4e2] md:h-6 md:w-6" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {showPanel && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowPanel(false)} />

          <div className="fixed left-0 right-0 top-16 z-50 mx-auto flex max-h-[80vh] w-full max-w-md flex-col rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl md:absolute md:left-auto md:right-0 md:top-12 md:mx-0 md:max-h-[600px] md:w-96 md:max-w-none">
            <div className="border-b border-[#d3bb73]/20 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-[#e5e4e2]">Powiadomienia</h3>
                  <p className="mt-0.5 text-xs text-[#e5e4e2]/40">Wyświetlanie ostatnich 100</p>
                </div>
                <button
                  onClick={() => setShowPanel(false)}
                  className="rounded p-1 transition-colors hover:bg-[#0f1119]"
                >
                  <X className="h-5 w-5 text-[#e5e4e2]" />
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setFilter('all')}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    filter === 'all'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#0f1119]/80'
                  }`}
                >
                  Wszystkie ({notifications.length})
                </button>
                <button
                  onClick={() => setFilter('unread')}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    filter === 'unread'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#0f1119]/80'
                  }`}
                >
                  Nieprzeczytane ({unreadCount})
                </button>
              </div>

              <div className="mt-2 space-y-2">
                {unreadCount > 0 && isAdmin && (
                  <button
                    onClick={markAllAsRead}
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/20 px-3 py-1.5 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30 disabled:opacity-50"
                  >
                    <CheckCheck className="h-4 w-4" />
                    Oznacz wszystkie jako przeczytane
                  </button>
                )}
                {notifications.length > 0 && isAdmin && (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={deletingAll}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-500/20 px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Usuń wszystkie powiadomienia
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {filteredNotifications.length === 0 ? (
                <div className="p-8 text-center text-[#e5e4e2]/60">
                  <Bell className="mx-auto mb-3 h-12 w-12 opacity-30" />
                  <p>
                    {filter === 'unread' ? 'Brak nieprzeczytanych powiadomień' : 'Brak powiadomień'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#d3bb73]/10">
                  {filteredNotifications.map((notification) => (
                    <div
                      key={notification.id}
                      onClick={() => {
                        if (notification.action_url) {
                          handleNotificationClick(notification);
                        }
                      }}
                      className={`p-4 transition-colors hover:bg-[#0f1119]/50 ${
                        notification.action_url ? 'cursor-pointer' : ''
                      } ${!notification.is_read ? 'bg-[#d3bb73]/5' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border ${getTypeColor(
                            notification.type,
                          )}`}
                        >
                          <span className="flex items-center justify-center text-sm">
                            {getTypeIcon(notification)}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <h4
                              className={`font-medium ${
                                notification.is_read ? 'text-[#e5e4e2]/70' : 'text-[#e5e4e2]'
                              }`}
                            >
                              {notification.title}
                            </h4>
                            {!notification.is_read && (
                              <div className="h-2 w-2 flex-shrink-0 rounded-full bg-[#d3bb73]" />
                            )}
                          </div>

                          <p
                            className={`mt-1 text-sm ${
                              notification.is_read ? 'text-[#e5e4e2]/50' : 'text-[#e5e4e2]/70'
                            }`}
                          >
                            {notification.message}
                          </p>

                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs text-[#e5e4e2]/40">
                              {new Date(notification.created_at).toLocaleString('pl-PL', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>

                            <span className="rounded bg-[#0f1119] px-2 py-0.5 text-xs text-[#e5e4e2]/60">
                              {notification.category}
                            </span>
                          </div>

                          {notification.metadata?.assignment_id && (
                            <div className="mt-3 flex items-center gap-2">
                              {notification.metadata?.requires_response ? (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAssignmentResponse(
                                        notification.metadata.assignment_id,
                                        'accepted',
                                        notification.recipient_id,
                                      );
                                    }}
                                    className="flex items-center gap-1 rounded-lg bg-green-500/20 px-3 py-1.5 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/30"
                                  >
                                    <CheckCircle className="h-3.5 w-3.5" />
                                    Akceptuj
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAssignmentResponse(
                                        notification.metadata.assignment_id,
                                        'rejected',
                                        notification.recipient_id,
                                      );
                                    }}
                                    className="flex items-center gap-1 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/30"
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
                                    Odrzuć
                                  </button>
                                </>
                              ) : notification.metadata?.assignment_status === 'accepted' ? (
                                <div className="flex items-center gap-1 rounded-lg bg-green-500/20 px-3 py-1.5 text-xs font-medium text-green-400">
                                  <CheckCircle className="h-3.5 w-3.5" />
                                  Zaakceptowano
                                  {notification.metadata?.responded_at && (
                                    <span className="ml-1 text-green-400/60">
                                      {new Date(
                                        notification.metadata.responded_at,
                                      ).toLocaleDateString('pl-PL', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </span>
                                  )}
                                </div>
                              ) : notification.metadata?.assignment_status === 'rejected' ? (
                                <div className="flex items-center gap-1 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400">
                                  <XCircle className="h-3.5 w-3.5" />
                                  Odrzucono
                                  {notification.metadata?.responded_at && (
                                    <span className="ml-1 text-red-400/60">
                                      {new Date(
                                        notification.metadata.responded_at,
                                      ).toLocaleDateString('pl-PL', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </span>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          )}

                          <div className="mt-2 flex items-center gap-2">
                            {notification.action_url && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleNotificationClick(notification);
                                }}
                                className="flex items-center gap-1 text-xs text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Przejdź
                              </button>
                            )}

                            {!notification.is_read && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markAsRead(notification.recipient_id);
                                }}
                                className="flex items-center gap-1 text-xs text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
                              >
                                <Check className="h-3 w-3" />
                                Oznacz jako przeczytane
                              </button>
                            )}

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteNotification(notification.recipient_id);
                              }}
                              className="ml-auto flex items-center gap-1 text-xs text-red-400/60 transition-colors hover:text-red-400"
                            >
                              <Trash2 className="h-3 w-3" />
                              Usuń
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Modal potwierdzenia usunięcia wszystkich */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-500/20 bg-[#1c1f33] p-6">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/20">
                <Trash2 className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-[#e5e4e2]">
                  Usuń wszystkie powiadomienia?
                </h3>
                <p className="mt-1 text-sm text-[#e5e4e2]/60">
                  Ta akcja usunie wszystkie Twoje powiadomienia z bazy danych. Tej operacji nie
                  można cofnąć.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deletingAll}
                className="flex-1 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm font-medium text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
              >
                Anuluj
              </button>
              <button
                onClick={async () => {
                  await deleteAllNotifications();
                  setShowDeleteConfirm(false);
                }}
                disabled={deletingAll}
                className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {deletingAll ? 'Usuwanie...' : 'Usuń wszystkie'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
