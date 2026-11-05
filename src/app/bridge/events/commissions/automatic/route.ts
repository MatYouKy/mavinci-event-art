import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const count = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

function databaseFailure(error: { code?: string; message?: string }) {
  if (['PGRST202', '42883'].includes(error.code || '')) {
    return fail('Automatyczne prowizje liczy podsumowanie wydarzenia — wymaga aktualizacji bazy danych.', 503);
  }
  if (error.code === '42501') return fail(error.message || 'Nie masz uprawnień do prowizji tego wydarzenia.', 403);
  // Komunikaty RAISE EXCEPTION z bazy są po polsku i mówią, co uzupełnić (np. warunki sprzedawcy dla marki).
  if (['P0001', '22023', '23505', '40001'].includes(error.code || '')) {
    return fail(error.message || 'Dane prowizji zmieniły się. Odśwież sekcję.', 409);
  }
  console.error('Automatic event commission:', error.code);
  return fail('Nie udało się automatycznie uzupełnić prowizji. Spróbuj ponownie.', 500);
}

/**
 * Prowizje automatyczne liczy podsumowanie wydarzenia w bazie (migracja 20261105130000).
 * Ta trasa niczego nie wstawia sama: sprawdza uprawnienia i woła funkcje bazy klientem zalogowanego użytkownika —
 * add_event_partner_commission (wybrany sprzedawca z kartoteki) albo refresh_event_commissions (przeliczenie prognozy).
 * Odpowiedź zgodna z poprzednią: { created, commissionId?, reason, message }.
 */
export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('Nieprawidłowe wydarzenie lub sprzedawca.');
      body = parsed;
    } catch {
      return fail('Nieprawidłowe wydarzenie lub sprzedawca.');
    }
    if (!isUuid(body.eventId) || (body.salesPartnerId != null && !isUuid(body.salesPartnerId))) {
      return fail('Nieprawidłowe wydarzenie lub sprzedawca.');
    }
    const eventId = body.eventId as string;
    const selectedPartnerId = (body.salesPartnerId as string | undefined) ?? null;
    const user = createSupabaseServerClient(cookies());
    const { data: auth, error: authError } = await user.auth.getUser();
    if (authError || !auth.user) return fail('Zaloguj się ponownie.', 401);
    // Prowizje wydarzenia: ta sama reguła co w bazie (commission_settlement_can_access) — administrator,
    // „Zarządzanie finansami” działalności wydarzenia albo finances_manage przy widocznym wydarzeniu.
    const [employeeResult, eventAccess, companyAccess, portalSession, commissionAccess] = await Promise.all([
      user.from('employees').select('id').eq('is_active', true)
        .or(`id.eq.${auth.user.id},auth_user_id.eq.${auth.user.id}`).limit(1).maybeSingle(),
      user.rpc('current_employee_can_view_event', { p_event_id: eventId }),
      user.rpc('current_employee_can_access_event_company', { p_event_id: eventId }),
      user.rpc('current_session_is_seller_portal'),
      user.rpc('commission_settlement_can_access', { p_event_id: eventId, p_manage: true }),
    ]);
    if (employeeResult.error || eventAccess.error || companyAccess.error || portalSession.error || commissionAccess.error ||
      portalSession.data !== false || !employeeResult.data || commissionAccess.data !== true ||
      eventAccess.data !== true || companyAccess.data !== true) {
      return fail('Nie masz uprawnień do naliczania prowizji dla tego wydarzenia.', 403);
    }

    if (selectedPartnerId) {
      const { data, error } = await user.rpc('add_event_partner_commission', {
        p_event_id: eventId,
        p_sales_partner_id: selectedPartnerId,
      });
      if (error) return databaseFailure(error);
      const result = (data ?? {}) as { created?: boolean; commission_id?: string | null; reason?: string | null };
      const existing = result.reason === 'existing';
      return NextResponse.json({
        created: result.created === true,
        commissionId: result.commission_id ?? null,
        reason: result.reason ?? (result.created ? 'ready' : 'existing'),
        message: existing
          ? 'Prowizja dla tej osoby jest już zapisana w tym wydarzeniu.'
          : 'Sprzedawca dodany do wydarzenia. Kwotę prowizji liczy podsumowanie wydarzenia.',
      });
    }

    const { data, error } = await user.rpc('refresh_event_commissions', { p_event_id: eventId });
    if (error) return databaseFailure(error);
    const summary = (data ?? {}) as Record<string, unknown>;
    const matched = count(summary.matched);
    const eligible = count(summary.eligible);
    const created = count(summary.created);
    return NextResponse.json({
      created: created > 0,
      reason: matched > 0 ? 'event_sellers' : 'refreshed',
      message: matched === 0
        ? ''
        : eligible === 0
          ? 'Sprzedawcy zewnętrzni tego wydarzenia nie mają aktywnej prowizji dla marki albo rozliczają się narzutem — szczegóły w zakładce Podsumowanie.'
          : `Prowizje sprzedawców zewnętrznych (${eligible}) liczy podsumowanie wydarzenia — wyliczenie w zakładce Podsumowanie.`,
    });
  } catch (error) {
    console.error('Automatic event commission:', error);
    return fail('Nie udało się automatycznie uzupełnić prowizji. Spróbuj ponownie.', 500);
  }
}
