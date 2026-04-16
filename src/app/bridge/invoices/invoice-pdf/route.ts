import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  html: string;
  fileName?: string;
  invoiceId?: string;
  eventId?: string | null;
  createdBy?: string | null;
  previousPdfPath?: string | null;
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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { html, fileName, invoiceId, eventId, createdBy, previousPdfPath } = body;

    if (!html) {
      return NextResponse.json({ error: 'Brak HTML do wygenerowania PDF' }, { status: 400 });
    }

    const browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });

      await page.evaluate(async () => {
        // @ts-ignore
        if (document.fonts?.ready) {
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
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '12mm',
          left: '10mm',
        },
      });

      const base64 = Buffer.from(pdfBuffer).toString('base64');
      const finalFileName = fileName || 'faktura.pdf';

      let storagePath: string | null = null;

      if (invoiceId && eventId) {
        const supabase = getSupabaseAdmin();

        if (previousPdfPath) {
          await supabase.storage.from('event-files').remove([previousPdfPath]).catch(() => {});
          await supabase.from('event_files').delete().eq('file_path', previousPdfPath).catch(() => {});
        }

        const folderId = await getOrCreateInvoiceFolderId({
          supabase,
          eventId,
          createdBy: createdBy ?? null,
        });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const safeName = finalFileName.replace(/\.pdf$/i, '').replace(/[^a-z0-9_-]/gi, '-');
        storagePath = `${eventId}/documents/faktury/${safeName}-${timestamp}.pdf`;

        const upload = await supabase.storage.from('event-files').upload(storagePath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        });

        if (upload.error) {
          console.error('Invoice PDF upload error:', upload.error);
          storagePath = null;
        } else {
          const insertFile = await supabase.from('event_files').insert([
            {
              event_id: eventId,
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
          ]);

          if (insertFile.error) {
            console.error('event_files insert error:', insertFile.error);
          }

          await supabase
            .from('invoices')
            .update({
              pdf_url: storagePath,
              pdf_generated_at: new Date().toISOString(),
            })
            .eq('id', invoiceId);
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
