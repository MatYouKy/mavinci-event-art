import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

const HEARTBEAT_INTERVAL = 30000;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'];

export function useActivityHeartbeat() {
  const lastActivityRef = useRef<number>(Date.now());
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isActiveRef = useRef<boolean>(true);

  useEffect(() => {
    const updateActivity = () => {
      lastActivityRef.current = Date.now();
      isActiveRef.current = true;
    };

    ACTIVITY_EVENTS.forEach(event => {
      window.addEventListener(event, updateActivity, { passive: true });
    });

    const sendHeartbeat = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const timeSinceLastActivity = Date.now() - lastActivityRef.current;

        if (timeSinceLastActivity < 60000) {
          await supabase
            .from('employees')
            .update({ last_active_at: new Date().toISOString() })
            .eq('id', user.id);
        }
      } catch (error) {
        console.error('Error sending heartbeat:', error);
      }
    };

    sendHeartbeat();

    heartbeatIntervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    return () => {
      ACTIVITY_EVENTS.forEach(event => {
        window.removeEventListener(event, updateActivity);
      });

      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, []);
}
