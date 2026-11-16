'use client';

import Link from 'next/link';
import { AlertTriangle, CalendarDays, Filter } from 'lucide-react';
import { EVENT_STATUS_LABELS } from '@/components/crm/events/eventStatusPalette';
import {
  SELLER_WARNING_LABELS,
  sellerCockpitJourneyStages,
  type SellerCockpit,
} from '@/lib/seller/sellerCockpit';
import { formatDaysUntil, sellerCardHref } from '../sellerUi';

const STAGE_COLORS: Record<string, string> = {
  offer: 'bg-white/20',
  client: 'bg-[#d3bb73]/45',
  manager: 'bg-amber-300/80',
  event: 'bg-sky-300/80',
  settlement: 'bg-emerald-400/85',
};

/** Oferty i wydarzenia sprzedawców na osi w 5 etapach — ta sama oś co w portalu, ocenie oferty, na Macu i w aplikacji mobilnej. */
export function CockpitPipeline({ cockpit }: { cockpit: SellerCockpit }) {
  const stages = sellerCockpitJourneyStages(cockpit.pipeline);
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);
  return <section aria-labelledby="cockpit-pipeline-heading" className="rounded-2xl bg-[#1c1f33] p-5">
    <h2 id="cockpit-pipeline-heading" className="flex items-center gap-2 text-base font-medium"><Filter className="h-4 w-4 text-[#d3bb73]" />Oś w 5 etapach</h2>
    <p className="mt-0.5 text-xs text-white/45">Oferty i wydarzenia sprzedawców na tej samej osi, którą hotel widzi w portalu.</p>
    {total === 0 ? <p className="mt-4 rounded-xl bg-[#0f1119]/60 p-4 text-sm text-white/40">Sprzedawcy nie mają jeszcze ofert.</p> : <>
      <div className="mt-4 flex h-4 w-full overflow-hidden rounded-full bg-[#0f1119]" role="img" aria-label={stages.map(stage => `${stage.label}: ${stage.count}`).join(', ')}>
        {stages.filter(stage => stage.count > 0).map(stage => (
          <span key={stage.key} title={`${stage.label}: ${stage.count}`} className={`${STAGE_COLORS[stage.key]} h-full`} style={{ width: `${Math.max(3, (stage.count / total) * 100)}%` }} />
        ))}
      </div>
      <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {stages.map((stage, index) => <li key={stage.key} title={stage.hint} className="rounded-xl bg-[#0f1119]/60 px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/40"><span className={`h-2 w-2 rounded-full ${STAGE_COLORS[stage.key]}`} />{index + 1}. {stage.label}</span>
          <span className="mt-1 block text-xl font-light">{stage.count}</span>
          <span className="block text-[10px] text-white/35">{stage.detail}</span>
        </li>)}
      </ol>
    </>}
  </section>;
}

/** Najbliższe wydarzenia sprzedawców (14 dni). */
export function CockpitUpcoming({ cockpit }: { cockpit: SellerCockpit }) {
  return <section aria-labelledby="cockpit-upcoming-heading" className="rounded-2xl bg-[#1c1f33] p-5">
    <h2 id="cockpit-upcoming-heading" className="flex items-center gap-2 text-base font-medium"><CalendarDays className="h-4 w-4 text-[#d3bb73]" />Najbliższe wydarzenia</h2>
    <p className="mt-0.5 text-xs text-white/45">Realizacje sprzedawców w ciągu 14 dni.</p>
    {cockpit.upcoming.length === 0 ? <p className="mt-4 rounded-xl bg-[#0f1119]/60 p-4 text-sm text-white/40">Brak wydarzeń w najbliższych dwóch tygodniach.</p> : (
      <ul className="mt-4 space-y-1.5">
        {cockpit.upcoming.map(event => {
          const date = event.event_date ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(event.event_date) ? `${event.event_date}T12:00:00` : event.event_date) : null;
          const valid = date && Number.isFinite(date.getTime());
          return <li key={event.event_id}><Link href={`/crm/events/${event.event_id}`} className="group flex items-center gap-3 rounded-xl bg-[#0f1119]/60 p-2.5 hover:bg-[#0f1119]">
            <span className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-[#d3bb73]/10 py-1.5 text-[#d3bb73]">
              <span className="text-lg font-medium leading-none">{valid ? date!.getDate() : '—'}</span>
              <span className="mt-0.5 text-[10px] uppercase">{valid ? date!.toLocaleDateString('pl-PL', { month: 'short' }) : ''}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm group-hover:text-[#d3bb73]">{event.name}</span>
              <span className="block truncate text-xs text-white/45">{event.seller_name} · {EVENT_STATUS_LABELS[event.status as keyof typeof EVENT_STATUS_LABELS] || 'Wydarzenie'}</span>
            </span>
            <span className="shrink-0 text-[11px] text-white/45">{formatDaysUntil(event.event_date)}</span>
          </Link></li>;
        })}
      </ul>
    )}
  </section>;
}

/** Ostrzeżenia prowadzące do ustawień karty sprzedawcy (opiekun, marki, „Wynagrodzenie w portalu”). */
const SETTINGS_WARNINGS = ['no_manager', 'manager_without_rights', 'no_active_terms', 'commission_reveal_due'];

/** Ostrzeżenia: brak opiekuna, opiekun bez uprawnień, brak warunków, nieprzyjęte zaproszenie, brak aktywności, wynagrodzenie do odsłonięcia. */
export function CockpitWarnings({ cockpit }: { cockpit: SellerCockpit }) {
  const sellers = new Map(cockpit.sellers.map(seller => [seller.id, seller]));
  return <section id="cockpit-warnings" aria-labelledby="cockpit-warnings-heading" className="scroll-mt-24 rounded-2xl bg-[#1c1f33] p-5">
    <h2 id="cockpit-warnings-heading" className="flex items-center gap-2 text-base font-medium"><AlertTriangle className="h-4 w-4 text-amber-200" />Ostrzeżenia</h2>
    <p className="mt-0.5 text-xs text-white/45">Sprawy, które blokują sprzedaż, wymagają kontaktu ze sprzedawcą albo Twojej decyzji.</p>
    {cockpit.warnings.length === 0 ? <p className="mt-4 rounded-xl bg-emerald-400/[0.06] p-4 text-sm text-emerald-100/70">Brak ostrzeżeń — wszyscy sprzedawcy mają opiekuna, warunki i aktywne konto.</p> : (
      <ul className="mt-4 grid gap-2 md:grid-cols-2">
        {cockpit.warnings.map((warning, index) => {
          const seller = sellers.get(warning.sales_partner_id);
          return <li key={`${warning.sales_partner_id}-${warning.code}-${index}`} className="flex items-start gap-3 rounded-xl bg-[#0f1119]/60 p-3">
            <span className="mt-0.5 rounded-full bg-amber-400/10 p-1.5"><AlertTriangle className="h-3.5 w-3.5 text-amber-200" /></span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                {seller ? <Link href={sellerCardHref(seller, SETTINGS_WARNINGS.includes(warning.code) ? 'settings' : undefined)} className="text-sm hover:text-[#d3bb73]">{warning.seller_name}</Link> : <span className="text-sm">{warning.seller_name}</span>}
                <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200">{SELLER_WARNING_LABELS[warning.code] || 'Ostrzeżenie'}</span>
              </span>
              {warning.message && <span className="mt-1 block text-xs text-white/50">{warning.message}</span>}
            </span>
          </li>;
        })}
      </ul>
    )}
  </section>;
}
