'use client';
import { useEffect, useRef, useState } from 'react';
import { FileImage, Loader2, RefreshCw } from 'lucide-react';

type Props = { endpoint: string; ready: boolean; title: string; organization: string; primary: string; accent: string; logo: string; cover: string };
export default function DemoCoverPreview({ endpoint, ready, ...input }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [displayed, setDisplayed] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify(input);
  const updating = displayed !== key;

  useEffect(() => {
    if (!ready) return;
    let stale = false;
    setError('');
    // Debounce edits and serialize requests: rapid changes coalesce into the
    // latest cover without rendering stale responses over a newer preview.
    const timer = setTimeout(() => {
      queue.current = queue.current.catch(() => {}).then(async () => {
        if (stale) return;
        let document: import('pdfjs-dist').PDFDocumentProxy | undefined;
        try {
          const response = await fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'preview', input: JSON.parse(key) }), signal: AbortSignal.timeout(100000),
          });
          if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Nie udało się wczytać okładki.'); }
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (stale) return;
          const pdfjs = await import('pdfjs-dist');
          // Match the existing PDF viewer: Next 14 cannot resolve this ESM worker via new URL(package, import.meta.url).
          pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
          document = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
          if (document.numPages !== 1) throw new Error('Podgląd musi zawierać wyłącznie okładkę.');
          const page = await document.getPage(1);
          const canvas = window.document.createElement('canvas');
          const viewport = page.getViewport({ scale: 1.8 });
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Nie udało się wyświetlić okładki.');
          await page.render({ canvasContext: context, viewport }).promise;
          if (stale || !holder.current) return;
          canvas.className = 'block h-auto w-full';
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', 'Pierwsza strona Twojej oferty — rzeczywista okładka PDF');
          holder.current.replaceChildren(canvas);
          setDisplayed(key);
        } catch (cause) {
          if (!stale) setError(cause instanceof Error ? cause.message : 'Nie udało się wyświetlić okładki.');
        } finally { await document?.destroy(); }
      });
    }, 1000);
    return () => { stale = true; clearTimeout(timer); };
  }, [endpoint, ready, key, retry]);

  return <section aria-label="Podgląd pierwszej strony oferty">
    <div className="mb-3 flex items-center justify-between gap-3 text-xs text-white/70"><span className="flex items-center gap-2"><FileImage className="h-4 w-4 text-[var(--brand-gold)]"/>Okładka Twojej oferty</span><span className="text-white/45">Strona 01 · A4</span></div>
    <div className="relative overflow-hidden rounded-sm bg-[var(--brand-burgundy-900)] shadow-2xl" style={{aspectRatio:'595.28 / 841.89'}} aria-busy={updating&&!error}>
      <div ref={holder}/>
      {!displayed&&<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-sm text-white/65">{!error&&<Loader2 className="h-6 w-6 animate-spin text-[var(--brand-gold)]"/>}<p>{error?'Podgląd okładki jest chwilowo niedostępny.':ready?'Przygotowujemy okładkę Twojej oferty…':'Otwieramy demonstrację…'}</p></div>}
      {displayed&&updating&&<div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-[var(--brand-burgundy-900)]/95 px-4 py-3 text-xs text-white">{!error&&<Loader2 className="h-3 w-3 animate-spin"/>}{error?'Widoczna jest poprzednia wersja okładki.':'Aktualizowanie okładki…'}</div>}
    </div>
    {error?<div role="alert" className="mt-3 text-xs leading-5 text-[#f3dca0]"><p>{error}</p><button type="button" onClick={()=>setRetry(v=>v+1)} className="mt-2 inline-flex items-center gap-2 text-[var(--brand-gold)]"><RefreshCw className="h-3 w-3"/>Ponów podgląd</button></div>:<p role="status" className="mt-3 text-xs leading-5 text-white/55">{updating?'Okładka odświeży się automatycznie po zmianie tytułu, logo, zdjęcia, nazwy lub kolorów.':'To rzeczywista pierwsza strona PDF, dopasowana do szerokości ekranu.'}</p>}
  </section>;
}
