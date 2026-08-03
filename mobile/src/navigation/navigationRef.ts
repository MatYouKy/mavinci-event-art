import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<any>();

export type NotificationTargetData = {
  type?: string;
  conversation_id?: string;
  task_id?: string;
  entity_type?: string;
  entity_id?: string;
  category?: string;
  action_url?: string;
  meetingId?: string;
};

export function navigateToChat(conversationId: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Main', { screen: 'Messages', params: { conversationId } });
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

export function navigateToEvent(eventId: string) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Main', {
      screen: 'Events',
      params: { screen: 'EventDetail', params: { eventId } },
    });
  }
}

export function navigateToMessagesTab() {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Main', { screen: 'Messages' });
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
export function routeNotification(d: NotificationTargetData): { meetingId: string | null } {
  if (isMeetingTarget(d)) {
    return { meetingId: d.meetingId || d.entity_id || null };
  }

  if (d.type === 'chat_message' && d.conversation_id) {
    navigateToChat(d.conversation_id);
    return { meetingId: null };
  }

  const url = d.action_url ?? '';

  if (isInquiryTarget(d)) {
    const id = d.entity_id || d.task_id;
    if (id) navigateToInquiry(id);
    return { meetingId: null };
  }

  if (
    d.type === 'task' ||
    d.entity_type === 'task' ||
    d.category === 'tasks' ||
    url.includes('/crm/tasks/')
  ) {
    const id = d.task_id || d.entity_id;
    if (id) navigateToTask(id);
    return { meetingId: null };
  }

  if (
    d.entity_type === 'event' ||
    d.category === 'events' ||
    d.category === 'team' ||
    url.includes('/crm/events/')
  ) {
    if (d.entity_id) navigateToEvent(d.entity_id);
    return { meetingId: null };
  }

  if (d.category === 'messages' || d.category === 'contact_form' || url.includes('/crm/messages')) {
    navigateToMessagesTab();
    return { meetingId: null };
  }

  return { meetingId: null };
}
