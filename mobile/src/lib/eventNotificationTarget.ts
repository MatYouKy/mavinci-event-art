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
  initial_tab?: string; metadata?: Record<string, any> | null;
}): EventNotificationTab | undefined {
  const tab = target.initial_tab || target.metadata?.initial_tab;
  if (tabs.includes(tab)) return tab as EventNotificationTab;
  // CRM „Przegląd” (powiadomienia kroków realizacji: ?tab=overview) = zakładka Szczegóły z panelem „Kroki realizacji”.
  if (tab === 'overview') return 'details';
  // Podsumowanie wydarzenia (powiadomienia o wysłaniu / zatwierdzeniu: ?tab=summary, metadata.initial_tab='summary').
  // Ekran wydarzenia wraca do „Szczegółów”, gdy osoba nie ma obszaru „kwoty”.
  if (normalizeEventTabId(tab) === 'summary') return 'summary';
  if (target.metadata?.kind === 'vehicle_pickup') return 'fleet';
  if (typeof target.metadata?.warehouse_key === 'string') return 'warehouse';
  return undefined;
}
