'use client';

import { Tag } from 'lucide-react';
import { EventStatus } from '@/components/crm/Calendar/types';

interface Props {
  status: EventStatus;
}

const STATUS_STYLES: Record<
  EventStatus,
  { label: string; className: string }
> = {
  inquiry: {
    label: 'Zapytanie',
    className: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  },
  offer_to_send: {
    label: 'Oferta do wysłania',
    className: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  },
  offer_sent: {
    label: 'Oferta wysłana',
    className: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  },
  offer_accepted: {
    label: 'Oferta zaakceptowana',
    className: 'bg-green-500/10 text-green-400 border-green-500/20',
  },
  in_preparation: {
    label: 'W przygotowaniu',
    className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  },
  in_progress: {
    label: 'W trakcie',
    className: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  },
  completed: {
    label: 'Zrealizowany',
    className: 'bg-green-600/10 text-green-500 border-green-600/20',
  },
  cancelled: {
    label: 'Anulowany',
    className: 'bg-red-500/10 text-red-400 border-red-500/20',
  },
  invoiced: {
    label: 'Zafakturowany',
    className: 'bg-[#d3bb73]/10 text-[#d3bb73] border-[#d3bb73]/20',
  },
};

export function EventStatusBadge({ status }: Props) {
  const data = STATUS_STYLES[status];

  if (!data) {
    return (
      <span className="rounded-md border border-gray-500/20 bg-gray-500/10 px-3 py-1 text-xs text-gray-400">
        Nieznany status
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-medium ${data.className}`}
    >
      <Tag className="h-3.5 w-3.5" />
      {data.label}
    </span>
  );
}