import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

// Android notification channel setup (must run early, before any notification arrives)
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
    console.log('[Push] Device.isDevice:', Device.isDevice);
    console.log(
      '[Push] executionEnvironment:',
      Constants.executionEnvironment
    );

    if (!Device.isDevice) {
      console.warn('[Push] Physical device required');
      return null;
    }

    if (isRunningInExpoGo()) {
      console.warn('[Push] Running in Expo Go — remote push unavailable');
      return null;
    }

    const projectId = getExpoProjectId();

    console.log('[Push] projectId:', projectId);

    if (!projectId) {
      console.warn('[Push] Missing EAS projectId');
      return null;
    }

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();

    console.log('[Push] Existing permission:', existingStatus);

    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const permissionResult =
        await Notifications.requestPermissionsAsync();

      finalStatus = permissionResult.status;
    }

    console.log('[Push] Final permission:', finalStatus);

    if (finalStatus !== 'granted') {
      console.warn('[Push] Permission not granted');
      return null;
    }

    console.log('[Push] Requesting Expo push token');

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    const pushToken = tokenData.data;

    console.log('[Push] Token received:', pushToken);

    const saved = await savePushToken(employeeId, pushToken);

    if (!saved) {
      return null;
    }

    console.log('[Push] Token saved in Supabase');

    return pushToken;
  } catch (error) {
    console.error('[Push] Registration error:', error);
    return null;
  }
}

async function savePushToken(
  employeeId: string,
  token: string
): Promise<boolean> {
  console.log('[Push] Saving token for employee:', employeeId);

  const { data, error } = await supabase
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
    )
    .select();

  if (error) {
    console.error('[Push] Token database error:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });

    return false;
  }

  console.log('[Push] Token database result:', data);
  return true;
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