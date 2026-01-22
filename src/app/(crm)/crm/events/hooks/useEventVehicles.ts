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
      // preferCacheValue = true -> RTK Query może zwrócić cache jeśli jest
      // jeśli chcesz ZAWSZE odświeżać, daj false
      return trigger(params, true);
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
