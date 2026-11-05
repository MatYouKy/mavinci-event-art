import { systemLabel } from '@/lib/ui/systemLabels';

/** Values accepted by submit_seller_inquiry / submit_public_seller_inquiry. */
export type SellerInquiryEventType = 'wedding' | 'conference' | 'gala' | 'party' | 'corporate' | 'other';

export const sellerInquiryEventTypes: { value: SellerInquiryEventType; label: string }[] = [
  { value: 'wedding', label: 'Wesele' },
  { value: 'conference', label: 'Konferencja' },
  { value: 'gala', label: 'Gala' },
  { value: 'party', label: 'Przyjęcie / impreza' },
  { value: 'corporate', label: 'Event firmowy' },
  { value: 'other', label: 'Inne wydarzenie' },
];

export const sellerInquiryEventTypeLabel = (value: string | null | undefined) =>
  sellerInquiryEventTypes.find((item) => item.value === value)?.label || (value ? systemLabel(value, 'status', { fallback: 'Inne wydarzenie' }) : 'Rodzaj do ustalenia');

const statusLabels: Record<string, string> = {
  new: 'Wysłane do opiekuna',
  submitted: 'Wysłane do opiekuna',
  in_progress: 'Opiekun sprawdza termin',
  answered: 'Jest odpowiedź',
  converted: 'Przyjęte przez MAVINCI',
  closed: 'Zamknięte',
};
export const sellerInquiryStatusLabel = (value: string | null | undefined) =>
  (value && statusLabels[value]) || systemLabel(value, 'status', { fallback: 'Status w przygotowaniu' });

export const sellerInquiryStatusClass = (value: string | null | undefined) =>
  value === 'answered' ? 'bg-emerald-300/10 text-emerald-200'
    : value === 'converted' ? 'bg-[#d3bb73]/15 text-[#d3bb73]'
    : value === 'in_progress' ? 'bg-sky-300/10 text-sky-200'
    : value === 'closed' ? 'bg-white/5 text-white/50'
    : 'bg-white/5 text-white/70';

export const sellerInquirySourceLabel = (value: string | null | undefined) =>
  value === 'qr' ? 'Formularz QR' : 'Portal';

export type SellerInquiryValues = {
  guest_name: string;
  guest_company: string;
  guest_email: string;
  guest_phone: string;
  event_date: string;
  event_end_date: string;
  guest_count: string;
  event_type: SellerInquiryEventType | '';
  venue_note: string;
  budget_net: string;
  note: string;
};

export const emptySellerInquiry = (): SellerInquiryValues => ({
  guest_name: '', guest_company: '', guest_email: '', guest_phone: '',
  event_date: '', event_end_date: '', guest_count: '', event_type: '',
  venue_note: '', budget_net: '', note: '',
});

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Client-side check mirroring the RPC rules. Returns a Polish message or null. */
export function validateSellerInquiry(values: SellerInquiryValues, { datesValid = true }: { datesValid?: boolean } = {}): string | null {
  if (!values.guest_name.trim()) return 'Podaj imię i nazwisko gościa.';
  if (!values.guest_email.trim() && !values.guest_phone.trim()) return 'Podaj e-mail lub telefon, abyśmy mogli odpowiedzieć.';
  if (values.guest_email.trim() && !emailPattern.test(values.guest_email.trim())) return 'Sprawdź adres e-mail.';
  if (values.guest_phone.trim() && values.guest_phone.replace(/\D/g, '').length < 7) return 'Sprawdź numer telefonu.';
  if (!datesValid) return 'Wpisz datę w formacie DD.MM.RRRR.';
  if (!values.event_date) return 'Wybierz datę wydarzenia.';
  if (values.event_end_date && values.event_end_date < values.event_date) return 'Data zakończenia nie może być wcześniejsza niż data rozpoczęcia.';
  if (values.guest_count.trim()) {
    const count = Number(values.guest_count);
    if (!Number.isInteger(count) || count < 1 || count > 100000) return 'Liczba gości musi być liczbą całkowitą od 1 do 100 000.';
  }
  if (values.budget_net.trim()) {
    const budget = Number(values.budget_net.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(budget) || budget < 0) return 'Budżet musi być kwotą większą lub równą zero.';
  }
  return null;
}

/** p_values payload; empty optional fields are omitted. */
export function sellerInquiryPayload(values: SellerInquiryValues): Record<string, unknown> {
  const text = (value: string) => value.trim() || undefined;
  const budget = values.budget_net.trim() ? Number(values.budget_net.replace(/\s/g, '').replace(',', '.')) : undefined;
  const payload: Record<string, unknown> = {
    guest_name: values.guest_name.trim(),
    guest_company: text(values.guest_company),
    guest_email: text(values.guest_email.toLowerCase()),
    guest_phone: text(values.guest_phone),
    event_date: values.event_date,
    event_end_date: values.event_end_date || undefined,
    guest_count: values.guest_count.trim() ? Number(values.guest_count) : undefined,
    event_type: values.event_type || undefined,
    venue_note: text(values.venue_note),
    budget_net: budget,
    note: text(values.note),
  };
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

export type SellerInquiry = {
  id: string;
  my_company_id: string;
  brand_name: string | null;
  source: 'portal' | 'qr' | string;
  guest_name: string;
  guest_company: string | null;
  event_date: string | null;
  guest_count: number | null;
  event_type: string | null;
  status: string;
  response: string | null;
  responded_at: string | null;
  created_at: string;
  label: string | null;
};

export const sellerDayLabel = (value: string | null | undefined) => {
  if (!value) return 'Termin do ustalenia';
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}.${month}.${year}` : value;
};
