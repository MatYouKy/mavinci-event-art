'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/browser';

const HEARTBEAT_MS = 30_000;     // zapis co 30s, gdy aktywny
const IDLE_AFTER_MS = 10 * 60_000; // 10 minut
const ACTIVE_EVENTS = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];

export function useEmployeeActivity(employeeId: string | null) {
  const lastInteractionRef = useRef<number>(Date.now());
  const intervalRef = useRef<any>(null);

  useEffect(() => {
    if (!employeeId) return;

    const markInteraction = () => {
      lastInteractionRef.current = Date.now();
    };

    ACTIVE_EVENTS.forEach((e) => window.addEventListener(e, markInteraction, { passive: true }));
    window.addEventListener('focus', markInteraction);
    window.addEventListener('visibilitychange', markInteraction);

    const tick = async () => {
      // jeśli karta niewidoczna — nie pingujemy (użytkownik np. ogląda YT)
      if (document.visibilityState !== 'visible') return;

      const now = Date.now();
      const idleFor = now - lastInteractionRef.current;

      // jeśli user nie ruszał się >10 min, to nie spamuj update
      // (status żółty/czerwony policzysz po last_active_at z bazy)
      if (idleFor > IDLE_AFTER_MS) return;

      await supabase
        .from('employees')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', employeeId);
    };

    intervalRef.current = setInterval(tick, HEARTBEAT_MS);
    tick(); // od razu przy starcie

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      ACTIVE_EVENTS.forEach((e) => window.removeEventListener(e, markInteraction));
      window.removeEventListener('focus', markInteraction);
      window.removeEventListener('visibilitychange', markInteraction);
    };
  }, [employeeId]);
}