import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
  debugFA3PreparedInvoice,
} from '../../../../../lib/ksef/generateFA3XML';

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

/**
 * Wrapper na tabele Supabase.
 * Celowo przez `as any`, bo u Ciebie typy DB nie znają jeszcze tabel KSeF
 * i przez to `.from('ksef_credentials')` daje `never`.
 */
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
    .select('*, invoice_items(*)')
    .eq('id', invoiceId)
    .single();
}

async function fetchOrganization(
  supabase: SupabaseClient<any>,
  organizationId?: string | null,
) {
  if (!organizationId) {
    return { data: null, error: null };
  }

  const db = getDb(supabase);

  return await db
    .organizations()
    .select('id, name, nip, email, phone, address, postal_code, city, country, alias, krs, regon')
    .eq('id', organizationId)
    .maybeSingle();
}

async function fetchActiveCredentials(
  supabase: SupabaseClient<any>,
  myCompanyId: string,
) {
  const db = getDb(supabase);

  return await db
    .ksefCredentials()
    .select('*')
    .eq('my_company_id', myCompanyId)
    .eq('is_active', true)
    .maybeSingle();
}

async function checkExistingSyncedInvoice(
  supabase: SupabaseClient<any>,
  invoiceId: string,
) {
  const db = getDb(supabase);

  return await db
    .ksefInvoices()
    .select('ksef_reference_number')
    .eq('invoice_id', invoiceId)
    .eq('sync_status', 'synced')
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

  const updatePayload = {
    access_token: params.accessToken,
    access_token_valid_until: params.accessTokenValidUntil,
    refresh_token: params.refreshToken ?? null,
    refresh_token_valid_until: params.refreshTokenValidUntil ?? null,
    last_auth_reference_number: params.authReferenceNumber,
    last_authenticated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return await db
    .ksefCredentials()
    .update(updatePayload)
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
    {
      action: 'send-invoice-reauth',
      invoiceId,
      myCompanyId,
    },
  );

  if (!authResponse.authenticationToken?.token) {
    throw new Error('KSeF nie zwrócił authenticationToken');
  }

  await wait(1500);

  const authStatus = await getKSeFAuthStatus(
    authResponse.referenceNumber,
    authResponse.authenticationToken.token,
    isTestEnv,
    {
      action: 'send-invoice-reauth-status',
      invoiceId,
      myCompanyId,
    },
  );

  if (authStatus.status?.code !== 200) {
    throw new Error(
      `KSeF auth status: ${authStatus.status?.code} - ${authStatus.status?.description}`,
    );
  }

  const redeemResponse = await redeemKSeFAuthToken(
    authResponse.authenticationToken.token,
    isTestEnv,
    {
      action: 'send-invoice-reauth-redeem',
      invoiceId,
      myCompanyId,
    },
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
    console.error('Error updating KSeF credentials:', updateError);
    throw new Error('Błąd podczas aktualizacji danych uwierzytelniających KSeF');
  }

  return {
    accessToken: redeemResponse.accessToken.token,
    accessTokenValidUntil: redeemResponse.accessToken.validUntil,
  };
}

async function createOrUpdateKsefInvoiceRecord(params: {
  supabase: SupabaseClient<any>;
  invoice: any;
  invoiceId: string;
  xmlContent: string;
  isRejected: boolean;
  ksefNumber: string | null;
  finalTimestamp: string | null;
  rejectionMessage?: string;
}) {
  const {
    supabase,
    invoice,
    invoiceId,
    xmlContent,
    isRejected,
    ksefNumber,
    finalTimestamp,
    rejectionMessage,
  } = params;

  const db = getDb(supabase);

  const insertPayload = {
    invoice_id: invoiceId,
    ksef_reference_number: isRejected ? null : ksefNumber,
    invoice_type: 'issued',
    invoice_number: invoice.invoice_number,
    seller_name: invoice.seller_name,
    seller_nip: invoice.seller_nip,
    buyer_name: invoice.buyer_name,
    buyer_nip: invoice.buyer_nip,
    net_amount: invoice.total_net,
    gross_amount: invoice.total_gross,
    vat_amount: invoice.total_vat,
    currency: 'PLN',
    issue_date: invoice.issue_date,
    payment_due_date: invoice.payment_due_date,
    xml_content: xmlContent,
    sync_status: isRejected ? 'error' : 'synced',
    sync_error: rejectionMessage ?? null,
    ksef_issued_at: isRejected ? null : finalTimestamp,
    synced_at: new Date().toISOString(),
    my_company_id: invoice.my_company_id,
  };

  return await db.ksefInvoices().insert(insertPayload).select().single();
}

async function updateInvoiceStatus(params: {
  supabase: SupabaseClient<any>;
  invoiceId: string;
  isRejected: boolean;
}) {
  const db = getDb(params.supabase);

  return await db
    .invoices()
    .update({
      status: params.isRejected ? 'draft' : 'issued',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.invoiceId);
}

async function writeInvoiceHistory(params: {
  supabase: SupabaseClient<any>;
  invoiceId: string;
  finalRefNumber: string | null;
  finalTimestamp: string | null;
  rejectionMessage?: string;
  isRejected: boolean;
}) {
  const { supabase, invoiceId, finalRefNumber, finalTimestamp, rejectionMessage, isRejected } =
    params;

  const db = getDb(supabase);

  const { data: user } = await supabase.auth.getUser();

  const { data: employee } = await db
    .employees()
    .select('id')
    .eq('email', user.user?.email)
    .maybeSingle();

  return await db.invoiceHistory().insert({
    invoice_id: invoiceId,
    action: isRejected ? 'ksef_send_error' : 'sent_to_ksef',
    changed_by: employee?.id,
    changes: {
      ksef_reference_number: finalRefNumber,
      sent_at: finalTimestamp,
      rejection_message: rejectionMessage ?? null,
    },
  });
}

export async function POST(request: NextRequest) {
  let sessionId: string | undefined;
  let accessTokenForClose: string | undefined;
  let isTestEnvForClose = false;
  let invoiceIdForClose: string | undefined;
  let myCompanyIdForClose: string | undefined;

  try {
    const { invoiceId } = await request.json();

    if (!invoiceId) {
      return NextResponse.json({ error: 'Brak ID faktury' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Faktura
    const { data: invoice, error: invoiceError } = await fetchInvoice(supabase, invoiceId);

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Nie znaleziono faktury' }, { status: 404 });
    }

    if (invoice.is_proforma) {
      return NextResponse.json(
        { error: 'Faktury proforma nie mogą być wysłane do KSeF. Wystaw fakturę VAT.' },
        { status: 400 },
      );
    }

    if (invoice.status === 'issued') {
      const { data: existingKsef } = await checkExistingSyncedInvoice(supabase, invoiceId);

      if (existingKsef) {
        return NextResponse.json(
          {
            error: 'Faktura została już wysłana do KSeF',
            ksef_reference_number: existingKsef.ksef_reference_number,
          },
          { status: 400 },
        );
      }
    }

    // 2. Organizacja
    const organizationQuery = await fetchOrganization(supabase, invoice.organization_id);

    if (organizationQuery.error) {
      return NextResponse.json(
        { error: 'Nie udało się pobrać danych organizacji do KSeF' },
        { status: 500 },
      );
    }


    const organization = organizationQuery.data ?? null;
    // 3. Przygotowanie danych do FA(3)

    // 4. XML
    const preparedInvoice = prepareFA3Invoice(invoice, organization);

debugFA3PreparedInvoice(preparedInvoice);
const xmlContent = generateFA3XML(preparedInvoice, { debug: true });

    // 5. Credentials
    const { data: credentials, error: credError } = await fetchActiveCredentials(
      supabase,
      invoice.my_company_id,
    );

    if (credError || !credentials) {
      return NextResponse.json(
        { error: 'Brak aktywnych danych uwierzytelniających KSeF dla tej firmy' },
        { status: 400 },
      );
    }

    const isTestEnv = credentials.is_test_environment ?? false;
    let accessToken = credentials.access_token;
    if (!accessToken) {
      return NextResponse.json(
        {
          error: 'Sesja KSeF nie jest aktywna. Najpierw kliknij "Uwierzytelnij" w panelu KSeF.',
        },
        { status: 400 },
      );
    }

    // 6. Certyfikaty do sesji
    const publicKeyCertificates = await getKSeFPublicKeyCertificates(isTestEnv, {
      action: 'session-encryption',
      invoiceId,
      myCompanyId: invoice.my_company_id,
    });

    const symmetricKeyCert = publicKeyCertificates.find((cert) =>
      cert.usage?.includes('SymmetricKeyEncryption'),
    );

    if (!symmetricKeyCert?.certificate) {
      return NextResponse.json(
        {
          error: 'Nie znaleziono certyfikatu SymmetricKeyEncryption dla sesji KSeF.',
        },
        { status: 500 },
      );
    }

    const keyMaterial = createSymmetricKeyMaterial(symmetricKeyCert.certificate);

    // 7. Otwarcie sesji
    let sessionResponse;

    try {
      sessionResponse = await openKSeFOnlineSession(
        accessToken,
        FA3_FORM_CODE,
        keyMaterial,
        isTestEnv,
        {
          action: 'send-invoice',
          invoiceId,
          myCompanyId: invoice.my_company_id,
        },
      );
    } catch (error: any) {
      const message = error?.message || String(error);

      if (message.includes('KSeF API error 401')) {
        console.warn('[KSEF_SEND] access token rejected, re-authenticating...', {
          invoiceId,
          myCompanyId: invoice.my_company_id,
        });

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
          {
            action: 'send-invoice-retry',
            invoiceId,
            myCompanyId: invoice.my_company_id,
          },
        );
      } else {
        throw error;
      }
    }

    sessionId = sessionResponse.referenceNumber;
    accessTokenForClose = accessToken;
    isTestEnvForClose = isTestEnv;
    invoiceIdForClose = invoiceId;
    myCompanyIdForClose = invoice.my_company_id;

    // 8. Wysłanie faktury
    const encryptedInvoice = encryptInvoiceXml(xmlContent, keyMaterial);

    const sendResponse = await sendKSeFInvoiceInSession(
      sessionId,
      encryptedInvoice,
      accessToken,
      isTestEnv,
      {
        action: 'send-invoice',
        invoiceId,
        myCompanyId: invoice.my_company_id,
      },
    );

    // 9. Poll statusu
    let ksefNumber: string | undefined;
    let acquisitionTimestamp: string | undefined;
    let rejectionMessage: string | undefined;

    const maxRetries = 15;

    for (let i = 0; i < maxRetries; i++) {
      await wait(2000);

      try {
        const sessionInvoices = await getKSeFSessionInvoices(
          sessionId,
          accessToken,
          isTestEnv,
          {
            action: 'check-invoice-status',
            invoiceId,
            myCompanyId: invoice.my_company_id,
            attempt: i + 1,
          },
        );

        const inv = sessionInvoices.invoices?.[0];
        
        if (inv.ksefReferenceNumber) {
          ksefNumber = inv.ksefReferenceNumber;
          acquisitionTimestamp = inv.acquisitionTimestamp;
          break;
        }

        if (inv.invoiceReferenceNumber) {
          ksefNumber = inv.invoiceReferenceNumber;
          acquisitionTimestamp = inv.acquisitionTimestamp;
          break;
        }
        
        const rawStatus = inv.status;

if (rawStatus && typeof rawStatus === 'object') {
  const statusCode =
    typeof (rawStatus as any).code === 'number'
      ? (rawStatus as any).code
      : undefined;

  const statusDescription =
    typeof (rawStatus as any).description === 'string'
      ? (rawStatus as any).description
      : undefined;

  const statusDetails = Array.isArray((rawStatus as any).details)
    ? (rawStatus as any).details
    : [];

  if (statusCode && statusCode >= 400) {
    rejectionMessage = [statusDescription, ...statusDetails]
      .filter(Boolean)
      .join(' | ');
    break;
  }
}
      } catch (pollErr) {
        console.warn(`Poll attempt ${i + 1} failed:`, pollErr);
      }
    }

    // 10. Wynik końcowy
    const isRejected = !ksefNumber && !!rejectionMessage;
    const finalRefNumber = ksefNumber ?? null;
    const finalTimestamp = ksefNumber
      ? acquisitionTimestamp || sendResponse.timestamp || new Date().toISOString()
      : null;

    const { data: ksefInvoice, error: ksefError } = await createOrUpdateKsefInvoiceRecord({
      supabase,
      invoice,
      invoiceId,
      xmlContent,
      isRejected,
      ksefNumber: finalRefNumber,
      finalTimestamp,
      rejectionMessage,
    });

    if (ksefError) {
      console.error('Error saving to ksef_invoices:', ksefError);
    }

    await updateInvoiceStatus({
      supabase,
      invoiceId,
      isRejected,
    });

    await writeInvoiceHistory({
      supabase,
      invoiceId,
      finalRefNumber,
      finalTimestamp,
      rejectionMessage,
      isRejected,
    });

    if (isRejected) {
      return NextResponse.json(
        {
          success: false,
          error: 'Faktura została odrzucona przez KSeF',
          details: rejectionMessage || 'Błąd weryfikacji semantyki dokumentu faktury',
          invoice: ksefInvoice,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Faktura została pomyślnie wysłana do KSeF',
      ksef_reference_number: finalRefNumber,
      ksef_timestamp: finalTimestamp,
      invoice: ksefInvoice,
    });
  } catch (error: any) {
    console.error('Error sending invoice to KSeF:', error);

    return NextResponse.json(
      {
        error: 'Błąd podczas wysyłania faktury do KSeF',
        details: error.message || String(error),
      },
      { status: 500 },
    );
  } finally {
    if (sessionId && accessTokenForClose) {
      try {
        await closeKSeFOnlineSession(sessionId, accessTokenForClose, isTestEnvForClose, {
          action: 'send-invoice',
          invoiceId: invoiceIdForClose,
          myCompanyId: myCompanyIdForClose,
        });
      } catch (closeErr) {
        console.warn('Failed to close KSeF session:', closeErr);
      }
    }
  }
}