'use client';

import { CalendarDays, CheckCircle2, CreditCard, FileText, Landmark, Pencil, RotateCcw, Send, Trash2 } from 'lucide-react';
import {
  PURCHASE_COST_STATUS_LABELS,
  purchaseDay,
  purchaseKindLabel,
  purchaseMethodLabel,
  purchaseMoney,
  purchaseMonthEditable,
  purchaseSettlementStatus,
  purchaseTotals,
  purchaseTotalsText,
  type PurchaseDocument,
  type PurchaseMonth,
  type PurchaseMonthCompany,
} from '@/lib/purchases/purchaseShared';
import { PurchaseStatusBadge, purchaseButton, purchaseCard, purchaseDangerButton, purchasePrimaryButton } from './purchasesUi';

/*
 * Miesiąc zakupów pracownika: rozliczenie każdej działalności (stan, sumy, uwagi) z czynnościami — „Wyślij rozliczenie” (własne)
 * albo „Zatwierdź” / „Zwróć do poprawy” (zatwierdzający) — i tabela dokumentów (plik, event, karta / wyciąg).
 */

export default function PurchaseMonthView({ month, futureMonth, onOpenFile, onEdit, onDelete, onSubmit, onDecide }: {
  month: PurchaseMonth;
  /** Miesiąc jeszcze się nie zaczął — nie da się go rozliczyć. */
  futureMonth: boolean;
  onOpenFile: (document: PurchaseDocument) => void;
  onEdit?: (document: PurchaseDocument) => void;
  onDelete?: (document: PurchaseDocument) => void;
  onSubmit?: (company: PurchaseMonthCompany) => void;
  onDecide?: (company: PurchaseMonthCompany, approve: boolean) => void;
}) {
  const companies = month.companies.filter((company) => company.can_record || company.can_approve
    || month.documents.some((document) => document.company_id === company.id) || company.settlement);

  return (
    <div className="space-y-4">
      {companies.map((company) => {
        const documents = month.documents.filter((document) => document.company_id === company.id);
        const status = purchaseSettlementStatus(company);
        const editable = purchaseMonthEditable(status);
        const missingFiles = documents.filter((document) => !document.has_file).length;
        const settlement = company.settlement;
        return (
          <section key={company.id} className={purchaseCard}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-light uppercase tracking-wide text-[#e5e4e2]">{company.name}</h2>
                  <PurchaseStatusBadge status={status} />
                </div>
                <p className="text-sm text-[#e5e4e2]/70">
                  {documents.length} dok. · razem {purchaseTotalsText(purchaseTotals(documents))}
                  {settlement?.submitted_at && ` · wysłane ${purchaseDay(settlement.submitted_at)}`}
                  {settlement?.decided_at && status !== 'submitted' && ` · decyzja ${purchaseDay(settlement.decided_at)}${settlement.decided_by_name ? ` (${settlement.decided_by_name})` : ''}`}
                </p>
                {settlement?.employee_note && <p className="text-sm text-[#e5e4e2]/60">Uwaga pracownika: {settlement.employee_note}</p>}
                {settlement?.decision_note && (
                  <p className={`rounded-lg px-3 py-2 text-sm ${status === 'returned' ? 'bg-amber-400/10 text-amber-100' : 'bg-white/5 text-[#e5e4e2]/80'}`}>
                    {status === 'returned' ? 'Do poprawy: ' : 'Uwaga: '}{settlement.decision_note}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {month.self && onSubmit && company.can_record && editable && (
                  <button type="button" className={purchasePrimaryButton} onClick={() => onSubmit(company)}
                    disabled={futureMonth || documents.length === 0 || missingFiles > 0}
                    title={missingFiles > 0 ? 'Dodaj plik do każdego dokumentu.' : documents.length === 0 ? 'Brak zakupów w tym miesiącu.' : undefined}>
                    <Send className="h-4 w-4" />{status === 'returned' ? 'Wyślij ponownie' : 'Wyślij rozliczenie'}
                  </button>
                )}
                {onDecide && company.can_approve && settlement && !month.self && status === 'submitted' && (
                  <>
                    <button type="button" className={purchaseButton} onClick={() => onDecide(company, false)}><RotateCcw className="h-4 w-4" />Zwróć do poprawy</button>
                    <button type="button" className={purchasePrimaryButton} onClick={() => onDecide(company, true)}><CheckCircle2 className="h-4 w-4" />Zatwierdź</button>
                  </>
                )}
                {onDecide && company.can_approve && settlement && !month.self && status === 'approved' && (
                  <button type="button" className={purchaseButton} onClick={() => onDecide(company, false)}><RotateCcw className="h-4 w-4" />Cofnij zatwierdzenie</button>
                )}
              </div>
            </div>
            {month.self && editable && missingFiles > 0 && (
              <p className="mb-3 text-xs text-amber-200">Bez pliku: {missingFiles} dok. — dodaj zdjęcie albo skan, zanim wyślesz rozliczenie.</p>
            )}

            {documents.length === 0 ? (
              <p className="text-sm text-[#e5e4e2]/50">Brak zakupów w tym miesiącu.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-[#e5e4e2]/50">
                    <tr>
                      <th className="px-3 py-2 font-normal">Data</th>
                      <th className="px-3 py-2 font-normal">Dokument</th>
                      <th className="px-3 py-2 font-normal">Sprzedawca</th>
                      <th className="px-3 py-2 font-normal">Event</th>
                      <th className="px-3 py-2 font-normal">Zapłata</th>
                      <th className="px-3 py-2 text-right font-normal">Brutto</th>
                      <th className="px-3 py-2 text-right font-normal" aria-label="Czynności" />
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((document) => (
                      <tr key={document.id} className="border-t border-white/5 align-top">
                        <td className="whitespace-nowrap px-3 py-2 text-[#e5e4e2]/80">{purchaseDay(document.date)}</td>
                        <td className="px-3 py-2">
                          <p className="text-[#e5e4e2]">{purchaseKindLabel(document.kind)} {document.number}</p>
                          {document.label && <p className="text-xs text-[#e5e4e2]/60">{document.label}</p>}
                          {document.category_name && <p className="text-xs text-[#e5e4e2]/45">{document.category_name}</p>}
                        </td>
                        <td className="px-3 py-2">
                          <p className="text-[#e5e4e2]">{document.seller_name}</p>
                          {document.seller_nip && <p className="text-xs text-[#e5e4e2]/45">NIP {document.seller_nip}</p>}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {document.event ? (
                            <>
                              <p className="flex items-center gap-1 text-[#e5e4e2]"><CalendarDays className="h-3.5 w-3.5 text-[#d3bb73]" />{document.event.name}</p>
                              <p className="text-[#e5e4e2]/50">
                                {purchaseMoney(document.event.amount)}{document.event.category_name ? ` · ${document.event.category_name}` : ''}
                                {document.event.status ? ` · ${PURCHASE_COST_STATUS_LABELS[document.event.status] || document.event.status}` : ''}
                              </p>
                            </>
                          ) : <span className="text-[#e5e4e2]/40">—</span>}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <p className="flex items-center gap-1 text-[#e5e4e2]/80"><CreditCard className="h-3.5 w-3.5" />{purchaseMethodLabel(document.payment_method)}</p>
                          <p className={`flex items-center gap-1 ${document.bank_matched ? 'text-emerald-300' : 'text-[#e5e4e2]/45'}`}>
                            <Landmark className="h-3.5 w-3.5" />{document.bank_matched ? 'Powiązany z wyciągiem' : 'Czeka na wyciąg'}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-[#e5e4e2]">{purchaseMoney(document.gross, document.currency)}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1.5">
                            {document.has_file ? (
                              <button type="button" className={purchaseButton} onClick={() => onOpenFile(document)} aria-label="Plik dokumentu"><FileText className="h-4 w-4" /></button>
                            ) : <span className="self-center text-xs text-amber-200">bez pliku</span>}
                            {month.self && editable && onEdit && (
                              <button type="button" className={purchaseButton} onClick={() => onEdit(document)} aria-label="Popraw"><Pencil className="h-4 w-4" /></button>
                            )}
                            {month.self && editable && onDelete && !document.bank_matched && (
                              <button type="button" className={purchaseDangerButton} onClick={() => onDelete(document)} aria-label="Usuń"><Trash2 className="h-4 w-4" /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
