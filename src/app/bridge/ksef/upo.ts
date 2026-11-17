import type { SupabaseClient } from '@supabase/supabase-js';
import { KSEF_API_BASE_URL_PROD, KSEF_API_BASE_URL_TEST, KSEF_TIMEOUT_MS } from './config';
import { ksefFetch } from './client';
import { KSEF_LOG_PREFIX } from './logger';

/**
 * UPO (Urzędowe Poświadczenie Odbioru) faktury wysłanej do KSeF (API 2.0):
 *  GET /sessions/{sesja}/invoices/ksef/{numer KSeF}/upo — XML UPO, nagłówek x-ms-meta-hash (SHA-256, Base64).
 * Faktury wysłane przed zapisem numeru sesji — sesję znajduje GET /sessions (okno wokół daty przyjęcia faktury)
 * i GET /sessions/{sesja}/invoices. Zapis: public.ksef_invoice_upo (klient z kluczem serwisowym).
 */

interface SessionsQueryResponse {
  continuationToken?: string | null;
  sessions?: Array<{ referenceNumber: string; dateCreated?: string; successfulInvoiceCount?: number }>;
}

interface SessionInvoicesResponse {
  continuationToken?: string | null;
  invoices?: Array<{ referenceNumber?: string; ksefNumber?: string | null }>;
}

export interface KsefUpoDocument {
  xml: string;
  hash: string | null;
}

const baseUrl = (isTestEnvironment: boolean) => (isTestEnvironment ? KSEF_API_BASE_URL_TEST : KSEF_API_BASE_URL_PROD);

/** UPO faktury; null — KSeF jeszcze go nie wygenerował albo nie ma go dla tej sesji. 401 — wyjątek (ponowne logowanie). */
export async function downloadKsefInvoiceUpo(
  sessionReference: string,
  ksefNumber: string,
  accessToken: string,
  isTestEnvironment: boolean,
): Promise<KsefUpoDocument | null> {
  const url = `${baseUrl(isTestEnvironment)}/sessions/${encodeURIComponent(sessionReference)}/invoices/ksef/${encodeURIComponent(ksefNumber)}/upo`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/xml', Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(KSEF_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (response.ok) {
    const xml = await response.text();
    if (!xml.trim()) return null;
    return { xml, hash: response.headers.get('x-ms-meta-hash') };
  }
  const body = await response.text().catch(() => '');
  if (response.status === 400 || response.status === 404) {
    console.warn(`${KSEF_LOG_PREFIX} UPO not available`, { status: response.status, body: body.slice(0, 500) });
    return null;
  }
  throw new Error(`KSeF API error ${response.status}: ${body.slice(0, 500)}`);
}

/** Sesja, w której wysłano fakturę o danym numerze KSeF (wyszukiwanie w oknie wokół daty przyjęcia). */
export async function findKsefSessionForInvoice(
  ksefNumber: string,
  acceptedAt: Date,
  accessToken: string,
  isTestEnvironment: boolean,
): Promise<string | null> {
  const from = new Date(acceptedAt.getTime() - 3 * 60 * 60 * 1000).toISOString();
  const to = new Date(acceptedAt.getTime() + 30 * 60 * 1000).toISOString();
  const headers = { Accept: 'application/json', Authorization: `Bearer ${accessToken}` };

  for (const sessionType of ['Online', 'Batch']) {
    let sessionsToken: string | null | undefined;
    do {
      const params = new URLSearchParams({ sessionType, dateCreatedFrom: from, dateCreatedTo: to, pageSize: '100' });
      const sessions = await ksefFetch<SessionsQueryResponse>(
        `/sessions?${params.toString()}`,
        { method: 'GET', headers: sessionsToken ? { ...headers, 'x-continuation-token': sessionsToken } : headers },
        { isTestEnvironment, context: { action: 'upo-find-session', ksefNumber } },
      );
      for (const session of sessions?.sessions ?? []) {
        if (session.successfulInvoiceCount === 0) continue;
        let invoicesToken: string | null | undefined;
        do {
          const invoices = await ksefFetch<SessionInvoicesResponse>(
            `/sessions/${encodeURIComponent(session.referenceNumber)}/invoices?pageSize=100`,
            { method: 'GET', headers: invoicesToken ? { ...headers, 'x-continuation-token': invoicesToken } : headers },
            { isTestEnvironment, context: { action: 'upo-session-invoices', ksefNumber } },
          );
          if (invoices?.invoices?.some((invoice) => invoice.ksefNumber === ksefNumber)) {
            return session.referenceNumber;
          }
          invoicesToken = invoices?.continuationToken;
        } while (invoicesToken);
      }
      sessionsToken = sessions?.continuationToken;
    } while (sessionsToken);
  }
  return null;
}

export async function saveKsefUpoRecord(
  supabase: SupabaseClient<any>,
  record: {
    invoiceId: string;
    companyId: string | null;
    ksefNumber?: string | null;
    sessionReference?: string | null;
    invoiceReference?: string | null;
    upo?: KsefUpoDocument | null;
    lastError?: string | null;
  },
) {
  const row: Record<string, unknown> = {
    invoice_id: record.invoiceId,
    my_company_id: record.companyId,
    updated_at: new Date().toISOString(),
  };
  if (record.ksefNumber !== undefined) row.ksef_number = record.ksefNumber;
  if (record.sessionReference !== undefined) row.session_reference = record.sessionReference;
  if (record.invoiceReference !== undefined) row.invoice_reference = record.invoiceReference;
  if (record.upo) {
    row.upo_xml = record.upo.xml;
    row.upo_hash = record.upo.hash;
    row.fetched_at = new Date().toISOString();
    row.last_error = null;
  } else if (record.lastError !== undefined) {
    row.last_error = record.lastError;
  }
  const { error } = await (supabase.from as any)('ksef_invoice_upo').upsert(row, { onConflict: 'invoice_id' });
  if (error) throw new Error(`Nie zapisano UPO: ${error.message}`);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Po wysyłce faktury: UPO pojawia się kilka sekund po zamknięciu sesji — kilka prób, błąd nie przerywa wysyłki. */
export async function fetchUpoAfterSend(params: {
  supabase: SupabaseClient<any>;
  invoiceId: string;
  companyId: string | null;
  sessionReference: string;
  ksefNumber: string;
  accessToken: string;
  isTestEnvironment: boolean;
}) {
  let lastError = 'UPO jeszcze niedostępne w KSeF.';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await wait(attempt === 0 ? 2000 : 4000);
    try {
      const upo = await downloadKsefInvoiceUpo(params.sessionReference, params.ksefNumber, params.accessToken, params.isTestEnvironment);
      if (upo) {
        await saveKsefUpoRecord(params.supabase, {
          invoiceId: params.invoiceId, companyId: params.companyId, ksefNumber: params.ksefNumber,
          sessionReference: params.sessionReference, upo,
        });
        return true;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  await saveKsefUpoRecord(params.supabase, {
    invoiceId: params.invoiceId, companyId: params.companyId, ksefNumber: params.ksefNumber,
    sessionReference: params.sessionReference, lastError,
  });
  return false;
}
