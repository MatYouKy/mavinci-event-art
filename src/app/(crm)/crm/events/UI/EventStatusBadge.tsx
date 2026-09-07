'use client';

import { Tag } from 'lucide-react';
import { EventStatus } from '@/components/crm/Calendar/types';
import { EVENT_STATUS_BADGE_CLASSES } from '@/components/crm/events/eventStatusPalette';

interface Props {
  status: EventStatus;
}

const STATUS_STYLES: Record<
  EventStatus,
  { label: string; className: string }
> = {
  inquiry: {
    label: 'Zapytanie',
    className: EVENT_STATUS_BADGE_CLASSES.inquiry,
  },
  offer_to_send: {
    label: 'Oferta do wysłania',
    className: EVENT_STATUS_BADGE_CLASSES.offer_to_send,
  },
  offer_sent: {
    label: 'Oferta wysłana',
    className: EVENT_STATUS_BADGE_CLASSES.offer_sent,
  },
  offer_accepted: {
    label: 'Oferta zaakceptowana',
    className: EVENT_STATUS_BADGE_CLASSES.offer_accepted,
  },
  in_preparation: {
    label: 'W przygotowaniu',
    className: EVENT_STATUS_BADGE_CLASSES.in_preparation,
  },
  in_progress: {
    label: 'W trakcie',
    className: EVENT_STATUS_BADGE_CLASSES.in_progress,
  },
  completed: {
    label: 'Zrealizowany',
    className: EVENT_STATUS_BADGE_CLASSES.completed,
  },
  cancelled: {
    label: 'Anulowany',
    className: EVENT_STATUS_BADGE_CLASSES.cancelled,
  },
  invoiced: {
    label: 'Zafakturowany',
    className: EVENT_STATUS_BADGE_CLASSES.invoiced,
  },
  ready_for_live: {
    label: 'Gotowy do realizacji',
    className: EVENT_STATUS_BADGE_CLASSES.ready_for_live,
  },
  settled: {
    label: 'Rozliczony',
    className: EVENT_STATUS_BADGE_CLASSES.settled,
  },
};

export function EventStatusBadge({ status }: Props) {
  const data = STATUS_STYLES[status];

  if (!data) {
    return (
      <span
        data-brand-badge="true"
        className="inline-grid w-[168px] max-w-full grid-cols-[12px_minmax(0,1fr)_12px] items-center gap-1 whitespace-nowrap rounded-md border border-gray-500/20 bg-gray-500/10 px-2.5 py-1 text-[10px] leading-tight text-gray-400"
      >
        <Tag className="h-3 w-3 justify-self-start" />
        <span className="min-w-0 text-center">Nieznany status</span>
        <span aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      data-brand-badge="true"
      className={`inline-grid w-[168px] max-w-full grid-cols-[12px_minmax(0,1fr)_12px] items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 text-[10px] font-medium leading-tight ${data.className}`}
    >
      <Tag className="h-3 w-3 justify-self-start" />
      <span className="min-w-0 text-center">{data.label}</span>
      <span aria-hidden="true" />
    </span>
  );
}
