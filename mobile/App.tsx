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
import { NotificationTargetData } from './src/navigation/navigationRef';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Global notification target for deep-linking from a notification tap (cold start fallback)
export let globalNotificationTarget: NotificationTargetData | null = null;

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
      const data = response.notification.request.content.data as NotificationTargetData;
      // Store the tapped notification so MainTabNavigator can open the right screen,
      // even if navigation is not ready yet (cold start). Live taps are also handled
      // by MainTabNavigator's own response listener.
      globalNotificationTarget = { ...(data ?? {}) };
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
