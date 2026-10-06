import type { HotelVenueSnapshot } from './hotel';

export type ArrangementContact = {
  name: string;
  role: string;
  email: string;
  phone: string;
};

export const arrangementSchedule = [
  ['setup_at', 'Montaż'],
  ['starts_at', 'Początek wydarzenia'],
  ['ends_at', 'Koniec wydarzenia'],
  ['teardown_at', 'Demontaż'],
] as const;
export type ArrangementScheduleKey = typeof arrangementSchedule[number][0];

export type SellerArrangements = {
  can_edit: boolean;
  values: Partial<Record<ArrangementScheduleKey, string | null>> & {
    revision: number;
    room?: string;
    venue_snapshot?: HotelVenueSnapshot | null;
    participant_count?: number | null;
    materials_due_date?: string | null;
    technical_requirements?: string;
    logistics_requirements?: string;
    contacts?: ArrangementContact[];
    updated_at?: string;
  };
  offer: {
    id: string;
    title?: string | null;
    event_date?: string | null;
    location?: string | null;
    status: string;
    base_net?: number | null;
    client_net?: number | null;
  };
  client: { name?: string | null; company?: string | null; email?: string | null; phone?: string | null };
  event: (Partial<Record<ArrangementScheduleKey, string | null>> & {
    id: string;
    name: string;
    status: string;
    location?: string | null;
    can_view_crm: boolean;
  }) | null;
  team: (ArrangementContact & { id: string })[];
};

// These timestamps are explicitly local Europe/Warsaw values, not UTC instants.
export function arrangementLocalDate(value?: string | null) {
  if (!value) return 'Nie ustalono';
  const [date, time] = value.split('T');
  return date.split('-').reverse().join('.') + (time ? `, ${time.slice(0, 5)}` : '');
}

export function sellerArrangementError(error: unknown) {
  const value = error as { code?: string; message?: string } | null;
  if (['PGRST202', '42P01', '42883'].includes(value?.code || '')) {
    return 'Ta funkcja wymaga migracji 20260909143000. Poproś administratora o jej uruchomienie.';
  }
  return value?.message || 'Nie udało się wczytać lub zapisać danych. Spróbuj ponownie.';
}

// A note on the existing explicit review request identifies the saved revision;
// it is not another conversation and never changes approval on an ordinary save.
export function sellerArrangementReviewNote(data: SellerArrangements) {
  const values = data.values;
  return [
    `Ustalenia realizacji — wersja ${values.revision}. Pełne dane w sekcji Ustalenia realizacji.`,
    data.offer.location && `Miejsce z oferty: ${data.offer.location}`,
    values.room && `Sala / przestrzeń: ${values.room}`,
    values.participant_count != null && `Uczestnicy: ${values.participant_count}`,
    ...arrangementSchedule.map(([key, label]) => values[key] && `${label}: ${arrangementLocalDate(values[key])}`),
    values.materials_due_date && `Materiały do: ${arrangementLocalDate(values.materials_due_date)}`,
    'Godziny: Europe/Warsaw. Dyskusja i propozycje zmian pozostają w rozmowie o ofercie.',
  ].filter(Boolean).join('\n').slice(0, 5000);
}
