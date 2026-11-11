import { NextResponse } from 'next/server';
import { nativeContext, nativeUnauthorized } from '@/lib/native/auth';
import { invalidateEvents } from '@/lib/native/events';
import { ChecklistPrintError, checklistPrintJob, loadChecklistPrint, storeChecklistPdf } from '@/lib/events/print/equipmentChecklistPrint.server';
import { pdfContentDisposition, renderPrintJob } from '@/lib/print/pdfRenderer.server';
import { finalizeRequested, localRenderRequested, printJobResponse, readFinalizedPdf } from '@/lib/print/printJob.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Checklista sprzętu (PDF) z zakładki Sprzęt dla aplikacji na Maca. `GET ?render=local` — zadanie wydruku (Mac drukuje w Chrome
 * i odsyła plik `POST ?finalize=1`); `GET` bez niego — PDF z serwera (gdy na Macu nie ma Chrome). W obu przypadkach plik
 * trafia do Plików wydarzenia jak „Generuj checklistę” w przeglądarce. `resolved` — rozwiązane pozycje spoza magazynu.
 */

const resolvedOf = (value: string | null | undefined) =>
  new Set(String(value || '').split(',').map((part) => Number(part)).filter((index) => Number.isInteger(index) && index >= 0));

const failure = (error: unknown, fallback: string) => {
  const status = error instanceof ChecklistPrintError ? error.status : 500;
  if (status >= 500) console.error('Equipment checklist PDF error:', error);
  return NextResponse.json(
    { error: error instanceof ChecklistPrintError || (error instanceof Error && status < 500) ? (error as Error).message : fallback },
    { status },
  );
};

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Nieprawidłowy identyfikator wydarzenia.' }, { status: 400 });
  try {
    const print = await loadChecklistPrint(ctx.supabase, params.id, ctx.employee.id, resolvedOf(new URL(request.url).searchParams.get('resolved')));
    const job = checklistPrintJob(print);
    if (localRenderRequested(request)) return printJobResponse(job);
    const { pdf } = await renderPrintJob(job);
    await storeChecklistPdf(ctx.supabase, params.id, ctx.employee.id, print.eventName, pdf);
    invalidateEvents();
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.byteLength),
        'Content-Disposition': pdfContentDisposition(print.fileName, false),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return failure(error, 'Błąd podczas generowania checklisty');
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Nieprawidłowy identyfikator wydarzenia.' }, { status: 400 });
  if (!finalizeRequested(request)) return NextResponse.json({ error: 'Nieobsługiwana operacja.' }, { status: 400 });
  try {
    const { pdf } = await readFinalizedPdf(request);
    const { data: event, error } = await ctx.supabase.from('events').select('name').eq('id', params.id).maybeSingle();
    if (error || !event) throw new ChecklistPrintError('Nie znaleziono wydarzenia albo nie masz do niego dostępu.', 404);
    const stored = await storeChecklistPdf(ctx.supabase, params.id, ctx.employee.id, (event as any).name || 'wydarzenie', pdf);
    invalidateEvents();
    return NextResponse.json({ ok: true, ...stored }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return failure(error, 'Błąd podczas zapisywania pliku');
  }
}
