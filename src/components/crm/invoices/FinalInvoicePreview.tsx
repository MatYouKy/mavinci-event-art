'use client';

import { FileText, Pencil } from 'lucide-react';
import type { SettledInvoiceRef } from '@/lib/invoices/createFinalInvoice';
import type { FinalInvoiceCalculation } from '@/lib/invoices/finalInvoiceCalculation';

interface FinalInvoicePreviewProps {
  calculation: FinalInvoiceCalculation;
  advances: SettledInvoiceRef[];
  invoiceNumber: string;
  automaticNumber: boolean;
  issueDate: string;
  saleDate: string;
  paymentDueDate: string;
  currencyCode: string;
  buyerName?: string | null;
  buyerNip?: string | null;
  sellerName?: string | null;
  sellerNip?: string | null;
  unavailableMessage?: string | null;
  onEditItems: () => void;
}

const number = (value: number, maximumFractionDigits = 2) => Number.isFinite(value)
  ? (Object.is(value, -0) ? 0 : value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits })
  : '—';

const dateLabel = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '—';
};

const vatLabel = (rate: number, code: string) => {
  if (code === 'zw') return 'Zwolnione';
  if (code === 'np' || code === 'np I' || code === 'np II') return 'Nie podlega';
  if (code === 'oo') return 'Odwrotne obciążenie';
  return `${Number.isFinite(rate) ? rate.toLocaleString('pl-PL') : '—'}%`;
};

export default function FinalInvoicePreview({
  calculation,
  advances,
  invoiceNumber,
  automaticNumber,
  issueDate,
  saleDate,
  paymentDueDate,
  currencyCode,
  buyerName,
  buyerNip,
  sellerName,
  sellerNip,
  unavailableMessage,
  onEditItems,
}: FinalInvoicePreviewProps) {
  const { items, totals, settled, remaining } = calculation;
  const amount = (value: number) => `${number(value)} ${currencyCode}`;
  const invalidItems = items.some((item) => !item.name.trim()
    || !Number.isFinite(item.quantity) || item.quantity <= 0
    || !Number.isFinite(item.price_net) || item.price_net < 0
    || !Number.isFinite(item.vat_rate) || item.vat_rate < 0);

  return (
    <section aria-labelledby="final-invoice-preview-title" className="overflow-hidden rounded-xl bg-[#0a0d1a]/35 text-[#e5e4e2]">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#d3bb73]/5 px-4 py-4 sm:px-5">
        <div>
          <h3 id="final-invoice-preview-title" className="flex items-center gap-2 text-base uppercase">
            <FileText className="h-4 w-4 text-[#d3bb73]" /> Podgląd faktury końcowej
          </h3>
          <p className="mt-1 text-xs text-[#e5e4e2]/60">Treść i kwoty przed wystawieniem — dokument nie został jeszcze zapisany.</p>
        </div>
        <button
          type="button"
          onClick={onEditItems}
          disabled={Boolean(unavailableMessage)}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d3bb73]/40 disabled:opacity-50"
        >
          <Pencil className="h-3.5 w-3.5" /> Edytuj nazwy i pozycje
        </button>
      </div>

      {unavailableMessage ? (
        <p role="status" className="p-5 text-sm text-[#e5e4e2]/65">{unavailableMessage}</p>
      ) : (
        <div className="space-y-5 p-4 sm:p-5">
          <div>
            <p className="text-lg font-medium uppercase">Faktura końcowa {invoiceNumber.trim() || '—'}</p>
            {automaticNumber && <p className="mt-1 text-xs text-[#e5e4e2]/50">Numer przewidywany. Ostateczny numer zostanie nadany przy wystawieniu.</p>}
            <dl className="mt-4 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-[#e5e4e2]/50">Sprzedawca</dt><dd className="mt-1 break-words">{sellerName || '—'}{sellerNip && <span className="block text-xs text-[#e5e4e2]/60">NIP: {sellerNip}</span>}</dd></div>
              <div><dt className="text-xs text-[#e5e4e2]/50">Nabywca</dt><dd className="mt-1 break-words">{buyerName || '—'}{buyerNip && <span className="block text-xs text-[#e5e4e2]/60">NIP: {buyerNip}</span>}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#e5e4e2]/60">
              <span>Wystawienie: {dateLabel(issueDate)}</span>
              <span>Sprzedaż: {dateLabel(saleDate)}</span>
              <span>Termin płatności: {dateLabel(paymentDueDate)}{remaining.gross === 0 && ' · bez dopłaty'}</span>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Pozycje na fakturze końcowej</p>
            <p className="mb-3 text-xs text-[#e5e4e2]/60">Te nazwy i wartości zostaną zapisane na fakturze. Pozycje obejmują całe zamówienie; zaliczki odliczamy w rozliczeniu poniżej.</p>
            <div className="overflow-x-auto rounded-lg bg-[#0a0d1a]/35">
              <table className="w-full min-w-[860px] text-sm tabular-nums">
                <caption className="sr-only">Pozycje faktury końcowej z wartościami netto, VAT i brutto</caption>
                <thead className="bg-[#d3bb73]/5 text-xs text-[#e5e4e2]/60">
                  <tr>
                    <th scope="col" className="px-3 py-3 text-left">Lp.</th>
                    <th scope="col" className="min-w-[220px] px-3 py-3 text-left">Nazwa usługi / towaru</th>
                    <th scope="col" className="px-3 py-3 text-left">Jm.</th>
                    <th scope="col" className="px-3 py-3 text-right">Ilość</th>
                    <th scope="col" className="px-3 py-3 text-right">Cena netto</th>
                    <th scope="col" className="px-3 py-3 text-right">Wartość netto</th>
                    <th scope="col" className="px-3 py-3 text-right">Stawka VAT</th>
                    <th scope="col" className="px-3 py-3 text-right">Kwota VAT</th>
                    <th scope="col" className="px-3 py-3 text-right">Brutto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#d3bb73]/5">
                  {items.map((item) => (
                    <tr key={item.position_number} className="align-top">
                      <td className="px-3 py-3 text-[#e5e4e2]/50">{item.position_number}</td>
                      <th scope="row" className="whitespace-pre-wrap break-words px-3 py-3 text-left font-normal">
                        {item.name.trim() || <span className="text-red-300">Uzupełnij nazwę pozycji</span>}
                        {item.vat_exemption_reason && <span className="mt-1 block text-xs text-[#e5e4e2]/50">{item.vat_exemption_reason}</span>}
                      </th>
                      <td className="px-3 py-3">{item.unit}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">{Number.isFinite(item.quantity) ? item.quantity.toLocaleString('pl-PL', { maximumFractionDigits: 4 }) : '—'}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">{number(item.price_net, 4)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">{number(item.value_net)}</td>
                      <td className="px-3 py-3 text-right text-xs">{vatLabel(item.vat_rate, item.vat_code)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">{number(item.vat_amount)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-medium">{number(item.value_gross)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-[#d3bb73]/5 font-medium">
                  <tr>
                    <th scope="row" colSpan={5} className="px-3 py-3 text-left">Razem ({currencyCode})</th>
                    <td className="whitespace-nowrap px-3 py-3 text-right">{number(totals.net)}</td>
                    <td />
                    <td className="whitespace-nowrap px-3 py-3 text-right">{number(totals.vat)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right">{number(totals.gross)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div>
            <p className="mb-3 text-sm font-medium">Rozliczenie zaliczek i dopłata</p>
            <div className="overflow-x-auto rounded-lg bg-[#0a0d1a]/35">
              <table className="w-full min-w-[600px] text-sm tabular-nums">
                <caption className="sr-only">Wartość zamówienia pomniejszona o wybrane faktury zaliczkowe, kwoty w {currencyCode}</caption>
                <thead className="bg-[#d3bb73]/5 text-xs text-[#e5e4e2]/60">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left">Rozliczenie ({currencyCode})</th>
                    <th scope="col" className="px-4 py-3 text-right">Netto</th>
                    <th scope="col" className="px-4 py-3 text-right">VAT</th>
                    <th scope="col" className="px-4 py-3 text-right">Brutto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#d3bb73]/5">
                  <tr>
                    <th scope="row" className="px-4 py-3 text-left font-normal">Pełna wartość zamówienia</th>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{number(totals.net)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{number(totals.vat)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{number(totals.gross)}</td>
                  </tr>
                  {advances.map((advance) => (
                    <tr key={advance.id} className="text-[#e5e4e2]/75">
                      <th scope="row" className="px-4 py-3 text-left font-normal">
                        Odliczenie zaliczki {advance.invoice_number}
                        {advance.issue_date && <span className="mt-1 block text-xs text-[#e5e4e2]/50">z dnia {dateLabel(advance.issue_date)}</span>}
                      </th>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{number(-Number(advance.total_net))}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{number(-Number(advance.total_vat))}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">{number(-Number(advance.total_gross))}</td>
                    </tr>
                  ))}
                  <tr className="text-xs text-[#e5e4e2]/60">
                    <th scope="row" className="px-4 py-3 text-left font-normal">Razem odliczone zaliczki ({advances.length})</th>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{number(-settled.net)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{number(-settled.vat)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{number(-settled.gross)}</td>
                  </tr>
                </tbody>
                <tfoot className="bg-[#d3bb73]/10 font-semibold text-[#d3bb73]">
                  <tr>
                    <th scope="row" className="px-4 py-4 text-left">Pozostało do zapłaty</th>
                    <td className="whitespace-nowrap px-4 py-4 text-right">{number(remaining.net)}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-right">{number(remaining.vat)}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-right text-base">{number(remaining.gross)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-3 text-right text-sm font-medium text-[#d3bb73]" aria-live="polite">
              {remaining.gross < -0.01
                ? 'Zaliczki przekraczają wartość zamówienia — popraw rozliczenie.'
                : remaining.gross === 0
                  ? `Do zapłaty: ${amount(0)} — całość rozliczona zaliczkami.`
                  : `Do zapłaty: ${amount(remaining.gross)} do ${dateLabel(paymentDueDate)}.`}
            </p>
            {invalidItems && <p role="alert" className="mt-3 text-sm text-red-300">Uzupełnij nazwy i popraw wartości pozycji przed wystawieniem.</p>}
            <p className="mt-3 text-xs text-[#e5e4e2]/50">Kwoty są wyliczane z tych samych pozycji i zaliczek co przy zapisie faktury, z zaokrągleniem do groszy. To podgląd treści i rozliczenia; układ graficzny PDF może się różnić.</p>
          </div>
        </div>
      )}
    </section>
  );
}
