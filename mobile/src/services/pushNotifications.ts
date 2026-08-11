import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

export const EVENT_INVITATION_CATEGORY = 'event_invitation';
export const EVENT_INVITATION_ACCEPT_ACTION = 'event_invitation_accept';
export const EVENT_INVITATION_REJECT_ACTION = 'event_invitation_reject';
export const EVENT_INVITATION_DETAILS_ACTION = 'event_invitation_details';

const handledInvitationResponses = new Set<string>();

void Notifications.setNotificationCategoryAsync(EVENT_INVITATION_CATEGORY, [
  {
    identifier: EVENT_INVITATION_ACCEPT_ACTION,
    buttonTitle: 'Akceptuj',
    options: { opensAppToForeground: true },
  },
  {
    identifier: EVENT_INVITATION_REJECT_ACTION,
    buttonTitle: 'Odrzuć',
    options: { opensAppToForeground: true, isDestructive: true },
  },
  {
    identifier: EVENT_INVITATION_DETAILS_ACTION,
    buttonTitle: 'Szczegóły',
    options: { opensAppToForeground: true },
  },
]).catch((error) => {
  console.error('[Push] Event invitation category setup failed:', error);
});

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

export async function handleEventInvitationNotificationAction(
  response: Notifications.NotificationResponse,
  employeeId: string | undefined,
): Promise<boolean> {
  const action = response.actionIdentifier;
  if (
    action !== EVENT_INVITATION_ACCEPT_ACTION &&
    action !== EVENT_INVITATION_REJECT_ACTION
  ) {
    return false;
  }

  const data = response.notification.request.content.data as {
    assignment_id?: string;
    notification_id?: string;
  };
  const assignmentId = data?.assignment_id;

  if (!assignmentId || !employeeId) {
    console.warn('[Push] Invitation action ignored: missing assignment or employee id.');
    return true;
  }

  const responseKey = `${response.notification.request.identifier}:${action}`;
  if (handledInvitationResponses.has(responseKey)) return true;
  handledInvitationResponses.add(responseKey);

  const status =
    action === EVENT_INVITATION_ACCEPT_ACTION ? 'accepted' : 'rejected';

  const { error } = await supabase
    .from('employee_assignments')
    .update({
      status,
      responded_at: new Date().toISOString(),
    })
    .eq('id', assignmentId)
    .eq('employee_id', employeeId)
    .eq('status', 'pending');

  if (error) {
    handledInvitationResponses.delete(responseKey);
    console.error('[Push] Event invitation response failed:', error);
    return true;
  }

  if (data.notification_id) {
    await supabase
      .from('notification_recipients')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('notification_id', data.notification_id)
      .eq('user_id', employeeId);
  }

  return true;
}
