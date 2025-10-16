import { EventStatus } from './types';

export const STATUS_COLORS: Record<EventStatus, string> = {
  inquiry: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  offer_to_send: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  offer_sent: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  offer_accepted: 'bg-green-500/20 text-green-400 border-green-500/30',
  in_preparation: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  in_progress: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  cancelled: 'bg-red-500/20 text-red-400 border-red-500/30',
  invoiced: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
};

export const STATUS_LABELS: Record<EventStatus, string> = {
  inquiry: 'Zapytanie',
  offer_to_send: 'Oferta do wysłania',
  offer_sent: 'Oferta wysłana',
  offer_accepted: 'Oferta zaakceptowana',
  in_preparation: 'W przygotowaniu',
  in_progress: 'W trakcie',
  completed: 'Zakończony',
  cancelled: 'Anulowany',
  invoiced: 'Rozliczony',
};

export const DAYS_OF_WEEK = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nie'];
export const DAYS_OF_WEEK_FULL = [
  'Poniedziałek',
  'Wtorek',
  'Środa',
  'Czwartek',
  'Piątek',
  'Sobota',
  'Niedziela',
];

export const HOURS = Array.from({ length: 24 }, (_, i) => i);
