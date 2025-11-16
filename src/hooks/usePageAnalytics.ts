'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export function usePageAnalytics(pageTitle?: string, enabled: boolean = true) {
  const pathname = usePathname();
  const sessionId = useRef<string>('');
  const startTime = useRef<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !enabled) return;

    if (!sessionId.current) {
      sessionId.current = crypto.randomUUID();
    }

    startTime.current = Date.now();

    const trackPageView = async () => {
      try {
        const deviceType = /Mobile|Android|iPhone/i.test(navigator.userAgent)
          ? 'mobile'
          : /iPad|Tablet/i.test(navigator.userAgent)
          ? 'tablet'
          : 'desktop';

        await supabase.from('page_analytics').insert({
          page_url: pathname,
          page_title: pageTitle || document.title,
          referrer: document.referrer || null,
          user_agent: navigator.userAgent,
          session_id: sessionId.current,
          device_type: deviceType,
          time_on_page: 0,
        });
      } catch (error) {
        console.error('Analytics tracking error:', error);
      }
    };

    trackPageView();

    const updateTimeOnPage = async () => {
      const timeSpent = Math.floor((Date.now() - startTime.current) / 1000);

      if (timeSpent > 0) {
        try {
          await supabase
            .from('page_analytics')
            .update({ time_on_page: timeSpent })
            .eq('session_id', sessionId.current)
            .eq('page_url', pathname)
            .order('created_at', { ascending: false })
            .limit(1);
        } catch (error) {
          console.error('Time tracking error:', error);
        }
      }
    };

    const handleBeforeUnload = () => {
      updateTimeOnPage();
    };

    const intervalId = setInterval(updateTimeOnPage, 30000);

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      updateTimeOnPage();
    };
  }, [pathname, pageTitle]);
}
