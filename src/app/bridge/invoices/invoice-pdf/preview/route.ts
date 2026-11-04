import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import {
  buildInvoicePrintDocument,
  INVOICE_PRINT_SELECT,
  InvoicePrintError,
  invoicePrintRevision,
  renderInvoicePdf,
} from '@/lib/invoices/print/renderInvoicePdf.server';
import { invoicePdfFileName, isProformaInvoiceRow } from '@/lib/invoices/print/invoicePrintData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Podgląd wydruku faktury: aktualny PDF z danych faktury, bez zapisu.
 * Dostęp jak do samej faktury (RLS na `invoices`) — kto widzi fakturę, widzi jej wydruk.
 * `?download=1` — ten sam plik jako załącznik do pobrania.
 * Przeglądarka CRM loguje się ciasteczkiem; aplikacje natywne (macOS, mobile) mogą wysłać
 * `Authorization: Bearer <token sesji Supabase>` — obowiązuje ten sam RLS konta.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const invoiceId = url.searchParams.get('invoiceId') || '';
  const download = url.searchParams.get('download') === '1';
  if (!UUID.test(invoiceId)) {
    return NextResponse.json({ error: 'Nieprawidłowy identyfikator faktury.' }, { status: 400 });
  }

  try {
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '')?.[1]?.trim();
    const userClient = bearer
      ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${bearer}` } },
        })
      : createSupabaseServerClient(cookies());
    const { data: authData } = bearer ? await userClient.auth.getUser(bearer) : await userClient.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ error: 'Sesja wygasła. Zaloguj się ponownie.' }, { status: 401 });
    }

    const { data: visible, error: visibleError } = await userClient
      .from('invoices')
      .select('id')
      .eq('id', invoiceId)
      .maybeSingle();
    if (visibleError || !visible) {
      return NextResponse.json({ error: 'Nie znaleziono faktury albo nie masz do niej dostępu.' }, { status: 404 });
    }

    const admin = createSupabaseAdminClient();
    const { data: invoice, error } = await admin
      .from('invoices')
      .select(INVOICE_PRINT_SELECT)
      .eq('id', invoiceId)
      .maybeSingle();
    if (error || !invoice) {
      return NextResponse.json({ error: 'Nie znaleziono faktury.' }, { status: 404 });
    }

    const document = await buildInvoicePrintDocument(admin, invoice);
    const { pdf, pageCount } = await renderInvoicePdf(document);
    const fileName = invoicePdfFileName(invoice.invoice_number, isProformaInvoiceRow(invoice));

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.byteLength),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Pdf-Pages': String(pageCount),
        'X-Invoice-Print-Revision': encodeURIComponent(invoicePrintRevision(invoice)),
      },
    });
  } catch (e) {
    const status = e instanceof InvoicePrintError ? e.status : 500;
    if (status >= 500) console.error('Invoice PDF preview error:', e);
    return NextResponse.json(
      { error: e instanceof Error && status < 500 ? e.message : 'Nie udało się przygotować wydruku faktury. Spróbuj ponownie.' },
      { status },
    );
  }
}
