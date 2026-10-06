'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';

// Realtime when available, plus catch-up after hidden/offline browser tabs.
export function useOfferRefresh(filter?: string) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!filter) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') setRevision((value) => value + 1);
    };
    const channel = supabase.channel(`seller-offer-refresh:${filter}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'offers', filter }, refresh)
      .subscribe();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('seller-workspace-changed', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      void supabase.removeChannel(channel);
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('seller-workspace-changed', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [filter]);
  return revision;
}
