export type EventNotificationTab = 'details' | 'warehouse' | 'fleet' | 'team' | 'agenda' | 'checklist' | 'files' | 'wedding';
const tabs: string[] = ['details', 'warehouse', 'fleet', 'team', 'agenda', 'checklist', 'files', 'wedding'];
export function getEventNotificationTab(target: {
  initial_tab?: string; metadata?: Record<string, any> | null;
}): EventNotificationTab | undefined {
  const tab = target.initial_tab || target.metadata?.initial_tab;
  if (tabs.includes(tab)) return tab as EventNotificationTab;
  if (target.metadata?.kind === 'vehicle_pickup') return 'fleet';
  if (typeof target.metadata?.warehouse_key === 'string') return 'warehouse';
  return undefined;
}
