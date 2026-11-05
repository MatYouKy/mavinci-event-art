'use client';

import Link from 'next/link';
import { BadgePercent, CalendarCheck2, ClipboardCheck, FileSearch, Inbox, MessagesSquare, PartyPopper, type LucideIcon } from 'lucide-react';
import type { SalesDaySellers, SalesDaySellersItemKind } from '@/lib/seller/sellerCockpit';
import { formatSellerRelative } from './sellerUi';

const KINDS: Record<SalesDaySellersItemKind, { label: string; icon: LucideIcon }> = {
  review: { label: 'Oferta do sprawdzenia', icon: FileSearch },
  chat: { label: 'Rozmowa czeka', icon: MessagesSquare },
  inquiry: { label: 'Zapytanie gościa', icon: Inbox },
  wizard: { label: 'Krok realizacji', icon: ClipboardCheck },
  event: { label: 'Wydarzenie do potwierdzenia', icon: CalendarCheck2 },
  guest: { label: 'Akceptacja gościa', icon: PartyPopper },
};

/** „Mój dzień” → Sprzedawcy — do zrobienia (get_my_sales_day().sellers). */
export default function SalesDaySellersCard({ sellers, className }: { sellers: SalesDaySellers; className: string }) {
  const counts = [
    { label: 'Oferty', value: sellers.reviews },
    { label: 'Rozmowy', value: sellers.chats_waiting },
    { label: 'Zapytania', value: sellers.inquiries },
    { label: 'Kroki', value: sellers.wizard_steps },
    { label: 'Wydarzenia', value: sellers.events_pending },
    { label: 'Goście', value: sellers.guest_acceptances },
  ];
  const total = counts.reduce((sum, item) => sum + item.value, 0);
  return <article className={className}>
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-base font-medium"><BadgePercent className="h-4 w-4 text-[#d3bb73]" /> Sprzedawcy — do zrobienia</h3>
      <Link href="/crm/salespeople" className="shrink-0 text-xs text-[#d3bb73] hover:underline">Kokpit opiekuna →</Link>
    </div>
    <div className="mb-3 flex flex-wrap gap-1.5">
      {counts.map(item => <span key={item.label} className={`rounded-full px-2.5 py-1 text-xs ${item.value ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/5 text-[#e5e4e2]/40'}`}>{item.label}: {item.value}</span>)}
    </div>
    {total === 0 || sellers.items.length === 0 ? <p className="text-sm text-[#e5e4e2]/50">Żaden sprzedawca nie czeka na Twoją reakcję.</p> : (
      <ul className="space-y-1">
        {sellers.items.slice(0, 10).map((item, index) => {
          const kind = KINDS[item.kind] || KINDS.review;
          const Icon = kind.icon;
          return <li key={`${item.kind}-${item.url}-${index}`}>
            <Link href={item.url || '/crm/salespeople'} className="flex items-start justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-white/5">
              <span className="flex min-w-0 items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]/70" />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{item.title || kind.label}</span>
                  <span className="text-xs text-[#e5e4e2]/45">{kind.label} · {item.seller_name}</span>
                </span>
              </span>
              <span className="shrink-0 text-xs text-[#e5e4e2]/55">{formatSellerRelative(item.at, '')}</span>
            </Link>
          </li>;
        })}
      </ul>
    )}
  </article>;
}
