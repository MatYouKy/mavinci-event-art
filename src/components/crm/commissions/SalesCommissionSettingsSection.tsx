'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { BadgePercent, Loader2, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { formatPercent } from '@/lib/events/settlement/eventSettlement';
import {
  SETTLEMENT_MIGRATION_NOTICE,
  isMissingRpc,
  parsePercentInput,
  settlementErrorMessage,
  settlementInputClass,
} from '@/components/crm/events/settlement/settlementUi';
import EmployeeSalesTermsEditor, { type EmployeeTermsDraft } from './EmployeeSalesTermsEditor';
import { parseSalesCommissionSettings, rateInputValue, type SalesCommissionSettings } from './salesCommissionSettings';

type LoadState = 'loading' | 'ready' | 'missing' | 'hidden' | 'error';

/**
 * „Prowizja pracowników od sprzedaży” (administrator): stawki globalne (5% / 10% klient własny)
 * i warunki każdego pracownika. Zmiany przeliczają prognozy otwartych wydarzeń w bazie.
 */
export default function SalesCommissionSettingsSection({ className = '' }: { className?: string }) {
  const { showSnackbar } = useSnackbar();
  const [settings, setSettings] = useState<SalesCommissionSettings | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [standard, setStandard] = useState('');
  const [own, setOwn] = useState('');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const busyRef = useRef<string | null>(null);

  const accept = useCallback((next: SalesCommissionSettings) => {
    setSettings(next);
    setStandard(rateInputValue(next.standard_rate));
    setOwn(rateInputValue(next.own_client_rate));
    setState('ready');
  }, []);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('get_sales_commission_settings');
    if (loadError) {
      if (isMissingRpc(loadError)) setState('missing');
      else if (loadError.code === '42501') setState('hidden');
      else {
        setError(settlementErrorMessage(loadError, 'Nie udało się wczytać ustawień prowizji.'));
        setState('error');
      }
      return;
    }
    const parsed = parseSalesCommissionSettings(data);
    if (!parsed) {
      setError('Baza zwróciła nieczytelne ustawienia prowizji.');
      setState('error');
      return;
    }
    accept(parsed);
  }, [accept]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, rpc: string, params: Record<string, unknown>, message: string): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = key;
    setBusy(key);
    try {
      const { data, error: saveError } = await supabase.rpc(rpc, params);
      if (saveError) {
        showSnackbar(settlementErrorMessage(saveError, 'Nie udało się zapisać ustawień prowizji.'), 'error', 8000);
        return false;
      }
      const parsed = parseSalesCommissionSettings(data);
      if (parsed) accept(parsed);
      else void load();
      showSnackbar(message, 'success');
      return true;
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  };

  const saveDefaults = async (event: FormEvent) => {
    event.preventDefault();
    const standardRate = parsePercentInput(standard);
    const ownRate = parsePercentInput(own);
    if (standardRate === null || ownRate === null) {
      showSnackbar('Stawki muszą mieścić się w zakresie 0–100%.', 'warning');
      return;
    }
    await run(
      'defaults',
      'set_sales_commission_defaults',
      { p_standard_rate: standardRate, p_own_client_rate: ownRate },
      'Stawki globalne zapisane — prognozy otwartych wydarzeń przeliczone.',
    );
  };

  const saveEmployee = (employeeId: string, name: string) => (draft: EmployeeTermsDraft) =>
    run(
      `employee:${employeeId}`,
      'set_employee_sales_commission_terms',
      {
        p_employee_id: employeeId,
        p_enabled: draft.enabled,
        p_standard_rate: draft.standard_rate,
        p_own_client_rate: draft.own_client_rate,
        p_payment_method: draft.payment_method,
      },
      `Zapisano warunki: ${name}.`,
    );

  const employees = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pl-PL');
    return (settings?.employees ?? []).filter(
      item => (showInactive || item.is_active) && (!query || item.name.toLocaleLowerCase('pl-PL').includes(query)),
    );
  }, [settings, search, showInactive]);

  if (state === 'hidden') return null;

  return (
    <section aria-labelledby="sales-commission-settings-heading" className={`rounded-xl bg-[#1c1f33] p-5 ${className}`}>
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-[#d3bb73]/10 p-2">
          <BadgePercent className="h-5 w-5 text-[#d3bb73]" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="sales-commission-settings-heading" className="font-medium text-[#e5e4e2]">
            Prowizja pracowników od sprzedaży
          </h2>
          <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/50">
            Sprzedawca wydarzenia dostaje procent od zysku netto (przychód − wykonawcy zewnętrzni − koszty bezpośrednie − ekipa −
            prowizje zewnętrzne). Wyższa stawka, gdy w dniu akceptacji oferty był opiekunem klienta. Wyliczenie widać w zakładce
            Podsumowanie wydarzenia.
          </p>
        </div>
      </div>

      {state === 'loading' && (
        <p className="mt-4 flex items-center gap-2 text-sm text-[#e5e4e2]/55">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Wczytuję ustawienia…
        </p>
      )}
      {state === 'missing' && <p className="mt-4 rounded-lg bg-amber-400/10 p-3 text-sm text-amber-100/90">{SETTLEMENT_MIGRATION_NOTICE}</p>}
      {state === 'error' && (
        <p role="alert" className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-200">
          {error}{' '}
          <button type="button" onClick={() => void load()} className="text-[#d3bb73] underline">
            Spróbuj ponownie
          </button>
        </p>
      )}

      {state === 'ready' && settings && (
        <>
          <form onSubmit={saveDefaults} noValidate className="mt-4 grid gap-3 rounded-lg bg-black/15 p-4 sm:grid-cols-[repeat(2,minmax(0,10rem))_auto] sm:items-end">
            <label className="block text-xs text-[#e5e4e2]/60">
              Stawka standardowa (%)
              <input
                inputMode="decimal"
                value={standard}
                disabled={Boolean(busy)}
                onChange={event => setStandard(event.target.value)}
                className={`${settlementInputClass} mt-1`}
              />
            </label>
            <label className="block text-xs text-[#e5e4e2]/60">
              Klient własny (%)
              <input
                inputMode="decimal"
                value={own}
                disabled={Boolean(busy)}
                onChange={event => setOwn(event.target.value)}
                className={`${settlementInputClass} mt-1`}
              />
            </label>
            <button
              type="submit"
              disabled={Boolean(busy)}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#d3bb73] px-4 text-sm font-medium text-[#210811] hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              {busy === 'defaults' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Zapisz stawki
            </button>
            <p className="text-[11px] leading-5 text-[#e5e4e2]/40 sm:col-span-3">
              Koszt firmy: wynagrodzenie pracownicze + składki pracodawcy
              {settings.employer_social_rate != null ? ` (${formatPercent(settings.employer_social_rate)})` : ''}, gotówka z zysku —
              kwota / (1 − podatek{settings.dividend_rate != null ? ` ${formatPercent(settings.dividend_rate)}` : ''}). Stawki składek
              i podatku zmienisz w{' '}
              <Link href="/crm/settings" className="text-[#d3bb73] hover:underline">
                ustawieniach wynagrodzeń
              </Link>
              .
            </p>
          </form>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-[#e5e4e2]">Pracownicy</h3>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-[#e5e4e2]/60">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={event => setShowInactive(event.target.checked)}
                  className="h-4 w-4 accent-[#d3bb73]"
                />
                Pokaż nieaktywnych
              </label>
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-white/35" aria-hidden />
                <input
                  aria-label="Szukaj pracownika"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Szukaj pracownika…"
                  className={`${settlementInputClass} pl-9`}
                />
              </div>
            </div>
          </div>
          <ul className="mt-3 space-y-2">
            {employees.map(item => (
              <li key={item.employee_id} className={`rounded-lg px-3 py-3 ${item.enabled ? 'bg-white/[0.04]' : 'bg-white/[0.02]'}`}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/crm/employees/${item.employee_id}`} className="text-sm text-[#e5e4e2] hover:text-[#d3bb73]">
                    {item.name}
                  </Link>
                  <span className="text-[11px] text-[#e5e4e2]/40">
                    {[item.role, item.is_active ? null : 'nieaktywny'].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <EmployeeSalesTermsEditor
                  terms={item}
                  defaults={settings}
                  disabled={Boolean(busy)}
                  saving={busy === `employee:${item.employee_id}`}
                  onSave={saveEmployee(item.employee_id, item.name)}
                />
              </li>
            ))}
            {employees.length === 0 && <li className="py-6 text-center text-sm text-[#e5e4e2]/40">Brak pracowników spełniających filtry.</li>}
          </ul>
        </>
      )}
    </section>
  );
}
