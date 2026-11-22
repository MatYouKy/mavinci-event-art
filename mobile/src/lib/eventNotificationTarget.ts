import { normalizeEventTabId } from './eventAccess';

export type EventNotificationTab =
  | 'details'
  | 'steps'
  | 'warehouse'
  | 'timeline'
  | 'fleet'
  | 'team'
  | 'agenda'
  | 'checklist'
  | 'files'
  | 'wedding'
  | 'summary';
const tabs: string[] = ['details', 'steps', 'warehouse', 'timeline', 'fleet', 'team', 'agenda', 'checklist', 'files', 'wedding', 'summary'];
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
  // CRM „Przegląd” (powiadomienia kroków realizacji: ?tab=overview) = zakładka „Kroki realizacji” (osobna od „Szczegółów”).
  if (tab === 'overview') return 'steps';
  // Podsumowanie wydarzenia (powiadomienia o wysłaniu / zatwierdzeniu: ?tab=summary, metadata.initial_tab='summary').
  // Ekran wydarzenia wraca do „Szczegółów”, gdy osoba nie ma obszaru „kwoty”.
  if (normalizeEventTabId(tab) === 'summary') return 'summary';
  // Harmonogram (CRM ?tab=phases, starsze „timeline”) → „Timeline”; logistyka CRM → „Logistyka” (klucz 'fleet').
  if (normalizeEventTabId(tab) === 'phases') return 'timeline';
  if (tab === 'logistics') return 'fleet';
  if (target.metadata?.kind === 'vehicle_pickup') return 'fleet';
  if (typeof target.metadata?.warehouse_key === 'string') return 'warehouse';
  return undefined;
}
