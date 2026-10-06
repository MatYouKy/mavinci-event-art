'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

interface Snackbar {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

interface SnackbarContextType {
  showSnackbar: (message: string, type?: 'success' | 'error' | 'info' | 'warning', duration?: number) => void;
}

const SnackbarContext = createContext<SnackbarContextType | undefined>(undefined);

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const [snackbars, setSnackbars] = useState<Snackbar[]>([]);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Keep the server and first client render identical; mount the portal only
    // after hydration instead of branching on document during rendering.
    setPortalContainer(document.body);
  }, []);

  const showSnackbar = useCallback((
    message: string,
    type: 'success' | 'error' | 'info' | 'warning' = 'info',
    duration: number = 5000
  ) => {
    const id = Math.random().toString(36).substring(7);
    const newSnackbar: Snackbar = { id, message, type, duration };

    setSnackbars((prev) => [...prev, newSnackbar]);

    if (duration > 0) {
      setTimeout(() => {
        setSnackbars((prev) => prev.filter((s) => s.id !== id));
      }, duration);
    }
  }, []);

  const removeSnackbar = useCallback((id: string) => {
    setSnackbars((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const getIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-5 h-5" />;
      case 'error':
        return <AlertCircle className="w-5 h-5" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5" />;
      default:
        return <Info className="w-5 h-5" />;
    }
  };

  const getColors = (type: string) => {
    switch (type) {
      case 'success':
        return 'bg-green-500/90 text-white';
      case 'error':
        return 'bg-red-500/90 text-white';
      case 'warning':
        return 'bg-yellow-500/90 text-white';
      default:
        return 'bg-blue-500/90 text-white';
    }
  };

  return (
    <SnackbarContext.Provider value={{ showSnackbar }}>
      {children}
      {portalContainer && createPortal(<div className="pointer-events-none fixed bottom-6 right-4 z-[10000] flex w-[calc(100%-2rem)] max-w-md flex-col gap-3 sm:right-6">
        {snackbars.map((snackbar, index) => (
          <div
            key={snackbar.id}
            role={snackbar.type === 'error' ? 'alert' : 'status'}
            className={`${getColors(snackbar.type)} pointer-events-auto rounded-lg shadow-2xl p-4 flex items-center gap-3 animate-slide-in-right`}
            style={{
              animation: 'slideInRight 0.3s ease-out forwards',
              opacity: 0,
              animationDelay: `${index * 0.05}s`,
            }}
          >
            <div className="flex-shrink-0">{getIcon(snackbar.type)}</div>
            <p className="flex-1 text-sm font-medium">{snackbar.message}</p>
            <button
              type="button"
              aria-label="Zamknij powiadomienie"
              onClick={() => removeSnackbar(snackbar.id)}
              className="flex-shrink-0 hover:opacity-70 transition-opacity"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        ))}
      </div>, portalContainer)}

      <style jsx global>{`
        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </SnackbarContext.Provider>
  );
}

export function useSnackbar() {
  const context = useContext(SnackbarContext);
  if (!context) {
    throw new Error('useSnackbar must be used within SnackbarProvider');
  }
  return context;
}
