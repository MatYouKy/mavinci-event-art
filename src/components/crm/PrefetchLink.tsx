'use client';

import { useRouter } from 'next/navigation';
import { ReactNode, useState } from 'react';
import { useGetMessagesListQuery } from '@/store/api/messagesApi';
import MessagesLoadingScreen from './MessagesLoadingScreen';

interface PrefetchLinkProps {
  href: string;
  children: ReactNode;
  className?: string;
  prefetchType?: 'messages' | 'none';
  onClick?: () => void;
}

export default function PrefetchLink({
  href,
  children,
  className,
  prefetchType = 'none',
  onClick,
}: PrefetchLinkProps) {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);
  const [progress, setProgress] = useState(0);

  // Prefetch messages if needed
  const shouldPrefetchMessages = prefetchType === 'messages';

  const { data, isLoading, isFetching } = useGetMessagesListQuery(
    {
      emailAccountId: 'all',
      offset: 0,
      limit: 50,
      filterType: 'all',
    },
    {
      skip: !shouldPrefetchMessages || !isNavigating,
      refetchOnMountOrArgChange: false,
    }
  );

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();

    if (onClick) {
      onClick();
    }

    // Jeśli nie ma prefetch, przejdź od razu
    if (prefetchType === 'none') {
      router.push(href);
      return;
    }

    // Start prefetch loading
    setIsNavigating(true);
    setProgress(10);

    // Czekaj na dane (max 5 sekund)
    const timeout = setTimeout(() => {
      router.push(href);
    }, 5000);

    // Update progress
    const progressInterval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 10, 90));
    }, 200);

    // Czekaj na dane
    if (prefetchType === 'messages') {
      // Dane już są w cache lub się ładują
      if (data && !isLoading && !isFetching) {
        clearTimeout(timeout);
        clearInterval(progressInterval);
        setProgress(100);
        setTimeout(() => {
          router.push(href);
        }, 200);
      } else {
        // Czekaj na zakończenie ładowania
        const checkInterval = setInterval(() => {
          if (data && !isLoading && !isFetching) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            clearInterval(progressInterval);
            setProgress(100);
            setTimeout(() => {
              router.push(href);
            }, 200);
          }
        }, 100);
      }
    }
  };

  if (isNavigating) {
    return <MessagesLoadingScreen progress={progress} />;
  }

  return (
    <a href={href} onClick={handleClick} className={className}>
      {children}
    </a>
  );
}
