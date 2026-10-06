import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { buildInvoicePdfHtml } from '@/components/crm/invoices/helpers/buildInvoicePdfHtml';
import { generateKsefInvoiceQrDataUrl } from '@/lib/ksef/qr';
import { resolveInvoiceIssuerName } from '@/lib/invoices/resolveInvoiceIssuerName';
import { resolveInvoicePrintLogo } from '@/lib/invoices/resolveInvoicePrintLogo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  fileName?: string;
  invoiceId?: string;
};

const getSupabaseAdmin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

async function getOrCreateInvoiceFolderId({
  supabase,
  eventId,
  createdBy,
}: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  eventId: string;
  createdBy?: string | null;
}) {
  const rpc = await supabase.rpc('get_or_create_documents_subfolder', {
    p_event_id: eventId,
    p_subfolder_name: 'Faktury',
    p_required_permission: 'invoices_manage',
    p_created_by: createdBy ?? null,
  });

  if (!rpc.error && rpc.data) return rpc.data as string;

  if (rpc.error?.code === '23505') {
    const q = await supabase
      .from('event_folders')
      .select('id')
      .eq('event_id', eventId)
      .eq('name', 'Faktury')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (q.data?.id) return q.data.id as string;
  }

  throw rpc.error || new Error('Nie udalo sie uzyskac folderu Faktury');
}

async function inlineExternalImages(rawHtml: string): Promise<string> {
  const imgRegex = /<img\s+([^>]*?)src="(https?:\/\/[^"]+)"([^>]*?)>/gi;
  let result = rawHtml;
  const matches = Array.from(rawHtml.matchAll(imgRegex));

  for (const match of matches) {
    const fullTag = match[0];
    const url = match[2];
    try {
      const allowedOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
      if (new URL(url).origin !== allowedOrigin) {
        result = result.replace(fullTag, '');
        continue;
      }
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) continue;
      const buf = Buffer.from(await resp.arrayBuffer());
      const contentType = resp.headers.get('content-type') || 'image/png';
      const dataUri = `data:${contentType};base64,${buf.toString('base64')}`;
      result = result.replace(fullTag, fullTag.replace(url, dataUri));
    } catch {
      // skip
    }
  }
  return result;
}

const numberOrZero = (value: unknown) => Number(value ?? 0);

function buildCanonicalPdfHtml(invoice: any, companyLogoUrl: string): string {
  const items = Array.isArray(invoice.invoice_items) ? invoice.invoice_items : [];
  const orderItems = Array.isArray(invoice.invoice_order_items) ? invoice.invoice_order_items : [];
  const settledInvoices = Array.isArray(invoice.settled_invoices)
    ? invoice.settled_invoices.map((settled: any) => ({
        id: settled.id,
        invoiceNumber: settled.invoiceNumber ?? settled.invoice_number ?? '',
        invoiceType: settled.invoiceType ?? settled.invoice_type ?? 'advance',
        issueDate: settled.issueDate ?? settled.issue_date ?? null,
        totalNet: numberOrZero(settled.totalNet ?? settled.total_net),
        totalVat: numberOrZero(settled.totalVat ?? settled.total_vat),
        totalGross: numberOrZero(settled.totalGross ?? settled.total_gross),
      }))
    : [];

  return buildInvoicePdfHtml({
    paymentStatus: invoice.payment_status ?? (invoice.status === 'paid' ? 'paid' : 'unpaid'),
    paidAmount: numberOrZero(invoice.paid_amount),
    paidAt: invoice.paid_at ?? invoice.paid_date ?? null,
    buyerIsPrivatePerson: Boolean(invoice.buyer_is_private_person),
    footerNote: invoice.footer_note ?? '',
    signatureName: invoice.signature_name ?? '',
    showPreviewWatermark: true,
    website: invoice.website ?? null,
    invoiceNumber: invoice.invoice_number,
    invoiceType: invoice.invoice_type === 'proforma' || invoice.is_proforma ? 'proforma' : invoice.invoice_type,
    issueDate: invoice.issue_date,
    saleDate: invoice.sale_date,
    issuePlace: invoice.issue_place ?? '',
    paymentMethod: invoice.payment_method ?? 'Przelew',
    paymentDueDate: invoice.payment_due_date,
    bankAccount: invoice.bank_account ?? '',
    bankName: invoice.bank_name ?? '',
    sellerName: invoice.seller_name ?? '',
    sellerNip: invoice.seller_nip ?? '',
    sellerStreet: invoice.seller_street ?? '',
    sellerCity: invoice.seller_city ?? '',
    sellerPostalCode: invoice.seller_postal_code ?? '',
    buyerName: invoice.buyer_name ?? '',
    buyerNip: invoice.buyer_nip ?? '',
    buyerStreet: invoice.buyer_street ?? '',
    buyerCity: invoice.buyer_city ?? '',
    buyerPostalCode: invoice.buyer_postal_code ?? '',
    totalNet: numberOrZero(invoice.total_net),
    totalVat: numberOrZero(invoice.total_vat),
    totalGross: numberOrZero(invoice.total_gross),
    currencyCode: invoice.currency_code ?? 'PLN',
    companyLogoUrl,
    isProforma: invoice.invoice_type === 'proforma' || Boolean(invoice.is_proforma),
    correctionReason: invoice.correction_reason ?? undefined,
    correctedInvoiceNumber: invoice.corrected_invoice_number ?? undefined,
    correctedInvoiceIssueDate: invoice.corrected_invoice_issue_date ?? undefined,
    items: items.map((item: any, index: number) => ({
      positionNumber: Number(item.position_number ?? index + 1),
      name: item.name ?? '',
      unit: item.unit ?? 'szt.',
      quantity: numberOrZero(item.quantity),
      priceNet: numberOrZero(item.price_net),
      vatRate: numberOrZero(item.vat_rate),
      vatCode: item.vat_code,
      vatExemptionReason: item.vat_exemption_reason ?? null,
      valueNet: numberOrZero(item.value_net),
      vatAmount: numberOrZero(item.vat_amount),
      valueGross: numberOrZero(item.value_gross),
    })),
    invoice_items: items,
    orderItems: orderItems.map((item: any, index: number) => ({
      positionNumber: Number(item.position_number ?? index + 1),
      name: item.name ?? '',
      unit: item.unit ?? 'szt.',
      quantity: numberOrZero(item.quantity),
      priceNet: numberOrZero(item.price_net),
      vatRate: numberOrZero(item.vat_rate),
      vatCode: item.vat_code,
      vatExemptionReason: item.vat_exemption_reason ?? null,
      valueNet: numberOrZero(item.value_net),
      vatAmount: numberOrZero(item.vat_amount),
      valueGross: numberOrZero(item.value_gross),
    })),
    settledInvoices,
    settlementSummary: invoice.settlement_summary ?? undefined,
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { fileName, invoiceId } = body;

    if (!invoiceId) {
      return NextResponse.json({ error: 'Brak danych faktury do wygenerowania PDF' }, { status: 400 });
    }

    const userClient = createSupabaseServerClient(cookies());
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ error: 'Wymagane logowanie.' }, { status: 401 });
    }

    const { data: canManage, error: permissionError } = await userClient.rpc(
      'can_manage_invoice',
      { p_invoice_id: invoiceId },
    );
    if (permissionError || !canManage) {
      return NextResponse.json(
        { error: 'Nie masz uprawnień do generowania faktur.' },
        { status: 403 },
      );
    }

    const { data: employeeByAuth } = await userClient
      .from('employees')
      .select('id')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();
    const { data: employeeByEmail } = employeeByAuth || !authData.user.email
      ? { data: null }
      : await userClient
          .from('employees')
          .select('id')
          .eq('email', authData.user.email)
          .maybeSingle();
    const employee = employeeByAuth ?? employeeByEmail;
    const createdBy = employee?.id ?? null;

    const supabase = getSupabaseAdmin();
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('*,invoice_items(*),invoice_order_items(*)')
      .eq('id', invoiceId)
      .maybeSingle();
    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Nie znaleziono faktury.' }, { status: 404 });
    }

    const issuerName = await resolveInvoiceIssuerName(supabase, invoice);
    if (!issuerName) {
      return NextResponse.json(
        {
          error: 'Nie można ustalić imienia i nazwiska osoby wystawiającej fakturę. Uzupełnij dane wystawiającego w fakturze lub imię i nazwisko jej autora w CRM, a następnie wygeneruj PDF ponownie.',
        },
        { status: 422 },
      );
    }

    const companyLogoUrl = await resolveInvoicePrintLogo(supabase, invoice.my_company_id);
    let htmlWithKsef = buildCanonicalPdfHtml({ ...invoice, signature_name: issuerName }, companyLogoUrl);
    const qrPlaceholder = '<div id="ksef-verification-placeholder"></div>';
    if (invoice.ksef_reference_number && invoice.ksef_status === 'accepted') {
      const [{ data: ksefInvoice }, { data: credentials }] = await Promise.all([
        supabase
          .from('ksef_invoices')
          .select('xml_content,ksef_reference_number,sync_status')
          .eq('invoice_id', invoice.id)
          .eq('ksef_reference_number', invoice.ksef_reference_number)
          .eq('sync_status', 'synced')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('ksef_credentials')
          .select('is_test_environment')
          .eq('my_company_id', invoice.my_company_id)
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (ksefInvoice?.xml_content) {
        const qr = await generateKsefInvoiceQrDataUrl({
          sellerNip: invoice.seller_nip,
          issueDate: invoice.issue_date,
          xmlContent: ksefInvoice.xml_content,
          environment: credentials?.is_test_environment ? 'test' : 'production',
        });
        htmlWithKsef = htmlWithKsef.replace(
          qrPlaceholder,
          `<div class="ksef-verification"><a href="${escapeHtml(qr.verificationUrl)}"><img src="${qr.dataUrl}" alt="Kod weryfikacyjny KSeF" /></a><div class="ksef-label">${escapeHtml(ksefInvoice.ksef_reference_number)}</div></div>`,
        );
      }
    }
    htmlWithKsef = htmlWithKsef.replace(qrPlaceholder, '');

    const html = await inlineExternalImages(htmlWithKsef);

    const browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
    });

    try {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.route('**/*', (route) => route.abort());
      await page.setContent(html, { waitUntil: 'load' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `
          <div style="width:100%;padding:0 10mm;color:#777;font-size:8px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;box-sizing:border-box;">
            <span></span>
            <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
            <span style="text-align:right;white-space:nowrap;">${escapeHtml(invoice.website ?? '')}</span>
          </div>
        `,
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '17mm',
          left: '10mm',
        },
      });

      const base64 = Buffer.from(pdfBuffer).toString('base64');
      const finalFileName = fileName || 'faktura.pdf';

      let storagePath: string | null = null;

      if (invoiceId) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const safeName = finalFileName.replace(/\.pdf$/i, '').replace(/[^a-z0-9_-]/gi, '-');
        let eventFileRowCreated = false;
        let registeredEventFileId: string | null = null;
        let previousEventFile:
          | {
              id: string;
              original_name: string | null;
              file_path: string;
              file_size: number | null;
              mime_type: string | null;
              document_type: string | null;
              thumbnail_url: string | null;
              uploaded_by: string | null;
            }
          | null = null;

        if (invoice.event_id) {
          const folderId = await getOrCreateInvoiceFolderId({
            supabase,
            eventId: invoice.event_id,
            createdBy: createdBy ?? null,
          });

          const existingEventFileResult = await supabase
            .from('event_files')
            .select(
              'id,original_name,file_path,file_size,mime_type,document_type,thumbnail_url,uploaded_by',
            )
            .eq('event_id', invoice.event_id)
            .eq('folder_id', folderId)
            .eq('name', finalFileName)
            .maybeSingle();

          if (existingEventFileResult.error) {
            throw new Error(
              `Nie udało się sprawdzić istniejącego PDF faktury: ${existingEventFileResult.error.message}`,
            );
          }
          previousEventFile = existingEventFileResult.data;

          storagePath = `${invoice.event_id}/documents/faktury/${safeName}-${timestamp}.pdf`;

          const upload = await supabase.storage.from('event-files').upload(storagePath, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: true,
          });

          if (upload.error) {
            throw new Error(`Nie udało się zapisać PDF faktury: ${upload.error.message}`);
          } else {
            const eventFileRegistration = await supabase
              .from('event_files')
              .upsert(
                {
                  event_id: invoice.event_id,
                  folder_id: folderId,
                  name: finalFileName,
                  original_name: finalFileName,
                  file_path: storagePath,
                  file_size: pdfBuffer.byteLength,
                  mime_type: 'application/pdf',
                  document_type: 'invoice',
                  thumbnail_url: null,
                  uploaded_by: createdBy ?? null,
                },
                { onConflict: 'event_id,folder_id,name' },
              )
              .select('id')
              .single();

            if (eventFileRegistration.error) {
              await supabase.storage.from('event-files').remove([storagePath]);
              throw new Error(
                `Nie udało się zarejestrować PDF w dokumentach wydarzenia: ${eventFileRegistration.error.message}`,
              );
            }
            registeredEventFileId = eventFileRegistration.data.id;
            eventFileRowCreated = !previousEventFile;
          }
        } else {
          const ownerSegment = invoice.organization_id || invoice.buyer_contact_id || 'general';
          storagePath = `invoices/${ownerSegment}/${safeName}-${timestamp}.pdf`;

          const upload = await supabase.storage.from('event-files').upload(storagePath, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: true,
          });

          if (upload.error) {
            throw new Error(`Nie udało się zapisać PDF faktury: ${upload.error.message}`);
          }
        }

        if (storagePath) {
          const invoiceUpdate = await supabase
            .from('invoices')
            .update({
              pdf_url: storagePath,
              pdf_generated_at: new Date().toISOString(),
            })
            .eq('id', invoiceId);
          if (invoiceUpdate.error) {
            await supabase.storage.from('event-files').remove([storagePath]);
            if (eventFileRowCreated && registeredEventFileId) {
              await supabase.from('event_files').delete().eq('id', registeredEventFileId);
            } else if (previousEventFile) {
              await supabase
                .from('event_files')
                .update({
                  original_name: previousEventFile.original_name,
                  file_path: previousEventFile.file_path,
                  file_size: previousEventFile.file_size,
                  mime_type: previousEventFile.mime_type,
                  document_type: previousEventFile.document_type,
                  thumbnail_url: previousEventFile.thumbnail_url,
                  uploaded_by: previousEventFile.uploaded_by,
                })
                .eq('id', previousEventFile.id);
            }
            throw new Error(`Nie udało się powiązać PDF z fakturą: ${invoiceUpdate.error.message}`);
          }

          const previousPdfPath = invoice.pdf_url;
          if (previousPdfPath && previousPdfPath !== storagePath) {
            await supabase.storage.from('event-files').remove([previousPdfPath]);
            const staleFileQuery = supabase
              .from('event_files')
              .delete()
              .eq('file_path', previousPdfPath);
            if (registeredEventFileId) {
              await staleFileQuery.neq('id', registeredEventFileId);
            } else {
              await staleFileQuery;
            }
          }
        }
      }

      return NextResponse.json({
        ok: true,
        base64,
        filename: finalFileName,
        contentType: 'application/pdf',
        storagePath,
      });
    } finally {
      await browser.close();
    }
  } catch (e: any) {
    console.error('Invoice PDF generate API error:', e);
    return NextResponse.json({ error: e?.message || 'Blad generowania PDF' }, { status: 500 });
  }
}
