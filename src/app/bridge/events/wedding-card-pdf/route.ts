import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import {
  buildWeddingCardPdfHtml,
  type WeddingCardPdfAnswer,
  type WeddingCardPdfAttraction,
  type WeddingCardPdfPerson,
  type WeddingCardPdfScheduleItem,
  type WeddingCardPdfTrack,
} from '@/app/(crm)/crm/events/[id]/helpers/buildWeddingCardPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = { eventId?: string };

const getSupabaseAdmin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const safeFilePart = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

async function getWeddingCardFolderId({
  supabase,
  eventId,
  createdBy,
}: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  eventId: string;
  createdBy: string | null;
}) {
  const rpc = await supabase.rpc('get_or_create_documents_subfolder', {
    p_event_id: eventId,
    p_subfolder_name: 'Karta weselna',
    p_required_permission: 'events_manage',
    p_created_by: createdBy,
  });
  if (!rpc.error && rpc.data) return rpc.data as string;

  const existing = await supabase
    .from('event_folders')
    .select('id')
    .eq('event_id', eventId)
    .eq('name', 'Karta weselna')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.data?.id) return existing.data.id as string;

  throw rpc.error || existing.error || new Error('Nie udało się utworzyć folderu Karta weselna.');
}

export async function POST(request: Request) {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    const { eventId } = (await request.json()) as Body;
    if (!eventId) {
      return NextResponse.json({ error: 'Brak identyfikatora wydarzenia.' }, { status: 400 });
    }

    const userClient = createSupabaseServerClient(cookies());
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ error: 'Wymagane logowanie.' }, { status: 401 });
    }

    const { data: canManage, error: permissionError } = await userClient.rpc(
      'can_manage_event_workflows',
      { p_event_id: eventId },
    );
    if (permissionError || !canManage) {
      return NextResponse.json(
        { error: 'Nie masz uprawnień do wygenerowania Karty Weselnej.' },
        { status: 403 },
      );
    }

    const admin = getSupabaseAdmin();
    const [eventResult, cardResult, employeeResult] = await Promise.all([
      admin
        .from('events')
        .select(
          'id,name,event_date,event_end_date,location,location_id,organization_id,contact_person_id',
        )
        .eq('id', eventId)
        .maybeSingle(),
      admin
        .from('wedding_cards')
        .select('id,status,progress,updated_at')
        .eq('event_id', eventId)
        .maybeSingle(),
      userClient.rpc('current_workflow_employee_id'),
    ]);

    if (eventResult.error || !eventResult.data) {
      return NextResponse.json({ error: 'Nie znaleziono wydarzenia.' }, { status: 404 });
    }
    if (cardResult.error || !cardResult.data) {
      return NextResponse.json(
        { error: 'Karta Weselna nie została jeszcze utworzona.' },
        { status: 404 },
      );
    }

    const event = eventResult.data;
    const card = cardResult.data;
    const [answersResult, peopleResult, scheduleResult, tracksResult, attractionsResult, locationResult, organizationResult, contactResult] =
      await Promise.all([
        admin
          .from('wedding_card_answers')
          .select('section,field_key,value')
          .eq('wedding_card_id', card.id),
        admin
          .from('wedding_card_people')
          .select(
            'side,role,first_name,last_name,phone,email,instagram_handle,instagram_tag_consent,notes,sort_order',
          )
          .eq('wedding_card_id', card.id)
          .order('side')
          .order('sort_order'),
        admin
          .from('wedding_schedule_items')
          .select(
            'title,scheduled_at,category,location,responsible_person,notes,is_confirmed,sort_order',
          )
          .eq('wedding_card_id', card.id)
          .order('scheduled_at', { ascending: true, nullsFirst: false })
          .order('sort_order'),
        admin
          .from('wedding_music_tracks')
          .select('list_type,title,artist,notes,sort_order')
          .eq('wedding_card_id', card.id)
          .order('sort_order'),
        admin
          .from('wedding_attraction_choices')
          .select('attraction_key,attraction_name,choice,notes')
          .eq('wedding_card_id', card.id)
          .order('attraction_name'),
        event.location_id
          ? admin
              .from('locations')
              .select('name,formatted_address,address,city,postal_code')
              .eq('id', event.location_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        event.organization_id
          ? admin
              .from('organizations')
              .select('name,alias')
              .eq('id', event.organization_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        event.contact_person_id
          ? admin
              .from('contacts')
              .select('full_name,first_name,last_name')
              .eq('id', event.contact_person_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

    const requiredResults = [
      answersResult,
      peopleResult,
      scheduleResult,
      tracksResult,
      attractionsResult,
    ];
    const contentError = requiredResults.find((result) => result.error)?.error;
    if (contentError) throw contentError;

    const location = locationResult.data;
    const organization = organizationResult.data;
    const contact = contactResult.data;
    const clientName =
      organization?.alias ||
      organization?.name ||
      contact?.full_name ||
      [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') ||
      null;
    const locationAddress =
      location?.formatted_address ||
      [location?.address, location?.postal_code, location?.city].filter(Boolean).join(', ') ||
      event.location ||
      null;
    const generatedAt = new Date().toISOString();

    const html = buildWeddingCardPdfHtml({
      eventName: event.name,
      eventDate: event.event_date,
      eventEndDate: event.event_end_date,
      locationName: location?.name || event.location || null,
      locationAddress,
      clientName,
      cardStatus: card.status,
      cardProgress: Number(card.progress || 0),
      generatedAt,
      answers: (answersResult.data || []).map(
        (answer): WeddingCardPdfAnswer => ({
          section: answer.section,
          fieldKey: answer.field_key,
          value: answer.value,
        }),
      ),
      people: (peopleResult.data || []).map(
        (person): WeddingCardPdfPerson => ({
          side: person.side as WeddingCardPdfPerson['side'],
          role: person.role,
          firstName: person.first_name,
          lastName: person.last_name,
          phone: person.phone,
          email: person.email,
          instagramHandle: person.instagram_handle,
          instagramTagConsent: person.instagram_tag_consent,
          notes: person.notes,
        }),
      ),
      schedule: (scheduleResult.data || []).map(
        (item): WeddingCardPdfScheduleItem => ({
          title: item.title,
          scheduledAt: item.scheduled_at,
          category: item.category,
          location: item.location,
          responsiblePerson: item.responsible_person,
          notes: item.notes,
          isConfirmed: item.is_confirmed,
        }),
      ),
      tracks: (tracksResult.data || []).map(
        (track): WeddingCardPdfTrack => ({
          listType: track.list_type as WeddingCardPdfTrack['listType'],
          title: track.title,
          artist: track.artist,
          notes: track.notes,
        }),
      ),
      attractions: (attractionsResult.data || []).map(
        (attraction): WeddingCardPdfAttraction => ({
          key: attraction.attraction_key,
          name: attraction.attraction_name,
          choice: attraction.choice as WeddingCardPdfAttraction['choice'],
          notes: attraction.notes,
        }),
      ),
    });

    const localChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    browser = await chromium.launch({
      ...(existsSync(localChromePath) ? { executablePath: localChromePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });

    const fileName = `karta-weselna-${safeFilePart(event.name) || event.id}.pdf`;
    const storagePath = `${eventId}/documents/wedding-card/${fileName}`;
    const employeeId = employeeResult.data || null;
    const folderId = await getWeddingCardFolderId({
      supabase: admin,
      eventId,
      createdBy: employeeId,
    });

    const upload = await admin.storage.from('event-files').upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
      cacheControl: '0',
    });
    if (upload.error) throw upload.error;

    const existingFile = await admin
      .from('event_files')
      .select('id')
      .eq('event_id', eventId)
      .eq('folder_id', folderId)
      .eq('name', fileName)
      .maybeSingle();
    if (existingFile.error) throw existingFile.error;

    const filePayload = {
      event_id: eventId,
      folder_id: folderId,
      name: fileName,
      original_name: fileName,
      file_path: storagePath,
      file_size: pdfBuffer.byteLength,
      mime_type: 'application/pdf',
      thumbnail_url: null,
      uploaded_by: employeeId,
      updated_at: generatedAt,
    };
    const fileWrite = existingFile.data?.id
      ? await admin.from('event_files').update(filePayload).eq('id', existingFile.data.id)
      : await admin.from('event_files').insert(filePayload);
    if (fileWrite.error) throw fileWrite.error;

    const signed = await admin.storage.from('event-files').createSignedUrl(storagePath, 60 * 60);
    if (signed.error) throw signed.error;

    return NextResponse.json({
      ok: true,
      fileName,
      storagePath,
      generatedAt,
      signedUrl: signed.data?.signedUrl || null,
    });
  } catch (error) {
    console.error('Wedding card PDF generation error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Nie udało się wygenerować Karty Weselnej.',
      },
      { status: 500 },
    );
  } finally {
    if (browser) await browser.close();
  }
}
