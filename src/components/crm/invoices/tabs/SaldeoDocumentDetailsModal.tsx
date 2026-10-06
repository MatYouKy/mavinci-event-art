'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Download, Eye, FileText, Loader2, Save, X } from 'lucide-react';

export type SaldeoDocumentDetails = {
  key: string; number: string; kind: string; sourceLabel: string; date: string; dueDate: string;
  counterparty: string; currency: string; ksefReference: string; disposition: string;
  amount: number | null; note: string;
  entryType: 'document' | 'payment'; hasPaymentLink: boolean; canEditNote: boolean;
  relatedNotes: Array<{ label: string; note: string }>;
  payments: Array<{
    id: string; date: string; postingDate: string; reference: string; counterparty: string;
    title: string; currency: string; documentCurrency: string; statementName: string; note: string;
    direction: string; amount: number; allocatedAmount: number | null; documentAmount: number | null;
    collective: boolean;
    linkedDocuments?: Array<{ key: string; number: string; counterparty: string; allocatedAmount: number | null; documentAmount: number | null; currency: string }>;
  }>;
};

type Props = {
  document: SaldeoDocumentDetails; draft: string; onDraftChange: (value: string) => void;
  onSave: () => void; onClose: () => void; saving: boolean; dirty: boolean; error: string;
  preview: { url: string; mimeType: string; filename: string } | null;
  previewLoading: boolean; previewError: string; onPreview: () => void;
};

const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-gray-100 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d4bf73]/40 disabled:cursor-not-allowed disabled:opacity-40';
const sectionClass = 'min-w-0 rounded-xl bg-black/15 p-4';

function money(value: number | null, currency: string) {
  return value == null || !Number.isFinite(value) ? 'Brak zapisanej kwoty' : `${value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
function date(value: string) {
  if (!value) return 'Nie zapisano';
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="mb-1 text-xs text-gray-400">{label}</dt><dd className="whitespace-pre-wrap break-words text-sm text-gray-100 [overflow-wrap:anywhere]">{children || 'Nie zapisano'}</dd></div>;
}

export default function SaldeoDocumentDetailsModal({ document: item, draft, onDraftChange, onSave, onClose, saving, dirty, error, preview, previewLoading, previewError, onPreview }: Props) {
  const titleId = useId();
  const noteId = useId();
  const noteHelpId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); closeRef.current();
      } else if (event.key === 'Tab') {
        event.stopImmediatePropagation();
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])') || []).filter((element) => element.offsetParent !== null);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first) { event.preventDefault(); dialogRef.current?.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current || !dialogRef.current?.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [item.key]);

  const previewType = preview?.mimeType.split(';')[0].trim().toLowerCase();
  const editable = item.canEditNote && !item.hasPaymentLink;
  const isPayment = item.entryType === 'payment';

  return (
    <div className="fixed inset-0 z-[10080] flex items-center justify-center bg-black/75 p-3 sm:p-6" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={saving} tabIndex={-1} className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-[#191a29] text-gray-100 shadow-2xl outline-none ring-1 ring-white/[0.07]" style={{ fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <header className="flex items-start justify-between gap-4 bg-[#401426] px-5 py-4">
          <div className="min-w-0"><h2 id={titleId} className="text-lg font-semibold">{isPayment ? 'Płatność — wewnętrzna analiza CRM' : 'Dokument spoza KSeF — kontrola wysyłki'}</h2><p className="mt-1 break-words text-sm text-gray-100 [overflow-wrap:anywhere]">{item.number}</p><p className="mt-1 text-xs text-gray-300">Źródło: {item.sourceLabel}</p></div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Zamknij szczegóły pozycji" className={`${buttonClass} !p-2`}><X size={20} /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <section className={sectionClass} aria-label={isPayment ? 'Dane płatności' : 'Dane dokumentu'}>
            <p className="mb-4 flex items-center gap-2 text-sm text-[#d4bf73]"><FileText size={16} aria-hidden="true" />{item.disposition}</p>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Field label={isPayment ? 'Rodzaj płatności' : 'Rodzaj dokumentu'}>{item.kind}</Field><Field label={isPayment ? 'Nadawca / odbiorca' : 'Kontrahent'}>{item.counterparty}</Field><Field label={isPayment ? 'Pełna kwota przelewu' : 'Kwota dokumentu'}>{money(item.amount, item.currency)}</Field>
              <Field label={isPayment ? 'Data płatności' : 'Data dokumentu'}>{date(item.date)}</Field>{!isPayment && <Field label="Termin płatności">{date(item.dueDate)}</Field>}<Field label="Źródło">{item.sourceLabel}</Field>
              {item.ksefReference && <div className="sm:col-span-3"><Field label="Numer KSeF">{item.ksefReference}</Field></div>}
            </dl>
          </section>

          {!item.hasPaymentLink && <section className={sectionClass}>
            {editable ? <>
              <label htmlFor={noteId} className="text-sm font-semibold">{isPayment ? 'Wewnętrzny opis płatności' : 'Istniejący opis dokumentu'}</label>
              <p id={noteHelpId} className="mb-3 mt-1 text-xs text-gray-400">{isPayment ? 'Ten opis pozostaje w CRM, poza paczką dla księgowej.' : 'Opis niepowiązanego dokumentu zostanie dołączony do jego kopii dla Saldeo.'} Edytujesz zapis z analizy. Zmiana unieważni wcześniejszą kontrolę paczki.</p>
              <textarea id={noteId} rows={5} value={draft} onChange={(event) => onDraftChange(event.target.value)} disabled={saving} aria-describedby={noteHelpId} placeholder="Edytuj istniejący opis z analizy" className="w-full resize-y rounded-lg border border-white/10 bg-[#25101b] p-3 text-sm text-gray-100 outline-none transition focus:border-[#d4bf73]/35 disabled:opacity-50" />
              {dirty && <p role="status" className="mt-2 text-xs text-amber-200">Zmiany w opisie nie są zapisane. Do wysyłki nadal obowiązuje poprzedni opis.</p>}
            </> : <>
              <h3 className="mb-2 text-sm font-semibold">{isPayment ? 'Wewnętrzny opis płatności' : 'Istniejący opis dokumentu'}</h3>
              {item.note.trim() ? <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{item.note}</p> : !item.relatedNotes.some((note) => note.note.trim()) && <p className="text-sm text-gray-400">Brak dodatkowego opisu. Nie blokuje to wysyłki dokumentu. Jeśli potrzebne jest wyjaśnienie, uzupełnij je w analizie CRM.</p>}
            </>}
            {error && <p role="alert" className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
          </section>}

          {!item.hasPaymentLink && !!item.relatedNotes.length && <section className={sectionClass}><h3 className="mb-3 text-sm font-semibold">Pozostałe opisy źródłowe z analizy</h3><p className="mb-3 text-xs text-gray-400">Te informacje pozostają zachowane i nie są zastępowane edycją powyżej.</p><div className="space-y-3">{item.relatedNotes.map((note, index) => <div key={`${note.label}-${index}`} className="rounded-lg bg-white/5 p-3"><p className="mb-1 text-xs text-gray-400">{note.label}</p><p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{note.note}</p></div>)}</div></section>}

          <section className={sectionClass}>
            <h3 className="mb-3 text-sm font-semibold">{isPayment ? 'Przelew i przypisane dokumenty' : `Powiązane płatności (${item.payments.length})`}</h3>
            <p className="mb-3 text-xs leading-5 text-gray-400">Powiązania służą do kontroli w CRM. Do księgowej trafia osobny opis tylko wtedy, gdy jedna płatność rozlicza kilka faktur; zwykłych dopasowań nie opisujemy ponownie.</p>
            {!item.payments.length && <p className="text-sm text-gray-400">{isPayment ? 'Szczegóły przelewu nie są dostępne.' : 'Brak zapisanego powiązania z przelewem. Sam status „opłacona” nie wskazuje płatności bankowej.'}</p>}
            <div className="space-y-3">{item.payments.map((payment) => <article key={payment.id} className="rounded-lg bg-white/5 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">{payment.direction} · {date(payment.date)}</h4>{payment.collective && <span className="rounded bg-[#d4bf73]/10 px-2 py-1 text-xs text-[#d4bf73]">Płatność zbiorcza — kilka dokumentów</span>}</div>
              <dl className="grid gap-4 sm:grid-cols-3">
                <Field label="Pełna kwota przelewu">{money(payment.amount, payment.currency)}</Field><Field label={isPayment ? 'Łącznie przypisane z przelewu' : 'Przypisane z przelewu do tego dokumentu'}>{money(payment.allocatedAmount, payment.currency)}</Field>{!isPayment && <Field label="Przypisane w walucie dokumentu">{money(payment.documentAmount, payment.documentCurrency)}</Field>}
                <Field label="Nadawca / odbiorca">{payment.counterparty}</Field><Field label="Data księgowania">{date(payment.postingDate)}</Field><Field label="Numer płatności z wyciągu">{payment.reference}</Field>
                <div className="sm:col-span-3"><Field label="Pełny tytuł przelewu">{payment.title}</Field></div>
                <div className="sm:col-span-3"><Field label="Wyciąg źródłowy">{payment.statementName}</Field></div>
                {!item.hasPaymentLink && payment.note && <div className="sm:col-span-3"><Field label="Opis płatności zapisany w analizie">{payment.note}</Field></div>}
              </dl>
              {!isPayment && payment.currency !== payment.documentCurrency && <p className="mt-3 text-xs text-amber-200">Różne waluty. Kwota bankowa i kwota przypisana do dokumentu pokazują osobne strony rozliczenia.</p>}
              {!!payment.linkedDocuments?.length && <div className="mt-4"><h5 className="mb-2 text-xs font-semibold text-gray-300">Dokumenty rozliczone tym przelewem</h5><div className="space-y-2">{payment.linkedDocuments.map((linked) => <div key={linked.key} className="rounded-lg bg-black/15 p-3"><p className="break-words text-sm font-medium [overflow-wrap:anywhere]">{linked.number} · {linked.counterparty || 'Kontrahent nie zapisany'}</p><dl className="mt-2 grid gap-3 sm:grid-cols-2"><Field label="Część przelewu przypisana do dokumentu">{money(linked.allocatedAmount, payment.currency)}</Field><Field label="Przypisane w walucie dokumentu">{money(linked.documentAmount, linked.currency)}</Field></dl></div>)}</div></div>}
            </article>)}</div>
          </section>

          <section className={sectionClass}>
            <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">{isPayment ? 'Wyciąg źródłowy' : 'Plik źródłowy'}</h3><button type="button" onClick={onPreview} disabled={previewLoading || saving} className={buttonClass}>{previewLoading ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />} {preview ? 'Odśwież podgląd' : 'Podgląd pliku'}</button></div>
            {previewLoading && <p role="status" className="mt-3 text-sm text-gray-400">Pobieram plik do podglądu…</p>}
            {previewError && <p role="alert" className="mt-3 text-sm text-amber-200">{previewError}</p>}
            {preview && <div className="mt-4 space-y-3">
              {previewType === 'application/pdf' ? <iframe src={preview.url} title={`Podgląd dokumentu ${item.number}`} sandbox="allow-same-origin" tabIndex={-1} className="h-[58dvh] min-h-[320px] w-full rounded-lg bg-white" /> : ['image/png', 'image/jpeg', 'image/webp'].includes(previewType || '') ? <img src={preview.url} alt={`Dokument źródłowy ${item.number}`} className="mx-auto max-h-[65dvh] max-w-full rounded-lg object-contain" /> : <p className="text-sm text-gray-400">Ten format nie obsługuje podglądu. Pobierz plik, aby go sprawdzić.</p>}
              <a href={preview.url} download={preview.filename} className={buttonClass}><Download size={16} />Pobierz oryginał</a>
              <p className="text-xs text-gray-400">To oryginalny plik. Zapisany opis i informacje o płatnościach sprawdzisz w nowym pliku kontrolnym wysyłki.</p>
            </div>}
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-3 bg-[#401426] px-5 py-4">
          <button type="button" onClick={onClose} disabled={saving} className={buttonClass}>{editable && dirty ? 'Anuluj / zamknij' : 'Zamknij'}</button>
          {editable && <button type="button" onClick={onSave} disabled={!dirty || saving} className={`${buttonClass} !bg-[#d4bf73] !text-[#211116] hover:!bg-[#dfca8b]`}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{saving ? 'Zapisuję…' : 'Zapisz opis z analizy'}</button>}
        </footer>
      </div>
    </div>
  );
}
