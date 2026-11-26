'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Link2, Plus, Receipt, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  RENTAL_CHARGE_LABELS,
  linkRentalInvoice,
  rentalErrorMessage,
  rentalLocalInput,
  rentalIsoFromLocal,
  rentalMoney,
  saveRental,
  setRentalCharges,
  type RentalCharge,
  type RentalChargeKind,
  type RentalDetail,
  type RentalInvoice,
} from '@/lib/CRM/rental/rental';
import { RentalError, RentalField, RentalSection, numberOrNull, rentalButton, rentalInput, rentalPrimaryButton } from './rentalUi';

/*
 * Rozliczenie wypożyczenia (sprzedaż): podsumowanie netto / VAT / brutto, naliczenia (uszkodzenia, braki, opóźnienie,
 * czyszczenie — podpowiedź z rozbieżności i wartości odtworzeniowej), kaucja (wpłata, zwrot) i faktury z Finansów.
 */

type ChargeRow = RentalCharge & { key: string; amountText: string };
type InvoiceHit = { id: string; invoice_number: string; total_gross: number };

const key = () => Math.random().toString(36).slice(2);
const INVOICE_KIND_LABELS: Record<RentalInvoice['kind'], string> = { rental: 'Za wypożyczenie', deposit: 'Kaucja', charges: 'Naliczenia' };

export default function RentalSettlement({ rental, onChanged }: { rental: RentalDetail; onChanged: (rental: RentalDetail | null) => void }) {
  const { showSnackbar } = useSnackbar();
  const sales = rental.sales!;
  const canManage = rental.access.sales_manage && !['settled', 'cancelled'].includes(rental.status);
  const chargesOpen = canManage && ['issued', 'returned'].includes(rental.status);
  const toRows = (charges: RentalCharge[]): ChargeRow[] => charges.map((charge) => ({ ...charge, key: charge.id || key(), amountText: String(charge.amount) }));
  const [charges, setCharges] = useState<ChargeRow[]>(() => toRows(sales.charges));
  const [chargesDirty, setChargesDirty] = useState(false);
  const [depositReceived, setDepositReceived] = useState(rentalLocalInput(sales.deposit_received_at));
  const [depositReturned, setDepositReturned] = useState(sales.deposit_returned_amount == null ? '' : String(sales.deposit_returned_amount));
  const [depositSettled, setDepositSettled] = useState(rentalLocalInput(sales.deposit_settled_at));
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [invoiceHits, setInvoiceHits] = useState<InvoiceHit[]>([]);
  const [invoiceKind, setInvoiceKind] = useState<RentalInvoice['kind']>('rental');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chargesSignature = sales.charges.map((charge) => `${charge.id}:${charge.kind}:${charge.amount}:${charge.item_id}:${charge.description}`).join('|');
  useEffect(() => {
    setCharges(toRows(sales.charges));
    setChargesDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargesSignature]);

  useEffect(() => {
    const text = invoiceQuery.trim();
    if (text.length < 2) {
      setInvoiceHits([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      const { data } = await supabase.from('invoices').select('id, invoice_number, total_gross')
        .ilike('invoice_number', `%${text.replace(/[\\%_]/g, '\\$&')}%`).order('issue_date', { ascending: false }).limit(8);
      if (alive) setInvoiceHits(((data || []) as any[]).map((row) => ({ id: String(row.id), invoice_number: String(row.invoice_number || ''), total_gross: Number(row.total_gross || 0) })));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [invoiceQuery]);

  const run = async (action: () => Promise<RentalDetail | null>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      const saved = await action();
      showSnackbar(message, 'success');
      onChanged(saved);
    } catch (failure) {
      setError(rentalErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const editCharge = (rowKey: string, patch: Partial<ChargeRow>) => {
    setChargesDirty(true);
    setCharges((current) => current.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)));
  };

  /** Podpowiedź z rozbieżności: uszkodzone i brakujące sztuki × wartość odtworzeniowa (do poprawy przed zapisem). */
  const suggest = () => {
    const next: ChargeRow[] = [];
    for (const item of rental.items) {
      if (item.returned_damaged_qty > 0 && !charges.some((charge) => charge.item_id === item.id && charge.kind === 'damage')) {
        const amount = Math.round(item.returned_damaged_qty * Number(item.replacement_value || 0) * 100) / 100;
        next.push({ key: key(), item_id: item.id, kind: 'damage', description: `${item.name} — uszkodzone ${item.returned_damaged_qty} ${item.unit}`, amount, amountText: String(amount) });
      }
      if (item.returned_missing_qty > 0 && !charges.some((charge) => charge.item_id === item.id && charge.kind === 'missing')) {
        const amount = Math.round(item.returned_missing_qty * Number(item.replacement_value || 0) * 100) / 100;
        next.push({ key: key(), item_id: item.id, kind: 'missing', description: `${item.name} — brak ${item.returned_missing_qty} ${item.unit}`, amount, amountText: String(amount) });
      }
    }
    if (!next.length) {
      showSnackbar('Brak rozbieżności bez naliczenia', 'info');
      return;
    }
    setChargesDirty(true);
    setCharges((current) => [...current, ...next]);
  };

  const saveCharges = () => {
    const invalid = charges.find((charge) => !charge.description.trim() || numberOrNull(charge.amountText) == null || (numberOrNull(charge.amountText) ?? -1) < 0);
    if (invalid) {
      setError('Każde naliczenie wymaga opisu i kwoty netto.');
      return;
    }
    void run(async () => {
      const saved = await setRentalCharges(supabase, rental.id, charges.map((charge) => ({
        item_id: charge.item_id, kind: charge.kind, description: charge.description.trim(), amount: numberOrNull(charge.amountText) ?? 0,
      })));
      setChargesDirty(false);
      return saved;
    }, 'Zapisano naliczenia');
  };

  const saveDeposit = () => run(async () => {
    await saveRental(supabase, rental.id, {
      deposit_received_at: depositReceived ? rentalIsoFromLocal(depositReceived) : null,
      deposit_returned_amount: numberOrNull(depositReturned),
      deposit_settled_at: depositSettled ? rentalIsoFromLocal(depositSettled) : null,
    });
    return null;
  }, 'Zapisano kaucję');

  const totals = sales.totals;
  const depositLeft = Number(totals.deposit || 0) - Number(totals.deposit_returned || 0);

  return (
    <RentalSection title="Rozliczenie">
      <div className="space-y-5">
        <RentalError message={error} />
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3"><dt className="text-[#e5e4e2]/60">Pozycje netto</dt><dd className="text-[#e5e4e2]">{rentalMoney(totals.lines_net)}</dd></div>
          {Number(totals.discount_amount) > 0 && (
            <div className="flex justify-between gap-3"><dt className="text-[#e5e4e2]/60">Rabat {sales.discount_percent}%</dt><dd className="text-[#e5e4e2]">−{rentalMoney(totals.discount_amount)}</dd></div>
          )}
          <div className="flex justify-between gap-3"><dt className="text-[#e5e4e2]/60">Naliczenia netto</dt><dd className="text-[#e5e4e2]">{rentalMoney(totals.charges_net)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-[#e5e4e2]/60">Razem netto</dt><dd className="text-[#e5e4e2]">{rentalMoney(totals.net)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-[#e5e4e2]/60">VAT {sales.vat_rate}%</dt><dd className="text-[#e5e4e2]">{rentalMoney(totals.vat)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="font-medium text-[#e5e4e2]">Razem brutto</dt><dd className="font-medium text-[#d3bb73]">{rentalMoney(totals.gross)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-[#e5e4e2]/60">Kaucja</dt><dd className="text-[#e5e4e2]">{rentalMoney(totals.deposit)}{totals.deposit_returned != null ? ` · zwrócono ${rentalMoney(totals.deposit_returned)}` : ''}</dd></div>
          {totals.deposit_returned != null && depositLeft > 0 && (
            <div className="flex justify-between gap-3"><dt className="text-[#e5e4e2]/60">Zatrzymano z kaucji</dt><dd className="text-[#e5e4e2]">{rentalMoney(depositLeft)}</dd></div>
          )}
        </dl>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium uppercase tracking-wide text-[#e5e4e2]/70">Naliczenia dla klienta</h3>
            {chargesOpen && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={rentalButton} onClick={suggest} disabled={busy}>Z rozbieżności</button>
                <button type="button" className={rentalButton} disabled={busy}
                  onClick={() => { setChargesDirty(true); setCharges((current) => [...current, { key: key(), item_id: null, kind: 'other', description: '', amount: 0, amountText: '' }]); }}>
                  <Plus className="h-4 w-4" />Naliczenie
                </button>
              </div>
            )}
          </div>
          {charges.length === 0 ? (
            <p className="text-sm text-[#e5e4e2]/50">{chargesOpen ? 'Brak naliczeń. Po zwrocie z rozbieżnościami użyj „Z rozbieżności”.' : 'Brak naliczeń.'}</p>
          ) : (
            <ul className="space-y-2">
              {charges.map((charge) => (
                <li key={charge.key} className="grid gap-2 sm:grid-cols-[140px_1fr_120px_auto]">
                  <select value={charge.kind} disabled={!chargesOpen} onChange={(event) => editCharge(charge.key, { kind: event.target.value as RentalChargeKind })} className={rentalInput}>
                    {(Object.keys(RENTAL_CHARGE_LABELS) as RentalChargeKind[]).map((kind) => <option key={kind} value={kind}>{RENTAL_CHARGE_LABELS[kind]}</option>)}
                  </select>
                  <input value={charge.description} disabled={!chargesOpen} onChange={(event) => editCharge(charge.key, { description: event.target.value })} placeholder="Opis" className={rentalInput} />
                  <input value={charge.amountText} disabled={!chargesOpen} onChange={(event) => editCharge(charge.key, { amountText: event.target.value })} placeholder="Netto zł" inputMode="decimal" className={rentalInput} />
                  {chargesOpen && (
                    <button type="button" aria-label="Usuń naliczenie" className="rounded p-2 text-red-300 hover:bg-red-400/10"
                      onClick={() => { setChargesDirty(true); setCharges((current) => current.filter((row) => row.key !== charge.key)); }}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {chargesOpen && chargesDirty && (
            <button type="button" className={rentalPrimaryButton} onClick={saveCharges} disabled={busy}>Zapisz naliczenia</button>
          )}
        </div>

        {Number(sales.deposit_amount) > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium uppercase tracking-wide text-[#e5e4e2]/70">Kaucja {rentalMoney(sales.deposit_amount)}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <RentalField label="Wpłacona">
                <input type="datetime-local" value={depositReceived} disabled={!canManage} onChange={(event) => setDepositReceived(event.target.value)} className={rentalInput} />
              </RentalField>
              <RentalField label="Zwrócono klientowi (zł)">
                <input value={depositReturned} disabled={!canManage} onChange={(event) => setDepositReturned(event.target.value)} inputMode="decimal" className={rentalInput} />
              </RentalField>
              <RentalField label="Rozliczona">
                <input type="datetime-local" value={depositSettled} disabled={!canManage} onChange={(event) => setDepositSettled(event.target.value)} className={rentalInput} />
              </RentalField>
            </div>
            {canManage && <button type="button" className={rentalButton} onClick={() => void saveDeposit()} disabled={busy}>Zapisz kaucję</button>}
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-medium uppercase tracking-wide text-[#e5e4e2]/70">Faktury</h3>
          {sales.invoices.length === 0 ? (
            <p className="text-sm text-[#e5e4e2]/50">Brak powiązanych faktur.</p>
          ) : (
            <ul className="space-y-1">
              {sales.invoices.map((invoice) => (
                <li key={invoice.invoice_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm">
                  <Link href={`/crm/invoices/${invoice.invoice_id}`} className="inline-flex items-center gap-2 text-[#e5e4e2] hover:text-[#d3bb73]">
                    <Receipt className="h-4 w-4 text-[#d3bb73]" />{invoice.invoice_number}
                  </Link>
                  <span className="text-xs text-[#e5e4e2]/60">{INVOICE_KIND_LABELS[invoice.kind]} · {rentalMoney(invoice.total_gross)}</span>
                  {canManage && (
                    <button type="button" className="text-xs text-red-300 hover:underline" disabled={busy}
                      onClick={() => void run(() => linkRentalInvoice(supabase, rental.id, invoice.invoice_id, invoice.kind, false), 'Odłączono fakturę')}>
                      Odłącz
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && rental.status !== 'draft' && (
            <div className="flex flex-wrap items-start gap-2">
              <div className="relative min-w-56 flex-1">
                <input value={invoiceQuery} onChange={(event) => setInvoiceQuery(event.target.value)} placeholder="Dołącz fakturę — wpisz numer…" className={rentalInput} />
                {invoiceHits.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-white/10 bg-[#0a0d1a] shadow-xl">
                    {invoiceHits.map((hit) => (
                      <li key={hit.id}>
                        <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-[#e5e4e2] hover:bg-white/5" disabled={busy}
                          onClick={() => { setInvoiceQuery(''); setInvoiceHits([]); void run(() => linkRentalInvoice(supabase, rental.id, hit.id, invoiceKind, true), 'Dołączono fakturę'); }}>
                          <span className="inline-flex items-center gap-2"><Link2 className="h-4 w-4 text-[#d3bb73]" />{hit.invoice_number}</span>
                          <span className="text-xs text-[#e5e4e2]/60">{rentalMoney(hit.total_gross)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <select value={invoiceKind} onChange={(event) => setInvoiceKind(event.target.value as RentalInvoice['kind'])} className={`${rentalInput} w-auto`}>
                {(Object.keys(INVOICE_KIND_LABELS) as RentalInvoice['kind'][]).map((kind) => <option key={kind} value={kind}>{INVOICE_KIND_LABELS[kind]}</option>)}
              </select>
              <Link href="/crm/invoices/new" target="_blank" className={rentalButton}><ExternalLink className="h-4 w-4" />Nowa faktura</Link>
            </div>
          )}
        </div>
      </div>
    </RentalSection>
  );
}
