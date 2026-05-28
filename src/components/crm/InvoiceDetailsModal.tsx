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
  if (digits.length === 26) {
    return `${digits.slice(0, 2)} ${digits.slice(2).replace(/(.{4})/g, '$1 ').trim()}`;
  }
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

function formatAmount(value: any, currency = 'PLN'): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return `${n.toFixed(2)} ${currency}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('pl-PL');
  } catch {
    return value;
  }
}

interface XmlParsedData {
  items: any[];
  seller_name: string | null;
  seller_nip: string | null;
  seller_address: string | null;
  buyer_name: string | null;
  buyer_nip: string | null;
  buyer_address: string | null;
  payment_due_date: string | null;
  payment_method: string | null;
  payment_info: string | null;
  bank_account_number: string | null;
  bank_swift: string | null;
  bank_name: string | null;
}

function getXmlTag(src: string, tag: string): string | null {
  const m = src.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : null;
}

function getXmlBlock(src: string, tag: string): string | null {
  const m = src.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 's'));
  return m ? m[1] : null;
}

function buildAddressFromXml(block: string): string | null {
  const adresPol = getXmlBlock(block, 'AdresPol') || getXmlBlock(block, 'AdresZagr') || block;
  const kodPocztowy = getXmlTag(adresPol, 'KodPocztowy');
  const miejscowosc = getXmlTag(adresPol, 'Miejscowosc');
  const ulica = getXmlTag(adresPol, 'Ulica');
  const nrDomu = getXmlTag(adresPol, 'NrDomu');
  const nrLokalu = getXmlTag(adresPol, 'NrLokalu');

  const parts: string[] = [];
  if (kodPocztowy || miejscowosc) {
    parts.push([kodPocztowy, miejscowosc].filter(Boolean).join(','));
  }
  const streetParts: string[] = [];
  if (ulica) streetParts.push(ulica);
  if (nrDomu) streetParts.push(nrDomu);
  if (nrLokalu) streetParts.push(`Lok. ${nrLokalu}`);
  if (streetParts.length > 0) parts.push(streetParts.join(' '));

  return parts.length > 0 ? parts.join(', ') : null;
}

function parseFullXml(xml: string | null | undefined): XmlParsedData {
  const empty: XmlParsedData = {
    items: [],
    seller_name: null,
    seller_nip: null,
    seller_address: null,
    buyer_name: null,
    buyer_nip: null,
    buyer_address: null,
    payment_due_date: null,
    payment_method: null,
    payment_info: null,
    bank_account_number: null,
    bank_swift: null,
    bank_name: null,
  };

  if (!xml || typeof xml !== 'string' || xml.length < 50) return empty;

  try {
    // Seller (Podmiot1)
    const podmiot1 = getXmlBlock(xml, 'Podmiot1') || '';
    const sellerNip = getXmlTag(podmiot1, 'NIP') || getXmlTag(podmiot1, 'Nip');
    const sellerName = getXmlTag(podmiot1, 'Nazwa') || getXmlTag(podmiot1, 'NazwaHandlowa') || getXmlTag(podmiot1, 'PelnaNazwa');
    const sellerAddress = buildAddressFromXml(podmiot1);

    // Buyer (Podmiot2)
    const podmiot2 = getXmlBlock(xml, 'Podmiot2') || '';
    const buyerNip = getXmlTag(podmiot2, 'NIP') || getXmlTag(podmiot2, 'Nip');
    const buyerName = getXmlTag(podmiot2, 'Nazwa') || getXmlTag(podmiot2, 'NazwaHandlowa') || getXmlTag(podmiot2, 'PelnaNazwa');
    const buyerAddress = buildAddressFromXml(podmiot2);

    // Payment
    const platnosc = getXmlBlock(xml, 'Platnosc') || '';
    const formaPlatnosci = getXmlTag(platnosc, 'FormaPlatnosci');
    const terminPlatnosci = getXmlTag(platnosc, 'TerminPlatnosci');
    const zaplacono = getXmlTag(platnosc, 'Zaplacono');

    let paymentInfo: string | null = null;
    if (zaplacono === '1' || zaplacono?.toLowerCase() === 'tak') {
      paymentInfo = 'Zapłacono';
    } else if (getXmlTag(platnosc, 'ZnacznikZaplatyCzesciowej') === '1') {
      paymentInfo = 'Zapłata częściowa';
    } else {
      paymentInfo = 'Brak zapłaty';
    }

    // Bank account
    const rachunek = getXmlBlock(xml, 'RachunekBankowy') || getXmlBlock(platnosc, 'RachunekBankowy') || '';
    const bankAccountNumber = getXmlTag(rachunek, 'NrRB') || getXmlTag(rachunek, 'NrRachunku');
    const bankSwift = getXmlTag(rachunek, 'SWIFT') || getXmlTag(rachunek, 'KodSWIFT');
    const bankName = getXmlTag(rachunek, 'NazwaBanku') || getXmlTag(rachunek, 'RachunekWlasnyBanku');

    // Items
    const wierszRegex = /<FaWiersz\b[^>]*>([\s\S]*?)<\/FaWiersz>/g;
    const items: any[] = [];
    let match: RegExpExecArray | null;
    while ((match = wierszRegex.exec(xml)) !== null) {
      const block = match[1];
      const name = getXmlTag(block, 'P_7') || getXmlTag(block, 'P_7A') || 'Pozycja';
      const unit = getXmlTag(block, 'P_8A') || 'szt.';
      const qty = getXmlTag(block, 'P_8B');
      const unitNet = getXmlTag(block, 'P_9A');
      const net = getXmlTag(block, 'P_11');
      const vat = getXmlTag(block, 'P_12');
      const gross = getXmlTag(block, 'P_11A');
      const nrWiersza = getXmlTag(block, 'NrWierszaFa');
      items.push({
        position_number: nrWiersza ? Number(nrWiersza) : items.length + 1,
        name,
        unit,
        quantity: qty != null ? Number(qty) : 1,
        price_net: unitNet != null ? Number(unitNet) : null,
        value_net: net != null ? Number(net) : null,
        vat_rate: vat != null && !Number.isNaN(Number(vat)) ? Number(vat) : vat,
        value_gross: gross != null ? Number(gross) : null,
      });
    }

    return {
      items,
      seller_name: sellerName || null,
      seller_nip: sellerNip || null,
      seller_address: sellerAddress,
      buyer_name: buyerName || null,
      buyer_nip: buyerNip || null,
      buyer_address: buyerAddress,
      payment_due_date: terminPlatnosci || null,
      payment_method: formaPlatnosci || null,
      payment_info: paymentInfo,
      bank_account_number: bankAccountNumber || null,
      bank_swift: bankSwift || null,
      bank_name: bankName || null,
    };
  } catch {
    return empty;
  }
}

function buildFullAddress(c: MyCompanyData | null): string {
  if (!c) return '';
  const streetLine = [c.street, c.building_number].filter(Boolean).join(' ');
  const withApt = c.apartment_number ? `${streetLine}/${c.apartment_number}` : streetLine;
  const cityLine = [c.postal_code, c.city].filter(Boolean).join(' ');
  return [withApt, cityLine, c.country].filter(Boolean).join(', ');
}

interface VatSummaryRow {
  rate: string;
  net: number;
  vat: number;
  gross: number;
}

function computeVatSummary(items: any[], invoiceVatRate: string): VatSummaryRow[] {
  const map = new Map<string, VatSummaryRow>();

  for (const item of items) {
    const rawRate = item.vatRate ?? item.vat_rate ?? item.taxRate ?? invoiceVatRate;
    const rateKey = rawRate == null
      ? invoiceVatRate
      : typeof rawRate === 'number'
        ? `${rawRate}%`
        : String(rawRate).includes('%')
          ? String(rawRate)
          : `${rawRate}%`;

    const qty = Number(item.quantity ?? item.qty ?? 1);
    const unitPrice = Number(
      item.unitPrice ?? item.unit_price ?? item.netPrice ?? item.netUnitPrice ?? item.price_net ?? 0,
    );
    const netTotal = Number(
      item.netAmount ?? item.net_amount ?? item.value_net ?? unitPrice * qty,
    );
    const grossTotal = Number(
      item.grossAmount ?? item.gross_amount ?? item.grossPrice ?? item.value_gross ?? 0,
    );
    const vatAmount = grossTotal > 0 ? grossTotal - netTotal : 0;

    const existing = map.get(rateKey);
    if (existing) {
      existing.net += netTotal;
      existing.vat += vatAmount;
      existing.gross += grossTotal;
    } else {
      map.set(rateKey, { rate: rateKey, net: netTotal, vat: vatAmount, gross: grossTotal });
    }
  }

  return Array.from(map.values());
}

export default function InvoiceDetailsModal({ invoice, onClose }: InvoiceDetailsModalProps) {
  const [myCompany, setMyCompany] = useState<MyCompanyData | null>(null);
  const [dbItems, setDbItems] = useState<any[]>([]);

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

  useEffect(() => {
    let cancelled = false;
    const loadItems = async () => {
      const hasJsonItems =
        Array.isArray(invoice?.invoice_items) && invoice.invoice_items.length > 0;
      if (hasJsonItems) {
        setDbItems([]);
        return;
      }
      if (!invoice?.invoice_id) {
        setDbItems([]);
        return;
      }
      const { data } = await supabase
        .from('invoice_items')
        .select(
          'id,position_number,name,description,unit,quantity,price_net,vat_rate,value_net,vat_amount,value_gross',
        )
        .eq('invoice_id', invoice.invoice_id)
        .order('position_number', { ascending: true });
      if (!cancelled) setDbItems(Array.isArray(data) ? data : []);
    };
    loadItems();
    return () => {
      cancelled = true;
    };
  }, [invoice?.invoice_id, invoice?.invoice_items]);

  const handlePrint = () => {
    window.print();
  };

  const invoiceDate = invoice.issue_date || invoice.ksef_issued_at;
  const invoiceType = getInvoiceTypeLabel(invoice.invoice_number);
  const currency = invoice.currency || 'PLN';
  const isIssued = invoice.invoice_type === 'issued';

  // Parse XML for complete data (fallback when DB fields are empty)
  const xmlData = parseFullXml(invoice?.xml_content);

  const calculateVatRate = () => {
    if (invoice.vat_rate) return invoice.vat_rate;
    if (xmlData.items.length > 0 && xmlData.items[0].vat_rate != null) {
      return `${xmlData.items[0].vat_rate}%`;
    }
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

  // Items priority: DB invoice_items JSON > fetched DB items > XML parsed items
  const items: any[] =
    Array.isArray(invoice.invoice_items) && invoice.invoice_items.length > 0
      ? invoice.invoice_items
      : dbItems.length > 0
        ? dbItems
        : xmlData.items;

  // Bank account: DB field > XML parsed > company data
  const bankAccount =
    invoice.bank_account_number ||
    xmlData.bank_account_number ||
    (isIssued ? myCompany?.bank_account : null) ||
    null;
  const bankSwift = xmlData.bank_swift || null;
  const bankName = xmlData.bank_name || (isIssued ? myCompany?.bank_name : null) || null;
  const vatBankAccount = isIssued ? myCompany?.vat_bank_account : null;
  const vatBankName = isIssued ? myCompany?.vat_bank_name : null;

  // Seller: DB field > XML parsed > company data
  const sellerName = invoice.seller_name || xmlData.seller_name || (isIssued ? myCompany?.legal_name || myCompany?.name : null) || 'Brak danych sprzedawcy';
  const sellerNip = invoice.seller_nip || xmlData.seller_nip || (isIssued ? myCompany?.nip : null);
  const sellerAddress = invoice.seller_address || xmlData.seller_address || (isIssued ? buildFullAddress(myCompany) : null);

  // Buyer: DB field > XML parsed
  const buyerName = invoice.buyer_name || xmlData.buyer_name || 'Brak danych nabywcy';
  const buyerNip = invoice.buyer_nip || xmlData.buyer_nip || null;
  const buyerAddress = invoice.buyer_address || xmlData.buyer_address || null;

  // Payment: DB field > XML parsed
  const paymentDueDate = invoice.payment_due_date || xmlData.payment_due_date || null;
  const paymentMethod = invoice.payment_method || xmlData.payment_method || null;
  const paymentInfo = xmlData.payment_info || null;

  const vatAmount =
    invoice.vat_amount != null
      ? Number(invoice.vat_amount)
      : invoice.net_amount != null && invoice.gross_amount != null
        ? Number(invoice.gross_amount) - Number(invoice.net_amount)
        : null;

  const paymentStatusLabel = (() => {
    if (invoice.payment_status === 'paid' || invoice.payment_date) return 'Opłacona';
    if (invoice.payment_status === 'partially_paid') return 'Częściowo opłacona';
    if (invoice.payment_status === 'overdue') return 'Przeterminowana';
    if (paymentDueDate) {
      const due = new Date(paymentDueDate);
      const now = new Date();
      if (due < now) return 'Przeterminowana';
    }
    return 'Do zapłaty';
  })();

  const paymentStatusClasses = (() => {
    if (invoice.payment_status === 'paid' || invoice.payment_date) {
      return 'bg-green-100 text-green-800';
    }
    if (invoice.payment_status === 'partially_paid') {
      return 'bg-blue-100 text-blue-800';
    }
    if (invoice.payment_status === 'overdue') {
      return 'bg-red-100 text-red-800';
    }
    if (paymentDueDate) {
      const due = new Date(paymentDueDate);
      const now = new Date();
      if (due < now) return 'bg-red-100 text-red-800';
    }
    return 'bg-amber-100 text-amber-800';
  })();

  const vatSummary = items.length > 0 ? computeVatSummary(items, displayVatRate) : [];

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
          {/* Toolbar */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3 print:hidden">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-gray-500" />
              <h2 className="text-lg font-semibold text-gray-900">Szczegóły faktury</h2>
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

          {/* Invoice Content - FA3 Schema Layout */}
          <div
            className="p-8 print:p-10 bg-white"
            id="invoice-print-wrapper"
          >
            {/* === HEADER: Invoice Number, Type, KSeF Reference === */}
            <div className="mb-6 border-b-2 border-gray-800 pb-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  {isIssued && myCompany?.logo_url && (
                    <img
                      src={myCompany.logo_url}
                      alt={myCompany.name}
                      className="h-14 w-auto object-contain"
                    />
                  )}
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900">
                      FAKTURA {invoiceType.toUpperCase()}
                    </h1>
                    <div className="mt-1 text-base font-semibold text-gray-800">
                      Nr: {invoice.invoice_number || 'Brak numeru'}
                    </div>
                  </div>
                </div>
                {invoice.ksef_reference_number && (
                  <div className="text-right">
                    <div className="text-xs font-medium uppercase text-gray-500">Numer KSeF</div>
                    <div className="mt-0.5 font-mono text-xs text-gray-700">
                      {invoice.ksef_reference_number}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* === SPRZEDAWCA / NABYWCA === */}
            <div className="mb-6 grid grid-cols-2 gap-6">
              {/* Sprzedawca */}
              <div>
                <div className="mb-2 flex items-center gap-2 border-b border-gray-300 pb-1">
                  <Building2 className="h-4 w-4 text-gray-600" />
                  <span className="text-sm font-bold uppercase tracking-wide text-gray-700">
                    Sprzedawca
                  </span>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="font-semibold text-gray-900">{sellerName}</div>
                  {sellerNip && (
                    <div className="text-gray-700">
                      <span className="text-gray-500">NIP:</span> {sellerNip}
                    </div>
                  )}
                  {sellerAddress && (
                    <div className="text-gray-700">
                      <span className="text-gray-500">Adres:</span> {sellerAddress}
                    </div>
                  )}
                  {isIssued && myCompany?.email && (
                    <div className="text-gray-700">
                      <span className="text-gray-500">Email:</span> {myCompany.email}
                    </div>
                  )}
                  {isIssued && myCompany?.phone && (
                    <div className="text-gray-700">
                      <span className="text-gray-500">Tel.:</span> {myCompany.phone}
                    </div>
                  )}
                </div>
              </div>

              {/* Nabywca */}
              <div>
                <div className="mb-2 flex items-center gap-2 border-b border-gray-300 pb-1">
                  <User className="h-4 w-4 text-gray-600" />
                  <span className="text-sm font-bold uppercase tracking-wide text-gray-700">
                    Nabywca
                  </span>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="font-semibold text-gray-900">
                    {buyerName}
                  </div>
                  {buyerNip && (
                    <div className="text-gray-700">
                      <span className="text-gray-500">NIP:</span> {buyerNip}
                    </div>
                  )}
                  {buyerAddress && (
                    <div className="text-gray-700">
                      <span className="text-gray-500">Adres:</span> {buyerAddress}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* === SZCZEGÓŁY: Dates, Place === */}
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-2 border-b border-gray-300 pb-1">
                <Calendar className="h-4 w-4 text-gray-600" />
                <span className="text-sm font-bold uppercase tracking-wide text-gray-700">
                  Szczegóły
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <div>
                  <span className="text-gray-500">Data wystawienia:</span>
                  <div className="font-medium text-gray-900">{formatDate(invoiceDate)}</div>
                </div>
                <div>
                  <span className="text-gray-500">Data sprzedaży:</span>
                  <div className="font-medium text-gray-900">
                    {formatDate(invoice.sale_date || invoice.issue_date)}
                  </div>
                </div>
                {invoice.issue_place && (
                  <div>
                    <span className="text-gray-500">Miejsce wystawienia:</span>
                    <div className="font-medium text-gray-900">{invoice.issue_place}</div>
                  </div>
                )}
                {(myCompany as any)?.invoice_issue_place && !invoice.issue_place && (
                  <div>
                    <span className="text-gray-500">Miejsce wystawienia:</span>
                    <div className="font-medium text-gray-900">
                      {(myCompany as any).invoice_issue_place}
                    </div>
                  </div>
                )}
                <div>
                  <span className="text-gray-500">Waluta:</span>
                  <div className="font-medium text-gray-900">{currency}</div>
                </div>
              </div>
            </div>

            {/* === POZYCJE (Line Items Table) === */}
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-2 border-b border-gray-300 pb-1">
                <FileText className="h-4 w-4 text-gray-600" />
                <span className="text-sm font-bold uppercase tracking-wide text-gray-700">
                  Pozycje
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-gray-300 bg-gray-100">
                      <th className="px-2 py-2 text-left font-semibold text-gray-700">Lp.</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-700">Nazwa towaru/usługi</th>
                      <th className="px-2 py-2 text-right font-semibold text-gray-700">Cena jedn. netto</th>
                      <th className="px-2 py-2 text-right font-semibold text-gray-700">Ilość</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-700">Miara</th>
                      <th className="px-2 py-2 text-right font-semibold text-gray-700">Stawka podatku</th>
                      <th className="px-2 py-2 text-right font-semibold text-gray-700">Wartość sprzedaży netto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length > 0 ? (
                      items.map((item: any, index: number) => {
                        const name =
                          item.name || item.description || item.serviceName || item.productName || 'Brak nazwy';
                        const qty = item.quantity ?? item.qty ?? 1;
                        const unit = item.unit || item.unitOfMeasure || 'szt.';
                        const netUnit =
                          item.unitPrice ?? item.unit_price ?? item.netPrice ?? item.netUnitPrice ?? item.price_net ?? null;
                        const netTotal =
                          item.netAmount ?? item.net_amount ?? item.value_net ?? (netUnit != null ? Number(netUnit) * Number(qty) : null);
                        const vatRateRaw = item.vatRate ?? item.vat_rate ?? item.taxRate ?? null;
                        const vatRate =
                          vatRateRaw == null
                            ? displayVatRate
                            : typeof vatRateRaw === 'number'
                              ? `${vatRateRaw}%`
                              : String(vatRateRaw).includes('%')
                                ? vatRateRaw
                                : `${vatRateRaw}%`;

                        return (
                          <tr key={index} className="border-b border-gray-200">
                            <td className="px-2 py-2 text-gray-700">{index + 1}</td>
                            <td className="px-2 py-2 text-gray-900 font-medium">{name}</td>
                            <td className="px-2 py-2 text-right text-gray-900">
                              {netUnit != null ? Number(netUnit).toFixed(2) : '—'}
                            </td>
                            <td className="px-2 py-2 text-right text-gray-900">{qty}</td>
                            <td className="px-2 py-2 text-gray-700">{unit}</td>
                            <td className="px-2 py-2 text-right text-gray-900">{vatRate}</td>
                            <td className="px-2 py-2 text-right font-medium text-gray-900">
                              {netTotal != null ? Number(netTotal).toFixed(2) : '—'}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr className="border-b border-gray-200">
                        <td className="px-2 py-2 text-gray-700">1</td>
                        <td className="px-2 py-2 text-gray-900 font-medium">
                          {isIssued ? 'Towary/usługi' : `Faktura od: ${invoice.seller_name || 'dostawcy'}`}
                        </td>
                        <td className="px-2 py-2 text-right text-gray-900">
                          {invoice.net_amount != null ? Number(invoice.net_amount).toFixed(2) : '—'}
                        </td>
                        <td className="px-2 py-2 text-right text-gray-900">1</td>
                        <td className="px-2 py-2 text-gray-700">szt.</td>
                        <td className="px-2 py-2 text-right text-gray-900">{displayVatRate}</td>
                        <td className="px-2 py-2 text-right font-medium text-gray-900">
                          {invoice.net_amount != null ? Number(invoice.net_amount).toFixed(2) : '—'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* === KWOTA NALEŻNOŚCI OGÓŁEM === */}
            <div className="mb-6 flex justify-end">
              <div className="rounded-lg border-2 border-gray-800 bg-gray-50 px-6 py-3">
                <div className="text-xs uppercase tracking-wider text-gray-600">Kwota należności ogółem</div>
                <div className="mt-1 text-2xl font-bold text-gray-900">
                  {formatAmount(invoice.gross_amount, currency)}
                </div>
              </div>
            </div>

            {/* === PODSUMOWANIE STAWEK PODATKU (VAT Summary by Rate) === */}
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-2 border-b border-gray-300 pb-1">
                <span className="text-sm font-bold uppercase tracking-wide text-gray-700">
                  Podsumowanie stawek podatku
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-gray-300 bg-gray-100">
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">Stawka podatku</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700">Wartość sprzedaży netto</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700">Kwota podatku</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700">Wartość brutto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vatSummary.length > 0 ? (
                      vatSummary.map((row) => (
                        <tr key={row.rate} className="border-b border-gray-200">
                          <td className="px-3 py-2 font-medium text-gray-900">{row.rate}</td>
                          <td className="px-3 py-2 text-right text-gray-900">{row.net.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right text-gray-900">{row.vat.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900">{row.gross.toFixed(2)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr className="border-b border-gray-200">
                        <td className="px-3 py-2 font-medium text-gray-900">{displayVatRate}</td>
                        <td className="px-3 py-2 text-right text-gray-900">
                          {invoice.net_amount != null ? Number(invoice.net_amount).toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-900">
                          {vatAmount != null ? vatAmount.toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-gray-900">
                          {invoice.gross_amount != null ? Number(invoice.gross_amount).toFixed(2) : '—'}
                        </td>
                      </tr>
                    )}
                    {/* Totals row */}
                    <tr className="border-t-2 border-gray-400 bg-gray-50 font-semibold">
                      <td className="px-3 py-2 text-gray-900">RAZEM</td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {invoice.net_amount != null ? Number(invoice.net_amount).toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {vatAmount != null ? vatAmount.toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {invoice.gross_amount != null ? Number(invoice.gross_amount).toFixed(2) : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* === PŁATNOŚĆ (Payment Section) === */}
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-2 border-b border-gray-300 pb-1">
                <CreditCard className="h-4 w-4 text-gray-600" />
                <span className="text-sm font-bold uppercase tracking-wide text-gray-700">
                  Płatność
                </span>
              </div>
              {paymentInfo && (
                <div className="mb-3 text-sm text-gray-700">
                  Informacja o płatności: <span className="font-medium">{paymentInfo}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <div>
                  <span className="text-gray-500">Forma płatności:</span>
                  <div className="font-medium text-gray-900">
                    {formatPaymentMethod(paymentMethod)}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">Termin płatności:</span>
                  <div className="font-medium text-gray-900">
                    {formatDate(paymentDueDate)}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">Status płatności:</span>
                  <div className="mt-0.5">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${paymentStatusClasses}`}>
                      {paymentStatusLabel}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">Data zapłaty:</span>
                  <div className="font-medium text-gray-900">
                    {formatDate(invoice.payment_date)}
                  </div>
                </div>
              </div>
            </div>

            {/* === NUMER RACHUNKU BANKOWEGO (Bank Account Table) === */}
            {(bankAccount || vatBankAccount) && (
              <div className="mb-6">
                <div className="mb-2 flex items-center gap-2 border-b border-gray-300 pb-1">
                  <Banknote className="h-4 w-4 text-gray-600" />
                  <span className="text-sm font-bold uppercase tracking-wide text-gray-700">
                    Numer rachunku bankowego
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <tbody>
                      {bankAccount && (
                        <>
                          <tr className="border-b border-gray-200">
                            <td className="px-3 py-2 font-medium text-gray-700 w-48">Pełny numer rachunku</td>
                            <td className="px-3 py-2 font-mono text-gray-900">
                              {formatBankAccount(bankAccount)}
                            </td>
                          </tr>
                          {bankSwift && (
                            <tr className="border-b border-gray-200">
                              <td className="px-3 py-2 font-medium text-gray-700">Kod SWIFT</td>
                              <td className="px-3 py-2 font-mono text-gray-900">{bankSwift}</td>
                            </tr>
                          )}
                          {bankName && (
                            <tr className="border-b border-gray-200">
                              <td className="px-3 py-2 font-medium text-gray-700">Nazwa banku</td>
                              <td className="px-3 py-2 text-gray-900">{bankName}</td>
                            </tr>
                          )}
                        </>
                      )}
                      {vatBankAccount && (
                        <>
                          <tr className="border-b border-gray-200 border-t-2 border-t-gray-300">
                            <td className="px-3 py-2 font-medium text-gray-700">Rachunek VAT</td>
                            <td className="px-3 py-2 font-mono text-gray-900">
                              {formatBankAccount(vatBankAccount)}
                            </td>
                          </tr>
                          {vatBankName && (
                            <tr className="border-b border-gray-200">
                              <td className="px-3 py-2 font-medium text-gray-700">Nazwa banku</td>
                              <td className="px-3 py-2 text-gray-900">{vatBankName}</td>
                            </tr>
                          )}
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Footer text */}
            {isIssued && myCompany?.invoice_footer_text && (
              <div className="mb-4 rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 whitespace-pre-wrap">
                {myCompany.invoice_footer_text}
              </div>
            )}

            {/* Signature */}
            {isIssued && (myCompany?.signature_name || myCompany?.signature_title) && (
              <div className="flex justify-end">
                <div className="w-56 border-t border-gray-300 pt-2 text-center">
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

            {/* Sync info */}
            <div className="mt-6 border-t border-gray-200 pt-4">
              <div className="text-xs text-gray-400">
                Faktura zsynchronizowana z Krajowym Systemem e-Faktur (KSeF)
                {invoice.synced_at && (
                  <span> | Synchronizacja: {new Date(invoice.synced_at).toLocaleString('pl-PL')}</span>
                )}
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
