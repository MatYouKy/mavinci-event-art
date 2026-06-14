'use client';

import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';

type GlobalLoaderContextValue = {
  showLoader: (title?: string, description?: string) => void;
  hideLoader: () => void;
};

const GlobalLoaderContext = createContext<GlobalLoaderContextValue | null>(null);

export function GlobalLoaderProvider({ children }: { children: React.ReactNode }) {
  const [loader, setLoader] = useState({
    show: false,
    title: 'Wczytuję widok',
    description: 'Proszę chwilę poczekać...',
  });

  const showLoader = useCallback(
    (title = 'Wczytuję widok', description = 'Proszę chwilę poczekać...') => {
      setLoader({ show: true, title, description });
    },
    [],
  );

  const hideLoader = useCallback(() => {
    setLoader((prev) => ({ ...prev, show: false }));
  }, []);

  const value = useMemo(
    () => ({ showLoader, hideLoader }),
    [showLoader, hideLoader],
  );

  return (
    <GlobalLoaderContext.Provider value={value}>
      {children}

      <FullScreenLoader
        show={loader.show}
        title={loader.title}
        description={loader.description}
      />
    </GlobalLoaderContext.Provider>
  );
}

export function RouteLoaderReset() {
  const pathname = usePathname();
  const { hideLoader } = useGlobalLoader();

  useEffect(() => {
    hideLoader();
  }, [pathname, hideLoader]);

  return null;
}

export function useGlobalLoader() {
  const ctx = useContext(GlobalLoaderContext);

  if (!ctx) {
    throw new Error('useGlobalLoader must be used inside GlobalLoaderProvider');
  }

  return ctx;
}