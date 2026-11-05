import { normalizeEventTabId } from './eventAccess';

export type EventNotificationTab =
  | 'details'
  | 'warehouse'
  | 'fleet'
  | 'team'
  | 'agenda'
  | 'checklist'
  | 'files'
  | 'wedding'
  | 'summary';
const tabs: string[] = ['details', 'warehouse', 'fleet', 'team', 'agenda', 'checklist', 'files', 'wedding', 'summary'];
export function getEventNotificationTab(target: {
  initial_tab?: string; metadata?: Record<string, any> | null; action_url?: string | null; workflow?: string;
}): EventNotificationTab | undefined {
  const tab = target.initial_tab || target.metadata?.initial_tab;
  if (tabs.includes(tab)) return tab as EventNotificationTab;
  // Checklista sprzętu (wydanie, załadunek powrotny, zwrot): CRM ?tab=equipment, metadata.initial_tab='checklist',
  // metadata.workflow='equipment_checklist' → zakładka „Checklista” (pulpit realizacji: „Sprzęt”).
  if (
    tab === 'equipment' ||
    target.metadata?.workflow === 'equipment_checklist' ||
    target.workflow === 'equipment_checklist' ||
    (!tab && /[?&]tab=equipment(?:&|#|$)/i.test(target.action_url ?? ''))
  ) {
    return 'checklist';
  }
  // CRM „Przegląd” (powiadomienia kroków realizacji: ?tab=overview) = zakładka Szczegóły z panelem „Kroki realizacji”.
  if (tab === 'overview') return 'details';
  // Podsumowanie wydarzenia (powiadomienia o wysłaniu / zatwierdzeniu: ?tab=summary, metadata.initial_tab='summary').
  // Ekran wydarzenia wraca do „Szczegółów”, gdy osoba nie ma obszaru „kwoty”.
  if (normalizeEventTabId(tab) === 'summary') return 'summary';
  if (target.metadata?.kind === 'vehicle_pickup') return 'fleet';
  if (typeof target.metadata?.warehouse_key === 'string') return 'warehouse';
  return undefined;
}
