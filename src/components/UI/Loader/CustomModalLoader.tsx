'use client';

import { useEffect, useId, useRef } from 'react';
import OverlayPortal from '../OverlayPortal';
import { Loader2 } from 'lucide-react';

interface FullScreenLoaderProps {
  show: boolean;
  title?: string;
  description?: string;
}

function LoadingDialog({ title, description }: { title: string; description: string }) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const containFocus = (event: FocusEvent) => {
      if (dialog.current && !dialog.current.contains(event.target as Node)) dialog.current.focus();
    };
    const blockNavigation = (event: KeyboardEvent) => {
      if (event.key === 'Tab' || event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        dialog.current?.focus();
      }
    };
    document.addEventListener('focusin', containFocus);
    document.addEventListener('keydown', blockNavigation, true);
    return () => {
      document.removeEventListener('focusin', containFocus);
      document.removeEventListener('keydown', blockNavigation, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div data-app-overlay="true" className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} className="flex w-full max-w-lg flex-col items-center gap-4 rounded-2xl border border-white/5 bg-[#1c1f33] px-8 py-7 shadow-2xl outline-none">
        <Loader2 aria-hidden="true" className="h-9 w-9 animate-spin text-[#d3bb73]" />
        <div className="min-w-0 w-full text-center">
          <div id={titleId} className="text-base font-medium text-[#e5e4e2]">{title}</div>
          <div id={descriptionId} role="status" aria-live="polite" className="mt-1 break-words text-sm text-[#e5e4e2]/50">{description}</div>
        </div>
      </div>
    </div>
  );
}

export default function FullScreenLoader({ show, title = 'Ładowanie', description = 'Proszę chwilę poczekać...' }: FullScreenLoaderProps) {
  return show ? <OverlayPortal><LoadingDialog title={title} description={description} /></OverlayPortal> : null;
}
