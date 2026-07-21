import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(employeeId: string): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('Push notification permission not granted');
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Mavinci CRM',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#d3bb73',
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: projectId ?? undefined,
  });

  const pushToken = tokenData.data;

  await savePushToken(employeeId, pushToken);

  return pushToken;
}

async function savePushToken(employeeId: string, token: string) {
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
      { onConflict: 'employee_id,token' }
    );

  if (error) {
    console.error('Error saving push token:', error);
  }
}

export async function removePushToken(employeeId: string) {
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    await supabase
      .from('push_tokens')
      .delete()
      .eq('employee_id', employeeId)
      .eq('token', tokenData.data);
  } catch (e) {
    console.error('Error removing push token:', e);
  }
}

export function addNotificationResponseListener(
  handler: (response: Notifications.NotificationResponse) => void
) {
  return Notifications.addNotificationResponseReceivedListener(handler);
}

export function addNotificationReceivedListener(
  handler: (notification: Notifications.Notification) => void
) {
  return Notifications.addNotificationReceivedListener(handler);
}
