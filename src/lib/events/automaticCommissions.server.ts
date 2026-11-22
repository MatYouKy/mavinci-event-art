import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * Prowizje automatyczne liczy podsumowanie wydarzenia w bazie (migracja 20261105130000). Ta logika niczego nie wstawia sama:
 * sprawdza uprawnienia i woła funkcje bazy klientem zalogowanego użytkownika — add_event_partner_commission (wybrany
 * sprzedawca z kartoteki) albo refresh_event_commissions (przeliczenie prognozy). Wspólna dla trasy CRM
 * `/bridge/events/commissions/automatic` (przeglądarka) i aplikacji na Maca (`src/lib/native/eventBilling.ts`).
 * Odpowiedź: { created, commissionId?, reason, message } albo { error } ze statusem HTTP.
 */

export type AutomaticCommissionResult = { status: number; body: Record<string, unknown> };

const count = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};
const failure = (error: string, status = 400): AutomaticCommissionResult => ({ status, body: { error } });

function databaseFailure(error: { code?: string; message?: string }): AutomaticCommissionResult {
  if (['PGRST202', '42883'].includes(error.code || '')) {
    return failure('Automatyczne prowizje liczy podsumowanie eventu — wymaga aktualizacji bazy danych.', 503);
  }
  if (error.code === '42501') return failure(error.message || 'Nie masz uprawnień do prowizji tego eventu.', 403);
  // Komunikaty RAISE EXCEPTION z bazy są po polsku i mówią, co uzupełnić (np. warunki sprzedawcy dla marki).
  if (['P0001', '22023', '23505', '40001'].includes(error.code || '')) {
    return failure(error.message || 'Dane prowizji zmieniły się. Odśwież sekcję.', 409);
  }
  console.error('Automatic event commission:', error.code);
  return failure('Nie udało się automatycznie uzupełnić prowizji. Spróbuj ponownie.', 500);
}

/** Uzupełnienie prowizji wydarzenia klientem użytkownika `authUserId` (zalogowanego — sesja przeglądarki albo token aplikacji). */
export async function runAutomaticCommissions(
  user: SupabaseClient<any, any, any>,
  authUserId: string,
  eventId: string,
  selectedPartnerId: string | null,
): Promise<AutomaticCommissionResult> {
  // Prowizje wydarzenia: ta sama reguła co w bazie (commission_settlement_can_access) — administrator,
  // „Zarządzanie finansami” działalności wydarzenia albo finances_manage przy widocznym wydarzeniu.
  const [employeeResult, eventAccess, companyAccess, portalSession, commissionAccess] = await Promise.all([
    user.from('employees').select('id').eq('is_active', true)
      .or(`id.eq.${authUserId},auth_user_id.eq.${authUserId}`).limit(1).maybeSingle(),
    user.rpc('current_employee_can_view_event', { p_event_id: eventId }),
    user.rpc('current_employee_can_access_event_company', { p_event_id: eventId }),
    user.rpc('current_session_is_seller_portal'),
    user.rpc('commission_settlement_can_access', { p_event_id: eventId, p_manage: true }),
  ]);
  if (employeeResult.error || eventAccess.error || companyAccess.error || portalSession.error || commissionAccess.error ||
    portalSession.data !== false || !employeeResult.data || commissionAccess.data !== true ||
    eventAccess.data !== true || companyAccess.data !== true) {
    return failure('Nie masz uprawnień do naliczania prowizji dla tego eventu.', 403);
  }

  if (selectedPartnerId) {
    const { data, error } = await user.rpc('add_event_partner_commission', {
      p_event_id: eventId,
      p_sales_partner_id: selectedPartnerId,
    });
    if (error) return databaseFailure(error);
    const result = (data ?? {}) as { created?: boolean; commission_id?: string | null; reason?: string | null };
    const existing = result.reason === 'existing';
    return {
      status: 200,
      body: {
        created: result.created === true,
        commissionId: result.commission_id ?? null,
        reason: result.reason ?? (result.created ? 'ready' : 'existing'),
        message: existing
          ? 'Prowizja dla tej osoby jest już zapisana w tym evencie.'
          : 'Sprzedawca dodany do eventu. Kwotę prowizji liczy podsumowanie eventu.',
      },
    };
  }

  const { data, error } = await user.rpc('refresh_event_commissions', { p_event_id: eventId });
  if (error) return databaseFailure(error);
  const summary = (data ?? {}) as Record<string, unknown>;
  const matched = count(summary.matched);
  const eligible = count(summary.eligible);
  const created = count(summary.created);
  return {
    status: 200,
    body: {
      created: created > 0,
      reason: matched > 0 ? 'event_sellers' : 'refreshed',
      message: matched === 0
        ? ''
        : eligible === 0
          ? 'Sprzedawcy zewnętrzni tego eventu nie mają aktywnej prowizji dla marki albo rozliczają się narzutem — szczegóły w zakładce Podsumowanie.'
          : `Prowizje sprzedawców zewnętrznych (${eligible}) liczy podsumowanie eventu — wyliczenie w zakładce Podsumowanie.`,
    },
  };
}
