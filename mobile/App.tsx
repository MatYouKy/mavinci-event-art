import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Provider } from 'react-redux';
import { ActivityIndicator, View } from 'react-native';

import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import { store } from './src/store/store';

import {
  registerForPushNotifications,
  addNotificationResponseListener,
  addNotificationReceivedListener,
  handleEventInvitationNotificationAction,
  handleInquiryFollowupNotificationAction,
} from './src/services/pushNotifications';

import { useRealtimePushNotifications } from './src/services/realtimeNotifications';
import { useChatNotifications, setupChatNotificationFilter } from './src/services/chatNotifications';
import { NotificationTargetData } from './src/navigation/navigationRef';
import { syncCrmContactsIfEnabled } from './src/services/crmContactSync';
import { canView } from './src/lib/permissions';
import { colors } from './src/theme';

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
    if (canView(employee, 'contacts')) {
      void syncCrmContactsIfEnabled().catch((error) => {
        console.warn('[Contacts] Background CRM sync failed:', error);
      });
    }
    const notificationSubscription = addNotificationReceivedListener((notification) => {
      console.log('Notification received:', notification.request.content);
    });

    const responseSubscription = addNotificationResponseListener((response) => {
      void handleEventInvitationNotificationAction(response, employeeId).then((handled) => {
        if (handled) return;
        void handleInquiryFollowupNotificationAction(response, employeeId).then((inquiryHandled) => {
          if (inquiryHandled) return;
          const data = response.notification.request.content.data as NotificationTargetData;
          // Store the tapped notification so MainTabNavigator can open the right screen,
          // even if navigation is not ready yet (cold start). Live taps are also handled
          // by MainTabNavigator's own response listener.
          globalNotificationTarget = { ...(data ?? {}) };
        });
      });
    });

    return () => {
      isMounted = false;
      notificationSubscription.remove();
      responseSubscription.remove();
    };
  }, [employee, employeeId]);

  return <RootNavigator />;
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    MBFAtom: require('./src/assets/fonts/mbf-atom-v5.ttf'),
  });

  useEffect(() => {
    if (fontError) console.warn('[Fonts] Nie udało się załadować MBF Atom:', fontError);
  }, [fontError]);

  if (!fontsLoaded && !fontError) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.primary }}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={colors.primary.gold} />
      </View>
    );
  }

  return (
    <Provider store={store}>
      <AuthProvider>
        <StatusBar style="light" />
        <AppContent />
      </AuthProvider>
    </Provider>
  );
}
