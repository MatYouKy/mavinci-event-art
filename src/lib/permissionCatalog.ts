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
    label: 'Eventy i realizacja',
    description: 'Planowanie eventów, kalendarz, zadania, oferty i umowy.',
    scopes: [
      { key: 'events_own_only', label: 'Tylko własne eventy', description: 'Ogranicza dostęp do spraw utworzonych przez pracownika lub przypisanych mu jako opiekun/sprzedawca. Sam zakres nie nadaje uprawnień do sekcji.' },
      { key: 'events_view', label: 'Podgląd eventów', description: 'Widzi listę i dostępne szczegóły eventów.' },
      { key: 'events_view_planning', label: 'Planowanie eventów', description: 'Widzi eventy od wysłania oferty, także przed jej akceptacją, bez dostępu handlowego.' },
      { key: 'events_view_operational', label: 'Eventy operacyjne', description: 'Widzi wszystkie potwierdzone, realizowane i zakończone eventy przypisanych marek.' },
      { key: 'events_manage', label: 'Zarządzanie eventami', description: 'Może edytować eventy i ich dane operacyjne.' },
      { key: 'events_create', label: 'Tworzenie eventów', description: 'Może dodawać nowe eventy.' },
      { key: 'event_categories_manage', label: 'Kategorie eventów', description: 'Może zarządzać kategoriami eventów.' },
      { key: 'calendar_view', label: 'Podgląd kalendarza', description: 'Widzi kalendarz eventów i spotkań.' },
      { key: 'calendar_manage', label: 'Zarządzanie kalendarzem', description: 'Może tworzyć i edytować wpisy kalendarza.' },
      { key: 'calendar_view_accepted_only', label: 'Potwierdzone eventy', description: 'W kalendarzu widzi eventy od akceptacji oferty przez całą realizację i archiwum.' },
      { key: 'tasks_view', label: 'Podgląd zadań', description: 'Widzi zadania dostępne dla pracownika.' },
      { key: 'tasks_manage', label: 'Zarządzanie zadaniami', description: 'Może edytować i przenosić zadania.' },
      { key: 'tasks_create', label: 'Tworzenie zadań', description: 'Może dodawać nowe zadania.' },
      { key: 'offers_own_only', label: 'Tylko własne oferty', description: 'Ogranicza dostęp do spraw utworzonych przez pracownika lub przypisanych mu jako opiekun/sprzedawca. Sam zakres nie nadaje uprawnień do sekcji.' },
      { key: 'offers_view', label: 'Podgląd ofert', description: 'Widzi oferty, produkty i szablony ofert.' },
      { key: 'offers_manage', label: 'Zarządzanie ofertami', description: 'Może edytować oferty i katalog produktów.' },
      { key: 'offers_brochures_view_own', label: 'Broszury — własne linki, PDF-y i statystyki', description: 'Widzi wersje broszur wygenerowane przez siebie oraz wejścia, dane i próbne PDF-y z własnych linków. Wymaga dostępu do ofert.' },
      { key: 'offers_brochures_view_all', label: 'Broszury — wyniki wszystkich pracowników', description: 'Może przełączyć widok Moje na Wszystkie i filtrować wyniki po pracowniku. Obejmuje też starsze, nieprzypisane wejścia. Administrator ma ten zakres automatycznie.' },
      { key: 'offers_create', label: 'Tworzenie ofert', description: 'Może przygotowywać nowe oferty.' },
      { key: 'contracts_own_only', label: 'Tylko własne umowy', description: 'Ogranicza dostęp do spraw utworzonych przez pracownika lub przypisanych mu jako opiekun/sprzedawca. Sam zakres nie nadaje uprawnień do sekcji.' },
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
      { key: 'presentations_view', label: 'Prezentacje — podgląd i pokaz', description: 'Przegląda i pokazuje klientom prezentacje ze strefy sprzedawcy (działy i karty widoczne na spotkaniach). Dostęp do ofert daje ten zakres automatycznie.' },
      { key: 'presentations_manage', label: 'Prezentacje — przygotowanie', description: 'Tworzy i porządkuje działy i karty prezentacji, dodaje zdjęcia, produkty z katalogu, korzyści, przygotowanie i pytania klientów; widzi też ukryte karty. „Zarządzanie ofertami” daje ten zakres automatycznie.' },
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
      { key: 'marketing_social_view', label: 'Social media — podgląd', description: 'Widzi kalendarz publikacji, bibliotekę zdjęć i posty przypisanych marek.' },
      { key: 'marketing_social_create', label: 'Social media — tworzenie', description: 'Tworzy posty w kreatorze, dodaje zdjęcia do biblioteki, ustawia zgodę klienta i wysyła posty do akceptacji.' },
      { key: 'marketing_social_approve', label: 'Social media — akceptacja', description: 'Zatwierdza posty innych osób albo odsyła je do poprawy; zarządza szablonami grafik i opisami AI marki.' },
      { key: 'marketing_social_publish', label: 'Social media — publikacja', description: 'Oznacza zatwierdzone posty jako opublikowane (w kolejnym etapie: publikacja i planowanie w Meta).' },
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
    description: 'Materiały firmy, magazyn, flota, lokalizacje, podwykonawcy i czas pracy.',
    scopes: [
      { key: 'materials_view', label: 'Materiały — podgląd', description: 'Przegląda, podgląda i pobiera materiały przypisanych marek (logotypy, zdjęcia, wideo, prezentacje, dokumenty). W wyszukiwaniu widzi też pliki eventów, do których ma dostęp.' },
      { key: 'materials_manage', label: 'Materiały — zarządzanie', description: 'Wgrywa i podmienia pliki, tworzy foldery, zmienia nazwy, przenosi, opisuje i usuwa materiały przypisanych marek, obsługuje kosz; zapisuje pliki eventów w Materiałach. Obejmuje podgląd.' },
      { key: 'equipment_view', label: 'Podgląd magazynu', description: 'Widzi sprzęt, zestawy, przewody i dostępność.' },
      { key: 'equipment_manage', label: 'Zarządzanie magazynem', description: 'Może edytować sprzęt i operacje magazynowe oraz przyjmować zaakceptowane realizacje do przygotowania.' },
      { key: 'equipment_create', label: 'Dodawanie sprzętu', description: 'Może dodawać nowe pozycje magazynowe.' },
      { key: 'fleet_view', label: 'Podgląd floty', description: 'Widzi pojazdy, wykorzystanie i stan zgodności.' },
      { key: 'fleet_manage', label: 'Zarządzanie flotą', description: 'Może edytować pojazdy i obsługiwać ich użytkowanie.' },
      { key: 'fleet_create', label: 'Dodawanie pojazdów', description: 'Może dodawać pojazdy do floty.' },
      { key: 'locations_view', label: 'Podgląd lokalizacji', description: 'Widzi bazę lokalizacji.' },
      { key: 'locations_manage', label: 'Zarządzanie lokalizacjami', description: 'Może edytować lokalizacje.' },
      { key: 'locations_create', label: 'Tworzenie lokalizacji', description: 'Może dodawać nowe lokalizacje.' },
      { key: 'subcontractors_manage', label: 'Zarządzanie podwykonawcami', description: 'Może zarządzać podwykonawcami i ich usługami.' },
      { key: 'time_tracking_view_own', label: 'Przeglądanie i raportowanie własnego czasu', description: 'Korzysta z ewidencji własnego czasu pracy bez dostępu do wpisów innych osób.' },
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
    description: 'Wartości finansowe eventów, bazy danych i przetargi. Finanse działalności — w sekcji „Finanse według działalności”.',
    scopes: [
      // Faktury, KSeF, bank, deklaracje i dokumenty działalności nadaje wyłącznie „Finanse według działalności”
      // (employees.finance_company_access). Stare invoices_view / invoices_manage / ksef_manage nic już nie nadają.
      { key: 'finances_view', label: 'Wartości finansowe eventów (budżet, koszty)', description: 'Widzi budżet, przychód, koszty i prowizje eventów, które widzi, w dostępnych działalnościach. Nie obejmuje banku, faktur ani dokumentów działalności.' },
      { key: 'finances_manage', label: 'Wartości finansowe eventów (budżet, koszty) — edycja', description: 'Może edytować budżety, koszty i prowizje widocznych eventów w dostępnych działalnościach. Nie obejmuje banku, faktur ani dokumentów działalności.' },
      { key: 'databases_view', label: 'Podgląd baz danych', description: 'Widzi udostępnione bazy danych.' },
      { key: 'databases_manage', label: 'Zarządzanie bazami danych', description: 'Może tworzyć, edytować i udostępniać bazy.' },
      { key: 'tenders_view', label: 'Podgląd przetargów', description: 'Widzi przetargi i wyniki dopasowania.' },
    ],
  },
  {
    // Osobna grupa (dotąd w „Finanse i dane”), żeby uprawnienie było widać od razu — w uprawnieniach pracownika to osobna
    // karta „Zakupy” (CRM `EmployeePermissionsTab`, Mac `EmployeePermissionsView`). Klucz zakresu bez zmian: `finances_purchases`.
    key: 'purchases',
    label: 'Zakupy',
    description: 'Zakupy firmową kartą: faktury spoza KSeF i paragony z NIP firmy (odczyt AI), koszty eventów i miesięczne rozliczenie do zatwierdzenia.',
    scopes: [
      { key: 'finances_purchases', label: 'Zakupy — własne wydatki', description: 'Zakupy → „Moje wydatki”: wprowadza zakupy robione firmową kartą (paragony z NIP i faktury spoza KSeF, z odczytem AI), przypisuje je do eventów jako koszt (widzi wtedy wszystkie koszty eventu, bez budżetu i przychodów) i co miesiąc wysyła rozliczenie do zatwierdzenia. Zatwierdza osoba z „Finanse — zarządzanie” w działalności.' },
    ],
  },
  {
    key: 'administration',
    label: 'Administracja i strona WWW',
    description: 'Pracownicy, ustawienia oraz treści strony publicznej.',
    scopes: [
      { key: 'personnel_view', label: 'Podgląd umów i wynagrodzeń zespołu', description: 'Widzi współpracowników, umowy, stawki i rozliczenia personelu.' },
      { key: 'personnel_manage', label: 'Zarządzanie umowami i wynagrodzeniami', description: 'Może tworzyć umowy, szablony, stawki oraz zatwierdzać rozliczenia.' },
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

/** Zakupy → „Moje wydatki” (`docs/purchases.md`) — w uprawnieniach pracownika osobna karta „Zakupy”. */
export const PURCHASES_PERMISSION = 'finances_purchases';

export const ALL_PERMISSION_SCOPES = Array.from(
  new Set(PERMISSION_SCOPE_GROUPS.flatMap((group) => group.scopes.map((scope) => scope.key))),
);

const permissionMap = new Map(
  PERMISSION_SCOPE_GROUPS.flatMap((group) => group.scopes.map((scope) => [scope.key, scope] as const)),
);

export const getPermissionDefinition = (key: string) => permissionMap.get(key);

export const getPermissionLabel = (key: string) =>
  getPermissionDefinition(key)?.label || (key === 'admin' ? 'Pełny dostęp administratora' : 'Dodatkowe uprawnienie');
