'use client';

import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import HotelPortalDemo from '@/components/crm/sellers/demo/HotelPortalDemo';

/** „Pokaż portal hotelowi” — tryb pokazowy portalu sprzedawcy (bez zapisów w bazie). */
export default function SellerPortalDemoPage() {
  return <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center bg-[#0f1119]"><Loader2 className="h-8 w-8 animate-spin text-[#d3bb73]" /></div>}>
    <HotelPortalDemo />
  </Suspense>;
}
