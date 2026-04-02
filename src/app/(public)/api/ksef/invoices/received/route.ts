import { NextResponse } from 'next/server';
import { getCredentials, supabase } from '@/lib/ksef/db';
import { getKSeFInvoices } from '../../client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const companyId =
      typeof body?.companyId === 'string' ? body.companyId.trim() : '';
    const dateFrom =
      typeof body?.dateFrom === 'string' ? body.dateFrom : '';
    const dateTo =
      typeof body?.dateTo === 'string' ? body.dateTo : '';

    if (!companyId) {
      return NextResponse.json(
        { success: false, error: 'Brak companyId' },
        { status: 400 }
      );
    }

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { success: false, error: 'Brak dateFrom lub dateTo' },
        { status: 400 }
      );
    }

    const credentials = await getCredentials(companyId);

    if (!credentials?.access_token) {
      return NextResponse.json(
        { success: false, error: 'Brak access_token' },
        { status: 400 }
      );
    }

    console.log('[KSEF_NEXT] issued invoices request', {
      companyId,
      dateFrom,
      dateTo,
      hasAccessToken: !!credentials.access_token,
      environment: credentials.is_test_environment ? 'test' : 'production',
    });

    const data = await getKSeFInvoices(
      {
        accessToken: credentials.access_token,
        subjectType: 'Subject2',
        dateFrom,
        dateTo,
        pageOffset: 0,
        pageSize: 100,
        sortOrder: 'Desc',
      },
      credentials.is_test_environment,
      {
        stage: 'invoices-received',
        companyId,
      }
    );

    const invoices = Array.isArray(data?.invoices) ? data.invoices : [];

    console.log('[KSEF_NEXT] received invoices fetched', {
      companyId,
      count: invoices.length,
      sampleKeys: invoices[0] ? Object.keys(invoices[0]) : [],
    });

    if (invoices.length > 0) {
      const rows = invoices.map((inv: any) => ({
        ksef_reference_number:
          inv.ksefNumber ||
          inv.ksefReferenceNumber ||
          inv.ksef_reference_number ||
          inv.referenceNumber,
        invoice_number: inv.invoiceNumber || null,
        invoice_type: 'received',
        seller_name: inv.seller?.name || null,
        buyer_name: inv.buyer?.name || null,
        net_amount: inv.netAmount ?? null,
        gross_amount: inv.grossAmount ?? null,
        vat_amount: inv.vatAmount ?? null,
        currency: inv.currency || 'PLN',
        issue_date: inv.issueDate || null,
        seller_nip: inv.seller?.nip || null,
buyer_nip:
  inv.buyer?.identifier?.type === 'Nip'
    ? inv.buyer?.identifier?.value || null
    : null,
payment_due_date: inv.paymentDueDate || null,
payment_status: 'unpaid',
        xml_content: '',
        sync_status: 'synced',
        sync_error: null,
        ksef_issued_at:
          inv.acquisitionDate ||
          inv.invoicingDate ||
          inv.issueDate ||
          inv.acquisitionTimestamp ||
          inv.invoiceDate ||
          new Date().toISOString(),
        synced_at: new Date().toISOString(),
      }));

      const validRows = rows.filter((row) => !!row.ksef_reference_number);

      console.log('[KSEF_NEXT] received invoices mapped for upsert', {
        companyId,
        mappedCount: rows.length,
        validCount: validRows.length,
        firstRow: validRows[0] ?? null,
      });

      if (validRows.length > 0) {
        const { error: upsertError } = await supabase
          .from('ksef_invoices')
          .upsert(validRows, {
            onConflict: 'ksef_reference_number',
          });

        if (upsertError) {
          console.error('[KSEF_NEXT] received invoices upsert error', upsertError);

          return NextResponse.json(
            {
              success: false,
              error: upsertError.message || 'Błąd zapisu faktur do bazy',
            },
            { status: 500 }
          );
        }
      }
    }

    const { error: logError } = await supabase.from('ksef_sync_log').insert({
      sync_type: 'received',
      status: 'success',
      invoices_count: invoices.length,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    if (logError) {
      console.error('[KSEF_NEXT] received sync log insert error', logError);
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error('[KSEF_NEXT] received invoices route error', error);

    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Błąd pobierania faktur otrzymanych',
      },
      { status: 500 }
    );
  }
}