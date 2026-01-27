'use client';

import { useEffect, useRef } from 'react';
import { useGetMessagesListQuery } from '@/store/api/messagesApi';

interface UsePrefetchMessagesOptions {
  emailAccountId?: string;
  enabled?: boolean;
  onProgress?: (progress: number) => void;
}

export function usePrefetchMessages({
  emailAccountId = 'all',
  enabled = true,
  onProgress,
}: UsePrefetchMessagesOptions = {}) {
  const progressRef = useRef(0);

  const { data, isLoading, isFetching, isSuccess, isError } = useGetMessagesListQuery(
    {
      emailAccountId,
      offset: 0,
      limit: 50,
      filterType: 'all',
    },
    {
      skip: !enabled,
      refetchOnMountOrArgChange: false, // używaj cache
    }
  );

  useEffect(() => {
    if (!enabled || !onProgress) return;

    if (isLoading || isFetching) {
      // Symuluj progress podczas ładowania
      const interval = setInterval(() => {
        progressRef.current = Math.min(progressRef.current + 10, 80);
        onProgress(progressRef.current);
      }, 200);

      return () => clearInterval(interval);
    }

    if (isSuccess) {
      progressRef.current = 100;
      onProgress(100);
    }

    if (isError) {
      progressRef.current = 100;
      onProgress(100);
    }
  }, [isLoading, isFetching, isSuccess, isError, enabled, onProgress]);

  return {
    data,
    isLoading,
    isFetching,
    isSuccess,
    isError,
    isPrefetched: !isLoading && data !== undefined,
  };
}
