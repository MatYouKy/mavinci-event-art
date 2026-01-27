'use client';

import { useRouter } from 'next/navigation';
import { ReactNode, useState, useEffect } from 'react';
import { useGetMessagesListQuery } from '@/store/api/messagesApi';
import MessagesLoadingScreen from './MessagesLoadingScreen';

interface MessagesPrefetchButtonProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export default function MessagesPrefetchButton({
  children,
  className,
  onClick,
}: MessagesPrefetchButtonProps) {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [startFetch, setStartFetch] = useState(false);

  const { data, isLoading, isFetching, isSuccess } = useGetMessagesListQuery(
    {
      emailAccountId: 'all',
      offset: 0,
      limit: 50,
      filterType: 'all',
    },
    {
      skip: !startFetch,
      refetchOnMountOrArgChange: false,
    }
  );

  useEffect(() => {
    if (!isNavigating) return;

    if (isSuccess && data) {
      setProgress(100);
      const timeout = setTimeout(() => {
        router.push('/crm/messages');
      }, 300);
      return () => clearTimeout(timeout);
    }

    if (isLoading || isFetching) {
      const interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) return 90;
          return prev + 10;
        });
      }, 250);
      return () => clearInterval(interval);
    }
  }, [isNavigating, isSuccess, isLoading, isFetching, data, router]);

  const handleClick = async () => {
    if (onClick) {
      onClick();
    }

    setIsNavigating(true);
    setProgress(10);
    setStartFetch(true);

    // Fallback - jeśli po 5 sekundach nie załadowano, idź dalej
    const fallbackTimeout = setTimeout(() => {
      router.push('/crm/messages');
    }, 5000);

    return () => clearTimeout(fallbackTimeout);
  };

  if (isNavigating) {
    return <MessagesLoadingScreen progress={progress} />;
  }

  return (
    <button onClick={handleClick} className={className} type="button">
      {children}
    </button>
  );
}
