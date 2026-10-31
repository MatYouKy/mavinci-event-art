'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { loadInvoiceFinanceAccess, type InvoiceFinanceAccess } from '@/lib/invoices/financeAccess';

function accessSignature(access: InvoiceFinanceAccess): string {
  // These ID lists describe sets; a different database ordering is not a permission change.
  return JSON.stringify([
    access.employeeId, access.authUserId, access.scope,
    access.canViewOwnInvoices, access.canIssueInvoices,
    access.canViewCompanyFinance, access.canManageCompanyFinance,
    [...access.managedSellerContactIds].sort(),
    [...access.managedSellerPartnerIds].sort(),
    [...access.soldEventIds].sort(),
  ]);
}

export function useInvoiceFinanceAccess() {
  const [access, setAccess] = useState<InvoiceFinanceAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const currentAccess = useRef<InvoiceFinanceAccess | null>(null);
  const authUserId = useRef<string | null | undefined>(undefined);

  const loadAccess = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    const version = ++requestVersion.current;
    if (!background || !currentAccess.current) {
      currentAccess.current = null;
      setAccess(null);
      setLoading(true);
    }
    setError(null);
    try {
      const next = await loadInvoiceFinanceAccess(supabase);
      if (requestVersion.current !== version) return;
      if (authUserId.current !== undefined && next.authUserId !== authUserId.current) {
        throw new Error('Sesja użytkownika zmieniła się. Zaloguj się ponownie.');
      }
      authUserId.current = next.authUserId;
      // Keep the same object so consumers do not re-fetch invoices for unchanged access.
      if (!currentAccess.current || accessSignature(currentAccess.current) !== accessSignature(next)) {
        currentAccess.current = next;
        setAccess(next);
      }
    } catch (cause) {
      if (requestVersion.current === version) {
        currentAccess.current = null;
        setAccess(null);
        setError(cause instanceof Error ? cause.message : 'Nie udało się odczytać uprawnień finansowych.');
      }
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => loadAccess(), [loadAccess]);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    void loadAccess();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!['SIGNED_OUT', 'INITIAL_SESSION', 'SIGNED_IN', 'USER_UPDATED'].includes(event)) return;
      clearTimeout(refreshTimer);
      ++requestVersion.current;
      const nextUserId = event === 'SIGNED_OUT' ? null : session?.user?.id || null;
      authUserId.current = nextUserId;

      if (!nextUserId) {
        currentAccess.current = null;
        setAccess(null);
        setLoading(false);
        setError('Zaloguj się ponownie.');
        return;
      }

      const sameUser = currentAccess.current?.authUserId === nextUserId;
      if (!sameUser) {
        // Never retain the previous person's permissions while checking a new session.
        currentAccess.current = null;
        setAccess(null);
        setLoading(true);
      }
      // SIGNED_IN can repeat when returning to a browser tab. Recheck the same user's
      // permissions without unmounting the current view; failures still revoke access.
      // Leave the auth callback before making another Supabase request.
      refreshTimer = setTimeout(() => { void loadAccess({ background: sameUser }); }, 0);
    });
    return () => {
      ++requestVersion.current;
      clearTimeout(refreshTimer);
      subscription.unsubscribe();
    };
  }, [loadAccess]);

  return { access, loading, error, refresh };
}
