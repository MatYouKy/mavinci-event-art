import { EventStatus } from './types';
import { EVENT_STATUS_BADGE_CLASSES } from '@/components/crm/events/eventStatusPalette';

export const STATUS_COLORS: Record<EventStatus, string> = EVENT_STATUS_BADGE_CLASSES;

export const STATUS_LABELS: Record<EventStatus, string> = {
  inquiry: 'Zapytanie potencjalne',
  offer_to_send: 'Oferta do wysłania',
  offer_sent: 'Oferta wysłana',
  offer_accepted: 'Oferta zaakceptowana',
  in_preparation: 'W przygotowaniu',
  in_progress: 'W trakcie',
  completed: 'Zakończony',
  cancelled: 'Anulowany',
  invoiced: 'Rozliczony',
  settled: 'Zrealizowany',
  ready_for_live: 'Gotowy do życia',
};

export const DAYS_OF_WEEK = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nie'];
export const DAYS_OF_WEEK_SHORT = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
export const DAYS_OF_WEEK_FULL = [
  'Poniedziałek',
  'Wtorek',
  'Środa',
  'Czwartek',
  'Piątek',
  'Sobota',
  'Niedziela',
];

export type CalendarStatus = keyof typeof STATUS_COLORS;

export const HOURS = Array.from({ length: 24 }, (_, i) => i);
