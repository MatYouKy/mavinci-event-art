import { NextResponse } from 'next/server';
import { requireSessionEmployee } from '@/lib/auth/requireEmployee.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { recalculateTenderRelevance } from '@/lib/tenders/tenderRelevance.server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/*
 * Przeliczenie ocen trafności wszystkich przetargów według aktywnej konfiguracji filtrów (dawny adres; CRM, Mac i telefon
 * używają `/bridge/native/v1/tenders` op=recalculate). Algorytm i zapis: `src/lib/tenders/tenderRelevance.server.ts`.
 * Odpowiedź: { success, checked, updated } — `updated` to przetargi ze zmienioną oceną albo dopasowaniem.
 */

export async function POST(request: Request) {
  const access = await requireSessionEmployee(request);
  if (!access.ok) return access.response;
  // Przeliczenie nadpisuje ocenę wszystkich przetargów kluczem serwisowym — tylko administrator.
  if (!access.employee.isAdmin) {
    return NextResponse.json({ success: false, error: 'Przeliczenie ocen uruchamia administrator.' }, { status: 403 });
  }
  try {
    const result = await recalculateTenderRelevance(createSupabaseAdminClient());
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, checked: result.checked, updated: result.updated });
  } catch (error) {
    console.error('[tender-recalculate]', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'Nie udało się przeliczyć przetargów.' }, { status: 500 });
  }
}
