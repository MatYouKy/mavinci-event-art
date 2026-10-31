import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { loadInvoiceFinanceAccess } from '@/lib/invoices/financeAccess';
import { getInvoiceKsefRecipient, readInvoiceKsefRecipientSnapshot } from '@/lib/invoices/ksefRecipient';
import { getInvoicePartyDataCorrection } from '@/lib/invoices/partyDataCorrection';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import {
  getKSeFChallenge,
  authenticateWithKSeFToken,
  getKSeFAuthStatus,
  redeemKSeFAuthToken,
  getKSeFPublicKeyCertificates,
  openKSeFOnlineSession,
  sendKSeFInvoiceInSession,
  getKSeFSessionInvoices,
  closeKSeFOnlineSession,
} from '../../client';

import {
  createSymmetricKeyMaterial,
  encryptInvoiceXml,
  encryptKSeFTokenPayloadFromCertificate,
} from '../../crypto';

import type { KSeFFormCode } from '../../types';

import {
  prepareFA3Invoice,
  validatePreparedFA3Invoice,
  generateFA3XML,
} from '../../../../../lib/ksef/generateFA3XML';

const DEBUG_XML_ONLY =
  process.env.NODE_ENV !== 'production' && process.env.KSEF_DEBUG_XML_ONLY === 'true';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const FA3_FORM_CODE: KSeFFormCode = {
  systemCode: 'FA (3)',
  schemaVersion: '1-0E',
  value: 'FA',
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDb(supabase: SupabaseClient<any>) {
  return {
    invoices: () => (supabase.from as any)('invoices'),
    ksefCredentials: () => (supabase.from as any)('ksef_credentials'),
    ksefInvoices: () => (supabase.from as any)('ksef_invoices'),
    invoiceHistory: () => (supabase.from as any)('invoice_history'),
    employees: () => (supabase.from as any)('employees'),
  };
}

async function fetchInvoice(supabase: SupabaseClient<any>, invoiceId: string) {
  const db = getDb(supabase);
  return await db
    .invoices()
    .select('*, invoice_items(*), invoice_order_items(*)')
    .eq('id', invoiceId)
    .single();
}

async function fetchActiveCredentials(supabase: SupabaseClient<any>, myCompanyId: string) {
  const db = getDb(supabase);
  return await db
    .ksefCredentials()
    .select('*')
    .eq('my_company_id', myCompanyId)
    .eq('is_active', true)
    .maybeSingle();
}

async function checkExistingSyncedInvoice(supabase: SupabaseClient<any>, invoiceId: string) {
  const db = getDb(supabase);
  return await db
    .ksefInvoices()
    .select('ksef_reference_number')
    .eq('invoice_id', invoiceId)
    .eq('sync_status', 'synced')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

async function persistCredentialsUpdate(params: {
  supabase: SupabaseClient<any>;
  credentialsId: string;
  authReferenceNumber: string;
  accessToken: string;
  accessTokenValidUntil: string;
  refreshToken?: string | null;
  refreshTokenValidUntil?: string | null;
}) {
  const db = getDb(params.supabase);
  return await db
    .ksefCredentials()
    .update({
      access_token: params.accessToken,
      access_token_valid_until: params.accessTokenValidUntil,
      refresh_token: params.refreshToken ?? null,
      refresh_token_valid_until: params.refreshTokenValidUntil ?? null,
      last_auth_reference_number: params.authReferenceNumber,
      last_authenticated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.credentialsId);
}

async function reAuthenticateKSeF(params: {
  supabase: SupabaseClient<any>;
  credentials: any;
  invoiceId: string;
  myCompanyId: string;
}) {
  const { supabase, credentials, invoiceId, myCompanyId } = params;
  const isTestEnv = credentials.is_test_environment ?? false;

  const challengeResponse = await getKSeFChallenge(isTestEnv, {
    action: 'send-invoice-reauth',
    invoiceId,
    myCompanyId,
  });

  const publicKeyCertificates = await getKSeFPublicKeyCertificates(isTestEnv, {
    action: 'send-invoice-reauth',
    invoiceId,
    myCompanyId,
  });

  const tokenEncryptionCert = publicKeyCertificates.find((cert) =>
    cert.usage?.includes('KsefTokenEncryption'),
  );

  if (!tokenEncryptionCert?.certificate) {
    throw new Error('Nie znaleziono certyfikatu KsefTokenEncryption');
  }

  const plainToEncrypt = `${credentials.token}|${challengeResponse.timestampMs}`;

  const encryptedToken = encryptKSeFTokenPayloadFromCertificate(
    plainToEncrypt,
    tokenEncryptionCert.certificate,
  );

  const authResponse = await authenticateWithKSeFToken(
    {
      encryptedToken,
      challenge: challengeResponse.challenge,
      nip: credentials.nip,
    },
    isTestEnv,
    { action: 'send-invoice-reauth', invoiceId, myCompanyId },
  );

  if (!authResponse.authenticationToken?.token) {
    throw new Error('KSeF nie zwrócił authenticationToken');
  }

  await wait(1500);

  const authStatus = await getKSeFAuthStatus(
    authResponse.referenceNumber,
    authResponse.authenticationToken.token,
    isTestEnv,
    { action: 'send-invoice-reauth-status', invoiceId, myCompanyId },
  );

  if (authStatus.status?.code !== 200) {
    throw new Error(
      `KSeF auth status: ${authStatus.status?.code} - ${authStatus.status?.description}`,
    );
  }

  const redeemResponse = await redeemKSeFAuthToken(
    authResponse.authenticationToken.token,
    isTestEnv,
    { action: 'send-invoice-reauth-redeem', invoiceId, myCompanyId },
  );

  const { error: updateError } = await persistCredentialsUpdate({
    supabase,
    credentialsId: credentials.id,
    authReferenceNumber: authResponse.referenceNumber,
    accessToken: redeemResponse.accessToken.token,
    accessTokenValidUntil: redeemResponse.accessToken.validUntil,
    refreshToken: redeemResponse.refreshToken?.token ?? null,
    refreshTokenValidUntil: redeemResponse.refreshToken?.validUntil ?? null,
  });

  if (updateError) {
    throw new Error('Błąd podczas aktualizacji danych uwierzytelniających KSeF');
  }

  return {
    accessToken: redeemResponse.accessToken.token,
    accessTokenValidUntil: redeemResponse.accessToken.validUntil,
  };
}

async function enrichFinalInvoiceSettledInvoicesWithKsefNumbers(
  supabase: SupabaseClient<any>,
  invoice: any,
) {
  if (!Array.isArray(invoice.settled_invoices) || invoice.settled_invoices.length === 0) {
    return invoice;
  }

  const db = getDb(supabase);

  const settledIds = invoice.settled_invoices.map((inv: any) => inv.id).filter(Boolean);
  const settledNumbers = invoice.settled_invoices
    .map((inv: any) => inv.invoiceNumber ?? inv.invoice_number)
    .filter(Boolean);

  const [invoiceResult, ksefByIdResult, ksefByNumberResult] =
    await Promise.all([
      settledIds.length
        ? db
            .invoices()
            .select('id, invoice_number, ksef_reference_number, invoice_items(vat_code, vat_rate, value_net, vat_amount, value_gross)')
            .in('id', settledIds)
        : Promise.resolve({ data: [] }),
      settledIds.length
        ? db
            .ksefInvoices()
            .select('invoice_id, invoice_number, ksef_reference_number')
            .in('invoice_id', settledIds)
            .eq('sync_status', 'synced')
        : Promise.resolve({ data: [] }),
      settledNumbers.length
        ? db
            .ksefInvoices()
            .select('invoice_id, invoice_number, ksef_reference_number')
            .in('invoice_number', settledNumbers)
            .eq('my_company_id', invoice.my_company_id)
            .eq('sync_status', 'synced')
        : Promise.resolve({ data: [] }),
    ]);

  if ([invoiceResult, ksefByIdResult, ksefByNumberResult].some((result) => 'error' in result && result.error)) {
    throw new Error('Nie udało się odczytać rozliczanych zaliczek. Nie wysłano faktury końcowej do KSeF.');
  }
  const invoiceRows = invoiceResult.data;
  const ksefByIdRows = ksefByIdResult.data;
  const ksefByNumberRows = ksefByNumberResult.data;

  const ksefFromInvoicesById = new Map(
    (invoiceRows ?? []).map((row: any) => [row.id, row.ksef_reference_number]),
  );
  const uniqueReferenceMap = (rows: any[], key: 'invoice_id' | 'invoice_number') => {
    const grouped = new Map<string, Set<string>>();
    rows.forEach((row) => {
      if (!row?.[key] || !row?.ksef_reference_number) return;
      const references = grouped.get(row[key]) ?? new Set<string>();
      references.add(row.ksef_reference_number);
      grouped.set(row[key], references);
    });
    return new Map(
      Array.from(grouped.entries())
        .filter(([, references]) => references.size === 1)
        .map(([mapKey, references]) => [mapKey, Array.from(references)[0]]),
    );
  };
  const ksefFromKsefById = uniqueReferenceMap(ksefByIdRows ?? [], 'invoice_id');
  const ksefFromKsefByNumber = uniqueReferenceMap(ksefByNumberRows ?? [], 'invoice_number');
  const invoiceRowsById = new Map((invoiceRows ?? []).map((row: any) => [row.id, row]));

  const buildVatBreakdown = (rows: any[] = []) => {
    const grouped = new Map<string, { vatCode: string; net: number; vat: number; gross: number }>();
    rows.forEach((row) => {
      const vatCode = String(row.vat_code ?? row.vat_rate ?? '23');
      const current = grouped.get(vatCode) ?? { vatCode, net: 0, vat: 0, gross: 0 };
      current.net += Number(row.value_net ?? 0);
      current.vat += Number(row.vat_amount ?? 0);
      current.gross += Number(row.value_gross ?? 0);
      grouped.set(vatCode, current);
    });
    return Array.from(grouped.values()).map((entry) => ({
      ...entry,
      net: Number(entry.net.toFixed(2)),
      vat: Number(entry.vat.toFixed(2)),
      gross: Number(entry.gross.toFixed(2)),
    }));
  };

  return {
    ...invoice,
    settled_invoices: invoice.settled_invoices.map((inv: any) => {
      const invoiceNumber = inv.invoiceNumber ?? inv.invoice_number;
      const ksefReferenceNumber =
        inv.ksefReferenceNumber ??
        inv.ksef_reference_number ??
        ksefFromInvoicesById.get(inv.id) ??
        ksefFromKsefById.get(inv.id) ??
        ksefFromKsefByNumber.get(invoiceNumber) ??
        null;

      const sourceInvoice = invoiceRowsById.get(inv.id) as any;
      return {
        ...inv,
        invoiceNumber,
        ksefReferenceNumber,
        ksef_reference_number: ksefReferenceNumber,
        vatBreakdown: inv.vatBreakdown ?? buildVatBreakdown(sourceInvoice?.invoice_items),
      };
    }),
  };
}

async function prepareStoredInvoiceForKsef(supabase: SupabaseClient<any>, storedInvoice: any) {
  const invoice = { ...storedInvoice };
  const partyDataBefore = getInvoicePartyDataCorrection(invoice);
  if (partyDataBefore && !invoice.related_invoice_id) {
    throw new Error('Korekta danych wymaga powiązania z fakturą źródłową. Wysyłka została wstrzymana.');
  }
  const recipientSnapshot = readInvoiceKsefRecipientSnapshot(invoice.ksef_recipient_snapshot);
  if (!recipientSnapshot) {
    throw new Error('Brak zapisanego kontekstu odbiorcy faktury. Przygotuj dane odbiorcy przed wysłaniem do KSeF.');
  }
  // SQL NULL is a legacy document. New documents must agree with the explicit
  // choice made in the form; a saved recipient must never be silently omitted.
  if (invoice.invoice_recipient_mode != null) {
    const recipient = recipientSnapshot.recipient;
    switch (invoice.invoice_recipient_mode) {
      case 'same_as_buyer':
        if (recipient !== null) {
          throw new Error('Wybrano odbiorcę takiego samego jak nabywca, ale faktura zawiera oddzielnego odbiorcę. Sprawdź dane nabywcy i odbiorcy przed wysłaniem.');
        }
        break;
      case 'organization':
        if (!recipient || !invoice.service_recipient_organization_id ||
            recipient.organizationId !== invoice.service_recipient_organization_id) {
          throw new Error('Zapisany odbiorca nie odpowiada organizacji wybranej na fakturze. Sprawdź dane nabywcy i odbiorcy przed wysłaniem.');
        }
        break;
      case 'manual':
        if (!recipient || recipient.organizationId !== null) {
          throw new Error('Nie zapisano kompletu ręcznie wprowadzonych danych odbiorcy. Sprawdź odbiorcę przed wysłaniem do KSeF.');
        }
        break;
      default:
        throw new Error('Nieznany sposób wskazania odbiorcy faktury. Wybierz odbiorcę przed wysłaniem do KSeF.');
    }
  }
  if (invoice.is_proforma) throw new Error('Pro forma nie może być wysłana do KSeF.');
  const isFinal = invoice.invoice_type === 'final' || invoice.invoice_number?.startsWith('FKO/');
  if (isFinal && (!invoice.settlement_summary || !Array.isArray(invoice.settled_invoices) || !invoice.settled_invoices.length)) {
    throw new Error('Faktura końcowa wymaga podsumowania i listy rozliczanych zaliczek.');
  }
  if (invoice.invoice_type === 'corrective' && invoice.related_invoice_id) {
    const { data: related, error } = await getDb(supabase).invoices()
      .select(partyDataBefore
        ? 'invoice_type, is_proforma, my_company_id, seller_nip, currency_code, invoice_number, issue_date, ksef_reference_number, buyer_name, buyer_nip, buyer_street, buyer_postal_code, buyer_city, buyer_country, ksef_recipient_snapshot, total_gross, settlement_summary'
        : 'invoice_type, total_gross, settlement_summary')
      .eq('id', invoice.related_invoice_id).maybeSingle();
    if (error || !related) throw new Error('Nie udało się odczytać faktury korygowanej. Wysyłka została wstrzymana.');
    if (partyDataBefore) {
      const text = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
      const nip = (value: unknown) => text(value).replace(/^PL/i, '').replace(/[\s-]/g, '');
      const country = (value: unknown) => {
        const normalized = text(value).toUpperCase();
        return !normalized || ['POLSKA', 'POLAND'].includes(normalized) ? 'PL' : normalized;
      };
      if (related.is_proforma || related.invoice_type === 'corrective' ||
          related.my_company_id !== invoice.my_company_id || nip(related.seller_nip) !== nip(invoice.seller_nip) ||
          text(related.currency_code || 'PLN').toUpperCase() !== text(invoice.currency_code || 'PLN').toUpperCase()) {
        throw new Error('Korekta danych musi wskazywać fakturę tej samej firmy i waluty; nie można w ten sposób korygować pro formy ani innej korekty.');
      }
      if (text(invoice.corrected_invoice_number) !== text(related.invoice_number) ||
          String(invoice.corrected_invoice_issue_date || '').slice(0, 10) !== String(related.issue_date || '').slice(0, 10) ||
          (!!related.ksef_reference_number && (invoice.corrected_invoice_was_in_ksef !== true ||
            text(invoice.corrected_invoice_ksef_number) !== text(related.ksef_reference_number)))) {
        throw new Error('Odwołanie na korekcie danych nie odpowiada fakturze źródłowej. Sprawdź numer, datę i numer KSeF.');
      }
      const expectedBuyer = {
        name: text(related.buyer_name), nip: nip(related.buyer_nip), street: text(related.buyer_street),
        postalCode: text(related.buyer_postal_code), city: text(related.buyer_city), countryCode: country(related.buyer_country),
      };
      if (Object.entries(expectedBuyer).some(([key, value]) => text(partyDataBefore.buyer[key as keyof typeof expectedBuyer]) !== value) ||
          partyDataBefore.buyer.nip !== nip(invoice.buyer_nip)) {
        throw new Error('Dane nabywcy przed korektą nie odpowiadają zapisanej fakturze źródłowej lub zmieniono NIP. Nie można wysłać tej korekty danych.');
      }
      const sourceRecipient = readInvoiceKsefRecipientSnapshot(related.ksef_recipient_snapshot);
      if (!sourceRecipient) throw new Error('Faktura źródłowa nie ma zapisanego odbiorcy. Nie można bezpiecznie zweryfikować korekty danych.');
      const recipientFields = ['organizationId', 'name', 'nip', 'internalId', 'street', 'postalCode', 'city', 'countryCode', 'role'] as const;
      if ((sourceRecipient.recipient === null) !== (partyDataBefore.recipient === null) ||
          (sourceRecipient.recipient && partyDataBefore.recipient && recipientFields.some((key) =>
            text(sourceRecipient.recipient![key]) !== text(partyDataBefore.recipient![key])))) {
        throw new Error('Dane odbiorcy przed korektą nie odpowiadają zapisanej fakturze źródłowej. Wysyłka została wstrzymana.');
      }
    }
    invoice.corrected_invoice_type = related.invoice_type;
    invoice.corrected_amount_before = related.invoice_type === 'final'
      ? Number(related.settlement_summary?.remainingGross ?? related.total_gross ?? 0)
      : Number(related.total_gross ?? 0);
  }
  invoice.is_final_invoice = isFinal;
  const invoiceForXml = isFinal
    ? await enrichFinalInvoiceSettledInvoicesWithKsefNumbers(supabase, invoice)
    : invoice;
  const paymentDate = invoice.paid_date || invoice.payment_date || invoice.paid_at;
  return prepareFA3Invoice({
    ...invoiceForXml,
    payment_date: paymentDate ? String(paymentDate).split('T')[0] : null,
    paid_amount: invoice.payment_status === 'paid'
      ? Math.abs(Number(invoice.paid_amount ?? invoice.total_gross ?? 0))
      : Number(invoice.paid_amount ?? 0),
  }, null, getInvoiceKsefRecipient(invoice));
}

function requireMatchingSeller(credentials: any, sellerNip: string) {
  const credentialNip = String(credentials.nip ?? '').replace(/^PL/i, '').replace(/[\s-]/g, '');
  if (credentialNip !== sellerNip) {
    throw new Error('NIP aktywnej autoryzacji KSeF jest inny niż NIP sprzedawcy na fakturze. Sprawdź wybraną działalność i jej autoryzację.');
  }
}

export async function POST(request: NextRequest) {
  let body: any = {};
  try {
    const rawBody = await request.text();
    if (!rawBody.trim()) {
      return new Response(JSON.stringify({ error: 'Puste body requestu' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    body = JSON.parse(rawBody);
  } catch (err) {
    console.error('[KSeF SEND] Invalid JSON body', err);
    return new Response(JSON.stringify({ error: 'Nieprawidłowe body JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const invoiceId = body.invoiceId;
  if (!invoiceId) {
    return new Response(JSON.stringify({ error: 'Brak ID faktury' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userClient = createSupabaseServerClient(cookies());
  const { data: authData } = await userClient.auth.getUser();
  if (!authData.user) {
    return new Response(JSON.stringify({ error: 'Wymagane logowanie.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const financeAccess = await loadInvoiceFinanceAccess(userClient).catch(() => null);
  if (!financeAccess?.canIssueInvoices) {
    return new Response(JSON.stringify({ error: 'Nie masz uprawnień do wystawiania faktur.' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (financeAccess.scope === 'sales') {
    const { data: ownInvoice, error: ownError } = await userClient.from('invoices')
      .select('created_by').eq('id', invoiceId).maybeSingle();
    if (ownError || !ownInvoice || ![financeAccess.employeeId, financeAccess.authUserId].includes(ownInvoice.created_by)) {
      return new Response(JSON.stringify({ error: 'Możesz wysłać do KSeF tylko własną fakturę.' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  const { data: canManage, error: permissionError } = await userClient.rpc(
    'can_manage_invoice',
    { p_invoice_id: invoiceId },
  );
  if (permissionError || !canManage) {
    return new Response(
      JSON.stringify({ error: 'Nie masz uprawnień do wysyłania faktur do KSeF.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { data: actorByAuth } = await userClient
    .from('employees')
    .select('id')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();
  const { data: actorByEmail } = actorByAuth || !authData.user.email
    ? { data: null }
    : await userClient
        .from('employees')
        .select('id')
        .eq('email', authData.user.email)
        .maybeSingle();
  const actorEmployee = actorByAuth ?? actorByEmail;
  const actorEmployeeId = actorEmployee?.id ?? null;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let sessionId: string | undefined;
      let accessTokenForClose: string | undefined;
      let isTestEnvForClose = false;
      let currentStep = 'validate';
      let ksefSendClaimed = false;
      let invoiceMayHaveReachedKsef = false;
      let persistenceClient: SupabaseClient<any> | undefined;

      const emit = (data: any) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream closed
        }
      };

      const emitProgress = (step: string, status: string, extra?: Record<string, any>) => {
        emit({ type: 'progress', step, status, ...extra });
      };

      const emitResult = (result: any) => {
        emit({ type: 'result', ...result });
      };

      try {
        emitProgress('validate', 'active', { message: 'Pobieranie faktury z bazy' });

        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        persistenceClient = supabase;

        let { data: invoice, error: invoiceError } = await fetchInvoice(supabase, invoiceId);

        if (invoiceError || !invoice) {
          emitProgress('validate', 'error', { message: 'Nie znaleziono faktury' });
          emitResult({ success: false, error: 'Nie znaleziono faktury' });
          controller.close();
          return;
        }

        if (
          invoice.ksef_status === 'accepted' ||
          invoice.ksef_status === 'pending' ||
          invoice.ksef_reference_number
        ) {
          const message =
            invoice.ksef_status === 'pending'
              ? 'Faktura oczekuje na rozstrzygnięcie poprzedniej wysyłki do KSeF. Najpierw odśwież jej status.'
              : 'Faktura została już przyjęta przez KSeF.';
          emitProgress('validate', 'error', { message });
          emitResult({
            success: false,
            error: message,
            ksef_reference_number: invoice.ksef_reference_number || null,
          });
          controller.close();
          return;
        }

        const { data: alreadySynced, error: syncedCheckError } = await checkExistingSyncedInvoice(supabase, invoiceId);
        if (syncedCheckError) throw new Error('Nie udało się sprawdzić poprzedniej wysyłki faktury. Spróbuj ponownie po odświeżeniu statusu.');
        if (alreadySynced?.ksef_reference_number) {
          emitProgress('validate', 'error', { message: 'Faktura została już przyjęta przez KSeF' });
          emitResult({
            success: false,
            error: 'Faktura została już przyjęta przez KSeF',
            ksef_reference_number: alreadySynced.ksef_reference_number,
          });
          controller.close();
          return;
        }

        emitProgress('validate', 'active', { message: 'Sprawdzanie danych faktury' });

        const isFinalInvoice =
          invoice.invoice_type === 'final' || invoice.invoice_number?.startsWith('FKO/');

        if (invoice.is_proforma) {
          emitProgress('validate', 'error', { message: 'Faktury proforma nie mogą być wysłane do KSeF' });
          emitResult({ success: false, error: 'Faktury proforma nie mogą być wysłane do KSeF. Wystaw fakturę VAT.' });
          controller.close();
          return;
        }

        if (isFinalInvoice) {
          if (!invoice.settlement_summary) {
            emitProgress('validate', 'error', { message: 'Brak settlement_summary' });
            emitResult({ success: false, error: 'Faktura końcowa nie posiada settlement_summary.' });
            controller.close();
            return;
          }
          if (!Array.isArray(invoice.settled_invoices) || invoice.settled_invoices.length === 0) {
            emitProgress('validate', 'error', { message: 'Brak listy rozliczonych zaliczek' });
            emitResult({ success: false, error: 'Faktura końcowa nie posiada listy rozliczonych zaliczek.' });
            controller.close();
            return;
          }
        }

        // Freeze only this explicitly requested invoice, never backfill historical documents in bulk.
        const { error: snapshotError } = await userClient.rpc('ensure_invoice_ksef_recipient_snapshot', {
          p_invoice_id: invoiceId,
        });
        if (snapshotError) throw new Error(`Nie udało się przygotować danych odbiorcy: ${snapshotError.message}`);
        const refreshedInvoice = await fetchInvoice(supabase, invoiceId);
        if (refreshedInvoice.error || !refreshedInvoice.data) throw new Error('Nie udało się ponownie odczytać faktury po zapisaniu odbiorcy.');
        invoice = refreshedInvoice.data;
        let preparedInvoice = await prepareStoredInvoiceForKsef(supabase, invoice);
        const validation = validatePreparedFA3Invoice(preparedInvoice);

        if (!validation.valid) {
          emitProgress('validate', 'error', { message: 'Faktura nie przeszła walidacji' });
          emitResult({ success: false, error: 'Faktura nie przeszła walidacji przed wysyłką do KSeF', details: validation.errors });
          controller.close();
          return;
        }

        emitProgress('validate', 'completed');

        // XML generation
        currentStep = 'xml';
        emitProgress('xml', 'active', { message: 'Generowanie XML FA(3)' });

        let xmlContent = generateFA3XML(preparedInvoice);


        if (DEBUG_XML_ONLY) {        
          emitResult({
            success: true,
            xmlContent,
            preparedInvoice,
          });
          controller.close();
          return;
        }

        emitProgress('xml', 'completed');
        // Auth
        currentStep = 'auth';
        emitProgress('auth', 'active', { message: 'Sprawdzanie aktywnej autoryzacji KSeF' });

        const { data: credentials, error: credError } = await fetchActiveCredentials(
          supabase,
          invoice.my_company_id,
        );

        if (credError || !credentials) {
          emitProgress('auth', 'error', { message: 'Brak aktywnych danych uwierzytelniających' });
          emitResult({ success: false, error: 'Brak aktywnych danych uwierzytelniających KSeF dla tej firmy' });
          controller.close();
          return;
        }

        requireMatchingSeller(credentials, preparedInvoice.seller.nip);

        const isTestEnv = credentials.is_test_environment ?? false;
        let accessToken = credentials.access_token;

        if (!accessToken) {
          emitProgress('auth', 'error', { message: 'Sesja KSeF nie jest aktywna' });
          emitResult({ success: false, error: 'Sesja KSeF nie jest aktywna. Najpierw kliknij "Uwierzytelnij" w panelu KSeF.' });
          controller.close();
          return;
        }

        emitProgress('auth', 'completed');

        // Session
        currentStep = 'session';
        emitProgress('session', 'active', { message: 'Pobieranie certyfikatów szyfrowania' });

        const publicKeyCertificates = await getKSeFPublicKeyCertificates(isTestEnv, {
          action: 'session-encryption',
          invoiceId,
          myCompanyId: invoice.my_company_id,
        });

        const symmetricKeyCert = publicKeyCertificates.find((cert) =>
          cert.usage?.includes('SymmetricKeyEncryption'),
        );

        if (!symmetricKeyCert?.certificate) {
          emitProgress('session', 'error', { message: 'Brak certyfikatu SymmetricKeyEncryption' });
          emitResult({ success: false, error: 'Nie znaleziono certyfikatu SymmetricKeyEncryption dla sesji KSeF.' });
          controller.close();
          return;
        }

        const { error: claimError } = await supabase.rpc('begin_ksef_send_with_snapshot_atomic', {
          p_invoice_id: invoiceId,
          p_expected_updated_at: invoice.updated_at,
          p_expected_snapshot: invoice.ksef_recipient_snapshot,
          p_actor: actorEmployeeId,
        });
        if (claimError) {
          throw new Error(`Nie udało się zablokować dokumentu do pojedynczej wysyłki KSeF: ${claimError.message}`);
        }
        ksefSendClaimed = true;

        // Pending-state guards serialize item edits. Rebuild the exact locked version, not a stale preflight.
        const claimedInvoice = await fetchInvoice(supabase, invoiceId);
        if (claimedInvoice.error || !claimedInvoice.data || claimedInvoice.data.ksef_status !== 'pending') {
          throw new Error('Nie udało się odczytać zablokowanej wersji faktury. Nie wysłano dokumentu do KSeF.');
        }
        if (claimedInvoice.data.my_company_id !== invoice.my_company_id) {
          throw new Error('Firma faktury zmieniła się podczas przygotowania wysyłki. Otwórz dokument ponownie.');
        }
        preparedInvoice = await prepareStoredInvoiceForKsef(supabase, claimedInvoice.data);
        requireMatchingSeller(credentials, preparedInvoice.seller.nip);
        xmlContent = generateFA3XML(preparedInvoice);

        const keyMaterial = createSymmetricKeyMaterial(symmetricKeyCert.certificate);

        emitProgress('session', 'active', { message: 'Otwieranie sesji szyfrowanej KSeF' });

        let sessionResponse;
        try {
          sessionResponse = await openKSeFOnlineSession(
            accessToken,
            FA3_FORM_CODE,
            keyMaterial,
            isTestEnv,
            { action: 'send-invoice', invoiceId, myCompanyId: invoice.my_company_id },
          );
        } catch (error: any) {
          const message = error?.message || String(error);
          if (message.includes('KSeF API error 401')) {
            emitProgress('session', 'active', { message: 'Re-autentykacja sesji KSeF...' });
            const reauth = await reAuthenticateKSeF({
              supabase,
              credentials,
              invoiceId,
              myCompanyId: invoice.my_company_id,
            });
            accessToken = reauth.accessToken;
            sessionResponse = await openKSeFOnlineSession(
              accessToken,
              FA3_FORM_CODE,
              keyMaterial,
              isTestEnv,
              { action: 'send-invoice-retry', invoiceId, myCompanyId: invoice.my_company_id },
            );
          } else {
            throw error;
          }
        }

        sessionId = sessionResponse.referenceNumber;
        accessTokenForClose = accessToken;
        isTestEnvForClose = isTestEnv;

        emitProgress('session', 'completed');

        // Encrypt & send
        currentStep = 'encrypt';
        emitProgress('encrypt', 'active', { message: 'Szyfrowanie faktury' });

        const encryptedInvoice = encryptInvoiceXml(xmlContent, keyMaterial);

        // A timeout does not prove non-delivery. Keep the invoice pending from the moment dispatch starts.
        invoiceMayHaveReachedKsef = true;
        const sendResponse = await sendKSeFInvoiceInSession(
          sessionId,
          encryptedInvoice,
          accessToken,
          isTestEnv,
          { action: 'send-invoice', invoiceId, myCompanyId: invoice.my_company_id },
        );

        emitProgress('encrypt', 'completed');

        // Poll
        currentStep = 'poll';
        const maxRetries = 15;
        emitProgress('poll', 'active', { message: 'Oczekiwanie na potwierdzenie KSeF', attempt: 1, maxAttempts: maxRetries });

        let ksefNumber: string | undefined;
        let acquisitionTimestamp: string | undefined;
        let rejectionMessage: string | undefined;

        for (let i = 0; i < maxRetries; i++) {
          emitProgress('poll', 'active', {
            message: `Sprawdzanie statusu faktury - próba ${i + 1}`,
            attempt: i + 1,
            maxAttempts: maxRetries,
          });
          await wait(2000);

          try {
            const sessionInvoices = await getKSeFSessionInvoices(
              sessionId,
              accessToken,
              isTestEnv,
              { action: 'check-invoice-status', invoiceId, myCompanyId: invoice.my_company_id, attempt: i + 1 },
            );

            const sentReference = sendResponse.referenceNumber || sendResponse.invoiceReferenceNumber;
            const inv = sessionInvoices.invoices?.find((candidate) =>
              (sentReference && candidate.referenceNumber === sentReference) ||
              candidate.invoiceHash === encryptedInvoice.invoiceHash,
            );
            if (!inv) continue;

            const rawStatus = inv.status;
            if (rawStatus && typeof rawStatus === 'object') {
              const statusCode = typeof (rawStatus as any).code === 'number' ? (rawStatus as any).code : undefined;
              const statusDescription = typeof (rawStatus as any).description === 'string' ? (rawStatus as any).description : undefined;
              const statusDetails = Array.isArray((rawStatus as any).details) ? (rawStatus as any).details : [];

              // API referenceNumber identifies an attempt; only ksefNumber identifies an accepted invoice.
              if (statusCode === 200 && inv.ksefNumber) {
                ksefNumber = inv.ksefNumber;
                acquisitionTimestamp = inv.acquisitionDate || inv.acquisitionTimestamp || inv.invoicingDate;
                emitProgress('poll', 'completed', { message: 'KSeF przyjął fakturę i nadał numer' });
                break;
              }

              if (statusCode && statusCode >= 400) {
                rejectionMessage = [statusDescription, ...statusDetails].filter(Boolean).join(' | ') || `KSeF odrzucił fakturę (kod ${statusCode}).`;
                break;
              }
            }
          } catch (pollErr) {
            console.warn(`Poll attempt ${i + 1} failed:`, pollErr);
          }
        }

        if (!ksefNumber && !rejectionMessage) {
          emitProgress('poll', 'completed', { message: 'Timeout - brak odpowiedzi z KSeF' });
        }

        // Save
        currentStep = 'save';
        emitProgress('save', 'active', { message: 'Zapisywanie wyniku wysyłki' });

        const finalRefNumber = ksefNumber ?? null;
        const finalTimestamp = ksefNumber
          ? acquisitionTimestamp || sendResponse.timestamp || new Date().toISOString()
          : null;

        const isRejected = !!rejectionMessage;
        const isPending = !ksefNumber && !rejectionMessage;

        const { error: persistenceError } = await supabase.rpc(
          'persist_ksef_send_result_atomic',
          {
            p_invoice_id: invoiceId,
            p_xml_content: xmlContent,
            p_ksef_number: finalRefNumber,
            p_final_timestamp: finalTimestamp,
            p_rejection_message: rejectionMessage ?? null,
            p_is_pending: isPending,
            p_actor: actorEmployeeId,
          },
        );

        if (persistenceError) {
          throw new Error(
            `KSeF przetworzył dokument, ale nie udało się atomowo zapisać wyniku: ${persistenceError.message}`,
          );
        }

        emitProgress('save', 'completed', { message: 'Wynik zapisany w systemie' });

        if (isRejected) {
          emitResult({
            success: false,
            error: 'Faktura została odrzucona przez KSeF',
            details: rejectionMessage || 'Błąd weryfikacji semantyki dokumentu faktury',
          });
        } else if (isPending) {
          emitResult({
            success: false,
            pending: true,
            error:
              'KSeF nie zwrócił jeszcze ostatecznego statusu. Faktura została zablokowana do czasu synchronizacji, aby nie wysłać jej ponownie.',
          });
        } else {
          emitResult({
            success: true,
            ksef_reference_number: finalRefNumber,
            ksef_timestamp: finalTimestamp,
          });
        }
      } catch (error: any) {
        if (ksefSendClaimed && persistenceClient) {
          const { error: failurePersistenceError } = await persistenceClient.rpc(
            'finish_ksef_send_attempt_failure_atomic',
            {
              p_invoice_id: invoiceId,
              p_error: error?.message || String(error),
              p_keep_pending: invoiceMayHaveReachedKsef,
              p_actor: actorEmployeeId,
            },
          );
          if (failurePersistenceError) {
            console.error('Nie udało się zapisać stanu awarii wysyłki KSeF:', failurePersistenceError);
          }
        }
        console.error('Error sending invoice to KSeF:', error);
        emitProgress(currentStep, 'error', { message: error.message || String(error) });
        emitResult({
          success: false,
          pending: invoiceMayHaveReachedKsef,
          error: invoiceMayHaveReachedKsef
            ? 'Nie udało się potwierdzić wyniku wysyłki. Faktura mogła dotrzeć do KSeF — najpierw odśwież jej status, nie wysyłaj ponownie.'
            : error.message || 'Błąd podczas wysyłania faktury do KSeF',
          details: invoiceMayHaveReachedKsef ? error.message || String(error) : undefined,
        });
      } finally {
        if (sessionId && accessTokenForClose) {
          try {
            await closeKSeFOnlineSession(sessionId, accessTokenForClose, isTestEnvForClose, {
              action: 'send-invoice-close',
              invoiceId,
            });
          } catch (closeErr) {
            console.warn('Failed to close KSeF session:', closeErr);
          }
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
