import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { loadInvoiceFinanceAccess } from '@/lib/invoices/financeAccess';

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
    organizations: () => (supabase.from as any)('organizations'),
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

async function fetchOrganization(supabase: SupabaseClient<any>, organizationId?: string | null) {
  if (!organizationId) return { data: null, error: null };
  const db = getDb(supabase);
  return await db
    .organizations()
    .select('id, name, nip, email, phone, address, postal_code, city, country, alias, krs, regon')
    .eq('id', organizationId)
    .maybeSingle();
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

  const [{ data: invoiceRows }, { data: ksefByIdRows }, { data: ksefByNumberRows }] =
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

        const { data: invoice, error: invoiceError } = await fetchInvoice(supabase, invoiceId);

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

        const { data: alreadySynced } = await checkExistingSyncedInvoice(supabase, invoiceId);
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

        const organizationQuery = await fetchOrganization(supabase, invoice.organization_id);
        if (organizationQuery.error) {
          emitProgress('validate', 'error', { message: 'Błąd pobierania danych organizacji' });
          emitResult({ success: false, error: 'Nie udało się pobrać danych organizacji do KSeF' });
          controller.close();
          return;
        }
        const organization = organizationQuery.data ?? null;

        if (invoice.invoice_type === 'corrective' && invoice.related_invoice_id) {
          const db = getDb(supabase);
          const { data: relatedInv } = await db
            .invoices()
            .select('invoice_type, total_gross, settlement_summary')
            .eq('id', invoice.related_invoice_id)
            .maybeSingle();
          if (relatedInv) {
            invoice.corrected_invoice_type = relatedInv.invoice_type;
            invoice.corrected_amount_before =
              relatedInv.invoice_type === 'final'
                ? Number(relatedInv.settlement_summary?.remainingGross ?? relatedInv.total_gross ?? 0)
                : Number(relatedInv.total_gross ?? 0);
          }
        }

        invoice.is_final_invoice = isFinalInvoice;
        const invoiceForXml = isFinalInvoice
          ? await enrichFinalInvoiceSettledInvoicesWithKsefNumbers(supabase, invoice)
          : invoice;

        const normalizedPaymentDate = invoice.paid_at
          ? String(invoice.paid_at).split('T')[0]
          : invoice.paid_date
            ? String(invoice.paid_date).split('T')[0]
            : invoice.payment_date
              ? String(invoice.payment_date).split('T')[0]
              : null;

        const normalizedInvoiceForXml = {
          ...invoiceForXml,
          payment_date: normalizedPaymentDate,
          paid_at: invoice.paid_at,
          paid_amount:
            invoice.payment_status === 'paid'
              ? Math.abs(Number(invoice.paid_amount ?? invoice.total_gross ?? 0))
              : Number(invoice.paid_amount ?? 0),
        };

        const preparedInvoice = prepareFA3Invoice(normalizedInvoiceForXml, organization);
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

        const xmlContent = generateFA3XML(preparedInvoice);


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

        const { error: claimError } = await supabase.rpc('begin_ksef_send_atomic', {
          p_invoice_id: invoiceId,
          p_actor: actorEmployeeId,
        });
        if (claimError) {
          throw new Error(`Nie udało się zablokować dokumentu do pojedynczej wysyłki KSeF: ${claimError.message}`);
        }
        ksefSendClaimed = true;

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

        const sendResponse = await sendKSeFInvoiceInSession(
          sessionId,
          encryptedInvoice,
          accessToken,
          isTestEnv,
          { action: 'send-invoice', invoiceId, myCompanyId: invoice.my_company_id },
        );
        invoiceMayHaveReachedKsef = true;

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

            const inv = sessionInvoices.invoices?.[0];
            if (!inv) continue;

            const foundKsefNumber =
            inv.ksefNumber ||
            inv.ksefReferenceNumber ||
            inv.invoiceReferenceNumber ||
            null;
          
          if (foundKsefNumber) {
            ksefNumber = foundKsefNumber;
          
            acquisitionTimestamp =
              inv.acquisitionDate ||
              inv.acquisitionTimestamp ||
              inv.invoicingDate ||
              undefined;
          
            emitProgress('poll', 'completed', {
              message: 'KSeF nadał numer referencyjny',
            });
          
            break;
          }

            const rawStatus = inv.status;
            if (rawStatus && typeof rawStatus === 'object') {
              const statusCode = typeof (rawStatus as any).code === 'number' ? (rawStatus as any).code : undefined;
              const statusDescription = typeof (rawStatus as any).description === 'string' ? (rawStatus as any).description : undefined;
              const statusDetails = Array.isArray((rawStatus as any).details) ? (rawStatus as any).details : [];

              if (statusCode && statusCode >= 400) {
                rejectionMessage = [statusDescription, ...statusDetails].filter(Boolean).join(' | ');
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
        emitResult({ success: false, error: error.message || 'Błąd podczas wysyłania faktury do KSeF' });
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
