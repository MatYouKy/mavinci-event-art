import { useCallback, useMemo } from 'react';
import { useLazyGetEventLogisticsQuery } from '@/app/(crm)/crm/events/store/api/eventsApi';

type Params = {
  eventId: string;
  canManage: boolean;
  employeeId?: string | null;
};

export function useEventLogisticsLazy() {
  const [trigger, result] = useLazyGetEventLogisticsQuery();

  // Stabilna referencja funkcji (nie zmienia się co render)
  const fetchLogistics = useCallback(
    (params: Params) => {
      // preferCacheValue = false -> ZAWSZE odświeża dane z serwera
      // To zapewnia że po dodaniu/usunięciu pojazdu lista się zaktualizuje
      return trigger(params, false);
    },
    [trigger],
  );

  // (Opcjonalnie) Stabilny obiekt zwracany z hooka
  return useMemo(
    () => ({
      fetchLogistics,
      ...result, // data, isLoading, isFetching, error, itd.
    }),
    [fetchLogistics, result],
  );
}
