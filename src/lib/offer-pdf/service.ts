import type { ReportOfferPdfProgress } from './progress';
import 'server-only';
import { renderOfferPdf } from './render';

// Bound concurrent work in each Node process. No duplicate generation/retry on a resource error.
const pending = new Set<string>();
let tail: Promise<void> = Promise.resolve();
export async function generateOfferPdf(request: Request, report?: ReportOfferPdfProgress): Promise<Response> {
  const body = await request.clone().json();
  const key = `${body.outputMode || 'crm'}:${body.offerId}:${body.language || 'pl'}`;
  if (pending.has(key)) return Response.json({ error: 'Ta oferta jest już generowana. Poczekaj na zakończenie.' }, { status: 409 });
  if (pending.size >= 8) return Response.json({ error: 'Generator jest zajęty. Spróbuj ponownie za chwilę.' }, { status: 429 });
  pending.add(key);
  report?.({ step: 'queued', detail: pending.size > 1 ? 'Czekamy na zakończenie poprzedniej generacji.' : 'Uruchamiamy generator.' });
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>(resolve => { release = resolve; });
  try { await previous; return await renderOfferPdf(request, report); }
  finally { pending.delete(key); release(); }
}
