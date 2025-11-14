// hooks/useStableInitialValues.ts
import { useEffect, useMemo, useRef, useState } from 'react';

export function useStableInitialValues<T>(raw: T | undefined | null, isReady: boolean) {
  // pamiętaj ostatnie dobre "raw"
  const lastGoodRef = useRef<T | null>(null);
  const [initial, setInitial] = useState<T | null>(null);

  useEffect(() => {
    if (isReady && raw) {
      lastGoodRef.current = raw;
      setInitial(raw);
    }
  }, [isReady, raw]);

  // zwróć ostatnie dobre initialValues – nawet jeśli na moment „znikną” dane
  return useMemo(
    () => (initial ?? lastGoodRef.current) as T | null,
    [initial]
  );
}