import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/browser';

interface FormTrackingOptions {
  formName: string;
  enabled?: boolean;
}

export function useFormTracking({ formName, enabled = true }: FormTrackingOptions) {
  const sessionIdRef = useRef<string>('');
  const startTimeRef = useRef<number>(0);
  const fieldsFilledRef = useRef<string[]>([]);
  const formStartedRef = useRef<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !enabled) return;

    let sessionId = sessionStorage.getItem('analytics_session_id');
    if (!sessionId) {
      sessionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
      sessionStorage.setItem('analytics_session_id', sessionId);
    }
    sessionIdRef.current = sessionId;
  }, [enabled]);

  const trackFormStart = async () => {
    if (!enabled || formStartedRef.current) return;

    formStartedRef.current = true;
    startTimeRef.current = Date.now();

    try {
      await supabase.from('form_interactions').insert({
        session_id: sessionIdRef.current,
        form_name: formName,
        page_url: window.location.pathname,
        status: 'started',
        fields_filled: {},
      });
    } catch (error) {
      console.error('Form tracking error:', error);
    }
  };

  const trackFieldFilled = (fieldName: string) => {
    if (!fieldsFilledRef.current.includes(fieldName)) {
      fieldsFilledRef.current.push(fieldName);
    }
  };

  const trackFormComplete = async (values?: Record<string, any>) => {
    if (!enabled || !formStartedRef.current) return;

    const timeToComplete = Math.floor((Date.now() - startTimeRef.current) / 1000);

    try {
      await supabase.from('form_interactions').insert({
        session_id: sessionIdRef.current,
        form_name: formName,
        page_url: window.location.pathname,
        status: 'completed',
        fields_filled: fieldsFilledRef.current.reduce(
          (acc, field) => {
            acc[field] = true;
            return acc;
          },
          {} as Record<string, boolean>,
        ),
        time_to_complete: timeToComplete,
      });
    } catch (error) {
      console.error('Form tracking error:', error);
    }
  };

  const trackFormAbandoned = async () => {
    if (!enabled || !formStartedRef.current) return;

    const timeSpent = Math.floor((Date.now() - startTimeRef.current) / 1000);

    try {
      await supabase.from('form_interactions').insert({
        session_id: sessionIdRef.current,
        form_name: formName,
        page_url: window.location.pathname,
        status: 'abandoned',
        fields_filled: fieldsFilledRef.current.reduce(
          (acc, field) => {
            acc[field] = true;
            return acc;
          },
          {} as Record<string, boolean>,
        ),
        time_to_complete: timeSpent,
      });
    } catch (error) {
      console.error('Form tracking error:', error);
    }
  };

  return {
    trackFormStart,
    trackFieldFilled,
    trackFormComplete,
    trackFormAbandoned,
  };
}
