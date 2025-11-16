'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useActiveSession } from '@/hooks/useActiveSession';

export function SessionTracker() {
  const pathname = usePathname();
  const isCRMPage = pathname?.startsWith('/crm');

  useActiveSession(!isCRMPage ? pathname || '/' : '');

  return null;
}
