import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { buildFamiliadaGamePdfHtml, type FamiliadaPdfQuestion } from '@/app/(crm)/crm/events/[id]/helpers/buildFamiliadaGamePdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = { eventId: string; gameId: string };
type ManifestFamiliada = {
  gameId?: string;
  gameName?: string;
  pdfPath?: string | null;
  pdfFileName?: string | null;
  generatedAt?: string | null;
};
const getSupabaseAdmin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const safeFilePart = (value: string) => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/gi, '-')
  .replace(/^-+|-+$/g, '')
  .toLowerCase();

async function getOrCreateMavinciLiveFolderId({
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
    p_subfolder_name: 'Mavinci LIVE',
    p_required_permission: 'events_manage',
    p_created_by: createdBy,
  });
  if (!rpc.error && rpc.data) return rpc.data as string;

  const existing = await supabase
    .from('event_folders')
    .select('id')
    .eq('event_id', eventId)
    .eq('name', 'Mavinci LIVE')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.data?.id) return existing.data.id as string;
  throw rpc.error || existing.error || new Error('Nie udało się utworzyć folderu Mavinci LIVE');
}

export async function POST(request: Request) {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    const { eventId, gameId } = (await request.json()) as Body;
    if (!eventId || !gameId) {
      return NextResponse.json({ error: 'Wybierz wydarzenie i gotową grę Familiady.' }, { status: 400 });
    }

    const userClient = createSupabaseServerClient(cookies());
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'Wymagane logowanie.' }, { status: 401 });

    const { data: canManage, error: permissionError } = await userClient.rpc('can_manage_mavinci_event', {
      p_event_id: eventId,
    });
    if (permissionError || !canManage) {
      return NextResponse.json({ error: 'Nie masz uprawnień do przygotowania materiałów tego wydarzenia.' }, { status: 403 });
    }

    const { data: employeeId } = await userClient.rpc('current_mavinci_employee_id');
    const admin = getSupabaseAdmin();
    const [eventResult, gameResult, projectResult] = await Promise.all([
      admin.from('events').select('id,name,event_date').eq('id', eventId).maybeSingle(),
      admin
        .from('mavinci_familiada_games')
        .select('id,event_id,name,description,is_active,rounds:mavinci_familiada_game_questions(question_id,sort_order,multiplier)')
        .eq('id', gameId)
        .maybeSingle(),
      admin.from('mavinci_event_projects').select('*').eq('event_id', eventId).maybeSingle(),
    ]);

    if (eventResult.error || !eventResult.data) {
      return NextResponse.json({ error: 'Nie znaleziono wydarzenia.' }, { status: 404 });
    }
    if (gameResult.error || !gameResult.data || !gameResult.data.is_active) {
      return NextResponse.json({ error: 'Wybrana gra Familiady nie jest już dostępna.' }, { status: 404 });
    }
    if (gameResult.data.event_id && gameResult.data.event_id !== eventId) {
      return NextResponse.json({ error: 'Ta gra jest przypisana do innego wydarzenia.' }, { status: 403 });
    }
    if (projectResult.error) throw projectResult.error;

    const rawRounds = [...(gameResult.data.rounds || [])].sort((a, b) => a.sort_order - b.sort_order);
    if (!rawRounds.length) {
      return NextResponse.json({ error: 'Wybrana gra nie ma jeszcze pytań.' }, { status: 400 });
    }
    // Rozgrywka Familiady ma sześć pytań głównych. Ewentualne starsze rekordy
    // finałowe nie należą do arkusza Karty Weselnej.
    const questionRounds = rawRounds.slice(0, 6);

    const questionResult = await admin
      .from('mavinci_familiada_questions')
      .select('id,question')
      .in('id', questionRounds.map((round) => round.question_id));
    if (questionResult.error) throw questionResult.error;

    const questionById = new Map((questionResult.data || []).map((question) => [question.id, question]));
    const questions: FamiliadaPdfQuestion[] = questionRounds.map((round, index) => {
      const question = questionById.get(round.question_id);
      if (!question) throw new Error(`Brakuje pytania dla rundy ${index + 1}.`);
      return {
        number: index + 1,
        question: question.question,
      };
    });

    const generatedAt = new Date().toISOString();
    const html = buildFamiliadaGamePdfHtml({
      eventName: eventResult.data.name,
      eventDate: eventResult.data.event_date,
      gameName: gameResult.data.name,
      questions,
    });

    const localChromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    browser = await chromium.launch({
      ...(existsSync(localChromePath) ? { executablePath: localChromePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });

    const timestamp = generatedAt.replace(/[:.]/g, '-').slice(0, -5);
    const fileName = `pytania-familiada-${safeFilePart(eventResult.data.name) || 'wydarzenie'}-${timestamp}.pdf`;
    const storagePath = `${eventId}/documents/mavinci-live/${fileName}`;
    const folderId = await getOrCreateMavinciLiveFolderId({
      supabase: admin,
      eventId,
      createdBy: employeeId || null,
    });
    const upload = await admin.storage.from('event-files').upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    });
    if (upload.error) throw upload.error;

    const insertFile = await admin.from('event_files').insert({
      event_id: eventId,
      folder_id: folderId,
      name: fileName,
      original_name: fileName,
      file_path: storagePath,
      file_size: pdfBuffer.byteLength,
      mime_type: 'application/pdf',
      document_type: 'other',
      thumbnail_url: null,
      uploaded_by: employeeId || null,
    });
    if (insertFile.error) {
      await admin.storage.from('event-files').remove([storagePath]);
      throw insertFile.error;
    }

    const currentManifest = (projectResult.data?.draft_manifest || {}) as Record<string, unknown>;
    const oldFamiliada = (currentManifest.familiada || {}) as ManifestFamiliada;
    const nextManifest = {
      ...currentManifest,
      familiada: {
        gameId,
        gameName: gameResult.data.name,
        pdfPath: storagePath,
        pdfFileName: fileName,
        generatedAt,
      },
    };
    const projectWrite = projectResult.data
      ? await admin.from('mavinci_event_projects').update({ draft_manifest: nextManifest }).eq('id', projectResult.data.id)
      : await admin.from('mavinci_event_projects').insert({
        event_id: eventId,
        name: `${eventResult.data.name} · Mavinci LIVE`,
        enabled_modules: ['light_magic', 'familiada'],
        draft_manifest: nextManifest,
      });

    if (projectWrite.error) {
      await admin.from('event_files').delete().eq('file_path', storagePath);
      await admin.storage.from('event-files').remove([storagePath]);
      throw projectWrite.error;
    }

    const staleFileResult = await admin
      .from('event_files')
      .select('file_path')
      .eq('event_id', eventId)
      .like('file_path', `${eventId}/documents/mavinci-live/pytania-familiada-%`)
      .neq('file_path', storagePath);
    const stalePaths = new Set((staleFileResult.data || []).map((file) => file.file_path));
    if (oldFamiliada.pdfPath && oldFamiliada.pdfPath !== storagePath) stalePaths.add(oldFamiliada.pdfPath);
    if (stalePaths.size) {
      const paths = Array.from(stalePaths);
      await admin.from('event_files').delete().in('file_path', paths);
      await admin.storage.from('event-files').remove(paths);
    }

    const signed = await admin.storage.from('event-files').createSignedUrl(storagePath, 60 * 60);

    return NextResponse.json({
      ok: true,
      gameId,
      gameName: gameResult.data.name,
      storagePath,
      fileName,
      generatedAt,
      signedUrl: signed.data?.signedUrl || null,
    });
  } catch (error) {
    console.error('Familiada PDF generate API error:', error);
    const message = error instanceof Error ? error.message : 'Nie udało się przygotować PDF-u Familiady.';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (browser) await browser.close();
  }
}
