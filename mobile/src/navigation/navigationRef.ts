import { createNavigationContainerRef } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

export const navigationRef = createNavigationContainerRef<any>();

export type NotificationTargetData = {
  type?: string;
  conversation_id?: string;
  task_id?: string;
  entity_type?: string;
  entity_id?: string;
  category?: string;
  action_url?: string;
  inbound_event_id?: string;
  notification_id?: string;
  meetingId?: string;
  initial_tab?: string;
  assignment_id?: string;
  event_id?: string;
  requires_response?: string;
  inquiry_id?: string;
  followup_kind?: string;
};

export function navigateToChat(conversationId: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Main', {
      screen: 'Messages',
      params: { conversationId, chatRequestId: Date.now() },
    });
  }
}

export function navigateToTask(taskId: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Main', {
      screen: 'Tasks',
      params: { screen: 'TaskDetail', params: { taskId } },
    });
  }
}

export function navigateToInquiry(taskId: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Main', {
      screen: 'Inquiries',
      params: { screen: 'InquiryDetail', params: { taskId } },
    });
  }
}

export function navigateToEvent(eventId: string, initialTab?: 'fleet' | 'team') {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Main', {
      screen: 'Events',
      params: { screen: 'EventDetail', params: { eventId, initialTab } },
    });
  }
}

export function navigateToMessagesTab() {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Main', { screen: 'Messages' });
  }
}

export function navigateToInbox() {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Main', { screen: 'Inbox' });
  }
}

export function navigateToClients() {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Main', { screen: 'Clients' });
  }
}

export function navigateToNotifications() {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Notifications');
  }
}

export function navigateToEmailMessage(messageId: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('EmailMessageDetail', { messageId });
  }
}

export function navigateToInboundEvent(eventId: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('InboundEventDetail', { eventId });
  }
}

export function navigateToContactMessage(messageId: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('ContactMessageDetail', { messageId });
  }
}

export function navigateToCalendarTab() {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Main', { screen: 'Calendar' });
  }
}

function isMeetingTarget(d: NotificationTargetData): boolean {
  const url = d.action_url ?? '';
  return (
    d.type === 'meeting_reminder' ||
    d.entity_type === 'meeting' ||
    d.category === 'meetings' ||
    d.category === 'meeting' ||
    d.category === 'calendar' ||
    url.includes('/calendar/meeting') ||
    url.includes('/meetings')
  );
}

function isInquiryTarget(d: NotificationTargetData): boolean {
  const url = d.action_url ?? '';
  return (
    d.type === 'inquiry' ||
    d.type === 'inquiry_reminder' ||
    d.entity_type === 'inquiry' ||
    d.category === 'inquiries' ||
    d.category === 'inquiry' ||
    url.includes('/inquir')
  );
}

/**
 * Central router for a tapped notification. Opens the specific detail screen for
 * chat / task / inquiry / event / messages. Meetings need the Calendar tab's local
 * state, so this returns the meetingId and lets MainTabNavigator open it.
 */
export async function routeNotification(
  d: NotificationTargetData,
): Promise<{ meetingId: string | null }> {
  let target = d;

  // Older webhook banners did not contain inbound_event_id. Resolve it from the
  // stored CRM notification so an already delivered banner can still open details.
  if (d.notification_id && !d.inbound_event_id && !d.entity_id) {
    const { data: notification } = await supabase
      .from('notifications')
      .select('category, related_entity_type, related_entity_id, action_url, metadata')
      .eq('id', d.notification_id)
      .maybeSingle();

    if (notification) {
      const metadata = notification.metadata as Record<string, unknown> | null;
      target = {
        ...d,
        category: d.category || notification.category || undefined,
        entity_type: d.entity_type || notification.related_entity_type || undefined,
        entity_id: d.entity_id || notification.related_entity_id || undefined,
        action_url: d.action_url || notification.action_url || undefined,
        inbound_event_id:
          d.inbound_event_id ||
          (typeof metadata?.inbound_event_id === 'string' ? metadata.inbound_event_id : undefined),
      };
    }
  }

  if (isMeetingTarget(target)) {
    return { meetingId: target.meetingId || target.entity_id || null };
  }

  if (target.type === 'chat_message' && target.conversation_id) {
    navigateToChat(target.conversation_id);
    return { meetingId: null };
  }

  const url = target.action_url ?? '';

  // The explicit message type in the URL is more reliable for legacy
  // notifications whose related_entity_type was saved incorrectly.
  const receivedEmailUrlMatch = url.match(
    /\/crm\/messages\/([0-9a-f-]{36})\?[^#]*type=received(?:&|$)/i,
  );
  if (receivedEmailUrlMatch?.[1]) {
    navigateToEmailMessage(receivedEmailUrlMatch[1]);
    return { meetingId: null };
  }

  const contactUrlMatch = url.match(
    /\/crm\/messages\/([0-9a-f-]{36})\?[^#]*type=contact_form(?:&|$)/i,
  );
  if (contactUrlMatch?.[1]) {
    navigateToContactMessage(contactUrlMatch[1]);
    return { meetingId: null };
  }

  if (target.inbound_event_id) {
    navigateToInboundEvent(target.inbound_event_id);
    return { meetingId: null };
  }

  if (target.entity_type === 'contact_messages' && target.entity_id) {
    navigateToContactMessage(target.entity_id);
    return { meetingId: null };
  }

  if (target.entity_type === 'received_email' && target.entity_id) {
    navigateToEmailMessage(target.entity_id);
    return { meetingId: null };
  }

  const emailUrlMatch = url.match(/\/crm\/messages\/([0-9a-f-]{36})/i);
  if (emailUrlMatch?.[1]) {
    navigateToEmailMessage(emailUrlMatch[1]);
    return { meetingId: null };
  }

  if (isInquiryTarget(target)) {
    const id = target.inquiry_id || target.entity_id || target.task_id;
    if (id) navigateToInquiry(id);
    return { meetingId: null };
  }

  if (
    target.type === 'task' ||
    target.type === 'task_assignment' ||
    target.entity_type === 'task' ||
    target.category === 'tasks' ||
    url.includes('/crm/tasks/')
  ) {
    const id = target.task_id || target.entity_id;
    if (id) navigateToTask(id);
    return { meetingId: null };
  }

  if (
    target.entity_type === 'event' ||
    target.category === 'events' ||
    target.category === 'team' ||
    url.includes('/crm/events/')
  ) {
    if (target.entity_id) {
      navigateToEvent(target.entity_id, target.initial_tab === 'fleet' ? 'fleet' : undefined);
    }
    return { meetingId: null };
  }

  if (target.entity_type === 'vehicle' || url.includes('/crm/fleet/')) {
    navigateToNotifications();
    return { meetingId: null };
  }

  if (url.includes('/crm/contacts')) {
    navigateToClients();
    return { meetingId: null };
  }

  if (
    target.category === 'messages' ||
    target.category === 'contact_form' ||
    url.includes('/crm/messages')
  ) {
    navigateToInbox();
    return { meetingId: null };
  }

  return { meetingId: null };
}
