'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/*
 * Ikona „Kopiuj” przy wartości (numer faktury, numer KSeF, NIP, rachunek, kwota): kopiuje wartość do schowka i na 1,5 s
 * pokazuje „✓” (podpowiedź „Skopiowano”). Jak `CopyValueButton` na Macu. Ukryta na wydruku.
 */

async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  // Starsze przeglądarki / okno bez uprawnienia do schowka.
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('copy failed');
}

export default function CopyValueButton({ label, value, className = '' }: { label: string; value: string | null | undefined; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!value) return null;

  const copy = async () => {
    try {
      await writeClipboard(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1500);
  };

  const title = state === 'copied' ? 'Skopiowano' : state === 'failed' ? 'Nie udało się skopiować — zaznacz tekst i użyj Ctrl+C / ⌘C' : `Kopiuj: ${label}`;
  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={title}
      aria-label={state === 'copied' ? `Skopiowano: ${label}` : `Kopiuj: ${label}`}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded align-middle text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 print:hidden ${className}`}
    >
      {state === 'copied' ? <Check className="h-3.5 w-3.5 text-green-600" aria-hidden /> : <Copy className={`h-3.5 w-3.5 ${state === 'failed' ? 'text-red-500' : ''}`} aria-hidden />}
    </button>
  );
}
