'use client';

import { X, Printer, Banknote, CreditCard, Calendar, FileText, Building2, User, Loader2 } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/browser';
import Image from 'next/image';

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
  issue_date: string | null;
  sale_date: string | null;
  net_amount: number | null;
  vat_amount: number | null;
  gross_amount: number | null;
  currency: string | null;
  invoice_number: string | null;
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

  const streetParts: string[] = [];
  if (ulica) streetParts.push(ulica);
  if (nrDomu) streetParts.push(nrDomu);
  if (nrLokalu) streetParts.push(`lok. ${nrLokalu}`);

  const parts: string[] = [];
  if (streetParts.length > 0) parts.push(streetParts.join(' '));
  if (kodPocztowy || miejscowosc) {
    parts.push([kodPocztowy, miejscowosc].filter(Boolean).join(' '));
  }

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
    issue_date: null,
    sale_date: null,
    net_amount: null,
    vat_amount: null,
    gross_amount: null,
    currency: null,
    invoice_number: null,
  };

  if (!xml || typeof xml !== 'string' || xml.length < 50) return empty;

  try {
    const podmiot1 = getXmlBlock(xml, 'Podmiot1') || '';
    const sellerNip = getXmlTag(podmiot1, 'NIP') || getXmlTag(podmiot1, 'Nip');
    const sellerName = getXmlTag(podmiot1, 'Nazwa') || getXmlTag(podmiot1, 'NazwaHandlowa') || getXmlTag(podmiot1, 'PelnaNazwa');
    const sellerAddress = buildAddressFromXml(podmiot1);

    const podmiot2 = getXmlBlock(xml, 'Podmiot2') || '';
    const buyerNip = getXmlTag(podmiot2, 'NIP') || getXmlTag(podmiot2, 'Nip');
    const buyerName = getXmlTag(podmiot2, 'Nazwa') || getXmlTag(podmiot2, 'NazwaHandlowa') || getXmlTag(podmiot2, 'PelnaNazwa');
    const buyerAddress = buildAddressFromXml(podmiot2);

    const fa = getXmlBlock(xml, 'Fa') || xml;
    const invoiceNumber = getXmlTag(fa, 'P_2') || getXmlTag(xml, 'P_2');
    const issueDate = getXmlTag(fa, 'P_1') || getXmlTag(xml, 'P_1');
    const saleDate = getXmlTag(fa, 'P_6') || getXmlTag(xml, 'P_6');
    const currency = getXmlTag(fa, 'KodWaluty') || getXmlTag(xml, 'KodWaluty') || 'PLN';

    const netAmountRaw = getXmlTag(fa, 'P_13_1') || getXmlTag(fa, 'P_13_2') || getXmlTag(fa, 'P_13_3') || getXmlTag(fa, 'P_13_6');
    const vatAmountRaw = getXmlTag(fa, 'P_14_1') || getXmlTag(fa, 'P_14_2') || getXmlTag(fa, 'P_14_3');
    const grossAmountRaw = getXmlTag(fa, 'P_15') || getXmlTag(xml, 'P_15');

    const platnosc = getXmlBlock(xml, 'Platnosc') || getXmlBlock(fa, 'Platnosc') || '';
    const formaPlatnosci = getXmlTag(platnosc, 'FormaPlatnosci');
    const terminPlatnosci = getXmlTag(platnosc, 'TerminPlatnosci');
    const zaplacono = getXmlTag(platnosc, 'Zaplacono');

    let paymentInfo: string | null = null;
    if (zaplacono === '1' || zaplacono?.toLowerCase() === 'tak') {
      paymentInfo = 'Zapłacono';
    } else if (getXmlTag(platnosc, 'ZnacznikZaplatyCzesciowej') === '1') {
      paymentInfo = 'Zapłata częściowa';
    } else {
      paymentInfo = null;
    }

    const rachunek = getXmlBlock(xml, 'RachunekBankowy') || getXmlBlock(platnosc, 'RachunekBankowy') || '';
    const bankAccountNumber = getXmlTag(rachunek, 'NrRB') || getXmlTag(rachunek, 'NrRachunku');
    const bankSwift = getXmlTag(rachunek, 'SWIFT') || getXmlTag(rachunek, 'KodSWIFT');
    const bankName = getXmlTag(rachunek, 'NazwaBanku') || getXmlTag(rachunek, 'RachunekWlasnyBanku');

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
        vat_rate: vat,
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
      issue_date: issueDate || null,
      sale_date: saleDate || null,
      net_amount: netAmountRaw ? Number(netAmountRaw) : null,
      vat_amount: vatAmountRaw ? Number(vatAmountRaw) : null,
      gross_amount: grossAmountRaw ? Number(grossAmountRaw) : null,
      currency,
      invoice_number: invoiceNumber || null,
    };
  } catch {
    return {
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
      issue_date: null,
      sale_date: null,
      net_amount: null,
      vat_amount: null,
      gross_amount: null,
      currency: null,
      invoice_number: null,
    };
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

function computeVatSummary(items: any[], fallbackVatRate: string): VatSummaryRow[] {
  const map = new Map<string, VatSummaryRow>();

  for (const item of items) {
    const rawRate = item.vatRate ?? item.vat_rate ?? item.taxRate ?? null;
    let rateKey: string;
    if (rawRate == null || rawRate === '') {
      rateKey = fallbackVatRate;
    } else if (typeof rawRate === 'number') {
      rateKey = `${rawRate}%`;
    } else {
      const s = String(rawRate).trim();
      rateKey = s.includes('%') ? s : `${s}%`;
    }

    const qty = Number(item.quantity ?? item.qty ?? 1);
    const unitPrice = Number(item.unitPrice ?? item.unit_price ?? item.netPrice ?? item.netUnitPrice ?? item.price_net ?? 0);
    const netTotal = Number(item.netAmount ?? item.net_amount ?? item.value_net ?? unitPrice * qty);
    const grossTotal = Number(item.grossAmount ?? item.gross_amount ?? item.grossPrice ?? item.value_gross ?? 0);
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

function isKsefInvoiceMissingDetails(inv: any): boolean {
  if (!inv.ksef_reference_number) return false;
  const hasItems = Array.isArray(inv.invoice_items) && inv.invoice_items.length > 0;
  const hasXml = inv.xml_content && inv.xml_content.length > 100;
  const hasAddress = inv.seller_address || inv.buyer_address;
  return !hasItems && !hasXml && !hasAddress;
}

export default function InvoiceDetailsModal({ invoice, onClose }: InvoiceDetailsModalProps) {
  const [myCompany, setMyCompany] = useState<MyCompanyData | null>(null);
  const [dbItems, setDbItems] = useState<any[]>([]);
  const [enrichedInvoice, setEnrichedInvoice] = useState<any>(invoice);
  const [enrichedParsed, setEnrichedParsed] = useState<XmlParsedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const fetchKsefDetails = useCallback(async () => {
    if (!isKsefInvoiceMissingDetails(invoice)) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/bridge/ksef/invoices/detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: invoice.id,
          ksefReferenceNumber: invoice.ksef_reference_number,
        }),
      });
      const result = await res.json();
      if (result.success && result.invoice) {
        setEnrichedInvoice(result.invoice);
        if (result.parsed) {
          setEnrichedParsed(result.parsed);
        }
      } else {
        setFetchError(result.error || 'Nie udało się pobrać szczegółów');
      }
    } catch (e: any) {
      setFetchError(e?.message || 'Błąd połączenia');
    } finally {
      setLoading(false);
    }
  }, [invoice]);

  useEffect(() => {
    fetchKsefDetails();
  }, [fetchKsefDetails]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!enrichedInvoice?.my_company_id) return;
      const { data } = await supabase
        .from('my_companies')
        .select(
          'id,name,legal_name,nip,street,building_number,apartment_number,postal_code,city,country,email,phone,bank_account,bank_name,vat_bank_account,vat_bank_name,logo_url,invoice_footer_text,signature_name,signature_title,website',
        )
        .eq('id', enrichedInvoice.my_company_id)
        .maybeSingle();
      if (!cancelled && data) setMyCompany(data as MyCompanyData);
    };
    load();
    return () => { cancelled = true; };
  }, [enrichedInvoice?.my_company_id]);

  useEffect(() => {
    let cancelled = false;
    const loadItems = async () => {
      const hasJsonItems = Array.isArray(enrichedInvoice?.invoice_items) && enrichedInvoice.invoice_items.length > 0;
      if (hasJsonItems) {
        setDbItems([]);
        return;
      }
      if (!enrichedInvoice?.invoice_id) {
        setDbItems([]);
        return;
      }
      const { data } = await supabase
        .from('invoice_items')
        .select('id,position_number,name,description,unit,quantity,price_net,vat_rate,value_net,vat_amount,value_gross')
        .eq('invoice_id', enrichedInvoice.invoice_id)
        .order('position_number', { ascending: true });
      if (!cancelled) setDbItems(Array.isArray(data) ? data : []);
    };
    loadItems();
    return () => { cancelled = true; };
  }, [enrichedInvoice?.invoice_id, enrichedInvoice?.invoice_items]);

  const handlePrint = () => {
    window.print();
  };

  const inv = enrichedInvoice;
  const invoiceDate = inv.issue_date || inv.ksef_issued_at;
  const invoiceType = getInvoiceTypeLabel(inv.invoice_number);
  const currency = inv.currency || 'PLN';
  const isIssued = inv.invoice_type === 'issued';

  const xmlData = enrichedParsed
    ? {
        items: (enrichedParsed as any).invoice_items || enrichedParsed.items || [],
        seller_name: enrichedParsed.seller_name || null,
        seller_nip: enrichedParsed.seller_nip || null,
        seller_address: enrichedParsed.seller_address || null,
        buyer_name: enrichedParsed.buyer_name || null,
        buyer_nip: enrichedParsed.buyer_nip || null,
        buyer_address: enrichedParsed.buyer_address || null,
        payment_due_date: enrichedParsed.payment_due_date || null,
        payment_method: enrichedParsed.payment_method || null,
        payment_info: enrichedParsed.payment_info || null,
        bank_account_number: enrichedParsed.bank_account_number || null,
        bank_swift: enrichedParsed.bank_swift || null,
        bank_name: enrichedParsed.bank_name || null,
        issue_date: enrichedParsed.issue_date || null,
        sale_date: enrichedParsed.sale_date || null,
        net_amount: enrichedParsed.net_amount ?? null,
        vat_amount: enrichedParsed.vat_amount ?? null,
        gross_amount: enrichedParsed.gross_amount ?? null,
        currency: enrichedParsed.currency || null,
        invoice_number: enrichedParsed.invoice_number || null,
      } as XmlParsedData
    : parseFullXml(inv?.xml_content);

  const calculateVatRate = () => {
    if (inv.vat_rate) return inv.vat_rate;
    if (xmlData.items.length > 0 && xmlData.items[0].vat_rate != null) {
      return `${xmlData.items[0].vat_rate}%`;
    }
    if (inv.net_amount != null && inv.gross_amount != null) {
      const net = Number(inv.net_amount);
      const gross = Number(inv.gross_amount);
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
    Array.isArray(inv.invoice_items) && inv.invoice_items.length > 0
      ? inv.invoice_items
      : dbItems.length > 0
        ? dbItems
        : xmlData.items;

  const bankAccount = inv.bank_account_number || xmlData.bank_account_number || (isIssued ? myCompany?.bank_account : null) || null;
  const bankSwift = xmlData.bank_swift || null;
  const bankName = xmlData.bank_name || (isIssued ? myCompany?.bank_name : null) || null;
  const vatBankAccount = isIssued ? myCompany?.vat_bank_account : null;
  const vatBankName = isIssued ? myCompany?.vat_bank_name : null;

  const sellerName = inv.seller_name || xmlData.seller_name || (isIssued ? myCompany?.legal_name || myCompany?.name : null) || 'Brak danych sprzedawcy';
  const sellerNip = inv.seller_nip || xmlData.seller_nip || (isIssued ? myCompany?.nip : null);
  const sellerAddress = inv.seller_address || xmlData.seller_address || (isIssued ? buildFullAddress(myCompany) : null);

  const buyerName = inv.buyer_name || xmlData.buyer_name || 'Brak danych nabywcy';
  const buyerNip = inv.buyer_nip || xmlData.buyer_nip || null;
  const buyerAddress = inv.buyer_address || xmlData.buyer_address || null;

  const paymentDueDate = inv.payment_due_date || xmlData.payment_due_date || null;
  const paymentMethod = inv.payment_method || xmlData.payment_method || null;
  const paymentInfo = xmlData.payment_info || null;

  const netAmount = inv.net_amount ?? xmlData.net_amount ?? null;
  const grossAmount = inv.gross_amount ?? xmlData.gross_amount ?? null;
  const vatAmount = inv.vat_amount ?? xmlData.vat_amount ?? (netAmount != null && grossAmount != null ? Number(grossAmount) - Number(netAmount) : null);

  const paymentStatusLabel = (() => {
    if (inv.payment_status === 'paid' || inv.payment_date) return 'Opłacona';
    if (inv.payment_status === 'partially_paid') return 'Częściowo opłacona';
    if (inv.payment_status === 'overdue') return 'Przeterminowana';
    if (paymentInfo === 'Zapłacono') return 'Opłacona';
    if (paymentDueDate) {
      const due = new Date(paymentDueDate);
      if (due < new Date()) return 'Przeterminowana';
    }
    return 'Do zapłaty';
  })();

  const paymentStatusClasses = (() => {
    if (inv.payment_status === 'paid' || inv.payment_date || paymentInfo === 'Zapłacono') {
      return 'bg-green-100 text-green-800';
    }
    if (inv.payment_status === 'partially_paid') return 'bg-blue-100 text-blue-800';
    if (inv.payment_status === 'overdue') return 'bg-red-100 text-red-800';
    if (paymentDueDate) {
      const due = new Date(paymentDueDate);
      if (due < new Date()) return 'bg-red-100 text-red-800';
    }
    return 'bg-amber-100 text-amber-800';
  })();

  const vatSummary = items.length > 0 ? computeVatSummary(items, displayVatRate) : [];

  return (
    <>
      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          #invoice-print-wrapper, #invoice-print-wrapper * { visibility: visible; }
          #invoice-print-wrapper { position: absolute; left: 0; top: 0; width: 100%; background: white; }
          .print\\:hidden { display: none !important; }
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

          {/* Loading state */}
          {loading && (
            <div className="flex items-center gap-3 border-b border-blue-100 bg-blue-50 px-6 py-3 print:hidden">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              <span className="text-sm text-blue-700">Pobieranie pełnych danych faktury z KSeF...</span>
            </div>
          )}

          {fetchError && (
            <div className="border-b border-amber-100 bg-amber-50 px-6 py-3 print:hidden">
              <span className="text-sm text-amber-700">{fetchError}</span>
            </div>
          )}

          {/* Invoice Content */}
          <div className="p-8 print:p-10 bg-white" id="invoice-print-wrapper">
            {/* HEADER */}
            <div className="mb-6 border-b-2 border-gray-800 pb-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  {isIssued && myCompany?.logo_url && (
                    <Image
                    width={256}
                    height={256}
                    src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${invoice.company_logo_url}`}
                    alt="Logo firmy"
                    className="max-h-32 max-w-[300px] object-contain"
                  />
                  )}
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900">
                      FAKTURA {invoiceType.toUpperCase()}
                    </h1>
                    <div className="mt-1 text-base font-semibold text-gray-800">
                      Nr: {inv.invoice_number || xmlData.invoice_number || 'Brak numeru'}
                    </div>
                  </div>
                </div>
                {inv.ksef_reference_number && (
                  <div className="text-right">
                    <div className="text-xs font-medium uppercase text-gray-500">Numer KSeF</div>
                    <div className="mt-0.5 font-mono text-xs text-gray-700">
                      {inv.ksef_reference_number}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* SPRZEDAWCA / NABYWCA */}
            <div className="mb-6 grid grid-cols-2 gap-6">
              <div>
                <div className="mb-2 flex items-center gap-2 border-b border-gray-300 pb-1">
                  <Building2 className="h-4 w-4 text-gray-600" />
                  <span className="text-sm font-bold uppercase tracking-wide text-gray-700">Sprzedawca</span>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="font-semibold text-gray-900">{sellerName}</div>
                  {sellerNip && (
                    <div className="text-gray-700"><span className="text-gray-500">NIP:</span> {sellerNip}</div>
                  )}
                  {sellerAddress && (
                    <div className="text-gray-700"><span className="text-gray-500">Adres:</span> {sellerAddress}</div>
                  )}
                  {isIssued && myCompany?.email && (
                    <div className="text-gray-700"><span className="text-gray-500">Email:</span> {myCompany.email}</div>
                  )}
                  {isIssued && myCompany?.phone && (
                    <div className="text-gray-700"><span className="text-gray-500">Tel.:</span> {myCompany.phone}</div>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 border-b border-gray-300 pb-1">
                  <User className="h-4 w-4 text-gray-600" />
                  <span className="text-sm font-bold uppercase tracking-wide text-gray-700">Nabywca</span>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="font-semibold text-gray-900">{buyerName}</div>
                  {buyerNip && (
                    <div className="text-gray-700"><span className="text-gray-500">NIP:</span> {buyerNip}</div>
                  )}
                  {buyerAddress && (
                    <div className="text-gray-700"><span className="text-gray-500">Adres:</span> {buyerAddress}</div>
                  )}
                </div>
              </div>
            </div>

            {/* SZCZEGÓŁY */}
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-2 border-b border-gray-300 pb-1">
                <Calendar className="h-4 w-4 text-gray-600" />
                <span className="text-sm font-bold uppercase tracking-wide text-gray-700">Szczegóły</span>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <div>
                  <span className="text-gray-500">Data wystawienia:</span>
                  <div className="font-medium text-gray-900">{formatDate(invoiceDate || xmlData.issue_date)}</div>
                </div>
                <div>
                  <span className="text-gray-500">Data sprzedaży:</span>
                  <div className="font-medium text-gray-900">{formatDate(inv.sale_date || xmlData.sale_date || inv.issue_date)}</div>
                </div>
                {inv.issue_place && (
                  <div>
                    <span className="text-gray-500">Miejsce wystawienia:</span>
                    <div className="font-medium text-gray-900">{inv.issue_place}</div>
                  </div>
                )}
                <div>
                  <span className="text-gray-500">Waluta:</span>
                  <div className="font-medium text-gray-900">{xmlData.currency || currency}</div>
                </div>
              </div>
            </div>

            {/* POZYCJE */}
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-2 border-b border-gray-300 pb-1">
                <FileText className="h-4 w-4 text-gray-600" />
                <span className="text-sm font-bold uppercase tracking-wide text-gray-700">Pozycje</span>
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
                      <th className="px-2 py-2 text-right font-semibold text-gray-700">Wartość netto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length > 0 ? (
                      items.map((item: any, index: number) => {
                        const name = item.name || item.description || item.serviceName || item.productName || 'Brak nazwy';
                        const qty = item.quantity ?? item.qty ?? 1;
                        const unit = item.unit || item.unitOfMeasure || 'szt.';
                        const netUnit = item.unitPrice ?? item.unit_price ?? item.netPrice ?? item.netUnitPrice ?? item.price_net ?? null;
                        const netTotal = item.netAmount ?? item.net_amount ?? item.value_net ?? (netUnit != null ? Number(netUnit) * Number(qty) : null);
                        const vatRateRaw = item.vatRate ?? item.vat_rate ?? item.taxRate ?? null;
                        const vatRate = vatRateRaw == null
                          ? displayVatRate
                          : typeof vatRateRaw === 'number'
                            ? `${vatRateRaw}%`
                            : String(vatRateRaw).includes('%') ? vatRateRaw : `${vatRateRaw}%`;

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
                    ) : loading ? (
                      <tr>
                        <td colSpan={7} className="px-2 py-6 text-center text-gray-500">
                          <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
                        </td>
                      </tr>
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-2 py-4 text-center text-sm text-gray-500">
                          Brak szczegółowych pozycji faktury
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* KWOTA NALEŻNOŚCI */}
            <div className="mb-6 flex justify-end">
              <div className="rounded-lg border-2 border-gray-800 bg-gray-50 px-6 py-3">
                <div className="text-xs uppercase tracking-wider text-gray-600">Kwota należności ogółem</div>
                <div className="mt-1 text-2xl font-bold text-gray-900">
                  {formatAmount(grossAmount, xmlData.currency || currency)}
                </div>
              </div>
            </div>

            {/* PODSUMOWANIE STAWEK PODATKU */}
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-2 border-b border-gray-300 pb-1">
                <span className="text-sm font-bold uppercase tracking-wide text-gray-700">Podsumowanie stawek podatku</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-gray-300 bg-gray-100">
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">Stawka podatku</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700">Wartość netto</th>
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
                          {netAmount != null ? Number(netAmount).toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-900">
                          {vatAmount != null ? Number(vatAmount).toFixed(2) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-gray-900">
                          {grossAmount != null ? Number(grossAmount).toFixed(2) : '—'}
                        </td>
                      </tr>
                    )}
                    <tr className="border-t-2 border-gray-400 bg-gray-50 font-semibold">
                      <td className="px-3 py-2 text-gray-900">RAZEM</td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {netAmount != null ? Number(netAmount).toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {vatAmount != null ? Number(vatAmount).toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900">
                        {grossAmount != null ? Number(grossAmount).toFixed(2) : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* PŁATNOŚĆ */}
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-2 border-b border-gray-300 pb-1">
                <CreditCard className="h-4 w-4 text-gray-600" />
                <span className="text-sm font-bold uppercase tracking-wide text-gray-700">Płatność</span>
              </div>
              {paymentInfo && (
                <div className="mb-3 text-sm text-gray-700">
                  Informacja o płatności: <span className="font-medium">{paymentInfo}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <div>
                  <span className="text-gray-500">Forma płatności:</span>
                  <div className="font-medium text-gray-900">{formatPaymentMethod(paymentMethod)}</div>
                </div>
                <div>
                  <span className="text-gray-500">Termin płatności:</span>
                  <div className="font-medium text-gray-900">{formatDate(paymentDueDate)}</div>
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
                  <div className="font-medium text-gray-900">{formatDate(inv.payment_date)}</div>
                </div>
              </div>
            </div>

            {/* RACHUNEK BANKOWY */}
            {(bankAccount || vatBankAccount) && (
              <div className="mb-6">
                <div className="mb-2 flex items-center gap-2 border-b border-gray-300 pb-1">
                  <Banknote className="h-4 w-4 text-gray-600" />
                  <span className="text-sm font-bold uppercase tracking-wide text-gray-700">Numer rachunku bankowego</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <tbody>
                      {bankAccount && (
                        <>
                          <tr className="border-b border-gray-200">
                            <td className="px-3 py-2 font-medium text-gray-700 w-48">Pełny numer rachunku</td>
                            <td className="px-3 py-2 font-mono text-gray-900">{formatBankAccount(bankAccount)}</td>
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
                            <td className="px-3 py-2 font-mono text-gray-900">{formatBankAccount(vatBankAccount)}</td>
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

            {/* Footer */}
            {isIssued && myCompany?.invoice_footer_text && (
              <div className="mb-4 rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 whitespace-pre-wrap">
                {myCompany.invoice_footer_text}
              </div>
            )}

            {isIssued && (myCompany?.signature_name || myCompany?.signature_title) && (
              <div className="flex justify-end">
                <div className="w-56 border-t border-gray-300 pt-2 text-center">
                  {myCompany?.signature_name && <div className="text-sm font-medium text-gray-900">{myCompany.signature_name}</div>}
                  {myCompany?.signature_title && <div className="text-xs text-gray-600">{myCompany.signature_title}</div>}
                </div>
              </div>
            )}

            <div className="mt-6 border-t border-gray-200 pt-4">
              <div className="text-xs text-gray-400">
                Faktura zsynchronizowana z Krajowym Systemem e-Faktur (KSeF)
                {inv.synced_at && <span> | Synchronizacja: {new Date(inv.synced_at).toLocaleString('pl-PL')}</span>}
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
