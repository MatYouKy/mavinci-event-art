'use client';

import { useEffect, useState } from 'react';
import { X, FileText, Loader, RefreshCw, ArrowLeft, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

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

  const today = new Date().toISOString().split('T')[0];
  const due = new Date();
  due.setDate(due.getDate() + 14);

  const [form, setForm] = useState({
    targetType: 'vat' as TargetInvoiceType,
    numberingMode: 'auto' as NumberingMode,
    customNumber: '',
    issueDate: today,
    saleDate: today,
    paymentDueDate: due.toISOString().split('T')[0],
  });

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
    if (!proforma) return;
    setPreviewLoading(true);
    try {
      const { data, error } = await supabase
        .from('invoice_settings')
        .select('current_year, last_invoice_number')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error || !data) {
        showSnackbar('Nie udalo sie odczytac numeracji', 'error');
        return;
      }
      const year = new Date().getFullYear();
      const useYear = data.current_year === year ? data.current_year : year;
      const nextNumber = data.current_year === year ? data.last_invoice_number + 1 : 1;
      const prefix = form.targetType === 'advance' ? 'ZAL/' : '';
      setAutoPreview(`${prefix}${nextNumber}/${useYear}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (proforma) fetchNextNumber();
  }, [form.targetType, proforma]);

  const goToPreview = () => {
    if (form.numberingMode === 'manual' && !form.customNumber.trim()) {
      showSnackbar('Podaj numer faktury', 'error');
      return;
    }
    setStep('preview');
  };

  const handleSubmit = async () => {
    if (!proforma) return;
    setLoading(true);
    try {
      const { convertProformaToInvoice } = await import('@/lib/invoices/convertProformaToInvoice');
      const result = await convertProformaToInvoice(proformaId, {
        targetType: form.targetType,
        customNumber:
          form.numberingMode === 'manual' ? form.customNumber.trim() : undefined,
        issueDate: form.issueDate,
        saleDate: form.saleDate,
        paymentDueDate: form.paymentDueDate,
      });
      if (!result.success || !result.invoiceId) {
        throw new Error(result.error || 'Blad konwersji');
      }

      const buyerChanged =
        editableBuyer.buyer_name !== (proforma.buyer_name || '') ||
        editableBuyer.buyer_nip !== (proforma.buyer_nip || '') ||
        editableBuyer.buyer_email !== (proforma.buyer_email || '') ||
        editableBuyer.buyer_street !== (proforma.buyer_street || '') ||
        editableBuyer.buyer_postal_code !== (proforma.buyer_postal_code || '') ||
        editableBuyer.buyer_city !== (proforma.buyer_city || '');

      if (buyerChanged) {
        await supabase
          .from('invoices')
          .update({
            buyer_name: editableBuyer.buyer_name || null,
            buyer_nip: editableBuyer.buyer_nip || null,
            buyer_email: editableBuyer.buyer_email || null,
            buyer_street: editableBuyer.buyer_street || null,
            buyer_postal_code: editableBuyer.buyer_postal_code || null,
            buyer_city: editableBuyer.buyer_city || null,
          })
          .eq('id', result.invoiceId);
      }

      showSnackbar('Faktura zostala utworzona (szkic)', 'success');
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
                      desc: 'Zaliczka, koncowa wystawiona pozniej',
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
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Termin platnosci</label>
                <input
                  type="date"
                  value={form.paymentDueDate}
                  onChange={(e) => setForm({ ...form, paymentDueDate: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
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
                  <span className="font-medium text-[#e5e4e2]">Szkic</span>
                </div>
                <div>
                  <span className="text-[#e5e4e2]/50">Wystawienia:</span>{' '}
                  <span className="text-[#e5e4e2]">{form.issueDate}</span>
                </div>
                <div>
                  <span className="text-[#e5e4e2]/50">Sprzedazy:</span>{' '}
                  <span className="text-[#e5e4e2]">{form.saleDate}</span>
                </div>
                <div>
                  <span className="text-[#e5e4e2]/50">Termin:</span>{' '}
                  <span className="text-[#e5e4e2]">{form.paymentDueDate}</span>
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
                Pozycje (kopiowane z proformy)
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
                      <td className="px-2 py-2 text-right">{Number(it.price_net).toFixed(2)}</td>
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
                  <span className="text-[#e5e4e2]">{Number(proforma.total_net).toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[#e5e4e2]/50">VAT:</span>{' '}
                  <span className="text-[#e5e4e2]">{Number(proforma.total_vat).toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[#e5e4e2]/50">Brutto:</span>{' '}
                  <span className="font-medium text-[#d3bb73]">
                    {Number(proforma.total_gross).toFixed(2)} PLN
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-[#e5e4e2]/70">
              Faktura zostanie utworzona jako szkic. Po wystawieniu mozesz dalej edytowac pozycje
              i dane przed wyslaniem do KSeF.
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
                disabled={loadingProforma}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                Dalej: podglad
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading}
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
