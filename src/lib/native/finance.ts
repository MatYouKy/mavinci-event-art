import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { NativeContext } from './auth';
import { sendingAccounts } from './offerActions';
import { emailPreviewDocument, plainTextToEmailHtml } from './messages';
import { canFinanceCompany, loadInvoiceFinanceAccess } from '@/lib/invoices/financeAccess';
import { parseVatWhitelistRequest, runVatWhitelistCheck } from '@/lib/invoices/vatWhitelist.server';
import { generateStoredInvoicePdf } from '@/lib/invoices/print/storeInvoicePdf.server';
import { getInvoiceKsefRecipient } from '@/lib/invoices/ksefRecipient';
import { getInvoicePartyDataCorrection } from '@/lib/invoices/partyDataCorrection';
import { buildCompanyEmailBody, buildCompanySignatureHtml } from '@/lib/buildCompanySignature';
import { dispatchCrmEmail } from '@/lib/emailScheduling';
import { handleKsefUpoRequest } from '@/app/bridge/ksef/upoRequests';

/*
 * Finanse dla Maca (`/crm/invoices`: „Centrum finansów”, „Terminy i monity”, „Zamknięcie miesięcy”) — te same funkcje bazy
 * co CRM, klientem z tokenem pracownika, więc uprawnienia i zakres jak w przeglądarce: get_finance_center,
 * get_finance_deadlines, get_vat_whitelist_status, get_finance_periods (dostęp sprawdza baza — „Podgląd finansów”
 * działalności), zapisy save_finance_tax_settings, save_finance_obligation_setting, set_ksef_invoice_payment_due,
 * delete_finance_supplier_payment_term, lock_finance_period / unlock_finance_period. Biała lista VAT i UPO — wspólna logika
 * z trasami CRM (`src/lib/invoices/vatWhitelist.server.ts`, `src/app/bridge/ksef/upoRequests.ts`). Przypomnienie
 * o płatności (monit) — jak `SendInvoiceEmailModal` w trybie „reminder”: skrzynki pracownika, adresaci z organizacji
 * nabywcy, szablon i stopka firmy faktury (cel „invoice”), PDF faktury w załączniku, `send-invoice-email` (przy
 * planowaniu — kolejka) i wpis w historii monitów (record_invoice_payment_reminder). Ten sam formularz w trybie „invoice”
 * („Wyślij email” z karty faktury): temat „Faktura …”, treść jak w CRM, bez wpisu w historii monitów. Karta faktury:
 * „Generuj / Regeneruj PDF” (`src/lib/invoices/print/storeInvoicePdf.server.ts`, wspólne z trasą CRM
 * `/bridge/invoices/invoice-pdf`), pobranie zapisanego PDF i UPO jednej faktury (`handleKsefUpoRequest`).
 * Odpowiedź ma stały kształt (camelCase, liczby i null), żeby aplikacja nie zależała od szczegółów zapisu w bazie.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class FinanceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new FinanceError(message, status);
}
/** Błąd funkcji bazy → komunikat dla pracownika; 42501 (brak uprawnień) → 403. */
function rpcFail(error: { message?: string; code?: string } | null, fallback: string): never {
  fail(error?.message || fallback, error?.code === '42501' ? 403 : 400);
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(parsed) ? 0 : parsed;
};
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const strOrNull = (value: unknown): string | null => (value === null || value === undefined || value === '' ? null : String(value));
const day = (value: unknown): string | null => {
  const text = strOrNull(value);
  return text ? text.slice(0, 10) : null;
};
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Row[] : []);
const object = (value: unknown): Row => (value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {});
const uuid = (value: unknown, message: string) => {
  const text = str(value).trim();
  if (!UUID.test(text)) fail(message);
  return text;
};

const warsawToday = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// MARK: Działalności i stan sekcji

/**
 * Działalności z „Podglądem finansów” (jak `filterFinanceCompanies(access, companies, 'finance_view')` w CRM). Finanse
 * prowadzi się dla działalności, czyli firm z NIP — marki bez NIP (np. Event Rulers) są pomijane, jak w sekcji Finanse CRM.
 */
async function financeCompanies(ctx: NativeContext) {
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  const { data, error } = await ctx.supabase.from('my_companies').select('id,name,nip,is_default').eq('is_active', true).order('name');
  if (error) fail('Nie udało się wczytać firm.', 500);
  return rows(data)
    .filter((company) => str(company.nip).trim() !== '' && canFinanceCompany(access, String(company.id), 'finance_view'))
    .map((company) => ({
      id: String(company.id),
      name: str(company.name),
      isDefault: company.is_default === true,
      canManage: canFinanceCompany(access, String(company.id), 'finance_manage'),
      canRemind: canFinanceCompany(access, String(company.id), 'invoices_issue'),
    }));
}

function centerOf(raw: unknown) {
  const data = object(raw);
  const cash = object(data.cash);
  const cit = object(data.cit);
  const forecast = object(data.forecast);
  const checklist = object(data.checklist);
  const today = day(data.today) || warsawToday();
  return {
    companyId: str(data.company_id),
    companyName: str(data.company_name),
    today,
    canManage: data.can_manage === true,
    cash: {
      accounts: rows(cash.accounts).map((account) => ({
        key: str(account.key),
        label: str(account.label),
        accountType: str(account.account_type) || 'regular',
        currency: str(account.currency) || 'PLN',
        balance: numOrNull(account.balance),
        asOf: day(account.as_of),
      })),
      asOf: day(cash.as_of),
      total: num(cash.total),
      daysOld: numOrNull(cash.days_old),
    },
    items: rows(data.items).map((item) => ({
      kind: str(item.kind),
      direction: item.direction === 'in' ? 'in' : 'out',
      id: str(item.id),
      invoiceId: strOrNull(item.invoice_id),
      label: strOrNull(item.label),
      counterparty: strOrNull(item.counterparty),
      issueDate: day(item.issue_date),
      dueDate: day(item.due_date),
      amount: num(item.amount),
      currency: str(item.currency) || 'PLN',
      estimated: item.estimated === true,
      note: strOrNull(item.note),
      daysOverdue: numOrNull(item.days_overdue),
    })),
    obligations: rows(data.obligations)
      .map((item) => ({
        kind: str(item.kind),
        form: str(item.form),
        periodKind: str(item.period_kind),
        periodStart: day(item.period_start) || '',
        label: str(item.label),
        dueDate: day(item.due_date) || '',
        amount: numOrNull(item.amount),
        estimated: item.estimated === true,
        status: str(item.status),
        overdue: item.overdue === true,
      }))
      .filter((item) => item.dueDate !== ''),
    vat: Array.isArray(data.vat)
      ? rows(data.vat).map((month) => ({
          periodStart: day(month.period_start) || '',
          outputVat: num(month.output_vat),
          inputVat: num(month.input_vat),
          carried: num(month.carried),
          estimate: num(month.estimate),
          salesCount: num(month.sales_count),
          costCount: num(month.cost_count),
          foreignCount: num(month.foreign_count),
          declared: numOrNull(month.declared),
          paid: num(month.paid),
          dueDate: day(month.due_date),
        }))
      : null,
    cit: {
      year: num(cit.year) || Number(today.slice(0, 4)),
      rate: numOrNull(cit.rate),
      revenueNet: num(cit.revenue_net),
      costsNet: num(cit.costs_net),
      result: num(cit.result),
      tax: numOrNull(cit.tax),
      paid: num(cit.paid),
      reserve: numOrNull(cit.reserve),
    },
    forecast: {
      week0: day(forecast.week0) || today,
      until: day(forecast.until) || today,
      weeks: Math.max(1, Math.min(52, Math.round(num(forecast.weeks)) || 13)),
    },
    quality: rows(data.quality).map((item) => ({
      level: item.level === 'error' || item.level === 'warning' ? String(item.level) : 'info',
      key: str(item.key),
      text: str(item.text),
      tab: str(item.tab),
      section: strOrNull(item.section),
    })),
    checklist: {
      periodYear: num(checklist.period_year),
      periodMonth: num(checklist.period_month),
      items: rows(checklist.items).map((item) => ({
        key: str(item.key),
        label: str(item.label),
        done: item.done === true ? true : item.done === false ? false : null,
        detail: strOrNull(item.detail),
        tab: str(item.tab),
        section: strOrNull(item.section),
      })),
    },
    citRate: numOrNull(object(data.tax_settings).cit_rate),
  };
}

function deadlinesOf(raw: unknown) {
  const data = object(raw);
  const today = day(data.today) || warsawToday();
  return {
    today,
    statementEnd: day(data.statement_end),
    obligations: rows(data.obligations)
      .map((item) => ({
        kind: str(item.kind),
        form: str(item.form),
        periodKind: str(item.period_kind),
        periodStart: day(item.period_start) || '',
        label: str(item.label),
        settingLabel: strOrNull(item.setting_label),
        dueDate: day(item.due_date) || '',
        amountDue: numOrNull(item.amount_due),
        paid: num(item.paid),
        status: str(item.status),
        overdue: item.overdue === true,
      }))
      .filter((item) => item.dueDate !== ''),
    receivables: rows(data.receivables)
      .map((item) => ({
        source: item.source === 'ksef' ? 'ksef' : 'local',
        id: str(item.id),
        invoiceId: strOrNull(item.invoice_id),
        invoiceNumber: str(item.invoice_number),
        buyerName: strOrNull(item.buyer_name),
        buyerEmail: strOrNull(item.buyer_email),
        issueDate: day(item.issue_date),
        dueDate: day(item.due_date) || '',
        gross: num(item.gross),
        outstanding: num(item.outstanding),
        currency: str(item.currency) || 'PLN',
        inKsef: item.in_ksef === true,
        daysOverdue: num(item.days_overdue),
        reminders: num(item.reminders),
        lastReminderAt: strOrNull(item.last_reminder_at),
      }))
      .filter((item) => item.dueDate !== ''),
    payables: rows(data.payables).map((item) => ({
      id: str(item.id),
      invoiceNumber: str(item.invoice_number),
      sellerName: strOrNull(item.seller_name),
      sellerNip: strOrNull(item.seller_nip),
      issueDate: day(item.issue_date),
      dueDate: day(item.due_date),
      dueSource: item.due_source === 'manual' || item.due_source === 'supplier_default' ? String(item.due_source) : null,
      amount: num(item.amount),
      currency: str(item.currency) || 'PLN',
      bankAccount: strOrNull(item.bank_account),
      daysLeft: numOrNull(item.days_left),
      supplierDays: numOrNull(item.supplier_days),
    })),
    supplierTerms: rows(data.supplier_terms).map((item) => ({
      sellerNip: str(item.seller_nip),
      sellerName: strOrNull(item.seller_name),
      days: num(item.days),
    })),
    settings: rows(data.settings).map((item) => ({
      kind: str(item.kind),
      form: str(item.form),
      periodKind: str(item.period_kind),
      enabled: item.enabled === true,
      dueDay: num(item.due_day),
      dueMonthOffset: num(item.due_month_offset),
      label: strOrNull(item.label),
    })),
  };
}

const VERDICTS = new Set(['ok', 'not_listed', 'not_found', 'no_account', 'error']);
const verdictOf = (value: unknown) => (VERDICTS.has(str(value)) ? str(value) : null);

function whitelistOf(raw: unknown) {
  const data = object(raw);
  return {
    today: day(data.today) || warsawToday(),
    payables: rows(data.payables).map((item) => ({
      ksefInvoiceId: str(item.ksef_invoice_id),
      nip: strOrNull(item.nip),
      account: strOrNull(item.account),
      gross: num(item.gross),
      verdict: verdictOf(item.verdict),
      statusVat: strOrNull(item.status_vat),
      checkDate: day(item.check_date),
      requestId: strOrNull(item.request_id),
      fresh: item.fresh === true,
    })),
    payments: rows(data.payments).map((item) => ({
      bankTransactionId: str(item.bank_transaction_id),
      documentNumber: strOrNull(item.document_number),
      sellerName: strOrNull(item.seller_name),
      nip: strOrNull(item.nip),
      account: strOrNull(item.account),
      transactionDate: day(item.transaction_date) || '',
      amount: num(item.amount),
      documentGross: num(item.document_gross),
      verdict: verdictOf(item.verdict),
      statusVat: strOrNull(item.status_vat),
      requestId: strOrNull(item.request_id),
    })),
  };
}

function periodsOf(raw: unknown) {
  return rows(raw).map((item) => ({
    month: num(item.month),
    locked: item.locked === true,
    lockedAt: strOrNull(item.locked_at),
    lockedByName: strOrNull(item.locked_by_name),
    lockNote: strOrNull(item.lock_note),
    handedOverAt: strOrNull(item.handed_over_at),
    reopenings: rows(item.reopenings).map((reopening) => ({
      unlockedAt: str(reopening.unlocked_at),
      reason: strOrNull(reopening.reason),
      byName: strOrNull(reopening.by_name),
    })),
  }));
}

/** Rok zamknięć domyślnie jak w CRM: w styczniu — poprzedni rok, potem bieżący. */
function defaultPeriodYear() {
  const today = warsawToday();
  const year = Number(today.slice(0, 4));
  return Number(today.slice(5, 7)) === 1 ? year - 1 : year;
}

function periodYear(value: unknown) {
  const year = Math.round(num(value));
  const current = Number(warsawToday().slice(0, 4));
  return year >= current - 2 && year <= current ? year : defaultPeriodYear();
}

/**
 * Stan sekcji dla działalności (wskazanej albo pierwszej z dostępem): Centrum finansów, terminy, biała lista i zamknięcia
 * miesięcy roku. Błąd jednej części nie ukrywa pozostałych (jak osobne panele CRM); biała lista jest dodatkiem.
 */
export async function financeState(ctx: NativeContext, companyParam: string | null, yearParam: string | null) {
  const companies = await financeCompanies(ctx);
  const company = companies.find((item) => item.id === companyParam) ?? companies[0] ?? null;
  if (!company) return { companies, company: null, state: null };
  const year = yearParam ? periodYear(yearParam) : defaultPeriodYear();
  const [center, deadlines, whitelist, periods] = await Promise.all([
    ctx.supabase.rpc('get_finance_center', { p_company_id: company.id }),
    ctx.supabase.rpc('get_finance_deadlines', { p_company_id: company.id }),
    ctx.supabase.rpc('get_vat_whitelist_status', { p_company_id: company.id }),
    ctx.supabase.rpc('get_finance_periods', { p_company_id: company.id, p_year: year }),
  ]);
  if (center.error?.code === '42501' && deadlines.error?.code === '42501') {
    fail(center.error.message || 'Brak uprawnień do finansów tej działalności.', 403);
  }
  return {
    companies,
    company: company.id,
    state: {
      companyId: company.id,
      loadedAt: new Date().toISOString(),
      center: center.error ? null : centerOf(center.data),
      centerError: center.error ? center.error.message || 'Nie udało się wczytać Centrum finansów.' : null,
      deadlines: deadlines.error ? null : deadlinesOf(deadlines.data),
      deadlinesError: deadlines.error ? deadlines.error.message || 'Nie udało się wczytać terminów.' : null,
      whitelist: whitelist.error ? null : whitelistOf(whitelist.data),
      periodsYear: year,
      periods: periods.error ? [] : periodsOf(periods.data),
      periodsError: periods.error ? periods.error.message || 'Nie udało się wczytać zamknięć miesięcy.' : null,
    },
  };
}

/** Zamknięcia miesięcy wskazanego roku (zmiana roku w „Zamknięciu miesięcy”). */
export async function financePeriods(ctx: NativeContext, companyId: string, yearParam: string | null) {
  const company = uuid(companyId, 'Nieprawidłowa działalność.');
  const year = periodYear(yearParam);
  const { data, error } = await ctx.supabase.rpc('get_finance_periods', { p_company_id: company, p_year: year });
  if (error) rpcFail(error, 'Nie udało się wczytać zamknięć miesięcy.');
  return { year, periods: periodsOf(data) };
}

// MARK: Zapisy (jak przyciski paneli CRM)

/** Stawka CIT do rezerwy w Centrum finansów (`save_finance_tax_settings`): 9, 19 albo brak. */
export async function saveTaxRate(ctx: NativeContext, body: Row) {
  const company = uuid(body.companyId, 'Nieprawidłowa działalność.');
  const rate = body.rate === null || body.rate === undefined || body.rate === '' ? null : Math.round(Number(body.rate));
  if (rate !== null && rate !== 9 && rate !== 19) fail('Stawka CIT: 9% albo 19%.');
  const { error } = await ctx.supabase.rpc('save_finance_tax_settings', { p_company_id: company, p_cit_rate: rate });
  if (error) rpcFail(error, 'Nie udało się zapisać stawki CIT.');
  return { message: 'Stawka CIT zapisana.' };
}

/** „Obowiązki działalności” — zapis zmienionych pozycji po kolei, jak `saveSettings` w CRM. */
export async function saveObligationSettings(ctx: NativeContext, body: Row) {
  const company = uuid(body.companyId, 'Nieprawidłowa działalność.');
  const settings = rows(body.settings).slice(0, 30);
  for (const setting of settings) {
    const dueDay = Number(setting.dueDay);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) fail(`${str(setting.form)}: dzień terminu musi być od 1 do 31.`);
    const offset = Number(setting.dueMonthOffset);
    const { error } = await ctx.supabase.rpc('save_finance_obligation_setting', {
      p_company_id: company,
      p_kind: str(setting.kind),
      p_form: str(setting.form),
      p_period_kind: str(setting.periodKind),
      p_enabled: setting.enabled === true,
      p_due_day: dueDay,
      p_due_month_offset: Number.isInteger(offset) ? offset : 1,
      p_label: strOrNull(setting.label),
    });
    if (error) rpcFail(error, 'Nie udało się zapisać ustawień.');
  }
  return { message: 'Obowiązki działalności zapisane.' };
}

/** Termin płatności faktury kosztowej bez terminu w KSeF (`set_ksef_invoice_payment_due`), opcjonalnie dla dostawcy. */
export async function setPaymentDue(ctx: NativeContext, body: Row) {
  const invoice = uuid(body.invoiceId, 'Nieprawidłowa faktura.');
  const date = day(body.date);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Nieprawidłowa data terminu.');
  const remember = body.remember === true;
  if (remember && !date) fail('Podaj termin, żeby zapamiętać go dla dostawcy.');
  const { data, error } = await ctx.supabase.rpc('set_ksef_invoice_payment_due', {
    p_invoice_id: invoice, p_due_date: date, p_remember: remember,
  });
  if (error) rpcFail(error, 'Nie udało się zapisać terminu.');
  const updated = num(data);
  return {
    message: remember && updated > 1
      ? `Termin zapisany i zapamiętany dla dostawcy — uzupełniono ${updated} faktury.`
      : date ? 'Termin płatności zapisany.' : 'Termin płatności usunięty.',
  };
}

/** Usunięcie domyślnego terminu dostawcy (`delete_finance_supplier_payment_term`). */
export async function deleteSupplierTerm(ctx: NativeContext, body: Row) {
  const company = uuid(body.companyId, 'Nieprawidłowa działalność.');
  const nip = str(body.nip).replace(/\D/g, '');
  if (!nip) fail('Brak NIP dostawcy.');
  const { error } = await ctx.supabase.rpc('delete_finance_supplier_payment_term', { p_company_id: company, p_seller_nip: nip });
  if (error) rpcFail(error, 'Nie udało się usunąć terminu dostawcy.');
  return { message: 'Domyślny termin dostawcy usunięty.' };
}

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

function monthArgs(body: Row) {
  const company = uuid(body.companyId, 'Nieprawidłowa działalność.');
  const year = Math.round(num(body.year));
  const month = Math.round(num(body.month));
  if (month < 1 || month > 12 || year < 2000 || year > 2100) fail('Nieprawidłowy miesiąc.');
  return { company, year, month, label: `${MONTHS[month - 1]} ${year}` };
}

/** „Zamknij miesiąc” (`lock_finance_period`) z opcjonalną notatką. */
export async function lockPeriod(ctx: NativeContext, body: Row) {
  const { company, year, month, label } = monthArgs(body);
  const note = str(body.note).trim().slice(0, 500);
  const { error } = await ctx.supabase.rpc('lock_finance_period', {
    p_company_id: company, p_year: year, p_month: month, p_note: note || null,
  });
  if (error) rpcFail(error, 'Nie udało się zamknąć miesiąca.');
  return { message: `Miesiąc ${label} zamknięty.` };
}

/** „Otwórz ponownie” (`unlock_finance_period`) — uzasadnienie co najmniej 10 znaków, zostaje w historii. */
export async function unlockPeriod(ctx: NativeContext, body: Row) {
  const { company, year, month, label } = monthArgs(body);
  const reason = str(body.reason).trim().slice(0, 500);
  if (reason.length < 10) fail('Podaj uzasadnienie ponownego otwarcia (co najmniej 10 znaków).');
  const { error } = await ctx.supabase.rpc('unlock_finance_period', {
    p_company_id: company, p_year: year, p_month: month, p_reason: reason,
  });
  if (error) rpcFail(error, 'Nie udało się otworzyć miesiąca.');
  return { message: `Miesiąc ${label} otwarty ponownie.` };
}

/** „Sprawdź na białej liście” / „Sprawdź przelewy” — ta sama logika co w CRM; odpowiedź jak trasa CRM. */
export async function checkWhitelist(ctx: NativeContext, body: Row) {
  const request = parseVatWhitelistRequest(body);
  if (!request) fail('Brak działalności lub rodzaju sprawdzenia.');
  const result = await runVatWhitelistCheck(ctx.supabase, ctx.employee.id, request);
  if (result.status >= 400) fail(str(result.body.error) || 'Nie udało się sprawdzić białej listy.', result.status);
  return result.body;
}

/** „Pobierz UPO” w Centrum finansów — brakujące UPO działalności (do 10 na kliknięcie), jak w CRM. */
export async function fetchMissingUpo(ctx: NativeContext, body: Row) {
  const company = uuid(body.companyId, 'Nieprawidłowa działalność.');
  const result = await handleKsefUpoRequest(ctx.supabase, { companyId: company, missing: true });
  if (result.status >= 400 || result.body.success !== true) fail(str(result.body.error) || 'Nie udało się pobrać UPO z KSeF.', result.status >= 400 ? result.status : 400);
  return result.body;
}

// MARK: Przypomnienie o płatności (monit)

const dateText = (value: string) => {
  const [year, month, date] = value.slice(0, 10).split('-');
  return year && month && date ? `${date}.${month}.${year}` : value;
};
const amountText = (value: number, currency: string) =>
  `${value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${!currency || currency === 'PLN' ? 'zł' : currency}`;

/** Pozostało do zapłaty jak `private.local_invoice_outstanding` (faktura końcowa — reszta z rozliczenia). */
function outstandingOf(invoice: Row) {
  const remaining = invoice.invoice_type === 'final' ? object(invoice.settlement_summary).remainingGross : undefined;
  const base = remaining !== undefined && remaining !== null && remaining !== '' ? num(remaining) : num(invoice.total_gross);
  return Math.max(Math.round((base - num(invoice.paid_amount)) * 100) / 100, 0);
}

/** Treść jak `defaultEmailText(invoiceNumber, reminder)` w CRM. */
function reminderText(invoice: Row) {
  const number = str(invoice.invoice_number);
  const due = day(invoice.payment_due_date) || '';
  const today = warsawToday();
  const dueText = due < today ? `minął ${dateText(due)}` : due === today ? `upływa dziś (${dateText(due)})` : `upływa ${dateText(due)}`;
  const issued = invoice.issue_date ? ` z dnia ${dateText(str(invoice.issue_date))}` : '';
  return `Dzień dobry,\n\nUprzejmie przypominam o płatności za fakturę ${number}${issued}. Termin płatności ${dueText}, do zapłaty pozostaje ${amountText(outstandingOf(invoice), str(invoice.currency_code) || 'PLN')}.\n\n`
    + 'Jeśli płatność została już zrealizowana, proszę potraktować tę wiadomość jako nieaktualną. Fakturę przesyłam ponownie w załączniku.\n\n'
    + 'W razie pytań proszę o kontakt.';
}

/** Treść „Wyślij email” z karty faktury (`defaultEmailText(invoiceNumber)` w CRM). */
const invoiceEmailText = (invoice: Row) =>
  `Dzień dobry,\n\nW załączeniu przesyłam fakturę ${str(invoice.invoice_number)}.\n\nW razie pytań proszę o kontakt.`;

type EmailMode = 'reminder' | 'invoice';
const emailMode = (value: unknown): EmailMode => (str(value) === 'invoice' ? 'invoice' : 'reminder');

/**
 * Faktura do wysyłki e-mailem. Monit: widoczna (RLS), wystawiona, z terminem, „Wystawianie faktur” działalności.
 * „Wyślij email” z karty: widoczna i nieanulowana (jak przycisk w CRM) — uprawnienia skrzynki i faktury sprawdza funkcja poczty.
 */
async function remindableInvoice(ctx: NativeContext, invoiceId: unknown, mode: EmailMode = 'reminder') {
  const id = uuid(invoiceId, 'Nieprawidłowa faktura.');
  const { data, error } = await ctx.supabase.from('invoices')
    .select('id, invoice_number, my_company_id, event_id, organization_id, buyer_contact_id, buyer_email, buyer_name, issue_date, payment_due_date, total_gross, paid_amount, invoice_type, settlement_summary, currency_code, pdf_url, status, is_proforma')
    .eq('id', id).maybeSingle();
  if (error || !data) fail('Nie znaleziono faktury.', 404);
  const invoice = data as Row;
  if (mode === 'invoice') {
    if (invoice.status === 'cancelled') fail('Anulowanej faktury nie wysyła się do nabywcy.');
  } else {
    if (invoice.is_proforma === true || invoice.invoice_type === 'proforma' || !['issued', 'sent', 'overdue'].includes(str(invoice.status))) {
      fail('Przypomnienie wysyła się tylko do wystawionej faktury.');
    }
    if (!invoice.payment_due_date) fail('Faktura nie ma terminu płatności.');
  }
  let companyId = strOrNull(invoice.my_company_id);
  if (!companyId && invoice.event_id) {
    const { data: event } = await ctx.supabase.from('events').select('my_company_id').eq('id', invoice.event_id).maybeSingle();
    companyId = strOrNull((event as Row | null)?.my_company_id);
  }
  if (mode === 'reminder') {
    const access = await loadInvoiceFinanceAccess(ctx.supabase);
    if (!canFinanceCompany(access, companyId, 'invoices_issue')) fail('Brak uprawnień do monitów tej działalności.', 403);
  }
  return { invoice, companyId };
}

type Recipient = { contactId: string | null; email: string; name: string; position: string | null; preferred: boolean };

/** Adresaci jak w CRM: osoby organizacji nabywcy (płatnicy wydarzenia i główna osoba wyżej), adres organizacji, adres z faktury. */
async function reminderRecipients(ctx: NativeContext, invoice: Row) {
  const buyerEmail = str(invoice.buyer_email).trim();
  const buyerName = str(invoice.buyer_name);
  const organizationId = strOrNull(invoice.organization_id);
  if (!organizationId) {
    return {
      organizationName: buyerName,
      options: buyerEmail ? [{ contactId: strOrNull(invoice.buyer_contact_id), email: buyerEmail, name: buyerName || buyerEmail, position: null, preferred: true }] : [],
    };
  }
  const [organizationResult, contactsResult, billingResult] = await Promise.all([
    ctx.supabase.from('organizations').select('id,name,alias,email').eq('id', organizationId).maybeSingle(),
    ctx.supabase.from('contact_organizations')
      .select('contact_id, position, is_primary, contact:contacts(id,full_name,first_name,last_name,email)')
      .eq('organization_id', organizationId).eq('is_current', true).order('is_primary', { ascending: false }),
    invoice.event_id
      ? ctx.supabase.from('event_billing_contacts').select('contact_id,is_primary')
        .eq('event_id', invoice.event_id).eq('organization_id', organizationId).order('is_primary', { ascending: false })
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  const organization = organizationResult.data as Row | null;
  const preferredIds = new Set(rows(billingResult.data).map((row) => str(row.contact_id)));
  const people = rows(contactsResult.data)
    .map((relation): (Recipient & { primary: boolean }) | null => {
      const contact = object(Array.isArray(relation.contact) ? relation.contact[0] : relation.contact);
      if (!contact.email) return null;
      return {
        contactId: str(contact.id),
        email: str(contact.email).trim(),
        name: str(contact.full_name) || `${str(contact.first_name)} ${str(contact.last_name)}`.trim() || str(contact.email),
        position: strOrNull(relation.position),
        preferred: preferredIds.has(str(contact.id)),
        primary: relation.is_primary === true,
      };
    })
    .filter((item): item is Recipient & { primary: boolean } => item !== null)
    .sort((left, right) => {
      if (left.preferred !== right.preferred) return left.preferred ? -1 : 1;
      if (left.primary !== right.primary) return left.primary ? -1 : 1;
      return left.name.localeCompare(right.name, 'pl');
    });
  const options: Recipient[] = people.map(({ primary: _primary, ...option }) => option);
  if (organization?.email) {
    options.push({
      contactId: null, email: str(organization.email).trim(), name: str(organization.alias) || str(organization.name),
      position: 'Ogólny adres organizacji', preferred: options.length === 0,
    });
  }
  if (buyerEmail && !options.some((option) => option.email === buyerEmail)) {
    options.push({
      contactId: strOrNull(invoice.buyer_contact_id), email: buyerEmail, name: buyerName || buyerEmail,
      position: 'Adres zapisany na fakturze', preferred: options.length === 0,
    });
  }
  return {
    organizationName: str(organization?.alias) || str(organization?.name) || buyerName,
    options: options.filter((option, index, all) =>
      all.findIndex((candidate) => candidate.email.toLowerCase() === option.email.toLowerCase()) === index),
  };
}

/** Okno „Wyślij przypomnienie” / „Wyślij email”: skrzynki, adresaci, temat i treść jak w CRM, stan PDF. */
export async function reminderSetup(ctx: NativeContext, invoiceId: string, modeParam?: unknown) {
  const mode = emailMode(modeParam);
  const { invoice } = await remindableInvoice(ctx, invoiceId, mode);
  const [accounts, recipients] = await Promise.all([sendingAccounts(ctx), reminderRecipients(ctx, invoice)]);
  const number = str(invoice.invoice_number);
  const suggested = recipients.options[0] ?? null;
  return {
    invoiceId: str(invoice.id),
    number,
    accounts: accounts.map((account) => ({
      id: account.id,
      label: `${account.from_name ? `${account.from_name} — ` : ''}${account.email_address}${account.account_type === 'shared' ? ' (wspólna)' : ''}`,
    })),
    recipients: recipients.options,
    organizationName: recipients.organizationName,
    to: suggested?.email || str(invoice.buyer_email),
    recipientName: suggested?.name || str(invoice.buyer_name),
    subject: mode === 'invoice' ? `Faktura ${number}` : `Przypomnienie o płatności — faktura ${number}`,
    text: mode === 'invoice' ? invoiceEmailText(invoice) : reminderText(invoice),
    mode,
    dueDate: day(invoice.payment_due_date),
    outstanding: outstandingOf(invoice),
    currency: str(invoice.currency_code) || 'PLN',
    pdfStored: Boolean(invoice.pdf_url),
  };
}

async function reminderAccount(ctx: NativeContext, accountId: unknown) {
  const accounts = await sendingAccounts(ctx);
  const account = accounts.find((item) => item.id === str(accountId));
  if (!account) fail('Wybierz skrzynkę pracownika, z której ma zostać wysłana faktura');
  return account;
}

/** Treść jak `buildUnifiedEmailContent` z celem „invoice”: szablon i stopka firmy faktury dla skrzynki nadawczej. */
async function composeReminder(ctx: NativeContext, accountId: string, companyId: string | null, subject: string, text: string, recipientName: string) {
  const signature = await buildCompanySignatureHtml({ client: ctx.supabase, employeeId: ctx.employee.id, emailAccountId: accountId, companyId } as any);
  const result = await buildCompanyEmailBody({
    client: ctx.supabase,
    employeeId: ctx.employee.id,
    emailAccountId: accountId,
    companyId,
    content: plainTextToEmailHtml(text),
    contentIsHtml: true,
    subject,
    recipientName,
    signatureHtml: signature.html,
    purpose: 'invoice',
  } as any);
  return { html: String(result.html || ''), signatureHtml: String((result as Row).signatureHtml || signature.html || '') };
}

export async function reminderPreview(ctx: NativeContext, body: Row) {
  const { companyId } = await remindableInvoice(ctx, body.invoiceId, emailMode(body.mode));
  const account = await reminderAccount(ctx, body.accountId);
  const email = await composeReminder(ctx, account.id, companyId, str(body.subject), str(body.text), str(body.recipientName));
  return { html: emailPreviewDocument(email.html) };
}

/**
 * PDF faktury do załącznika jak w CRM: zapisany PDF (pliki), a bez niego — „Generuj PDF” (wydruk z danych faktury, zapis
 * w magazynie i dokumentach wydarzenia, jak trasa `/bridge/invoices/invoice-pdf`, z której korzysta okno wysyłki CRM).
 */
async function invoicePdf(ctx: NativeContext, invoice: Row): Promise<{ attachment: Row | null; warning: string | null }> {
  const filename = `Faktura_${str(invoice.invoice_number)}.pdf`;
  try {
    if (invoice.pdf_url) {
      const { data, error } = await ctx.supabase.storage.from('event-files').download(str(invoice.pdf_url));
      if (error || !data) throw new Error('Nie udalo sie pobrac PDF ze storage');
      return { attachment: { filename, content: Buffer.from(await data.arrayBuffer()).toString('base64'), contentType: 'application/pdf' }, warning: null };
    }
    const { data: canManage, error: permissionError } = await ctx.supabase.rpc('can_manage_invoice', { p_invoice_id: invoice.id });
    if (permissionError || !canManage) throw new Error('Nie masz uprawnień do generowania faktur.');
    const stored = await generateStoredInvoicePdf(adminClient(), { invoiceId: str(invoice.id), fileName: filename, createdBy: ctx.employee.id });
    return { attachment: { filename, content: stored.base64, contentType: 'application/pdf' }, warning: null };
  } catch (error) {
    return { attachment: null, warning: `Nie udalo sie przygotowac PDF: ${error instanceof Error ? error.message : 'Nieznany błąd'}. Wysłano bez załącznika.` };
  }
}

const adminClient = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

/**
 * „Wyślij przypomnienie” / „Zaplanuj” — `send-invoice-email` z PDF faktury (bez PDF — wysyłka bez załącznika i ostrzeżenie,
 * jak w CRM), potem wpis w historii monitów. Wymaga tokenu pracownika (funkcja poczty jak w przeglądarce).
 */
export async function sendReminder(ctx: NativeContext, accessToken: string, body: Row) {
  const mode = emailMode(body.mode);
  const { invoice, companyId } = await remindableInvoice(ctx, body.invoiceId, mode);
  const to = str(body.to).trim();
  const subject = str(body.subject).trim();
  const text = str(body.text);
  if (!to) fail('Wprowadź adres email odbiorcy');
  if (!subject) fail('Wprowadź temat wiadomości');
  if (!text.trim()) fail('Wprowadź treść wiadomości');
  const account = await reminderAccount(ctx, body.accountId);
  let scheduledAt: string | null = null;
  if (body.scheduledAt) {
    const date = new Date(str(body.scheduledAt));
    if (Number.isNaN(date.getTime())) fail('Podaj prawidłową datę i godzinę wysyłki');
    if (date.getTime() < Date.now() + 30_000) fail('Termin wysyłki musi przypadać w przyszłości');
    scheduledAt = date.toISOString();
  }
  const recipientName = str(body.recipientName);
  const pdf = await invoicePdf(ctx, invoice);
  const email = await composeReminder(ctx, account.id, companyId, subject, text, recipientName);
  const result = await dispatchCrmEmail({
    accessToken,
    functionName: 'send-invoice-email',
    scheduledAt,
    metadata: { entityType: 'invoice', entityId: str(invoice.id), actionUrl: `/crm/invoices/${str(invoice.id)}` },
    payload: {
      invoiceId: str(invoice.id),
      emailAccountId: account.id,
      to,
      cc: str(body.cc),
      bcc: str(body.bcc),
      subject,
      message: text,
      messageHtml: email.html,
      signatureHtml: email.signatureHtml,
      attachments: pdf.attachment ? [pdf.attachment] : [],
      recipientName,
    },
  });
  const scheduledFor = result.scheduled && result.scheduledAt ? String(result.scheduledAt) : null;
  if (mode === 'invoice') {
    return {
      scheduled: Boolean(result.scheduled),
      scheduledAt: scheduledFor,
      message: scheduledFor ? 'Faktura została zaplanowana.' : 'Faktura wysłana przez email z załącznikiem PDF',
      warnings: [pdf.warning, result.warning ? String(result.warning) : null].filter((item): item is string => Boolean(item)),
    };
  }
  // Historia monitów (sekcja „Terminy”): adresat, data i kwota pozostała do zapłaty w chwili wysyłki.
  const { error: logError } = await ctx.supabase.rpc('record_invoice_payment_reminder', {
    p_invoice_id: str(invoice.id), p_recipient: to, p_scheduled_at: scheduledFor,
  });
  if (logError) console.error('[native-finance] reminder log', logError);
  const warnings = [
    pdf.warning,
    result.warning ? String(result.warning) : null,
    logError ? 'Przypomnienie wysłane, ale nie zapisano go w historii monitów. Nie wysyłaj ponownie.' : null,
  ].filter((item): item is string => Boolean(item));
  return {
    scheduled: Boolean(result.scheduled),
    scheduledAt: scheduledFor,
    message: scheduledFor ? 'Przypomnienie zostało zaplanowane.' : 'Przypomnienie o płatności wysłane z fakturą w załączniku',
    warnings,
  };
}

// MARK: Karta faktury — PDF i UPO

/** Faktura widoczna dla pracownika (RLS) — karta faktury. */
async function visibleInvoice(ctx: NativeContext, idParam: unknown, columns: string) {
  const id = uuid(idParam, 'Nieprawidłowa faktura.');
  const { data, error } = await ctx.supabase.from('invoices').select(columns).eq('id', id).maybeSingle();
  if (error || !data) fail('Nie znaleziono faktury albo nie masz do niej dostępu.', 404);
  return data as unknown as Row;
}

/**
 * „Generuj PDF” / „Regeneruj PDF” z karty faktury (jak `handleGeneratePDF` + trasa `/bridge/invoices/invoice-pdf`):
 * odbiorca KSeF zapisany na fakturze musi być czytelny, `can_manage_invoice`, wydruk z danych faktury zapisany w magazynie
 * i w folderze „Faktury” wydarzenia; poprzedni plik jest usuwany.
 */
export async function invoicePdfGenerate(ctx: NativeContext, body: Row) {
  const invoice = await visibleInvoice(ctx, body.id,
    'id, invoice_number, invoice_type, ksef_recipient_snapshot, correction_kind, correction_party_data_before, pdf_url');
  try {
    getInvoiceKsefRecipient(invoice as any);
    getInvoicePartyDataCorrection(invoice as any);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Nie można odczytać danych odbiorcy zapisanych na fakturze.');
  }
  const { data: canManage, error: permissionError } = await ctx.supabase.rpc('can_manage_invoice', { p_invoice_id: invoice.id });
  if (permissionError || !canManage) fail('Nie masz uprawnień do generowania faktur.', 403);
  const stored = await generateStoredInvoicePdf(adminClient(), {
    invoiceId: str(invoice.id), fileName: `Faktura_${str(invoice.invoice_number)}.pdf`, createdBy: ctx.employee.id,
  });
  return {
    ok: true,
    regenerated: Boolean(invoice.pdf_url),
    storagePath: stored.storagePath,
    message: stored.storagePath ? 'PDF wygenerowany i zapisany' : 'PDF wygenerowany',
  };
}

/** „Pobierz PDF” / „Podgląd” zapisanego PDF (magazyn `event-files`, dostęp jak w przeglądarce). */
export async function invoicePdfFile(ctx: NativeContext, idParam: unknown) {
  const invoice = await visibleInvoice(ctx, idParam, 'id, invoice_number, pdf_url');
  const path = str(invoice.pdf_url);
  if (!path) fail('Najpierw wygeneruj PDF');
  const { data, error } = await ctx.supabase.storage.from('event-files').download(path);
  if (error || !data) fail('Nie mozna pobrac pliku. Wygeneruj PDF ponownie.');
  return {
    kind: 'file' as const,
    name: path.split('/').pop() || `Faktura_${str(invoice.invoice_number)}.pdf`,
    mime: 'application/pdf',
    data: Buffer.from(await data.arrayBuffer()).toString('base64'),
  };
}

/** „Pobierz UPO (XML)” — zapisane UPO albo pobrane teraz z KSeF (ta sama logika co trasa CRM `/bridge/ksef/invoices/upo`). */
export async function invoiceUpo(ctx: NativeContext, body: Row) {
  const id = uuid(body.id, 'Nieprawidłowa faktura.');
  const result = await handleKsefUpoRequest(ctx.supabase, { invoiceId: id });
  const reply = result.body as Row;
  if (result.status >= 400 || reply.success !== true || typeof reply.xml !== 'string') {
    fail(str(reply.error) || 'Nie udało się pobrać UPO z KSeF.', result.status >= 400 ? result.status : 400);
  }
  return { name: str(reply.fileName) || 'UPO.xml', xml: String(reply.xml) };
}
