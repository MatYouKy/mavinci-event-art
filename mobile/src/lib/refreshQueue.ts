// Coalesce bursts of Realtime events and never overlap snapshot requests.
export function createRefreshQueue(
  signal: AbortSignal,
  load: (requestSignal: AbortSignal) => Promise<unknown>,
) {
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (signal.aborted || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, 300);
  };

  const refresh = async () => {
    if (signal.aborted) return;
    if (running) {
      pending = true;
      return;
    }
    if (timer !== null) clearTimeout(timer);
    timer = null;
    running = true;
    const request = new AbortController();
    const abort = () => request.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 20_000);
    try {
      await load(request.signal);
    } catch (error) {
      if (!request.signal.aborted) console.error('[Realtime] Refresh failed:', error);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      running = false;
      if (pending) {
        pending = false;
        schedule();
      }
    }
  };

  signal.addEventListener('abort', () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = false;
  }, { once: true });

  return { refresh, schedule };
}
