'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { X, Calculator, FileText } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { EventStatus } from './Calendar/types';

const EVENT_STATUSES: { value: EventStatus; label: string }[] = [
  { value: 'inquiry', label: 'Zapytanie' },
  { value: 'offer_to_send', label: 'Oferta do wysłania' },
  { value: 'offer_sent', label: 'Oferta wysłana' },
  { value: 'offer_accepted', label: 'Oferta zaakceptowana' },
  { value: 'in_preparation', label: 'W przygotowaniu' },
  { value: 'in_progress', label: 'W trakcie' },
  { value: 'completed', label: 'Zrealizowany' },
  { value: 'cancelled', label: 'Anulowany' },
  { value: 'invoiced', label: 'Zafakturowany' },
];

interface FinancialSourceOption {
  type: 'offer' | 'calculation';
  id: string;
  label: string;
  total: number;
}

export default function EventStatusSelectModal({
  isOpen,
  onClose,
  eventId,
  currentStatus,
  onStatusChange,
  canManage,
}: {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  currentStatus: string;
  onStatusChange?: (newStatus: string) => void;
  canManage: boolean;
}) {
  const { showSnackbar } = useSnackbar();
  const [value, setValue] = useState(currentStatus || 'draft');
  const [saving, setSaving] = useState(false);
  const [financialSource, setFinancialSource] = useState<'offer' | 'calculation'>('offer');
  const [financialOptions, setFinancialOptions] = useState<FinancialSourceOption[]>([]);
  const [selectedCalculationId, setSelectedCalculationId] = useState<string>('');
  const [loadingOptions, setLoadingOptions] = useState(false);

  const showFinancialSourcePicker = value === 'offer_accepted' && canManage;

  useEffect(() => {
    if (!isOpen || !showFinancialSourcePicker) return;

    const fetchOptions = async () => {
      setLoadingOptions(true);
      const options: FinancialSourceOption[] = [];

      const { data: offers } = await supabase
        .from('offers')
        .select('id, total_amount, offer_number')
        .eq('event_id', eventId)
        .in('status', ['sent', 'accepted'])
        .order('created_at', { ascending: false });

      if (offers?.length) {
        for (const o of offers) {
          options.push({
            type: 'offer',
            id: o.id,
            label: `Oferta ${o.offer_number || '(bez numeru)'}`,
            total: o.total_amount ?? 0,
          });
        }
      }

      const { data: calcs } = await supabase
        .from('event_calculations')
        .select('id, name, event_calculation_items(quantity, unit_price, days)')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

      if (calcs?.length) {
        for (const c of calcs as any[]) {
          const items = c.event_calculation_items ?? [];
          const total = items.reduce(
            (s: number, it: any) =>
              s + Number(it.quantity || 0) * Number(it.unit_price || 0) * Number(it.days || 1),
            0,
          );
          options.push({
            type: 'calculation',
            id: c.id,
            label: `Kalkulacja: ${c.name}`,
            total: Math.round(total * 100) / 100,
          });
        }
      }

      setFinancialOptions(options);

      const { data: event } = await supabase
        .from('events')
        .select('financial_source, accepted_calculation_id')
        .eq('id', eventId)
        .maybeSingle();

      if (event?.financial_source === 'calculation' && event.accepted_calculation_id) {
        setFinancialSource('calculation');
        setSelectedCalculationId(event.accepted_calculation_id);
      } else {
        setFinancialSource('offer');
      }

      setLoadingOptions(false);
    };

    fetchOptions();
  }, [isOpen, showFinancialSourcePicker, eventId]);

  if (!isOpen) return null;

  const fmtPLN = (n: number) =>
    n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' PLN';

  const calculationOptions = financialOptions.filter((o) => o.type === 'calculation');
  const hasOffers = financialOptions.some((o) => o.type === 'offer');
  const hasCalculations = calculationOptions.length > 0;

  const save = async () => {
    try {
      setSaving(true);

      const updateData: Record<string, any> = {
        status: value,
        updated_at: new Date().toISOString(),
      };

      if (showFinancialSourcePicker) {
        updateData.financial_source = financialSource;

        if (financialSource === 'calculation' && selectedCalculationId) {
          const { error: calcError } = await supabase
            .from('event_calculations')
            .update({ is_accepted: true })
            .eq('id', selectedCalculationId);

          if (calcError) throw calcError;
        } else if (financialSource === 'offer') {
          const { data: currentCalc } = await supabase
            .from('event_calculations')
            .select('id')
            .eq('event_id', eventId)
            .eq('is_accepted', true)
            .maybeSingle();

          if (currentCalc) {
            await supabase
              .from('event_calculations')
              .update({ is_accepted: false })
              .eq('id', currentCalc.id);
          }

          updateData.accepted_calculation_id = null;
        }
      }

      const { error } = await supabase.from('events').update(updateData).eq('id', eventId);

      if (error) throw error;

      showSnackbar('Status eventu został zaktualizowany', 'success');
      onStatusChange?.(value);
      onClose();
    } catch (err: any) {
      console.error('Error updating status:', err);
      showSnackbar(err?.message || 'Błąd podczas aktualizacji statusu', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-light text-[#e5e4e2]">Zmień status eventu</h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status</label>
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          disabled={saving}
        >
          {EVENT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        {showFinancialSourcePicker && (
          <div className="mt-4 rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33]/50 p-4">
            <label className="mb-3 block text-sm font-medium text-[#e5e4e2]">
              Źródło danych finansowych
            </label>

            {loadingOptions ? (
              <p className="text-sm text-[#e5e4e2]/50">Wczytywanie opcji...</p>
            ) : (
              <div className="space-y-2">
                {hasOffers && (
                  <button
                    type="button"
                    onClick={() => setFinancialSource('offer')}
                    className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                      financialSource === 'offer'
                        ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                        : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/30'
                    }`}
                  >
                    <FileText
                      className={`h-5 w-5 ${financialSource === 'offer' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/40'}`}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[#e5e4e2]">
                        Zaakceptowana oferta
                      </div>
                      <div className="text-xs text-[#e5e4e2]/50">
                        Dane finansowe z najnowszej zaakceptowanej oferty
                      </div>
                    </div>
                    {financialSource === 'offer' && (
                      <div className="h-2 w-2 rounded-full bg-[#d3bb73]" />
                    )}
                  </button>
                )}

                {hasCalculations && (
                  <button
                    type="button"
                    onClick={() => {
                      setFinancialSource('calculation');
                      if (!selectedCalculationId && calculationOptions.length > 0) {
                        setSelectedCalculationId(calculationOptions[0].id);
                      }
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                      financialSource === 'calculation'
                        ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                        : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/30'
                    }`}
                  >
                    <Calculator
                      className={`h-5 w-5 ${financialSource === 'calculation' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/40'}`}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[#e5e4e2]">Kalkulacja</div>
                      <div className="text-xs text-[#e5e4e2]/50">
                        Dane finansowe z wybranej kalkulacji
                      </div>
                    </div>
                    {financialSource === 'calculation' && (
                      <div className="h-2 w-2 rounded-full bg-[#d3bb73]" />
                    )}
                  </button>
                )}

                {financialSource === 'calculation' && calculationOptions.length > 0 && (
                  <div className="mt-2 pl-8">
                    <select
                      value={selectedCalculationId}
                      onChange={(e) => setSelectedCalculationId(e.target.value)}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    >
                      {calculationOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label} ({fmtPLN(opt.total)})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {!hasOffers && !hasCalculations && (
                  <p className="text-sm text-[#e5e4e2]/50">
                    Brak ofert ani kalkulacji do wyboru. Stwórz ofertę lub kalkulację.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={save}
            disabled={saving || (showFinancialSourcePicker && financialSource === 'calculation' && !selectedCalculationId)}
            className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {saving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33] disabled:opacity-50"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
