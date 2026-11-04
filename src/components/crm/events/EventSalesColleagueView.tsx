'use client';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, MapPin, Package, Tag, User, UserCheck } from 'lucide-react';
import SystemBadge from '@/components/UI/SystemBadge';
import EventNavigation from './EventNavigation';
import {
  EVENT_TAB_LABELS,
  eventAccessSummary,
  salesOverviewProductLabel,
  type EventAccess,
  type EventSalesOverview,
} from '@/lib/events/access/eventAccess';

const time = (value: Date) => value.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return 'Termin nieustalony';
  const from = new Date(start);
  if (Number.isNaN(from.getTime())) return 'Termin nieustalony';
  const day = from.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const to = end ? new Date(end) : null;
  if (!to || Number.isNaN(to.getTime())) return `${day}, ${time(from)}`;
  if (to.toDateString() === from.toDateString()) return `${day}, ${time(from)}–${time(to)}`;
  return `${day}, ${time(from)} – ${to.toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}, ${time(to)}`;
}

/**
 * Wydarzenie sprzedane przez innego sprzedawcę (obszar sales_overview bez realizacji): tylko podgląd do odczytu —
 * termin, miejsce, kategoria, status, klient, kto sprzedał i sprzedane usługi (bez cen). Bez kroków, akcji,
 * plików i ofert — dane z RPC get_event_sales_overview (pobrane na serwerze).
 */
export default function EventSalesColleagueView({
  eventId,
  fallbackEvent,
  locationName,
  overview,
  access,
}: {
  eventId: string;
  /** Dane z wiersza wydarzenia (gdy jest czytelny), uzupełniane przez RPC podglądu. */
  fallbackEvent?: {
    name: string;
    event_date: string | null;
    event_end_date: string | null;
    location: string | null;
    status: string | null;
  } | null;
  locationName?: string | null;
  overview: EventSalesOverview | null;
  access: EventAccess;
}) {
  const router = useRouter();
  const event = overview?.event ?? null;
  const name = event?.name || fallbackEvent?.name || 'Wydarzenie';
  const start = event?.event_date ?? fallbackEvent?.event_date ?? null;
  const end = event?.event_end_date ?? fallbackEvent?.event_end_date ?? null;
  const place = locationName || event?.location || fallbackEvent?.location || null;
  const status = event?.status ?? fallbackEvent?.status ?? null;
  const products = overview?.products ?? [];
  const soldBy = overview?.sold_by ?? [];

  const rows: { key: string; icon: typeof Calendar; label: string; value: string }[] = [
    { key: 'date', icon: Calendar, label: 'Termin', value: formatDateRange(start, end) },
    { key: 'place', icon: MapPin, label: 'Miejsce', value: place || 'Brak lokalizacji' },
    { key: 'category', icon: Tag, label: 'Kategoria', value: event?.category || 'Bez kategorii' },
    { key: 'client', icon: User, label: 'Klient', value: overview?.client_name || 'Nie podano' },
    { key: 'seller', icon: UserCheck, label: 'Sprzedał(a)', value: soldBy.length ? soldBy.join(', ') : 'Nie ustalono' },
  ];

  return (
    <div className="space-y-6">
      <div className="mt-4 flex items-start gap-4">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Wróć"
          className="rounded-lg p-2 text-[#e5e4e2] transition-colors hover:bg-white/5"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg font-light text-[#e5e4e2] sm:text-xl md:text-2xl">{name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#e5e4e2]/60">
            <span className="inline-flex items-center gap-2">
              <Calendar className="h-4 w-4" aria-hidden />
              {formatDateRange(start, end)}
            </span>
            {place && (
              <span className="inline-flex items-center gap-2">
                <MapPin className="h-4 w-4" aria-hidden />
                {place}
              </span>
            )}
            {status && <SystemBadge value={status} />}
          </div>
        </div>
      </div>

      <EventNavigation
        tabs={[{ id: 'details', label: EVENT_TAB_LABELS.details }]}
        activeTab="details"
        onChange={() => undefined}
        idPrefix={`colleague-${eventId}`}
        panelId={`colleague-${eventId}-panel`}
      />

      <div
        id={`colleague-${eventId}-panel`}
        role="tabpanel"
        aria-labelledby={`colleague-${eventId}-tab-details`}
        className="space-y-4"
      >
        <section aria-labelledby={`colleague-${eventId}-heading`} className="rounded-xl bg-white/5 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`colleague-${eventId}-heading`} className="text-lg font-light text-[#e5e4e2]">
              Wydarzenie innego sprzedawcy
            </h2>
            {status && <SystemBadge value={status} />}
          </div>
          <p className="mt-1 text-sm text-[#e5e4e2]/55">
            Termin jest zajęty przez sprzedaż innego sprzedawcy. Szczegóły, kwoty i dokumenty prowadzi sprzedawca.
          </p>

          <dl className="mt-4 grid gap-1 sm:grid-cols-2">
            {rows.map(row => {
              const Icon = row.icon;
              return (
                <div key={row.key} className="flex items-start gap-3 rounded-lg px-2 py-2">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]" aria-hidden />
                  <div className="min-w-0">
                    <dt className="text-xs text-[#e5e4e2]/50">{row.label}</dt>
                    <dd className="mt-0.5 break-words text-sm text-[#e5e4e2]">{row.value}</dd>
                  </div>
                </div>
              );
            })}
          </dl>

          <div className="mt-4">
            <h3 className="flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
              <Package className="h-4 w-4 text-[#d3bb73]" aria-hidden />
              Sprzedane usługi
            </h3>
            {products.length ? (
              <ul className="mt-2 space-y-1.5">
                {products.map((product, index) => (
                  <li key={`${product.name}-${index}`} className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-[#e5e4e2]">
                    {salesOverviewProductLabel(product)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[#e5e4e2]/55">Brak zaakceptowanej oferty z listą usług.</p>
            )}
          </div>
        </section>

        <p className="text-xs text-[#e5e4e2]/40">{eventAccessSummary(access)}</p>
      </div>
    </div>
  );
}
