'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MailCheck } from 'lucide-react';

export function InboxContextMenu({ children, accountName, disabled, onMarkAllRead }: {
  children: ReactNode;
  accountName: string;
  disabled: boolean;
  onMarkAllRead: () => void;
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const restoreFocus = () => triggerRef.current?.querySelector('button')?.focus();
  const open = (x: number, y: number) => {
    if (!disabled) setPosition({
      x: Math.max(8, Math.min(x, window.innerWidth - 320)),
      y: Math.max(8, Math.min(y, window.innerHeight - 100)),
    });
  };

  useEffect(() => {
    if (!position) return;
    menuRef.current?.querySelector('button')?.focus();
    const close = () => setPosition(null);
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        close();
        restoreFocus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keyboard);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [position]);

  return (
    <div ref={triggerRef}
      onContextMenu={event => {
        event.preventDefault();
        open(event.clientX, event.clientY);
      }}
      onKeyDown={event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          open(rect.left + 16, rect.bottom);
        }
      }}
    >
      {children}
      {position && createPortal(
        <div ref={menuRef} role="menu" aria-label={`Odebrane — ${accountName}`}
          className="fixed z-[100] w-[312px] max-w-[calc(100vw-16px)] rounded-lg border border-white/10 bg-[#25283b] p-1.5 text-[#e5e4e2] shadow-xl"
          style={{ left: position.x, top: position.y }}
        >
          <div className="truncate px-2.5 py-1 text-xs text-[#e5e4e2]/50">{accountName} · Odebrane</div>
          <button type="button" role="menuitem" disabled={disabled}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-white/5 focus:bg-white/10 focus:outline-none disabled:opacity-50"
            onClick={() => { setPosition(null); restoreFocus(); onMarkAllRead(); }}
          >
            <MailCheck className="h-4 w-4 shrink-0" />
            Oznacz wszystkie jako odczytane
          </button>
        </div>, document.body,
      )}
    </div>
  );
}
