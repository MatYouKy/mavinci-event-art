import { OFFER_PDF_STEPS, type ReportOfferPdfProgress } from './progress';

export async function readOfferPdfResult(response: Response, report: ReportOfferPdfProgress): Promise<any> {
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
    const result = await response.json().catch(() => ({}));
    return { ...result, httpStatus: response.status };
  }
  if (!response.body) throw new Error('Brak odpowiedzi generatora PDF.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let result: any;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'progress' && OFFER_PDF_STEPS.some(step => step.id === event.step)) {
      report({ step: event.step, detail: typeof event.detail === 'string' ? event.detail : undefined });
    }
    if (event.type === 'result') {
      result = { ...event.result, httpStatus: event.status };
      if (event.status >= 400 && result) result.success = false;
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) consume(line);
      if (pending.length > 1024 * 1024) throw new Error('Nieprawidłowa odpowiedź generatora PDF.');
      if (done) { consume(pending); break; }
    }
    if (!result) throw new Error('Utracono połączenie z generatorem. Odśwież ofertę i sprawdź zapisany PDF przed ponowieniem.');
    return result;
  } finally { reader.releaseLock(); }
}
