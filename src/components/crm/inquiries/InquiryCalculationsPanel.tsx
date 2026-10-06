'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, FileText, Loader2, Pencil, Plus } from 'lucide-react';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';
import {
  duplicateCalculation,
  generateSavedInquiryCalculationPdf,
  type InquiryCalculationContext,
} from '@/lib/CRM/calculations/calculationActions';

type Calculation = {
  id: string;
  name: string;
  generated_pdf_path: string | null;
  event_calculation_items?: Array<{ quantity: number; unit_price: number; days: number }>;
};
export default function InquiryCalculationsPanel({
  calculations,
  context,
  canManage,
  selectedId,
  creating,
  onCreate,
  onEdit,
  onChanged,
}: {
  calculations: Calculation[];
  context: InquiryCalculationContext;
  canManage: boolean;
  selectedId: string | null;
  creating: boolean;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onChanged: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [rows, setRows] = useState(calculations);
  const [busy, setBusy] = useState<{ id: string; action: 'duplicate' | 'pdf' | 'view' | 'select' } | null>(
    null,
  );
  const busyRef = useRef(false);
  useEffect(() => setRows(calculations), [calculations]);

  async function perform(calculation: Calculation, action: 'duplicate' | 'pdf' | 'view' | 'select') {
    if (busyRef.current || (action !== 'view' && !canManage)) return;
    busyRef.current = true;
    setBusy({ id: calculation.id, action });
    const preview = action === 'view' ? window.open('about:blank', '_blank') : null;
    if (preview) preview.opener = null;
    try {
      if (action === 'select') {
        const { error } = await supabase.rpc('select_inquiry_calculation', { p_calculation: calculation.id, p_expected_selected: selectedId });
        if (error) throw error;
        showSnackbar('Wybrano kalkulację. Wyceny zapisanych ofert pozostają zachowane.', 'success'); onChanged();
      } else if (action === 'duplicate') {
        const result = await duplicateCalculation(calculation.id, { inquiryId: context.inquiryId });
        setRows((previous) => [
          {
            ...result.calculation,
            generated_pdf_path: null,
            event_calculation_items: result.items,
          },
          ...previous,
        ]);
        showSnackbar('Kalkulacja została zduplikowana.', 'success');
        onChanged();
      } else if (action === 'pdf') {
        const result = await generateSavedInquiryCalculationPdf(calculation.id, context);
        setRows((previous) =>
          previous.map((row) =>
            row.id === calculation.id ? { ...row, generated_pdf_path: result.storagePath } : row,
          ),
        );
        showSnackbar('PDF kalkulacji został wygenerowany.', 'success');
        onChanged();
      } else {
        if (!preview)
          throw new Error('Przeglądarka zablokowała nowe okno. Zezwól na otwieranie podglądu.');
        if (!calculation.generated_pdf_path) throw new Error('Najpierw wygeneruj PDF.');
        const { data, error } = await supabase.storage
          .from('event-files')
          .createSignedUrl(calculation.generated_pdf_path, 300);
        if (error || !data?.signedUrl) throw error || new Error('Nie udało się otworzyć PDF.');
        preview.location.href = data.signedUrl;
      }
    } catch (error: any) {
      preview?.close();
      showSnackbar(error.message || 'Nie udało się wykonać operacji.', 'error');
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-white/10 bg-[#1c1f33] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-light text-[#e5e4e2]">Kalkulacje</h2>
        {canManage && (
          <button
            type="button"
            onClick={onCreate}
            disabled={Boolean(busy) || creating}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33] disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Utwórz kalkulację
          </button>
        )}
      </div>
      {!rows.length && (
        <p className="py-6 text-center text-sm text-[#e5e4e2]/50">
          Nie przygotowano jeszcze kalkulacji.
        </p>
      )}
      {rows.map((calculation) => {
        const total = (calculation.event_calculation_items || []).reduce(
          (sum, item) =>
            sum +
            Number(item.quantity || 0) * Number(item.unit_price || 0) * Number(item.days || 1),
          0,
        );
        const running = busy?.id === calculation.id;
        return (
          <article
            key={calculation.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#0f1119] p-4"
          >
            <button
              type="button"
              onClick={() => onEdit(calculation.id)}
              disabled={Boolean(busy)}
              className="min-w-0 flex-1 text-left disabled:opacity-60"
            >
              <p className="text-sm font-medium text-[#e5e4e2]">{calculation.name}{selectedId === calculation.id && <span className="ml-2 text-xs text-green-300">Wybrana kalkulacja</span>}</p>
              <p className="mt-1 text-xs text-[#e5e4e2]/50">
                {calculation.event_calculation_items?.length || 0} pozycji ·{' '}
                {total.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })} netto ·{' '}
                {calculation.generated_pdf_path ? 'PDF gotowy' : 'Robocza'}
              </p>
            </button>
            <ResponsiveActionBar
              disabledBackground
              actions={[
                { label: 'Wybierz kalkulację', onClick: () => void perform(calculation, 'select'), disabled: Boolean(busy) || selectedId === calculation.id, show: canManage },
                {
                  label: 'Otwórz',
                  icon: <Pencil className="h-4 w-4" />,
                  onClick: () => onEdit(calculation.id),
                  disabled: Boolean(busy),
                },
                {
                  label: running && busy.action === 'duplicate' ? 'Duplikuję…' : 'Duplikuj',
                  icon:
                    running && busy.action === 'duplicate' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    ),
                  onClick: () => void perform(calculation, 'duplicate'),
                  disabled: Boolean(busy),
                  show: canManage,
                },
                {
                  label: running && busy.action === 'pdf' ? 'Generuję PDF…' : 'Generuj PDF',
                  icon: <FileText className="h-4 w-4" />,
                  onClick: () => void perform(calculation, 'pdf'),
                  disabled: Boolean(busy),
                  show: canManage,
                },
                {
                  label: running && busy.action === 'view' ? 'Otwieram PDF…' : 'Pokaż PDF',
                  icon: <FileText className="h-4 w-4" />,
                  onClick: () => void perform(calculation, 'view'),
                  disabled: Boolean(busy) || !calculation.generated_pdf_path,
                },
              ]}
            />
          </article>
        );
      })}
      <FullScreenLoader
        show={busy?.action === 'pdf'}
        title="Generowanie PDF"
        description="Przygotowuję dokument kalkulacji. Proszę chwilę poczekać…"
      />
    </section>
  );
}
