import { NextResponse } from 'next/server';
import { nativeContext, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { invalidateEvents } from '@/lib/native/events';
import { CalculationPrintError, calculationPrintJob, loadCalculationPrint, storeCalculationPdf } from '@/lib/events/print/calculationPrint.server';
import { pdfContentDisposition, renderPrintJob } from '@/lib/print/pdfRenderer.server';
import { finalizeRequested, localRenderRequested, printJobResponse, readFinalizedPdf } from '@/lib/print/printJob.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * PDF kalkulacji wydarzenia dla aplikacji na Maca (`{ eventId, calculationId, expectedRevision }`) — także kalkulacji
 * zapytania (`{ inquiryId, eventId?, calculationId, expectedRevision }`; bez wydarzenia plik trafia do `inquiries/<id>/`).
 * `POST ?render=local` — zadanie wydruku (Mac drukuje w Chrome i odsyła plik `POST ?finalize=1`); `POST` bez parametrów —
 * PDF z serwera (gdy na Macu nie ma Chrome). Zapis jak „Generuj PDF” w CRM: folder „Kalkulacje” i publikacja rewizji.
 * `GET ?eventId|inquiryId&calculationId[&render=local]` — „Drukuj” w edytorze: wydruk zapisanej treści bez zapisu pliku.
 */

type Payload = { eventId?: string | null; inquiryId?: string | null; calculationId?: string; expectedRevision?: number };

const failure = (error: unknown, fallback: string) => {
  const status = error instanceof CalculationPrintError ? error.status : 500;
  if (status >= 500) console.error('Calculation PDF (native) error:', error);
  return NextResponse.json({ error: error instanceof CalculationPrintError ? error.message : fallback }, { status });
};

const parse = (body: Payload) => {
  const eventId = body?.eventId ? String(body.eventId) : null;
  const inquiryId = body?.inquiryId ? String(body.inquiryId) : null;
  const calculationId = String(body?.calculationId || '');
  if ((!eventId && !inquiryId) || (eventId && !UUID.test(eventId)) || (inquiryId && !UUID.test(inquiryId)) || !UUID.test(calculationId)) {
    throw new CalculationPrintError('Brak wymaganych danych');
  }
  const revision = Number(body?.expectedRevision);
  return { target: { eventId, inquiryId }, calculationId, revision: Number.isFinite(revision) ? revision : null };
};

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  try {
    const params = new URL(request.url).searchParams;
    const { target, calculationId } = parse({
      eventId: params.get('eventId'), inquiryId: params.get('inquiryId'), calculationId: params.get('calculationId') || '',
    });
    const print = await loadCalculationPrint(ctx, target, calculationId, null);
    // Sam wydruk — Mac nie odsyła pliku (`finalize: false`), serwer niczego nie zapisuje.
    const job = { ...calculationPrintJob(print), finalize: false };
    if (localRenderRequested(request)) return printJobResponse(job);
    const { pdf } = await renderPrintJob(job);
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
    return failure(error, 'Nie udało się przygotować wydruku');
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  try {
    if (finalizeRequested(request)) {
      const { pdf, payload } = await readFinalizedPdf(request);
      const { target, calculationId, revision } = parse(payload as Payload);
      if (revision === null) throw new CalculationPrintError('Brak rewizji kalkulacji.');
      const print = await loadCalculationPrint(ctx, target, calculationId, revision);
      const stored = await storeCalculationPdf(ctx, print.target, calculationId, revision, print, pdf);
      invalidateEvents();
      return NextResponse.json({ ok: true, ...stored }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const { target, calculationId, revision } = parse((await readJson(request, 64_000)) as Payload);
    const print = await loadCalculationPrint(ctx, target, calculationId, revision);
    const job = calculationPrintJob(print);
    if (localRenderRequested(request)) return printJobResponse(job);
    const { pdf } = await renderPrintJob(job);
    const stored = await storeCalculationPdf(ctx, print.target, calculationId, print.revision, print, pdf);
    invalidateEvents();
    return NextResponse.json({ ok: true, ...stored }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return failure(error, 'Błąd generowania PDF');
  }
}
