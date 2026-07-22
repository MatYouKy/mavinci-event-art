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

// Must be called before app renders to handle incoming remote push while app is foregrounded
setupChatNotificationFilter();

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

    const notificationSubscription = addNotificationReceivedListener((notification) => {
      console.log('Notification received:', notification.request.content);
    });

    const responseSubscription = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data;

      if (data?.type === 'task' && data?.task_id) {
        console.log('Open task:', data.task_id);

        /*
         * Tutaj później dodamy nawigację przez navigationRef:
         *
         * navigationRef.navigate('TaskDetails', {
         *   taskId: data.task_id,
         * });
         */
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
