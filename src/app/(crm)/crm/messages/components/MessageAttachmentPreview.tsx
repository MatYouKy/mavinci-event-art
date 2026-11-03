'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import OverlayPortal from '@/components/UI/OverlayPortal';
import { supabase } from '@/lib/supabase/browser';
import { attachmentPreview, matchesPreviewBytes } from '@/lib/CRM/messages/attachmentPreview';
import type { EmailAttachment } from '@/store/api/messagesApi';

export default function MessageAttachmentPreview(props: { attachment: EmailAttachment; onClose: () => void }) {
  // Mount the dialog after the portal exists, so showModal sets native focus
  // trapping, Escape handling and focus restoration on close.
  return <OverlayPortal><PreviewDialog {...props} /></OverlayPortal>;
}

function PreviewDialog({ attachment, onClose }: { attachment: EmailAttachment; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<{ url: string; valid: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const format = attachmentPreview(attachment.filename, attachment.content_type);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element?.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  useEffect(() => {
    let disposed = false;
    let url: string | null = null;
    setFile(null); setError(null);
    void (async () => {
      try {
        const { data, error } = await supabase.storage.from('email-attachments').download(attachment.storage_path);
        if (error || !data) throw new Error();
        const head = new Uint8Array(await data.slice(0, 16).arrayBuffer());
        if (disposed) return;
        const valid = Boolean(format && matchesPreviewBytes(head, format.mime));
        // Explicit MIME prevents archives saved as octet-stream from triggering
        // a download inside the PDF frame. A mismatched file is download-only.
        url = URL.createObjectURL(new Blob([data], { type: valid ? format!.mime : 'application/octet-stream' }));
        setFile({ url, valid });
      } catch { if (!disposed) setError('Nie udało się pobrać załącznika. Spróbuj ponownie.'); }
    })();
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [attachment.storage_path, format?.mime, attempt]);

  const button = 'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/10 focus-visible:bg-white/10';
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); onClose(); }}
    aria-labelledby="mail-attachment-title"
    className="fixed inset-0 m-auto h-[90dvh] max-h-[90dvh] w-[96vw] max-w-6xl overflow-hidden rounded-xl bg-[var(--surface-1,#210811)] p-0 text-[var(--text-primary,#e5e4e2)] shadow-2xl backdrop:bg-black/70">
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 bg-white/[0.04] p-3">
        <h2 id="mail-attachment-title" className="min-w-0 flex-1 truncate text-sm font-medium" title={attachment.filename}>{attachment.filename}</h2>
        {file && <a href={file.url} download={attachment.filename} className={button}><Download className="h-4 w-4" />Pobierz</a>}
        <button type="button" onClick={onClose} className={button} aria-label="Zamknij podgląd"><X className="h-5 w-5" /></button>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-2">
        {error ? <div role="alert" className="space-y-3 p-6 text-center"><p>{error}</p><button type="button" className={button} onClick={() => setAttempt(value => value + 1)}>Spróbuj ponownie</button></div>
          : !file ? <p role="status" className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />Wczytywanie załącznika…</p>
          : !file.valid ? <p className="p-6 text-center">Ten plik nie obsługuje szybkiego podglądu. Użyj przycisku „Pobierz”.</p>
          : format?.kind === 'pdf' ? <iframe src={file.url + '#toolbar=1&navpanes=0'} title={`Podgląd PDF: ${attachment.filename}`} className="h-full w-full rounded bg-white" />
          : <img src={file.url} alt={attachment.filename} className="max-h-full max-w-full object-contain" onError={() => setFile(current => current ? { ...current, valid: false } : current)} />}
      </div>
    </div>
  </dialog>;
}
