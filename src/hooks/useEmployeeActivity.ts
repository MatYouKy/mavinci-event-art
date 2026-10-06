'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';

const HEARTBEAT_MS = 30_000;     // zapis co 30s, gdy aktywny
const IDLE_AFTER_MS = 10 * 60_000; // 10 minut
const ACTIVE_EVENTS = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];

export function useEmployeeActivity(employeeId: string | null) {
  useEffect(() => {
    if (!employeeId) return;
    let disposed = false;
    let lastInteraction = Date.now();
    let timer: number | null = null;
    let requestTimeout: number | null = null;
    let requestController: AbortController | null = null;
    let retryDelay = HEARTBEAT_MS;

    const markInteraction = () => {
      lastInteraction = Date.now();
    };

    ACTIVE_EVENTS.forEach((e) => window.addEventListener(e, markInteraction, { passive: true }));
    window.addEventListener('focus', markInteraction);
    document.addEventListener('visibilitychange', markInteraction);

    const tick = async () => {
      if (disposed) return;
      try {
        if (document.visibilityState !== 'visible' || !navigator.onLine) return;
        if (Date.now() - lastInteraction > IDLE_AFTER_MS) return;

        const controller = new AbortController();
        requestController = controller;
        requestTimeout = window.setTimeout(() => controller.abort(), 20_000);
        const { error } = await supabase
          .from('employees')
          .update({ last_active_at: new Date().toISOString() })
          .eq('id', employeeId)
          .abortSignal(controller.signal);

        if (error) throw error;
        retryDelay = HEARTBEAT_MS;
      } catch {
        // Back off during outages/quota restrictions instead of adding more load.
        retryDelay = Math.min(retryDelay * 2, 5 * 60_000);
      } finally {
        if (requestTimeout !== null) window.clearTimeout(requestTimeout);
        requestTimeout = null;
        requestController = null;
        // Schedule after completion: slow requests cannot overlap or outlive cleanup.
        if (!disposed) timer = window.setTimeout(() => void tick(), retryDelay);
      }
    };

    void tick();

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      if (requestTimeout !== null) window.clearTimeout(requestTimeout);
      requestController?.abort();
      ACTIVE_EVENTS.forEach((e) => window.removeEventListener(e, markInteraction));
      window.removeEventListener('focus', markInteraction);
      document.removeEventListener('visibilitychange', markInteraction);
    };
  }, [employeeId]);
}
