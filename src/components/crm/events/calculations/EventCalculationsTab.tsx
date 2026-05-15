'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Calculator,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  Copy,
  FileCheck2,
  Printer,
  Mail,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import {
  DEFAULT_VAT,
  fmt,
  round2,
} from '@/components/crm/events/helpers/calculations/calculations.helper';
import { CalculationEditor } from './CalculationEditor';
import SendCalculationEmailModal from '../../SendCalculationEmailModal';

export type Category = 'equipment' | 'staff' | 'transport' | 'other';

interface CalculationRow {
  id: string;
  event_id: string;
  name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  generated_pdf_path: string | null;
  items_count?: number;
  total?: number;
}

export interface CalcItem {
  id?: string;
  calculation_id?: string;
  category: Category;
  name: string;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  days: number;
  source: 'manual' | 'offer' | 'warehouse';
  source_ref?: string | null;
  position: number;
  vat_rate: number;
  editing?: boolean;
}

interface Props {
  eventId: string;
}

// const rowTotal = rowNet;

export default function EventCalculationsTab({ eventId }: Props) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const [list, setList] = useState<CalculationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [sendingCalculation, setSendingCalculation] = useState<CalculationRow | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const fetchList = useCallback(
    async (showLoader = true) => {
      if (showLoader) setLoading(true);

      const { data, error } = await supabase
        .from('event_calculations')
        .select('*, event_calculation_items(quantity, unit_price, days)')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error(error);
        showSnackbar('Nie udało się pobrać kalkulacji', 'error');
        if (showLoader) setLoading(false);
        return;
      }

      const rows: CalculationRow[] = (data ?? []).map((r: any) => {
        const items = r.event_calculation_items ?? [];
        const total = items.reduce(
          (s: number, it: any) =>
            s + Number(it.quantity || 0) * Number(it.unit_price || 0) * Number(it.days || 1),
          0,
        );

        return {
          id: r.id,
          event_id: r.event_id,
          name: r.name,
          notes: r.notes,
          created_at: r.created_at,
          updated_at: r.updated_at,
          items_count: items.length,
          total: round2(total),
          generated_pdf_path: r.generated_pdf_path ?? null,
        };
      });

      setList(rows);
      if (showLoader) setLoading(false);
    },
    [eventId, showSnackbar],
  );

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const handleCreate = async () => {
    const { data, error } = await supabase
      .from('event_calculations')
      .insert({ event_id: eventId, name: 'Nowa kalkulacja' })
      .select()
      .single();
    if (error || !data) {
      showSnackbar('Nie udało się utworzyć kalkulacji', 'error');
      return;
    }
    await fetchList();
    setActiveId(data.id);
  };

  const handleDelete = async (id: string) => {
    showConfirm({
      title: 'Usunąć kalkulację?',
      message: 'Tej operacji nie można cofnąć.',
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    }).then(async (confirmed: boolean | void) => {
      if (confirmed) {
        await supabase.from('event_calculations').delete().eq('id', id);
        setList((prev) => prev.filter((item) => item.id !== id));
      } else {
        showSnackbar('Anulowano usuwanie kalkulacji', 'warning');
      }
    });
  };

  const handleDuplicate = async (id: string) => {
    try {
      setDuplicatingId(id);

      const { data: calc, error: calcError } = await supabase
        .from('event_calculations')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (calcError) throw calcError;

      if (!calc) {
        showSnackbar('Nie znaleziono kalkulacji do duplikowania', 'error');
        return;
      }

      const { data: calcItems, error: itemsError } = await supabase
        .from('event_calculation_items')
        .select('*')
        .eq('calculation_id', id)
        .order('position');

      if (itemsError) throw itemsError;

      const { data: newCalc, error: insertCalcError } = await supabase
        .from('event_calculations')
        .insert({
          event_id: calc.event_id,
          name: `${calc.name} — kopia`,
          notes: calc.notes,
        })
        .select()
        .single();

      if (insertCalcError) throw insertCalcError;

      if (calcItems?.length) {
        const payload = calcItems.map((item: any, index: number) => ({
          calculation_id: newCalc.id,
          category: item.category,
          name: item.name,
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
          unit_price: item.unit_price,
          days: item.days,
          source: item.source,
          source_ref: item.source_ref,
          position: index,
          vat_rate: item.vat_rate ?? DEFAULT_VAT,
        }));

        const { error: insertItemsError } = await supabase
          .from('event_calculation_items')
          .insert(payload);

        if (insertItemsError) throw insertItemsError;
      }

      const duplicatedTotal =
        calcItems?.reduce(
          (sum: number, item: any) =>
            sum +
            Number(item.quantity || 0) * Number(item.unit_price || 0) * Number(item.days || 1),
          0,
        ) ?? 0;

      setList((prev) => [
        {
          id: newCalc.id,
          event_id: newCalc.event_id,
          name: newCalc.name,
          notes: newCalc.notes,
          created_at: newCalc.created_at,
          updated_at: newCalc.updated_at,
          items_count: calcItems?.length ?? 0,
          total: round2(duplicatedTotal),
          generated_pdf_path: null,
        },
        ...prev,
      ]);

      showSnackbar('Kalkulacja została zduplikowana', 'success');
    } catch (error: any) {
      console.error('Error duplicating calculation:', error);
      showSnackbar(error.message || 'Nie udało się zduplikować kalkulacji', 'error');
    } finally {
      setDuplicatingId(null);
    }
  };

  const handlePrintPdf = async (calculation: CalculationRow) => {
    if (!calculation.generated_pdf_path) {
      showSnackbar('Ta kalkulacja nie ma jeszcze wygenerowanego PDF', 'warning');
      return;
    }

    try {
      setPrintingId(calculation.id);

      const { data, error } = await supabase.storage
        .from('event-files')
        .createSignedUrl(calculation.generated_pdf_path, 300);

      if (error || !data?.signedUrl) {
        throw error || new Error('Nie udało się pobrać PDF');
      }

      const win = window.open(data.signedUrl, '_blank');

      if (!win) {
        showSnackbar('Przeglądarka zablokowała nowe okno', 'warning');
        return;
      }

      win.focus();

      setTimeout(() => {
        win.print();
      }, 800);
    } catch (error: any) {
      console.error('Error printing PDF:', error);
      showSnackbar(error.message || 'Nie udało się otworzyć PDF', 'error');
    } finally {
      setPrintingId(null);
    }
  };

  if (activeId) {
    return (
      <CalculationEditor
        calculationId={activeId}
        eventId={eventId}
        onBack={() => {
          setActiveId(null);
          fetchList();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-light text-[#e5e4e2]">
            <Calculator className="h-5 w-5 text-[#d3bb73]" />
            Kalkulacje wydarzenia
          </h2>
          <p className="text-sm text-[#e5e4e2]/60">
            Podsumowanie zasobów: sprzęt, ludzie, transport i inne.
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Stwórz kalkulację
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8 text-center text-[#e5e4e2]/60">
          Wczytywanie...
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#d3bb73]/20 bg-[#1c1f33] p-10 text-center">
          <Calculator className="mx-auto mb-3 h-10 w-10 text-[#d3bb73]/40" />
          <p className="text-[#e5e4e2]/70">Brak kalkulacji dla tego wydarzenia</p>
          <p className="mt-1 text-sm text-[#e5e4e2]/50">
            Kliknij &bdquo;Stwórz kalkulację&rdquo;, aby zacząć.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
          <table className="w-full text-sm">
            <thead className="bg-[#0a0d1a] text-left text-xs uppercase tracking-wider text-[#e5e4e2]/60">
              <tr>
                <th className="px-4 py-3">Nazwa</th>
                <th className="px-4 py-3">Pozycje</th>
                <th className="px-4 py-3">Suma netto</th>
                <th className="px-4 py-3">Zmodyfikowano</th>
                <th className="px-4 py-3 text-right">Akcje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#d3bb73]/10">
              {list.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer transition-colors hover:bg-[#0a0d1a]/50"
                  onClick={() => setActiveId(c.id)}
                >
                  <td className="px-4 py-3 font-medium text-[#e5e4e2]">
                    <div className="flex items-center gap-2">
                      <span>{c.name}</span>

                      {c.generated_pdf_path && (
                        <span
                          title="PDF wygenerowany"
                          className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400"
                        >
                          <FileCheck2 className="mr-1 h-3.5 w-3.5" />
                          PDF
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#e5e4e2]/80">{c.items_count ?? 0}</td>
                  <td className="px-4 py-3 text-[#d3bb73]">{fmt(c.total ?? 0)} PLN</td>
                  <td className="px-4 py-3 text-[#e5e4e2]/60">
                    {new Date(c.updated_at).toLocaleString('pl-PL')}
                  </td>
                  <td
                    className="px-4 py-3"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="flex justify-end">
                      <ResponsiveActionBar
                        disabledBackground
                        mobileBreakpoint={4000}
                        actions={[
                          {
                            label: 'Edytuj',
                            onClick: () => setActiveId(c.id),
                            icon: <Pencil className="h-4 w-4" />,
                            variant: 'default',
                          },
                          {
                            label: duplicatingId === c.id ? 'Duplikuję...' : 'Duplikuj',
                            onClick: () => handleDuplicate(c.id),
                            disabled: duplicatingId === c.id,
                            icon:
                              duplicatingId === c.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              ),
                            variant: 'default',
                          },
                          {
                            label: printingId === c.id ? 'Otwieram PDF...' : 'Drukuj PDF',
                            onClick: () => handlePrintPdf(c),
                            disabled: !c.generated_pdf_path || printingId === c.id,
                            icon:
                              printingId === c.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Printer className="h-4 w-4" />
                              ),
                            variant: 'default',
                          },
                          {
                            label: 'Wyślij',
                            onClick: () => setSendingCalculation(c),
                            disabled: !c.generated_pdf_path,
                            icon: <Mail className="h-4 w-4" />,
                            variant: 'default',
                          },
                          {
                            label: 'Usuń',
                            onClick: () => handleDelete(c.id),
                            icon: <Trash2 className="h-4 w-4" />,
                            variant: 'danger',
                          },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sendingCalculation && (
        <SendCalculationEmailModal
          calculationId={sendingCalculation.id}
          eventId={eventId}
          calculationName={sendingCalculation.name}
          onClose={() => setSendingCalculation(null)}
        />
      )}
    </div>
  );
}
