'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Download, Eye, Loader2, Printer } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { sellerOfferRequest } from '@/lib/seller/offerRequest.browser';
import { deliveryTimestamp, type SellerDocument } from '@/lib/seller/delivery';

const button = 'inline-flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:opacity-40';
export default function SellerRealizationDocuments({ offerId, documents, approvedDocumentId, clientDocumentId }: {
  offerId: string; documents: SellerDocument[]; approvedDocumentId?: string; clientDocumentId?: string;
}) {
  const searchParams = useSearchParams();
  const requested = searchParams.get('document');
  const preview = searchParams.get('preview') === '1';
  const [selected, setSelected] = useState(() => documents.find((item) => item.id === requested)?.id || approvedDocumentId || clientDocumentId || documents[0]?.id || '');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const urlRef = useRef('');
  const alive = useRef(true);
  const locked = useRef(false);
  const handledPreview = useRef('');
  const { showSnackbar } = useSnackbar();
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (urlRef.current) URL.revokeObjectURL(urlRef.current); }; }, []);
  const document = documents.find((item) => item.id === selected);
  const open = async (download: boolean) => {
    if (!document || locked.current) return;
    locked.current = true; setBusy(true);
    try {
      const blob = await sellerOfferRequest(offerId, { action: 'document', documentId: document.id, download }) as Blob;
      if (!alive.current) return;
      const next = URL.createObjectURL(blob);
      if (download) {
        const anchor = window.document.createElement('a'); anchor.href = next; anchor.download = document.filename; anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(next), 30000);
      } else {
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = next; setReady(false); setUrl(next);
      }
    } catch (error) { if (alive.current) showSnackbar(error instanceof Error ? error.message : 'Nie udało się otworzyć dokumentu.', 'error'); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  useEffect(() => {
    if (!preview || !requested || handledPreview.current === requested || !documents.some((item) => item.id === requested)) return;
    if (selected !== requested) { setSelected(requested); return; }
    handledPreview.current = requested;
    void open(false);
  }, [preview, requested, selected, documents]);
  if (!documents.length) return <p className="text-sm text-white/55">Brak zapisanych dokumentów. Skontaktuj się z opiekunem.</p>;
  return <div className="space-y-4">
    <p className="text-xs leading-5 text-white/55">Zachowane wersje oferty. Pobranie i druk nie zmieniają akceptacji. Zmianę ceny, zakresu lub terminu uzgodnij z opiekunem na czacie.</p>
    <label className="block text-xs text-white/60">Wersja dokumentu<select value={selected} disabled={busy} onChange={(event) => {
      setSelected(event.target.value); setUrl(''); setReady(false);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = '';
    }} className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2 text-sm outline-none focus:border-[#d3bb73]/30">
      {documents.map((item, index) => <option key={item.id} value={item.id}>Wersja {documents.length - index} · {deliveryTimestamp(item.created_at)}{item.id === approvedDocumentId ? ' · akceptacja opiekuna' : item.id === clientDocumentId ? ' · akceptacja klienta zgłoszona przez sprzedawcę' : item.current ? ' · aktualna' : ' · historyczna'}</option>)}
    </select></label>
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy || !document} onClick={() => void open(false)}>{busy ? <Loader2 className="h-4 w-4 animate-spin"/> : <Eye className="h-4 w-4"/>}Podgląd PDF</button>
      <button className={button} disabled={busy || !document} onClick={() => void open(true)}><Download className="h-4 w-4"/>Pobierz</button>
      <button className={button} disabled={!ready || !url || busy} onClick={() => {
        try { iframe.current?.contentWindow?.focus(); iframe.current?.contentWindow?.print(); }
        catch { showSnackbar('Otwórz PDF w nowej karcie i wybierz drukowanie w przeglądarce.', 'info'); }
      }}><Printer className="h-4 w-4"/>Drukuj</button>
    </div>
    {!url && <p className="text-xs text-white/40">Drukowanie będzie dostępne po otwarciu podglądu PDF.</p>}
    {url && <><a href={url} target="_blank" rel="noreferrer" className="block text-xs text-[#d3bb73]">Otwórz PDF w nowej karcie</a><iframe ref={iframe} onLoad={() => setReady(true)} title="Dokument realizacji" src={url} className="h-[65vh] w-full rounded-lg bg-white"/></>}
  </div>;
}
