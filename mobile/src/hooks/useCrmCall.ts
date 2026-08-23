import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export type CrmCallTarget = {
  phoneNumber: string;
  displayName: string;
  contactId?: string | null;
  organizationId?: string | null;
  inquiryId?: string | null;
  eventId?: string | null;
};

export type PendingCrmCall = CrmCallTarget & { activityId: string };

export function useCrmCall() {
  const { employee } = useAuth();
  const [pendingCall, setPendingCall] = useState<PendingCrmCall | null>(null);
  const [showOutcome, setShowOutcome] = useState(false);
  const pendingCallRef = useRef<PendingCrmCall | null>(null);
  const sawBackground = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (!pendingCallRef.current) return;
      if (state === 'inactive' || state === 'background') sawBackground.current = true;
      if (state === 'active' && sawBackground.current) {
        sawBackground.current = false;
        setShowOutcome(true);
      }
    });
    return () => subscription.remove();
  }, []);

  const startCall = useCallback(async (target: CrmCallTarget) => {
    const phoneNumber = target.phoneNumber.trim();
    if (!employee?.id || !phoneNumber) return;

    const { data, error } = await supabase.from('crm_call_activities').insert({
      phone_number: phoneNumber,
      direction: 'outgoing',
      status: 'initiated',
      contact_id: target.contactId || null,
      organization_id: target.organizationId || null,
      inquiry_id: target.inquiryId || null,
      event_id: target.eventId || null,
      created_by: employee.id,
      metadata: { display_name: target.displayName, source: 'mobile' },
    }).select('id').single();

    if (error || !data) {
      Alert.alert('Nie udało się rozpocząć połączenia', error?.message || 'Spróbuj ponownie.');
      return;
    }

    const activeCall = { ...target, phoneNumber, activityId: data.id };
    pendingCallRef.current = activeCall;
    setPendingCall(activeCall);
    try {
      await Linking.openURL(`tel:${phoneNumber.replace(/[^+\d]/g, '')}`);
    } catch (linkError) {
      await supabase.from('crm_call_activities').update({
        status: 'cancelled',
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', data.id);
      pendingCallRef.current = null;
      setPendingCall(null);
      Alert.alert('Nie można otworzyć telefonu', 'Sprawdź numer i spróbuj ponownie.');
    }
  }, [employee?.id]);

  const closeOutcome = useCallback(() => {
    setShowOutcome(false);
    pendingCallRef.current = null;
    setPendingCall(null);
  }, []);

  return { startCall, pendingCall, showOutcome, closeOutcome };
}
