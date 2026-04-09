import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateFA2XML, validateFA2Requirements } from '@/lib/ksef/generateFA2XML';
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
} from '../../../ksef/client';
import {
  encryptKSeFTokenPayloadFromCertificate,
  createSymmetricKeyMaterial,
  encryptInvoiceXml,
} from '../../../ksef/crypto';
import type { KSeFFormCode } from '../../../ksef/types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const FA2_FORM_CODE: KSeFFormCode = {
  systemCode: 'FA (2)',
  schemaVersion: '1-0E',
  value: 'FA',
};

export async function POST(request: NextRequest) {
  try {
    const { invoiceId } = await request.json();

    if (!invoiceId) {
      return NextResponse.json({ error: 'Brak ID faktury' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('*, invoice_items(*)')
      .eq('id', invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { error: 'Nie znaleziono faktury' },
        { status: 404 }
      );
    }

    if (invoice.is_proforma) {
      return NextResponse.json(
        { error: 'Faktury proforma nie mogą być wysłane do KSeF. Wystaw fakturę VAT.' },
        { status: 400 }
      );
    }

    if (invoice.status === 'issued') {
      const { data: existingKsef } = await supabase
        .from('ksef_invoices')
        .select('ksef_reference_number')
        .eq('invoice_id', invoiceId)
        .eq('sync_status', 'synced')
        .maybeSingle();

      if (existingKsef) {
        return NextResponse.json(
          {
            error: 'Faktura została już wysłana do KSeF',
            ksef_reference_number: existingKsef.ksef_reference_number,
          },
          { status: 400 }
        );
      }
    }

    const validation = validateFA2Requirements(invoice);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: 'Faktura nie spełnia wymagań KSeF',
          details: validation.errors,
        },
        { status: 400 }
      );
    }

    const { data: credentials, error: credError } = await supabase
      .from('ksef_credentials')
      .select('*')
      .eq('my_company_id', invoice.my_company_id)
      .eq('is_active', true)
      .maybeSingle();

    if (credError || !credentials) {
      return NextResponse.json(
        { error: 'Brak aktywnych danych uwierzytelniających KSeF dla tej firmy' },
        { status: 400 }
      );
    }

    const isTestEnv = credentials.is_test_environment ?? false;

    let accessToken = credentials.access_token;
    const tokenExpiry = credentials.access_token_valid_until;

    if (!accessToken || !tokenExpiry || new Date(tokenExpiry) < new Date()) {
      console.log('Access token expired or missing, re-authenticating...');

      const challengeResponse = await getKSeFChallenge(isTestEnv, {
        action: 'send-invoice',
        invoiceId,
      });

      const publicKeyCertificates = await getKSeFPublicKeyCertificates(isTestEnv, {
        action: 'send-invoice',
        invoiceId,
      });

      const encryptionCert = publicKeyCertificates.find((cert) =>
        cert.usage?.includes('KsefTokenEncryption')
      );
      if (!encryptionCert) {
        throw new Error('Nie znaleziono certyfikatu KsefTokenEncryption');
      }

      const plainToEncrypt = `${credentials.token}|${challengeResponse.timestampMs}`;
      const encryptedToken = encryptKSeFTokenPayloadFromCertificate(
        plainToEncrypt,
        encryptionCert.certificate
      );

      const authResponse = await authenticateWithKSeFToken(
        {
          encryptedToken,
          challenge: challengeResponse.challenge,
          nip: credentials.nip,
        },
        isTestEnv,
        { action: 'send-invoice', invoiceId }
      );

      if (!authResponse.authenticationToken?.token) {
        throw new Error('KSeF nie zwrócił authenticationToken');
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const authStatus = await getKSeFAuthStatus(
        authResponse.referenceNumber,
        authResponse.authenticationToken.token,
        isTestEnv,
        { action: 'send-invoice', invoiceId }
      );

      if (authStatus.status?.code !== 200) {
        throw new Error(
          `KSeF auth status: ${authStatus.status?.code} - ${authStatus.status?.description}`
        );
      }

      const redeemResponse = await redeemKSeFAuthToken(
        authResponse.authenticationToken.token,
        isTestEnv,
        { action: 'send-invoice', invoiceId }
      );

      await supabase
        .from('ksef_credentials')
        .update({
          access_token: redeemResponse.accessToken.token,
          access_token_valid_until: redeemResponse.accessToken.validUntil,
          refresh_token: redeemResponse.refreshToken?.token ?? null,
          refresh_token_valid_until: redeemResponse.refreshToken?.validUntil ?? null,
          last_auth_reference_number: authResponse.referenceNumber,
          last_authenticated_at: new Date().toISOString(),
        })
        .eq('id', credentials.id);

      accessToken = redeemResponse.accessToken.token;
    }

    const xmlContent = generateFA2XML(invoice);

    console.log('Generated FA(2) XML:', {
      invoiceId,
      invoiceNumber: invoice.invoice_number,
      xmlLength: xmlContent.length,
    });

    const publicKeyCertificates = await getKSeFPublicKeyCertificates(isTestEnv, {
      action: 'session-encryption',
      invoiceId,
    });

    const symmetricKeyCert = publicKeyCertificates.find((cert) =>
      cert.usage?.includes('SymmetricKeyEncryption')
    );
    if (!symmetricKeyCert) {
      throw new Error('Nie znaleziono certyfikatu SymmetricKeyEncryption');
    }

    const keyMaterial = createSymmetricKeyMaterial(symmetricKeyCert.certificate);

    console.log('Opening KSeF online session...');
    const sessionResponse = await openKSeFOnlineSession(
      accessToken,
      FA2_FORM_CODE,
      keyMaterial,
      isTestEnv,
      { action: 'send-invoice', invoiceId }
    );

    const sessionId = sessionResponse.referenceNumber;
    console.log('KSeF session opened:', { sessionId });

    const encryptedInvoice = encryptInvoiceXml(xmlContent, keyMaterial);

    console.log('Sending encrypted invoice in session...', {
      invoiceSize: encryptedInvoice.invoiceSize,
      encryptedSize: encryptedInvoice.encryptedInvoiceSize,
    });

    const sendResponse = await sendKSeFInvoiceInSession(
      sessionId,
      encryptedInvoice,
      accessToken,
      isTestEnv,
      { action: 'send-invoice', invoiceId }
    );

    console.log('KSeF invoice sent:', sendResponse);

    let ksefNumber: string | undefined;
    let acquisitionTimestamp: string | undefined;
    const maxRetries = 15;
    for (let i = 0; i < maxRetries; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        const sessionInvoices = await getKSeFSessionInvoices(
          sessionId,
          accessToken,
          isTestEnv,
          { action: 'check-invoice-status', invoiceId, attempt: i + 1 }
        );

        console.log(`Invoice status check ${i + 1}:`, sessionInvoices);

        const inv = sessionInvoices.invoices?.find(
          (inv) =>
            inv.invoiceReferenceNumber === sendResponse.referenceNumber ||
            inv.invoiceReferenceNumber === sendResponse.invoiceReferenceNumber
        );

        if (inv?.ksefReferenceNumber) {
          ksefNumber = inv.ksefReferenceNumber;
          acquisitionTimestamp = inv.acquisitionTimestamp;
          break;
        }
      } catch (pollErr) {
        console.warn(`Poll attempt ${i + 1} failed:`, pollErr);
      }
    }

    try {
      await closeKSeFOnlineSession(sessionId, accessToken, isTestEnv, {
        action: 'send-invoice',
        invoiceId,
      });
      console.log('KSeF session closed');
    } catch (closeErr) {
      console.warn('Failed to close KSeF session:', closeErr);
    }

    const finalRefNumber =
      ksefNumber ||
      sendResponse.invoiceReferenceNumber ||
      sendResponse.referenceNumber;
    const finalTimestamp =
      acquisitionTimestamp || sendResponse.timestamp || new Date().toISOString();

    const { data: ksefInvoice, error: ksefError } = await supabase
      .from('ksef_invoices')
      .insert({
        invoice_id: invoiceId,
        ksef_reference_number: finalRefNumber,
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
        sync_status: 'synced',
        ksef_issued_at: finalTimestamp,
        synced_at: new Date().toISOString(),
        my_company_id: invoice.my_company_id,
      })
      .select()
      .single();

    if (ksefError) {
      console.error('Error saving to ksef_invoices:', ksefError);
    }

    await supabase
      .from('invoices')
      .update({
        status: 'issued',
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId);

    const { data: user } = await supabase.auth.getUser();
    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('email', user.user?.email)
      .maybeSingle();

    await supabase.from('invoice_history').insert({
      invoice_id: invoiceId,
      action: 'sent_to_ksef',
      changed_by: employee?.id,
      changes: {
        ksef_reference_number: finalRefNumber,
        sent_at: finalTimestamp,
      },
    });

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
      { status: 500 }
    );
  }
}
