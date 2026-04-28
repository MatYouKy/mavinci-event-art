'use client';

import { useEffect, useState } from 'react';
import { X, FileText, Loader } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

type TargetInvoiceType = 'vat' | 'advance';
type NumberingMode = 'auto' | 'manual';

interface ConvertProformaModalProps {
  proformaId: string;
  proformaNumber: string;
  onClose: () => void;
  onConverted: (newInvoiceId: string) => void;
}

export default function ConvertProformaModal({
  proformaId,
  proformaNumber,
  onClose,
  onConverted,
}: ConvertProformaModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [autoPreview, setAutoPreview] = useState<string>('');

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPreviewLoading(true);
      try {
        const { data } = await supabase
          .from('invoice_settings')
          .select('current_year, last_invoice_number')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (cancelled || !data) return;
        const year = new Date().getFullYear();
        const useYear = data.current_year === year ? data.current_year : year;
        const nextNumber = data.current_year === year ? data.last_invoice_number + 1 : 1;
        const prefix = form.targetType === 'advance' ? 'ZAL/' : '';
        setAutoPreview(`${prefix}${nextNumber}/${useYear}`);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.targetType]);

  const handleSubmit = async () => {
    if (form.numberingMode === 'manual' && !form.customNumber.trim()) {
      showSnackbar('Podaj numer faktury', 'error');
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
        paymentDueDate: form.paymentDueDate,
      });
      if (!result.success || !result.invoiceId) {
        throw new Error(result.error || 'Blad konwersji');
      }
      showSnackbar('Faktura zostala utworzona', 'success');
      onConverted(result.invoiceId);
    } catch (err: any) {
      console.error(err);
      showSnackbar(err.message || 'Blad podczas konwersji proformy', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-[#d3bb73]" />
            <h2 className="text-xl font-light text-[#e5e4e2]">
              Wystaw fakture na podstawie proformy
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

        <div className="space-y-5 p-6">
          <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4">
            <div className="text-xs uppercase tracking-wider text-[#e5e4e2]/40">
              Proforma zrodlowa
            </div>
            <div className="mt-1 text-base font-medium text-[#e5e4e2]">
              {proformaNumber}
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
                  className={`text-sm font-medium ${
                    form.numberingMode === 'auto' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'
                  }`}
                >
                  Automatyczny
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
                <div className="mt-1 text-xs text-[#e5e4e2]/50">
                  Wpisz numer recznie
                </div>
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
                disabled={loading}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data sprzedazy</label>
              <input
                type="date"
                value={form.saleDate}
                onChange={(e) => setForm({ ...form, saleDate: e.target.value })}
                disabled={loading}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Termin platnosci</label>
              <input
                type="date"
                value={form.paymentDueDate}
                onChange={(e) => setForm({ ...form, paymentDueDate: e.target.value })}
                disabled={loading}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 p-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg px-6 py-2.5 text-[#e5e4e2]/80 transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
          >
            Anuluj
          </button>
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
                <FileText className="h-4 w-4" />
                Wystaw fakture
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
