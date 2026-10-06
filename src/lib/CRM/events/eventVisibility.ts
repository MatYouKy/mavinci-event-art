export type EventVisibilityStage =
  | 'sales'
  | 'planning'
  | 'operational'
  | 'archive'
  | 'cancelled';

const OPERATIONAL_STATUSES = new Set([
  'offer_accepted',
  'in_preparation',
  'ready_for_live',
  'ready_for_execution',
  'in_progress',
]);

const ARCHIVE_STATUSES = new Set(['completed', 'invoiced', 'settled']);

export function getEventVisibilityStage(status: string | null | undefined): EventVisibilityStage {
  if (status === 'offer_sent') return 'planning';
  if (OPERATIONAL_STATUSES.has(status || '')) return 'operational';
  if (ARCHIVE_STATUSES.has(status || '')) return 'archive';
  if (status === 'cancelled') return 'cancelled';
  return 'sales';
}

export function isEventVisibleToOperationalRole(
  status: string | null | undefined,
  includePlanning: boolean,
): boolean {
  const stage = getEventVisibilityStage(status);
  return stage === 'operational' || stage === 'archive' || (includePlanning && stage === 'planning');
}

export function isEventAwaitingOperationalConfirmation(
  event: { status?: string | null; event_date?: string | null },
  now = new Date(),
  warningHours = 72,
): boolean {
  if (!event.event_date || !['inquiry', 'offer_to_send'].includes(event.status || '')) return false;
  const eventTime = new Date(event.event_date).getTime();
  if (!Number.isFinite(eventTime)) return false;
  return eventTime <= now.getTime() + warningHours * 60 * 60 * 1000;
}
