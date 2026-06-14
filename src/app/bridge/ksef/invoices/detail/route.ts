import { NextResponse } from 'next/server';
import { getCredentials, supabase } from '@/lib/ksef/db';
import { getKSeFInvoiceXml } from '../../client';
import { parseFA3InvoiceXml } from '../../parseInvoiceXml';
import { parsePaymentData } from '../../parsePaymentData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const invoiceId = typeof body?.invoiceId === 'string' ? body.invoiceId.trim() : '';
    const ksefRef = typeof body?.ksefReferenceNumber === 'string' ? body.ksefReferenceNumber.trim() : '';

    if (!invoiceId && !ksefRef) {
      return NextResponse.json(
        { success: false, error: 'Brak invoiceId lub ksefReferenceNumber' },
        { status: 400 }
      );
    }

    const { data: invoiceRow, error: fetchErr } = await supabase
      .from('ksef_invoices')
      .select('*')
      .eq(invoiceId ? 'id' : 'ksef_reference_number', invoiceId || ksefRef)
      .maybeSingle();

    if (fetchErr || !invoiceRow) {
      return NextResponse.json(
        { success: false, error: 'Faktura nie znaleziona w bazie' },
        { status: 404 }
      );
    }

    if (invoiceRow.xml_content && invoiceRow.xml_content.length > 100 && invoiceRow.invoice_items) {
      const parsed = parseFA3InvoiceXml(invoiceRow.xml_content);
      return NextResponse.json({
        success: true,
        invoice: invoiceRow,
        parsed,
        source: 'cache',
      });
    }

    if (!invoiceRow.my_company_id) {
      return NextResponse.json(
        { success: false, error: 'Brak powiązanej firmy (my_company_id)' },
        { status: 400 }
      );
    }

    const credentials = await getCredentials(invoiceRow.my_company_id);

    if (!credentials?.access_token) {
      return NextResponse.json(
        { success: false, error: 'Brak aktywnego tokenu KSeF dla tej firmy' },
        { status: 400 }
      );
    }

    const refNumber = invoiceRow.ksef_reference_number;
    let xmlContent = '';
    try {
      xmlContent = await getKSeFInvoiceXml(
        refNumber,
        credentials.access_token,
        credentials.is_test_environment,
        { stage: 'invoice-detail-fetch', invoiceId: invoiceRow.id, ksefRef: refNumber },
      );
    } catch (e: any) {
      return NextResponse.json({
        success: true,
        invoice: invoiceRow,
        parsed: null,
        source: 'ksef_unavailable',
        error: `Nie udało się pobrać XML z KSeF: ${e?.message}`,
      });
    }

    const parsed = parseFA3InvoiceXml(xmlContent);

    if (!parsed) {
      return NextResponse.json({
        success: true,
        invoice: invoiceRow,
        parsed: null,
        source: 'xml_unparseable',
        xml_length: xmlContent.length,
      });
    }

    const paymentDueDate = parsed.payment_due_date || invoiceRow.payment_due_date || null;
    const paymentMethod = parsed.payment_method || invoiceRow.payment_method || null;
    const bankAccountNumber = parsed.bank_account_number || invoiceRow.bank_account_number || null;

    const paymentData = parsePaymentData({
      paymentMethod,
      paymentDueDate,
      paymentDate: parsed.payment_date,
      grossAmount: parsed.gross_amount ?? invoiceRow.gross_amount,
    });

    // Preserve user-set payment_status and payment_date (don't overwrite manual changes)
    const userSetPaid = invoiceRow.payment_status === 'paid' && invoiceRow.payment_date;

    const updateData: Record<string, any> = {
      xml_content: xmlContent,
      seller_address: parsed.seller_address || invoiceRow.seller_address || null,
      buyer_address: parsed.buyer_address || invoiceRow.buyer_address || null,
      payment_due_date: paymentDueDate,
      payment_method: paymentMethod,
      bank_account_number: bankAccountNumber,
      invoice_items: parsed.invoice_items && parsed.invoice_items.length > 0
        ? parsed.invoice_items
        : invoiceRow.invoice_items || null,
    };

    // Only update payment_status/payment_date if user hasn't manually marked as paid
    if (!userSetPaid) {
      updateData.payment_status = paymentData.payment_status;
      // For card/cash payments (methods 1, 2), set payment_date
      if (paymentData.payment_status === 'paid' && (paymentMethod === '1' || paymentMethod === '2')) {
        updateData.payment_date = paymentDueDate || parsed.issue_date || invoiceRow.issue_date || null;
      }
    }

    if (parsed.seller_name && !invoiceRow.seller_name) {
      updateData.seller_name = parsed.seller_name;
    }
    if (parsed.seller_nip && !invoiceRow.seller_nip) {
      updateData.seller_nip = parsed.seller_nip;
    }
    if (parsed.buyer_name && !invoiceRow.buyer_name) {
      updateData.buyer_name = parsed.buyer_name;
    }
    if (parsed.buyer_nip && !invoiceRow.buyer_nip) {
      updateData.buyer_nip = parsed.buyer_nip;
    }
    if (parsed.invoice_number && !invoiceRow.invoice_number) {
      updateData.invoice_number = parsed.invoice_number;
    }
    if (parsed.net_amount != null && invoiceRow.net_amount == null) {
      updateData.net_amount = parsed.net_amount;
    }
    if (parsed.gross_amount != null && invoiceRow.gross_amount == null) {
      updateData.gross_amount = parsed.gross_amount;
    }
    if (parsed.vat_amount != null && invoiceRow.vat_amount == null) {
      updateData.vat_amount = parsed.vat_amount;
    }

    const { error: updateErr } = await supabase
      .from('ksef_invoices')
      .update(updateData)
      .eq('id', invoiceRow.id);

    if (updateErr) {
      console.error('[KSEF_DETAIL] update error', updateErr);
    }

    const updatedInvoice = { ...invoiceRow, ...updateData };

    return NextResponse.json({
      success: true,
      invoice: updatedInvoice,
      parsed,
      source: 'ksef_api',
    });
  } catch (error: any) {
    console.error('[KSEF_DETAIL] route error', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Błąd pobierania szczegółów faktury' },
      { status: 500 }
    );
  }
}
