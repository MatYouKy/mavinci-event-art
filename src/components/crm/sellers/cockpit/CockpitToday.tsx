'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CalendarCheck2, CheckCheck, ClipboardCheck, FileSearch, Inbox, MessagesSquare, PartyPopper, X, type LucideIcon } from 'lucide-react';
import {
  SELLER_EVENT_TYPE_LABELS,
  SELLER_INQUIRY_STATUS_LABELS,
  SELLER_REALIZATION_STEP_LABELS,
  formatWaitingHours,
  sellerCockpitTodayCount,
  type SellerCockpit,
} from '@/lib/seller/sellerCockpit';
import CockpitInquiryActions from './CockpitInquiryActions';
import {
  SellerCountChip,
  formatDaysUntil,
  formatSellerDate,
  formatSellerRelative,
  sellerChatHref,
  sellerPln,
  sellerReviewHref,
  sellerWizardHref,
} from '../sellerUi';

const VISIBLE = 4;
const rowClass = 'group flex items-start justify-between gap-3 rounded-xl bg-[#0f1119]/60 px-3 py-2.5 transition-colors hover:bg-[#0f1119]';

function TodayGroup<T>({ title, icon: Icon, items, empty, render, tone = 'brand', forceExpanded = false }: {
  title: string;
  icon: LucideIcon;
  items: T[];
  empty: string;
  render: (item: T) => ReactNode;
  tone?: 'brand' | 'warning';
  /** Link z „Mojego dnia” (?inquiry=) wskazuje sprawę spoza pierwszych pozycji — pokaż całą listę. */
  forceExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(forceExpanded);
  useEffect(() => { if (forceExpanded) setExpanded(true); }, [forceExpanded]);
  const shown = expanded ? items : items.slice(0, VISIBLE);
  return <article className="flex min-w-0 flex-col rounded-2xl bg-[#1c1f33] p-4">
    <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
      <span className={`rounded-lg p-1.5 ${tone === 'warning' ? 'bg-amber-400/10 text-amber-200' : 'bg-[#d3bb73]/10 text-[#d3bb73]'}`}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <SellerCountChip count={items.length} tone={tone} />
    </h3>
    {items.length === 0 ? <p className="flex items-center gap-2 rounded-xl bg-[#0f1119]/40 px-3 py-3 text-xs text-white/35"><CheckCheck className="h-4 w-4" />{empty}</p> : (
      <ul className="space-y-1.5">{shown.map(render)}</ul>
    )}
    {items.length > VISIBLE && <button type="button" onClick={() => setExpanded(value => !value)} className="mt-2 self-start rounded-lg px-2 py-1 text-xs text-[#d3bb73] hover:bg-white/5">{expanded ? 'Zwiń' : `Pokaż wszystkie (${items.length})`}</button>}
  </article>;
}

const Meta = ({ children }: { children: ReactNode }) => <span className="mt-0.5 block truncate text-xs text-white/45">{children}</span>;

/** Sekcja „Dziś” kokpitu opiekuna — sprawy sprzedawców wymagające reakcji. */
export default function CockpitToday({ cockpit, onChanged }: { cockpit: SellerCockpit; onChanged: () => void }) {
  const [converted, setConverted] = useState<{ id: string; guest: string } | null>(null);
  const today = cockpit.today;
  const total = sellerCockpitTodayCount(cockpit);
  const focusInquiry = useSearchParams().get('inquiry');
  const focusIndex = focusInquiry ? today.inquiries.findIndex(item => item.id === focusInquiry) : -1;
  useEffect(() => {
    if (focusIndex < 0 || !focusInquiry) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(`seller-inquiry-${focusInquiry}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    return () => window.cancelAnimationFrame(frame);
  }, [focusIndex, focusInquiry]);

  return <section aria-labelledby="cockpit-today-heading" className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 id="cockpit-today-heading" className="flex items-center gap-2 text-lg font-medium">Dziś <SellerCountChip count={total} /></h2>
        <p className="mt-0.5 text-xs text-white/45">Oferty do sprawdzenia, kroki realizacji, rozmowy i zapytania gości od Twoich sprzedawców.</p>
      </div>
    </div>
    {converted && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
      <span>Utworzono zapytanie CRM dla gościa {converted.guest}.</span>
      <span className="flex items-center gap-2">
        <Link href={`/crm/inquiries/${converted.id}`} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15">Otwórz zapytanie</Link>
        <button type="button" onClick={() => setConverted(null)} aria-label="Zamknij" className="rounded-lg p-1 hover:bg-white/10"><X className="h-4 w-4" /></button>
      </span>
    </div>}
    {total === 0 ? <div className="flex items-center gap-4 rounded-2xl bg-[#1c1f33] p-6">
      <span className="rounded-2xl bg-emerald-400/10 p-3"><PartyPopper className="h-6 w-6 text-emerald-200" /></span>
      <div><p className="font-medium">Wszystko załatwione</p><p className="mt-1 text-sm text-white/45">Żaden sprzedawca nie czeka teraz na Twoją decyzję ani odpowiedź.</p></div>
    </div> : (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <TodayGroup title="Oferty do sprawdzenia" icon={FileSearch} items={today.reviews} empty="Brak ofert czekających na decyzję." render={(review) => (
          <li key={review.offer_id}><Link href={sellerReviewHref(review)} className={rowClass}>
            <span className="min-w-0">
              <span className="block truncate text-sm group-hover:text-[#d3bb73]">{review.offer_number ? `${review.offer_number} · ` : ''}{review.title}</span>
              <Meta>{review.seller_name}{review.client_total_net != null ? ` · ${sellerPln(review.client_total_net)} netto` : ''}</Meta>
            </span>
            <span className="shrink-0 text-[11px] text-white/45">{formatSellerRelative(review.requested_at, '')}</span>
          </Link></li>
        )} />
        <TodayGroup title="Kroki realizacji do zatwierdzenia" icon={ClipboardCheck} items={today.wizard_steps} empty="Sprzedawcy nie przesłali nowych kroków." render={(step) => (
          <li key={`${step.offer_id}-${step.step_key}`}><Link href={sellerWizardHref(step)} className={rowClass}>
            <span className="min-w-0">
              <span className="block truncate text-sm group-hover:text-[#d3bb73]">{step.title}</span>
              <Meta>{SELLER_REALIZATION_STEP_LABELS[step.step_key] || 'Krok realizacji'} · {step.seller_name}</Meta>
            </span>
            <span className="shrink-0 text-[11px] text-white/45">{formatSellerRelative(step.submitted_at, '')}</span>
          </Link></li>
        )} />
        <TodayGroup title="Wydarzenia do potwierdzenia" icon={CalendarCheck2} tone="warning" items={today.events_pending} empty="Brak wydarzeń czekających na potwierdzenie." render={(event) => (
          <li key={event.event_id}><Link href={`/crm/events/${event.event_id}`} className={rowClass}>
            <span className="min-w-0">
              <span className="block truncate text-sm group-hover:text-[#d3bb73]">{event.name}</span>
              <Meta>{event.seller_name} · {formatSellerDate(event.event_date, 'bez terminu')}</Meta>
              <span className="mt-1 flex flex-wrap gap-1">
                {event.confirmation_required && <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200">Wymaga potwierdzenia</span>}
                {event.schedule_pending && <span className="rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] text-sky-200">Harmonogram do akceptacji</span>}
              </span>
            </span>
            <span className="shrink-0 text-[11px] text-white/45">{formatDaysUntil(event.event_date)}</span>
          </Link></li>
        )} />
        <TodayGroup title="Rozmowy czekające na odpowiedź" icon={MessagesSquare} tone="warning" items={today.chats_waiting} empty="Odpowiedziałeś na wszystkie wiadomości." render={(chat) => (
          <li key={chat.conversation_id}><Link href={sellerChatHref(chat)} className={rowClass}>
            <span className="min-w-0">
              <span className="block truncate text-sm group-hover:text-[#d3bb73]">{chat.seller_name}<span className="text-white/40"> · {chat.title}</span></span>
              {chat.preview && <span className="mt-0.5 line-clamp-2 text-xs text-white/50">„{chat.preview}”</span>}
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${chat.waiting_hours >= 24 ? 'bg-red-400/10 text-red-200' : chat.waiting_hours >= 4 ? 'bg-amber-400/10 text-amber-200' : 'bg-white/5 text-white/55'}`}>czeka {formatWaitingHours(chat.waiting_hours)}</span>
          </Link></li>
        )} />
        <TodayGroup title="Zapytania gości" icon={Inbox} items={today.inquiries} forceExpanded={focusIndex >= VISIBLE} empty="Brak nowych zapytań od gości hoteli." render={(inquiry) => (
          <li key={inquiry.id} id={`seller-inquiry-${inquiry.id}`} className={`rounded-xl px-3 py-2.5 ${inquiry.id === focusInquiry ? 'bg-[#d3bb73]/10' : 'bg-[#0f1119]/60'}`}>
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-sm">{inquiry.guest_name}</span>
                <Meta>
                  {[inquiry.event_type ? SELLER_EVENT_TYPE_LABELS[inquiry.event_type] || 'Wydarzenie' : null,
                    inquiry.event_date ? formatSellerDate(inquiry.event_date) : 'termin do ustalenia',
                    inquiry.guest_count ? `${inquiry.guest_count} os.` : null].filter(Boolean).join(' · ')}
                </Meta>
                <Meta>{inquiry.seller_name} · {inquiry.source === 'qr' ? 'z kodu QR' : 'z portalu'}</Meta>
              </span>
              <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/55">{SELLER_INQUIRY_STATUS_LABELS[inquiry.status] || 'Nowe'}</span>
            </div>
            <div className="mt-2"><CockpitInquiryActions inquiry={inquiry} onChanged={onChanged} onConverted={(id, guest) => setConverted({ id, guest })} /></div>
          </li>
        )} />
        <TodayGroup title="Akceptacje gości" icon={PartyPopper} items={today.guest_acceptances} empty="Brak nowych akceptacji ofert przez gości." render={(acceptance) => (
          <li key={acceptance.offer_id}><Link href={`/crm/offers/${acceptance.offer_id}`} className={rowClass}>
            <span className="min-w-0">
              <span className="block truncate text-sm group-hover:text-[#d3bb73]">{acceptance.title}</span>
              <Meta>{acceptance.accepted_name ? `Zaakceptował(a): ${acceptance.accepted_name}` : 'Gość zaakceptował ofertę'} · {acceptance.seller_name}</Meta>
            </span>
            <span className="shrink-0 text-[11px] text-emerald-200/80">{formatSellerRelative(acceptance.accepted_at, '')}</span>
          </Link></li>
        )} />
      </div>
    )}
  </section>;
}
