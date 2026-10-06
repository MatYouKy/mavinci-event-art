'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Eye, FileText, Landmark, Search } from 'lucide-react';
import { findVatTransferPairs, isConfirmedInternalVatTransfer } from '@/lib/CRM/bankVatTransfers';
import { isBankStatementMatchablePaymentMethod } from '@/lib/bankTransactionMatching';
import type { Bank, Document, Snapshot } from './SaldeoDeliveryPanel';
import MonthlyDocumentPreviewModal from './MonthlyDocumentPreviewModal';

export type MonthlyIncomeCostsStepProps = {
  snapshot: Snapshot;
  month: number;
  year: number;
  onChanged?: () => void;
};

type CurrencyTotal = { currency: string; cents: number; count: number; withoutAmount: number; cashCount: number };
type BankTotal = { currency: string; incoming: number; outgoing: number; internalIncoming: number; internalOutgoing: number; privateIncoming: number; privateOutgoing: number };
type SourceFilter = 'all' | 'ksef' | 'outside';

const cardClass = 'rounded-xl bg-[var(--brand-burgundy-800)] p-4 sm:p-5';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#e5e4e2] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--crm-field-border-focus)] disabled:opacity-40';
const fieldClass = 'min-w-0 rounded-lg border border-white/10 bg-[var(--brand-burgundy-950)] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[var(--crm-field-border-focus)]';
const money = (cents: number, currency: string) => `${(cents / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const currencyOf = (value: string) => String(value || 'PLN').trim().toUpperCase();
const dateLabel = (value: string) => /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10).split('-').reverse().join('.') : 'Nie zapisano';
const isKsef = (item: Document) => item.source === 'ksef' || Boolean(item.ksefReference);
const sourceLabel = (item: Document) => isKsef(item) ? 'KSeF' : item.source === 'local_invoice' ? 'CRM · spoza KSeF' : 'Spoza KSeF';
const isCashDocument = (item: Document) => !isBankStatementMatchablePaymentMethod(item.paymentMethod,
  isKsef(item) ? 'ksef' : item.source === 'local_invoice' ? 'invoice' : 'external');
const searchable = (value: string) => value.toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');

function totalsFor(documents: readonly Document[]): CurrencyTotal[] {
  const totals = new Map<string, CurrencyTotal>();
  for (const item of documents) {
    const currency = currencyOf(item.currency);
    const total = totals.get(currency) || { currency, cents: 0, count: 0, withoutAmount: 0, cashCount: 0 };
    total.count += 1;
    if (isCashDocument(item)) total.cashCount += 1;
    if (item.amount == null || !Number.isFinite(item.amount)) total.withoutAmount += 1;
    else total.cents += Math.round(item.amount * 100);
    totals.set(currency, total);
  }
  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/** The list stays compact; the actual document is opened in a separate modal. */
function DocumentRow({ item, onPreview }: { item: Document; onPreview: (item: Document) => void }) {
  return <button type="button" onClick={() => onPreview(item)} aria-label={`Podgląd dokumentu ${item.number}`} className="group block w-full rounded-lg bg-black/15 p-3 text-left transition hover:bg-black/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--crm-field-border-focus)]">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium [overflow-wrap:anywhere]">{item.number}</p><p className="mt-1 break-words text-xs text-[#e5e4e2]/65">{item.counterparty || 'Kontrahent nie zapisany'}</p></div>
      <strong className="whitespace-nowrap text-sm tabular-nums text-[var(--brand-gold)]">{item.amount == null || !Number.isFinite(item.amount) ? 'Brak kwoty' : money(Math.round(item.amount * 100), currencyOf(item.currency))}</strong>
    </div>
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#e5e4e2]/50"><span>{dateLabel(item.date)} · {sourceLabel(item)}{isCashDocument(item) ? ' · Gotówka wg dokumentu' : ''}</span><span className="inline-flex items-center gap-1.5 text-[var(--brand-gold)]"><Eye size={14} />Podgląd dokumentu</span></div>
  </button>;
}
function DocumentSection({ title, subtitle, documents, totalCount, direction, onPreview }: { title: string; subtitle: string; documents: Document[]; totalCount: number; direction: 'income' | 'expense' | 'unknown'; onPreview: (item: Document) => void }) {
  const [source, setSource] = useState<SourceFilter>('all');
  const visibleDocuments = documents.filter((item) => source === 'all' || (source === 'ksef' ? isKsef(item) : !isKsef(item)));
  const totals = totalsFor(visibleDocuments);
  return <section className={`${cardClass} min-w-0`} aria-label={title}>
    <header className="flex items-start gap-3">
      {direction === 'income' ? <ArrowDownLeft className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand-gold)]" /> : direction === 'expense' ? <ArrowUpRight className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand-gold)]" /> : <FileText className="mt-0.5 h-5 w-5 shrink-0 text-[var(--brand-gold)]" />}
      <div><h3 className="font-atom text-lg uppercase">{title}</h3><p className="mt-1 text-xs leading-5 text-[#e5e4e2]/55">{subtitle}</p></div>
    </header>
    <div role="group" aria-label={`Źródło dokumentów: ${title}`} className="mt-4 flex flex-wrap gap-2">
      {([{ id: 'all', label: 'Wszystkie', count: documents.length }, { id: 'ksef', label: 'KSeF', count: documents.filter(isKsef).length }, { id: 'outside', label: 'Spoza KSeF', count: documents.filter((item) => !isKsef(item)).length }] as const).map((filter) => <button type="button" key={filter.id} onClick={() => setSource(filter.id)} aria-pressed={source === filter.id} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--crm-field-border-focus)] ${source === filter.id ? 'bg-[var(--brand-gold)] font-medium text-[var(--brand-burgundy-950)]' : 'bg-white/5 text-[#e5e4e2]/70 hover:bg-white/10'}`}>{filter.label}<span className="tabular-nums">{filter.count}</span></button>)}
    </div>
    <div className="mt-4 flex flex-wrap gap-3">{totals.map((total) => <div key={total.currency} className="min-w-36 rounded-lg bg-black/15 px-3 py-2"><p className="text-lg font-semibold tabular-nums text-[var(--brand-gold)]">{money(total.cents, total.currency)}</p><p className="mt-1 text-xs text-[#e5e4e2]/50">Suma brutto · {total.count} dok.{total.withoutAmount > 0 ? ` · bez kwoty: ${total.withoutAmount}` : ''}{total.cashCount > 0 ? ` · w tym gotówka: ${total.cashCount}` : ''}</p></div>)}</div>
    <p className="mb-3 mt-4 text-xs text-[#e5e4e2]/50">Widoczne dokumenty: {visibleDocuments.length} z {totalCount}. Sumy dotyczą widocznej listy.</p>
    <div className="max-h-[65dvh] space-y-2 overflow-y-auto pr-1">{visibleDocuments.length ? visibleDocuments.map((item) => <DocumentRow key={item.key} item={item} onPreview={onPreview} />) : <p className="rounded-lg bg-black/10 p-4 text-sm text-[#e5e4e2]/60">{totalCount ? 'Żaden dokument nie spełnia wybranych filtrów.' : 'Brak dokumentów tego rodzaju w tym miesiącu.'}</p>}</div>
  </section>;
}

export default function MonthlyIncomeCostsStep({ snapshot, month, year }: MonthlyIncomeCostsStepProps) {
  const [query, setQuery] = useState('');
  const [currency, setCurrency] = useState('all');
  const [cashOnly, setCashOnly] = useState(false);
  const [filterRevision, setFilterRevision] = useState(0);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const documents = useMemo(() => {
    // loadSnapshot already canonicalizes explicit CRM ↔ KSeF links. Never merge
    // documents just because their number, amount or counterparty looks alike.
    return [...new Map(snapshot.documents.filter((item) => ['ksef', 'local_invoice', 'external_invoice'].includes(item.source) && item.date.slice(0, 7) === period).map((item) => [item.key, item])).values()]
      .sort((a, b) => b.date.localeCompare(a.date) || a.number.localeCompare(b.number, 'pl'));
  }, [snapshot.documents, period]);
  const currencies = [...new Set(documents.map((item) => currencyOf(item.currency)))].sort();
  useEffect(() => { setQuery(''); setCurrency('all'); setCashOnly(false); setPreviewKey(null); }, [month, year]);
  const previewItem = documents.find((item) => item.key === previewKey) || null;
  const openPreview = (item: Document) => setPreviewKey(item.key);
  const normalizedQuery = searchable(query.trim());
  const visible = documents.filter((item) => (currency === 'all' || currencyOf(item.currency) === currency)
    && (!cashOnly || isCashDocument(item))
    && (!normalizedQuery || searchable([item.number, item.counterparty, item.ksefReference, item.kind, item.amount == null ? '' : String(item.amount), item.date].join(' ')).includes(normalizedQuery)));
  const byDirection = (items: Document[], direction: 'income' | 'expense' | 'unknown') => items.filter((item) => (item.direction || 'unknown') === direction);

  const bankSummary = useMemo(() => {
    const validIds = new Set(snapshot.statements.filter((statement) => statement.processed && statement.validation_status === 'valid').map((statement) => statement.id));
    const banks = snapshot.transactions.filter((bank) => validIds.has(bank.statement_id) && bank.transaction_date.slice(0, 7) === period);
    const pairs = findVatTransferPairs(banks, new Map(snapshot.statements.map((statement) => [statement.id, statement])));
    const isInternal = (bank: Bank) => bank.accounting_category === 'own_transfer' || pairs.has(bank.id) || isConfirmedInternalVatTransfer(bank)
      || (!bank.accounting_category && bank.accounting_review_status === 'explained' && bank.accounting_subtype === 'automatic_vat_transfer');
    const totals = new Map<string, BankTotal>();
    let invalidCount = 0; let internalCount = 0; let privateCount = 0;
    for (const bank of banks) {
      const amount = Math.round(Math.abs(Number(bank.amount)) * 100);
      if (!Number.isFinite(amount) || !['credit', 'debit'].includes(bank.transaction_type)) { invalidCount += 1; continue; }
      const currency = currencyOf(bank.currency);
      const total = totals.get(currency) || { currency, incoming: 0, outgoing: 0, internalIncoming: 0, internalOutgoing: 0, privateIncoming: 0, privateOutgoing: 0 };
      if (isInternal(bank)) { total[bank.transaction_type === 'credit' ? 'internalIncoming' : 'internalOutgoing'] += amount; internalCount += 1; }
      else if (bank.private_transfer_detected) { total[bank.transaction_type === 'credit' ? 'privateIncoming' : 'privateOutgoing'] += amount; privateCount += 1; }
      else total[bank.transaction_type === 'credit' ? 'incoming' : 'outgoing'] += amount;
      totals.set(currency, total);
    }
    return { totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)), count: banks.length, invalidCount, internalCount, privateCount,
      excludedSources: snapshot.statements.length - validIds.size, hasStatements: snapshot.statements.length > 0 };
  }, [snapshot.statements, snapshot.transactions, period]);

  return <div className="space-y-5 text-[#e5e4e2]">
    <header><h2 className="font-atom text-xl uppercase">Przychody i koszty — {String(month).padStart(2, '0')}/{year}</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-[#e5e4e2]/60">Dokumenty według daty wystawienia: sprzedaż i zakupy z KSeF, CRM oraz spoza KSeF — także gotówkowe, nieopłacone i bez powiązania z przelewem. Jawnie połączone kopie faktury są liczone raz. Kwoty brutto dokumentów nie są wynikiem podatkowym; korekty zachowują zapisany znak.</p></header>
    {snapshot.internalWarnings.filter((warning) => warning.startsWith('Tożsamość dokumentu:')).map((warning, index) => <p key={index} role="status" className="rounded-lg bg-amber-400/5 p-3 text-sm text-amber-200">{warning} Suma wymaga sprawdzenia powiązań.</p>)}
    <div className="flex flex-wrap gap-3 rounded-xl bg-black/10 p-3" role="search" aria-label="Filtry dokumentów miesiąca">
      <label className="relative min-w-60 flex-1"><span className="sr-only">Szukaj dokumentu</span><Search size={17} className="pointer-events-none absolute left-3 top-3 text-[var(--brand-gold)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Numer, kontrahent, kwota lub numer KSeF…" className={`${fieldClass} w-full pl-10`} /></label>
      <label className="flex items-center gap-2 text-xs text-[#e5e4e2]/65">Waluta<select value={currency} onChange={(event) => setCurrency(event.target.value)} className={fieldClass}><option value="all">Wszystkie waluty</option>{currencies.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="flex items-center gap-2 text-xs text-[#e5e4e2]/65"><input type="checkbox" checked={cashOnly} onChange={(event) => setCashOnly(event.target.checked)} className="accent-[#d3bb73]" />Tylko dokumenty gotówkowe ({documents.filter(isCashDocument).length})</label>
      <button type="button" className={buttonClass} onClick={() => { setQuery(''); setCurrency('all'); setCashOnly(false); setFilterRevision((value) => value + 1); }}>Wyczyść filtry</button>
    </div>
    <div className="grid items-start gap-5 xl:grid-cols-2">
      <DocumentSection key={`${period}:${filterRevision}:income`} title="Przychody" subtitle="Dokumenty sprzedaży · kwoty brutto" direction="income" documents={byDirection(visible, 'income')} totalCount={byDirection(documents, 'income').length} onPreview={openPreview} />
      <DocumentSection key={`${period}:${filterRevision}:expense`} title="Koszty" subtitle="Dokumenty zakupu i pozostałe dokumenty kosztowe · kwoty brutto" direction="expense" documents={byDirection(visible, 'expense')} totalCount={byDirection(documents, 'expense').length} onPreview={openPreview} />
    </div>
    {!!byDirection(documents, 'unknown').length && <DocumentSection key={`${period}:${filterRevision}:unknown`} title="Dokumenty bez określonego kierunku" subtitle="Dane źródłowe nie określają sprzedaży ani zakupu. Te kwoty nie wchodzą do powyższych sum." direction="unknown" documents={byDirection(visible, 'unknown')} totalCount={byDirection(documents, 'unknown').length} onPreview={openPreview} />}
    {previewItem && <MonthlyDocumentPreviewModal key={previewItem.key} item={previewItem} onClose={() => setPreviewKey(null)} />}
    <section className={cardClass} aria-label="Obroty bankowe miesiąca">
      <h3 className="flex items-center gap-2 font-atom text-lg uppercase"><Landmark size={20} className="text-[var(--brand-gold)]" />Wpływy i wydatki bankowe</h3>
      <p className="mt-2 text-sm leading-6 text-[#e5e4e2]/60">Podsumowanie całego miesiąca na podstawie odczytanych, połączonych operacji PDF i MT940 — niezależnie od filtrów dokumentów. To przepływy pieniężne, nie przychód ani koszt podatkowy. Nie dodajemy ich do sum faktur.</p>
      {bankSummary.excludedSources > 0 && <p className="mt-3 rounded-lg bg-[var(--brand-gold)]/10 p-3 text-sm text-[var(--brand-gold)]">Obroty są częściowe: pominięto pliki bez poprawnie zakończonego odczytu ({bankSummary.excludedSources}).</p>}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">{bankSummary.totals.map((total) => <div key={total.currency} className="rounded-lg bg-black/15 p-4">
        <h4 className="mb-3 text-sm font-semibold">{total.currency}</h4>
        <dl className="grid grid-cols-2 gap-4"><div><dt className="text-xs text-[#e5e4e2]/55">Wpływy zewnętrzne</dt><dd className="mt-1 font-semibold tabular-nums text-[var(--brand-gold)]">{money(total.incoming, total.currency)}</dd></div><div><dt className="text-xs text-[#e5e4e2]/55">Wydatki zewnętrzne</dt><dd className="mt-1 font-semibold tabular-nums text-[var(--brand-gold)]">{money(total.outgoing, total.currency)}</dd></div></dl>
        {(total.internalIncoming > 0 || total.internalOutgoing > 0) && <p className="mt-3 text-xs leading-5 text-[#e5e4e2]/55">Osobno: transfery własne / VAT — wpływy {money(total.internalIncoming, total.currency)}, wydatki {money(total.internalOutgoing, total.currency)}.</p>}
        {(total.privateIncoming > 0 || total.privateOutgoing > 0) && <p className="mt-2 text-xs leading-5 text-[#e5e4e2]/55">Osobno: operacje oznaczone jako prywatne — wpływy {money(total.privateIncoming, total.currency)}, wydatki {money(total.privateOutgoing, total.currency)}.</p>}
      </div>)}</div>
      {!bankSummary.totals.length && <p className="mt-3 text-sm text-[#e5e4e2]/55">{bankSummary.hasStatements ? 'Brak poprawnie odczytanych operacji w tym miesiącu.' : 'Nie dodano wyciągów dla tego miesiąca.'}</p>}
      <p className="mt-4 text-xs leading-5 text-[#e5e4e2]/50">Odczytane operacje: {bankSummary.count}. Poza obrotami zewnętrznymi: {bankSummary.internalCount} transferów własnych / VAT i {bankSummary.privateCount} operacji prywatnych. Wyłączenie wynika z zapisanej klasyfikacji albo jednoznacznego powiązania rachunków, nigdy z samego słowa „VAT” w tytule.{bankSummary.invalidCount > 0 ? ` Nie zsumowano ${bankSummary.invalidCount} operacji bez poprawnej kwoty lub kierunku.` : ''}</p>
    </section>
  </div>;
}
