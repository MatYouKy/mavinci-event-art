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
import { useChatNotifications } from './src/services/chatNotifications';

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
        const token = await registerForPushNotifications(employeeId);

        if (isMounted && token) {
          console.log('Push notifications registered');
        }
      } catch (error) {
        console.error('Push registration error:', error);
      }
    };

    void initializePushNotifications();

    const notificationSubscription =
      addNotificationReceivedListener((notification) => {
        console.log(
          'Notification received:',
          notification.request.content
        );
      });

    const responseSubscription =
      addNotificationResponseListener((response) => {
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