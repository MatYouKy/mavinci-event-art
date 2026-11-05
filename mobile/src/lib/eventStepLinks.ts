import { EVENT_TAB_LABELS, type EventAccess, eventTabAllowed, isEventTabId } from './eventAccess';
import { EVENT_STEP_TARGET_TAB } from './eventSteps';

/*
 * Link „Przejdź” przy kroku realizacji: zakładka, w której krok się zamyka (EVENT_STEP_TARGET_TAB we wspólnej
 * kopii eventSteps.ts — ta sama co w CRM). Zakładki, które aplikacja ma, otwieramy w aplikacji; zakładki
 * handlowe (umowa, finanse, oferta…) — w CRM w przeglądarce (`openInCrmWeb`). „Podsumowanie” (kroki „Wyślij /
 * Zatwierdź podsumowanie wydarzenia”) otwieramy w aplikacji (podgląd i wysłanie); edycja i zatwierdzanie — w CRM.
 */

/** Zakładki ekranu wydarzenia w aplikacji (EventDetailScreen). */
export type EventDetailTab =
  | 'details'
  | 'agenda'
  | 'wedding'
  | 'checklist'
  | 'warehouse'
  | 'team'
  | 'fleet'
  | 'files'
  | 'summary';

/** Zakładki pulpitu realizacji (RealizationWorkspace). */
export type RealizationTab = 'overview' | 'phases' | 'equipment' | 'agenda' | 'team' | 'logistics' | 'subcontractors' | 'files';

export const EVENT_DETAIL_TAB_LABELS: Record<EventDetailTab, string> = {
  details: 'Szczegóły',
  agenda: 'Agenda',
  wedding: 'Karta weselna',
  checklist: 'Checklista',
  warehouse: 'Magazyn',
  team: 'Zespół',
  fleet: 'Flota',
  files: 'Pliki',
  summary: 'Podsumowanie',
};

export const REALIZATION_TAB_LABELS: Record<RealizationTab, string> = {
  overview: 'Przegląd',
  phases: 'Timeline',
  equipment: 'Sprzęt',
  agenda: 'Agenda',
  team: 'Zespół',
  logistics: 'Logistyka',
  subcontractors: 'Podwykonawcy',
  files: 'Pliki',
};

export type EventStepLink<Tab extends string> =
  | { kind: 'tab'; tab: Tab; label: string }
  | { kind: 'crm'; path: string; label: string };

/**
 * Kroki zamykane checklistą sprzętu (`system_managed`, private.event_step_auto_keys): wydanie, oddanie sprzętu
 * do magazynu i przyjęcie zwrotu. „Przejdź” otwiera checklistę — w aplikacji zakładkę „Checklista” (pulpit
 * realizacji: „Sprzęt”), także dla magazynu (zakładka „Magazyn” to przyjęcie i przygotowanie, nie wydanie).
 * `return_handover` nie ma jeszcze wpisu w EVENT_STEP_TARGET_TAB (wspólna kopia eventSteps.ts) — obsługujemy go tutaj.
 */
export const EQUIPMENT_CHECKLIST_STEP_KEYS: ReadonlySet<string> = new Set(['dispatch_out', 'return_handover', 'return_check']);

/** Zakładka CRM, w której zamyka się krok (albo null — krok bez linku). */
export function eventStepCrmTab(stepKey: string | null | undefined): string | null {
  if (!stepKey) return null;
  const tab = EVENT_STEP_TARGET_TAB[stepKey];
  return typeof tab === 'string' && tab.trim() ? tab : null;
}

/**
 * Link do CRM w przeglądarce. Gdy znamy obszary osoby (get_event_access), link do zakładki spoza jej zakresu
 * (np. Finanse bez obszaru „Faktury i rozliczenie”) się nie pokazuje — CRM i tak by jej nie otworzył.
 */
function crmLink(
  eventId: string,
  crmTab: string,
  access?: EventAccess | null,
): { kind: 'crm'; path: string; label: string } | null {
  if (access && (!isEventTabId(crmTab) || !eventTabAllowed(access, crmTab))) return null;
  const label = isEventTabId(crmTab) ? EVENT_TAB_LABELS[crmTab] : 'Wydarzenie';
  return { kind: 'crm', path: `/crm/events/${eventId}?tab=${encodeURIComponent(crmTab)}`, label: `${label} (CRM)` };
}

export type EventDetailLinkContext = {
  /** Wesele — zakładka „Karta weselna” zamiast „Agenda”. */
  isWedding: boolean;
  /** Widoczna zakładka „Magazyn”. */
  hasWarehouse: boolean;
  /** Widoczna zakładka „Flota”. */
  hasFleet: boolean;
  /**
   * Widoczna zakładka „Podsumowanie” (obszar „kwoty”, RPC get_event_settlement wdrożone). Bez niej krok podsumowania
   * otwiera CRM (o ile osoba ma tę zakładkę w swoim zakresie).
   */
  hasSummary?: boolean;
  /** Obszary osoby z get_event_access (null — nieznane, np. przed wdrożeniem migracji). */
  access?: EventAccess | null;
};

/** Cel linku na ekranie wydarzenia (EventDetailScreen) i z listy „Moje kroki”. */
export function eventStepDetailLink(
  eventId: string,
  stepKey: string | null | undefined,
  context: EventDetailLinkContext,
): EventStepLink<EventDetailTab> | null {
  const tab = (value: EventDetailTab): EventStepLink<EventDetailTab> => ({
    kind: 'tab',
    tab: value,
    label: EVENT_DETAIL_TAB_LABELS[value],
  });
  if (stepKey && EQUIPMENT_CHECKLIST_STEP_KEYS.has(stepKey)) return tab('checklist');
  const crmTab = eventStepCrmTab(stepKey);
  if (!crmTab) return null;
  switch (crmTab) {
    case 'details':
    case 'overview':
      return tab('details');
    case 'team':
      return tab('team');
    case 'agenda':
      return tab(context.isWedding ? 'wedding' : 'agenda');
    case 'logistics':
      return context.hasFleet ? tab('fleet') : crmLink(eventId, crmTab, context.access);
    case 'equipment':
      return tab(context.hasWarehouse ? 'warehouse' : 'checklist');
    case 'files':
      return tab('files');
    case 'summary':
      return context.hasSummary ? tab('summary') : crmLink(eventId, crmTab, context.access);
    default:
      return crmLink(eventId, crmTab, context.access);
  }
}

/** Cel linku w pulpicie realizacji (kierownik realizacji bez dostępu handlowego). */
export function eventStepRealizationLink(
  eventId: string,
  stepKey: string | null | undefined,
  access?: EventAccess | null,
): EventStepLink<RealizationTab> | null {
  const tab = (value: RealizationTab): EventStepLink<RealizationTab> => ({
    kind: 'tab',
    tab: value,
    label: REALIZATION_TAB_LABELS[value],
  });
  if (stepKey && EQUIPMENT_CHECKLIST_STEP_KEYS.has(stepKey)) return tab('equipment');
  const crmTab = eventStepCrmTab(stepKey);
  if (!crmTab) return null;
  switch (crmTab) {
    case 'details':
    case 'overview':
      return tab('overview');
    case 'team':
    case 'agenda':
    case 'logistics':
    case 'equipment':
    case 'files':
      return tab(crmTab as RealizationTab);
    default:
      return crmLink(eventId, crmTab, access);
  }
}
