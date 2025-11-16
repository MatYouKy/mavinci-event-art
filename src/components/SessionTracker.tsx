'use client';

import { usePathname } from 'next/navigation';
import { useActiveSession } from '@/hooks/useActiveSession';
import { usePageAnalytics } from '@/hooks/usePageAnalytics';
import { useClickTracking } from '@/hooks/useClickTracking';
import { useScrollTracking } from '@/hooks/useScrollTracking';

export function SessionTracker() {
  const pathname = usePathname();
  const isCRMPage = pathname?.startsWith('/crm') || pathname?.startsWith('/admin');

  const trackingUrl = !isCRMPage ? (pathname || '/') : '';
  useActiveSession(trackingUrl);
  usePageAnalytics(undefined, !isCRMPage);
  useClickTracking(!isCRMPage);
  useScrollTracking(!isCRMPage);

  return null;
}
