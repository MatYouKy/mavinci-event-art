import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import type { CommissionSettlementsResponse } from '@/lib/CRM/events/commissionSettlements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
const validMoney = (value: unknown): value is number => typeof value === 'number' &&
  Number.isFinite(value) && value > 0 && value < 1e12 &&
  Math.abs(value * 100 - Math.round(value * 100)) < 0.0001;
const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

function databaseFailure(error: { code?: string; message?: string }) {
  if (['PGRST202', '42883', '42P01', '42703'].includes(error.code || '')) {
    return fail('Historia rozliczeń prowizji wymaga aktualizacji schematu bazy.', 503);
  }
  if (error.code === '42501') return fail('Nie masz dostępu do tych rozliczeń prowizji.', 403);
  if (['P0001', '22023', '40001', '23505'].includes(error.code || '')) {
    return fail(error.message || 'Dane zmieniły się. Odśwież rozliczenia.', 409);
  }
  console.error('Commission settlements database error:', error.code);
  return fail('Nie udało się zapisać lub odczytać rozliczenia. Przy ponowieniu zapisu zachowaj ten sam identyfikator operacji.', 500);
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const mode = query.get('mode') || 'crm';
    const accountType = query.get('accountType');
    const accountId = query.get('accountId');
    if (mode !== 'crm' && mode !== 'seller') return fail('Nieprawidłowy widok rozliczeń.');
    if (mode === 'seller' && (accountType !== null || accountId !== null)) {
      return fail('Portal sprzedawcy korzysta wyłącznie z własnego konta.', 403);
    }
    if (mode === 'crm' && (!['contact', 'partner', 'employee', 'organization'].includes(accountType || '') || !isUuid(accountId))) {
      return fail('Wybierz prawidłowe konto prowizji.');
    }
    const client = createSupabaseServerClient(cookies());
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) return fail('Zaloguj się ponownie.', 401);
    const { data, error } = await client.rpc('get_commission_settlements', {
      p_mode: mode, p_account_type: accountType, p_account_id: accountId,
    });
    if (error) return databaseFailure(error);
    return NextResponse.json(data as CommissionSettlementsResponse, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch {
    return fail('Nie udało się pobrać rozliczeń prowizji.', 500);
  }
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return fail('Niedozwolone źródło żądania.', 403);
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('Nieprawidłowe dane rozliczenia.');
      body = parsed;
    } catch { return fail('Nieprawidłowe dane rozliczenia.'); }
    const action = body.action ?? 'payout';
    if (!isUuid(body.commissionId) || (action !== 'approve' && action !== 'payout')) return fail('Nieprawidłowa operacja prowizji.');
    if (action === 'approve' && !validMoney(body.expectedAmount)) return fail('Odśwież kwotę prowizji przed zatwierdzeniem.');
    if (action === 'payout' && (!validMoney(body.amount) || !validDate(body.paymentDate) || !isUuid(body.idempotencyKey))) {
      return fail('Podaj dodatnią kwotę do dwóch miejsc po przecinku, datę wypłaty i identyfikator operacji.');
    }
    if ((body.reference != null && (typeof body.reference !== 'string' || body.reference.length > 200)) ||
        (body.note != null && (typeof body.note !== 'string' || body.note.length > 2000))) {
      return fail('Numer lub opis jest zbyt długi (maksymalnie 200 / 2000 znaków).');
    }
    const client = createSupabaseServerClient(cookies());
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) return fail('Zaloguj się ponownie.', 401);
    const { data, error } = await client.rpc('record_commission_settlement', {
      p_commission_id: body.commissionId,
      p_action: action,
      p_amount: action === 'payout' ? body.amount : null,
      p_payment_date: action === 'payout' ? body.paymentDate : null,
      p_reference: typeof body.reference === 'string' ? body.reference.trim() || null : null,
      p_note: typeof body.note === 'string' ? body.note.trim() || null : null,
      p_idempotency_key: action === 'payout' ? body.idempotencyKey : null,
      p_expected_amount: action === 'approve' ? body.expectedAmount : null,
    });
    if (error) return databaseFailure(error);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return fail('Nie udało się potwierdzić zapisu. Ponów tę samą operację z tym samym identyfikatorem, aby uniknąć duplikatu.', 500);
  }
}
