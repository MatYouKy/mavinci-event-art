'use client';

import { systemNotificationText } from '@/lib/ui/systemLabels';

import { useState, useEffect, useRef, useCallback } from 'react';
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
  Calendar,
  Webhook,
} from 'lucide-react';

import { useRouter } from 'next/navigation';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { supabase } from '@/lib/supabase/browser';
import { AbsenceRequestModal } from '@/components/crm/employee/modal/AbsenceRequestModal';
import { refreshSellerSidebarBadge } from '@/lib/seller/sidebarBadge';

const NOTIFICATION_CATEGORY_LABELS: Record<string, string> = {
  meeting_invitation: 'Spotkanie',
  tasks: 'Zadanie',
  task_comment: 'Komentarz',
  inquiry: 'Zapytanie',
  event_assignment: 'Przypisanie do wydarzenia',
  event_update: 'Aktualizacja wydarzenia',
  absence_request: 'Wniosek urlopowy',
  absence_approved: 'Urlop zaakceptowany',
  absence_rejected: 'Urlop odrzucony',
  email_received: 'Wiadomość e-mail',
  contact_form: 'Formularz kontaktowy',
  webhook: 'Webhook',
  offer: 'Oferta',
  system: 'System',
};

const getBannerIcon = (relatedEntityType: string | null) => {
  switch (relatedEntityType) {
    case 'meeting':
      return <Calendar className="h-4 w-4 text-[#d3bb73]" />;

    case 'task':
    case 'inquiry':
      return <CheckCircle className="h-4 w-4 text-[#d3bb73]" />;

    case 'event':
      return <Calendar className="h-4 w-4 text-[#d3bb73]" />;

    case 'contact_messages':
      return <Mail className="h-4 w-4 text-[#d3bb73]" />;

    case 'inbound_event':
      return <Webhook className="h-4 w-4 text-[#d3bb73]" />;

    default:
      return <Bell className="h-4 w-4 text-[#d3bb73]" />;
  }
};

function getNotificationActionUrl(notification: {
  title?: string | null;
  action_url?: string | null;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
  category?: string | null;
  metadata?: any;
}): string | null {
  // Older seller notices can have no action URL, or a URL without the review
  // anchor. Resolve them here as well as notices created by the current backend.
  const metadata = notification.metadata || {};
  const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  let storedUrl: URL | null = null;
  try {
    if (notification.action_url) storedUrl = new URL(notification.action_url, 'https://notification.local');
  } catch { /* Use the related offer when a legacy URL is malformed. */ }
  const linkedOffer = storedUrl?.pathname.match(/^\/(?:crm|seller)\/offers\/([^/]+)\/?$/)?.[1];
  const offerId = notification.related_entity_type === 'offer' && isUuid(notification.related_entity_id)
    ? notification.related_entity_id : isUuid(metadata.offer_id) ? metadata.offer_id : isUuid(linkedOffer) ? linkedOffer : null;
  // Seller decisions must win over the generic sales_partner/document routing
  // below, which is meant for incoming CRM review requests.
  if (offerId && metadata.workflow === 'seller_review_result') {
    return ['realization_accepted', 'realization_confirmed'].includes(metadata.event)
      ? `/seller/realizations/${offerId}#seller-offer-review`
      : `/seller/offers/${offerId}#seller-offer-review`;
  }
  const isSellerReview = notification.title === 'Zapytanie sprzedawcy: termin i zasoby'
    || (metadata.workflow === 'seller_offer' && metadata.event === 'review_requested')
    || (metadata.workflow === 'seller_offer' && storedUrl?.hash === '#seller-offer-review');
  const isSellerOffer = isSellerReview || metadata.workflow === 'seller_offer'
    || notification.title === 'Wygenerowano ofertę sprzedawcy'
    || (metadata.sales_partner_id && metadata.document_id);
  if (offerId && isSellerOffer) {
    const linkedDocument = storedUrl?.searchParams.get('document');
    const documentId = isUuid(metadata.document_id) ? metadata.document_id : isUuid(linkedDocument) ? linkedDocument : null;
    const query = documentId ? `?document=${documentId}&preview=1` : '';
    return `/crm/offers/${offerId}${query}${isSellerReview ? '#seller-offer-review' : ''}`;
  }
  if (isUuid(metadata.inquiry_id)
    && (!['task', 'tasks'].includes(notification.related_entity_type || '')
      || notification.related_entity_id === metadata.inquiry_id)) {
    return `/crm/inquiries/${metadata.inquiry_id}`;
  }
  if (notification.action_url) {
    return notification.action_url;
  }

  const entityType = notification.related_entity_type;
  const entityId = notification.related_entity_id;

  if (!entityId) {
    return null;
  }

  switch (entityType) {
    case 'offer':
      return `/crm/offers/${entityId}`;

    case 'event':
      return `/crm/events/${entityId}`;

    case 'meeting':
      return `/crm/meetings?meetingId=${entityId}`;

    case 'task':
      return `/crm/tasks/${entityId}`;

    case 'inquiry':
      return `/crm/inquiries/${entityId}`;

    case 'absence':
      return null;

    case 'client':
      return `/crm/clients/${entityId}`;

    case 'employee':
      return `/crm/employees/${entityId}`;

    case 'vehicle':
      return `/crm/fleet/vehicles/${entityId}`;

    case 'inbound_event':
      return `/crm/settings/webhooks`;

    default:
      return null;
  }
}

interface NotificationBanner {
  id: string;
  title: string;
  message: string;
  actionUrl: string | null;
  relatedEntityType: string | null;
}

// Responsive shells can briefly render more than one notification center.
// Keep one audio claim per notification for the current browser runtime.
const soundedNotificationIds = new Set<string>();

function claimNotificationSound(notificationId: string): boolean {
  if (soundedNotificationIds.has(notificationId)) return false;
  if (soundedNotificationIds.size >= 1000) {
    const oldest = soundedNotificationIds.values().next().value;
    if (oldest) soundedNotificationIds.delete(oldest);
  }
  soundedNotificationIds.add(notificationId);
  return true;
}

export interface Notification {
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
  recipient_created_at?: string | null;
  is_read: boolean;
  read_at: string | null;
}

export default function NotificationCenter({
  initialNotifications,
}: {
  initialNotifications: Notification[];
}) {
  const router = useRouter();
  const { isAdmin, sessionUserId } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(
    initialNotifications.filter((n) => !n.is_read).length,
  );
  const [showPanel, setShowPanel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [customSoundUrl, setCustomSoundUrl] = useState<string | null>(null);
  const soundEnabledRef = useRef(true);
  const customSoundUrlRef = useRef<string | null>(null);
  const soundSessionStartedAtRef = useRef(0);
  const realtimeReadyRef = useRef(false);
  const preferencesLoadedRef = useRef(false);
  const [absenceModalId, setAbsenceModalId] = useState<string | null>(null);
  const [banners, setBanners] = useState<NotificationBanner[]>([]);
  const bannerTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const refreshNotificationsRef = useRef<(() => Promise<void>) | null>(null);
  const notificationsRef = useRef(notifications);
  const announcedNotificationIdsRef = useRef(new Set<string>());

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  const showBanner = useCallback((notification: Notification) => {
    const actionUrl = getNotificationActionUrl(notification);

    const banner: NotificationBanner = {
      id: notification.id,
      title: notification.title,
      message: notification.message,
      actionUrl,
      relatedEntityType: notification.related_entity_type,
    };

    setBanners((prev) => {
      if (prev.some((item) => item.id === banner.id)) {
        return prev;
      }

      return [banner, ...prev].slice(0, 3);
    });

    if (bannerTimeoutsRef.current[banner.id]) {
      clearTimeout(bannerTimeoutsRef.current[banner.id]);
    }
    const timeout = setTimeout(() => {
      setBanners((prev) => prev.filter((item) => item.id !== banner.id));
      delete bannerTimeoutsRef.current[banner.id];
    }, 8000);

    bannerTimeoutsRef.current[banner.id] = timeout;
  }, []);

  const dismissBanner = useCallback((bannerId: string) => {
    setBanners((prev) => prev.filter((b) => b.id !== bannerId));
    if (bannerTimeoutsRef.current[bannerId]) {
      clearTimeout(bannerTimeoutsRef.current[bannerId]);
      delete bannerTimeoutsRef.current[bannerId];
    }
  }, []);

  useEffect(() => {
    setBanners([]);
    announcedNotificationIdsRef.current.clear();
    if (!sessionUserId) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    const controller = new AbortController();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshInFlight = false;
    let refreshAgain = false;
    const scheduleRefresh = () => {
      if (controller.signal.aborted || refreshTimer !== null) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refresh();
      }, 250);
    };
    const refresh = async () => {
      if (controller.signal.aborted) return;
      if (refreshInFlight) {
        refreshAgain = true;
        return;
      }
      refreshInFlight = true;
      try {
        await loadNotifications(controller.signal);
      } finally {
        refreshInFlight = false;
        if (refreshAgain) {
          refreshAgain = false;
          scheduleRefresh();
        }
      }
    };
    refreshNotificationsRef.current = refresh;

    soundSessionStartedAtRef.current = Date.now();
    realtimeReadyRef.current = false;
    preferencesLoadedRef.current = false;
    soundEnabledRef.current = true;
    customSoundUrlRef.current = null;
    setSoundEnabled(true);
    setCustomSoundUrl(null);
    void refresh();
    void loadUserPreferences(controller.signal);

    // More than one responsive shell can briefly mount during hydration or a
    // breakpoint change. Every effect instance needs its own Realtime topic;
    // otherwise Supabase may return an already subscribed channel.
    const channelSuffix = `${sessionUserId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const recipientsChannel = supabase
      .channel(`notification-recipients-changes-${channelSuffix}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notification_recipients',
          filter: `user_id=eq.${sessionUserId}`,
        },
        (payload) => {
          if (controller.signal.aborted) return;
          scheduleRefresh();
          const newRow = payload.new as any;
          void (async () => {
            if (!newRow?.notification_id || newRow?.is_read) return;

            const { data: notifData, error: notifError } = await supabase
              .from('notifications')
              .select(
                `
                  id,
                  title,
                  message,
                  type,
                  category,
                  action_url,
                  created_at,
                  metadata,
                  related_entity_type,
                  related_entity_id
                `,
              )
              .eq('id', newRow.notification_id)
              .maybeSingle()
              .abortSignal(controller.signal);

            if (controller.signal.aborted) return;

            if (notifError) {
              console.error('Błąd pobierania nowego powiadomienia:', notifError);
              return;
            }

            if (!notifData) return;

            announceNotification({
              ...notifData,
              recipient_id: newRow.id,
              recipient_created_at: newRow.created_at,
              is_read: false,
              read_at: null,
            } as Notification);
          })().catch((error) => {
            if (!controller.signal.aborted) console.error('Błąd odbierania powiadomienia:', error);
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notification_recipients',
          filter: `user_id=eq.${sessionUserId}`,
        },
        (payload) => {
          scheduleRefresh();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notification_recipients',
          filter: `user_id=eq.${sessionUserId}`,
        },
        (payload) => {
          scheduleRefresh();
        },
      )
      .subscribe((status) => {
        if (controller.signal.aborted) return;
        realtimeReadyRef.current = status === 'SUBSCRIBED';
        if (status === 'SUBSCRIBED') scheduleRefresh();
      });

    const notificationsChannel = supabase
      .channel(`notifications-changes-${channelSuffix}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
        },
        (payload) => {
          if (controller.signal.aborted) return;
          const updated = payload.new;
          if (!notificationsRef.current.some((notification) => notification.id === updated.id)) return;
          // Apply the delivered row locally, rather than refetching every recipient.
          setNotifications((current) => current.map((notification) =>
            notification.id === updated.id
              ? {
                  ...notification,
                  ...updated,
                  recipient_id: notification.recipient_id,
                  is_read: notification.is_read,
                  read_at: notification.read_at,
                }
              : notification,
          ));
          // An older list response may still be in flight: refresh once after it finishes.
          if (refreshInFlight) refreshAgain = true;
        },
      )
      .subscribe();

    // Realtime can miss events on reconnect or while the browser sleeps.
    // A visible tab catches up without requiring a page reload.
    const catchUp = () => { if (document.visibilityState === 'visible') scheduleRefresh(); };
    const catchUpTimer = window.setInterval(catchUp, 30000);
    window.addEventListener('focus', catchUp);
    window.addEventListener('online', catchUp);
    document.addEventListener('visibilitychange', catchUp);

    return () => {
      controller.abort();
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      window.clearInterval(catchUpTimer);
      window.removeEventListener('focus', catchUp);
      window.removeEventListener('online', catchUp);
      document.removeEventListener('visibilitychange', catchUp);
      if (refreshNotificationsRef.current === refresh) refreshNotificationsRef.current = null;
      Object.values(bannerTimeoutsRef.current).forEach(clearTimeout);
      bannerTimeoutsRef.current = {};
      realtimeReadyRef.current = false;
      void supabase.removeChannel(recipientsChannel).catch(() => {});
      void supabase.removeChannel(notificationsChannel).catch(() => {});
    };
  }, [sessionUserId, showBanner]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    customSoundUrlRef.current = customSoundUrl;
  }, [customSoundUrl]);

  const loadUserPreferences = async (signal: AbortSignal) => {
    try {
      if (!sessionUserId || signal.aborted) return;

      const { data, error } = await supabase
        .from('employees')
        .select('preferences')
        .or(`id.eq.${sessionUserId},auth_user_id.eq.${sessionUserId}`)
        .maybeSingle()
        .abortSignal(signal);

      if (signal.aborted) return;

      if (error) throw error;

      if (data?.preferences?.notifications?.soundEnabled !== undefined) {
        setSoundEnabled(data.preferences.notifications.soundEnabled);
      }
      if (data?.preferences?.notifications?.customSoundUrl) {
        setCustomSoundUrl(data.preferences.notifications.customSoundUrl);
      } else {
        setCustomSoundUrl(null);
      }
    } catch (error) {
      if (!signal.aborted) console.error('Error loading user preferences:', error);
    } finally {
      if (!signal.aborted) preferencesLoadedRef.current = true;
    }
  };

  const playNotificationSound = () => {
    try {
      if (customSoundUrlRef.current) {
        const audio = new Audio(customSoundUrlRef.current);
        audio.volume = 0.5;
        audio.play().catch(() => {});
        return;
      }

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
    await refreshNotificationsRef.current?.();
  };

  const announceNotification = (notification: Notification) => {
    const deliveredAt = Date.parse(notification.recipient_created_at || notification.created_at);
    if (notification.is_read || !Number.isFinite(deliveredAt)
      || deliveredAt < soundSessionStartedAtRef.current
      || document.visibilityState !== 'visible' || !document.hasFocus()
      || announcedNotificationIdsRef.current.has(notification.id)) return;
    // Both Realtime and catch-up reads pass here. A notice produces one banner,
    // not another banner or sound on every periodic refresh.
    announcedNotificationIdsRef.current.add(notification.id);
    if (preferencesLoadedRef.current && soundEnabledRef.current && claimNotificationSound(notification.id)) {
      playNotificationSound();
    }
    showBanner(notification);
  };

  const loadNotifications = async (signal: AbortSignal) => {
    try {
      if (!sessionUserId || signal.aborted) return;

      const { data, error } = await supabase
        .from('notification_recipients')
        .select(
          `
          id,
          is_read,
          read_at,
          created_at,
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
        .eq('user_id', sessionUserId)
        .order('created_at', { ascending: false })
        .abortSignal(signal);

      if (signal.aborted) return;

      if (error) throw error;

      if (data) {
        const formattedNotifications = data.filter((recipient: any) => recipient.notifications).map((recipient: any) => ({
          ...recipient.notifications,
          recipient_id: recipient.id,
          recipient_created_at: recipient.created_at,
          is_read: recipient.is_read,
          read_at: recipient.read_at,
        }));
        notificationsRef.current = formattedNotifications;
        setNotifications(formattedNotifications);
        setUnreadCount(formattedNotifications.filter((n: any) => !n.is_read).length);
        // Announce notices received since this session started, including ones
        // recovered after a dropped WebSocket message. Old history stays quiet.
        formattedNotifications.slice().reverse().forEach(announceNotification);
      }
    } catch (error) {
      if (!signal.aborted) console.error('Error fetching notifications:', error);
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
      void refreshSellerSidebarBadge();
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
      void refreshSellerSidebarBadge();
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
      void refreshSellerSidebarBadge();
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
      void refreshSellerSidebarBadge();
    } catch (error) {
      console.error('Error deleting all notifications:', error);
      showSnackbar('Błąd podczas usuwania powiadomień', 'error');
    } finally {
      setDeletingAll(false);
    }
  };

  const navigateToNotification = (actionUrl: string) => {
    const destination = new URL(actionUrl, window.location.origin);
    const sellerSection = destination.hash === '#seller-offer-review' || destination.hash === '#seller-offer-conversation';
    router.push(actionUrl, { scroll: !sellerSection });
    // Pushing the same URL does not remount the offer or trigger its effects.
    if (destination.origin === window.location.origin && destination.pathname === window.location.pathname && destination.hash) {
      window.requestAnimationFrame(() => {
        document.getElementById(destination.hash.slice(1))?.scrollIntoView({ block: 'start' });
      });
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) {
      // A slow read receipt must not delay opening the actual inquiry.
      void markAsRead(notification.recipient_id);
    }

    if (
      notification.category === 'absence_request' &&
      notification.related_entity_type === 'absence' &&
      notification.related_entity_id
    ) {
      setAbsenceModalId(notification.related_entity_id);
      setShowPanel(false);
      return;
    }

    const actionUrl = getNotificationActionUrl(notification);

    if (actionUrl) {
      setShowPanel(false);
      navigateToNotification(actionUrl);
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

    if (notification.category === 'webhook') {
      return <Webhook className="h-4 w-4" />;
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
    <>
      {/* Notification Banners */}
      <div className="fixed right-4 top-20 z-[200] flex flex-col gap-2 md:right-6">
        {banners.map((banner) => (
          <div
            key={banner.id}
            className="animate-slide-in-right flex w-80 cursor-pointer items-start gap-3 rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] p-4 shadow-2xl transition-all hover:border-[#d3bb73]/50"
            onClick={() => {
              if (banner.actionUrl) {
                navigateToNotification(banner.actionUrl);
              }
              dismissBanner(banner.id);
            }}
          >
            <div className="flex-shrink-0 rounded-full bg-[#d3bb73]/20 p-2">
            {getBannerIcon(banner.relatedEntityType)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#e5e4e2]">{banner.title}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-[#e5e4e2]/70">{banner.message}</p>
              {banner.actionUrl && (
                <p className="mt-1 text-xs text-[#d3bb73]">Kliknij, aby zobaczyć szczegóły</p>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                dismissBanner(banner.id);
              }}
              className="flex-shrink-0 rounded p-0.5 text-[#e5e4e2]/50 hover:text-[#e5e4e2]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="relative">
        <button
          onClick={() => { if (!showPanel) void fetchNotifications(); setShowPanel(!showPanel); }}
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
                          const actionUrl = getNotificationActionUrl(notification);

                          if (
                            actionUrl ||
                            (notification.category === 'absence_request' &&
                              notification.related_entity_type === 'absence')
                          ) {
                            handleNotificationClick(notification);
                          }
                        }}
                        className={`p-4 transition-colors hover:bg-[#0f1119]/50 ${
                          getNotificationActionUrl(notification) ||
                          (notification.category === 'absence_request' &&
                            notification.related_entity_type === 'absence')
                            ? 'cursor-pointer'
                            : ''
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
                                {systemNotificationText(notification.title)}
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
                              {systemNotificationText(notification.message)}
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
                              {NOTIFICATION_CATEGORY_LABELS[notification.category] || notification.category}
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
                              {getNotificationActionUrl(notification) && (
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

        {/* Absence Request Modal */}
        {absenceModalId && (
          <AbsenceRequestModal
            absenceId={absenceModalId}
            onClose={() => setAbsenceModalId(null)}
            onSuccess={() => {
              fetchNotifications();
            }}
          />
        )}
      </div>
    </>
  );
}
