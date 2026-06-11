import { NextResponse } from 'next/server';
import { getCredentials, supabase } from '@/lib/ksef/db';
import { getKSeFInvoices, getKSeFInvoiceXml } from '../../client';
import { parsePaymentData } from '../../parsePaymentData';
import { parseFA3InvoiceXml } from '../../parseInvoiceXml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const normalizeDate = (value: any): string | null => {
  if (!value) return null;

  const raw = String(value).trim();

  const xmlMatch = raw.match(/>(\d{4}-\d{2}-\d{2})</);
  if (xmlMatch) return xmlMatch[1];

  const dateMatch = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (dateMatch) return dateMatch[0];

  return null;
};

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
    let newCount = 0;
    let skippedCount = 0;

    if (invoices.length > 0) {
      // Collect all ksef_reference_numbers from the fetched batch
      const allKsefRefs = invoices
        .map((inv: any) =>
          inv.ksefNumber ||
          inv.ksefReferenceNumber ||
          inv.ksef_reference_number ||
          inv.referenceNumber
        )
        .filter(Boolean);

      // Check which invoices already exist in DB - skip those to avoid overwriting payment status
      const { data: existingInvoices } = await supabase
        .from('ksef_invoices')
        .select('ksef_reference_number')
        .in('ksef_reference_number', allKsefRefs);

      const existingRefs = new Set(
        (existingInvoices || []).map((e: any) => e.ksef_reference_number)
      );

      const rows = [];

      for (const inv of invoices) {
        const ksefRef =
          inv.ksefNumber ||
          inv.ksefReferenceNumber ||
          inv.ksef_reference_number ||
          inv.referenceNumber;

        if (!ksefRef) continue;

        // Skip invoices that already exist in DB to preserve their payment status
        if (existingRefs.has(ksefRef)) continue;

        // Fetch full invoice XML for complete data
        let xmlContent = '';
        let parsed: ReturnType<typeof parseFA3InvoiceXml> = null;
        try {
          xmlContent = await getKSeFInvoiceXml(
            ksefRef,
            credentials.access_token,
            credentials.is_test_environment,
            { stage: 'invoice-xml-fetch', companyId, ksefRef },
          );
          parsed = parseFA3InvoiceXml(xmlContent);
        } catch (e: any) {
          console.error(`[KSEF_NEXT] failed to fetch XML for ${ksefRef}:`, e?.message);
        }

        const paymentMethod =
          parsed?.payment_method ||
          inv.paymentMethod ||
          inv.payment_method ||
          inv.FormaPlatnosci ||
          null;

        const bankAccountNumber =
          parsed?.bank_account_number ||
          inv.bankAccountNumber ||
          inv.bank_account_number ||
          null;

          const paymentDueDate = normalizeDate(
            parsed?.payment_due_date ||
              inv.paymentDueDate ||
              inv.payment_due_date ||
              inv.TerminPlatnosci ||
              inv.terminPlatnosci ||
              inv.dueDate ||
              inv.PaymentDueDate
          );
          
          const issueDate = normalizeDate(
            parsed?.issue_date || inv.issueDate
          );
          
          const paymentDate = normalizeDate(
            parsed?.payment_date
          );

        // Determine payment status
        const paymentData = parsePaymentData({
          ...inv,
          paymentMethod,
          paymentDueDate,
          paymentDate,
          bankAccountNumber,
        });

        // For immediate payment methods (cash/card), set payment_date to issue_date
        const effectivePaymentDate =
          paymentDate ||
          (paymentData.payment_status === 'paid' && (paymentMethod === '1' || paymentMethod === '2')
            ? (parsed?.issue_date || inv.issueDate || new Date().toISOString().split('T')[0])
            : null);

        // VAT rate from items
        let vatRate: string | null = null;
        if (parsed?.invoice_items && parsed.invoice_items.length > 0) {
          vatRate = parsed.invoice_items[0].vat_rate
            ? `${parsed.invoice_items[0].vat_rate}%`
            : null;
        } else if (inv.vatRate) {
          vatRate = typeof inv.vatRate === 'number' ? `${inv.vatRate}%` : inv.vatRate;
        }

        if (
          String(paymentDueDate || '').includes('<Termin') ||
          String(parsed?.payment_due_date || '').includes('<Termin')
        ) {
          console.error('[KSEF DEBUG DATE]', {
            ksefRef,
            parsedPaymentDueDate: parsed?.payment_due_date,
            paymentDueDate,
            issueDate: parsed?.issue_date,
            rawInv: {
              paymentDueDate: inv.paymentDueDate,
              payment_due_date: inv.payment_due_date,
              TerminPlatnosci: inv.TerminPlatnosci,
              terminPlatnosci: inv.terminPlatnosci,
              dueDate: inv.dueDate,
              PaymentDueDate: inv.PaymentDueDate,
            },
          });
        }

        rows.push({
          ksef_reference_number: ksefRef,
          my_company_id: companyId,
          invoice_number: parsed?.invoice_number || inv.invoiceNumber || null,
          invoice_type: 'received',
          seller_name: parsed?.seller_name || inv.seller?.name || null,
          seller_nip: parsed?.seller_nip || inv.seller?.nip || null,
          seller_address: parsed?.seller_address || null,
          buyer_name: parsed?.buyer_name || inv.buyer?.name || null,
          buyer_nip: parsed?.buyer_nip || (inv.buyer?.identifier?.type === 'Nip' ? inv.buyer?.identifier?.value : null) || null,
          buyer_address: parsed?.buyer_address || null,
          net_amount: parsed?.net_amount ?? inv.netAmount ?? null,
          gross_amount: parsed?.gross_amount ?? inv.grossAmount ?? null,
          vat_amount: parsed?.vat_amount ?? inv.vatAmount ?? null,
          vat_rate: vatRate,
          invoice_items: parsed?.invoice_items && parsed.invoice_items.length > 0
            ? parsed.invoice_items
            : inv.items || inv.invoiceItems || null,
          currency: parsed?.currency || inv.currency || 'PLN',
          issue_date: issueDate,
          payment_due_date: paymentDueDate,
          payment_date: effectivePaymentDate,
          payment_method: paymentMethod,
          bank_account_number: bankAccountNumber,
          payment_status: paymentData.payment_status,
          xml_content: xmlContent,
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
        });
      }

      if (rows.length > 0) {
        const { error: insertError } = await supabase
          .from('ksef_invoices')
          .insert(rows);

        if (insertError) {
          console.error('[KSEF_NEXT] received invoices insert error', insertError);

          return NextResponse.json(
            {
              success: false,
              error: insertError.message || 'Błąd zapisu faktur do bazy',
            },
            { status: 500 }
          );
        }
      }

      newCount = rows.length;
      skippedCount = existingRefs.size;
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
      data: {
        ...data,
        newCount,
        skippedCount,
      },
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
