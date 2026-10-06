'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Enhancement only: the server HTML remains visible without JavaScript or animation support. */
export default function HomeExpertiseMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current || !('IntersectionObserver' in window) || !('animate' in Element.prototype)) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const elements = Array.from(root.current.querySelectorAll<HTMLElement>('[data-expertise-reveal]'));
    const revealed = new WeakSet<Element>();
    const animations = new Set<Animation>();
    let observer: IntersectionObserver | undefined;

    const start = () => {
      observer?.disconnect();
      animations.forEach((animation) => animation.cancel());
      animations.clear();
      if (preference.matches) return;

      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || revealed.has(entry.target)) return;
          const element = entry.target as HTMLElement;
          revealed.add(element);
          observer?.unobserve(element);
          const animation = element.animate([
            { opacity: 0, transform: 'translateY(18px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ], {
            duration: 560,
            delay: window.matchMedia('(min-width: 800px)').matches ? Number(element.dataset.expertiseDelay || 0) : 0,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'backwards',
          });
          animations.add(animation);
          animation.onfinish = () => animations.delete(animation);
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });
      elements.forEach((element) => {
        if (!revealed.has(element)) observer?.observe(element);
      });
    };

    start();
    preference.addEventListener('change', start);
    return () => {
      preference.removeEventListener('change', start);
      observer?.disconnect();
      animations.forEach((animation) => animation.cancel());
    };
  }, []);

  return <div ref={root}>{children}</div>;
}
