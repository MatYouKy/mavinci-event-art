'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { COMMISSION_PAYMENT_LABELS, type CommissionPaymentMethod } from '@/lib/events/settlement/eventSettlement';
import SettlementSwitch from '@/components/crm/events/settlement/SettlementSwitch';
import { parsePercentInput, settlementInputClass } from '@/components/crm/events/settlement/settlementUi';
import { PAYMENT_METHODS, rateInputValue, type SalesCommissionEmployeeTerms } from './salesCommissionSettings';

export type EmployeeTermsDraft = {
  enabled: boolean;
  standard_rate: number | null;
  own_client_rate: number | null;
  payment_method: CommissionPaymentMethod;
};

/**
 * Warunki prowizji od sprzedaży jednego pracownika (administrator): przełącznik, własne stawki (puste = globalne)
 * i sposób wypłaty. Zapis: set_employee_sales_commission_terms (wywołuje rodzic).
 */
export default function EmployeeSalesTermsEditor({
  terms,
  defaults,
  disabled,
  saving,
  onSave,
  layout = 'row',
}: {
  terms: SalesCommissionEmployeeTerms;
  defaults: { standard_rate: number; own_client_rate: number };
  disabled: boolean;
  saving: boolean;
  onSave: (draft: EmployeeTermsDraft) => Promise<boolean>;
  layout?: 'row' | 'card';
}) {
  const [enabled, setEnabled] = useState(terms.enabled);
  const [standard, setStandard] = useState(rateInputValue(terms.standard_rate));
  const [own, setOwn] = useState(rateInputValue(terms.own_client_rate));
  const [method, setMethod] = useState<CommissionPaymentMethod>(terms.payment_method);
  const [error, setError] = useState('');

  // Po zapisie (nowe dane z bazy) formularz wraca do zapisanych wartości.
  useEffect(() => {
    setEnabled(terms.enabled);
    setStandard(rateInputValue(terms.standard_rate));
    setOwn(rateInputValue(terms.own_client_rate));
    setMethod(terms.payment_method);
    setError('');
  }, [terms.enabled, terms.standard_rate, terms.own_client_rate, terms.payment_method, terms.updated_at]);

  const dirty =
    enabled !== terms.enabled ||
    standard.trim() !== rateInputValue(terms.standard_rate) ||
    own.trim() !== rateInputValue(terms.own_client_rate) ||
    method !== terms.payment_method;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || !dirty) return;
    const standardRate = standard.trim() ? parsePercentInput(standard) : null;
    const ownRate = own.trim() ? parsePercentInput(own) : null;
    if ((standard.trim() && standardRate === null) || (own.trim() && ownRate === null)) {
      setError('Stawki muszą mieścić się w zakresie 0–100%.');
      return;
    }
    setError('');
    await onSave({ enabled, standard_rate: standardRate, own_client_rate: ownRate, payment_method: method });
  };

  const card = layout === 'card';
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={saving}
      className={card ? 'space-y-3' : 'grid gap-2 sm:grid-cols-[auto_6.5rem_6.5rem_minmax(0,12rem)_auto] sm:items-end'}
    >
      <div className={card ? '' : 'sm:pb-1'}>
        <SettlementSwitch
          checked={enabled}
          onChange={setEnabled}
          disabled={disabled}
          label={enabled ? 'Prowizja włączona' : 'Bez prowizji'}
        />
      </div>
      <div className={card ? 'grid gap-3 sm:grid-cols-3' : 'contents'}>
        <label className="block text-xs text-[#e5e4e2]/60">
          Stawka (%)
          <input
            inputMode="decimal"
            value={standard}
            disabled={disabled}
            onChange={event => setStandard(event.target.value)}
            placeholder={`${rateInputValue(defaults.standard_rate)} (globalna)`}
            className={`${settlementInputClass} mt-1`}
          />
        </label>
        <label className="block text-xs text-[#e5e4e2]/60">
          Klient własny (%)
          <input
            inputMode="decimal"
            value={own}
            disabled={disabled}
            onChange={event => setOwn(event.target.value)}
            placeholder={`${rateInputValue(defaults.own_client_rate)} (globalna)`}
            className={`${settlementInputClass} mt-1`}
          />
        </label>
        <label className="block text-xs text-[#e5e4e2]/60">
          Sposób wypłaty
          <select
            value={method}
            disabled={disabled}
            onChange={event => setMethod(event.target.value as CommissionPaymentMethod)}
            className={`${settlementInputClass} mt-1`}
          >
            {PAYMENT_METHODS.map(option => (
              <option key={option} value={option}>
                {COMMISSION_PAYMENT_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={card ? 'flex justify-end' : ''}>
        <button
          type="submit"
          disabled={disabled || !dirty}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#d3bb73] px-3 text-xs font-medium text-[#210811] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Zapisz
        </button>
      </div>
      {error && (
        <p role="alert" className={`text-xs text-red-200 ${card ? '' : 'sm:col-span-5'}`}>
          {error}
        </p>
      )}
    </form>
  );
}
