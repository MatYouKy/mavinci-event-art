'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, BadgeCheck, Download, ExternalLink, FileSearch, Loader2, Printer, RefreshCw } from 'lucide-react';

/**
 * Podgląd wydruku faktury: strony prawdziwego PDF-a (ten sam plik, który się pobiera, drukuje,
 * wysyła e-mailem i zapisuje w dokumentach) — nie osobna makieta HTML.
 * Wzorowane na podglądzie wydruku z aplikacji Wodawo dla macOS: podpis w kolorze tonu,
 * liczba stron, „Otwórz podgląd”, „Pobierz PDF”, „Drukuj” i odświeżenie.
 */

export type InvoicePrintTone = 'warn' | 'done' | 'info';

type CachedPrint = { blob: Blob; url: string; pages: number | null };

// Pobrane wydruki (klucz: faktura i rewizja) — ponowne wejście na fakturę nie generuje PDF drugi raz.
const printCache = new Map<string, CachedPrint>();
const MAX_CACHED = 12;

const previewUrl = (invoiceId: string, download = false) =>
  `/bridge/invoices/invoice-pdf/preview?invoiceId=${encodeURIComponent(invoiceId)}${download ? '&download=1' : ''}`;

const pagesLabel = (count: number) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = count === 1 ? 'strona' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'strony' : 'stron';
  return `${count} ${word}`;
};

const toneStyles: Record<InvoicePrintTone, string> = {
  warn: 'bg-amber-400/10 text-amber-300',
  done: 'bg-emerald-400/10 text-emerald-300',
  info: 'bg-sky-400/10 text-sky-300',
};

const buttonClass =
  'inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#e5e4e2] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d3bb73]/40 disabled:opacity-40';

function ToneIcon({ tone }: { tone: InvoicePrintTone }) {
  if (tone === 'warn') return <AlertTriangle className="h-4 w-4" aria-hidden />;
  if (tone === 'done') return <BadgeCheck className="h-4 w-4" aria-hidden />;
  return <FileSearch className="h-4 w-4" aria-hidden />;
}

export default function InvoicePrintPreview({
  invoiceId,
  revision,
  caption,
  tone,
  fileName,
  height = 900,
  className = '',
}: {
  invoiceId: string;
  /** Zmiana rewizji (np. `updated_at` faktury) = nowy wydruk z serwera. */
  revision: string;
  caption: string;
  tone: InvoicePrintTone;
  fileName: string;
  height?: number;
  className?: string;
}) {
  const cacheKey = `${invoiceId}#${revision}`;
  const [print, setPrint] = useState<CachedPrint | null>(() => printCache.get(cacheKey) ?? null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const printFrame = useRef<HTMLIFrameElement | null>(null);
  const request = useRef(0);

  const load = useCallback(
    async (force: boolean) => {
      const cached = printCache.get(cacheKey);
      if (!force && cached) {
        setPrint(cached);
        setFailure(null);
        return;
      }
      const ticket = ++request.current;
      if (!force) setPrint(null);
      setLoading(true);
      try {
        const response = await fetch(previewUrl(invoiceId), { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(
            body?.error ||
              (response.status === 401
                ? 'Sesja wygasła. Zaloguj się ponownie.'
                : response.status >= 500
                  ? 'Serwer chwilowo nie przygotował wydruku. Spróbuj ponownie.'
                  : 'Nie udało się pobrać wydruku faktury.'),
          );
        }
        const blob = await response.blob();
        if (blob.type && blob.type !== 'application/pdf') throw new Error('Serwer nie zwrócił pliku PDF.');
        const pages = Number(response.headers.get('X-Pdf-Pages')) || null;
        if (ticket !== request.current) return;
        const entry: CachedPrint = { blob, url: URL.createObjectURL(blob), pages };
        const previous = printCache.get(cacheKey);
        printCache.set(cacheKey, entry);
        if (previous && previous.url !== entry.url) URL.revokeObjectURL(previous.url);
        while (printCache.size > MAX_CACHED) {
          const [oldestKey, oldest] = printCache.entries().next().value as [string, CachedPrint];
          printCache.delete(oldestKey);
          URL.revokeObjectURL(oldest.url);
        }
        setPrint(entry);
        setFailure(null);
      } catch (error) {
        if (ticket !== request.current) return;
        setFailure(error instanceof Error ? error.message : 'Nie udało się pobrać wydruku faktury.');
      } finally {
        if (ticket === request.current) setLoading(false);
      }
    },
    [cacheKey, invoiceId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const download = () => {
    if (!print) return;
    const link = document.createElement('a');
    link.href = print.url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const printDocument = () => {
    if (!print) return;
    const frame = printFrame.current;
    if (!frame) return;
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(print.url, '_blank', 'noopener');
      }
    };
    frame.src = print.url;
  };

  const openPreview = () => {
    window.open(print?.url || previewUrl(invoiceId), '_blank', 'noopener');
  };

  return (
    <section className={`flex flex-col gap-3 ${className}`} aria-label="Podgląd wydruku faktury">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${toneStyles[tone]}`}>
          <ToneIcon tone={tone} />
          {caption}
        </span>
        <span className="ml-auto text-sm text-[#e5e4e2]/60">
          {print?.pages ? pagesLabel(print.pages) : loading ? 'Przygotowanie wydruku…' : ''}
        </span>
      </div>

      <div
        className="relative w-full overflow-hidden rounded-xl bg-[#2a2d3a] shadow-lg shadow-black/20"
        style={{ height }}
      >
        {print ? (
          <iframe
            key={print.url}
            src={`${print.url}#toolbar=0&navpanes=0&view=FitH`}
            title={`Wydruk: ${fileName}`}
            className="h-full w-full border-0"
          />
        ) : failure ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-[#e5e4e2]/75">
            <AlertTriangle className="h-6 w-6 text-amber-300" aria-hidden />
            <p className="max-w-md leading-6">{failure}</p>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              className={buttonClass}
            >
              Spróbuj ponownie
            </button>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center gap-3 text-sm text-[#e5e4e2]/70">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            Przygotowanie wydruku…
          </div>
        )}
        {print && loading && (
          <div className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-full bg-[#0a0d1a]/80 px-3 py-1 text-xs text-[#e5e4e2]/80">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Odświeżanie…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={openPreview}
          className={buttonClass}
          title="Otwórz wydruk w nowej karcie (powiększenie, druk, zapis)"
        >
          <ExternalLink className="h-4 w-4" aria-hidden /> Otwórz podgląd
        </button>
        <button
          type="button"
          onClick={download}
          disabled={!print}
          className={buttonClass}
          title="Zapisz plik PDF na dysku"
        >
          <Download className="h-4 w-4" aria-hidden /> Pobierz PDF
        </button>
        <button
          type="button"
          onClick={printDocument}
          disabled={!print}
          className={buttonClass}
          title="Drukuj wydruk"
        >
          <Printer className="h-4 w-4" aria-hidden /> Drukuj
        </button>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-[#e5e4e2]/70 hover:text-[#e5e4e2] disabled:opacity-40"
          title="Przygotuj aktualny wydruk na serwerze"
          aria-label="Odśwież wydruk"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
        </button>
      </div>
      <iframe ref={printFrame} title="Drukowanie faktury" className="hidden" aria-hidden tabIndex={-1} />
    </section>
  );
}

/** Podpis podglądu według stanu faktury (KSeF, pro forma, korekta). */
export function invoicePrintCaption(invoice: {
  invoice_type?: string | null;
  is_proforma?: boolean | null;
  ksef_status?: string | null;
  ksef_reference_number?: string | null;
  buyer_is_private_person?: boolean | null;
  status?: string | null;
}): { caption: string; tone: InvoicePrintTone } {
  if (invoice.status === 'cancelled') return { caption: 'Faktura anulowana', tone: 'warn' };
  if (invoice.is_proforma || invoice.invoice_type === 'proforma') {
    return { caption: 'Pro forma — dokument informacyjny, nie jest fakturą VAT', tone: 'info' };
  }
  const ksef = (invoice.ksef_status || '').trim().toLowerCase();
  if (ksef === 'accepted' && invoice.ksef_reference_number) {
    return { caption: `Faktura w KSeF · ${invoice.ksef_reference_number}`, tone: 'done' };
  }
  if (ksef === 'pending' || ksef === 'sent') return { caption: 'Wysłano do KSeF — czeka na numer KSeF', tone: 'info' };
  if (ksef === 'rejected' || ksef === 'error') return { caption: 'KSeF nie przyjął faktury — wizualizacja robocza', tone: 'warn' };
  if (invoice.buyer_is_private_person) return { caption: 'Wizualizacja faktury dla osoby prywatnej', tone: 'info' };
  return { caption: 'Wizualizacja — faktura nie jest jeszcze w KSeF', tone: 'warn' };
}
