'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

export function usePageAnalytics(pageTitle?: string, enabled: boolean = true) {
  const pathname = usePathname();
  const sessionId = useRef<string>('');
  const startTime = useRef<number>(0);
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    if (typeof window === 'undefined' || !enabled) return;

    // Nie zbieraj statystyk w developmencie (localhost)
    const isLocalhost = window.location.hostname === 'localhost' ||
                       window.location.hostname === '127.0.0.1' ||
                       window.location.hostname.startsWith('192.168.') ||
                       window.location.hostname === '::1';

    if (isLocalhost) {
      showSnackbar('[Analytics] Skipped - running on localhost', 'info');
      return;
    }

    if (!sessionId.current) {
      sessionId.current = crypto.randomUUID();
    }

    startTime.current = Date.now();

    const trackPageView = async () => {
      try {
        const ua = navigator.userAgent;
        const deviceType = /Mobile|Android|iPhone/i.test(ua)
          ? 'mobile'
          : /iPad|Tablet/i.test(ua)
          ? 'tablet'
          : 'desktop';

        const browser = /Chrome/i.test(ua) && !/Edge/i.test(ua)
          ? 'Chrome'
          : /Firefox/i.test(ua)
          ? 'Firefox'
          : /Safari/i.test(ua) && !/Chrome/i.test(ua)
          ? 'Safari'
          : /Edge/i.test(ua)
          ? 'Edge'
          : 'Other';

        const os = /Windows/i.test(ua)
          ? 'Windows'
          : /Mac/i.test(ua)
          ? 'macOS'
          : /Linux/i.test(ua)
          ? 'Linux'
          : /Android/i.test(ua)
          ? 'Android'
          : /iOS|iPhone|iPad/i.test(ua)
          ? 'iOS'
          : 'Other';

        const urlParams = new URLSearchParams(window.location.search);
        const utmSource = urlParams.get('utm_source');
        const utmMedium = urlParams.get('utm_medium');
        const utmCampaign = urlParams.get('utm_campaign');
        const utmTerm = urlParams.get('utm_term');
        const utmContent = urlParams.get('utm_content');

        await supabase.from('page_analytics').insert({
          page_url: pathname,
          page_title: pageTitle || document.title,
          referrer: document.referrer || null,
          user_agent: ua,
          session_id: sessionId.current,
          device_type: deviceType,
          browser,
          os,
          screen_width: window.screen.width,
          screen_height: window.screen.height,
          language: navigator.language,
          utm_source: utmSource,
          utm_medium: utmMedium,
          utm_campaign: utmCampaign,
          utm_term: utmTerm,
          utm_content: utmContent,
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
