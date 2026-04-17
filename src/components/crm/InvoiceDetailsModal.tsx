'use client';

import { X, Printer, Banknote, CreditCard, Calendar, FileText, Building2, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';

interface InvoiceDetailsModalProps {
  invoice: any;
  onClose: () => void;
}

interface MyCompanyData {
  id: string;
  name: string;
  legal_name: string | null;
  nip: string | null;
  street: string | null;
  building_number: string | null;
  apartment_number: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  bank_account: string | null;
  bank_name: string | null;
  vat_bank_account: string | null;
  vat_bank_name: string | null;
  logo_url: string | null;
  invoice_footer_text: string | null;
  signature_name: string | null;
  signature_title: string | null;
  website: string | null;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  '1': 'Gotówka',
  '2': 'Karta',
  '3': 'Bon',
  '4': 'Czek',
  '5': 'Kredyt',
  '6': 'Przelew',
  '7': 'Mobilna',
  cash: 'Gotówka',
  card: 'Karta',
  transfer: 'Przelew',
  bank_transfer: 'Przelew',
  przelew: 'Przelew',
  gotowka: 'Gotówka',
};

function formatPaymentMethod(raw: string | null | undefined): string {
  if (!raw) return 'Przelew';
  const key = String(raw).toLowerCase().trim();
  return PAYMENT_METHOD_LABELS[key] || PAYMENT_METHOD_LABELS[String(raw)] || String(raw);
}

function formatBankAccount(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\s+/g, '');
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

function formatAmount(value: any, currency = 'PLN'): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return `${n.toFixed(2)} ${currency}`;
}

function buildFullAddress(c: MyCompanyData | null): string {
  if (!c) return '';
  const streetLine = [c.street, c.building_number].filter(Boolean).join(' ');
  const withApt = c.apartment_number ? `${streetLine}/${c.apartment_number}` : streetLine;
  const cityLine = [c.postal_code, c.city].filter(Boolean).join(' ');
  return [withApt, cityLine, c.country].filter(Boolean).join(', ');
}

export default function InvoiceDetailsModal({ invoice, onClose }: InvoiceDetailsModalProps) {
  const [myCompany, setMyCompany] = useState<MyCompanyData | null>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!invoice?.my_company_id) return;
      const { data } = await supabase
        .from('my_companies')
        .select(
          'id,name,legal_name,nip,street,building_number,apartment_number,postal_code,city,country,email,phone,bank_account,bank_name,vat_bank_account,vat_bank_name,logo_url,invoice_footer_text,signature_name,signature_title,website',
        )
        .eq('id', invoice.my_company_id)
        .maybeSingle();
      if (!cancelled && data) setMyCompany(data as MyCompanyData);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [invoice?.my_company_id]);

  const handlePrint = () => {
    window.print();
  };

  const invoiceDate = invoice.issue_date || invoice.ksef_issued_at;
  const invoiceType = getInvoiceTypeLabel(invoice.invoice_number);
  const currency = invoice.currency || 'PLN';
  const isIssued = invoice.invoice_type === 'issued';

  const calculateVatRate = () => {
    if (invoice.vat_rate) return invoice.vat_rate;
    if (invoice.net_amount != null && invoice.gross_amount != null) {
      const net = Number(invoice.net_amount);
      const gross = Number(invoice.gross_amount);
      if (Math.abs(gross - net) < 0.01) return 'zw';
      if (net > 0) {
        const vatPercent = Math.round(((gross - net) / net) * 100);
        return `${vatPercent}%`;
      }
    }
    return '23%';
  };
  const displayVatRate = calculateVatRate();

  const items: any[] =
    Array.isArray(invoice.invoice_items) && invoice.invoice_items.length > 0
      ? invoice.invoice_items
      : [];

  const bankAccount =
    invoice.bank_account_number ||
    (isIssued ? myCompany?.bank_account : null) ||
    null;
  const bankName = isIssued ? myCompany?.bank_name : null;
  const vatBankAccount = isIssued ? myCompany?.vat_bank_account : null;
  const vatBankName = isIssued ? myCompany?.vat_bank_name : null;

  const sellerName = invoice.seller_name || (isIssued ? myCompany?.legal_name || myCompany?.name : null) || 'Brak danych sprzedawcy';
  const sellerNip = invoice.seller_nip || (isIssued ? myCompany?.nip : null);
  const sellerAddress = invoice.seller_address || (isIssued ? buildFullAddress(myCompany) : null);

  const vatAmount =
    invoice.vat_amount != null
      ? Number(invoice.vat_amount)
      : invoice.net_amount != null && invoice.gross_amount != null
        ? Number(invoice.gross_amount) - Number(invoice.net_amount)
        : null;

  const paymentStatusLabel = (() => {
    if (invoice.payment_status === 'paid' || invoice.payment_date) return 'Opłacona';
    if (invoice.payment_due_date) {
      const due = new Date(invoice.payment_due_date);
      const now = new Date();
      if (due < now) return 'Przeterminowana';
    }
    return 'Do zapłaty';
  })();

  const paymentStatusClasses = (() => {
    if (invoice.payment_status === 'paid' || invoice.payment_date) {
      return 'bg-green-100 text-green-800';
    }
    if (invoice.payment_due_date) {
      const due = new Date(invoice.payment_due_date);
      const now = new Date();
      if (due < now) return 'bg-red-100 text-red-800';
    }
    return 'bg-amber-100 text-amber-800';
  })();

  return (
    <>
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
        <div className="relative w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 print:hidden">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-gray-500" />
              <h2 className="text-xl font-semibold text-gray-900">Szczegóły faktury</h2>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${paymentStatusClasses}`}>
                {paymentStatusLabel}
              </span>
            </div>
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
                aria-label="Zamknij"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Invoice Content */}
          <div
            className="p-8 print:p-12 bg-white flex flex-col"
            id="invoice-print-wrapper"
            style={{ minHeight: '1123px' }}
          >
            <div className="flex-1">
              {/* Header sekcja */}
              <div className="mb-8 flex items-start justify-between">
                <div className="flex items-start gap-4">
                  {isIssued && myCompany?.logo_url && (
                    <img
                      src={myCompany.logo_url}
                      alt={myCompany.name}
                      className="h-16 w-auto object-contain"
                    />
                  )}
                  <div>
                    <h1 className="mb-2 text-3xl font-bold text-gray-900">
                      FAKTURA {invoiceType.toUpperCase()}
                    </h1>
                    <div className="text-lg text-gray-700">
                      Nr: <span className="font-semibold">{invoice.invoice_number || 'Brak numeru'}</span>
                    </div>
                    {invoice.ksef_reference_number && (
                      <div className="mt-1 text-xs text-gray-500">
                        KSeF: <span className="font-mono">{invoice.ksef_reference_number}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-600">Data wystawienia</div>
                  <div className="text-lg font-semibold text-gray-900">
                    {invoiceDate ? new Date(invoiceDate).toLocaleDateString('pl-PL') : '—'}
                  </div>
                  {myCompany?.invoice_issue_place && (
                    <div className="mt-1 text-sm text-gray-500">
                      Miejsce: {(myCompany as any).invoice_issue_place}
                    </div>
                  )}
                </div>
              </div>

              {/* Sprzedawca i Nabywca */}
              <div className="mb-8 grid grid-cols-2 gap-6">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500">
                    <Building2 className="h-4 w-4" />
                    Sprzedawca
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="font-semibold text-gray-900">{sellerName}</div>
                    {sellerNip && (
                      <div className="mt-1 text-sm text-gray-600">NIP: {sellerNip}</div>
                    )}
                    {sellerAddress && (
                      <div className="mt-2 text-sm text-gray-600">{sellerAddress}</div>
                    )}
                    {isIssued && myCompany?.email && (
                      <div className="mt-2 text-sm text-gray-600">Email: {myCompany.email}</div>
                    )}
                    {isIssued && myCompany?.phone && (
                      <div className="text-sm text-gray-600">Tel.: {myCompany.phone}</div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500">
                    <User className="h-4 w-4" />
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
              <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500">
                  <CreditCard className="h-4 w-4" />
                  Płatność
                </div>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div>
                    <div className="text-xs text-gray-500">Metoda płatności</div>
                    <div className="mt-1 font-medium text-gray-900">
                      {formatPaymentMethod(invoice.payment_method)}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Calendar className="h-3 w-3" />
                      Termin płatności
                    </div>
                    <div className="mt-1 font-medium text-gray-900">
                      {invoice.payment_due_date
                        ? new Date(invoice.payment_due_date).toLocaleDateString('pl-PL')
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Status</div>
                    <div className="mt-1">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${paymentStatusClasses}`}>
                        {paymentStatusLabel}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Data zapłaty</div>
                    <div className="mt-1 font-medium text-gray-900">
                      {invoice.payment_date
                        ? new Date(invoice.payment_date).toLocaleDateString('pl-PL')
                        : '—'}
                    </div>
                  </div>
                </div>

                {(bankAccount || vatBankAccount) && (
                  <div className="mt-4 space-y-3 border-t border-gray-200 pt-4">
                    {bankAccount && (
                      <div className="flex items-start gap-3">
                        <Banknote className="mt-0.5 h-4 w-4 text-gray-500" />
                        <div className="flex-1">
                          <div className="text-xs text-gray-500">
                            {isIssued ? 'Numer konta do wpłaty' : 'Numer konta bankowego'}
                          </div>
                          <div className="mt-0.5 font-mono text-sm font-medium text-gray-900 break-all">
                            {formatBankAccount(bankAccount)}
                          </div>
                          {bankName && (
                            <div className="text-xs text-gray-600">{bankName}</div>
                          )}
                        </div>
                      </div>
                    )}
                    {vatBankAccount && (
                      <div className="flex items-start gap-3">
                        <Banknote className="mt-0.5 h-4 w-4 text-gray-500" />
                        <div className="flex-1">
                          <div className="text-xs text-gray-500">
                            Rachunek VAT (split payment)
                          </div>
                          <div className="mt-0.5 font-mono text-sm font-medium text-gray-900 break-all">
                            {formatBankAccount(vatBankAccount)}
                          </div>
                          {vatBankName && (
                            <div className="text-xs text-gray-600">{vatBankName}</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Pozycje faktury */}
              <div className="mb-6">
                <div className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
                  Pozycje faktury
                </div>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr className="border-b border-gray-200">
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                          Lp.
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                          Nazwa towaru/usługi
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">
                          Ilość
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-600">
                          J.m.
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">
                          Cena netto
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">
                          Wart. netto
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">
                          VAT
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-gray-600">
                          Wart. brutto
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length > 0 ? (
                        items.map((item: any, index: number) => {
                          const name =
                            item.name ||
                            item.description ||
                            item.serviceName ||
                            item.productName ||
                            'Brak nazwy';
                          const description =
                            item.description && item.description !== item.name
                              ? item.description
                              : null;
                          const qty = item.quantity ?? item.qty ?? 1;
                          const unit = item.unit || item.unitOfMeasure || 'szt.';
                          const netUnit =
                            item.unitPrice ??
                            item.unit_price ??
                            item.netPrice ??
                            item.netUnitPrice ??
                            null;
                          const netTotal =
                            item.netAmount ??
                            item.net_amount ??
                            (netUnit != null ? Number(netUnit) * Number(qty) : null);
                          const vatRate =
                            item.vatRate || item.vat_rate || item.taxRate || displayVatRate;
                          const grossTotal =
                            item.grossAmount ??
                            item.gross_amount ??
                            item.grossPrice ??
                            null;

                          return (
                            <tr key={index} className="border-b border-gray-100 last:border-b-0">
                              <td className="px-3 py-3 text-sm text-gray-900">{index + 1}</td>
                              <td className="px-3 py-3 text-sm text-gray-900">
                                <div className="font-medium">{name}</div>
                                {description && (
                                  <div className="mt-0.5 text-xs text-gray-500">{description}</div>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right text-sm text-gray-900">{qty}</td>
                              <td className="px-3 py-3 text-sm text-gray-700">{unit}</td>
                              <td className="px-3 py-3 text-right text-sm text-gray-900">
                                {netUnit != null ? formatAmount(netUnit, currency) : '—'}
                              </td>
                              <td className="px-3 py-3 text-right text-sm text-gray-900">
                                {netTotal != null ? formatAmount(netTotal, currency) : '—'}
                              </td>
                              <td className="px-3 py-3 text-right text-sm text-gray-900">
                                {vatRate}
                              </td>
                              <td className="px-3 py-3 text-right text-sm font-semibold text-gray-900">
                                {grossTotal != null ? formatAmount(grossTotal, currency) : '—'}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr className="border-b border-gray-100 last:border-b-0">
                          <td className="px-3 py-3 text-sm text-gray-900">1</td>
                          <td className="px-3 py-3 text-sm text-gray-900">
                            <div className="font-medium">Faktura zbiorcza</div>
                            <div className="mt-0.5 text-xs text-gray-500">
                              Szczegółowe pozycje niedostępne w danych z KSeF
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right text-sm text-gray-900">1</td>
                          <td className="px-3 py-3 text-sm text-gray-700">szt.</td>
                          <td className="px-3 py-3 text-right text-sm text-gray-900">
                            {formatAmount(invoice.net_amount, currency)}
                          </td>
                          <td className="px-3 py-3 text-right text-sm text-gray-900">
                            {formatAmount(invoice.net_amount, currency)}
                          </td>
                          <td className="px-3 py-3 text-right text-sm text-gray-900">
                            {displayVatRate}
                          </td>
                          <td className="px-3 py-3 text-right text-sm font-semibold text-gray-900">
                            {formatAmount(invoice.gross_amount, currency)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Podsumowanie */}
              <div className="flex justify-end">
                <div className="w-full max-w-sm">
                  <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Suma netto:</span>
                      <span className="font-medium text-gray-900">
                        {formatAmount(invoice.net_amount, currency)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">VAT ({displayVatRate}):</span>
                      <span className="font-medium text-gray-900">
                        {vatAmount != null ? formatAmount(vatAmount, currency) : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-gray-300 pt-2 text-lg">
                      <span className="font-semibold text-gray-900">Do zapłaty:</span>
                      <span className="font-bold text-gray-900">
                        {formatAmount(invoice.gross_amount, currency)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer text z my_companies */}
              {isIssued && myCompany?.invoice_footer_text && (
                <div className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 whitespace-pre-wrap">
                  {myCompany.invoice_footer_text}
                </div>
              )}

              {/* Signature */}
              {isIssued && (myCompany?.signature_name || myCompany?.signature_title) && (
                <div className="mt-8 flex justify-end">
                  <div className="w-64 border-t border-gray-300 pt-2 text-center">
                    {myCompany?.signature_name && (
                      <div className="text-sm font-medium text-gray-900">
                        {myCompany.signature_name}
                      </div>
                    )}
                    {myCompany?.signature_title && (
                      <div className="text-xs text-gray-600">{myCompany.signature_title}</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Stopka */}
            <div className="mt-auto border-t border-gray-200 pt-6">
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
