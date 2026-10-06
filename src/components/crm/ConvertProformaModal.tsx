'use client';

import { useEffect, useRef, useState } from 'react';
import { X, FileText, Loader, RefreshCw, ArrowLeft, Check, CalendarDays } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { getRecordedProformaPaymentDate, parseProformaPaymentDate } from '@/lib/invoices/convertProformaToInvoice';
import { DEFAULT_INVOICE_PAYMENT_TERM_DAYS, getInvoicePaymentDueDate } from '@/lib/invoices/paymentTerm';

type TargetInvoiceType = 'vat' | 'advance';
type NumberingMode = 'auto' | 'manual';
type Step = 'config' | 'preview';

interface ConvertProformaModalProps {
  proformaId: string;
  proformaNumber: string;
  onClose: () => void;
  onConverted: (newInvoiceId: string) => void;
}

interface ProformaData {
  id: string;
  event_id: string | null;
  invoice_number: string;
  my_company_id: string | null;
  buyer_name: string;
  buyer_nip: string | null;
  buyer_email: string | null;
  buyer_street: string | null;
  buyer_postal_code: string | null;
  buyer_city: string | null;
  seller_name: string | null;
  seller_nip: string | null;
  total_net: number;
  total_vat: number;
  total_gross: number;
  payment_method: string | null;
  bank_account: string | null;
  notes: string | null;
  currency_code: string | null;
  paid_date: string | null;
  paid_at: string | null;
  manual_paid_amount: number | null;
  invoice_items?: Array<{
    name: string;
    unit: string;
    quantity: number;
    price_net: number;
    vat_rate: number;
    value_gross: number;
  }>;
}

export default function ConvertProformaModal({
  proformaId,
  proformaNumber,
  onClose,
  onConverted,
}: ConvertProformaModalProps) {
  const { showSnackbar } = useSnackbar();
  const [step, setStep] = useState<Step>('config');
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [autoPreview, setAutoPreview] = useState<string>('');
  const [proforma, setProforma] = useState<ProformaData | null>(null);
  const [loadingProforma, setLoadingProforma] = useState(true);
  const paymentDatePicker = useRef<HTMLInputElement>(null);

  const today = new Date().toISOString().split('T')[0];

  const [form, setForm] = useState({
    targetType: 'vat' as TargetInvoiceType,
    numberingMode: 'auto' as NumberingMode,
    customNumber: '',
    issueDate: today,
    saleDate: today,
    paymentTermDays: String(DEFAULT_INVOICE_PAYMENT_TERM_DAYS),
    receivedPaymentConfirmed: false,
    receivedPaymentDate: '',
  });
  const paymentDueDate = getInvoicePaymentDueDate(form.issueDate, form.paymentTermDays);
  const invalidPaymentTerm = form.targetType !== 'advance' && !paymentDueDate;
  const paymentDueDateDisplay = paymentDueDate?.split('-').reverse().join('.') || '';

  const [editableBuyer, setEditableBuyer] = useState({
    buyer_name: '',
    buyer_nip: '',
    buyer_email: '',
    buyer_street: '',
    buyer_postal_code: '',
    buyer_city: '',
  });

  useEffect(() => {
    (async () => {
      setLoadingProforma(true);
      const { data } = await supabase
        .from('invoices')
        .select('*, invoice_items(*)')
        .eq('id', proformaId)
        .maybeSingle();
      if (data) {
        setProforma(data as ProformaData);
        setForm((current) => ({
          ...current,
          receivedPaymentConfirmed: false,
          receivedPaymentDate: data.paid_date || data.paid_at?.split('T')[0] || '',
        }));
        setEditableBuyer({
          buyer_name: data.buyer_name || '',
          buyer_nip: data.buyer_nip || '',
          buyer_email: data.buyer_email || '',
          buyer_street: data.buyer_street || '',
          buyer_postal_code: data.buyer_postal_code || '',
          buyer_city: data.buyer_city || '',
        });
      }
      setLoadingProforma(false);
    })();
  }, [proformaId]);

  const fetchNextNumber = async () => {
    if (!proforma?.my_company_id) return;
  
    setPreviewLoading(true);
  
    try {
      const { data, error } = await supabase
        .from('my_companies')
        .select(`
          invoice_prefix,
          last_invoice_number,
          last_advance_number,
          invoice_numbering_year
        `)
        .eq('id', proforma.my_company_id)
        .maybeSingle();
  
      if (error || !data) {
        console.error('[NUMBERING ERROR]', error);
        showSnackbar('Nie udalo sie odczytac numeracji', 'error');
        return;
      }
  
      const year = new Date().getFullYear();
      const numberingYear = data.invoice_numbering_year === year ? data.invoice_numbering_year : year;
  
      const lastNumber =
        form.targetType === 'advance'
          ? data.last_advance_number || 0
          : data.last_invoice_number || 0;
  
      const nextNumber = data.invoice_numbering_year === year ? lastNumber + 1 : 1;
  
      const parts: string[] = [];
  
      if (form.targetType === 'advance') parts.push('ZAL');
      if (data.invoice_prefix) parts.push(data.invoice_prefix);
  
      parts.push(String(nextNumber));
      parts.push(String(numberingYear));
  
      setAutoPreview(parts.join('/'));
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (proforma) fetchNextNumber();
  }, [form.targetType, proforma]);

  const goToPreview = () => {
    if (invalidPaymentTerm) {
      showSnackbar('Podaj termin płatności jako liczbę całkowitą dni od 0 oraz poprawną datę wystawienia.', 'error');
      return;
    }
    if (form.numberingMode === 'manual' && !form.customNumber.trim()) {
      showSnackbar('Podaj numer faktury', 'error');
      return;
    }
    if (form.targetType === 'advance') {
      const savedPaymentDate = proforma && getRecordedProformaPaymentDate(proforma, form.issueDate, today);
      const paymentDate = savedPaymentDate || parseProformaPaymentDate(form.receivedPaymentDate);
      if ((!savedPaymentDate && !form.receivedPaymentConfirmed) || !paymentDate) {
        showSnackbar('Potwierdź otrzymanie całej kwoty pro formy i podaj rzeczywistą datę wpłaty.', 'error');
        return;
      }
      if (paymentDate > today || paymentDate > form.issueDate) {
        showSnackbar('Data wpłaty nie może być w przyszłości ani po dacie wystawienia zaliczki.', 'error');
        return;
      }
    }
    setStep('preview');
  };

  const handleSubmit = async () => {
    if (!proforma) return;
    if (invalidPaymentTerm) {
      showSnackbar('Podaj termin płatności jako liczbę całkowitą dni od 0 oraz poprawną datę wystawienia.', 'error');
      return;
    }
    setLoading(true);
    try {
      const { convertProformaToInvoice } = await import('@/lib/invoices/convertProformaToInvoice');
      const result = await convertProformaToInvoice(proformaId, {
        targetType: form.targetType,
        customNumber:
          form.numberingMode === 'manual' ? form.customNumber.trim() : undefined,
        issueDate: form.issueDate,
        saleDate: form.saleDate,
        paymentDueDate: form.targetType === 'advance' ? undefined : paymentDueDate || undefined,
        receivedPaymentConfirmed: form.receivedPaymentConfirmed,
        receivedPaymentDate: form.receivedPaymentDate,
        buyerData: {
          buyer_name: editableBuyer.buyer_name,
          buyer_nip: editableBuyer.buyer_nip || null,
          buyer_email: editableBuyer.buyer_email || null,
          buyer_street: editableBuyer.buyer_street,
          buyer_postal_code: editableBuyer.buyer_postal_code,
          buyer_city: editableBuyer.buyer_city,
        },
      });
      if (!result.success || !result.invoiceId) {
        throw new Error(result.error || 'Blad konwersji');
      }

      showSnackbar(
        form.targetType === 'advance'
          ? 'Wystawiono opłaconą fakturę zaliczkową na całą kwotę pro formy'
          : 'Faktura została utworzona (szkic)',
        'success',
      );
      onConverted(result.invoiceId);
    } catch (err: any) {
      console.error(err);
      showSnackbar(err.message || 'Blad podczas konwersji proformy', 'error');
    } finally {
      setLoading(false);
    }
  };

  const targetNumber =
    form.numberingMode === 'manual' ? form.customNumber.trim() : autoPreview || '—';
  const currency = proforma?.currency_code || 'PLN';
  const recordedPaymentDate = proforma && getRecordedProformaPaymentDate(proforma, form.issueDate, today);
  const paymentDateValue = recordedPaymentDate || form.receivedPaymentDate;
  const receivedPaymentDate = parseProformaPaymentDate(paymentDateValue);
  const paymentDateDisplay = /^\d{4}-\d{2}-\d{2}$/.test(paymentDateValue)
    ? paymentDateValue.split('-').reverse().join('.')
    : paymentDateValue;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-[#d3bb73]" />
            <h2 className="text-xl font-light text-[#e5e4e2]">
              {step === 'config'
                ? 'Wystaw fakture na podstawie proformy'
                : 'Podglad faktury przed wystawieniem'}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loadingProforma ? (
          <div className="p-12 text-center text-[#e5e4e2]/60">Ladowanie danych proformy...</div>
        ) : !proforma ? (
          <div className="p-12 text-center text-red-400">Nie znaleziono proformy</div>
        ) : step === 'config' ? (
          <div className="space-y-5 p-6">
            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4">
              <div className="text-xs uppercase tracking-wider text-[#e5e4e2]/40">
                Proforma zrodlowa
              </div>
              <div className="mt-1 text-base font-medium text-[#e5e4e2]">{proformaNumber}</div>
              <div className="mt-3 space-y-2 text-sm text-[#e5e4e2]/70">
                <p><span className="text-[#e5e4e2]">Podstawa pozycji i kwoty:</span> ta pro forma. Zachowamy wpisane na niej nazwy i układ pozycji — bez zastępowania ich szczegółami kalkulacji lub oferty.</p>
                {proforma.invoice_items?.length === 1 && (
                  <p className="rounded-lg bg-[#d3bb73]/5 p-3">
                    Pozycja na nowej fakturze: <span className="font-medium text-[#e5e4e2]">{proforma.invoice_items[0].name}</span>
                  </p>
                )}
                {form.targetType === 'advance' && (
                  <p className="text-xs text-[#e5e4e2]/55">Faktura końcowa odziedziczy nazwy i układ tej zaliczki. Pełną wartość rozliczenia pobierze osobno z zamówienia, w pierwszej kolejności z powiązanego wydarzenia; nie będzie to ponowne naliczenie samej kwoty zaliczki.</p>
                )}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Typ docelowy</label>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    { value: 'vat', label: 'Faktura VAT', desc: 'Pelnoprawna faktura sprzedazowa' },
                    {
                      value: 'advance',
                      label: 'Faktura zaliczkowa',
                      desc: 'Cała opłacona pro forma, bez ponownego procentowania',
                    },
                  ] as Array<{ value: TargetInvoiceType; label: string; desc: string }>
                ).map((opt) => {
                  const active = form.targetType === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm({ ...form, targetType: opt.value })}
                      className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                        active
                          ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                          : 'border-[#d3bb73]/20 bg-[#0a0d1a] hover:border-[#d3bb73]/50'
                      }`}
                    >
                      <div
                        className={`text-sm font-medium ${
                          active ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'
                        }`}
                      >
                        {opt.label}
                      </div>
                      <div className="mt-1 text-xs text-[#e5e4e2]/50">{opt.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {form.targetType === 'advance' && (
              <div className="space-y-4 rounded-lg bg-[#d3bb73]/10 p-4">
                <div>
                  <p className="font-medium text-[#d3bb73]">
                    Kwota zaliczki: {Number(proforma.total_gross).toFixed(2)} {currency}
                  </p>
                  <p className="mt-2 text-sm text-[#e5e4e2]/70">
                    To 100% tej pro formy — nie przeliczamy jej ponownie procentem.
                    Zaliczka potwierdzi otrzymaną wpłatę, a do zapłaty pozostanie 0,00 {currency}.
                    Faktura końcowa obejmie pełne zamówienie pomniejszone o rozliczone zaliczki.
                  </p>
                </div>
                {recordedPaymentDate ? (
                  <p className="text-sm text-[#d3bb73]">Zachowamy wpłatę potwierdzoną przy pro formie oraz jej datę.</p>
                ) : <label className="flex items-start gap-3 text-sm text-[#e5e4e2]">
                  <input
                    type="checkbox"
                    checked={form.receivedPaymentConfirmed}
                    onChange={(e) => setForm({ ...form, receivedPaymentConfirmed: e.target.checked })}
                    className="mt-0.5 accent-[#d3bb73]"
                  />
                  Potwierdzam otrzymanie całej kwoty tej pro formy. Nie jest to potwierdzenie nowej, dodatkowej wpłaty.
                </label>}
                <div className="max-w-xs">
                  <label htmlFor="proforma-received-payment-date" className="mb-2 block text-sm text-[#e5e4e2]/70">
                    Rzeczywista data otrzymania wpłaty *
                  </label>
                  <div className="flex items-center rounded-lg border border-white/10 bg-[#0a0d1a] focus-within:bg-[#d3bb73]/5">
                    <input
                      id="proforma-received-payment-date"
                      type="text"
                      inputMode="numeric"
                      placeholder="DD.MM.RRRR"
                      value={paymentDateDisplay}
                      readOnly={Boolean(recordedPaymentDate)}
                      onChange={(e) => setForm({ ...form, receivedPaymentDate: e.target.value })}
                      className="min-w-0 flex-1 rounded-lg border-0 bg-transparent px-3 py-2 text-[#e5e4e2] outline-none"
                    />
                    <div className="relative">
                      <button
                        type="button"
                        aria-label="Wybierz datę otrzymania wpłaty z kalendarza"
                        disabled={Boolean(recordedPaymentDate)}
                        onClick={() => {
                          const picker = paymentDatePicker.current;
                          if (picker?.showPicker) picker.showPicker();
                          else picker?.focus();
                        }}
                        className="rounded-lg p-3 text-[#d3bb73] hover:bg-white/5"
                      >
                        <CalendarDays className="h-4 w-4" />
                      </button>
                      <input
                        ref={paymentDatePicker}
                        type="date"
                        aria-label="Kalendarz daty otrzymania wpłaty"
                        tabIndex={-1}
                        disabled={Boolean(recordedPaymentDate)}
                        value={receivedPaymentDate || ''}
                        max={form.issueDate < today ? form.issueDate : today}
                        onChange={(e) => setForm({ ...form, receivedPaymentDate: e.target.value })}
                        className="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Numer faktury</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, numberingMode: 'auto' })}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                    form.numberingMode === 'auto'
                      ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                      : 'border-[#d3bb73]/20 bg-[#0a0d1a] hover:border-[#d3bb73]/50'
                  }`}
                >
                  <div
                    className={`flex items-center justify-between text-sm font-medium ${
                      form.numberingMode === 'auto' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'
                    }`}
                  >
                    <span>Automatyczny</span>
                    {form.numberingMode === 'auto' && (
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          fetchNextNumber();
                        }}
                        className="cursor-pointer rounded p-1 hover:bg-[#d3bb73]/20"
                        title="Pobierz nastepny wolny numer"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${previewLoading ? 'animate-spin' : ''}`}
                        />
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-[#e5e4e2]/50">
                    {previewLoading ? 'Ladowanie...' : `Nastepny: ${autoPreview || '—'}`}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, numberingMode: 'manual' })}
                  className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                    form.numberingMode === 'manual'
                      ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                      : 'border-[#d3bb73]/20 bg-[#0a0d1a] hover:border-[#d3bb73]/50'
                  }`}
                >
                  <div
                    className={`text-sm font-medium ${
                      form.numberingMode === 'manual' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'
                    }`}
                  >
                    Wlasny numer
                  </div>
                  <div className="mt-1 text-xs text-[#e5e4e2]/50">Wpisz numer recznie</div>
                </button>
              </div>
              {form.numberingMode === 'manual' && (
                <input
                  type="text"
                  value={form.customNumber}
                  onChange={(e) => setForm({ ...form, customNumber: e.target.value })}
                  disabled={loading}
                  placeholder="np. FV/123/2026"
                  className="mt-3 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
                />
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data wystawienia</label>
                <input
                  type="date"
                  value={form.issueDate}
                  onChange={(e) => setForm({ ...form, issueDate: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data sprzedazy</label>
                <input
                  type="date"
                  value={form.saleDate}
                  onChange={(e) => setForm({ ...form, saleDate: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              {form.targetType !== 'advance' && <div>
                <label htmlFor="proforma-payment-term-days" className="mb-2 block text-sm text-[#e5e4e2]/60">Termin płatności (dni)</label>
                <input
                  id="proforma-payment-term-days"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={form.paymentTermDays}
                  onChange={(e) => setForm({ ...form, paymentTermDays: e.target.value })}
                  aria-invalid={invalidPaymentTerm}
                  aria-describedby="proforma-payment-term-help"
                  className="w-full rounded-lg border border-white/10 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:bg-[#d3bb73]/5 focus:outline-none"
                />
                <p id="proforma-payment-term-help" className={`mt-2 text-xs ${invalidPaymentTerm ? 'text-red-400' : 'text-[#e5e4e2]/60'}`}>
                  {invalidPaymentTerm
                    ? 'Podaj pełną liczbę dni od 0 oraz poprawną datę wystawienia.'
                    : `Od daty wystawienia · termin: ${paymentDueDateDisplay}${Number(form.paymentTermDays) === 0 ? ' (płatność w dniu wystawienia)' : ''}`}
                </p>
              </div>}
            </div>

            <div>
              <div className="mb-2 text-sm text-[#e5e4e2]/60">Dane nabywcy (mozesz poprawic)</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <input
                  value={editableBuyer.buyer_name}
                  onChange={(e) =>
                    setEditableBuyer({ ...editableBuyer, buyer_name: e.target.value })
                  }
                  placeholder="Nazwa"
                  className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
                <input
                  value={editableBuyer.buyer_nip}
                  onChange={(e) =>
                    setEditableBuyer({ ...editableBuyer, buyer_nip: e.target.value })
                  }
                  placeholder="NIP"
                  className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
                <input
                  value={editableBuyer.buyer_street}
                  onChange={(e) =>
                    setEditableBuyer({ ...editableBuyer, buyer_street: e.target.value })
                  }
                  placeholder="Ulica"
                  className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    value={editableBuyer.buyer_postal_code}
                    onChange={(e) =>
                      setEditableBuyer({ ...editableBuyer, buyer_postal_code: e.target.value })
                    }
                    placeholder="Kod"
                    className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                  <input
                    value={editableBuyer.buyer_city}
                    onChange={(e) =>
                      setEditableBuyer({ ...editableBuyer, buyer_city: e.target.value })
                    }
                    placeholder="Miasto"
                    className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>
                <input
                  value={editableBuyer.buyer_email}
                  onChange={(e) =>
                    setEditableBuyer({ ...editableBuyer, buyer_email: e.target.value })
                  }
                  placeholder="Email"
                  className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none md:col-span-2"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-5 p-6">
            <div className="rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/5 p-4">
              <div className="text-xs uppercase tracking-wider text-[#d3bb73]">Podsumowanie</div>
              <div className="mt-2 grid grid-cols-2 gap-y-2 text-sm md:grid-cols-3">
                <div>
                  <span className="text-[#e5e4e2]/50">Numer:</span>{' '}
                  <span className="font-medium text-[#e5e4e2]">{targetNumber}</span>
                </div>
                <div>
                  <span className="text-[#e5e4e2]/50">Typ:</span>{' '}
                  <span className="font-medium text-[#e5e4e2]">
                    {form.targetType === 'advance' ? 'Zaliczkowa' : 'VAT'}
                  </span>
                </div>
                <div>
                  <span className="text-[#e5e4e2]/50">Status:</span>{' '}
                  <span className="font-medium text-[#e5e4e2]">
                    {form.targetType === 'advance' ? 'Opłacona' : 'Szkic'}
                  </span>
                </div>
                {form.targetType === 'advance' && (
                  <div>
                    <span className="text-[#e5e4e2]/50">Zaliczka:</span>{' '}
                    <span className="font-medium text-[#e5e4e2]">
                      Cała kwota pro formy
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-[#e5e4e2]/50">Wystawienia:</span>{' '}
                  <span className="text-[#e5e4e2]">{form.issueDate}</span>
                </div>
                <div>
                  <span className="text-[#e5e4e2]/50">Sprzedazy:</span>{' '}
                  <span className="text-[#e5e4e2]">{form.saleDate}</span>
                </div>
                <div>
                  <span className="text-[#e5e4e2]/50">
                    {form.targetType === 'advance' ? 'Wpłata otrzymana:' : 'Termin:'}
                  </span>{' '}
                  <span className="text-[#e5e4e2]">
                    {form.targetType === 'advance' ? paymentDateDisplay : `${paymentDueDateDisplay} (${Number(form.paymentTermDays)} dni od wystawienia)`}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4">
                <div className="mb-2 text-xs uppercase tracking-wider text-[#e5e4e2]/40">
                  Sprzedawca
                </div>
                <div className="text-sm text-[#e5e4e2]">{proforma.seller_name || '—'}</div>
                <div className="text-xs text-[#e5e4e2]/60">NIP {proforma.seller_nip || '—'}</div>
              </div>
              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4">
                <div className="mb-2 text-xs uppercase tracking-wider text-[#e5e4e2]/40">
                  Nabywca
                </div>
                <div className="text-sm text-[#e5e4e2]">{editableBuyer.buyer_name || '—'}</div>
                {editableBuyer.buyer_nip && (
                  <div className="text-xs text-[#e5e4e2]/60">NIP {editableBuyer.buyer_nip}</div>
                )}
                {editableBuyer.buyer_street && (
                  <div className="text-xs text-[#e5e4e2]/60">
                    {editableBuyer.buyer_street}, {editableBuyer.buyer_postal_code}{' '}
                    {editableBuyer.buyer_city}
                  </div>
                )}
                {editableBuyer.buyer_email && (
                  <div className="text-xs text-[#e5e4e2]/60">{editableBuyer.buyer_email}</div>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a]">
              <div className="border-b border-[#d3bb73]/10 px-4 py-2 text-xs uppercase tracking-wider text-[#e5e4e2]/40">
                Pozycje na fakturze — odziedziczone z pro formy
              </div>
              <table className="w-full text-sm">
                <thead className="bg-[#1c1f33] text-xs uppercase text-[#e5e4e2]/50">
                  <tr>
                    <th className="px-3 py-2 text-left">Nazwa</th>
                    <th className="w-16 px-2 py-2 text-left">Jm.</th>
                    <th className="w-20 px-2 py-2 text-right">Ilosc</th>
                    <th className="w-24 px-2 py-2 text-right">Cena netto</th>
                    <th className="w-16 px-2 py-2 text-right">VAT</th>
                    <th className="w-24 px-2 py-2 text-right">Brutto</th>
                  </tr>
                </thead>
                <tbody>
                  {(proforma.invoice_items ?? []).map((it, idx) => (
                    <tr key={idx} className="border-t border-[#d3bb73]/5 text-[#e5e4e2]">
                      <td className="px-3 py-2">{it.name}</td>
                      <td className="px-2 py-2 text-[#e5e4e2]/70">{it.unit}</td>
                      <td className="px-2 py-2 text-right">{Number(it.quantity)}</td>
                      <td className="px-2 py-2 text-right">
                        {Number(it.price_net).toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-right">{it.vat_rate}%</td>
                      <td className="px-2 py-2 text-right font-medium">
                        {Number(it.value_gross).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="grid grid-cols-3 gap-4 border-t border-[#d3bb73]/10 px-4 py-3 text-sm">
                <div>
                  <span className="text-[#e5e4e2]/50">Netto:</span>{' '}
                  <span className="text-[#e5e4e2]">
                    {Number(proforma.total_net).toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-[#e5e4e2]/50">VAT:</span>{' '}
                  <span className="text-[#e5e4e2]">
                    {Number(proforma.total_vat).toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-[#e5e4e2]/50">Brutto:</span>{' '}
                  <span className="font-medium text-[#d3bb73]">
                    {Number(proforma.total_gross).toFixed(2)} {currency}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-[#d3bb73]/10 p-3 text-sm text-[#e5e4e2]/80">
              {form.targetType === 'advance'
                ? `Otrzymano ${Number(proforma.total_gross).toFixed(2)} ${currency}. Do zapłaty: 0,00 ${currency}. Powstanie wystawiona, opłacona zaliczka, bez automatycznej wysyłki do KSeF. Sprawdź dane przed zatwierdzeniem.`
                : 'Faktura zostanie utworzona jako szkic. Dane i pozycje można poprawić przed wystawieniem i wysłaniem do KSeF.'}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-[#d3bb73]/20 p-6">
          {step === 'preview' ? (
            <button
              onClick={() => setStep('config')}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[#e5e4e2]/80 transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
            >
              <ArrowLeft className="h-4 w-4" />
              Wroc do edycji
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="rounded-lg px-6 py-2.5 text-[#e5e4e2]/80 transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
            >
              Anuluj
            </button>
            {step === 'config' ? (
              <button
                onClick={goToPreview}
                disabled={loadingProforma || invalidPaymentTerm}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                Dalej: podglad
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading || invalidPaymentTerm}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader className="h-4 w-4 animate-spin" />
                    Tworzenie...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Wystaw fakture
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
