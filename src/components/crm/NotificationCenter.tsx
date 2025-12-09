'use client';

import { useState, useEffect, useRef } from 'react';
import { Bell, X, Check, ExternalLink, Trash2, CheckCheck, CheckCircle, XCircle, MessageSquare } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { useSnackbar } from '@/contexts/SnackbarContext';

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
  const { showSnackbar } = useSnackbar();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showPanel, setShowPanel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const prevUnreadCountRef = useRef<number>(0);
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    fetchNotifications();
    loadUserPreferences();

    const channel = supabase
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
        }
      )
      .subscribe((status) => {
      });

    return () => {
      supabase.removeChannel(channel);
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
      const { data: { user } } = await supabase.auth.getUser();
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('notification_recipients')
        .select(`
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
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

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
          read_at: new Date().toISOString()
        })
        .eq('id', recipientId);

      if (error) throw error;

      setNotifications((prev) =>
        prev.map((n) => (n.recipient_id === recipientId ? { ...n, is_read: true, read_at: new Date().toISOString() } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const unreadRecipientIds = notifications
        .filter((n) => !n.is_read)
        .map((n) => n.recipient_id);

      if (unreadRecipientIds.length === 0) return;

      const { error } = await supabase
        .from('notification_recipients')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .in('id', unreadRecipientIds);

      if (error) throw error;

      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking all as read:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteNotification = async (recipientId: string) => {
    try {
      const notificationToDelete = notifications.find(n => n.recipient_id === recipientId);

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

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) {
      markAsRead(notification.recipient_id);
    }

    if (notification.action_url) {
      router.push(notification.action_url);
      setShowPanel(false);
    }
  };

  const handleAssignmentResponse = async (assignmentId: string, status: 'accepted' | 'rejected', recipientId: string) => {
    try {
      const { error } = await supabase
        .from('employee_assignments')
        .update({ status })
        .eq('id', assignmentId);

      if (error) throw error;

      showSnackbar(
        status === 'accepted' ? 'Zaproszenie zaakceptowane' : 'Zaproszenie odrzucone',
        'success'
      );

      // Update the notification in state to hide buttons immediately
      setNotifications((prev) =>
        prev.map((n) =>
          n.recipient_id === recipientId
            ? { ...n, metadata: { ...n.metadata, requires_response: false } }
            : n
        )
      );

      // Also fetch fresh data
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
    if (notification.title === 'Nowy komentarz w zadaniu' || notification.category === 'task_comment') {
      return <MessageSquare className="w-4 h-4" />;
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
    filter === 'unread'
      ? notifications.filter((n) => !n.is_read)
      : notifications;

  return (
    <div className="relative">
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="relative p-1.5 md:p-2 rounded-lg hover:bg-[#1c1f33] transition-colors"
      >
        <Bell className="w-5 h-5 md:w-6 md:h-6 text-[#e5e4e2]" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {showPanel && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowPanel(false)}
          />

          <div className="fixed md:absolute right-0 md:right-0 top-16 md:top-12 left-0 md:left-auto w-full md:w-96 max-h-[80vh] md:max-h-[600px] bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg shadow-2xl z-50 flex flex-col mx-auto md:mx-0 max-w-md md:max-w-none">
            <div className="p-4 border-b border-[#d3bb73]/20">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-[#e5e4e2]">
                  Powiadomienia
                </h3>
                <button
                  onClick={() => setShowPanel(false)}
                  className="p-1 hover:bg-[#0f1119] rounded transition-colors"
                >
                  <X className="w-5 h-5 text-[#e5e4e2]" />
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setFilter('all')}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    filter === 'all'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#0f1119]/80'
                  }`}
                >
                  Wszystkie ({notifications.length})
                </button>
                <button
                  onClick={() => setFilter('unread')}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    filter === 'unread'
                      ? 'bg-[#d3bb73] text-[#1c1f33]'
                      : 'bg-[#0f1119] text-[#e5e4e2] hover:bg-[#0f1119]/80'
                  }`}
                >
                  Nieprzeczytane ({unreadCount})
                </button>
              </div>

              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  disabled={loading}
                  className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-1.5 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg text-sm font-medium hover:bg-[#d3bb73]/30 transition-colors disabled:opacity-50"
                >
                  <CheckCheck className="w-4 h-4" />
                  Oznacz wszystkie jako przeczytane
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {filteredNotifications.length === 0 ? (
                <div className="p-8 text-center text-[#e5e4e2]/60">
                  <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>
                    {filter === 'unread'
                      ? 'Brak nieprzeczytanych powiadomień'
                      : 'Brak powiadomień'}
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
                      className={`p-4 hover:bg-[#0f1119]/50 transition-colors ${
                        notification.action_url ? 'cursor-pointer' : ''
                      } ${
                        !notification.is_read ? 'bg-[#d3bb73]/5' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`flex-shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center ${getTypeColor(
                            notification.type
                          )}`}
                        >
                          <span className="text-sm flex items-center justify-center">
                            {getTypeIcon(notification)}
                          </span>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h4
                              className={`font-medium ${
                                notification.is_read
                                  ? 'text-[#e5e4e2]/70'
                                  : 'text-[#e5e4e2]'
                              }`}
                            >
                              {notification.title}
                            </h4>
                            {!notification.is_read && (
                              <div className="flex-shrink-0 w-2 h-2 bg-[#d3bb73] rounded-full" />
                            )}
                          </div>

                          <p
                            className={`text-sm mt-1 ${
                              notification.is_read
                                ? 'text-[#e5e4e2]/50'
                                : 'text-[#e5e4e2]/70'
                            }`}
                          >
                            {notification.message}
                          </p>

                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-xs text-[#e5e4e2]/40">
                              {new Date(
                                notification.created_at
                              ).toLocaleString('pl-PL', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>


                            <span className="text-xs px-2 py-0.5 bg-[#0f1119] text-[#e5e4e2]/60 rounded">
                              {notification.category}
                            </span>
                          </div>

                          {notification.metadata?.requires_response && notification.metadata?.assignment_id && (
                            <div className="flex items-center gap-2 mt-3">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAssignmentResponse(notification.metadata.assignment_id, 'accepted', notification.recipient_id);
                                }}
                                className="flex items-center gap-1 px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg text-xs font-medium hover:bg-green-500/30 transition-colors"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                Akceptuj
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAssignmentResponse(notification.metadata.assignment_id, 'rejected', notification.recipient_id);
                                }}
                                className="flex items-center gap-1 px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-xs font-medium hover:bg-red-500/30 transition-colors"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                Odrzuć
                              </button>
                            </div>
                          )}

                          <div className="flex items-center gap-2 mt-2">
                            {notification.action_url && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleNotificationClick(notification);
                                }}
                                className="flex items-center gap-1 text-xs text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                                Przejdź
                              </button>
                            )}

                            {!notification.is_read && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markAsRead(notification.recipient_id);
                                }}
                                className="flex items-center gap-1 text-xs text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
                              >
                                <Check className="w-3 h-3" />
                                Oznacz jako przeczytane
                              </button>
                            )}

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteNotification(notification.recipient_id);
                              }}
                              className="flex items-center gap-1 text-xs text-red-400/60 hover:text-red-400 transition-colors ml-auto"
                            >
                              <Trash2 className="w-3 h-3" />
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
    </div>
  );
}
