import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export function useClickTracking(enabled: boolean = true) {
  const sessionIdRef = useRef<string>('');

  useEffect(() => {
    if (typeof window === 'undefined' || !enabled) return;

    let sessionId = sessionStorage.getItem('analytics_session_id');
    if (!sessionId) {
      sessionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
      sessionStorage.setItem('analytics_session_id', sessionId);
    }
    sessionIdRef.current = sessionId;

    const handleClick = async (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (!target) return;

      const elementType = target.tagName.toLowerCase();
      const isTrackedElement =
        elementType === 'button' ||
        elementType === 'a' ||
        target.getAttribute('role') === 'button' ||
        target.closest('button') !== null ||
        target.closest('a') !== null;

      if (!isTrackedElement) return;

      const actualElement = target.closest('button, a') || target;
      const elementText = actualElement.textContent?.trim().substring(0, 100);
      const elementId = actualElement.id;
      const elementClass = actualElement.className;

      try {
        await supabase.from('click_events').insert({
          session_id: sessionIdRef.current,
          page_url: window.location.pathname,
          element_type: actualElement.tagName.toLowerCase(),
          element_text: elementText || null,
          element_id: elementId || null,
          element_class: elementClass || null,
          click_x: event.clientX,
          click_y: event.clientY,
        });
      } catch (error) {
        console.error('Click tracking error:', error);
      }
    };

    document.addEventListener('click', handleClick);

    return () => {
      document.removeEventListener('click', handleClick);
    };
  }, [enabled]);
}
