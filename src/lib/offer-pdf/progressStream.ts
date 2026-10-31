import { randomUUID } from 'node:crypto';
import type { OfferPdfStep } from './progress';
import 'server-only';
import { generateOfferPdf } from './service';

// Keep the existing JSON endpoint compatible. New clients opt in via Accept.
export function streamOfferPdf(request: Request): Response {
  const encoder = new TextEncoder();
  const requestId = randomUUID();
  let currentStep: OfferPdfStep = 'queued';
  let disconnected = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        if (disconnected) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); }
        catch { disconnected = true; }
      };
      heartbeat = setInterval(() => send({ type: 'heartbeat' }), 15000);
      try {
        const response = await generateOfferPdf(request, progress => {
          currentStep = progress.step;
          send({ type: 'progress', ...progress });
        });
        const result = await response.json();
        const failed = !response.ok || !result?.success;
        if (failed) console.error('[offer-pdf-failure]', { requestId, step: currentStep, status: response.status, code: result?.code, error: result?.error });
        send({ type: 'result', status: response.status, result: { ...result, requestId, ...(failed ? { failedStep: currentStep } : {}) } });
      } catch (error) {
        console.error('[offer-pdf-stream]', { requestId, step: currentStep, error: error instanceof Error ? error.message : 'Unknown error' });
        send({ type: 'result', status: 500, result: { success: false, failedStep: currentStep, requestId, error: 'Nie udało się wygenerować oferty PDF.' } });
      } finally {
        clearInterval(heartbeat);
        if (!disconnected) { try { controller.close(); } catch {} }
      }
    },
    cancel() {
      // The document may still be saved; disconnecting must not start another job.
      disconnected = true;
      clearInterval(heartbeat);
    },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, no-transform',
    'X-Accel-Buffering': 'no',
  } });
}
