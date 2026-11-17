import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { handleKsefUpoRequest } from '../../upoRequests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * UPO faktur wysłanych do KSeF z CRM w przeglądarce (sesja z ciasteczek). Logika wspólna z aplikacją na Maca:
 * `src/app/bridge/ksef/upoRequests.ts`.
 *  { invoiceId } — UPO jednej faktury (zapisane albo pobrane teraz z KSeF); odczyt: kto widzi fakturę.
 *  { companyId, missing: true } — pobranie brakujących UPO działalności (do 10 na raz); „Podgląd finansów”.
 */

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  const userClient = createSupabaseServerClient(cookies());
  const { data: authData } = await userClient.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ success: false, error: 'Wymagane logowanie.' }, { status: 401 });
  }

  const result = await handleKsefUpoRequest(userClient, body);
  return NextResponse.json(result.body, { status: result.status });
}
