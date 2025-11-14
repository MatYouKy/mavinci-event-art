'use client';

import { Provider } from 'react-redux';
import { store } from '@/store/store';
import { SnackbarProvider } from '@/contexts/SnackbarContext';
import { DialogProvider } from '@/contexts/DialogContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <SnackbarProvider>
        <DialogProvider>{children}</DialogProvider>
      </SnackbarProvider>
    </Provider>
  );
}
