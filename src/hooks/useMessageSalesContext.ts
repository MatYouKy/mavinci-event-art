'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { readMessageSalesContext, type MessageSalesContext } from '@/lib/CRM/messages/salesContext';
export function useMessageSalesContext(type: string, id: string) {
  const [state, setState] = useState<{ key: string; value?: MessageSalesContext }>();
  const key = `${type}:${id}`;
  useEffect(() => {
    let active = true, running = false, pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (!active || !id || document.visibilityState !== 'visible') return;
      if (running) { pending = true; return; }
      running = true;
      try { const result = await readMessageSalesContext(supabase, [{ type, id }]); if (active) setState({ key, value: result[key] }); }
      finally { running = false; if (pending && active) { pending = false; schedule(); } }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 300); };
    const channel = supabase.channel(`message-sales:${key}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: 'is_inquiry=eq.true' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_ai_qualifications', filter: `received_email_id=eq.${id}` }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inquiry_email_links' }, schedule).subscribe();
    window.addEventListener('focus', schedule); document.addEventListener('visibilitychange', schedule);
    void refresh();
    return () => { active = false; clearTimeout(timer); void supabase.removeChannel(channel); window.removeEventListener('focus', schedule); document.removeEventListener('visibilitychange', schedule); };
  }, [type, id, key]);
  return state?.key === key ? state.value : undefined;
}
