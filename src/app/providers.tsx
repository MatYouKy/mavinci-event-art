'use client';

import { Provider } from 'react-redux';
import { store } from '@/store/store';
import { SnackbarProvider } from '@/contexts/SnackbarContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <SnackbarProvider>
        {children}
      </SnackbarProvider>
    </Provider>
  );
}
