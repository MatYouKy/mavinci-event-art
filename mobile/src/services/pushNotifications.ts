import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'Mavinci CRM',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#d3bb73',
    sound: 'default',
  });
}

function getExpoProjectId(): string | null {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null
  );
}

function isRunningInExpoGo(): boolean {
  return (
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  );
}

export async function registerForPushNotifications(
  employeeId: string
): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      console.warn('Push notifications require a physical device');
      return null;
    }

    /*
     * Expo Go nie obsługuje w pełni zdalnych powiadomień push.
     * Token rejestrujemy dopiero w development buildzie lub produkcji.
     */
    if (isRunningInExpoGo()) {
      console.warn(
        'Push token registration skipped in Expo Go. Use a development build.'
      );
      return null;
    }

    const projectId = getExpoProjectId();

    if (!projectId) {
      console.warn(
        'Push registration skipped: missing Expo EAS projectId in app config.'
      );
      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Mavinci CRM',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#d3bb73',
        sound: 'default',
      });
    }

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();

    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const permissionResult =
        await Notifications.requestPermissionsAsync();

      finalStatus = permissionResult.status;
    }

    if (finalStatus !== 'granted') {
      console.warn('Push notification permission not granted');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    const pushToken = tokenData.data;

    await savePushToken(employeeId, pushToken);

    return pushToken;
  } catch (error) {
    console.error('Push registration error:', error);
    return null;
  }
}

async function savePushToken(
  employeeId: string,
  token: string
): Promise<void> {
  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      {
        employee_id: employeeId,
        token,
        platform: Platform.OS,
        device_name: Device.deviceName ?? 'Unknown',
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'employee_id,token',
      }
    );

  if (error) {
    console.error('Error saving push token:', error);
  }
}

export async function removePushToken(
  employeeId: string
): Promise<void> {
  try {
    if (isRunningInExpoGo()) {
      return;
    }

    const projectId = getExpoProjectId();

    if (!projectId) {
      console.warn(
        'Push token removal skipped: missing Expo EAS projectId.'
      );
      return;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    const { error } = await supabase
      .from('push_tokens')
      .delete()
      .eq('employee_id', employeeId)
      .eq('token', tokenData.data);

    if (error) {
      console.error('Error removing push token:', error);
    }
  } catch (error) {
    console.error('Error removing push token:', error);
  }
}

export function addNotificationResponseListener(
  handler: (
    response: Notifications.NotificationResponse
  ) => void
) {
  return Notifications.addNotificationResponseReceivedListener(handler);
}

export function addNotificationReceivedListener(
  handler: (notification: Notifications.Notification) => void
) {
  return Notifications.addNotificationReceivedListener(handler);
}