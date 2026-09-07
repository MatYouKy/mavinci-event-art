export interface PermissionScopeDefinition {
  key: string;
  label: string;
  description: string;
}

export interface PermissionScopeGroup {
  key: string;
  label: string;
  description: string;
  scopes: PermissionScopeDefinition[];
}

export const PERMISSION_SCOPE_GROUPS: PermissionScopeGroup[] = [
  {
    key: 'events',
    label: 'Wydarzenia i realizacja',
    description: 'Planowanie wydarzeń, kalendarz, zadania, oferty i umowy.',
    scopes: [
      { key: 'events_view', label: 'Podgląd wydarzeń', description: 'Widzi listę i dostępne szczegóły wydarzeń.' },
      { key: 'events_manage', label: 'Zarządzanie wydarzeniami', description: 'Może edytować wydarzenia i ich dane operacyjne.' },
      { key: 'events_create', label: 'Tworzenie wydarzeń', description: 'Może dodawać nowe wydarzenia.' },
      { key: 'event_categories_manage', label: 'Kategorie wydarzeń', description: 'Może zarządzać kategoriami wydarzeń.' },
      { key: 'calendar_view', label: 'Podgląd kalendarza', description: 'Widzi kalendarz wydarzeń i spotkań.' },
      { key: 'calendar_manage', label: 'Zarządzanie kalendarzem', description: 'Może tworzyć i edytować wpisy kalendarza.' },
      { key: 'calendar_view_accepted_only', label: 'Tylko zaakceptowane wydarzenia', description: 'W kalendarzu widzi wyłącznie zaakceptowane wydarzenia w ograniczonym zakresie.' },
      { key: 'tasks_view', label: 'Podgląd zadań', description: 'Widzi zadania dostępne dla pracownika.' },
      { key: 'tasks_manage', label: 'Zarządzanie zadaniami', description: 'Może edytować i przenosić zadania.' },
      { key: 'tasks_create', label: 'Tworzenie zadań', description: 'Może dodawać nowe zadania.' },
      { key: 'offers_view', label: 'Podgląd ofert', description: 'Widzi oferty, produkty i szablony ofert.' },
      { key: 'offers_manage', label: 'Zarządzanie ofertami', description: 'Może edytować oferty i katalog produktów.' },
      { key: 'offers_create', label: 'Tworzenie ofert', description: 'Może przygotowywać nowe oferty.' },
      { key: 'contracts_view', label: 'Podgląd umów', description: 'Widzi umowy i ich szablony.' },
      { key: 'contracts_manage', label: 'Zarządzanie umowami', description: 'Może edytować, generować i podpisywać umowy.' },
      { key: 'contracts_create', label: 'Tworzenie umów', description: 'Może tworzyć nowe umowy.' },
      { key: 'attractions_view', label: 'Podgląd atrakcji', description: 'Widzi katalog atrakcji.' },
      { key: 'attractions_manage', label: 'Zarządzanie atrakcjami', description: 'Może edytować katalog atrakcji.' },
      { key: 'attractions_create', label: 'Tworzenie atrakcji', description: 'Może dodawać nowe atrakcje.' },
    ],
  },
  {
    key: 'sales',
    label: 'Sprzedaż i komunikacja',
    description: 'Klienci, zapytania, wiadomości, kampanie i integracje.',
    scopes: [
      { key: 'clients_view', label: 'Podgląd klientów', description: 'Widzi dane klientów.' },
      { key: 'clients_manage', label: 'Zarządzanie klientami', description: 'Może edytować dane klientów.' },
      { key: 'clients_create', label: 'Tworzenie klientów', description: 'Może dodawać nowych klientów.' },
      { key: 'contacts_view', label: 'Podgląd kontaktów', description: 'Widzi osoby i organizacje w bazie kontaktów.' },
      { key: 'contacts_manage', label: 'Zarządzanie kontaktami', description: 'Może edytować i przypisywać kontakty.' },
      { key: 'contacts_create', label: 'Tworzenie kontaktów', description: 'Może dodawać osoby i organizacje.' },
      { key: 'inquiries_view', label: 'Dostęp do zapytań', description: 'Otwiera moduł zapytań sprzedażowych.' },
      { key: 'inquiries_manage', label: 'Zarządzanie zapytaniami', description: 'Podstawowy zakres zarządzania zapytaniami.' },
      { key: 'inquiries_view_pool', label: 'Wspólna kolejka zapytań', description: 'Widzi nowe, jeszcze nieprzypisane zapytania.' },
      { key: 'inquiries_view_own', label: 'Własne zapytania', description: 'Widzi zapytania, których jest opiekunem.' },
      { key: 'inquiries_manage_own', label: 'Obsługa własnych zapytań', description: 'Może aktualizować własne zapytania.' },
      { key: 'inquiries_view_team', label: 'Podgląd zapytań zespołu', description: 'Widzi zapytania swojego zespołu sprzedaży.' },
      { key: 'inquiries_manage_team', label: 'Obsługa zapytań zespołu', description: 'Może zarządzać zapytaniami swojego zespołu.' },
      { key: 'inquiries_view_all', label: 'Podgląd wszystkich zapytań', description: 'Widzi zapytania wszystkich zespołów.' },
      { key: 'inquiries_manage_all', label: 'Zarządzanie wszystkimi zapytaniami', description: 'Może obsługiwać zapytania wszystkich zespołów.' },
      { key: 'inquiries_assign', label: 'Przypisywanie zapytań', description: 'Może przejmować zapytania i zmieniać opiekuna.' },
      { key: 'messages_view', label: 'Podgląd wiadomości', description: 'Widzi udostępnione skrzynki i wiadomości.' },
      { key: 'messages_manage', label: 'Zarządzanie wiadomościami', description: 'Może obsługiwać wiadomości i konta pocztowe.' },
      { key: 'messages_assign', label: 'Przypisywanie wiadomości', description: 'Może przekazywać wiadomości pracownikom.' },
      { key: 'marketing_campaigns_view', label: 'Podgląd marketingu', description: 'Widzi kampanie, ruch, wiadomości społecznościowe i analizy przypisanych marek.' },
      { key: 'marketing_campaigns_manage', label: 'Zarządzanie marketingiem', description: 'Może łączyć konta Meta i Google, synchronizować dane oraz zmieniać status kampanii.' },
      { key: 'marketing_campaigns_approve', label: 'Zatwierdzanie kampanii e-mail', description: 'Może dopuścić kampanię e-mail do właściwej wysyłki.' },
      { key: 'chat_view', label: 'Dostęp do komunikatora', description: 'Może korzystać z komunikatora pracowników.' },
      { key: 'chat_manage', label: 'Zarządzanie komunikatorem', description: 'Może zarządzać rozmowami i uczestnikami.' },
      { key: 'chat_create_group', label: 'Tworzenie grup', description: 'Może zakładać rozmowy grupowe.' },
      { key: 'webhooks_view', label: 'Podgląd webhooków', description: 'Widzi zdarzenia odebrane ze stron zewnętrznych.' },
      { key: 'webhooks_manage', label: 'Zarządzanie webhookami', description: 'Może tworzyć źródła, klucze i reguły webhooków.' },
    ],
  },
  {
    key: 'operations',
    label: 'Zasoby i operacje',
    description: 'Magazyn, flota, lokalizacje, podwykonawcy i czas pracy.',
    scopes: [
      { key: 'equipment_view', label: 'Podgląd magazynu', description: 'Widzi sprzęt, zestawy, przewody i dostępność.' },
      { key: 'equipment_manage', label: 'Zarządzanie magazynem', description: 'Może edytować sprzęt i operacje magazynowe.' },
      { key: 'equipment_create', label: 'Dodawanie sprzętu', description: 'Może dodawać nowe pozycje magazynowe.' },
      { key: 'fleet_view', label: 'Podgląd floty', description: 'Widzi pojazdy, wykorzystanie i stan zgodności.' },
      { key: 'fleet_manage', label: 'Zarządzanie flotą', description: 'Może edytować pojazdy i obsługiwać ich użytkowanie.' },
      { key: 'fleet_create', label: 'Dodawanie pojazdów', description: 'Może dodawać pojazdy do floty.' },
      { key: 'locations_view', label: 'Podgląd lokalizacji', description: 'Widzi bazę lokalizacji.' },
      { key: 'locations_manage', label: 'Zarządzanie lokalizacjami', description: 'Może edytować lokalizacje.' },
      { key: 'locations_create', label: 'Tworzenie lokalizacji', description: 'Może dodawać nowe lokalizacje.' },
      { key: 'subcontractors_manage', label: 'Zarządzanie podwykonawcami', description: 'Może zarządzać podwykonawcami i ich usługami.' },
      { key: 'time_tracking_view', label: 'Podgląd czasu pracy', description: 'Widzi dostępne ewidencje czasu pracy.' },
      { key: 'time_tracking_manage', label: 'Zarządzanie czasem pracy', description: 'Może kontrolować i korygować ewidencję czasu.' },
    ],
  },
  {
    key: 'mavinci-live',
    label: 'Mavinci LIVE',
    description: 'Biblioteki teleturniejów, presety Light Magic i synchronizacja aplikacji realizacyjnej.',
    scopes: [
      { key: 'mavinci_live_view', label: 'Podgląd Mavinci LIVE', description: 'Widzi pytania, presety, użytkowników i stan synchronizacji.' },
      { key: 'mavinci_live_manage', label: 'Zarządzanie Mavinci LIVE', description: 'Może edytować bank pytań, importować presety i usuwać dane.' },
      { key: 'mavinci_live_light_magic', label: 'Light Magic', description: 'Może uruchamiać sterowanie światłem. Ta sekcja jest obowiązkowa przy dostępie do Mavinci LIVE.' },
      { key: 'mavinci_live_quiz_show', label: 'Quiz Show', description: 'Może otwierać i prowadzić rozgrywki Quiz Show.' },
      { key: 'mavinci_live_familiada', label: 'Familiada', description: 'Może otwierać i prowadzić teleturniej Familiada.' },
      { key: 'mavinci_live_wedding_show', label: 'Wedding Show', description: 'Może otwierać i prowadzić scenariusze Wedding Show.' },
      { key: 'mavinci_live_streaming', label: 'Streaming', description: 'Może korzystać z modułów transmisji i dostępu uczestników.' },
    ],
  },
  {
    key: 'finance',
    label: 'Finanse i dane',
    description: 'Finanse wydarzeń, faktury, bazy danych i przetargi.',
    scopes: [
      { key: 'finances_view', label: 'Podgląd finansów', description: 'Widzi wartości finansowe i koszty wydarzeń.' },
      { key: 'finances_manage', label: 'Zarządzanie finansami', description: 'Może edytować budżety i dane finansowe.' },
      { key: 'invoices_view', label: 'Podgląd faktur', description: 'Widzi faktury oraz dane KSeF.' },
      { key: 'invoices_manage', label: 'Zarządzanie fakturami', description: 'Może wystawiać faktury i konfigurować KSeF.' },
      { key: 'databases_view', label: 'Podgląd baz danych', description: 'Widzi udostępnione bazy danych.' },
      { key: 'databases_manage', label: 'Zarządzanie bazami danych', description: 'Może tworzyć, edytować i udostępniać bazy.' },
      { key: 'tenders_view', label: 'Podgląd przetargów', description: 'Widzi przetargi i wyniki dopasowania.' },
    ],
  },
  {
    key: 'administration',
    label: 'Administracja i strona WWW',
    description: 'Pracownicy, ustawienia oraz treści strony publicznej.',
    scopes: [
      { key: 'employees_view', label: 'Podgląd pracowników', description: 'Widzi listę i profile pracowników.' },
      { key: 'employees_manage', label: 'Zarządzanie pracownikami', description: 'Może edytować dane pracowników.' },
      { key: 'employees_create', label: 'Tworzenie pracowników', description: 'Może dodawać konta pracowników.' },
      { key: 'employees_permissions', label: 'Nadawanie uprawnień', description: 'Może zmieniać zakresy dostępu pracowników.' },
      { key: 'page_view', label: 'Podgląd panelu strony', description: 'Widzi treści i analitykę strony publicznej.' },
      { key: 'page_manage', label: 'Zarządzanie panelem strony', description: 'Może zarządzać ustawieniami strony publicznej.' },
      { key: 'website_edit', label: 'Edycja strony WWW', description: 'Może edytować portfolio, usługi, zespół i pozostałe treści.' },
    ],
  },
];

export const ALL_PERMISSION_SCOPES = Array.from(
  new Set(PERMISSION_SCOPE_GROUPS.flatMap((group) => group.scopes.map((scope) => scope.key))),
);

const permissionMap = new Map(
  PERMISSION_SCOPE_GROUPS.flatMap((group) => group.scopes.map((scope) => [scope.key, scope] as const)),
);

export const getPermissionDefinition = (key: string) => permissionMap.get(key);

export const getPermissionLabel = (key: string) =>
  getPermissionDefinition(key)?.label || key.replace(/_/g, ' ');
