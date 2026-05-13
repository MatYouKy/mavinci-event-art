// app/bridge/ksef/invoices/send/progress-store.ts

export type KsefProgressEvent = {
  step: string;
  status: 'active' | 'completed' | 'error';
  message?: string;
  attempt?: number;
  maxAttempts?: number;
};

const listeners = new Map<string, Set<(event: KsefProgressEvent) => void>>();

export function subscribeKsefProgress(
  jobId: string,
  listener: (event: KsefProgressEvent) => void,
) {
  if (!listeners.has(jobId)) {
    listeners.set(jobId, new Set());
  }

  listeners.get(jobId)!.add(listener);

  return () => {
    listeners.get(jobId)?.delete(listener);

    if (listeners.get(jobId)?.size === 0) {
      listeners.delete(jobId);
    }
  };
}

export function emitKsefProgress(jobId: string | undefined, event: KsefProgressEvent) {
  if (!jobId) return;

  const jobListeners = listeners.get(jobId);
  if (!jobListeners) return;

  jobListeners.forEach((listener) => listener(event));
}