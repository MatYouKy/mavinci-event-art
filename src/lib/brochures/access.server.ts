import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export class BrochureRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'BrochureRequestError';
  }
}

// Generation and delivery must resolve the same employee as the database RLS.
// Never accept ownership from the request or from the brochure's contact card.
export async function requireBrochureEmployeeAccess(client: SupabaseClient): Promise<string> {
  const [employee, manage] = await Promise.all([
    client.rpc('current_brochure_employee_id'),
    client.rpc('can_manage_sales_brochures'),
  ]);
  if (employee.error || manage.error) {
    console.error('Brochure access lookup failed:', employee.error || manage.error);
    throw new BrochureRequestError('Nie udało się sprawdzić uprawnień do broszur. Sprawdź dostępność bazy i migracji modułu broszur.', 503);
  }
  if (!employee.data || !manage.data) {
    throw new BrochureRequestError('Brak uprawnień do przygotowania i wysyłki broszur.', 403);
  }
  const scope = await client.rpc('can_view_brochure_employee', { p_employee: employee.data });
  if (scope.error) {
    console.error('Brochure employee scope lookup failed:', scope.error);
    throw new BrochureRequestError('Nie udało się sprawdzić dostępu do własnych PDF-ów. Sprawdź dostępność bazy i migracji uprawnień broszur.', 503);
  }
  if (!scope.data) {
    throw new BrochureRequestError('Wymagane jest uprawnienie do własnych linków, PDF-ów i statystyk broszur.', 403);
  }
  return employee.data;
}
