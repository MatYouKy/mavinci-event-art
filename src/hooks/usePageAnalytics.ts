'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';

const ANALYTICS_SESSION_KEY = 'analytics_session_id';

const getOrCreateSessionId = () => {
  const existingSessionId = sessionStorage.getItem(ANALYTICS_SESSION_KEY);
  if (existingSessionId) return existingSessionId;

  const newSessionId = crypto.randomUUID();
  sessionStorage.setItem(ANALYTICS_SESSION_KEY, newSessionId);
  return newSessionId;
};

export function usePageAnalytics(pageTitle?: string, enabled: boolean = true) {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined' || !enabled) return;

    // Nie zbieraj statystyk w developmencie (localhost)
    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.startsWith('192.168.') ||
      window.location.hostname === '::1';

    if (isLocalhost) {
      return;
    }

    const sessionId = getOrCreateSessionId();
    const pageViewId = crypto.randomUUID();
    const startTime = Date.now();
    let pageViewSaved = false;
    let effectDisposed = false;

    const trackPageView = async () => {
      try {
        const ua = navigator.userAgent;
        const deviceType = /Mobile|Android|iPhone/i.test(ua)
          ? 'mobile'
          : /iPad|Tablet/i.test(ua)
            ? 'tablet'
            : 'desktop';

        const browser =
          /Chrome/i.test(ua) && !/Edge/i.test(ua)
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

        const { error } = await supabase.from('page_analytics').insert({
          id: pageViewId,
          page_url: pathname,
          page_title: pageTitle || document.title,
          referrer: document.referrer || null,
          user_agent: ua,
          session_id: sessionId,
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

        if (error) {
          console.error('Analytics tracking error:', error);
          return;
        }

        if (!effectDisposed) pageViewSaved = true;
      } catch (error) {
        console.error('Analytics tracking error:', error);
      }
    };

    trackPageView();

    const updateTimeOnPage = async () => {
      const timeSpent = Math.floor((Date.now() - startTime) / 1000);

      if (pageViewSaved && timeSpent > 0) {
        try {
          const { error } = await supabase.rpc('update_page_analytics_duration', {
            p_id: pageViewId,
            p_session_id: sessionId,
            p_time_on_page: timeSpent,
          });

          if (error) console.error('Time tracking error:', error);
        } catch (error) {
          console.error('Time tracking error:', error);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void updateTimeOnPage();
    };

    const handlePageHide = () => void updateTimeOnPage();
    const intervalId = window.setInterval(() => void updateTimeOnPage(), 15000);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      effectDisposed = true;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      void updateTimeOnPage();
    };
  }, [pathname, pageTitle, enabled]);
}
