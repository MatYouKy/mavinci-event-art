'use client';

import type { ReactNode } from 'react';

export default function ConferenceContactLink({ href, children, className, method }: { href: string; children: ReactNode; className?: string; method: 'phone' | 'email' }) {
  return <a href={href} className={className} onClick={() => {
    try {
      const analytics = window as unknown as { gtag?: (...args: unknown[]) => void };
      // A contact click is not counted as a successfully submitted inquiry.
      analytics.gtag?.('event', 'contact_click', { send_to: 'G-BHPZ5NSLQM', contact_method: method, page_path: window.location.pathname });
    } catch { /* Contact must work even when analytics is unavailable. */ }
  }}>{children}</a>;
}
