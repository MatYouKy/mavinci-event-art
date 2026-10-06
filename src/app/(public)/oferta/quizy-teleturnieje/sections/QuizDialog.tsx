'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function QuizDialog({ title, busy = false, onClose, children }: {
  title: string; busy?: boolean; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { dialog?.close(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-y-auto rounded-2xl bg-[#211019] p-5 text-[#e5e4e2] shadow-2xl backdrop:bg-black/80 sm:p-8">
    <div className="mb-6 flex items-start justify-between gap-4">
      <h2 id={titleId} className="text-xl uppercase sm:text-2xl">{title}</h2>
      <button type="button" disabled={busy} onClick={onClose} aria-label="Zamknij"
        className="rounded-full bg-white/5 p-3 hover:bg-white/10 disabled:opacity-50"><X size={20} /></button>
    </div>
    {children}
  </dialog>;
}
