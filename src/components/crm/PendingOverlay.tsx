'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

/*
 * Okno postępu nad stroną (jak `PendingOverlay` na Macu): od razu blokuje kliknięcia (np. drugie „Zatwierdź”), a po 180 ms
 * pokazuje kółko, nazwę czynności i „Proszę czekać” — szybkie czynności nie migają. Znika po odpowiedzi serwera i odświeżeniu.
 */
export default function PendingOverlay({ text }: { text: string | null }) {
  const active = Boolean(text);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 180);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!text) return null;
  return (
    <div
      role="alertdialog"
      aria-busy="true"
      aria-live="polite"
      aria-label={text}
      className={`fixed inset-0 z-[10000] flex items-center justify-center transition-colors duration-150 ${visible ? 'bg-black/30' : 'bg-transparent'}`}
    >
      {visible && (
        <div className="flex min-w-[280px] max-w-sm flex-col items-center gap-3 rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] px-8 py-6 text-center shadow-2xl shadow-black/50">
          <Loader2 className="h-7 w-7 animate-spin text-[#d3bb73]" />
          <p className="text-sm font-medium text-[#e5e4e2]">{text}</p>
          <p className="text-xs text-[#e5e4e2]/55">Proszę czekać — czekamy na potwierdzenie serwera.</p>
        </div>
      )}
    </div>
  );
}
