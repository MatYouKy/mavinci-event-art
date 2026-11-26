import { NextResponse } from 'next/server';
import { isUuid, requireSessionEmployee } from '@/lib/auth/requireEmployee.server';
import { pdfContentDisposition, renderPrintJob } from '@/lib/print/pdfRenderer.server';
import { localRenderRequested, printJobResponse } from '@/lib/print/printJob.server';
import { RentalPrintError, loadRentalProtocolPrint } from '@/lib/rental/rentalProtocolPrint.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Protokół wydania / odbioru wypożyczenia (PDF do podpisu) — CRM (sesja z ciasteczek) i aplikacje (Bearer). `?render=local` —
 * zadanie wydruku dla Maca (druk w Chrome na komputerze), bez niego — PDF z serwera. `?download=1` — pobranie zamiast podglądu.
 */
export async function GET(request: Request, { params }: { params: { id: string; protocolId: string } }) {
  const session = await requireSessionEmployee(request);
  if (!session.ok) return session.response;
  if (!isUuid(params.id) || !isUuid(params.protocolId)) return NextResponse.json({ error: 'Nieprawidłowy protokół.' }, { status: 400 });
  try {
    const print = await loadRentalProtocolPrint(session.client, params.id, params.protocolId);
    if (localRenderRequested(request)) return printJobResponse(print.job);
    const { pdf } = await renderPrintJob(print.job);
    const download = new URL(request.url).searchParams.get('download') === '1';
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.byteLength),
        'Content-Disposition': pdfContentDisposition(print.fileName, download),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const status = error instanceof RentalPrintError ? error.status : 500;
    if (status >= 500) console.error('Rental protocol PDF error:', error);
    return NextResponse.json({ error: status < 500 && error instanceof Error ? error.message : 'Nie udało się przygotować protokołu.' }, { status });
  }
}
