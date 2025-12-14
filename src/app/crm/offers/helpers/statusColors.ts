import { EventEquipmentStatus } from '../../equipment/types/equipment.types';

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