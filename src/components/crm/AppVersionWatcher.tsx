'use client';

import { useEffect, useState } from 'react';

const CURRENT = process.env.NEXT_PUBLIC_APP_BUILD || '';
const CHECK_EVERY_MS = 5 * 60 * 1000;

/**
 * Nowa wersja CRM po wdrożeniu: karta ze starszym kodem pokazuje pasek „Odśwież”. Bez samoczynnego przeładowania —
 * w karcie może być niezapisany formularz. Sprawdzenie przy powrocie do karty i co 5 minut, gdy karta jest widoczna.
 * Dzięki temu nikt nie pracuje dniami na starym kodzie (np. ze starym adresem bazy danych).
 */
export default function AppVersionWatcher() {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    if (!CURRENT) return;
    let stale = false;
    let busy = false;

    const check = async () => {
      if (busy || stale || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const response = await fetch('/bridge/app-version', { cache: 'no-store' });
        if (!response.ok) return;
        const { build } = (await response.json()) as { build?: string | null };
        if (build && build !== CURRENT) {
          stale = true;
          setOutdated(true);
        }
      } catch {
        // Brak sieci — sprawdzimy przy następnej okazji.
      } finally {
        busy = false;
      }
    };

    void check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  if (!outdated) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-[#d3bb73]/40 bg-[#1c1f33] px-4 py-3 text-sm text-[#e5e4e2] shadow-2xl"
    >
      <span>Jest nowa wersja CRM. Zapisz zmiany i odśwież stronę.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-lg bg-[#d3bb73] px-3 py-1.5 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
      >
        Odśwież
      </button>
    </div>
  );
}
