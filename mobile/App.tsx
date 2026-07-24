import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { Provider } from 'react-redux';

import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import { store } from './src/store/store';

import {
  registerForPushNotifications,
  addNotificationResponseListener,
  addNotificationReceivedListener,
} from './src/services/pushNotifications';

import { useRealtimePushNotifications } from './src/services/realtimeNotifications';
import { useChatNotifications, setupChatNotificationFilter } from './src/services/chatNotifications';
import { scheduleInquiryReminders } from './src/services/inquiryReminders';

// Must be called before app renders to handle incoming remote push while app is foregrounded
setupChatNotificationFilter();

// Global notification target for deep-linking from notification tap
export let globalNotificationTarget: {
  type: string;
  conversation_id?: string;
  task_id?: string;
  entity_type?: string;
  entity_id?: string;
  category?: string;
  meetingId?: string;
} | null = null;

export function consumeNotificationTarget() {
  const target = globalNotificationTarget;
  globalNotificationTarget = null;
  return target;
}

function AppContent() {
  const { employee } = useAuth();
  const employeeId = employee?.id;

  useRealtimePushNotifications(employeeId);
  useChatNotifications(employeeId);

  useEffect(() => {
    if (!employeeId) {
      return;
    }

    let isMounted = true;

    const initializePushNotifications = async () => {
      try {
        console.log('[Push] Starting registration for employee:', employeeId);

        const token = await registerForPushNotifications(employeeId);

        if (!isMounted) return;

        if (token) {
          console.log('[Push] Registration successful:', token);
        } else {
          console.warn(
            '[Push] Registration returned no token. Check Expo Go, projectId, permissions and database errors.',
          );
        }
      } catch (error) {
        console.error('[Push] Registration failed:', error);
      }
    };

    void initializePushNotifications();
    void scheduleInquiryReminders();

    const notificationSubscription = addNotificationReceivedListener((notification) => {
      console.log('Notification received:', notification.request.content);
    });

    const responseSubscription = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data;

      if (data?.type === 'chat_message' && data?.conversation_id) {
        console.log('[Push] Open chat conversation:', data.conversation_id);
        globalNotificationTarget = {
          type: 'chat_message',
          conversation_id: data.conversation_id as string,
        };
      } else if (data?.type === 'task' && data?.task_id) {
        console.log('[Push] Open task:', data.task_id);
        globalNotificationTarget = {
          type: 'task',
          task_id: data.task_id as string,
        };
      } else if (data?.type === 'crm_notification') {
        console.log('[Push] CRM notification tapped:', data.entity_type, data.entity_id);
        globalNotificationTarget = {
          type: 'crm_notification',
          entity_type: data.entity_type as string | undefined,
          entity_id: data.entity_id as string | undefined,
          category: data.category as string | undefined,
        };
      } else if (data?.type === 'meeting_reminder' && data?.meetingId) {
        console.log('[Push] Meeting reminder tapped:', data.meetingId);
        globalNotificationTarget = {
          type: 'meeting_reminder',
          meetingId: data.meetingId as string,
        };
      } else if (data?.type === 'inquiry_reminder') {
        globalNotificationTarget = {
          type: 'inquiry_reminder',
        };
      }
    });

    return () => {
      isMounted = false;
      notificationSubscription.remove();
      responseSubscription.remove();
    };
  }, [employeeId]);

  return <RootNavigator />;
}

export default function App() {
  return (
    <Provider store={store}>
      <AuthProvider>
        <StatusBar style="light" />
        <AppContent />
      </AuthProvider>
    </Provider>
  );
}
