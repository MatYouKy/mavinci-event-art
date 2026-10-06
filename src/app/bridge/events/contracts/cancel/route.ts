import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reply = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      return reply({ error: 'Nieprawidłowe źródło żądania.' }, 403);
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body.contractId !== 'string' || !uuid.test(body.contractId) ||
      typeof body.eventId !== 'string' || !uuid.test(body.eventId) ||
      typeof body.password !== 'string' || !body.password || body.password.length > 1024 ||
      typeof body.expectedStatus !== 'string' || body.expectedStatus.length > 40) {
      return reply({ error: 'Podaj hasło i poprawne dane umowy.' }, 400);
    }

    const userClient = createSupabaseServerClient(cookies());
    const { data: auth, error: authError } = await userClient.auth.getUser();
    if (authError || !auth.user?.email) {
      return reply({ error: 'Sesja wygasła. Zaloguj się ponownie.' }, 401);
    }
    const admin = createSupabaseAdminClient();
    const { data: employee, error: employeeError } = await admin.from('employees')
      .select('id, role, access_level')
      .or(`id.eq.${auth.user.id},auth_user_id.eq.${auth.user.id}`)
      .eq('is_active', true).maybeSingle();
    if (employeeError || !employee || (employee.role !== 'admin' && employee.access_level !== 'admin')) {
      return reply({ error: 'Tylko aktywny administrator może anulować umowę.' }, 403);
    }
    const { data: contract, error: contractError } = await admin.from('contracts')
      .select('id').eq('id', body.contractId).eq('event_id', body.eventId).maybeSingle();
    if (contractError) return reply({ error: 'Nie udało się odczytać umowy.' }, 500);
    if (!contract) return reply({ error: 'Nie znaleziono umowy dla tego wydarzenia.' }, 404);

    // Separate, non-persistent client: reauthentication must not replace the admin's session.
    // The email is taken exclusively from the verified current session, never from the body.
    const verifier = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
    const { data: verified, error: passwordError } = await verifier.auth.signInWithPassword({
      email: auth.user.email,
      password: body.password,
    });
    body.password = '';
    try {
      if (passwordError || !verified.session || verified.user?.id !== auth.user.id) {
        if (passwordError?.status === 429) {
          return reply({ error: 'Zbyt wiele prób weryfikacji hasła. Odczekaj i spróbuj ponownie.' }, 429);
        }
        return reply({ error: 'Nie udało się potwierdzić hasła administratora. Sprawdź hasło i spróbuj ponownie.' }, 403);
      }
      const { error } = await admin.rpc('cancel_event_contract_verified', {
        p_contract_id: body.contractId,
        p_event_id: body.eventId,
        p_employee_id: employee.id,
        p_expected_status: body.expectedStatus,
      });
      if (error) {
        if (['PGRST202', '42883', '42P01'].includes(error.code)) {
          return reply({ error: 'Anulowanie wymaga aktualizacji bazy danych. Zastosuj migrację zabezpieczonego anulowania umów.' }, 503);
        }
        if (error.code === '40001') {
          return reply({ error: 'Status umowy zmienił się w międzyczasie. Odśwież widok i sprawdź umowę przed anulowaniem.' }, 409);
        }
        return reply({ error: 'Nie udało się anulować umowy. Dane i PDF nie zostały usunięte.' }, 500);
      }
      return reply({ ok: true, status: 'cancelled' });
    } finally {
      // Revoke only the temporary verification session, not the admin's browser session.
      if (verified.session?.access_token) {
        await admin.auth.admin.signOut(verified.session.access_token, 'local').catch(() => undefined);
      }
    }
  } catch {
    // Never log the request body, password, or temporary authentication tokens.
    return reply({ error: 'Nie udało się wykonać operacji. Odśwież umowę, aby sprawdzić jej aktualny status.' }, 500);
  }
}
