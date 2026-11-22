import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { runAutomaticCommissions } from '@/lib/events/automaticCommissions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/**
 * Prowizje automatyczne liczy podsumowanie wydarzenia w bazie (migracja 20261105130000).
 * Ta trasa niczego nie wstawia sama: logika w `src/lib/events/automaticCommissions.server.ts` (wspólna z aplikacją na Maca)
 * sprawdza uprawnienia i woła funkcje bazy klientem zalogowanego użytkownika — add_event_partner_commission (wybrany
 * sprzedawca z kartoteki) albo refresh_event_commissions (przeliczenie prognozy).
 * Odpowiedź zgodna z poprzednią: { created, commissionId?, reason, message }.
 */
export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('Nieprawidłowy event lub sprzedawca.');
      body = parsed;
    } catch {
      return fail('Nieprawidłowy event lub sprzedawca.');
    }
    if (!isUuid(body.eventId) || (body.salesPartnerId != null && !isUuid(body.salesPartnerId))) {
      return fail('Nieprawidłowy event lub sprzedawca.');
    }
    const eventId = body.eventId as string;
    const selectedPartnerId = (body.salesPartnerId as string | undefined) ?? null;
    const user = createSupabaseServerClient(cookies());
    const { data: auth, error: authError } = await user.auth.getUser();
    if (authError || !auth.user) return fail('Zaloguj się ponownie.', 401);
    // Klient sesji z ciasteczek ma typy bazy — wspólna logika przyjmuje dowolnego klienta pracownika.
    const result = await runAutomaticCommissions(user as unknown as SupabaseClient<any, any, any>, auth.user.id, eventId, selectedPartnerId);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Automatic event commission:', error);
    return fail('Nie udało się automatycznie uzupełnić prowizji. Spróbuj ponownie.', 500);
  }
}
