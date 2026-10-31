import type { SellerArrangements } from './arrangements';

export const realizationWizardSteps = [
  { key: 'contact', title: 'Kontakt na miejscu', author: 'Sprzedawca', reviewer: 'Opiekun' },
  { key: 'organization', title: 'Miejsce i organizacja', author: 'Sprzedawca', reviewer: 'Opiekun' },
  { key: 'materials', title: 'Materiały i wymagania', author: 'Sprzedawca', reviewer: 'Opiekun' },
  { key: 'plan', title: 'Plan realizacji', author: 'Opiekun', reviewer: 'Sprzedawca' },
] as const;
export type WizardStepKey = typeof realizationWizardSteps[number]['key'];
export type WizardPayload = Record<string, string | number | boolean | null>;
export const wizardStatusLabels: Record<string, string> = {
  draft: 'Do uzupełnienia', submitted: 'Do sprawdzenia', changes_requested: 'Wymaga poprawy',
  approved: 'Zatwierdzony', stale: 'Dane zmieniły się — do ponownego sprawdzenia',
};
export const wizardFieldLabels: Record<string, string> = {
  source: 'Koordynacja', name: 'Imię i nazwisko', role: 'Stanowisko / rola', phone: 'Telefon', email: 'E-mail', note: 'Dodatkowe informacje',
  room: 'Sala / przestrzeń', participants: 'Liczba uczestników', access: 'Dojazd, dostęp i osoba otwierająca',
  schedule_confirmed: 'Termin sprawdzony', mode: 'Materiały', url: 'Link do materiałów',
  technical: 'Wymagania techniczne', logistics: 'Logistyka i noclegi', summary: 'Plan dla sprzedawcy',
  timeline: 'Timeline', team: 'Zespół', equipment: 'Sprzęt i rezerwacje', agenda: 'Agenda',
};
export const planChecks = [
  ['timeline', 'Timeline i godziny montażu / demontażu', 'phases'],
  ['team', 'Zespół i odpowiedzialności', 'team'],
  ['equipment', 'Sprzęt, dostępność i rezerwacje', 'equipment'],
  ['agenda', 'Agenda wydarzenia', 'agenda'],
  ['logistics', 'Logistyka, transport i noclegi', 'logistics'],
] as const;
export const wizardActionLabels: Record<string, string> = {
  save: 'Zapisano szkic', submit: 'Przekazano do sprawdzenia', approve: 'Zatwierdzono',
  changes_requested: 'Poproszono o poprawki', complete: 'Zatwierdzono przygotowania',
};
export type WizardStep = {
  key: WizardStepKey; status: string; available: boolean; revision: number; context_key: string; payload: WizardPayload;
  review_note?: string; submitted_at?: string; reviewed_at?: string; can_submit: boolean; can_review: boolean;
};
export type RealizationWizardState = {
  offer_id: string; event_id: string | null; partner_id: string; company_id: string; revision: number; finish_key: string;
  active: boolean; manager: boolean; seller: boolean; steps: WizardStep[];
  completed: boolean; completed_at?: string; can_complete: boolean; confirmation_required: boolean;
  client: SellerArrangements['client']; legacy_contact_body?: string;
  context: {
    location?: string; room?: string; participants?: number; starts_at?: string; ends_at?: string;
    technical?: string; logistics?: string; materials_due?: string;
    requirements: { name: string; technical?: string; logistics?: string; accommodation?: string }[];
  };
  history: { revision: number; step_key: string; action: string; at: string; payload?: WizardPayload; review_note?: string }[];
};
export function wizardPayloadValue(key: string, value: WizardPayload[string]): string {
  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie';
  if (key === 'source') return ({ seller: 'Osobista koordynacja', client: 'Klient z wydarzenia', other: 'Inny kontakt' } as Record<string, string>)[String(value)] || 'Nie wybrano';
  if (key === 'mode') return ({ none: 'Materiały nie są potrzebne', provided: 'Materiały pod linkiem' } as Record<string, string>)[String(value)] || 'Nie wybrano';
  return value == null ? '' : String(value);
}
