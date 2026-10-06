export const OPERATIONAL_LABELS: Record<string, string> = {
  inquiry: 'Nowe wydarzenie',
  offer_accepted: 'Do potwierdzenia',
  in_preparation: 'W przygotowaniu',
  ready_for_live: 'Gotowe do realizacji',
  in_progress: 'W trakcie realizacji',
  completed: 'Zrealizowane',
  settled: 'Zakończone',
  cancelled: 'Anulowane',
};

export function usesOperationalStages(employee: any): boolean {
  if (employee?.role === 'admin' || employee?.access_level === 'admin') return false;
  const permissions: string[] = employee?.permissions || [];
  return !permissions.some((p) =>
    [
      'admin',
      'events_manage',
      'offers_view',
      'offers_create',
      'offers_manage',
      'finances_view',
      'finances_manage',
      'invoices_view',
      'invoices_create',
      'invoices_manage',
      'sales_view',
      'sales_manage',
    ].includes(p),
  );
}

// Before the authorized snapshot arrives, never expose financial labels or infer closure.
export function operationalFallback(status: string): string {
  if (status === 'invoiced') return 'completed';
  if (['offer_sent', 'offer_to_send'].includes(status)) return 'inquiry';
  return status;
}
