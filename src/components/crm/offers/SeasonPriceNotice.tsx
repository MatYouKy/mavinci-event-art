'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, Tags } from 'lucide-react';
import { seasonPriceNotice, type SeasonPriceNoticeMode, type SeasonPrices } from '@/lib/CRM/Offers/seasonPrices';

/**
 * Pasek „Cennik: Wesela 2027” — skąd są ceny pozycji (cennik sezonowy marki według daty eventu albo katalog).
 * `mode`: kreator nowej oferty, strona oferty (gwarancja ceny, podpowiedź nowszego sezonu) albo okno pozycji.
 */
export default function SeasonPriceNotice({ prices, mode, action, className = '' }: {
  prices: SeasonPrices | null;
  mode: SeasonPriceNoticeMode;
  action?: ReactNode;
  className?: string;
}) {
  const notice = seasonPriceNotice(prices, mode);
  if (!notice) return null;
  const tone = notice.tone === 'warning'
    ? 'border-amber-300/30 bg-amber-300/10 text-amber-50'
    : notice.tone === 'info'
      ? 'border-[#d3bb73]/25 bg-[#d3bb73]/5 text-[#e5e4e2]'
      : 'border-white/10 bg-white/[0.03] text-[#e5e4e2]/75';
  const Icon = notice.tone === 'warning' ? AlertTriangle : Tags;
  return (
    <div role="status" className={`flex flex-col gap-2 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between ${tone} ${className}`}>
      <div className="flex min-w-0 items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${notice.tone === 'warning' ? 'text-amber-300' : 'text-[#d3bb73]'}`} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{notice.title}</p>
          <p className="text-xs opacity-75">{notice.detail}</p>
        </div>
      </div>
      {action}
    </div>
  );
}
