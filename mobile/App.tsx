import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Provider } from 'react-redux';
import { ActivityIndicator, View } from 'react-native';

import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { store } from './src/store/store';
import { appPalette, loadAppTheme, syncAppTheme } from './src/theme/appTheme';

import {
  registerForPushNotifications,
  addNotificationResponseListener,
  addNotificationReceivedListener,
  handleEventInvitationNotificationAction,
  handleInquiryFollowupNotificationAction,
} from './src/services/pushNotifications';

import { useMeetingReminderCleanup } from './src/services/meetingReminders';
import { useRealtimePushNotifications } from './src/services/realtimeNotifications';
import { useChatNotifications, setupChatNotificationFilter } from './src/services/chatNotifications';
import { NotificationTargetData } from './src/navigation/navigationRef';
import { removeSyncedCrmContactsIfEnabled, syncCrmContactsIfEnabled } from './src/services/crmContactSync';
import { useOtaUpdates } from './src/services/appUpdates';
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

/**
 * Ekrany wczytują się dopiero po ustawieniu motywu (`loadAppTheme`) — ich style powstają przy pierwszym wczytaniu,
 * więc od razu mają kolory motywu CRM pracownika.
 */
let rootNavigator: React.ComponentType | null = null;
function loadRootNavigator(): React.ComponentType {
  if (!rootNavigator) rootNavigator = require('./src/navigation/RootNavigator').default as React.ComponentType;
  return rootNavigator;
}

function AppContent() {
  const { employee } = useAuth();
  const employeeId = employee?.id;
  const RootNavigator = loadRootNavigator();

  // Motyw jak w CRM i na Macu (`employees.crm_theme`): inny niż na urządzeniu — zapis i ponowne uruchomienie.
  useEffect(() => {
    if (employee) void syncAppTheme(employee.crm_theme);
  }, [employee]);

  useOtaUpdates();
  useRealtimePushNotifications(employeeId);
  useMeetingReminderCleanup(employeeId);
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
    } else {
      // Bez dostępu do kontaktów CRM (np. po zmianie uprawnień) kontakty zsynchronizowane wcześniej znikają z telefonu.
      void removeSyncedCrmContactsIfEnabled().catch((error) => {
        console.warn('[Contacts] Removing synced CRM contacts failed:', error);
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
  const [themeReady, setThemeReady] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    MBFAtom: require('./src/assets/fonts/mbf-atom-v5.ttf'),
  });

  useEffect(() => {
    if (fontError) console.warn('[Fonts] Nie udało się załadować MBF Atom:', fontError);
  }, [fontError]);

  useEffect(() => {
    let active = true;
    void loadAppTheme().finally(() => { if (active) setThemeReady(true); });
    return () => { active = false; };
  }, []);

  const statusBar = appPalette().scheme === 'light' ? 'dark' : 'light';

  if (!themeReady || (!fontsLoaded && !fontError)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.primary }}>
        <StatusBar style={statusBar} />
        <ActivityIndicator size="large" color={colors.primary.gold} />
      </View>
    );
  }

  return (
    <Provider store={store}>
      <AuthProvider>
        <StatusBar style={statusBar} />
        <AppContent />
      </AuthProvider>
    </Provider>
  );
}
