'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import OverlayPortal from '../OverlayPortal';
import { Loader2, CircleAlert } from 'lucide-react';

interface FullScreenLoaderProps {
  show: boolean;
  title?: string;
  description?: string;
  children?: ReactNode;
  failed?: boolean;
  onClose?: () => void;
}

function LoadingDialog({ title, description, children, failed = false, onClose }: { title: string; description: string; children?: ReactNode; failed?: boolean; onClose?: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
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
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (failed) closeRef.current?.();
        return;
      }
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]') || []);
        if (!controls.length) { event.preventDefault(); dialog.current?.focus(); return; }
        const first = controls[0]; const last = controls[controls.length - 1];
        if (document.activeElement === dialog.current || !dialog.current?.contains(document.activeElement)) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
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
  }, [failed]);
  return (
    <div data-app-overlay="true" className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} className="flex max-h-[90dvh] w-full max-w-lg overflow-y-auto flex-col items-center gap-4 rounded-2xl border border-white/5 bg-[#1c1f33] px-8 py-7 shadow-2xl outline-none">
        {failed ? <CircleAlert aria-hidden="true" className="h-9 w-9 shrink-0 text-red-300" /> : <Loader2 aria-hidden="true" className="h-9 w-9 shrink-0 animate-spin text-[#d3bb73]" />}
        <div className="min-w-0 w-full text-center">
          <div id={titleId} className="text-base font-medium text-[#e5e4e2]">{title}</div>
          <div id={descriptionId} role="status" aria-live="polite" className="mt-1 break-words text-sm text-[#e5e4e2]/50">{description}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function FullScreenLoader({ show, title = 'Ładowanie', description = 'Proszę chwilę poczekać...', children, failed, onClose }: FullScreenLoaderProps) {
  return show ? <OverlayPortal><LoadingDialog title={title} description={description} failed={failed} onClose={onClose}>{children}</LoadingDialog></OverlayPortal> : null;
}
