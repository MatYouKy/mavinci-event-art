import { NextResponse } from 'next/server';
import { nativeContext, nativeUnauthorized, readJson, type NativeContext } from '@/lib/native/auth';
import { invalidateEvents } from '@/lib/native/events';
import { renderPrintJob } from '@/lib/print/pdfRenderer.server';
import { finalizeRequested, localRenderRequested, printJobResponse, readFinalizedPdf } from '@/lib/print/printJob.server';
import { contractPrintJob, storeContractPdf } from '@/lib/events/print/contractPdf.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * PDF umowy wydarzenia dla aplikacji na Maca (`{ eventId, contractId, pagesHtml, cssText, preview? }`). Strony umowy
 * i CSS wydruku liczy silnik dokumentów w Chrome na Macu (`eventContract` w `/native-engine/contracts` — ten sam kod
 * co zakładka „Umowa” w CRM). `POST ?render=local` — zadanie wydruku (Mac drukuje w Chrome; przy „Generuj PDF” odsyła
 * plik `POST ?finalize=1`); `preview` — tylko podgląd, bez zapisu. `POST` bez parametrów — PDF z serwera.
 * Zapis jak „Generuj PDF” w CRM (`/bridge/events/contracts/generate`): plik w folderze „Umowy” i ścieżka w umowie.
 */

type Payload = { eventId?: string; contractId?: string; pagesHtml?: string; cssText?: string; preview?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ContractPdfError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const failure = (error: unknown, fallback: string) => {
  const status = error instanceof ContractPdfError ? error.status : 500;
  if (status >= 500) console.error('Contract PDF (native) error:', error);
  return NextResponse.json({ error: error instanceof ContractPdfError ? error.message : fallback }, { status });
};

function parse(body: Payload) {
  const eventId = String(body?.eventId || '');
  const preview = body?.preview === true;
  const contractId = body?.contractId ? String(body.contractId) : '';
  const pagesHtml = typeof body?.pagesHtml === 'string' ? body.pagesHtml : '';
  const cssText = typeof body?.cssText === 'string' ? body.cssText : '';
  if (!UUID.test(eventId) || (!preview && !UUID.test(contractId)) || (contractId && !UUID.test(contractId))) {
    throw new ContractPdfError('Brak wymaganych danych');
  }
  if (!pagesHtml.trim() || !cssText.trim()) throw new ContractPdfError('Brak wymaganych danych');
  return { eventId, contractId: contractId || null, pagesHtml, cssText, preview };
}

/** Uprawnienia jak w „Generuj PDF”: umowa tego wydarzenia (RLS) i zarządzanie umowami. */
async function authorize(ctx: NativeContext, eventId: string, contractId: string | null) {
  if (contractId) {
    const { data, error } = await ctx.supabase.from('contracts').select('id').eq('id', contractId).eq('event_id', eventId).maybeSingle();
    if (error || !data) throw new ContractPdfError('Nie masz uprawnień do generowania tej umowy.', 403);
  } else {
    const { data, error } = await ctx.supabase.from('events').select('id').eq('id', eventId).maybeSingle();
    if (error || !data) throw new ContractPdfError('Nie znaleziono wydarzenia.', 404);
  }
  const { data: canManage, error } = await ctx.supabase.rpc('crm_contract_permission', { p_action: 'manage' });
  if (error || !canManage) throw new ContractPdfError('Nie masz uprawnień do generowania tej umowy.', 403);
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  try {
    if (finalizeRequested(request)) {
      const { pdf, payload } = await readFinalizedPdf(request);
      const input = parse(payload as Payload);
      if (input.preview || !input.contractId) throw new ContractPdfError('Podgląd umowy nie jest zapisywany.');
      await authorize(ctx, input.eventId, input.contractId);
      const stored = await storeContractPdf({ eventId: input.eventId, contractId: input.contractId, pdf, createdBy: ctx.employee.id });
      invalidateEvents();
      return NextResponse.json({ ok: true, ...stored }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    // Strony umowy razem ze stylami (logo, czcionki w treści) — do kilku MB.
    const input = parse((await readJson(request, 12 * 1024 * 1024)) as Payload);
    await authorize(ctx, input.eventId, input.contractId);
    const job = contractPrintJob({
      contractId: input.contractId || input.eventId,
      pagesHtml: input.pagesHtml,
      cssText: input.cssText,
      finalize: !input.preview,
    });
    if (localRenderRequested(request)) return printJobResponse(job);
    if (input.preview || !input.contractId) throw new ContractPdfError('Podgląd umowy wymaga przeglądarki Chrome na Macu.');
    const { pdf } = await renderPrintJob(job);
    const stored = await storeContractPdf({ eventId: input.eventId, contractId: input.contractId, pdf, createdBy: ctx.employee.id });
    invalidateEvents();
    return NextResponse.json({ ok: true, ...stored }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'too_large') return failure(new ContractPdfError('Umowa jest za duża do wydruku.', 413), '');
    return failure(error, 'Błąd generowania PDF');
  }
}
