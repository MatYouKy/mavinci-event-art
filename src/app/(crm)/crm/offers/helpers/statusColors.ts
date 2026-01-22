import { EventEquipmentStatus } from '../../equipment/types/equipment.types';

export type OfferStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export const offerStatusLabels: Record<OfferStatus, string> = {
  draft: 'Szkic',
  sent: 'Wysłana',
  accepted: 'Zaakceptowana',
  rejected: 'Odrzucona',
  expired: 'Wygasła',
};

export const offerStatusColors: Record<
  OfferStatus,
  {
    bg: string;
    text: string;
    border: string;
  }
> = {
  draft: {
    bg: 'bg-gray-500/10',
    text: 'text-gray-300',
    border: 'border-gray-500/20',
  },
  sent: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-300',
    border: 'border-blue-500/20',
  },
  accepted: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-300',
    border: 'border-emerald-500/20',
  },
  rejected: {
    bg: 'bg-red-500/10',
    text: 'text-red-300',
    border: 'border-red-500/20',
  },
  expired: {
    bg: 'bg-orange-500/10',
    text: 'text-orange-300',
    border: 'border-orange-500/20',
  },
};

export const statusLabels: Record<EventEquipmentStatus, string> = {
  draft: 'DRAFT (rezerwuje)',
  reserved: 'Zarezerwowane',
  in_use: 'W użyciu',
  returned: 'Zwrócone',
  cancelled: 'Anulowane',
};

export const statusColors: Record<
  EventEquipmentStatus,
  {
    bg: string;
    text: string;
    border: string;
  }
> = {
  draft: {
    bg: 'bg-[#d3bb73]/15',
    text: 'text-[#d3bb73]',
    border: 'border-[#d3bb73]/30',
  },

  reserved: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-300',
    border: 'border-emerald-500/20',
  },

  in_use: {
    bg: 'bg-sky-500/10',
    text: 'text-sky-300',
    border: 'border-sky-500/20',
  },

  returned: {
    bg: 'bg-[#e5e4e2]/10',
    text: 'text-[#e5e4e2]/70',
    border: 'border-[#e5e4e2]/20',
  },

  cancelled: {
    bg: 'bg-red-500/10',
    text: 'text-red-300',
    border: 'border-red-500/20',
  },
};


export function getStatusBadgeProps(status?: string) {
  const s = (status as EventEquipmentStatus) || 'draft';

  return {
    label: statusLabels[s] ?? status,
    ...statusColors[s],
  };
}

export function getOfferStatusBadgeProps(status?: string) {
  const s = (status as OfferStatus) || 'draft';

  return {
    label: offerStatusLabels[s] ?? status,
    ...offerStatusColors[s],
  };
}