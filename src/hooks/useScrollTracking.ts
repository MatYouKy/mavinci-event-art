import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export function useScrollTracking(enabled: boolean = true) {
  const sessionIdRef = useRef<string>('');
  const maxDepthRef = useRef<number>(0);
  const milestonesRef = useRef<Set<number>>(new Set());
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined' || !enabled) return;

    let sessionId = sessionStorage.getItem('analytics_session_id');
    if (!sessionId) {
      sessionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
      sessionStorage.setItem('analytics_session_id', sessionId);
    }
    sessionIdRef.current = sessionId;

    maxDepthRef.current = 0;
    milestonesRef.current = new Set();

    const updateScrollDepth = async () => {
      const scrollTop = window.scrollY;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;

      const scrollPercent = Math.round(
        ((scrollTop + windowHeight) / documentHeight) * 100
      );

      if (scrollPercent > maxDepthRef.current) {
        maxDepthRef.current = scrollPercent;

        [25, 50, 75, 90, 100].forEach((milestone) => {
          if (scrollPercent >= milestone && !milestonesRef.current.has(milestone)) {
            milestonesRef.current.add(milestone);
          }
        });

        try {
          await supabase.from('scroll_depth').upsert(
            {
              session_id: sessionIdRef.current,
              page_url: pathname,
              max_depth: maxDepthRef.current,
              milestones: Array.from(milestonesRef.current),
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: 'session_id,page_url',
            }
          );
        } catch (error) {
          console.error('Scroll tracking error:', error);
        }
      }
    };

    let timeout: NodeJS.Timeout;
    const handleScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(updateScrollDepth, 500);
    };

    window.addEventListener('scroll', handleScroll);
    updateScrollDepth();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(timeout);
    };
  }, [enabled, pathname]);
}
