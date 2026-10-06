export type WarehouseHandoff = {
  event_id: string;
  accepted_at: string | null;
  accepted_by: string | null;
  accepted_by_name: string | null;
  ready_at: string | null;
  ready_by_name: string | null;
};

export type WarehouseFilter = 'all' | 'pending' | 'mine';

export function canAcceptWarehouseHandoff(status: string, handoff?: WarehouseHandoff | null) {
  return ['offer_accepted', 'in_preparation'].includes(status) && !handoff?.accepted_at;
}

export function matchesWarehouseFilter(filter: WarehouseFilter, status: string, handoff: WarehouseHandoff | null | undefined, employeeId?: string) {
  if (filter === 'all') return true;
  // Undefined means that the handoff could not be checked; it is not an unclaimed event.
  if (handoff === undefined) return false;
  if (filter === 'pending') return canAcceptWarehouseHandoff(status, handoff);
  return Boolean(employeeId && handoff?.accepted_at && handoff.accepted_by === employeeId);
}

export function warehouseOwnerLabel(handoff: WarehouseHandoff, employeeId?: string) {
  if (handoff.accepted_by === employeeId) return 'Przygotowanie magazynowe: Ty';
  return `Przygotowanie magazynowe: ${handoff.accepted_by_name || 'Pracownik magazynu'}`;
}
