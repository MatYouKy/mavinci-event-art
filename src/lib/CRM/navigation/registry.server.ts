import 'server-only';

/**
 * To jest typ, który przechodzi z serwera na klienta.
 * Nie ma tu komponentów, tylko JSON-safe dane.
 */
export type NavKey =
  | 'dashboard'
  | 'calendar'
  | 'meetings'
  | 'events'
  | 'materials'
  | 'mavinci-live'
  | 'messages'
  | 'marketing-campaigns'
  | 'inquiries'
  | 'tasks'
  | 'tasks-company'
  | 'tasks-mine'
  | 'employees'
  | 'collaborators'
  | 'personnel-contracts'
  | 'salespeople'
  | 'presentations'
  | 'offers'
  | 'contacts'
  | 'contracts'
  | 'equipment'
  | 'fleet'
  | 'page'
  | 'invoices'
  | 'locations'
  | 'time-tracking'
  | 'databases'
  | 'tenders';

export type NavigationItemDTO = {
  key: NavKey;
  name: string;
  href: string;
  iconKey: string; // string, bo to leci do klienta przez JSON
  module?: string;
  permissions?: string[]; // do filtrowania po uprawnieniach (wszystkie wymagane)
  /** Wystarczy jedno z uprawnień (np. moduł dostępny dla kontaktów LUB sprzedaży). */
  anyPermissions?: string[];
  /** Pozycja widoczna przy dostępie do finansów co najmniej „Własna sprzedaż” w którejś działalności. */
  financeCompanyAccess?: boolean;
  children?: NavigationItemDTO[]; // submenu
};

export const allNavigation: NavigationItemDTO[] = [
  {
    key: 'dashboard',
    name: 'Dashboard',
    href: '/crm',
    iconKey: 'dashboard',
  },
  {
    key: 'calendar',
    name: 'Kalendarz',
    href: '/crm/calendar',
    iconKey: 'calendar',
    module: 'calendar',
    permissions: ['calendar_view'],
  },
  {
    key: 'meetings',
    name: 'Spotkania',
    href: '/crm/meetings',
    iconKey: 'meetings',
    module: 'calendar',
    permissions: ['calendar_view'],
  },
  {
    key: 'events',
    name: 'Eventy',
    href: '/crm/events',
    iconKey: 'events',
    module: 'events',
    permissions: ['events_view'],
  },
  {
    // Dysk — chmura firmy jak w Finderze: Eventy, Materiały (baza plików marek), Oferty, Kalkulacje, Umowy, Magazyn i Pracownicy.
    // Widać go z dostępem do któregokolwiek działu (które działy — decyduje `/bridge/native/v1/drive?op=root`).
    key: 'materials',
    name: 'Dysk',
    href: '/crm/materials',
    iconKey: 'materials',
    module: 'materials',
    anyPermissions: [
      'materials_view', 'materials_manage', 'events_view', 'events_view_planning', 'events_view_operational', 'events_manage', 'events_create',
      'calendar_view', 'offers_view', 'offers_create', 'offers_manage', 'contracts_view', 'contracts_manage', 'contracts_create',
      'equipment_view', 'equipment_manage', 'equipment_create', 'inquiries_view', 'inquiries_manage', 'inquiries_view_pool', 'inquiries_view_own',
      'inquiries_manage_own', 'inquiries_view_team', 'inquiries_manage_team', 'inquiries_view_all', 'inquiries_manage_all',
      'employees_view', 'employees_manage', 'personnel_view', 'personnel_manage',
    ],
  },
  {
    key: 'mavinci-live',
    name: 'Mavinci LIVE',
    href: '/crm/mavinci-live',
    iconKey: 'mavinciLive',
    module: 'mavinci_live',
    permissions: ['mavinci_live_view'],
  },
  {
    key: 'messages',
    name: 'Wiadomości',
    href: '/crm/messages',
    iconKey: 'messages',
    module: 'messages',
    permissions: ['messages_view'],
  },
  {
    key: 'marketing-campaigns',
    name: 'Marketing',
    href: '/crm/page',
    iconKey: 'campaigns',
    module: 'marketing_campaigns',
    permissions: ['marketing_campaigns_view'],
    children: [
      {
        key: 'marketing-campaigns',
        name: 'Panel marketingowy',
        href: '/crm/page',
        iconKey: 'campaigns',
        module: 'marketing_campaigns',
        permissions: ['marketing_campaigns_view'],
      },
      {
        key: 'marketing-campaigns',
        name: 'Kampanie e-mail',
        href: '/crm/campaigns',
        iconKey: 'messages',
        module: 'marketing_campaigns',
        permissions: ['marketing_campaigns_view'],
      },
      {
        key: 'marketing-campaigns',
        name: 'Social media',
        href: '/crm/marketing/social',
        iconKey: 'social',
        module: 'marketing_social',
        anyPermissions: ['marketing_social_view', 'marketing_social_create', 'marketing_social_approve', 'marketing_social_publish'],
      },
      {
        key: 'marketing-campaigns',
        name: 'Realizacje',
        href: '/crm/marketing/portfolio',
        iconKey: 'portfolio',
        module: 'marketing_portfolio',
        anyPermissions: ['website_edit', 'page_manage'],
      },
    ],
  },
  {
    key: 'inquiries',
    name: 'Zapytania',
    href: '/crm/inquiries',
    iconKey: 'inquiries',
    module: 'inquiries',
    permissions: ['inquiries_view'],
  },
  {
    key: 'tasks',
    name: 'Zadania',
    href: '/crm/tasks',
    iconKey: 'tasks',
    children: [
      { key: 'tasks-company', name: 'Zadania firmowe', href: '/crm/tasks', iconKey: 'tasks', module: 'tasks', permissions: ['tasks_view'] },
      { key: 'tasks-mine', name: 'Moje zadania', href: '/crm/tasks/mine', iconKey: 'tasks' },
    ],
  },
  {
    key: 'employees',
    name: 'Zespół',
    href: '/crm/employees',
    iconKey: 'employees',
    children: [
      { key: 'employees', name: 'Pracownicy CRM', href: '/crm/employees', iconKey: 'employees', module: 'employees', permissions: ['employees_view'] },
      { key: 'collaborators', name: 'Współpracownicy', href: '/crm/employees/collaborators', iconKey: 'contacts', module: 'personnel', permissions: ['personnel_view'] },
      { key: 'personnel-contracts', name: 'Umowy', href: '/crm/employees/contracts', iconKey: 'contracts', module: 'personnel', permissions: ['personnel_view'] },
    ],
  },
  {
    // Strefa sprzedawcy: sprzedawcy zewnętrzni (agencje, hotele) i Prezentacje — materiały na spotkania z klientami.
    // Klucz grupy zostaje `salespeople` (zapisana kolejność menu pracowników).
    key: 'salespeople',
    name: 'Strefa sprzedawcy',
    href: '/crm/salespeople',
    iconKey: 'salespeople',
    children: [
      {
        key: 'salespeople',
        name: 'Sprzedawcy',
        href: '/crm/salespeople',
        iconKey: 'salespeople',
        module: 'clients',
        // Opiekun sprzedawców zewnętrznych to pracownik sprzedaży (offers_manage), nie tylko osoba z dostępem do kontaktów.
        // Zakres danych (tylko moi sprzedawcy) wymusza baza: get_my_seller_cockpit / get_crm_seller_directory.
        anyPermissions: ['contacts_view', 'offers_manage', 'finances_manage'],
      },
      {
        // Prezentacje: podgląd — dostęp do ofert albo `presentations_view`; przygotowanie — `presentations_manage` / `offers_manage`
        // (te same reguły co RLS: `sales_showcase_can`).
        key: 'presentations',
        name: 'Prezentacje',
        href: '/crm/presentations',
        iconKey: 'presentations',
        module: 'presentations',
        anyPermissions: ['presentations_view', 'presentations_manage', 'offers_view', 'offers_create', 'offers_manage'],
      },
    ],
  },
  {
    key: 'offers',
    name: 'Oferty',
    href: '/crm/offers',
    iconKey: 'offers',
    module: 'offers',
    permissions: ['offers_view'],
    children: [
      {
        key: 'offers',
        name: 'Oferty',
        href: '/crm/offers',
        iconKey: 'fileText',
        module: 'offers',
        permissions: ['offers_view'],
      },
      {
        key: 'offers',
        name: 'Produkty',
        href: '/crm/offers?tab=catalog',
        iconKey: 'package',
        module: 'offers',
        permissions: ['offers_view'],
      },
      {
        key: 'offers',
        name: 'Szablony',
        href: '/crm/offers?tab=templates',
        iconKey: 'fileType',
        module: 'offers',
        permissions: ['offers_view'],
      },
      {
        // Cenniki sezonowe marek (cena oferty według roku eventu) — `PriceListsManager`, Mac `PriceListsView`.
        key: 'offers',
        name: 'Cenniki',
        href: '/crm/offers?tab=pricelists',
        iconKey: 'tags',
        module: 'offers',
        permissions: ['offers_view'],
      },
      {
        key: 'offers',
        name: 'Broszury',
        href: '/crm/brochures',
        iconKey: 'bookOpen',
        module: 'offers',
        permissions: ['offers_view'],
      },
    ],
  },
  {
    key: 'contacts',
    name: 'Kontakty',
    href: '/crm/contacts',
    iconKey: 'contacts',
    module: 'clients',
    permissions: ['contacts_view'],
  },
  {
    key: 'contracts',
    name: 'Umowy z klientami',
    href: '/crm/contracts',
    iconKey: 'contracts',
    module: 'contracts',
    permissions: ['contracts_view'],
    children: [
      {
        key: 'contracts',
        name: 'Umowy',
        href: '/crm/contracts',
        iconKey: 'fileText',
        module: 'contracts',
        permissions: ['contracts_view'],
      },
      {
        key: 'contracts',
        name: 'Szablony umów',
        href: '/crm/contract-templates',
        iconKey: 'fileType',
        module: 'contracts',
        permissions: ['contracts_view'],
      },
    ],
  },
  {
    key: 'equipment',
    name: 'Magazyn',
    href: '/crm/equipment',
    iconKey: 'equipment',
    module: 'equipment',
    permissions: ['equipment_view'],
    children: [
      {
        key: 'equipment',
        name: 'Sprzęt',
        href: '/crm/equipment',
        iconKey: 'box',
        module: 'equipment',
        permissions: ['equipment_view'],
      },
      {
        key: 'equipment',
        name: 'Zestawy',
        href: '/crm/equipment/kits',
        iconKey: 'layers',
        module: 'equipment',
        permissions: ['equipment_view'],
      },
      {
        key: 'equipment',
        name: 'Przewody',
        href: '/crm/equipment/cables',
        iconKey: 'cable',
        module: 'equipment',
        permissions: ['equipment_view'],
      },
      {
        key: 'equipment',
        name: 'Rental',
        href: '/crm/equipment/rental',
        iconKey: 'packageOpen',
        module: 'equipment',
        permissions: ['equipment_view'],
      },
      {
        key: 'equipment',
        name: 'Wtyki',
        href: '/crm/equipment/connectors',
        iconKey: 'plug',
        module: 'equipment',
        permissions: ['equipment_view'],
      },
      {
        key: 'equipment',
        name: 'Kategorie',
        href: '/crm/equipment/categories',
        iconKey: 'folderTree',
        module: 'equipment',
        permissions: ['equipment_view'],
      },
    ],
  },
  {
    key: 'fleet',
    name: 'Flota',
    href: '/crm/fleet',
    iconKey: 'fleet',
    module: 'fleet',
    permissions: ['fleet_view'],
  },
  {
    key: 'page',
    name: 'Strona',
    href: '/crm/page?tab=website',
    iconKey: 'page',
    module: 'page',
    permissions: ['page_view'],
  },
  {
    key: 'invoices',
    name: 'Finanse',
    href: '/crm/invoices',
    iconKey: 'invoices',
    module: 'invoices',
    financeCompanyAccess: true,
  },
  {
    key: 'locations',
    name: 'Lokalizacje',
    href: '/crm/locations',
    iconKey: 'locations',
    module: 'locations',
    permissions: ['locations_view'],
  },
  {
    key: 'time-tracking',
    name: 'Czas pracy',
    href: '/crm/time-tracking',
    iconKey: 'time', // <— ważne: iconKey to klucz mapy ikon, nie musi = key
    module: 'time_tracking',
    permissions: ['time_tracking_view'],
  },
  {
    key: 'databases',
    name: 'Bazy Danych',
    href: '/crm/databases',
    iconKey: 'databases',
    module: 'databases',
    permissions: ['databases_view'],
  },
  {
    key: 'tenders',
    name: 'Przetargi',
    href: '/crm/tenders',
    iconKey: 'tenders',
    module: 'tenders',
    permissions: ['tenders_view'],
  },
];
