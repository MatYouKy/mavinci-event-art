import { NextResponse } from 'next/server';
import { nativeContext, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { invalidateEvents } from '@/lib/native/events';
import { CalculationPrintError, calculationPrintJob, loadCalculationPrint, storeCalculationPdf } from '@/lib/events/print/calculationPrint.server';
import { renderPrintJob } from '@/lib/print/pdfRenderer.server';
import { finalizeRequested, localRenderRequested, printJobResponse, readFinalizedPdf } from '@/lib/print/printJob.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * PDF kalkulacji wydarzenia dla aplikacji na Maca (`{ eventId, calculationId, expectedRevision }`).
 * `POST ?render=local` — zadanie wydruku (Mac drukuje w Chrome i odsyła plik `POST ?finalize=1`); `POST` bez parametrów —
 * PDF z serwera (gdy na Macu nie ma Chrome). Zapis jak „Generuj PDF” w CRM: folder „Kalkulacje” i publikacja rewizji.
 */

type Payload = { eventId?: string; calculationId?: string; expectedRevision?: number };

const failure = (error: unknown, fallback: string) => {
  const status = error instanceof CalculationPrintError ? error.status : 500;
  if (status >= 500) console.error('Calculation PDF (native) error:', error);
  return NextResponse.json({ error: error instanceof CalculationPrintError ? error.message : fallback }, { status });
};

const parse = (body: Payload) => {
  const eventId = String(body?.eventId || '');
  const calculationId = String(body?.calculationId || '');
  if (!UUID.test(eventId) || !UUID.test(calculationId)) throw new CalculationPrintError('Brak wymaganych danych');
  const revision = Number(body?.expectedRevision);
  return { eventId, calculationId, revision: Number.isFinite(revision) ? revision : null };
};

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  try {
    if (finalizeRequested(request)) {
      const { pdf, payload } = await readFinalizedPdf(request);
      const { eventId, calculationId, revision } = parse(payload as Payload);
      if (revision === null) throw new CalculationPrintError('Brak rewizji kalkulacji.');
      const print = await loadCalculationPrint(ctx, eventId, calculationId, revision);
      const stored = await storeCalculationPdf(ctx, eventId, calculationId, revision, print, pdf);
      invalidateEvents();
      return NextResponse.json({ ok: true, ...stored }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const { eventId, calculationId, revision } = parse((await readJson(request, 64_000)) as Payload);
    const print = await loadCalculationPrint(ctx, eventId, calculationId, revision);
    const job = calculationPrintJob(print);
    if (localRenderRequested(request)) return printJobResponse(job);
    const { pdf } = await renderPrintJob(job);
    const stored = await storeCalculationPdf(ctx, eventId, calculationId, print.revision, print, pdf);
    invalidateEvents();
    return NextResponse.json({ ok: true, ...stored }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return failure(error, 'Błąd generowania PDF');
  }
}
