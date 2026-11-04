'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Download, ExternalLink, FileText, Loader2, Printer, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import InvoiceDetailsModal from '@/components/crm/InvoiceDetailsModal';
import type { Document } from './SaldeoDeliveryPanel';
import { invoicePdfFileName } from '@/lib/invoices/print/invoicePrintData';

type Props = { item: Document; onClose: () => void };
type Row = Record<string, any>;
type StoredFile = { bucket: string; path: string; filename: string };
type LoadedPreview =
  | { kind: 'file'; blob: Blob; mime: string; filename: string; notice?: string }
  | { kind: 'ksef'; invoice: Row; notice: string };
type Preview = LoadedPreview & { url?: string };

const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#e5e4e2] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--crm-field-border-focus)] disabled:opacity-40';

/** Only recognized file bytes may be embedded without an HTML sandbox. */
async function fileMime(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  const text = new TextDecoder('ascii').decode(bytes);
  if (/^%PDF-\d\.\d/.test(text)) return 'application/pdf';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (text.slice(0, 4) === 'RIFF' && text.slice(8, 12) === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

async function loadStoredFile(file: StoredFile): Promise<LoadedPreview> {
  let path = file.path;
  if (/^https?:\/\//i.test(path)) {
    const url = new URL(path);
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://invalid.local').origin;
    if (url.origin !== origin || !url.pathname.startsWith('/storage/v1/object/')) throw new Error('Plik nie znajduje się w autoryzowanym magazynie CRM.');
    const parts = url.pathname.slice('/storage/v1/object/'.length).split('/');
    if (['public', 'sign', 'authenticated'].includes(parts[0])) parts.shift();
    if (parts.shift() !== file.bucket) throw new Error('Nieprawidłowy magazyn pliku źródłowego.');
    path = decodeURIComponent(parts.join('/'));
  }
  const { data, error } = await supabase.storage.from(file.bucket).download(path);
  if (error || !data?.size) throw new Error('Nie można odczytać zapisanego pliku źródłowego.');
  const mime = await fileMime(data);
  return { kind: 'file', blob: new Blob([data], { type: mime }), mime, filename: file.filename || 'dokument' };
}

function hasCompleteKsefXml(row: Row): boolean {
  const xml = typeof row.xml_content === 'string' ? row.xml_content : '';
  if (xml.length <= 100 || /<!DOCTYPE/i.test(xml)) return false;
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  const has = (name: string) => parsed.getElementsByTagNameNS('*', name).length > 0;
  return !has('parsererror') && parsed.documentElement.localName === 'Faktura'
    && has('Podmiot1') && has('Podmiot2') && has('Fa') && has('P_2') && has('P_15');
}

async function loadPreview(item: Document): Promise<LoadedPreview> {
  const original = item.previewFile || (item.bucket && item.path ? { bucket: item.bucket, path: item.path, filename: item.filename } : null);
  let fileError = '';
  if (original) {
    try { return await loadStoredFile(original); }
    catch (cause) { fileError = cause instanceof Error ? cause.message : 'Nie można odczytać pliku źródłowego.'; }
  }
  if (item.source === 'local_invoice') {
    const { data, error } = await supabase.from('invoices').select('id,invoice_number,invoice_type,is_proforma,pdf_url').eq('id', item.id).maybeSingle();
    if (error || !data) throw new Error('Nie można odczytać pełnych danych faktury CRM.');
    if (data.pdf_url && data.pdf_url !== original?.path) {
      try { return await loadStoredFile({ bucket: 'event-files', path: data.pdf_url, filename: `Faktura_${data.invoice_number}.pdf` }); }
      catch (cause) { fileError = cause instanceof Error ? cause.message : 'Nie można odczytać zapisanego PDF.'; }
    }
    // Wydruk z serwera Next — ten sam szablon i plik co na stronie faktury (bez zapisu).
    const response = await fetch(`/bridge/invoices/invoice-pdf/preview?invoiceId=${encodeURIComponent(item.id)}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error([fileError, body?.error || 'Nie udało się przygotować wydruku faktury CRM.'].filter(Boolean).join(' '));
    }
    const blob = await response.blob();
    if ((await fileMime(blob)) !== 'application/pdf') throw new Error('Serwer nie zwrócił pliku PDF faktury.');
    return {
      kind: 'file', blob: new Blob([blob], { type: 'application/pdf' }), mime: 'application/pdf',
      filename: invoicePdfFileName(data.invoice_number, data.invoice_type === 'proforma' || Boolean(data.is_proforma)),
      notice: [fileError, 'Aktualny wydruk faktury CRM przygotowany na serwerze tym samym szablonem co PDF faktury. To nie jest zapisany oryginał. Podgląd niczego nie zmienia ani nie zapisuje.'].filter(Boolean).join(' '),
    };
  }
  let ksefId = item.source === 'ksef' ? item.id : '';
  let ksefReference = '';
  if (item.source === 'external_invoice' && item.ksefReference) {
    const { data, error } = await supabase.from('external_invoices').select('*').eq('id', item.id).maybeSingle();
    if (error || !data) throw new Error('Nie można odczytać dokumentu źródłowego.');
    ksefId = String(data.ksef_invoice_id || '');
    ksefReference = String(data.ksef_reference_number || data.ksef_number || '');
  }
  if (ksefId || ksefReference) {
    const query = supabase.from('ksef_invoices').select('*');
    const { data, error } = await (ksefId ? query.eq('id', ksefId) : query.eq('ksef_reference_number', ksefReference)).maybeSingle();
    if (error || !data) throw new Error('Nie można odczytać źródłowej faktury KSeF.');
    if (!hasCompleteKsefXml(data)) throw new Error([fileError, 'Brak kompletnego, poprawnego XML KSeF i dostępnego pliku źródłowego. Podgląd nie zostanie odtworzony z samych kwot. Uzupełnij dane faktury w sekcji KSeF.'].filter(Boolean).join(' '));
    return { kind: 'ksef', invoice: data, notice: [fileError, 'Wizualizacja faktury z zapisanego XML KSeF. To nie jest oryginalny plik PDF. Podgląd jest tylko do odczytu.'].filter(Boolean).join(' ') };
  }
  throw new Error(fileError || 'Ten dokument nie ma zapisanego pliku źródłowego do podglądu.');
}

export default function MonthlyDocumentPreviewModal({ item, onClose }: Props) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const close = () => onCloseRef.current();

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (element && !element.open) element.showModal();
    closeButton.current?.focus();
    return () => {
      if (element?.open) element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setPreview(null); setError(''); setLoading(true);
    void loadPreview(item).then((result) => {
      if (!active) return;
      if (result.kind === 'file') objectUrl = URL.createObjectURL(result.blob);
      setPreview({ ...result, url: objectUrl || undefined });
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Nie udało się otworzyć podglądu.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [item.key, item.id, item.source, item.ksefReference, item.bucket, item.path, item.filename, item.previewFile?.bucket, item.previewFile?.path, item.previewFile?.filename, revision]);

  const printPreview = () => {
    if (preview?.kind === 'ksef') window.print();
  };

  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }} className="m-auto h-[92dvh] max-h-[92dvh] w-[min(1180px,calc(100vw-24px))] max-w-none overflow-hidden rounded-2xl border-0 bg-[var(--brand-burgundy-950)] p-0 text-[#e5e4e2] shadow-2xl backdrop:bg-black/75 open:flex open:flex-col">
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 bg-[var(--brand-burgundy-800)] px-4 py-3 sm:px-5 print:hidden">
      <div className="min-w-0 flex-1"><h2 id={titleId} className="flex items-center gap-2 font-atom text-lg uppercase"><FileText size={18} className="shrink-0 text-[var(--brand-gold)]" />Podgląd dokumentu</h2><p className="mt-1 break-words text-sm [overflow-wrap:anywhere]">{item.number}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {preview?.kind === 'file' && preview.url && <>
          <a className={buttonClass} href={preview.url} download={preview.filename}><Download size={16} />{preview.notice ? 'Pobierz PDF' : 'Pobierz oryginał'}</a>
          {preview.mime === 'application/pdf' && <a className={buttonClass} href={preview.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />Otwórz PDF</a>}
        </>}
        {preview?.kind === 'ksef' && <button type="button" onClick={printPreview} className={buttonClass}><Printer size={16} />Drukuj / zapisz wizualizację jako PDF</button>}
        <button ref={closeButton} type="button" onClick={close} className={`${buttonClass} !p-2`} aria-label="Zamknij podgląd dokumentu"><X size={20} /></button>
      </div>
    </header>
    <div className="min-h-0 flex-1 overflow-auto">
      {loading && <p role="status" className="flex items-center gap-3 p-6 text-sm"><Loader2 size={20} className="animate-spin text-[var(--brand-gold)]" />Wczytywanie dokumentu źródłowego…</p>}
      {error && <div role="alert" className="space-y-4 p-6"><p className="max-w-3xl text-sm leading-6 text-amber-200">{error}</p><button type="button" onClick={() => setRevision((value) => value + 1)} className={buttonClass}>Spróbuj ponownie</button></div>}
      {preview?.kind === 'file' && preview.url && <div className="flex h-full min-h-[300px] flex-col">
        <p className="shrink-0 px-4 py-2 text-xs text-[#e5e4e2]/60 print:hidden">{preview.notice || 'Oryginał pliku zapisany w CRM. Podgląd nie zmienia dokumentu.'}</p>
        {preview.mime === 'application/pdf' ? <iframe src={preview.url} title={`Faktura ${item.number}`} className="min-h-[300px] w-full flex-1 border-0 bg-white" /> : ['image/png', 'image/jpeg', 'image/webp'].includes(preview.mime) ? <div className="min-h-0 flex-1 overflow-auto p-3"><img src={preview.url} alt={`Dokument ${item.number}`} className="mx-auto h-auto max-w-full rounded-lg object-contain" /></div> : <p className="p-5 text-sm text-[#e5e4e2]/65">Plik nie jest rozpoznanym PDF-em ani obsługiwanym obrazem. Możesz pobrać oryginał powyżej; nie wyświetlamy nieznanego formatu jako faktury.</p>}
      </div>}
      {preview?.kind === 'ksef' && <><p className="px-4 py-3 text-xs leading-5 text-[#e5e4e2]/65 print:hidden">{preview.notice}</p><InvoiceDetailsModal key={item.key} invoice={preview.invoice} embedded readOnly onClose={close} /></>}
    </div>
  </dialog>;
}
