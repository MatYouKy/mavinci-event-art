import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildInvoicePrintDocument, INVOICE_PRINT_SELECT, renderInvoicePdf } from './renderInvoicePdf.server';

/*
 * „Generuj PDF” faktury — wspólne dla trasy CRM `/bridge/invoices/invoice-pdf` (przeglądarka) i aplikacji na Maca
 * (`src/lib/native/finance.ts`): wydruk z danych zapisanych na fakturze (ten sam szablon co podgląd), zapis w magazynie
 * `event-files` (faktura wydarzenia — folder „Faktury” w dokumentach wydarzenia, z wpisem w `event_files`), powiązanie
 * z fakturą (`pdf_url`, `pdf_generated_at`) i usunięcie poprzedniego pliku. Przy błędzie zapisu wszystko jest cofane.
 * Klient `admin` (klucz serwisowy) — uprawnienie `can_manage_invoice` sprawdza wywołujący, tokenem pracownika.
 */

type AdminClient = SupabaseClient<any, any, any>;

export class StoredInvoicePdfError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

async function getOrCreateInvoiceFolderId({
  supabase,
  eventId,
  createdBy,
}: {
  supabase: AdminClient;
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

/** PDF faktury zapisany w magazynie i powiązany z fakturą; `base64` — ten sam plik do pobrania lub załącznika. */
export async function generateStoredInvoicePdf(
  supabase: AdminClient,
  { invoiceId, fileName, createdBy }: { invoiceId: string; fileName?: string | null; createdBy?: string | null },
): Promise<{ base64: string; filename: string; storagePath: string | null }> {
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select(INVOICE_PRINT_SELECT)
    .eq('id', invoiceId)
    .maybeSingle();
  if (invoiceError || !invoice) throw new StoredInvoicePdfError('Nie znaleziono faktury.', 404);

  // Ten sam wydruk co podgląd (`/bridge/invoices/invoice-pdf/preview`): wspólny szablon i renderer.
  const printDocument = await buildInvoicePrintDocument(supabase as any, invoice as any);
  const { pdf: pdfBuffer } = await renderInvoicePdf(printDocument);

  const base64 = Buffer.from(pdfBuffer).toString('base64');
  const finalFileName = fileName || 'faktura.pdf';

  let storagePath: string | null = null;

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

  return { base64, filename: finalFileName, storagePath };
}
