'use client';

import { Providers } from '@/app/(public)/providers';
import { AuthProvider } from '@/contexts/AuthContext';

export default function CrmProviders({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <AuthProvider>{children}</AuthProvider>
    </Providers>
  );
}