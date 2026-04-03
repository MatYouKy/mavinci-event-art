'use client';

import { X, Printer, Download } from 'lucide-react';
import { useEffect, useState } from 'react';

interface InvoiceDetailsModalProps {
  invoice: any;
  onClose: () => void;
}

export default function InvoiceDetailsModal({ invoice, onClose }: InvoiceDetailsModalProps) {
  const [myCompany, setMyCompany] = useState<any>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handlePrint = () => {
    window.print();
  };

  const invoiceDate = invoice.issue_date || invoice.ksef_issued_at;
  const invoiceType = getInvoiceTypeLabel(invoice.invoice_number);

  return (
    <>
      {/* Print-specific styles */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #invoice-print-wrapper,
          #invoice-print-wrapper * {
            visibility: visible;
          }
          #invoice-print-wrapper {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: white;
          }
          .print\\:hidden {
            display: none !important;
          }
        }
      `}</style>

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
        <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 print:hidden">
            <h2 className="text-xl font-semibold text-gray-900">Szczegóły faktury</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <Printer className="h-4 w-4" />
                Drukuj
              </button>
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Invoice Content - Format A4 (210mm x 297mm = 794px x 1123px w 96dpi) */}
          <div
            className="p-8 print:p-12 bg-white"
            id="invoice-print-wrapper"
            style={{ minHeight: '1123px' }}
          >
          {/* Header sekcja */}
          <div className="mb-8 flex items-start justify-between">
            <div>
              <h1 className="mb-2 text-3xl font-bold text-gray-900">
                FAKTURA {invoiceType.toUpperCase()}
              </h1>
              <div className="text-lg text-gray-600">
                Nr: {invoice.invoice_number || 'Brak numeru'}
              </div>
              <div className="mt-1 text-sm text-gray-500">
                KSeF: {invoice.ksef_reference_number}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-600">Data wystawienia</div>
              <div className="text-lg font-semibold text-gray-900">
                {invoiceDate ? new Date(invoiceDate).toLocaleDateString('pl-PL') : '—'}
              </div>
            </div>
          </div>

          {/* Sprzedawca i Nabywca */}
          <div className="mb-8 grid grid-cols-2 gap-8">
            <div>
              <div className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-500">
                Sprzedawca
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="font-semibold text-gray-900">
                  {invoice.seller_name || 'Brak danych sprzedawcy'}
                </div>
                {invoice.seller_nip && (
                  <div className="mt-1 text-sm text-gray-600">NIP: {invoice.seller_nip}</div>
                )}
                {invoice.seller_address && (
                  <div className="mt-2 text-sm text-gray-600">{invoice.seller_address}</div>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-500">
                Nabywca
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="font-semibold text-gray-900">
                  {invoice.buyer_name || 'Brak danych nabywcy'}
                </div>
                {invoice.buyer_nip && (
                  <div className="mt-1 text-sm text-gray-600">NIP: {invoice.buyer_nip}</div>
                )}
                {invoice.buyer_address && (
                  <div className="mt-2 text-sm text-gray-600">{invoice.buyer_address}</div>
                )}
              </div>
            </div>
          </div>

          {/* Informacje o płatności */}
          <div className="mb-8 grid grid-cols-3 gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div>
              <div className="text-xs text-gray-500">Metoda płatności</div>
              <div className="mt-1 font-medium text-gray-900">Przelew</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Termin płatności</div>
              <div className="mt-1 font-medium text-gray-900">
                {invoice.payment_due_date
                  ? new Date(invoice.payment_due_date).toLocaleDateString('pl-PL')
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Status</div>
              <div className="mt-1">
                {invoice.sync_status === 'synced' ? (
                  <span className="inline-flex rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">
                    Zsynchronizowana
                  </span>
                ) : (
                  <span className="inline-flex rounded-full bg-yellow-100 px-2 py-1 text-xs font-semibold text-yellow-800">
                    Oczekuje
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Pozycje faktury */}
          <div className="mb-8">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-gray-300">
                  <th className="pb-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                    Lp.
                  </th>
                  <th className="pb-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                    Nazwa towaru/usługi
                  </th>
                  <th className="pb-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">
                    Ilość
                  </th>
                  <th className="pb-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">
                    Cena netto
                  </th>
                  <th className="pb-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">
                    VAT
                  </th>
                  <th className="pb-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">
                    Wartość brutto
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-200">
                  <td className="py-4 text-sm text-gray-900">1</td>
                  <td className="py-4 text-sm text-gray-900">
                    Usługi eventowe
                    <div className="text-xs text-gray-500">
                      Zgodnie z umową nr {invoice.invoice_number}
                    </div>
                  </td>
                  <td className="py-4 text-right text-sm text-gray-900">1</td>
                  <td className="py-4 text-right text-sm text-gray-900">
                    {invoice.net_amount ? `${Number(invoice.net_amount).toFixed(2)} PLN` : '—'}
                  </td>
                  <td className="py-4 text-right text-sm text-gray-900">23%</td>
                  <td className="py-4 text-right text-sm font-semibold text-gray-900">
                    {invoice.gross_amount
                      ? `${Number(invoice.gross_amount).toFixed(2)} PLN`
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Podsumowanie */}
          <div className="flex justify-end">
            <div className="w-80">
              <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Suma netto:</span>
                  <span className="font-medium text-gray-900">
                    {invoice.net_amount ? `${Number(invoice.net_amount).toFixed(2)} PLN` : '—'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">VAT (23%):</span>
                  <span className="font-medium text-gray-900">
                    {invoice.net_amount
                      ? `${(Number(invoice.net_amount) * 0.23).toFixed(2)} PLN`
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between border-t border-gray-300 pt-2 text-lg">
                  <span className="font-semibold text-gray-900">Do zapłaty:</span>
                  <span className="font-bold text-gray-900">
                    {invoice.gross_amount
                      ? `${Number(invoice.gross_amount).toFixed(2)} PLN`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Stopka */}
          <div className="mt-8 border-t border-gray-200 pt-6">
            <div className="text-xs text-gray-500">
              <p>
                Faktura wygenerowana przez system Mavinci CRM w ramach integracji z Krajowym
                Systemem e-Faktur (KSeF).
              </p>
              <p className="mt-2">
                Data synchronizacji:{' '}
                {invoice.synced_at
                  ? new Date(invoice.synced_at).toLocaleString('pl-PL')
                  : 'Brak danych'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}

function getInvoiceTypeLabel(invoiceNumber: string | null): string {
  if (!invoiceNumber) return 'VAT';

  const upperNumber = invoiceNumber.toUpperCase();

  if (upperNumber.includes('PRO') || upperNumber.includes('PROFORMA')) return 'Pro forma';
  if (upperNumber.includes('ZAL') || upperNumber.includes('ADVANCE')) return 'Zaliczkowa';
  if (upperNumber.includes('KOR') || upperNumber.includes('CORRECTIVE')) return 'Korygująca';
  if (upperNumber.includes('FV')) return 'VAT';

  return 'VAT';
}
