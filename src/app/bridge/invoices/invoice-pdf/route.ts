import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import {
  buildInvoicePrintDocument,
  INVOICE_PRINT_SELECT,
  InvoicePrintError,
  renderInvoicePdf,
} from '@/lib/invoices/print/renderInvoicePdf.server';

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
    // Folder widoczny według poziomu finansów działalności wydarzenia (public.event_folder_permission_allows).
    p_required_permission: 'finance:invoices',
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
      .select(INVOICE_PRINT_SELECT)
      .eq('id', invoiceId)
      .maybeSingle();
    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Nie znaleziono faktury.' }, { status: 404 });
    }

    // Ten sam wydruk co podgląd (`/bridge/invoices/invoice-pdf/preview`): wspólny szablon i renderer.
    const printDocument = await buildInvoicePrintDocument(supabase, invoice);
    const { pdf: pdfBuffer } = await renderInvoicePdf(printDocument);

    {
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
    }
  } catch (e: any) {
    if (e instanceof InvoicePrintError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error('Invoice PDF generate API error:', e);
    return NextResponse.json({ error: e?.message || 'Błąd generowania PDF' }, { status: 500 });
  }
}
