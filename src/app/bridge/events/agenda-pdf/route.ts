import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { buildAgendaHtml } from '@/app/(crm)/crm/events/[id]/helpers/buildAgendaPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  eventId: string;
  agendaId: string;
  eventName: string;
  fileName?: string;
  htmlPayload: {
    eventName: string;
    eventDate: string;
    startTime: string;
    endTime: string;
    clientContact: string;
    contactName: string;
    contactNumber: string;
    agendaItems: any[];
    agendaNotes: any[];
    lastUpdated: string;
    authorName: string;
    authorNumber: string;
    companyLogoUrl?: string | null;
    company?: any;
    contactPerson?: {
      name: string;
      email?: string | null;
      phone?: string | null;
    } | null;
    preparedBy?: {
      name: string;
      email?: string | null;
      phone?: string | null;
    } | null;
  };
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

async function getOrCreateAgendaFolderId({
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
    p_subfolder_name: 'Agenda',
    p_required_permission: 'events_manage',
    p_created_by: createdBy ?? null,
  });

  if (!rpc.error && rpc.data) return rpc.data as string;

  if (rpc.error?.code === '23505') {
    const q = await supabase
      .from('event_folders')
      .select('id')
      .eq('event_id', eventId)
      .eq('name', 'Agenda')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (q.data?.id) return q.data.id as string;
  }

  throw rpc.error || new Error('Nie udało się uzyskać folderu Agenda');
}

export async function POST(req: Request) {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    const body = (await req.json()) as Body;
    const { eventId, agendaId, htmlPayload, eventName, fileName, createdBy, previousPdfPath } = body;

    if (!eventId || !agendaId || !htmlPayload) {
      return NextResponse.json({ error: 'Brak wymaganych danych' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const enrichedPayload = { ...htmlPayload };

    if (!enrichedPayload.preparedBy && createdBy) {
      const { data: employee, error: employeeError } = await supabase
        .from('employees')
        .select('name, surname, email, phone_number')
        .eq('auth_user_id', createdBy)
        .maybeSingle();

      if (employeeError) {
        console.error('employee fetch error:', employeeError);
      }

      if (employee) {
        enrichedPayload.preparedBy = {
          name:
            [employee.name, employee.surname].filter(Boolean).join(' ') ||
            employee.email ||
            'Nieznany użytkownik',
          email: employee.email ?? null,
          phone: employee.phone_number ?? null,
        };
      }
    }

    const html = buildAgendaHtml(enrichedPayload);

    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });

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
      margin: { top: '10mm', right: '10mm', bottom: '20mm', left: '10mm' },
    });

    if (previousPdfPath) {
      await supabase.storage.from('event-files').remove([previousPdfPath]);
      await supabase.from('event_files').delete().eq('file_path', previousPdfPath);
    }

    const folderId = await getOrCreateAgendaFolderId({
      supabase,
      eventId,
      createdBy: createdBy ?? null,
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const safeEventName = (eventName || htmlPayload.eventName || 'agenda')
      .replace(/[^a-z0-9]/gi, '-')
      .toLowerCase();

    const finalFileName = fileName || `agenda-${safeEventName}-${timestamp}.pdf`;

    const storagePath = `${eventId}/documents/agenda/${finalFileName}`;

    const upload = await supabase.storage.from('event-files').upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    });

    if (upload.error) {
      return NextResponse.json({ error: upload.error.message }, { status: 500 });
    }

    const insertFile = await supabase.from('event_files').insert([
      {
        event_id: eventId,
        folder_id: folderId,
        name: finalFileName,
        original_name: finalFileName,
        file_path: storagePath,
        file_size: pdfBuffer.byteLength,
        mime_type: 'application/pdf',
        document_type: 'agenda',
        thumbnail_url: null,
        uploaded_by: createdBy ?? null,
      },
    ]);

    if (insertFile.error) {
      console.error('event_files insert error:', insertFile.error);
    }

    const upd = await supabase
      .from('event_agendas')
      .update({
        generated_pdf_path: storagePath,
        generated_pdf_at: new Date().toISOString(),
        modified_after_generation: false,
      })
      .eq('id', agendaId);

    if (upd.error) {
      console.error('event_agendas update error:', upd.error);
    }

    return NextResponse.json({
      ok: true,
      storagePath,
      fileName: finalFileName,
    });
  } catch (e: any) {
    console.error('Agenda PDF generate API error:', e);
    return NextResponse.json({ error: e?.message || 'Błąd generowania PDF' }, { status: 500 });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}