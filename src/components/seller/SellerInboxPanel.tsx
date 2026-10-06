'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Bell, FileCheck2, MessageSquare, RefreshCw } from 'lucide-react';
import { isSellerRealizationNotice, readSellerNotice, refreshSellerInbox, sellerInboxCounts, useSellerInbox, type SellerInboxItem } from '@/lib/seller/inbox';
import { refreshSellerSidebarBadge, useSellerSidebarBadge } from '@/lib/seller/sidebarBadge';

export function SellerCountBadge({ count, label }: { count: number; label: string }) {
  if (!count) return null;
  return <span title={`${label}: ${count}`} aria-label={`${label}: ${count}`} className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/90 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-white">{count > 99 ? '99+' : count}</span>;
}

type InboxSource = {
  items: SellerInboxItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export default function SellerInboxPanel({ partnerId, scope = 'all', source }: {
  partnerId?: string;
  scope?: 'all' | 'offers' | 'realizations';
  source?: InboxSource;
}) {
  const seller = usePathname().startsWith('/seller');
  // CRM panels and the sidebar share one scoped snapshot. The external portal
  // retains its own inbox and must never subscribe to CRM notifications.
  const portalInbox = useSellerInbox(seller && !source);
  const crmInbox = useSellerSidebarBadge(!seller && !source);
  const { items, loading, error } = source || (seller ? portalInbox : crmInbox);
  const refresh = source?.refresh || (seller ? refreshSellerInbox : refreshSellerSidebarBadge);
  const [expanded, setExpanded] = useState(false);
  const rows = items.filter((item) => (!partnerId || item.sales_partner_id === partnerId)
    && (scope === 'all' || (scope === 'realizations' ? isSellerRealizationNotice(item) : !isSellerRealizationNotice(item))));
  const counts = sellerInboxCounts(rows);
  const title = scope === 'realizations' ? 'Powiadomienia o realizacjach' : seller ? 'Twoje powiadomienia' : 'Sprawy sprzedawców';
  return <section className="rounded-xl bg-[#1c1f33] p-5 text-[#e5e4e2]" id="seller-inbox">
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium"><Bell className="h-4 w-4 text-[#d3bb73]" />{title} <SellerCountBadge count={counts.total} label={title} /></h2>
      <button type="button" onClick={() => void refresh()} className="rounded-lg p-2 text-white/50 hover:bg-white/5" aria-label="Odśwież sprawy"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
    </div>
    <p className="mt-2 text-xs text-white/45">{scope === 'realizations' ? 'Akceptacja oferty i potwierdzenie wydarzenia to osobne decyzje. Kliknij powiadomienie, aby zobaczyć aktualny status realizacji.' : `Do decyzji: ${counts.reviews} · Nowe wiadomości: ${counts.messages} · Powiadomienia: ${counts.notices}`}</p>
    {error ? <p role="alert" className="mt-4 text-sm text-amber-200">{error}</p> : <div className="mt-4 space-y-2">
      {(expanded ? rows : rows.slice(0, 6)).map((item) => {
        const Icon = item.kind === 'review' ? FileCheck2 : item.kind === 'message' ? MessageSquare : Bell;
        const safeUrl = item.action_url?.startsWith('/') && !item.action_url.startsWith('//')
          && (!seller || item.action_url.startsWith('/seller/'));
        return <Link key={item.id} href={safeUrl ? item.action_url : seller ? '/seller' : '/crm/salespeople'} onClick={() => { if (item.kind !== 'review') void readSellerNotice(item, seller).then(() => source?.refresh()); }} className="flex items-center gap-3 rounded-lg bg-white/[0.03] p-3 transition hover:bg-white/[0.07]">
          <Icon className="h-4 w-4 shrink-0 text-[#d3bb73]" />
          <span className="min-w-0 flex-1"><span className="block text-sm">{item.title}</span><span className="mt-1 block text-xs text-white/45">{item.kind === 'review' ? 'Oczekuje na decyzję opiekuna' : item.kind === 'message' ? 'Nieprzeczytane wiadomości' : 'Nowe powiadomienie'} · {new Date(item.created_at).toLocaleString('pl-PL')}</span></span>
          <SellerCountBadge count={Number(item.count)} label="Liczba spraw" />
        </Link>;
      })}
      {!rows.length && <p className="py-3 text-sm text-white/45">{loading ? 'Wczytywanie spraw…' : 'Brak nieodczytanych powiadomień.'}</p>}
      {rows.length > 6 && <button type="button" onClick={() => setExpanded(!expanded)} className="py-2 text-xs text-[#d3bb73]">{expanded ? 'Pokaż mniej' : `Pokaż wszystkie (${rows.length})`}</button>}
    </div>}
  </section>;
}
