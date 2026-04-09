import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateFA2XML, validateFA2Requirements } from '@/lib/ksef/generateFA2XML';
import {
  getKSeFChallenge,
  authenticateWithKSeFToken,
  getKSeFAuthStatus,
  redeemKSeFAuthToken,
  getKSeFPublicKeyCertificates,
  ksefFetch,
} from '../../../ksef/client';
import { encryptKSeFTokenPayloadFromCertificate } from '../../../ksef/crypto';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * POST /api/ksef/invoices/send
 * Wyślij fakturę do KSeF
 */
export async function POST(request: NextRequest) {
  try {
    const { invoiceId } = await request.json();

    if (!invoiceId) {
      return NextResponse.json({ error: 'Brak ID faktury' }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Pobierz fakturę z pozycjami
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

    // 2. Walidacja - proformy nie idą do KSeF
    if (invoice.is_proforma) {
      return NextResponse.json(
        { error: 'Faktury proforma nie mogą być wysłane do KSeF. Wystaw fakturę VAT.' },
        { status: 400 }
      );
    }

    // 3. Sprawdź czy już nie została wysłana
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

    // 4. Walidacja wymagań FA(2)
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

    // 5. Pobierz dane uwierzytelniające dla firmy
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

    // 6. Sprawdź token dostępu
    let accessToken = credentials.access_token;
    const tokenExpiry = credentials.access_token_valid_until;

    if (!accessToken || !tokenExpiry || new Date(tokenExpiry) < new Date()) {
      // Token wygasł lub nie istnieje - trzeba się ponownie uwierzytelnić
      console.log('Access token expired or missing, re-authenticating...');

      // 6a. Pobierz challenge
      const challengeResponse = await getKSeFChallenge(isTestEnv, {
        action: 'send-invoice',
        invoiceId,
      });

      // 6b. Pobierz certyfikaty publiczne KSeF
      const publicKeyCertificates = await getKSeFPublicKeyCertificates(isTestEnv, {
        action: 'send-invoice',
        invoiceId,
      });

      const encryptionCert = publicKeyCertificates.find((cert) =>
        cert.usage?.includes('KsefTokenEncryption')
      );
      if (!encryptionCert) {
        throw new Error('Nie znaleziono certyfikatu do szyfrowania tokenu KSeF');
      }

      // 6c. Zaszyfruj token
      const plainToEncrypt = `${credentials.token}|${challengeResponse.timestampMs}`;
      const encryptedToken = encryptKSeFTokenPayloadFromCertificate(
        plainToEncrypt,
        encryptionCert.certificate
      );

      // 6d. Uwierzytelnij
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

      // 6e. Poczekaj na zatwierdzenie sesji
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const authStatus = await getKSeFAuthStatus(
        authResponse.referenceNumber,
        authResponse.authenticationToken.token,
        isTestEnv,
        { action: 'send-invoice', invoiceId }
      );

      if (authStatus.status?.code !== 200) {
        console.log('Auth status not ready:', authStatus);
        throw new Error(`KSeF auth status: ${authStatus.status?.code} - ${authStatus.status?.description}`);
      }

      // 6f. Wymień authenticationToken na accessToken
      const redeemResponse = await redeemKSeFAuthToken(
        authResponse.authenticationToken.token,
        isTestEnv,
        { action: 'send-invoice', invoiceId }
      );

      // 6g. Zapisz nowy accessToken
      await supabase
        .from('ksef_credentials')
        .update({
          access_token: redeemResponse.accessToken.token,
          access_token_valid_until: redeemResponse.accessToken.validUntil,
          last_auth_reference_number: authResponse.referenceNumber,
          last_authenticated_at: new Date().toISOString(),
        })
        .eq('id', credentials.id);

      accessToken = redeemResponse.accessToken.token;
    }

    // 7. Generuj XML FA(2)
    const xmlContent = generateFA2XML(invoice);

    console.log('Generated FA(2) XML:', {
      invoiceId,
      invoiceNumber: invoice.invoice_number,
      xmlLength: xmlContent.length,
    });

    // 8. Wyślij fakturę do KSeF
    const sendResponse = await ksefFetch<{
      referenceNumber: string;
      timestamp: string;
      elementReferenceNumber?: string;
    }>(
      '/invoices/send',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: xmlContent,
      },
      { isTestEnvironment: isTestEnv, context: { action: 'send-invoice', invoiceId } }
    );

    console.log('KSeF send response:', sendResponse);

    // 9. Zapisz w tabeli ksef_invoices
    const { data: ksefInvoice, error: ksefError } = await supabase
      .from('ksef_invoices')
      .insert({
        invoice_id: invoiceId,
        ksef_reference_number: sendResponse.referenceNumber,
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
        ksef_issued_at: sendResponse.timestamp,
        synced_at: new Date().toISOString(),
        my_company_id: invoice.my_company_id,
      })
      .select()
      .single();

    if (ksefError) {
      console.error('Error saving to ksef_invoices:', ksefError);
      // Nie przerywamy - faktura została wysłana, tylko zapis nie udał się
    }

    // 10. Zaktualizuj status faktury
    await supabase
      .from('invoices')
      .update({
        status: 'issued',
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId);

    // 11. Dodaj do historii
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
        ksef_reference_number: sendResponse.referenceNumber,
        sent_at: sendResponse.timestamp,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Faktura została pomyślnie wysłana do KSeF',
      ksef_reference_number: sendResponse.referenceNumber,
      ksef_timestamp: sendResponse.timestamp,
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
