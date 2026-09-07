import type { EventStatus } from '@/components/crm/Calendar/types';

/**
 * Wspólna, kontrastowa paleta statusów dopasowana do burgundowego CRM.
 * Kolory zachowują znaczenie biznesowe, ale nie wprowadzają granatowych
 * powierzchni konkurujących z motywem marki.
 */
export const EVENT_STATUS_BADGE_CLASSES: Record<EventStatus, string> = {
  inquiry: 'bg-[#5e3344]/60 text-[#f2dce4] border-[#b7798f]/60',
  offer_to_send: 'bg-[#7f1734]/60 text-[#ffd8e1] border-[#d86a88]/65',
  offer_sent: 'bg-[#8f4f31]/45 text-[#ffe0bd] border-[#d49a68]/60',
  offer_accepted: 'bg-emerald-500/25 text-emerald-100 border-emerald-400/55',
  in_preparation: 'bg-amber-500/25 text-amber-100 border-amber-400/55',
  ready_for_live: 'bg-emerald-500/30 text-emerald-100 border-emerald-300/60',
  in_progress: 'bg-[#941d3e]/55 text-[#ffe0e7] border-[#e17995]/65',
  completed: 'bg-emerald-600/30 text-emerald-100 border-emerald-400/60',
  cancelled: 'bg-red-500/35 text-red-100 border-red-300/75',
  invoiced: 'bg-[#d3bb73]/25 text-[#fff0bd] border-[#e2cd8d]/65',
  settled: 'bg-[#d3bb73]/25 text-[#fff0bd] border-[#e2cd8d]/65',
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  inquiry: 'Zapytanie',
  offer_to_send: 'Oferta do wysłania',
  offer_sent: 'Oferta wysłana',
  offer_accepted: 'Oferta zaakceptowana',
  in_preparation: 'W przygotowaniu',
  ready_for_live: 'Gotowy do realizacji',
  in_progress: 'W trakcie',
  completed: 'Zakończony',
  cancelled: 'Anulowany',
  invoiced: 'Zafakturowany',
  settled: 'Rozliczony',
};
