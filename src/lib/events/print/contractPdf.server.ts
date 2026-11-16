import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildContractHtml } from '@/app/(crm)/crm/events/[id]/helpers/buildContractHtml';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { trustedPrintHosts, type PrintJob } from '@/lib/print/printJob.server';

/*
 * PDF umowy wydarzenia — wspólne dla „Generuj PDF” w CRM (`/bridge/events/contracts/generate`) i na Macu
 * (`/bridge/events/contract-pdf`): ten sam HTML stron (`buildContractHtml`), te same ustawienia wydruku i ten sam zapis —
 * plik w `event-files`, wpis w folderze „Umowy” wydarzenia i ścieżka PDF w umowie.
 */

type AdminClient = SupabaseClient;

export const contractPdfBaseUrl = () =>
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'http://localhost:3000';

/** Opcje `page.pdf()` jak w „Generuj PDF”. */
export const CONTRACT_PDF_OPTIONS = {
  format: 'A4' as const,
  printBackground: true,
  margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
  preferCSSPageSize: true,
};

export const contractPdfFileName = () => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  return `umowa-${timestamp}.pdf`;
};

/** Zadanie wydruku dla Maca: strony umowy jak w CRM, czekanie na fonty i obrazy, sieć do hostów CRM, plików i fontów. */
export function contractPrintJob(input: { contractId: string; pagesHtml: string; cssText: string; finalize: boolean }): PrintJob {
  const baseUrl = contractPdfBaseUrl();
  return {
    version: 1,
    html: buildContractHtml({ pagesHtml: input.pagesHtml, cssText: input.cssText, baseUrl, title: `Umowa ${input.contractId}` }),
    fontsMarker: null,
    javascript: true,
    network: 'trusted',
    allowedHosts: trustedPrintHosts([baseUrl]),
    waitUntil: 'networkidle',
    waitForAssets: true,
    emulatePrintMedia: false,
    pdf: CONTRACT_PDF_OPTIONS,
    fileName: contractPdfFileName(),
    finalize: input.finalize,
  };
}

async function getOrCreateUmowyFolderId({
  supabase,
  eventId,
  createdBy,
}: {
  supabase: AdminClient;
  eventId: string;
  createdBy?: string | null;
}) {
  // 1) Spróbuj RPC (jeśli działa poprawnie)
  const rpc = await supabase.rpc('get_or_create_documents_subfolder', {
    p_event_id: eventId,
    p_subfolder_name: 'Umowy',
    p_required_permission: 'contracts_manage',
    p_created_by: createdBy ?? null,
  });

  if (!rpc.error && rpc.data) return rpc.data as string;

  // 2) Jeśli RPC wali 23505 -> folder już jest, więc go pobierz
  if (rpc.error?.code === '23505') {
    const q = await supabase
      .from('event_folders')
      .select('id')
      .eq('event_id', eventId)
      .eq('name', 'Umowy')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (q.data?.id) return q.data.id as string;
  }

  // 3) Jak RPC jest zepsute lub brak tabeli itd.
  throw rpc.error || new Error('Nie udało się uzyskać folderu Umowy');
}

/** Zapis PDF umowy: plik w `event-files`, wpis w folderze „Umowy”, `generated_pdf_path` w umowie (jak „Generuj PDF”). */
export async function storeContractPdf({
  eventId,
  contractId,
  pdf,
  fileName,
  createdBy,
}: {
  eventId: string;
  contractId: string;
  pdf: Buffer;
  fileName?: string;
  createdBy?: string | null;
}) {
  const supabase = createSupabaseAdminClient();

  const finalFileName = fileName || contractPdfFileName();
  const storagePath = `${eventId}/${finalFileName}`;

  const upload = await supabase.storage.from('event-files').upload(storagePath, pdf, {
    contentType: 'application/pdf',
    upsert: false,
  });

  if (upload.error) throw new Error(upload.error.message);

  const folderId = await getOrCreateUmowyFolderId({
    supabase,
    eventId,
    createdBy: createdBy ?? null,
  });

  const insertFile = await supabase.from('event_files').insert([
    {
      event_id: eventId,
      folder_id: folderId,
      name: finalFileName,
      original_name: finalFileName,
      file_path: storagePath,
      file_size: pdf.byteLength,
      mime_type: 'application/pdf',
      document_type: 'contract',
      thumbnail_url: null,
      uploaded_by: createdBy ?? null,
    },
  ]);

  if (insertFile.error) {
    // jeśli upload poszedł, a insert nie — chociaż loguj
    console.error('event_files insert error:', insertFile.error);
  }

  const upd = await supabase
    .from('contracts')
    .update({
      generated_pdf_path: storagePath,
      generated_pdf_at: new Date().toISOString(),
      modified_after_generation: false,
    })
    .eq('id', contractId);

  if (upd.error) {
    console.error('contracts update error:', upd.error);
  }

  return { storagePath, fileName: finalFileName };
}
