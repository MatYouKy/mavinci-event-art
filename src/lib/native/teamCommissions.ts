import 'server-only';
import { createHash } from 'node:crypto';
import type { NativeContext } from './auth';
import type { CommissionSettlement } from '@/lib/CRM/events/commissionSettlements';
import { buildCommissionSettlementStats } from '@/lib/CRM/events/commissionSettlementStats';

/*
 * Konto prowizji w aplikacji na Maca — zakładka „Prowizje” karty pracownika (konto `employee`) i sekcja „Prowizje i narzuty”
 * karty sprzedawcy (konto `partner`, `/bridge/native/v1/sellers`). Pracownik: całe konto prowizji pracownika z bazy
 * (`get_commission_settlements`, konto „employee” — udział w sprzedaży wydarzeń, wpisy ręczne dla pracownika i profil sprzedawcy
 * powiązany z pracownikiem), sumy jak `buildCommissionSettlementStats` (cała historia i każda marka), warunki „Prowizja od sprzedaży”
 * i zapisy jak w CRM: zatwierdzenie wpisu ręcznego i wypłata (`record_commission_settlement`), potrącenie nadpłaty
 * (`settle_commission_deduction`), warunki pracownika (`set_employee_sales_commission_terms`).
 *
 * „Rozlicz przy wypłacie” (`commissionPayroll`): najpierw potrącenia otwartych nadpłat z zaznaczonych prowizji (ta sama marka i sposób
 * wypłaty albo to samo wydarzenie — jak w bazie), potem wypłata pozostałej kwoty każdej zaznaczonej prowizji z jedną datą, numerem
 * listy płac i opisem. Klucz operacji zależy od klucza rozliczenia i salda przed zapisem: ponowienie po niepewnej odpowiedzi daje ten sam
 * klucz (baza nie zapisze drugi raz), a po zapisanej operacji saldo jest już inne. Tokenem pracownika — uprawnienia sprawdza baza.
 */

type Row = Record<string, any>;
type DbError = { code?: string; message?: string };
export type CommissionReply<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const METHODS = ['payroll', 'cash_dividend', 'invoice', 'other'];
const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const optNum = (value: unknown) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const str = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const optStr = (value: unknown) => (typeof value === 'string' && value ? value : null);
const cents = (value: unknown) => Math.round(num(value) * 100);
const fail = (error: string, status = 400): CommissionReply<never> => ({ ok: false, error, status });

/** Dzisiejsza data w Polsce (RRRR-MM-DD) — baza nie przyjmie wypłaty z datą późniejszą. */
export const warsawToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
const validMoney = (value: unknown): value is number => typeof value === 'number'
  && Number.isFinite(value) && value > 0 && value < 1e12 && Math.abs(value * 100 - Math.round(value * 100)) < 0.0001;
const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** Identyfikator operacji wyliczony z części (UUID w formacie RFC 4122) — ten sam stan daje ten sam klucz. */
export function derivedKey(...parts: string[]) {
  const hex = createHash('sha256').update(parts.join('|')).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function dbFailure(error: DbError, fallback: string): { ok: false; error: string; status: number } {
  const code = error.code || '';
  if (['PGRST202', '42883', '42P01', '42703'].includes(code)) {
    return { ok: false, error: 'Rozliczenia prowizji wymagają aktualizacji schematu bazy.', status: 503 };
  }
  if (code === '42501') return { ok: false, error: error.message || 'Nie masz dostępu do tych rozliczeń prowizji.', status: 403 };
  if (['P0001', '22023', '22P02', '40001', '23505', '23514'].includes(code)) {
    return { ok: false, error: error.message || 'Dane zmieniły się. Odśwież prowizje.', status: 409 };
  }
  console.error('[native-commissions]', code, error.message);
  return { ok: false, error: fallback, status: 500 };
}

// MARK: Konto prowizji pracownika

export type CommissionAccountType = 'employee' | 'partner';

async function accountRows(ctx: NativeContext, accountType: CommissionAccountType, accountId: string): Promise<{ rows: CommissionSettlement[]; canManage: boolean } | { error: DbError }> {
  const { data, error } = await ctx.supabase.rpc('get_commission_settlements', {
    p_mode: 'crm', p_account_type: accountType, p_account_id: accountId,
  });
  if (error) return { error };
  const result = (data || {}) as Row;
  return { rows: Array.isArray(result.commissions) ? (result.commissions as CommissionSettlement[]) : [], canManage: result.canManage === true };
}

/** Osoba wpisu (do potrąceń: ta sama osoba jak w `settle_commission_deduction`). Odczyt tabeli tylko dla rozliczających — RLS jak w CRM. */
export type CommissionPerson = { partner: string | null; contact: string | null; employee: string | null };
async function commissionPersons(ctx: NativeContext, ids: string[]) {
  const persons = new Map<string, CommissionPerson>();
  for (let index = 0; index < ids.length; index += 200) {
    const { data, error } = await ctx.supabase.from('event_commissions').select('id,sales_partner_id,contact_id,employee_id')
      .in('id', ids.slice(index, index + 200));
    if (error) return persons;
    for (const row of (data || []) as Row[]) {
      persons.set(str(row.id), { partner: optStr(row.sales_partner_id), contact: optStr(row.contact_id), employee: optStr(row.employee_id) });
    }
  }
  return persons;
}
const samePerson = (d?: CommissionPerson, t?: CommissionPerson) => Boolean(d && t && (
  (d.partner && d.partner === t.partner) || (d.contact && d.contact === t.contact)
  || (!d.partner && !t.partner && d.employee && d.employee === t.employee)));

const normalize = (row: Row, person: CommissionPerson | null) => ({
  id: str(row.id),
  eventId: str(row.event_id),
  eventName: str(row.event_name),
  eventDate: optStr(row.event_date),
  companyId: optStr(row.my_company_id),
  companyName: optStr(row.company_name),
  canManage: row.can_manage === true,
  beneficiaryName: str(row.beneficiary_name),
  amount: num(row.amount),
  companyCost: optNum(row.company_cost_amount),
  status: str(row.status) || 'planned',
  waiting: row.automatic_waiting_for_offer === true,
  createdAt: optStr(row.created_at),
  dueDate: optStr(row.due_date),
  paymentMethod: str(row.payment_method) || 'invoice',
  paidAmount: num(row.paid_amount),
  remainingAmount: num(row.remaining_amount),
  baseAmount: optNum(row.base_amount),
  rate: optNum(row.rate),
  baseDescription: optStr(row.base_description),
  rateReason: optStr(row.rate_reason),
  entryKind: str(row.entry_kind) || 'accrual',
  correctsId: optStr(row.corrects_commission_id),
  source: optStr(row.automatic_source),
  sharePercent: optNum(row.share_percent),
  clientOwned: typeof row.client_owned === 'boolean' ? row.client_owned : null,
  revision: optNum(row.settlement_revision),
  toOffset: num(row.to_offset),
  offsetAmount: num(row.offset_amount),
  payments: (Array.isArray(row.payments) ? row.payments : []).map((payment: Row) => ({
    id: str(payment.id),
    amount: num(payment.amount),
    paymentDate: optStr(payment.payment_date),
    recordedAt: optStr(payment.recorded_at),
    reference: optStr(payment.reference),
    note: optStr(payment.note),
    source: str(payment.source) || 'ledger',
    isOffset: payment.is_offset === true || payment.source === 'offset',
  })),
  person,
});

/** Warunki „Prowizja od sprzedaży”: pełne (administrator / rozliczający prowizje) albo własne stawki pracownika. */
async function loadTerms(ctx: NativeContext, employeeId: string, own: boolean) {
  const settings = await ctx.supabase.rpc('get_sales_commission_settings');
  if (!settings.error && settings.data && typeof settings.data === 'object') {
    const s = settings.data as Row;
    const list = Array.isArray(s.employees) ? (s.employees as Row[]) : [];
    const t = list.find((entry) => str(entry.employee_id) === employeeId);
    const defaultStandard = optNum(s.standard_rate) ?? 5;
    const defaultOwn = optNum(s.own_client_rate) ?? 10;
    const customStandard = optNum(t?.standard_rate);
    const customOwn = optNum(t?.own_client_rate);
    return {
      enabled: t?.enabled === true,
      standardRate: customStandard ?? defaultStandard,
      ownClientRate: customOwn ?? defaultOwn,
      customStandardRate: customStandard,
      customOwnClientRate: customOwn,
      defaultStandardRate: defaultStandard,
      defaultOwnClientRate: defaultOwn,
      paymentMethod: METHODS.includes(str(t?.payment_method)) ? str(t?.payment_method) : 'payroll',
      employerSocialRate: optNum(s.employer_social_rate),
      updatedAt: optStr(t?.updated_at),
      editable: ctx.employee.isAdmin,
    };
  }
  if (own) {
    const mine = await ctx.supabase.rpc('get_my_commissions');
    if (!mine.error && mine.data && typeof mine.data === 'object') {
      const m = mine.data as Row;
      return {
        enabled: m.enabled === true,
        standardRate: optNum(m.standard_rate) ?? 5,
        ownClientRate: optNum(m.own_client_rate) ?? 10,
        customStandardRate: null,
        customOwnClientRate: null,
        defaultStandardRate: null,
        defaultOwnClientRate: null,
        paymentMethod: METHODS.includes(str(m.payment_method)) ? str(m.payment_method) : 'payroll',
        employerSocialRate: null,
        updatedAt: null,
        editable: false,
      };
    }
  }
  return null;
}

const statsOf = (rows: CommissionSettlement[]) => buildCommissionSettlementStats(rows);

export async function commissionAccount(ctx: NativeContext, accountType: CommissionAccountType, accountId: string) {
  const own = accountType === 'employee' && ctx.employee.id === accountId;
  const account = await accountRows(ctx, accountType, accountId);
  if ('error' in account) {
    // Brak dostępu do finansów (i to nie własne konto) — zakładka się nie pokazuje, jak karta w CRM.
    if (account.error.code === '42501') {
      return { ok: true as const, data: {
        hidden: true, message: account.error.message || 'Nie masz dostępu do rozliczeń prowizji tej osoby.',
        own, canManage: false, terms: null, commissions: [], stats: null, today: warsawToday(),
      } };
    }
    return dbFailure(account.error, 'Nie udało się wczytać prowizji.');
  }
  // Warunki „Prowizja od sprzedaży” dotyczą pracownika; warunki sprzedawcy są w jego karcie (marki).
  const terms = accountType === 'employee' ? await loadTerms(ctx, accountId, own) : null;
  const persons = account.canManage ? await commissionPersons(ctx, account.rows.map((row) => row.id)) : new Map<string, CommissionPerson>();
  const companies = new Map<string, { name: string; rows: CommissionSettlement[] }>();
  for (const row of account.rows) {
    const id = str(row.my_company_id);
    if (!id) continue;
    const entry = companies.get(id) || { name: str(row.company_name) || 'Marka bez nazwy', rows: [] };
    entry.rows.push(row);
    companies.set(id, entry);
  }
  return { ok: true as const, data: {
    hidden: false, message: null, own, canManage: account.canManage, terms,
    commissions: account.rows.map((row) => normalize(row as Row, persons.get(row.id) || null)),
    stats: {
      all: statsOf(account.rows),
      companies: [...companies.entries()]
        .map(([id, entry]) => ({ id, name: entry.name, stats: statsOf(entry.rows) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pl')),
    },
    today: warsawToday(),
  } };
}

// MARK: Pojedyncze czynności (jak `/bridge/commissions/settlements` i `CommissionSettlementsPanel`)

export async function approveCommission(ctx: NativeContext, body: Row): Promise<CommissionReply<Row>> {
  const commissionId = str(body.commissionId);
  if (!UUID.test(commissionId)) return fail('Nieprawidłowa prowizja.');
  if (!validMoney(body.expectedAmount)) return fail('Odśwież kwotę prowizji przed zatwierdzeniem.');
  const { data, error } = await ctx.supabase.rpc('record_commission_settlement', {
    p_commission_id: commissionId, p_action: 'approve', p_amount: null, p_payment_date: null, p_reference: null, p_note: null,
    p_idempotency_key: null, p_expected_amount: body.expectedAmount,
  });
  if (error) return dbFailure(error, 'Nie udało się zatwierdzić prowizji. Odśwież jej status przed ponowieniem.');
  return { ok: true, data: { ok: true, duplicate: (data as Row | null)?.duplicate === true } };
}

export async function payoutCommission(ctx: NativeContext, body: Row): Promise<CommissionReply<Row>> {
  const commissionId = str(body.commissionId);
  const key = str(body.idempotencyKey);
  if (!UUID.test(commissionId) || !UUID.test(key)) return fail('Nieprawidłowa operacja prowizji.');
  if (!validMoney(body.amount)) return fail('Podaj dodatnią kwotę z maksymalnie dwoma miejscami po przecinku.');
  if (!validDate(body.paymentDate) || body.paymentDate > warsawToday()) return fail('Wpisz prawidłową datę wykonanej wypłaty, nie późniejszą niż dzisiaj.');
  const reference = str(body.reference).trim();
  const note = str(body.note).trim();
  if (reference.length > 200 || note.length > 2000) return fail('Numer lub opis jest zbyt długi (maksymalnie 200 / 2000 znaków).');
  const { data, error } = await ctx.supabase.rpc('record_commission_settlement', {
    p_commission_id: commissionId, p_action: 'payout', p_amount: body.amount, p_payment_date: body.paymentDate,
    p_reference: reference || null, p_note: note || null, p_idempotency_key: key, p_expected_amount: null,
  });
  if (error) {
    return dbFailure(error, 'Nie udało się potwierdzić zapisu wypłaty. Ponów zapis — ten sam identyfikator operacji nie doda duplikatu.');
  }
  const result = (data || {}) as Row;
  if (result.ok !== true) return fail('Brak potwierdzenia zapisu wypłaty. Ponów zapis — nie doda duplikatu.', 500);
  return { ok: true, data: { ok: true, duplicate: result.duplicate === true } };
}

export async function deductCommission(ctx: NativeContext, body: Row): Promise<CommissionReply<Row>> {
  const deductionId = str(body.deductionId);
  const targetId = str(body.targetId);
  const key = str(body.idempotencyKey);
  if (!UUID.test(deductionId) || !UUID.test(key)) return fail('Nieprawidłowe potrącenie.');
  if (!UUID.test(targetId)) return fail('Wybierz prowizję, z której potrącisz kwotę.');
  const { data, error } = await ctx.supabase.rpc('settle_commission_deduction', {
    p_deduction_id: deductionId, p_target_id: targetId, p_idempotency_key: key,
  });
  if (error) return dbFailure(error, 'Nie udało się zapisać potrącenia. Ponów — ten sam identyfikator nie zapisze go drugi raz.');
  const result = (data || {}) as Row;
  return { ok: true, data: { ok: true, duplicate: result.duplicate === true, amount: num(result.amount) } };
}

export async function saveCommissionTerms(ctx: NativeContext, employeeId: string, body: Row): Promise<CommissionReply<Row>> {
  const rate = (value: unknown) => (value == null || value === '' ? null : Number(value));
  const standard = rate(body.standardRate);
  const ownClient = rate(body.ownClientRate);
  for (const value of [standard, ownClient]) {
    if (value != null && (!Number.isFinite(value) || value < 0 || value > 100)) return fail('Stawki muszą mieścić się w zakresie 0–100%.');
  }
  const method = str(body.paymentMethod) || 'payroll';
  if (!METHODS.includes(method)) return fail('Nieznany sposób wypłaty.');
  const { error } = await ctx.supabase.rpc('set_employee_sales_commission_terms', {
    p_employee_id: employeeId, p_enabled: body.enabled === true, p_standard_rate: standard, p_own_client_rate: ownClient,
    p_payment_method: method,
  });
  if (error) return dbFailure(error, 'Nie udało się zapisać warunków prowizji.');
  return { ok: true, data: { ok: true } };
}

// MARK: Rozliczenie przy wypłacie

type PlanRow = Pick<CommissionSettlement, 'id' | 'event_id' | 'event_date' | 'created_at' | 'my_company_id' | 'payment_method'
  | 'status' | 'entry_kind' | 'can_manage' | 'automatic_waiting_for_offer' | 'remaining_amount' | 'to_offset'>;
export type OffsetStep = { deductionId: string; targetId: string; deductionLeftCents: number; targetLeftCents: number; amountCents: number };

// Kolejność po kodach znaków (bez reguł języka) — ta sama w aplikacji, żeby podgląd potrąceń zgadzał się z zapisem.
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byDate = (a: PlanRow, b: PlanRow) => order(a.event_date || '9999', b.event_date || '9999')
  || order(a.created_at || '', b.created_at || '') || order(a.id, b.id);

/**
 * Plan potrąceń przed wypłatą: każde otwarte potrącenie (od najstarszego wydarzenia) zmniejsza zaznaczone prowizje do wypłaty tej
 * samej osoby i marki oraz tego samego sposobu wypłaty albo z tego samego wydarzenia — tak samo jak `settle_commission_deduction`
 * (kwota: mniejsza z obu sald). Ten sam plan liczy podgląd w aplikacji (`CommissionPayrollPlan` w Swift).
 */
export function planOffsets(rows: readonly PlanRow[], selectedIds: readonly string[], persons: ReadonlyMap<string, CommissionPerson>): OffsetStep[] {
  const selected = new Set(selectedIds);
  const targets = rows.filter((row) => selected.has(row.id) && row.can_manage && row.status === 'approved' && row.entry_kind !== 'deduction'
    && !row.automatic_waiting_for_offer && cents(row.remaining_amount) > 0).sort(byDate);
  const deductions = rows.filter((row) => row.can_manage && row.entry_kind === 'deduction' && row.status === 'approved'
    && cents(row.to_offset) > 0).sort(byDate);
  const left = new Map(targets.map((row) => [row.id, cents(row.remaining_amount)]));
  const steps: OffsetStep[] = [];
  for (const deduction of deductions) {
    let deductionLeft = cents(deduction.to_offset);
    for (const target of targets) {
      if (deductionLeft <= 0) break;
      const targetLeft = left.get(target.id) || 0;
      if (targetLeft <= 0) continue;
      if (str(target.my_company_id) !== str(deduction.my_company_id)) continue;
      if (!samePerson(persons.get(deduction.id), persons.get(target.id))) continue;
      if (target.payment_method !== deduction.payment_method && target.event_id !== deduction.event_id) continue;
      const amount = Math.min(deductionLeft, targetLeft);
      steps.push({ deductionId: deduction.id, targetId: target.id, deductionLeftCents: deductionLeft, targetLeftCents: targetLeft, amountCents: amount });
      deductionLeft -= amount;
      left.set(target.id, targetLeft - amount);
    }
  }
  return steps;
}

type PayrollLine = { commissionId: string; eventName: string; kind: 'offset' | 'paid' | 'skipped' | 'error'; amount: number; message: string };

export async function commissionPayroll(ctx: NativeContext, accountType: CommissionAccountType, accountId: string, body: Row): Promise<CommissionReply<Row>> {
  const batchKey = str(body.batchKey);
  if (!UUID.test(batchKey)) return fail('Brak identyfikatora rozliczenia. Otwórz okno ponownie.');
  const ids = Array.isArray(body.commissionIds) ? [...new Set((body.commissionIds as unknown[]).map(str))] : [];
  if (!ids.length || ids.length > 100 || ids.some((id) => !UUID.test(id))) return fail('Zaznacz od 1 do 100 prowizji do rozliczenia.');
  const paymentDate = str(body.paymentDate);
  if (!validDate(paymentDate) || paymentDate > warsawToday()) return fail('Wpisz prawidłową datę wykonanej wypłaty, nie późniejszą niż dzisiaj.');
  const reference = str(body.reference).trim();
  const note = str(body.note).trim();
  if (reference.length > 200 || note.length > 2000) return fail('Numer lub opis jest zbyt długi (maksymalnie 200 / 2000 znaków).');
  const applyDeductions = body.applyDeductions !== false;

  let account = await accountRows(ctx, accountType, accountId);
  if ('error' in account) return dbFailure(account.error, 'Nie udało się wczytać prowizji.');
  if (!account.canManage) return fail('Rozliczanie prowizji wymaga uprawnienia „Zarządzanie finansami”.', 403);
  const known = new Set(account.rows.map((row) => row.id));
  if (ids.some((id) => !known.has(id))) return fail('Część zaznaczonych prowizji nie należy już do tego konta. Odśwież prowizje.', 409);

  const lines: PayrollLine[] = [];
  const names = new Map(account.rows.map((row) => [row.id, str(row.event_name) || 'Event']));
  let offsetCents = 0;
  let paidCents = 0;
  let uncertain = false;

  // 1. Potrącenia nadpłat (bez przelewu). Błąd zatrzymuje rozliczenie przed wypłatami — inaczej wypłacilibyśmy więcej niż w podglądzie.
  if (applyDeductions) {
    const persons = await commissionPersons(ctx, account.rows.map((row) => row.id));
    const steps = planOffsets(account.rows, ids, persons);
    for (const step of steps) {
      const key = derivedKey('mavinci-payroll', batchKey, 'offset', step.deductionId, step.targetId, String(step.deductionLeftCents), String(step.targetLeftCents));
      const { data, error } = await ctx.supabase.rpc('settle_commission_deduction', {
        p_deduction_id: step.deductionId, p_target_id: step.targetId, p_idempotency_key: key,
      });
      if (error) {
        const failure = dbFailure(error, 'Nie udało się potwierdzić potrącenia.');
        lines.push({ commissionId: step.targetId, eventName: names.get(step.targetId) || 'Event', kind: 'error', amount: step.amountCents / 100, message: failure.error });
        return { ok: true, data: {
          done: false, stopped: true, uncertain: failure.status >= 500, lines, paid: paidCents / 100, offset: offsetCents / 100,
          message: 'Potrącenie nie zostało zapisane, więc wypłat nie zapisano. Odśwież prowizje i rozlicz ponownie — zapisane już potrącenia nie powtórzą się.',
        } };
      }
      const amount = cents((data as Row | null)?.amount);
      offsetCents += amount;
      lines.push({ commissionId: step.targetId, eventName: names.get(step.targetId) || 'Event', kind: 'offset', amount: amount / 100,
        message: (data as Row | null)?.duplicate === true ? 'Potrącenie było już zapisane' : 'Potrącono nadpłatę (bez przelewu)' });
    }
    if (steps.length) {
      account = await accountRows(ctx, accountType, accountId);
      if ('error' in account) {
        const failure = dbFailure(account.error, 'Nie udało się odświeżyć prowizji po potrąceniach.');
        return { ok: true, data: {
          done: false, stopped: true, uncertain: false, lines, paid: 0, offset: offsetCents / 100,
          message: `${failure.error} Potrącenia są zapisane; wypłat nie zapisano — rozlicz ponownie.`,
        } };
      }
    }
  }

  // 2. Wypłaty pozostałych kwot (każda prowizja osobno; błąd jednej nie zatrzymuje pozostałych).
  const current = new Map(account.rows.map((row) => [row.id, row]));
  const ordered = ids.map((id) => current.get(id)).filter((row): row is CommissionSettlement => Boolean(row)).sort(byDate);
  for (const row of ordered) {
    const eventName = str(row.event_name) || 'Event';
    const skip = (message: string) => lines.push({ commissionId: row.id, eventName, kind: 'skipped', amount: 0, message });
    if (row.entry_kind === 'deduction') { skip('To potrącenie — odlicza się od innych prowizji.'); continue; }
    // Ponowienie po niepewnej odpowiedzi: wypłata z tą datą i numerem już jest — pokazujemy ją jako zapisaną, bez drugiego zapisu.
    const earlier = (row.payments || []).find((payment) => payment.source === 'ledger' && !payment.is_offset
      && payment.payment_date === paymentDate && (payment.reference || '') === reference);
    if (earlier && cents(row.remaining_amount) <= 0) {
      paidCents += cents(earlier.amount);
      lines.push({ commissionId: row.id, eventName, kind: 'paid', amount: cents(earlier.amount) / 100, message: 'Wypłata była już zapisana' });
      continue;
    }
    if (row.status === 'paid') { skip(cents(row.offset_amount) > 0 ? 'Rozliczona (także potrąceniem)' : 'Już rozliczona'); continue; }
    if (row.status === 'planned') { skip('Niezatwierdzona — do wypłaty po zatwierdzeniu.'); continue; }
    if (row.status !== 'approved') { skip('Anulowana — nie wypłaca się.'); continue; }
    if (row.automatic_waiting_for_offer) { skip('Oczekuje na podstawę (oferta).'); continue; }
    if (!row.can_manage) { skip('Brak uprawnień do rozliczenia tego eventu.'); continue; }
    const remaining = cents(row.remaining_amount);
    if (remaining <= 0) { skip('Nic do wypłaty'); continue; }
    const key = derivedKey('mavinci-payroll', batchKey, 'payout', row.id, String(cents(row.paid_amount)));
    const { data, error } = await ctx.supabase.rpc('record_commission_settlement', {
      p_commission_id: row.id, p_action: 'payout', p_amount: remaining / 100, p_payment_date: paymentDate,
      p_reference: reference || null, p_note: note || null, p_idempotency_key: key, p_expected_amount: null,
    });
    if (error || (data as Row | null)?.ok !== true) {
      const failure = error ? dbFailure(error, 'Nie udało się potwierdzić zapisu wypłaty.') : { error: 'Brak potwierdzenia zapisu wypłaty.', status: 500 };
      if (failure.status >= 500) uncertain = true;
      lines.push({ commissionId: row.id, eventName, kind: 'error', amount: remaining / 100, message: failure.error });
      continue;
    }
    paidCents += remaining;
    lines.push({ commissionId: row.id, eventName, kind: 'paid', amount: remaining / 100,
      message: (data as Row).duplicate === true ? 'Wypłata była już zapisana' : 'Wypłata zapisana' });
  }
  const errors = lines.filter((line) => line.kind === 'error').length;
  return { ok: true, data: {
    done: errors === 0, stopped: false, uncertain, lines, paid: paidCents / 100, offset: offsetCents / 100,
    message: errors ? `Nie zapisano ${errors} z ${ordered.length} wypłat — szczegóły na liście.` : null,
  } };
}
