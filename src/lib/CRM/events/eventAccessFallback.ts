import { EVENT_ACCESS_AREAS, EVENT_ACCESS_NONE, type EventAccess } from '@/lib/events/access/eventAccess';

/** Kody PostgREST / Postgres oznaczające, że funkcji jeszcze nie ma w bazie (migracja niewdrożona). */
export const MISSING_DATABASE_FUNCTION_CODES = new Set(['PGRST202', '42883']);

export function isMissingDatabaseFunction(error: { code?: string | null } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_DATABASE_FUNCTION_CODES.has(error.code));
}

const LEGACY_COMMERCIAL_PERMISSIONS = [
  'events_manage',
  'offers_view',
  'offers_create',
  'offers_manage',
  'contracts_view',
  'contracts_create',
  'contracts_manage',
  'finances_view',
  'finances_manage',
];

export type LegacyEventAccessInput = {
  eventId: string | null;
  isAdmin: boolean;
  /** Autor albo opiekun sprzedaży wydarzenia. */
  isCreator: boolean;
  role?: string | null;
  accessLevel?: string | null;
  permissions?: string[] | null;
  /** Wynik public.can_view_event_commercials (faktury i rozliczenie). */
  billing: boolean;
};

/**
 * Obszary wyliczone z dotychczasowych reguł — tylko gdy get_event_access nie istnieje w bazie (przed wdrożeniem
 * migracji 20261105090000). Administrator i prowadzący: wszystko; events_manage / kierownik biura / oferty / umowy /
 * finanse: klient, kwoty i dokumenty handlowe; rozliczenie = can_view_event_commercials. Reszta: dane operacyjne.
 */
export function legacyEventAccess(input: LegacyEventAccessInput): EventAccess {
  const areas = { ...EVENT_ACCESS_NONE.areas, operations: true, sales_overview: true };
  if (input.isAdmin || input.isCreator) {
    for (const area of EVENT_ACCESS_AREAS) areas[area] = true;
    return {
      event_id: input.eventId,
      areas,
      roles: { ...(input.isAdmin ? { admin: true } : {}), ...(input.isCreator ? { seller: true } : {}) },
    };
  }
  const permissions = Array.isArray(input.permissions) ? input.permissions : [];
  const office = input.role === 'manager' || input.accessLevel === 'manager';
  const commercial = office || permissions.some(permission => LEGACY_COMMERCIAL_PERMISSIONS.includes(permission));
  if (commercial) {
    areas.client = true;
    areas.values = true;
    areas.commercial_docs = true;
    areas.onsite_contact = true;
  }
  areas.billing = input.billing;
  if (input.billing) areas.values = true;
  return { event_id: input.eventId, areas, roles: office ? { office: true } : {} };
}

/**
 * Przejściowy błąd get_event_access (sieć, przeciążenie): zamknięte obszary wrażliwe — strona działa
 * tylko z danymi operacyjnymi (po odświeżeniu wraca pełny zakres).
 */
export function closedEventAccess(eventId: string | null): EventAccess {
  return { event_id: eventId, areas: { ...EVENT_ACCESS_NONE.areas, operations: true, sales_overview: true }, roles: {} };
}
