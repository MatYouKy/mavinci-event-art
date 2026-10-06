import 'server-only';

const READ_ONLY_RPCS = new Set([
  'get_invoice_finance_access',
  'get_financial_report',
  'get_my_sales_financial_report',
  'get_event_workflow_attention_count',
]);
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
const TRANSIENT_DATABASE_CODES = new Set([
  '08000', '08001', '08003', '08006', '08007', '08P01',
  '57P01', '57P02', '57P03',
  'PGRST000', 'PGRST001', 'PGRST002',
]);
const MAX_ATTEMPTS = 2;
const MAX_CONCURRENT_READS = 2;
const ATTEMPT_TIMEOUT_MS = 25_000;
// Capacity is shared within this server process; sessions and results are not.
let processActive = 0;
const processWaiting: Array<() => void> = [];
async function acquireProcessSlot() {
  if (processActive < 4) { processActive += 1; return; }
  await new Promise<void>((resolve) => processWaiting.push(resolve));
}
function releaseProcessSlot() {
  const next = processWaiting.shift();
  if (next) next();
  else processActive -= 1;
}

async function databaseErrorCode(response: Response): Promise<string | null> {
  if (!response.headers.get('content-type')?.includes('json')) return null;
  const payload: unknown = await response.clone().json().catch(() => null);
  return payload && typeof payload === 'object' && 'code' in payload && typeof payload.code === 'string'
    ? payload.code : null;
}

function retryDelay(response?: Response): number | null {
  const value = response?.headers.get('retry-after');
  if (value) {
    const seconds = Number(value);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
    // Do not retry earlier than the service requested or keep SSR waiting indefinitely.
    if (Number.isFinite(delay)) return delay > 5_000 ? null : Math.max(0, delay);
  }
  return 1500 + Math.floor(Math.random() * 1000);
}

function networkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

// Create once per server render, not globally: no sessions, results or queued
// requests are shared between employees. Writes and auth requests are untouched.
export function createDashboardReadFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  const databaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = async () => {
    if (active < MAX_CONCURRENT_READS) { active += 1; return; }
    await new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/)?.[1];
    const safeRead = url.origin === databaseOrigin && url.pathname.startsWith('/rest/v1/')
      && (rpc ? READ_ONLY_RPCS.has(rpc) && ['GET', 'HEAD', 'POST'].includes(method) : ['GET', 'HEAD'].includes(method));
    if (!safeRead) return baseFetch(input, init);

    // Each attempt has its own body; never replay a consumed RPC Request stream.
    const request = new Request(input, { ...init, cache: 'no-store' });
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await acquire();
      await acquireProcessSlot();
      const controller = new AbortController();
      const abort = () => controller.abort(request.signal.reason);
      request.signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(() => controller.abort(new DOMException('Dashboard read timed out', 'TimeoutError')), ATTEMPT_TIMEOUT_MS);
      let response: Response | undefined;
      let delay: number | null = null;
      try {
        request.signal.throwIfAborted();
        response = await baseFetch(request.clone(), { signal: controller.signal });
        if (response.ok) return response;
        const code = await databaseErrorCode(response);
        // SQL/schema/permission failures must remain visible, not be retried as outages.
        const transient = code ? TRANSIENT_DATABASE_CODES.has(code) : TRANSIENT_STATUSES.has(response.status);
        delay = transient && attempt < MAX_ATTEMPTS ? retryDelay(response) : null;
        if (delay === null) {
          console.error('[CRM dashboard] read failed', { resource: url.pathname, status: response.status, code, attempts: attempt });
          return response;
        }
      } catch (error) {
        if (request.signal.aborted) throw error;
        if (!networkFailure(error) || attempt === MAX_ATTEMPTS) {
          console.error('[CRM dashboard] read unavailable', { resource: url.pathname, attempts: attempt, name: error instanceof Error ? error.name : 'UnknownError' });
          throw error;
        }
        delay = retryDelay();
      } finally {
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', abort);
        release();
        releaseProcessSlot();
      }
      await response?.body?.cancel().catch(() => undefined);
      // Failed reads release their slot before backing off, so others can finish.
      await new Promise<void>((resolve) => setTimeout(resolve, delay ?? 0));
      request.signal.throwIfAborted();
    }
    throw new Error('Nie udało się odczytać danych dashboardu.');
  };
}
