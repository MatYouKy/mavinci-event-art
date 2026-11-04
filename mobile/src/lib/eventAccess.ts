/**
 * Obszary danych wydarzenia i zakładki — wspólne dla CRM i aplikacji mobilnej.
 * Identyczna kopia: mobile/src/lib/eventAccess.ts (pilnuje scripts/ci/check-shared-copies.mjs).
 * Źródło prawdy to baza: RPC get_event_access(p_event_id) (migracja 20261105090000) i reguły RLS.
 * Ten plik tylko mapuje obszary na zakładki i sekcje interfejsu. Bez importów — działa w Next.js i React Native.
 */

export type EventAccessArea =
  | 'operations'
  | 'onsite_contact'
  | 'client'
  | 'values'
  | 'commercial_docs'
  | 'billing'
  | 'sales_overview';
export type EventAccessRole = 'admin' | 'seller' | 'office' | 'manager' | 'warehouse' | 'driver' | 'team' | 'colleague';

export type EventAccess = {
  event_id: string | null;
  areas: Record<EventAccessArea, boolean>;
  roles: Partial<Record<EventAccessRole, boolean>>;
};

export const EVENT_ACCESS_AREAS: EventAccessArea[] = [
  'operations',
  'onsite_contact',
  'client',
  'values',
  'commercial_docs',
  'billing',
  'sales_overview',
];

export const EVENT_ACCESS_NONE: EventAccess = {
  event_id: null,
  areas: {
    operations: false,
    onsite_contact: false,
    client: false,
    values: false,
    commercial_docs: false,
    billing: false,
    sales_overview: false,
  },
  roles: {},
};

export const EVENT_AREA_LABELS: Record<EventAccessArea, string> = {
  operations: 'Realizacja',
  onsite_contact: 'Kontakt na miejscu',
  client: 'Dane klienta',
  values: 'Kwoty i kalkulacje',
  commercial_docs: 'Oferta, umowa i formalności',
  billing: 'Faktury i rozliczenie',
  sales_overview: 'Podgląd sprzedaży',
};

export const EVENT_ACCESS_ROLE_LABELS: Record<EventAccessRole, string> = {
  admin: 'Administrator',
  seller: 'Sprzedawca / prowadzący',
  office: 'Biuro',
  manager: 'Kierownik realizacji',
  warehouse: 'Magazyn',
  driver: 'Kierowca',
  team: 'Zespół',
  colleague: 'Inny sprzedawca',
};

/** Bezpieczne odczytanie wyniku RPC get_event_access (brak RPC / błąd = brak dostępu). */
export function parseEventAccess(data: unknown): EventAccess {
  if (!data || typeof data !== 'object') return EVENT_ACCESS_NONE;
  const raw = data as { event_id?: unknown; areas?: Record<string, unknown>; roles?: Record<string, unknown> };
  const areas = { ...EVENT_ACCESS_NONE.areas };
  for (const area of EVENT_ACCESS_AREAS) areas[area] = raw.areas?.[area] === true;
  const roles: EventAccess['roles'] = {};
  for (const role of Object.keys(EVENT_ACCESS_ROLE_LABELS) as EventAccessRole[]) {
    if (raw.roles?.[role] === true) roles[role] = true;
  }
  return { event_id: typeof raw.event_id === 'string' ? raw.event_id : null, areas, roles };
}

export function canViewEventArea(access: EventAccess | null | undefined, area: EventAccessArea): boolean {
  return Boolean(access?.areas?.[area]);
}

// ---------------------------------------------------------------------------------------------------------------
// Zakładki wydarzenia (CRM). Grupy: Przegląd i Szczegóły → Przygotowanie → Sprzedaż i rozliczenie.
// ---------------------------------------------------------------------------------------------------------------

export type EventTabId =
  | 'overview'
  | 'details'
  | 'equipment'
  | 'logistics'
  | 'team'
  | 'phases'
  | 'agenda'
  | 'subcontractors'
  | 'files'
  | 'tasks'
  | 'mavinci-live'
  | 'offer'
  | 'calculations'
  | 'contract'
  | 'seller-arrangements'
  | 'finances'
  | 'history';

export type EventTabGroupId = 'main' | 'preparation' | 'commercial';

export const EVENT_TAB_GROUPS: { id: EventTabGroupId; label: string; tabs: EventTabId[] }[] = [
  { id: 'main', label: 'Wydarzenie', tabs: ['overview', 'details'] },
  {
    id: 'preparation',
    label: 'Przygotowanie',
    tabs: ['equipment', 'logistics', 'team', 'phases', 'agenda', 'subcontractors', 'files', 'tasks', 'mavinci-live'],
  },
  {
    id: 'commercial',
    label: 'Sprzedaż i rozliczenie',
    tabs: ['offer', 'calculations', 'contract', 'seller-arrangements', 'finances', 'history'],
  },
];

export const EVENT_TAB_LABELS: Record<EventTabId, string> = {
  overview: 'Przegląd',
  details: 'Szczegóły',
  equipment: 'Sprzęt',
  logistics: 'Logistyka',
  team: 'Zespół',
  phases: 'Harmonogram',
  agenda: 'Agenda',
  subcontractors: 'Podwykonawcy',
  files: 'Pliki',
  tasks: 'Zadania',
  'mavinci-live': 'Mavinci LIVE',
  offer: 'Oferta',
  calculations: 'Kalkulacje',
  contract: 'Umowa',
  'seller-arrangements': 'Ustalenia',
  finances: 'Finanse',
  history: 'Historia',
};

/** Obszar wymagany przez zakładkę. */
export const EVENT_TAB_AREA: Record<EventTabId, EventAccessArea> = {
  overview: 'operations',
  details: 'operations',
  equipment: 'operations',
  logistics: 'operations',
  team: 'operations',
  phases: 'operations',
  agenda: 'operations',
  subcontractors: 'operations',
  files: 'operations',
  tasks: 'operations',
  'mavinci-live': 'operations',
  offer: 'commercial_docs',
  calculations: 'values',
  contract: 'commercial_docs',
  'seller-arrangements': 'commercial_docs',
  finances: 'billing',
  history: 'commercial_docs',
};

/** Kolejność zakładek w jednym pasku (bez podziału na grupy). */
export const EVENT_TAB_IDS = EVENT_TAB_GROUPS.flatMap(group => group.tabs);

/**
 * Podgląd wydarzenia sprzedanego przez innego sprzedawcę (obszar sales_overview bez realizacji):
 * termin, miejsce, klient, sprzedane usługi i kto sprzedał — RPC get_event_sales_overview, bez kwot i dokumentów.
 */
export function isSalesColleagueView(access: EventAccess | null | undefined): boolean {
  return Boolean(access?.areas?.sales_overview && !access?.areas?.operations);
}

export function isEventTabId(value: unknown): value is EventTabId {
  return typeof value === 'string' && (EVENT_TAB_IDS as string[]).includes(value);
}

/** Starsze adresy zakładek (np. z powiadomień) → nowe. */
export function normalizeEventTabId(value: unknown): EventTabId | null {
  if (value === 'warehouse' || value === 'steps') return 'overview';
  if (value === 'timeline') return 'phases';
  return isEventTabId(value) ? value : null;
}

/**
 * Czy zakładka jest dostępna: obszar z bazy, a dla zwykłych pracowników także lista zakładek z ustawień pracownika
 * (zawężenie ustawione przez administratora). Przegląd i Szczegóły są zawsze, gdy jest dostęp do realizacji.
 */
export function eventTabAllowed(
  access: EventAccess | null | undefined,
  tab: EventTabId,
  employeeTabs?: string[] | null,
): boolean {
  if (tab === 'details' && isSalesColleagueView(access)) return true;
  if (!canViewEventArea(access, EVENT_TAB_AREA[tab])) return false;
  if (tab === 'overview' || tab === 'details') return true;
  if (access?.roles?.admin) return true;
  const narrowed = Array.isArray(employeeTabs) ? employeeTabs.filter(item => typeof item === 'string' && item.trim()) : [];
  if (!narrowed.length) return true;
  if (narrowed.includes(tab)) return true;
  // „Timeline” w starszych ustawieniach to dzisiejszy „Harmonogram”.
  return tab === 'phases' && narrowed.includes('timeline');
}

/** Dozwolone zakładki w jednym pasku, w stałej kolejności. `extraAllowed` pozwala ukryć zakładki z warunkami modułu. */
export function visibleEventTabs(
  access: EventAccess | null | undefined,
  employeeTabs?: string[] | null,
  extraAllowed?: (tab: EventTabId) => boolean,
): EventTabId[] {
  return EVENT_TAB_IDS.filter(tab => eventTabAllowed(access, tab, employeeTabs) && (extraAllowed ? extraAllowed(tab) : true));
}

/** Grupy z dozwolonymi zakładkami (puste grupy pominięte). `extraAllowed` pozwala ukryć zakładki z warunkami modułu. */
export function visibleEventTabGroups(
  access: EventAccess | null | undefined,
  employeeTabs?: string[] | null,
  extraAllowed?: (tab: EventTabId) => boolean,
): { id: EventTabGroupId; label: string; tabs: EventTabId[] }[] {
  return EVENT_TAB_GROUPS.map(group => ({
    ...group,
    tabs: group.tabs.filter(tab => eventTabAllowed(access, tab, employeeTabs) && (extraAllowed ? extraAllowed(tab) : true)),
  })).filter(group => group.tabs.length > 0);
}

/** Opis zakresu dla stopki „Widzisz: …” (np. pod nagłówkiem wydarzenia). */
export function eventAccessSummary(access: EventAccess | null | undefined): string {
  if (isSalesColleagueView(access)) {
    return 'Wydarzenie innego sprzedawcy: widzisz termin, miejsce, klienta, sprzedane usługi i kto sprzedał — bez kwot i dokumentów.';
  }
  if (!access || !access.areas.operations) return 'Brak dostępu do tego wydarzenia.';
  const shown = EVENT_ACCESS_AREAS.filter(area => area !== 'sales_overview');
  const visible = shown.filter(area => access.areas[area]).map(area => EVENT_AREA_LABELS[area]);
  const hidden = shown.filter(area => !access.areas[area]).map(area => EVENT_AREA_LABELS[area].toLowerCase());
  return hidden.length
    ? `Widzisz: ${visible.join(', ').toLowerCase()}. Poza Twoim zakresem: ${hidden.join(', ')}.`
    : 'Widzisz wszystkie dane wydarzenia.';
}

// ---------------------------------------------------------------------------------------------------------------
// Podgląd sprzedaży (RPC get_event_sales_overview) — ten sam kształt w CRM i w aplikacji.
// ---------------------------------------------------------------------------------------------------------------

export type EventSalesOverview = {
  event: {
    id: string;
    name: string;
    event_date: string | null;
    event_end_date: string | null;
    location: string | null;
    status: string | null;
    category: string | null;
  } | null;
  client_name: string | null;
  sold_by: string[];
  products: { name: string; quantity: number | null; unit: string | null }[];
};

export function parseEventSalesOverview(data: unknown): EventSalesOverview | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  const event = raw.event && typeof raw.event === 'object' ? (raw.event as EventSalesOverview['event']) : null;
  const soldBy = Array.isArray(raw.sold_by) ? raw.sold_by.filter((name): name is string => typeof name === 'string' && !!name.trim()) : [];
  const products = Array.isArray(raw.products)
    ? (raw.products as Record<string, unknown>[])
        .filter(item => item && typeof item.name === 'string' && item.name.trim())
        .map(item => ({
          name: String(item.name),
          quantity: typeof item.quantity === 'number' ? item.quantity : item.quantity == null ? null : Number(item.quantity),
          unit: typeof item.unit === 'string' && item.unit.trim() ? item.unit : null,
        }))
    : [];
  return {
    event,
    client_name: typeof raw.client_name === 'string' && raw.client_name.trim() ? raw.client_name : null,
    sold_by: soldBy,
    products,
  };
}

/** „Taniec w Chmurach × 2 szt.” */
export function salesOverviewProductLabel(product: EventSalesOverview['products'][number]): string {
  const quantity = product.quantity != null && Number.isFinite(product.quantity) && product.quantity !== 1
    ? ` × ${String(product.quantity).replace('.', ',')}${product.unit ? ` ${product.unit}` : ''}`
    : '';
  return `${product.name}${quantity}`;
}
