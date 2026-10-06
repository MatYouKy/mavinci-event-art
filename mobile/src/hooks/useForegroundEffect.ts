import { DependencyList, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

type ForegroundCleanup = () => void | Promise<unknown>;

// Stop directly on AppState change. Await removal before reopening the same topic.
export function useForegroundEffect(
  setup: (signal: AbortSignal, resumed: boolean) => void | ForegroundCleanup,
  dependencies: DependencyList,
) {
  const removalRef = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let controller: AbortController | null = null;
    let cleanup: ForegroundCleanup | undefined;
    let startedOnce = false;

    const stop = () => {
      controller?.abort();
      controller = null;
      const previousCleanup = cleanup;
      cleanup = undefined;
      if (previousCleanup) {
        try {
          removalRef.current = Promise.resolve(previousCleanup()).catch((error) => {
            console.error('[Realtime] Cleanup failed:', error);
          });
        } catch (error) {
          console.error('[Realtime] Cleanup failed:', error);
        }
      }
    };
    const start = () => {
      if (controller || AppState.currentState !== 'active') return;
      const current = new AbortController();
      controller = current;
      const resumed = startedOnce;
      startedOnce = true;
      void removalRef.current.then(() => {
        if (current.signal.aborted) return;
        cleanup = setup(current.signal, resumed) || undefined;
      }).catch((error) => {
        if (!current.signal.aborted) console.error('[Realtime] Setup failed:', error);
      });
    };

    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
      else stop();
    });
    start();
    return () => {
      listener.remove();
      stop();
    };
    // Callers explicitly supply the lifecycle dependencies, just like useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
}
