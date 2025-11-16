import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export function useActiveSession(pageUrl: string) {
  const sessionIdRef = useRef<string>('');
  const heartbeatIntervalRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (typeof window === 'undefined' || !pageUrl) return;

    let sessionId = sessionStorage.getItem('analytics_session_id');
    if (!sessionId) {
      sessionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
      sessionStorage.setItem('analytics_session_id', sessionId);
    }
    sessionIdRef.current = sessionId;

    const userAgent = navigator.userAgent;

    const registerSession = async () => {
      try {
        await supabase.from('active_sessions').upsert({
          session_id: sessionId,
          page_url: pageUrl,
          user_agent: userAgent,
          last_heartbeat: new Date().toISOString(),
        }, {
          onConflict: 'session_id'
        });
      } catch (error) {
        console.error('Failed to register session:', error);
      }
    };

    const sendHeartbeat = async () => {
      try {
        await supabase
          .from('active_sessions')
          .update({
            last_heartbeat: new Date().toISOString(),
            page_url: pageUrl
          })
          .eq('session_id', sessionIdRef.current);
      } catch (error) {
        console.error('Failed to send heartbeat:', error);
      }
    };

    const removeSession = async () => {
      try {
        await supabase
          .from('active_sessions')
          .delete()
          .eq('session_id', sessionIdRef.current);
      } catch (error) {
        console.error('Failed to remove session:', error);
      }
    };

    registerSession();

    heartbeatIntervalRef.current = setInterval(() => {
      sendHeartbeat();
    }, 10000);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
        }
      } else {
        sendHeartbeat();
        heartbeatIntervalRef.current = setInterval(sendHeartbeat, 10000);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      removeSession();
    };
  }, [pageUrl]);
}
