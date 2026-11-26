'use client';

import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';

/*
 * Komunikator na pasku obok dzwonka: licznik nieprzeczytanych i otwieranie / zamykanie panelu `ChatWidget` (zdarzenia
 * `crm-chat-state`, `crm-chat-sync`, `crm-chat-toggle`). Zawsze dostępny — także gdy przycisk w rogu jest ukryty.
 */
export default function ChatHeaderButton() {
  const [state, setState] = useState({ active: false, count: 0, open: false });

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ active: boolean; count: number; open: boolean }>).detail;
      if (detail) setState({ active: detail.active, count: detail.count, open: detail.open });
    };
    window.addEventListener('crm-chat-state', update);
    window.dispatchEvent(new Event('crm-chat-sync'));
    return () => window.removeEventListener('crm-chat-state', update);
  }, []);

  if (!state.active) return null;

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('crm-chat-toggle'))}
      aria-label="Komunikator"
      aria-pressed={state.open}
      title={state.count > 0 ? `Komunikator — nieprzeczytane: ${state.count}` : 'Komunikator'}
      className={`relative rounded-lg p-1.5 transition-colors hover:bg-[#1c1f33] md:p-2 ${state.open ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'}`}
    >
      <MessageCircle className="h-5 w-5 md:h-6 md:w-6" />
      {state.count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
          {state.count > 99 ? '99+' : state.count}
        </span>
      )}
    </button>
  );
}
