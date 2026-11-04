'use client';
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import OverlayPortal from '@/components/UI/OverlayPortal';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Okno kroków realizacji: role=dialog, aria-modal, Escape zamyka, fokus w środku i powrót fokusu po zamknięciu. */
export default function EventStepDialog({
  open,
  title,
  description,
  onClose,
  busy = false,
  wide = false,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Portal montuje się po pierwszym renderze — próbujemy ustawić fokus przez kilka klatek.
    let frame = 0;
    let attempts = 0;
    const focusPanel = () => {
      const panel = panelRef.current;
      if (!panel) {
        if (attempts++ < 10) frame = requestAnimationFrame(focusPanel);
        return;
      }
      const preferred = panel.querySelector<HTMLElement>('[data-autofocus]');
      (preferred ?? panel).focus();
    };
    frame = requestAnimationFrame(focusPanel);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busyRef.current) closeRef.current();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      element => element.offsetParent !== null || element === document.activeElement,
    );
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <OverlayPortal>
      <div
        data-app-overlay="true"
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        onMouseDown={event => {
          if (event.target === event.currentTarget && !busyRef.current) closeRef.current();
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          aria-busy={busy}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-[#1c1f33] text-[#e5e4e2] shadow-2xl outline-none sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
        >
          <header className="flex shrink-0 items-start justify-between gap-3 bg-white/[0.03] px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="break-words text-lg font-medium text-[#e5e4e2]">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-[#e5e4e2]/60">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                if (!busyRef.current) closeRef.current();
              }}
              disabled={busy}
              aria-label="Zamknij okno"
              className="shrink-0 rounded-lg p-1.5 text-[#e5e4e2]/70 hover:bg-white/5 hover:text-[#d3bb73] disabled:opacity-40"
            >
              <X className="h-5 w-5" />
            </button>
          </header>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        </div>
      </div>
    </OverlayPortal>
  );
}
