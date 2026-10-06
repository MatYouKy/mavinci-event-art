import type { InquiryStage } from './inquiriesData.server';

export const STAGES: Array<{
  id: InquiryStage;
  label: string;
  shortLabel: string;
  className: string;
  dot: string;
  defaultProbability: number;
}> = [
  { id: 'new', label: 'Nowe zapytanie', shortLabel: 'Nowe', className: 'border-amber-400/30 bg-amber-400/10 text-amber-300', dot: 'bg-amber-400', defaultProbability: 10 },
  { id: 'contacted', label: 'Kontakt podjęty', shortLabel: 'Kontakt', className: 'border-sky-400/30 bg-sky-400/10 text-sky-300', dot: 'bg-sky-400', defaultProbability: 20 },
  { id: 'qualified', label: 'Zakwalifikowane', shortLabel: 'Kwalifikacja', className: 'border-blue-400/30 bg-blue-400/10 text-blue-300', dot: 'bg-blue-400', defaultProbability: 40 },
  { id: 'proposal', label: 'Oferta wysłana', shortLabel: 'Oferta', className: 'border-violet-400/30 bg-violet-400/10 text-violet-300', dot: 'bg-violet-400', defaultProbability: 60 },
  { id: 'negotiation', label: 'Negocjacje', shortLabel: 'Negocjacje', className: 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300', dot: 'bg-fuchsia-400', defaultProbability: 75 },
  { id: 'won', label: 'Wygrane', shortLabel: 'Wygrane', className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300', dot: 'bg-emerald-400', defaultProbability: 100 },
  { id: 'lost', label: 'Przegrane', shortLabel: 'Przegrane', className: 'border-red-400/30 bg-red-400/10 text-red-300', dot: 'bg-red-400', defaultProbability: 0 },
];

export const LOST_REASON_CATEGORIES = [
  ['price', 'Cena'],
  ['availability', 'Brak dostępnego terminu'],
  ['competitor', 'Wybrano konkurencję'],
  ['no_response', 'Brak odpowiedzi klienta'],
  ['scope', 'Zakres poza ofertą'],
  ['timing', 'Odłożona decyzja'],
  ['market_research', 'Badanie rynku'],
  ['duplicate', 'Duplikat zapytania'],
  ['other', 'Inny powód'],
] as const;

