import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { buildContractHtml } from '@/app/(crm)/crm/events/[id]/helpers/buildContractHtml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  eventId: string;
  contractId: string;
  pagesHtml: string;
  cssText: string;
  baseUrl: string;
  fileName?: string; // opcjonalnie
  createdBy?: string | null;
};

const getSupabaseAdmin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
};

async function getOrCreateUmowyFolderId({
  supabase,
  eventId,
  createdBy,
}: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { eventId, contractId, pagesHtml, cssText, fileName, createdBy } = body;

    if (!eventId || !contractId || !pagesHtml || !cssText) {
      return NextResponse.json({ error: 'Brak wymaganych danych' }, { status: 400 });
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      'http://localhost:3000';

    const html = buildContractHtml({
      pagesHtml,
      cssText,
      baseUrl,
      title: `Umowa ${contractId}`,
    });

    // --- Playwright: render PDF jak "drukuj" ---
    const browser = await chromium.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--font-render-hinting=medium',
      ],
    });

    try {
      const page = await browser.newPage();

      await page.setContent(html, { waitUntil: 'networkidle' });

      // Czekamy na fonty/obrazy
      await page.evaluate(async () => {
        // @ts-ignore
        if (document.fonts && document.fonts.ready) {
          // @ts-ignore
          await document.fonts.ready;
        }
        const imgs = Array.from(document.images || []);
        await Promise.all(
          imgs.map(
            (img) =>
              new Promise<void>((resolve) => {
                if (img.complete) return resolve();
                img.onload = () => resolve();
                img.onerror = () => resolve();
              }),
          ),
        );
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
        preferCSSPageSize: true,
      });

      // --- Upload do Supabase ---
      const supabase = getSupabaseAdmin();

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const finalFileName = fileName || `umowa-${timestamp}.pdf`;
      const storagePath = `${eventId}/${finalFileName}`;

      const upload = await supabase.storage.from('event-files').upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false,
      });

      if (upload.error) {
        return NextResponse.json({ error: upload.error.message }, { status: 500 });
      }

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
          file_size: pdfBuffer.byteLength,
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

      return NextResponse.json({
        ok: true,
        storagePath,
        fileName: finalFileName,
      });
    } finally {
      await browser.close();
    }
  } catch (e: any) {
    console.error('PDF generate API error:', e);
    return NextResponse.json({ error: e?.message || 'Błąd generowania PDF' }, { status: 500 });
  }
}