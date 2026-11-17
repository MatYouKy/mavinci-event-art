import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { withKsefAccessToken, type KsefCredentialsRow } from './accessToken';
import { downloadKsefInvoiceUpo, findKsefSessionForInvoice, saveKsefUpoRecord } from './upo';
import { getErrorMessage, KSEF_LOG_PREFIX } from './logger';

/**
 * UPO faktur wysłanych do KSeF — wspólne dla CRM (`/bridge/ksef/invoices/upo`, sesja przeglądarki) i aplikacji na Maca
 * (`/bridge/native/v1/finance`, token pracownika). `userClient` ma uprawnienia pracownika (reguły wierszy faktur,
 * finance_company_visible); KSeF i zapis UPO — klient z kluczem serwisowym.
 *  { invoiceId } — UPO jednej faktury (zapisane albo pobrane teraz z KSeF); odczyt: kto widzi fakturę.
 *  { companyId, missing: true } — pobranie brakujących UPO działalności (do 10 na raz); „Podgląd finansów”.
 */

type InvoiceRow = {
  id: string;
  my_company_id: string | null;
  invoice_number: string | null;
  ksef_reference_number: string | null;
  ksef_status: string | null;
  ksef_sent_at: string | null;
};

export type KsefUpoResult = { status: number; body: Record<string, unknown> };

const BATCH_LIMIT = 10;

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const fileNameFor = (invoice: InvoiceRow) =>
  `UPO_${(invoice.invoice_number || invoice.ksef_reference_number || invoice.id).replace(/[^a-zA-Z0-9._-]+/g, '_')}.xml`;

async function activeCredentials(supabase: SupabaseClient<any>, companyId: string): Promise<KsefCredentialsRow | null> {
  const { data } = await (supabase.from as any)('ksef_credentials')
    .select('id, nip, token, is_test_environment, access_token, access_token_valid_until')
    .eq('my_company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();
  return (data as KsefCredentialsRow | null) ?? null;
}

/** Pobiera i zapisuje UPO faktury; zwraca XML albo komunikat, dlaczego się nie udało. */
async function fetchAndStoreUpo(
  supabase: SupabaseClient<any>,
  credentials: KsefCredentialsRow,
  invoice: InvoiceRow,
  knownSession: string | null,
): Promise<{ xml: string; hash: string | null } | { error: string }> {
  const ksefNumber = invoice.ksef_reference_number!;
  const isTest = credentials.is_test_environment ?? false;
  return await withKsefAccessToken(supabase, credentials, { action: 'upo', invoiceId: invoice.id }, async (accessToken) => {
    let sessionReference = knownSession;
    if (!sessionReference) {
      const acceptedAt = invoice.ksef_sent_at ? new Date(invoice.ksef_sent_at) : null;
      if (!acceptedAt || Number.isNaN(acceptedAt.getTime())) {
        return { error: 'Brak daty przyjęcia faktury przez KSeF — nie da się znaleźć sesji wysyłki.' };
      }
      sessionReference = await findKsefSessionForInvoice(ksefNumber, acceptedAt, accessToken, isTest);
      if (!sessionReference) {
        await saveKsefUpoRecord(supabase, {
          invoiceId: invoice.id, companyId: invoice.my_company_id, ksefNumber,
          lastError: 'Nie znaleziono sesji KSeF z tą fakturą (np. wysłana innym programem).',
        });
        return { error: 'Nie znaleziono sesji KSeF, w której wysłano tę fakturę — mogła być wysłana innym programem.' };
      }
    }
    const upo = await downloadKsefInvoiceUpo(sessionReference, ksefNumber, accessToken, isTest);
    if (!upo) {
      await saveKsefUpoRecord(supabase, {
        invoiceId: invoice.id, companyId: invoice.my_company_id, ksefNumber, sessionReference,
        lastError: 'KSeF nie udostępnił jeszcze UPO.',
      });
      return { error: 'KSeF nie udostępnił jeszcze UPO tej faktury — spróbuj za kilka minut.' };
    }
    await saveKsefUpoRecord(supabase, {
      invoiceId: invoice.id, companyId: invoice.my_company_id, ksefNumber, sessionReference, upo,
    });
    return upo;
  });
}

/** Wywołanie po sprawdzeniu sesji pracownika (CRM — ciasteczka, Mac — token). */
export async function handleKsefUpoRequest(userClient: SupabaseClient<any>, body: unknown): Promise<KsefUpoResult> {
  const value = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const invoiceId = typeof value.invoiceId === 'string' ? value.invoiceId.trim() : '';
  const companyId = typeof value.companyId === 'string' ? value.companyId.trim() : '';
  const supabase = admin();

  try {
    if (invoiceId) {
      // Reguły wierszy faktur: UPO dostaje ten, kto widzi fakturę.
      const { data: visible, error: visibleError } = await userClient
        .from('invoices')
        .select('id, my_company_id, invoice_number, ksef_reference_number, ksef_status, ksef_sent_at')
        .eq('id', invoiceId)
        .maybeSingle();
      if (visibleError || !visible) {
        return { status: 404, body: { success: false, error: 'Nie znaleziono faktury.' } };
      }
      const invoice = visible as InvoiceRow;
      if (invoice.ksef_status !== 'accepted' || !invoice.ksef_reference_number || !invoice.my_company_id) {
        return { status: 400, body: { success: false, error: 'Faktura nie ma numeru KSeF — UPO powstaje po przyjęciu faktury.' } };
      }

      const { data: stored } = await (supabase.from as any)('ksef_invoice_upo')
        .select('upo_xml, upo_hash, session_reference, fetched_at')
        .eq('invoice_id', invoice.id)
        .maybeSingle();
      if (stored?.upo_xml) {
        return {
          status: 200,
          body: { success: true, xml: stored.upo_xml, hash: stored.upo_hash, fetchedAt: stored.fetched_at, fileName: fileNameFor(invoice) },
        };
      }

      const credentials = await activeCredentials(supabase, invoice.my_company_id);
      if (!credentials) {
        return { status: 400, body: { success: false, error: 'Brak aktywnej konfiguracji KSeF tej działalności.' } };
      }
      const result = await fetchAndStoreUpo(supabase, credentials, invoice, stored?.session_reference ?? null);
      if ('error' in result) {
        return { status: 409, body: { success: false, error: result.error } };
      }
      return {
        status: 200,
        body: { success: true, xml: result.xml, hash: result.hash, fetchedAt: new Date().toISOString(), fileName: fileNameFor(invoice) },
      };
    }

    if (companyId && value.missing === true) {
      const { data: visibleCompany, error: permissionError } = await userClient.rpc('finance_company_visible', {
        p_company_id: companyId,
      });
      if (permissionError || visibleCompany !== true) {
        return { status: 403, body: { success: false, error: 'Brak uprawnień do finansów tej działalności.' } };
      }
      const { data: rows, error: rowsError } = await (supabase.from as any)('invoices')
        .select('id, my_company_id, invoice_number, ksef_reference_number, ksef_status, ksef_sent_at, ksef_invoice_upo(upo_xml, session_reference, last_error, updated_at)')
        .eq('my_company_id', companyId)
        .eq('ksef_status', 'accepted')
        .not('ksef_reference_number', 'is', null)
        .order('ksef_sent_at', { ascending: false })
        .limit(1000);
      if (rowsError) throw new Error(rowsError.message);
      const upoOf = (row: { ksef_invoice_upo: any }) =>
        (Array.isArray(row.ksef_invoice_upo) ? row.ksef_invoice_upo[0] : row.ksef_invoice_upo) ?? null;
      const missing = ((rows || []) as Array<InvoiceRow & { ksef_invoice_upo: any }>).filter((row) => !upoOf(row)?.upo_xml);
      // Faktury, dla których niedawno nie znaleziono sesji (np. wysłane innym programem), nie zużywają limitu KSeF co próbę.
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const retryable = missing.filter((row) => {
        const upo = upoOf(row);
        return !(upo?.last_error?.startsWith('Nie znaleziono sesji') && Date.parse(upo.updated_at) > weekAgo);
      });
      if (retryable.length === 0) {
        return { status: 200, body: { success: true, fetched: 0, failed: 0, remaining: 0, unavailable: missing.length } };
      }
      const credentials = await activeCredentials(supabase, companyId);
      if (!credentials) {
        return { status: 400, body: { success: false, error: 'Brak aktywnej konfiguracji KSeF tej działalności.' } };
      }

      let fetched = 0;
      const failures: Array<{ invoice: string; error: string }> = [];
      for (const row of retryable.slice(0, BATCH_LIMIT)) {
        const upoRow = upoOf(row);
        try {
          const result = await fetchAndStoreUpo(supabase, credentials, row, upoRow?.session_reference ?? null);
          if ('error' in result) failures.push({ invoice: row.invoice_number || row.id, error: result.error });
          else fetched += 1;
        } catch (error) {
          const message = getErrorMessage(error);
          failures.push({ invoice: row.invoice_number || row.id, error: message });
          if (message.includes('KSeF API error 429')) break; // limit zapytań KSeF — reszta przy kolejnej próbie
        }
      }
      return {
        status: 200,
        body: {
          success: true,
          fetched,
          failed: failures.length,
          failures: failures.slice(0, 5),
          remaining: Math.max(retryable.length - fetched, 0),
          unavailable: missing.length - retryable.length,
        },
      };
    }

    return { status: 400, body: { success: false, error: 'Brak faktury lub działalności.' } };
  } catch (error) {
    console.error(`${KSEF_LOG_PREFIX} UPO route error`, { message: getErrorMessage(error) });
    return { status: 502, body: { success: false, error: getErrorMessage(error) } };
  }
}
