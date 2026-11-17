import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { parseVatWhitelistRequest, runVatWhitelistCheck } from '@/lib/invoices/vatWhitelist.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Biała lista VAT z CRM w przeglądarce (sesja z ciasteczek). Logika sprawdzenia i zapisu — wspólna z aplikacją na Maca:
 * `src/lib/invoices/vatWhitelist.server.ts` (POST {companyId, mode 'payables'|'payments', ids?, force?}).
 */

export async function POST(req: Request) {
  const request = parseVatWhitelistRequest(await req.json().catch(() => null));
  if (!request) {
    return NextResponse.json({ success: false, error: 'Brak działalności lub rodzaju sprawdzenia.' }, { status: 400 });
  }

  const userClient = createSupabaseServerClient(cookies());
  const { data: authData } = await userClient.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ success: false, error: 'Wymagane logowanie.' }, { status: 401 });
  }
  const { data: employee } = await userClient.from('employees').select('id').eq('auth_user_id', authData.user.id).maybeSingle();

  const result = await runVatWhitelistCheck(userClient, employee?.id ?? null, request);
  return NextResponse.json(result.body, { status: result.status });
}
