'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FlaskConical, Loader2, LogOut } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import {
  TEST_MODE_COOKIE, decodeTestModeLabel, readCookie, setTestModeNavigation, testModeNavigating, type TestModeLabel,
} from '@/lib/testMode/shared';

/*
 * Pasek trybu testowego „widok jako” (`docs/test-mode.md`) — zawsze na środku u góry (CRM i portal sprzedawcy): kogo oglądamy,
 * informacja, że zmiany nie są zapisywane, i „Wyjdź z trybu”. Wylogowanie w trybie testowym też kończy tryb (wraca sesja
 * administratora).
 */

export default function TestModeBar() {
  const [label, setLabel] = useState<TestModeLabel | null>(null);
  const [exiting, setExiting] = useState(false);
  const exitingRef = useRef(false);

  useEffect(() => {
    setLabel(decodeTestModeLabel(readCookie(document.cookie, TEST_MODE_COOKIE)));
    // Inne karty: po wejściu w tryb albo wyjściu z niego (zmiana ciasteczka) przeładowanie — klient Supabase w karcie musi
    // działać w tym samym trybie co ciasteczko sesji.
    const startedInTestMode = Boolean(readCookie(document.cookie, TEST_MODE_COOKIE));
    const check = () => {
      if (exitingRef.current || testModeNavigating()) return;
      if (Boolean(readCookie(document.cookie, TEST_MODE_COOKIE)) !== startedInTestMode) window.location.reload();
    };
    const timer = window.setInterval(check, 2000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  const exit = useCallback(async () => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    setTestModeNavigation(true);
    setExiting(true);
    let landing = '/crm/settings?tab=test';
    try {
      const response = await fetch('/bridge/test-mode/exit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const body = (await response.json().catch(() => null)) as { landing?: string } | null;
      if (body?.landing === '/login' || body?.landing === '/crm/settings?tab=test') landing = body.landing;
    } catch {
      landing = '/login';
    }
    window.location.assign(landing);
  }, []);

  useEffect(() => {
    if (!label) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') void exit();
    });
    return () => data.subscription.unsubscribe();
  }, [exit, label]);

  if (!label) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[2147483000] flex justify-center px-3"
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-amber-300/60 bg-[#2a1d05]/95 py-1.5 pl-4 pr-1.5 text-sm text-amber-100 shadow-2xl shadow-black/50 backdrop-blur">
        <FlaskConical className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
        <span className="min-w-0 truncate">
          <span className="font-medium uppercase tracking-wide text-amber-300">Tryb testowy</span>
          <span className="text-amber-100/90"> · widok: {label.label || (label.kind === 'seller' ? 'sprzedawca zewnętrzny' : 'pracownik')}</span>
          <span className="hidden text-amber-100/60 md:inline"> · zmiany nie są zapisywane</span>
        </span>
        <button
          type="button"
          onClick={() => void exit()}
          disabled={exiting}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-300 px-3 py-1.5 text-xs font-semibold text-[#1c1405] hover:bg-amber-200 disabled:opacity-60"
        >
          {exiting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
          Wyjdź z trybu
        </button>
      </div>
    </div>
  );
}
