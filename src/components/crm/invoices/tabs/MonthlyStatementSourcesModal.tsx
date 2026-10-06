'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, Loader2, X } from 'lucide-react';
import { bankStatementImportFormat, resolveStatementAccount } from '@/lib/bankStatementAccount';
import type { BankStatementParserPreview, ParserStatement } from '@/lib/invoices/bankStatementParserPreview';

export type StatementDownloadHandler = (
  id: string,
  accountType: 'regular' | 'vat' | 'mt940',
  month: number,
  year: number,
) => void | Promise<void>;

type Props = {
  preview: BankStatementParserPreview;
  month: number;
  year: number;
  onClose: () => void;
  onDownload?: StatementDownloadHandler;
};

const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-[var(--brand-platinum)] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--crm-field-border-focus)] disabled:cursor-not-allowed disabled:opacity-40';
const formatLabels = { ready: 'Odczyt kompletny', missing: 'Brak pliku', unprocessed: 'Sprawdź odczyt' };

function money(value: number | string | null | undefined, currency?: string | null) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return 'Nie zapisano';
  return `${Number(value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || 'PLN'}`;
}

function date(value?: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '—';
}

function downloadKind(statement: ParserStatement) {
  return statement.account_type === 'regular' || statement.account_type === 'vat' || statement.account_type === 'mt940'
    ? statement.account_type : null;
}

export default function MonthlyStatementSourcesModal({ preview, month, year, onClose, onDownload }: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const dialog = dialogRef.current;
    if (!dialog) return;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    closeButtonRef.current?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const download = async (statement: ParserStatement) => {
    const kind = downloadKind(statement);
    if (!onDownload || !kind || downloadingId) return;
    setDownloadingId(statement.id);
    setDownloadError(null);
    try {
      await onDownload(statement.id, kind, month, year);
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : 'Nie udało się pobrać oryginalnego wyciągu.');
    } finally {
      setDownloadingId(null);
    }
  };
  const rawRows = preview.groups.flatMap((group) => group.rows);
  const complete = preview.completeness.status === 'complete';
  const issues = preview.diagnostics.filter((item) => item.kind !== 'source_order_difference');
  const information = preview.diagnostics.filter((item) => item.kind === 'source_order_difference');

  if (typeof document === 'undefined') return null;
  return createPortal(<dialog
    ref={dialogRef}
    aria-labelledby={titleId}
    aria-describedby={descriptionId}
    className="m-auto max-h-[92dvh] w-[min(960px,calc(100%_-_24px))] max-w-none overflow-hidden rounded-2xl border-0 bg-[var(--brand-burgundy-950)] p-0 text-[var(--brand-platinum)] shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}
  >
    <div className="flex max-h-[92dvh] flex-col">
      <header className="flex items-start justify-between gap-4 bg-[var(--brand-burgundy-800)] px-5 py-4">
        <div><h2 id={titleId} className="text-lg font-medium">Wyciągi — {String(month).padStart(2, '0')}/{year}</h2><p id={descriptionId} className="mt-1 text-xs leading-5 text-[var(--brand-platinum)]/60">Oryginalne pliki i wyniki ich odczytu. PDF i MT940 opisują te same operacje, więc ich liczników nie sumujemy jako transakcji.</p></div>
        <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Zamknij wyciągi miesiąca" className={`${buttonClass} !p-2`}><X className="h-5 w-5" /></button>
      </header>
      <div className="min-h-0 space-y-4 overflow-y-auto p-4 sm:p-5">
        <section className="rounded-xl bg-white/[0.035] p-4" aria-label="Kompletność wyciągów">
          <h3 className={`text-sm font-medium ${complete ? 'text-emerald-300' : 'text-amber-200'}`}>{complete ? 'Komplet źródeł bankowych' : preview.completeness.status === 'unavailable' ? 'Nie można potwierdzić kompletności' : 'Źródła wymagają uzupełnienia'}</h3>
          {preview.completeness.accounts.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[460px] text-left text-xs"><thead className="text-[var(--brand-platinum)]/50"><tr><th className="pb-2 font-medium">Rachunek</th><th className="pb-2 font-medium">PDF</th><th className="pb-2 font-medium">MT940</th></tr></thead><tbody>{preview.completeness.accounts.map((account) => <tr key={account.key} className="border-t border-white/[0.06]"><th className="py-3 pr-3 text-left font-normal"><p>{account.kind === 'vat' ? 'Konto VAT' : 'Konto bieżące'}</p><p className="mt-1 text-[11px] tabular-nums text-[var(--brand-platinum)]/45">{account.accountNumber}</p></th>{(['PDF', 'MT940'] as const).map((format) => <td key={format} className={`py-3 pr-3 ${account.formats[format].status === 'ready' ? 'text-emerald-300' : 'text-amber-200'}`}>{formatLabels[account.formats[format].status]}</td>)}</tr>)}</tbody></table></div>}
          {preview.completeness.missing.length > 0 && <ul className="mt-3 list-inside list-disc space-y-1 text-xs leading-5 text-amber-200">{preview.completeness.missing.map((message) => <li key={message}>{message}</li>)}</ul>}
          {preview.completeness.notices.map((notice) => <p key={notice} className="mt-2 text-xs leading-5 text-[var(--brand-platinum)]/60">{notice}</p>)}
        </section>
        {downloadError && <p role="alert" className="rounded-lg bg-amber-400/10 p-3 text-xs text-amber-200">{downloadError}</p>}
        <section aria-label="Pliki źródłowe" className="space-y-3">
          {preview.statements.map((statement) => {
            const sourceRows = rawRows.filter((row) => row.statement.id === statement.id);
            const group = preview.groups.find((item) => item.statements.some((source) => source.id === statement.id));
            const ready = statement.processed === true && statement.validation_status === 'valid';
            const status = ready ? 'Odczyt zatwierdzony' : statement.validation_status === 'rejected' ? 'Odczyt odrzucony' : 'Odczyt niepotwierdzony';
            const format = bankStatementImportFormat(statement) || 'Inny format';
            const verified = sourceRows.filter((row) => row.transaction.source_verified === true).length;
            const accountNumber = resolveStatementAccount(statement).accountNumber;
            return <article key={statement.id} className="rounded-xl bg-[var(--brand-burgundy-800)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h3 className="flex items-start gap-2 text-sm font-medium"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-gold)]" /><span className="break-all">{statement.file_name || 'Plik bez nazwy'}</span></h3><p className="mt-2 text-xs text-[var(--brand-platinum)]/60">{group?.kind === 'vat' ? 'Konto VAT' : group?.kind === 'regular' ? 'Konto bieżące' : 'Konto do identyfikacji'} · {format}</p><p className={`mt-1 text-xs ${ready ? 'text-emerald-300' : 'text-amber-200'}`}>{status}</p></div>{onDownload && <button type="button" onClick={() => void download(statement)} disabled={Boolean(downloadingId) || !downloadKind(statement)} className={buttonClass}>{downloadingId === statement.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Pobierz oryginał</button>}</div>
              <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3"><div><dt className="text-[var(--brand-platinum)]/45">Odczytane operacje</dt><dd className="mt-1 font-medium">{sourceRows.length}</dd></div><div><dt className="text-[var(--brand-platinum)]/45">Saldo początkowe</dt><dd className="mt-1 tabular-nums">{money(statement.opening_balance, statement.currency)}</dd></div><div><dt className="text-[var(--brand-platinum)]/45">Saldo końcowe</dt><dd className="mt-1 tabular-nums">{money(statement.closing_balance, statement.currency)}</dd></div></dl>
              {statement.transactions_count != null && Number(statement.transactions_count) !== sourceRows.length && <p className="mt-3 text-xs text-amber-200">Zapisany licznik ({statement.transactions_count}) różni się od dostępnych odczytów ({sourceRows.length}).</p>}
              {statement.validation_message && <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[var(--brand-platinum)]/60">{statement.validation_message}</p>}
              <details className="mt-3 rounded-lg bg-black/10 p-3 text-xs"><summary className="cursor-pointer text-[var(--brand-platinum)]/65">Szczegóły odczytu</summary><p className="mt-3 break-all text-[var(--brand-platinum)]/55">Rachunek: {accountNumber || 'nie rozpoznano'} · Wersja parsera: {statement.parser_version ?? 'nie zapisano'}</p><p className="mt-1 text-[var(--brand-platinum)]/55">Pozycje z potwierdzoną kolejnością i saldami: {verified} z {sourceRows.length}.</p>{sourceRows.length > 0 && <div className="mt-3 max-h-[330px] overflow-auto"><table className="w-full min-w-[560px] text-left text-[11px]"><thead className="text-[var(--brand-platinum)]/45"><tr><th className="p-2">Pozycja</th><th className="p-2">Data</th><th className="p-2">Kwota</th><th className="p-2">Opis z pliku</th><th className="p-2">Saldo po</th></tr></thead><tbody>{[...sourceRows].sort((left, right) => (left.transaction.source_index ?? Number.MAX_SAFE_INTEGER) - (right.transaction.source_index ?? Number.MAX_SAFE_INTEGER)).map(({ transaction }) => <tr key={transaction.id} className="border-t border-white/[0.04] align-top"><td className="p-2">{transaction.source_index == null ? '—' : transaction.source_index + 1}</td><td className="whitespace-nowrap p-2">{date(transaction.transaction_date)}</td><td className="whitespace-nowrap p-2 tabular-nums">{transaction.transaction_type === 'debit' ? '−' : '+'}{money(transaction.amount, transaction.currency)}</td><td className="min-w-[200px] whitespace-pre-wrap break-words p-2">{transaction.title || transaction.counterparty_name || 'Brak opisu'}<span className="mt-1 block break-all text-[var(--brand-platinum)]/45">{transaction.reference_number}</span></td><td className="whitespace-nowrap p-2 tabular-nums">{money(transaction.source_balance_after, transaction.currency)}</td></tr>)}</tbody></table></div>}</details>
            </article>;
          })}
          {!preview.statements.length && <p className="rounded-lg bg-white/5 p-4 text-sm text-[var(--brand-platinum)]/60">Nie dodano jeszcze wyciągów za ten miesiąc.</p>}
        </section>
        {(preview.warnings.length > 0 || issues.length > 0) && <section className="rounded-lg bg-amber-400/5 p-3 text-xs leading-5 text-amber-200"><h3 className="font-medium">Uwagi do źródeł</h3><ul className="mt-2 list-inside list-disc space-y-1">{preview.warnings.map((warning, index) => <li key={`warning:${index}`}>{warning}</li>)}{issues.map((item, index) => <li key={`${item.kind}:${index}`}>{item.message}</li>)}</ul></section>}
        {information.length > 0 && <section className="rounded-lg bg-white/[0.035] p-3 text-xs leading-5 text-[var(--brand-platinum)]/60"><h3 className="font-medium">Informacje o odczycie</h3>{information.map((item, index) => <p key={index} className="mt-2">{item.message}</p>)}</section>}
      </div>
      <footer className="flex justify-end bg-[var(--brand-burgundy-800)] px-5 py-3"><button type="button" onClick={onClose} className={buttonClass}>Zamknij</button></footer>
    </div>
  </dialog>, document.body);
}
