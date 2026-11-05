'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BadgePercent, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  COMMISSION_PAYMENT_LABELS,
  formatPercent,
  parseMyCommissions,
  type CommissionPaymentMethod,
} from '@/lib/events/settlement/eventSettlement';
import {
  SETTLEMENT_MIGRATION_NOTICE,
  isMissingRpc,
  settlementErrorMessage,
} from '@/components/crm/events/settlement/settlementUi';
import EmployeeSalesTermsEditor, { type EmployeeTermsDraft } from './EmployeeSalesTermsEditor';
import { parseSalesCommissionSettings, type SalesCommissionEmployeeTerms, type SalesCommissionSettings } from './salesCommissionSettings';

type ReadOnlyTerms = { enabled: boolean; standard_rate: number; own_client_rate: number; payment_method: CommissionPaymentMethod };
type LoadState = 'loading' | 'ready' | 'missing' | 'hidden' | 'error';

/**
 * Warunki prowizji od sprzedaży na karcie pracownika: administrator edytuje (set_employee_sales_commission_terms),
 * pracownik widzi swoje stawki tylko do odczytu (get_my_commissions). Inne osoby — karta się nie pokazuje.
 */
export default function EmployeeSalesCommissionTermsCard({
  employeeId,
  isAdmin,
  isOwnProfile,
  className = '',
}: {
  employeeId: string;
  isAdmin: boolean;
  isOwnProfile: boolean;
  className?: string;
}) {
  const { showSnackbar } = useSnackbar();
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<SalesCommissionSettings | null>(null);
  const [own, setOwn] = useState<ReadOnlyTerms | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mode: 'admin' | 'own' | null = isAdmin ? 'admin' : isOwnProfile ? 'own' : null;

  const load = useCallback(async () => {
    if (!mode) return;
    setState('loading');
    const { data, error: loadError } = await supabase.rpc(mode === 'admin' ? 'get_sales_commission_settings' : 'get_my_commissions');
    if (loadError) {
      if (isMissingRpc(loadError)) setState('missing');
      else if (loadError.code === '42501') setState('hidden');
      else {
        setError(settlementErrorMessage(loadError, 'Nie udało się wczytać warunków prowizji.'));
        setState('error');
      }
      return;
    }
    if (mode === 'admin') {
      const parsed = parseSalesCommissionSettings(data);
      if (!parsed) {
        setError('Baza zwróciła nieczytelne ustawienia prowizji.');
        setState('error');
        return;
      }
      setSettings(parsed);
    } else {
      const parsed = parseMyCommissions(data);
      if (!parsed) {
        setError('Baza zwróciła nieczytelne dane prowizji.');
        setState('error');
        return;
      }
      setOwn({
        enabled: parsed.enabled,
        standard_rate: parsed.standard_rate,
        own_client_rate: parsed.own_client_rate,
        payment_method: parsed.payment_method,
      });
    }
    setState('ready');
  }, [mode]);

  useEffect(() => {
    void load();
  }, [load, employeeId]);

  if (!mode || state === 'hidden') return null;

  // Pracownik bez wpisu (nieaktywny i bez warunków) — domyślnie bez prowizji.
  const adminTerms: SalesCommissionEmployeeTerms | null = settings
    ? settings.employees.find(item => item.employee_id === employeeId) ?? {
        employee_id: employeeId,
        name: 'Pracownik',
        is_active: false,
        role: null,
        enabled: false,
        standard_rate: null,
        own_client_rate: null,
        payment_method: 'payroll',
        updated_at: null,
      }
    : null;

  const save = async (draft: EmployeeTermsDraft): Promise<boolean> => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const { data, error: saveError } = await supabase.rpc('set_employee_sales_commission_terms', {
        p_employee_id: employeeId,
        p_enabled: draft.enabled,
        p_standard_rate: draft.standard_rate,
        p_own_client_rate: draft.own_client_rate,
        p_payment_method: draft.payment_method,
      });
      if (saveError) {
        showSnackbar(settlementErrorMessage(saveError, 'Nie udało się zapisać warunków prowizji.'), 'error', 8000);
        return false;
      }
      const parsed = parseSalesCommissionSettings(data);
      if (parsed) setSettings(parsed);
      else void load();
      showSnackbar('Warunki prowizji zapisane — prognozy otwartych wydarzeń przeliczone.', 'success');
      return true;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby={`sales-terms-${employeeId}`} className={`rounded-xl bg-[#1c1f33] p-5 ${className}`}>
      <h3 id={`sales-terms-${employeeId}`} className="flex items-center gap-2 font-medium text-[#e5e4e2]">
        <BadgePercent className="h-4 w-4 text-[#d3bb73]" aria-hidden />
        Prowizja od sprzedaży
      </h3>
      <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/50">
        Procent od zysku netto wydarzeń, w których pracownik jest sprzedawcą wydarzenia. Wyższa stawka, gdy w dniu akceptacji oferty był
        opiekunem klienta.
      </p>
      {state === 'loading' && (
        <p className="mt-3 flex items-center gap-2 text-sm text-[#e5e4e2]/55">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Wczytuję…
        </p>
      )}
      {state === 'missing' && <p className="mt-3 rounded-lg bg-amber-400/10 p-3 text-sm text-amber-100/90">{SETTLEMENT_MIGRATION_NOTICE}</p>}
      {state === 'error' && (
        <p role="alert" className="mt-3 text-sm text-red-200">
          {error}
        </p>
      )}
      {state === 'ready' && mode === 'admin' && settings && adminTerms && (
        <div className="mt-3">
          <EmployeeSalesTermsEditor
            layout="card"
            terms={adminTerms}
            defaults={settings}
            disabled={saving}
            saving={saving}
            onSave={save}
          />
          <p className="mt-2 text-[11px] text-[#e5e4e2]/40">
            Puste pole stawki = stawka globalna ({formatPercent(settings.standard_rate)} / {formatPercent(settings.own_client_rate)}).
          </p>
        </div>
      )}
      {state === 'ready' && mode === 'own' && own && (
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <dt className="text-xs text-[#e5e4e2]/50">Status</dt>
            <dd className={own.enabled ? 'text-emerald-300' : 'text-[#e5e4e2]/60'}>{own.enabled ? 'Włączona' : 'Wyłączona'}</dd>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <dt className="text-xs text-[#e5e4e2]/50">Sposób wypłaty</dt>
            <dd className="text-[#e5e4e2]">{COMMISSION_PAYMENT_LABELS[own.payment_method] ?? own.payment_method}</dd>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <dt className="text-xs text-[#e5e4e2]/50">Stawka</dt>
            <dd className="tabular-nums text-[#e5e4e2]">{formatPercent(own.standard_rate)} zysku netto</dd>
          </div>
          <div className="rounded-lg bg-white/[0.03] px-3 py-2">
            <dt className="text-xs text-[#e5e4e2]/50">Klient własny</dt>
            <dd className="tabular-nums text-[#e5e4e2]">{formatPercent(own.own_client_rate)} zysku netto</dd>
          </div>
          <p className="text-[11px] text-[#e5e4e2]/40 sm:col-span-2">Warunki ustawia administrator.</p>
        </dl>
      )}
    </section>
  );
}
