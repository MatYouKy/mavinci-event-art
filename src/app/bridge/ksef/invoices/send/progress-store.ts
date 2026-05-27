export type KsefProgressEvent = {
  step: string;
  status: 'active' | 'completed' | 'error';
  message?: string;
  attempt?: number;
  maxAttempts?: number;
};

const listeners = new Map<string, Set<(event: KsefProgressEvent) => void>>();
const eventBuffers = new Map<string, KsefProgressEvent[]>();
const JOB_TTL_MS = 120_000;

export function subscribeKsefProgress(
  jobId: string,
  listener: (event: KsefProgressEvent) => void,
) {
  if (!listeners.has(jobId)) {
    listeners.set(jobId, new Set());
  }

  listeners.get(jobId)!.add(listener);

  const buffered = eventBuffers.get(jobId);
  if (buffered) {
    for (const event of buffered) {
      listener(event);
    }
  }

  return () => {
    listeners.get(jobId)?.delete(listener);

    if (listeners.get(jobId)?.size === 0) {
      listeners.delete(jobId);
    }
  };
}

export function emitKsefProgress(jobId: string | undefined, event: KsefProgressEvent) {
  if (!jobId) return;

  if (!eventBuffers.has(jobId)) {
    eventBuffers.set(jobId, []);
    setTimeout(() => {
      eventBuffers.delete(jobId);
      listeners.delete(jobId);
    }, JOB_TTL_MS);
  }
  eventBuffers.get(jobId)!.push(event);

  const jobListeners = listeners.get(jobId);
  if (!jobListeners) return;

  jobListeners.forEach((listener) => listener(event));
}
