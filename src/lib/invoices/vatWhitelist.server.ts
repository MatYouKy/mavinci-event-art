import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Biała lista VAT (wykaz podatników VAT, API MF: https://wl-api.mf.gov.pl, limit 100 zapytań dziennie po 30 NIP-ów).
 *  mode 'payables' — faktury kosztowe KSeF do zapłaty: NIP i rachunek z faktury, na dziś (przed zleceniem przelewu);
 *  mode 'payments' — przelewy ponad 15 000 zł z ostatnich 90 dni: rachunek z wyciągu, na dzień przelewu.
 * Lista do sprawdzenia: get_vat_whitelist_status klientem pracownika (uprawnienia „Podgląd finansów”, jak w CRM); wynik
 * zapisuje serwer (klucz serwisowy) do finance_vat_whitelist_checks razem z identyfikatorem zapytania MF.
 * Wspólne dla CRM (`/bridge/finance/vat-whitelist`, sesja przeglądarki) i aplikacji na Maca (`/bridge/native/v1/finance`).
 */

const MF_API = 'https://wl-api.mf.gov.pl';
const MAX_QUERIES = 20; // na jedno kliknięcie — reszta dziennego limitu MF zostaje na kolejne sprawdzenia
const CHUNK = 30;

export type VatWhitelistMode = 'payables' | 'payments';

export type VatWhitelistRequest = {
  companyId: string;
  mode: VatWhitelistMode;
  /** Tylko wskazane faktury (payables) albo przelewy (payments); `null` — wszystkie z listy. */
  ids: Set<string> | null;
  /** Sprawdź ponownie także sprawdzone dziś (payables) albo już sprawdzone (payments). */
  force: boolean;
};

export type VatWhitelistResult = { status: number; body: Record<string, unknown> };

type PayableRow = {
  ksef_invoice_id: string;
  nip: string | null;
  account: string | null;
  fresh: boolean;
};

type PaymentRow = {
  bank_transaction_id: string;
  ksef_invoice_id: string | null;
  external_invoice_id: string | null;
  nip: string | null;
  account: string | null;
  transaction_date: string;
  verdict: string | null;
};

type CheckTarget = {
  nip: string;
  account: string | null;
  date: string;
  ksefInvoiceId: string | null;
  externalInvoiceId: string | null;
  bankTransactionId: string | null;
};

type MfSubject = {
  name?: string;
  nip?: string;
  statusVat?: string;
  accountNumbers?: string[];
  hasVirtualAccounts?: boolean;
};

class MfError extends Error {
  constructor(message: string, readonly limitReached = false) {
    super(message);
  }
}

async function mfGet(path: string) {
  let response: Response;
  try {
    response = await fetch(`${MF_API}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new MfError(`Brak połączenia z API białej listy MF: ${error instanceof Error ? error.message : String(error)}`);
  }
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const code = json?.code ? String(json.code) : '';
    const message = json?.message ? String(json.message) : `HTTP ${response.status}`;
    // Przekroczony dzienny limit zapytań MF (HTTP 429 albo kod błędu limitu).
    const limit = response.status === 429 || /limit/i.test(message);
    throw new MfError(`API białej listy MF: ${code ? `${code} ` : ''}${message}`, limit);
  }
  return json;
}

/** Suma kontrolna NIP — nieprawidłowy NIP w zapytaniu zbiorczym MF odrzuca całe zapytanie. */
function validNip(nip: string) {
  if (!/^[0-9]{10}$/.test(nip)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((total, weight, index) => total + weight * Number(nip[index]), 0) % 11;
  return sum !== 10 && sum === Number(nip[9]);
}

const todayWarsaw = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Odczyt wywołania (CRM i Mac): działalność, rodzaj, opcjonalne identyfikatory i ponowne sprawdzenie. */
export function parseVatWhitelistRequest(body: unknown): VatWhitelistRequest | null {
  const value = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const companyId = typeof value.companyId === 'string' ? value.companyId.trim() : '';
  const mode = value.mode === 'payments' ? 'payments' : value.mode === 'payables' ? 'payables' : null;
  if (!companyId || !mode) return null;
  const ids = Array.isArray(value.ids) ? new Set<string>(value.ids.filter((id): id is string => typeof id === 'string')) : null;
  return { companyId, mode, ids, force: value.force === true };
}

/**
 * Sprawdzenie w wykazie MF. `userClient` — klient z sesją pracownika (lista i uprawnienia jak w CRM), `employeeId` —
 * kto sprawdzał (do zapisu). Odpowiedź: checked, skipped, queries, summary (werdykty), remaining, error (przerwanie).
 */
export async function runVatWhitelistCheck(
  userClient: SupabaseClient<any>,
  employeeId: string | null,
  request: VatWhitelistRequest,
): Promise<VatWhitelistResult> {
  const { companyId, mode, ids: only, force } = request;
  const { data: status, error: statusError } = await userClient.rpc('get_vat_whitelist_status', { p_company_id: companyId });
  if (statusError || !status) {
    return { status: 403, body: { success: false, error: statusError?.message || 'Brak uprawnień do finansów tej działalności.' } };
  }

  const today = todayWarsaw();
  const targets: CheckTarget[] = [];
  let skipped = 0;
  if (mode === 'payables') {
    for (const row of (status.payables || []) as PayableRow[]) {
      if (only && !only.has(row.ksef_invoice_id)) continue;
      if (!row.nip || !validNip(row.nip) || (row.fresh && !force)) { skipped += 1; continue; }
      targets.push({ nip: row.nip, account: row.account, date: today, ksefInvoiceId: row.ksef_invoice_id, externalInvoiceId: null, bankTransactionId: null });
    }
  } else {
    for (const row of (status.payments || []) as PaymentRow[]) {
      if (only && !only.has(row.bank_transaction_id)) continue;
      if (!row.nip || !validNip(row.nip) || (row.verdict && row.verdict !== 'error' && !force)) { skipped += 1; continue; }
      targets.push({
        nip: row.nip, account: row.account, date: String(row.transaction_date).slice(0, 10),
        ksefInvoiceId: row.ksef_invoice_id, externalInvoiceId: row.external_invoice_id, bankTransactionId: row.bank_transaction_id,
      });
    }
  }
  if (targets.length === 0) {
    return { status: 200, body: { success: true, checked: 0, skipped, queries: 0, summary: {} } };
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // Grupy: ta sama data sprawdzenia, do 30 NIP-ów na zapytanie.
  const byDate = new Map<string, CheckTarget[]>();
  for (const target of targets) byDate.set(target.date, [...(byDate.get(target.date) || []), target]);

  let queries = 0;
  let stopped: string | null = null;
  const rows: Record<string, unknown>[] = [];
  const summary: Record<string, number> = {};

  outer: for (const [date, group] of Array.from(byDate.entries())) {
    const nips = Array.from(new Set(group.map((t) => t.nip)));
    for (let i = 0; i < nips.length; i += CHUNK) {
      if (queries >= MAX_QUERIES) { stopped = 'Osiągnięto limit zapytań na jedno sprawdzenie — kliknij ponownie, aby sprawdzić resztę.'; break outer; }
      const chunk = nips.slice(i, i + CHUNK);
      let entries: Array<{ identifier?: string; subjects?: MfSubject[]; error?: { code?: string; message?: string } }> = [];
      let requestId: string | null = null;
      let requestDateTime: string | null = null;
      try {
        const json = await mfGet(`/api/search/nips/${chunk.join(',')}?date=${date}`);
        queries += 1;
        entries = json?.result?.entries || [];
        requestId = json?.result?.requestId ?? null;
        requestDateTime = json?.result?.requestDateTime ?? null;
      } catch (error) {
        const mfError = error instanceof MfError ? error : new MfError(String(error));
        stopped = mfError.limitReached
          ? 'Wykorzystano dzienny limit zapytań API białej listy MF — sprawdź jutro albo ręcznie na podatki.gov.pl.'
          : mfError.message;
        break outer;
      }

      for (const target of group.filter((t) => chunk.includes(t.nip))) {
        const entry = entries.find((e) => e.identifier === target.nip);
        const subject = entry?.subjects?.find((s) => s.nip === target.nip) ?? entry?.subjects?.[0] ?? null;
        let accountAssigned: boolean | null = null;
        let method: 'search' | 'check' = 'search';
        let checkRequestId = requestId;
        let checkDateTime = requestDateTime;
        let message: string | null = entry?.error?.message ?? null;
        if (subject && target.account) {
          accountAssigned = (subject.accountNumbers || []).includes(target.account);
          // Rachunki wirtualne (maski) — wykaz ich nie wymienia; odpowiedź daje metoda check.
          if (!accountAssigned && subject.hasVirtualAccounts && queries < MAX_QUERIES) {
            try {
              const check = await mfGet(`/api/check/nip/${target.nip}/bank-account/${target.account}?date=${date}`);
              queries += 1;
              accountAssigned = check?.result?.accountAssigned === 'TAK';
              method = 'check';
              checkRequestId = check?.result?.requestId ?? checkRequestId;
              checkDateTime = check?.result?.requestDateTime ?? checkDateTime;
            } catch (error) {
              message = error instanceof Error ? error.message : String(error);
            }
          }
        }
        const verdict = !subject ? 'not_found' : !target.account ? 'no_account' : accountAssigned ? 'ok' : 'not_listed';
        summary[verdict] = (summary[verdict] || 0) + 1;
        rows.push({
          my_company_id: companyId,
          nip: target.nip,
          account: target.account,
          check_date: date,
          subject_name: subject?.name ?? null,
          status_vat: subject?.statusVat ?? null,
          account_assigned: subject && target.account ? accountAssigned : null,
          has_virtual_accounts: subject ? Boolean(subject.hasVirtualAccounts) : null,
          method,
          request_id: checkRequestId,
          request_datetime: checkDateTime,
          message,
          ksef_invoice_id: target.ksefInvoiceId,
          external_invoice_id: target.externalInvoiceId,
          bank_transaction_id: target.bankTransactionId,
          checked_by: employeeId,
        });
      }
    }
  }

  if (rows.length > 0) {
    const { error: insertError } = await admin.from('finance_vat_whitelist_checks').insert(rows);
    if (insertError) {
      return { status: 500, body: { success: false, error: `Sprawdzono, ale nie zapisano wyników: ${insertError.message}` } };
    }
  }

  return {
    status: 200,
    body: {
      success: rows.length > 0 || !stopped,
      checked: rows.length,
      skipped,
      queries,
      summary,
      remaining: targets.length - rows.length,
      error: stopped,
    },
  };
}
