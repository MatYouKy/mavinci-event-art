/** Zakładki wydarzeń, kontaktów i organizacji nadawane w „Uprawnieniach” pracownika (CRM i aplikacja na Maca). */
export const EVENT_TABS = [
  { value: 'overview', label: 'Przegląd', description: 'Podstawowe informacje o wydarzeniu' },
  { value: 'details', label: 'Szczegóły', description: 'Podstawowe informacje o wydarzeniu' },
  { value: 'phases', label: 'Timeline', description: 'Zarządzanie fazami wydarzenia' },
  { value: 'offer', label: 'Oferta', description: 'Tworzenie i zarządzanie ofertami' },
  { value: 'finances', label: 'Finanse', description: 'Budżet i koszty wydarzenia' },
  { value: 'contract', label: 'Umowa', description: 'Zarządzanie umowami' },
  { value: 'equipment', label: 'Sprzęt', description: 'Lista sprzętu przypisanego do wydarzenia' },
  { value: 'team', label: 'Zespół', description: 'Pracownicy przypisani do wydarzenia' },
  { value: 'agenda', label: 'Agenda', description: 'Zarządzanie agenda wydarzenia' },
  { value: 'logistics', label: 'Logistyka', description: 'Pojazdy i transport' },
  { value: 'subcontractors', label: 'Podwykonawcy', description: 'Zewnętrzni wykonawcy' },
  { value: 'files', label: 'Pliki', description: 'Dokumenty i załączniki' },
  { value: 'tasks', label: 'Zadania', description: 'Zarządzanie zadaniami' },
  { value: 'history', label: 'Historia', description: 'Dziennik zmian wydarzenia' },
];

export const CONTACT_TABS = [
  { value: 'details', label: 'Szczegóły', description: 'Podstawowe informacje o kontakcie' },
  { value: 'notes', label: 'Notatki', description: 'Notatki i uwagi dotyczące kontaktu' },
  { value: 'history', label: 'Historia', description: 'Historia kontaktów i zmian' },
];

export const ORGANIZATION_TABS = [
  { value: 'details', label: 'Szczegóły', description: 'Podstawowe informacje o organizacji' },
  { value: 'contacts', label: 'Kontakty', description: 'Osoby kontaktowe w organizacji' },
  { value: 'invoices', label: 'Faktury', description: 'Faktury powiązane z organizacją' },
  { value: 'events', label: 'Realizacje', description: 'Wydarzenia powiązane z organizacją' },
  { value: 'notes', label: 'Notatki', description: 'Notatki dotyczące organizacji' },
  { value: 'history', label: 'Historia', description: 'Historia zmian i kontaktów' },
];

/** Sekcje Mavinci LIVE (Light Magic jest zawsze dostępny przy dostępie do modułu). */
export const MAVINCI_LIVE_SECTION_SCOPES = [
  'mavinci_live_light_magic',
  'mavinci_live_quiz_show',
  'mavinci_live_familiada',
  'mavinci_live_wedding_show',
  'mavinci_live_streaming',
] as const;

/** Stare uprawnienia finansowe — od migracji 20261101165000 niczego nie nadają w bazie; przy zapisie są usuwane. */
export const LEGACY_FINANCE_PERMISSIONS = ['invoices_view', 'invoices_manage', 'ksef_manage', 'bank_statements_view', 'bank_statements_manage'];

/** Moduły z wyborem „Zakres danych” (tylko własne / wszystkie) — jak `RecordScopeSelect`. */
export const RECORD_SCOPE_MODULE_KEYS = ['contracts', 'offers', 'events'];
