'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { loadInvoiceFinanceAccess, type InvoiceFinanceAccess } from '@/lib/invoices/financeAccess';

export function useInvoiceFinanceAccess() {
  const [access, setAccess] = useState<InvoiceFinanceAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setAccess(null);
    setLoading(true);
    setError(null);
    try {
      const next = await loadInvoiceFinanceAccess(supabase);
      if (requestVersion.current === version) setAccess(next);
    } catch (cause) {
      if (requestVersion.current === version) {
        setError(cause instanceof Error ? cause.message : 'Nie udało się odczytać uprawnień finansowych.');
      }
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    void refresh();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        ++requestVersion.current;
        setAccess(null);
        setLoading(false);
        setError('Zaloguj się ponownie.');
      } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        // Leave the auth callback before making another Supabase request.
        ++requestVersion.current;
        setAccess(null);
        setLoading(true);
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { void refresh(); }, 0);
      }
    });
    return () => {
      ++requestVersion.current;
      clearTimeout(refreshTimer);
      subscription.unsubscribe();
    };
  }, [refresh]);

  return { access, loading, error, refresh };
}
