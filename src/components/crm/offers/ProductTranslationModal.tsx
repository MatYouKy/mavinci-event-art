'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';

export default function ProductTranslationModal({ busy, error, operation, canRetry, onRetry, onClose }: {
  busy: boolean; error: string; operation: 'read' | 'generate' | 'save'; canRetry: boolean;
  onRetry: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const headingId = useId();
  const descriptionId = useId();
  const [elapsed, setElapsed] = useState(0);
  const open = busy || Boolean(error);
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !mounted || !open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal();
    return () => {
      element.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, mounted]);
  const title = !busy ? 'Nie udało się ukończyć operacji' : operation === 'read'
    ? 'Wczytujemy wersję angielską' : operation === 'save' ? 'Zapisujemy treść angielską' : 'Tłumaczymy produkt na angielski';
  const description = operation === 'generate'
    ? 'AI opracowuje angielską treść na podstawie zapisanej wersji polskiej. Przy rozbudowanym produkcie może to potrwać kilka minut.'
    : operation === 'save' ? 'Czekamy na potwierdzenie zapisu zmian w wersji EN.' : 'Sprawdzamy zapisane tłumaczenia. Brakujące teksty zostaną przygotowane automatycznie.';
  if (!mounted) return null;
  return createPortal(<dialog ref={dialog} aria-labelledby={headingId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    style={{ position: 'fixed', top: '50%', left: '50%', right: 'auto', bottom: 'auto', margin: 0, transform: 'translate(-50%, -50%)', maxHeight: 'calc(100dvh - 2rem)' }}
    className="w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-2xl border-0 bg-[#3e1426] p-6 text-[#e5e4e2] shadow-2xl backdrop:bg-black/65 backdrop:backdrop-blur-sm">
    <div className="flex items-center gap-3">
      {busy ? <Loader2 aria-hidden="true" className="h-6 w-6 shrink-0 animate-spin text-[#d3bb73]" />
        : <AlertCircle aria-hidden="true" className="h-6 w-6 shrink-0 text-amber-200" />}
      <h2 id={headingId} className="text-lg font-semibold">{title}</h2>
    </div>
    <div id={descriptionId} className="mt-4 text-sm leading-relaxed text-white/75" aria-live="polite">
      {busy ? description : error}
    </div>
    {busy ? <>
      <p className="mt-4 text-sm text-[#d3bb73]" aria-hidden="true">Czas oczekiwania: {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</p>
      {elapsed >= 30 && <p role="status" className="mt-2 text-sm text-white/60">Nadal czekamy na odpowiedź. Po przekroczeniu limitu pojawi się komunikat z dalszymi krokami.</p>}
    </> : <>
      {operation === 'save' && <p className="mt-3 text-sm text-white/60">Edycja pozostaje otwarta. Po zamknięciu tego komunikatu możesz ponowić zapis. Jeśli zapis został już przyjęty, odśwież treść EN.</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg bg-white/5 px-4 py-2 hover:bg-white/10">Zamknij</button>
        {canRetry && <button type="button" onClick={onRetry} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#24101a] hover:bg-[#e1ca86]">Spróbuj ponownie</button>}
      </div>
    </>}
  </dialog>, document.body);
}
