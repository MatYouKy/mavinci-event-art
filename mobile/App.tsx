import React, { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
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

function AppContent() {
  const { employee } = useAuth();
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);

  useRealtimePushNotifications(employee?.id);

  useEffect(() => {
    if (!employee?.id) return;

    registerForPushNotifications(employee.id).catch((err) =>
      console.error('Push registration error:', err)
    );

    notificationListener.current = addNotificationReceivedListener((notification) => {
      // Notification received while app is in foreground
    });

    responseListener.current = addNotificationResponseListener((response) => {
      const data = response.notification.request.content.data;
      // Handle navigation based on notification data
      if (data?.type === 'task' && data?.task_id) {
        // Navigate to task - handled by navigation ref
      }
    });

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, [employee?.id]);

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
