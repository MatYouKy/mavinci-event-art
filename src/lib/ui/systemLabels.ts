/** Presentation only: never use translated labels as database or API values. */
const labels = {
  formCategory: {
    event_inquiry: 'Zapytanie o wydarzenie', team_join: 'Zgłoszenie do zespołu',
    general: 'Wiadomość ogólna', services: 'Zapytanie o usługę', service: 'Zapytanie o usługę',
    cooperation: 'Współpraca', contact_form: 'Formularz kontaktowy', recruitment: 'Rekrutacja',
  },
  eventType: {
    conference: 'Konferencja', gala: 'Gala', corporate: 'Wydarzenie firmowe',
    trade: 'Targi', trade_show: 'Targi', team: 'Integracja zespołu', team_building: 'Integracja zespołu',
    integration: 'Spotkanie integracyjne', wedding: 'Wesele', birthday: 'Urodziny',
    concert: 'Koncert', festival: 'Festiwal', other: 'Inne wydarzenie',
    contact_form: 'Formularz kontaktowy', event_inquiry: 'Zapytanie o wydarzenie',
    team_join: 'Zgłoszenie do zespołu', new_lead: 'Nowe zapytanie', lead_created: 'Nowe zapytanie',
    inquiry_created: 'Nowe zapytanie', form_submission: 'Wysłany formularz',
  },
  source: {
    event: 'Wydarzenie', inquiry: 'Zapytanie',
    contact_form: 'Formularz WWW', webhook: 'Integracja zewnętrzna', manual: 'Wprowadzone ręcznie',
    email: 'E-mail', email_ai: 'E-mail · kwalifikacja AI', received: 'E-mail przychodzący',
    sent: 'E-mail wychodzący', website: 'Strona WWW', phone: 'Telefon',
    facebook: 'Facebook', instagram: 'Instagram', messenger: 'Messenger', referral: 'Polecenie',
    seller: 'Portal sprzedawcy', sales_partner: 'Sprzedawca zewnętrzny', api: 'Integracja zewnętrzna',
  },
  status: {
    new: 'Nowe', todo: 'Do zrobienia', open: 'Otwarte', pending: 'Oczekuje', planned: 'Planowane',
    inquiry: 'Zapytanie', offer_to_send: 'Oferta do wysłania', offer_sent: 'Oferta wysłana',
    offer_accepted: 'Oferta zaakceptowana', in_preparation: 'W przygotowaniu', ready_for_live: 'Gotowe do realizacji',
    invoiced: 'Zafakturowane', contract_sent: 'Umowa wysłana', contract_signed: 'Umowa podpisana', viewed: 'Wyświetlone',
    scheduled: 'Zaplanowane', in_progress: 'W trakcie', in_review: 'Do sprawdzenia', review: 'Do sprawdzenia',
    completed: 'Zakończone', done: 'Zakończone', closed: 'Zamknięte', cancelled: 'Anulowane', canceled: 'Anulowane',
    draft: 'Szkic', sent: 'Wysłane', received: 'Odebrane', accepted: 'Zaakceptowane', approved: 'Zatwierdzone',
    rejected: 'Odrzucone', declined: 'Odrzucone', confirmed: 'Potwierdzone', unconfirmed: 'Niepotwierdzone',
    tentative: 'Wstępna rezerwacja', reserved: 'Zarezerwowane', booked: 'Zarezerwowane',
    active: 'Aktywne', inactive: 'Nieaktywne', suspended: 'Wstrzymane', archived: 'Archiwalne',
    blocked: 'Zablokowane', expired: 'Wygasłe', terminated: 'Rozwiązane', signed: 'Podpisane',
    pending_signature: 'Oczekuje na podpis', awaiting_signature: 'Oczekuje na podpis',
    pending_approval: 'Oczekuje na akceptację', awaiting_approval: 'Oczekuje na akceptację',
    awaiting_confirmation: 'Oczekuje na potwierdzenie', changes_requested: 'Wymaga zmian',
    contacted: 'Kontakt podjęty', qualified: 'Zakwalifikowane', proposal: 'Oferta wysłana',
    negotiation: 'Negocjacje', won: 'Wygrane', lost: 'Przegrane',
    paid: 'Opłacone', unpaid: 'Nieopłacone', partially_paid: 'Częściowo opłacone',
    partial: 'Częściowo rozliczone', overdue: 'Po terminie', refunded: 'Zwrócone',
    settled: 'Rozliczone', incurred: 'Koszt poniesiony', issued: 'Wystawione',
    processed: 'Przetworzone', processing: 'Przetwarzanie', queued: 'W kolejce',
    failed: 'Błąd', error: 'Błąd', success: 'Zakończone pomyślnie', ignored: 'Pominięte',
    delivered: 'Dostarczone', bounced: 'Niedostarczone', read: 'Przeczytane', unread: 'Nieprzeczytane',
    przeczytana: 'Przeczytane', nieprzeczytana: 'Nieprzeczytane', wysłana: 'Wysłane',
    connected: 'Rozmowa odbyta', no_answer: 'Brak odpowiedzi', busy: 'Zajęte',
    voicemail: 'Poczta głosowa', wrong_number: 'Błędny numer', missed: 'Nieodebrane',
    available: 'Dostępne', unavailable: 'Niedostępne', maintenance: 'W serwisie',
    in_use: 'W użyciu', damaged: 'Uszkodzone', retired: 'Wycofane',
    classified: 'Zakwalifikowane', manual_review: 'Wymaga sprawdzenia', skipped_continuation: 'Kontynuacja rozmowy',
  },
  priority: { low: 'Niski', normal: 'Normalny', medium: 'Średni', high: 'Wysoki', urgent: 'Pilny', critical: 'Krytyczny' },
  role: {
    admin: 'Administrator', administrator: 'Administrator', manager: 'Menedżer', event_manager: 'Kierownik wydarzenia',
    sales: 'Sprzedaż', salesperson: 'Sprzedawca', seller: 'Sprzedawca', sales_manager: 'Kierownik sprzedaży',
    logistics: 'Logistyka', technician: 'Technik', support: 'Wsparcie', freelancer: 'Współpracownik',
    dj: 'DJ', mc: 'Konferansjer', host: 'Prowadzący', assistant: 'Asystent', unassigned: 'Nieprzypisany',
    driver: 'Kierowca', coordinator: 'Koordynator', organizer: 'Organizator', owner: 'Opiekun',
    employee: 'Pracownik', staff: 'Obsługa', subcontractor: 'Podwykonawca', operator: 'Operator',
    sound_engineer: 'Realizator dźwięku', lighting_technician: 'Technik oświetlenia',
    sound_technician: 'Technik dźwięku', photographer: 'Fotograf', videographer: 'Operator kamery',
    instructor: 'Instruktor', animator: 'Animator', security: 'Ochrona', other: 'Inna rola',
  },
  access: {
    admin: 'Pełny dostęp', manager: 'Menedżer', lead: 'Kierownik', operator: 'Operator',
    external: 'Zewnętrzny', guest: 'Gość', unassigned: 'Nieprzypisany', instructor: 'Instruktor',
    employee: 'Pracownik', seller: 'Sprzedawca', user: 'Użytkownik', viewer: 'Tylko podgląd',
  },
  vehicle: {
    car: 'Samochód osobowy', passenger: 'Samochód osobowy', passenger_car: 'Samochód osobowy',
    van: 'Samochód dostawczy', truck: 'Samochód ciężarowy', bus: 'Autobus', minibus: 'Mikrobus',
    trailer: 'Przyczepa', semi_trailer: 'Naczepa', motorcycle: 'Motocykl', other: 'Inny pojazd',
  },
  ownership: { owned: 'Własny', leased: 'Leasing', leasing: 'Leasing', rented: 'Wynajęty', rental: 'Wynajęty', borrowed: 'Użyczony', external: 'Zewnętrzny' },
  fuel: { petrol: 'Benzyna', gasoline: 'Benzyna', diesel: 'Olej napędowy', electric: 'Elektryczny', hybrid: 'Hybrydowy', plug_in_hybrid: 'Hybryda ładowana z sieci', lpg: 'LPG', cng: 'CNG' },
  transmission: { automatic: 'Automatyczna', manual: 'Manualna', semi_automatic: 'Półautomatyczna' },
  phase: { loading: 'Załadunek', unloading: 'Rozładunek', setup: 'Montaż', rehearsal: 'Próba', event: 'Wydarzenie', breakdown: 'Demontaż', packing: 'Pakowanie', travel: 'Dojazd', return: 'Powrót', outbound: 'Dojazd', inbound: 'Powrót', preparation: 'Przygotowanie' },
  skill: { beginner: 'Początkujący', basic: 'Podstawowy', intermediate: 'Średniozaawansowany', advanced: 'Zaawansowany', expert: 'Ekspert' },
  absence: { vacation: 'Urlop wypoczynkowy', sick_leave: 'Zwolnienie lekarskie', unpaid_leave: 'Urlop bezpłatny', training: 'Szkolenie', remote_work: 'Praca zdalna', other: 'Inna nieobecność' },
  vehicleAttribute: { equipment: 'Wyposażenie', capacity: 'Pojemność', license_requirement: 'Wymagania prawne', technical: 'Parametry techniczne' },
  quizType: { single_choice: 'Jednokrotny wybór', multiple_choice: 'Wielokrotny wybór', true_false: 'Prawda lub fałsz', open: 'Pytanie otwarte', text: 'Odpowiedź tekstowa', image: 'Pytanie ze zdjęciem', audio: 'Pytanie dźwiękowe', video: 'Pytanie z filmem', ordering: 'Ustalanie kolejności', matching: 'Dopasowanie', numeric: 'Odpowiedź liczbowa' },
} satisfies Record<string, Record<string, string>>;

export type SystemLabelDomain = keyof typeof labels;
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';
const fallbackLabels: Record<SystemLabelDomain, string> = {
  formCategory: 'Inne zgłoszenie', eventType: 'Inny typ zgłoszenia', source: 'Inne źródło', status: 'Inny status',
  priority: 'Inny priorytet', role: 'Inna rola', access: 'Inny poziom dostępu', vehicle: 'Inny pojazd',
  ownership: 'Inna forma własności', fuel: 'Inne paliwo', transmission: 'Inna skrzynia biegów', phase: 'Inna faza', skill: 'Inny poziom',
  absence: 'Inna nieobecność', vehicleAttribute: 'Inna właściwość',
  quizType: 'Inny typ pytania',
};

export function systemLabel(value: unknown, domain: SystemLabelDomain = 'status', options: { preserveCustom?: boolean; fallback?: string } = {}): string {
  if (typeof value !== 'string' || !value.trim()) return 'Nie określono';
  const text = value.trim();
  const dictionary: Record<string, string> = labels[domain];
  const key = text.toLocaleLowerCase('pl-PL');
  if (Object.prototype.hasOwnProperty.call(dictionary, key)) return dictionary[key];
  if (Object.values(dictionary).some((label) => label.toLocaleLowerCase('pl-PL') === key)) return text;
  // Custom roles, names and descriptions are user content, not enum aliases.
  if (options.preserveCustom) return text;
  return options.fallback || fallbackLabels[domain];
}

export function systemTone(value: unknown, domain: SystemLabelDomain): BadgeTone {
  const code = typeof value === 'string' ? value.toLowerCase() : '';
  if (domain === 'priority') return ['critical', 'urgent'].includes(code) ? 'danger' : code === 'high' ? 'warning' : 'neutral';
  if (domain !== 'status') return domain === 'source' ? 'info' : 'brand';
  if (['failed', 'error', 'rejected', 'declined', 'overdue', 'lost', 'blocked', 'damaged'].includes(code)) return 'danger';
  if (['pending', 'new', 'todo', 'awaiting_confirmation', 'pending_approval', 'awaiting_approval', 'changes_requested', 'unpaid', 'partially_paid'].includes(code)) return 'warning';
  if (['accepted', 'approved', 'confirmed', 'completed', 'done', 'paid', 'settled', 'won', 'active', 'success', 'processed', 'connected'].includes(code)) return 'success';
  if (['in_progress', 'processing', 'sent', 'received', 'scheduled', 'contacted', 'qualified', 'proposal', 'negotiation'].includes(code)) return 'info';
  return 'neutral';
}

const generatedSubject = /^(?:((?:Nowe )?Zapytanie|Obsłuż):\s*)?(event_inquiry|team_join|general|services|service|cooperation|contact_form|recruitment)(?:\s*[-–—]\s*(.*))?$/i;

/** Translate only the known generated form-subject structure, never prose. */
export function formatSystemSubject(value?: string | null): string {
  const text = value?.trim() || 'Wiadomość bez tematu';
  const reply = text.match(/^((?:(?:re|fwd|fw|odp)\s*:\s*)+)(.+)$/i);
  if (reply) return `${reply[1]}${formatSystemSubject(reply[2])}`;
  const match = text.match(generatedSubject);
  if (!match) return text;
  const category = systemLabel(match[2], 'formCategory');
  const suffix = match[3] ? systemLabel(match[3], 'eventType', { preserveCustom: true }) : '';
  return `${match[1] ? `${match[1]}: ` : ''}${category}${suffix ? ` — ${suffix}` : ''}`;
}

export const inquiryTitleLabel = (value?: string | null) => formatSystemSubject(value).replace(/^Zapytanie:\s*/i, '');

export const systemNotificationText = (value?: string | null) => value
  ? value.split(' · ').map((part) => part.trim() ? formatSystemSubject(part) : part).join(' · ')
  : '';

export function formSubject(category: string, eventType?: string): string {
  return `${systemLabel(category, 'formCategory')}${eventType ? ` — ${systemLabel(eventType, 'eventType')}` : ''}`;
}

export type InquiryLabelDetails = {
  source_kind?: string | null; source_message_type?: string | null; source_name?: string | null;
  source_page?: string | null; category?: string | null; event_type?: string | null; subject?: string | null;
};

export function inquirySourceLabel(details?: InquiryLabelDetails | null): string {
  const source = details?.source_kind || details?.source_message_type || 'manual';
  if (source === 'webhook') return details?.source_name || systemLabel(source, 'source');
  if (source === 'manual' && details?.source_name) return details.source_name;
  const page = details?.source_page;
  const pages: Record<string, string> = { '/': 'Strona główna', '/kontakt': 'Kontakt', '/contact': 'Kontakt', '/oferta': 'Oferta', '/uslugi': 'Usługi', '/zespol': 'Zespół', '/team': 'Zespół' };
  return `${systemLabel(source, 'source')}${page && pages[page] ? ` · ${pages[page]}` : ''}`;
}

export function inquiryTypeLabels(title: string, details?: InquiryLabelDetails | null): string[] {
  const match = (details?.subject || title).trim().match(generatedSubject);
  const category = details?.category || match?.[2];
  const eventType = details?.event_type || match?.[3];
  const result = category ? [systemLabel(category, 'formCategory')] : [];
  if (eventType && Object.prototype.hasOwnProperty.call(labels.eventType, eventType.toLowerCase())) {
    result.push(systemLabel(eventType, 'eventType'));
  } else if (!match) {
    // New forms already have Polish subjects; recover their known event label.
    const suffix = (details?.subject || title).split(' — ')[1];
    if (suffix && Object.values(labels.eventType).some((label) => label === suffix)) result.push(suffix);
  }
  return [...new Set(result)];
}
