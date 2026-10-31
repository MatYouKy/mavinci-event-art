'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { supabase } from '@/lib/supabase/browser';

type Guardrails = {
  enabled: boolean;
  max_discount_percent: number;
  min_margin_percent: number;
  updated_at: string;
};

const inputClass = 'w-full rounded-lg bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]';

export default function SalesGuardrailsSettingsPage() {
  const { isAdmin, employee, loading } = useCurrentEmployee();
  const [value, setValue] = useState<Guardrails | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    supabase
      .from('sales_offer_guardrails')
      .select('enabled, max_discount_percent, min_margin_percent, updated_at')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (!live) return;
        if (loadError || !data) setError('Progi akceptacji wymagają aktualizacji bazy.');
        else setValue(data as Guardrails);
      });
    return () => {
      live = false;
    };
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!value || busy) return;
    if (value.max_discount_percent < 0 || value.max_discount_percent > 100 || value.min_margin_percent < -100 || value.min_margin_percent > 100) {
      setError('Podaj wartości procentowe z zakresu 0–100 (marża od −100).');
      return;
    }
    setBusy(true);
    setError('');
    setSaved(false);
    const { data, error: saveError } = await supabase
      .from('sales_offer_guardrails')
      .update({
        enabled: value.enabled,
        max_discount_percent: value.max_discount_percent,
        min_margin_percent: value.min_margin_percent,
        updated_at: new Date().toISOString(),
        updated_by: employee?.id ?? null,
      })
      .eq('id', 1)
      .eq('updated_at', value.updated_at)
      .select('enabled, max_discount_percent, min_margin_percent, updated_at')
      .maybeSingle();
    setBusy(false);
    if (saveError || !data) {
      setError('Nie zapisano — ustawienia zmieniono w innym oknie albo brak uprawnień. Odśwież stronę.');
      return;
    }
    setValue(data as Guardrails);
    setSaved(true);
  };

  if (loading) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <Link href="/crm/settings" className="inline-flex items-center gap-2 text-sm text-[#e5e4e2]/60 hover:text-[#d3bb73]">
        <ArrowLeft className="h-4 w-4" /> Ustawienia
      </Link>
      <div>
        <h1 className="text-2xl font-light text-[#e5e4e2]">Progi akceptacji ofert</h1>
        <p className="mt-2 text-sm text-[#e5e4e2]/60">
          Oferta z rabatem powyżej limitu albo marżą poniżej progu wymaga akceptacji administratora lub osoby
          zarządzającej finansami, zanim zostanie wysłana klientowi. Akceptacja wygasa, gdy zmienią się kwoty.
        </p>
      </div>

      {value && (
        <form onSubmit={save} className="space-y-5 rounded-xl bg-[#1c1f33] p-6">
          <label className="flex items-center gap-3 text-sm text-[#e5e4e2]">
            <input
              type="checkbox"
              checked={value.enabled}
              disabled={!isAdmin}
              onChange={(event) => setValue({ ...value, enabled: event.target.checked })}
              className="h-4 w-4 rounded bg-[#0f1119] text-[#d3bb73]"
            />
            Kontroluj rabat i marżę przed wysyłką oferty
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm text-[#e5e4e2]/70">
              <span>Maksymalny rabat bez akceptacji (%)</span>
              <input
                type="number"
                step="0.5"
                min={0}
                max={100}
                disabled={!isAdmin}
                value={value.max_discount_percent}
                onChange={(event) => setValue({ ...value, max_discount_percent: Number(event.target.value) })}
                className={inputClass}
              />
            </label>
            <label className="space-y-1.5 text-sm text-[#e5e4e2]/70">
              <span>Minimalna marża bez akceptacji (%)</span>
              <input
                type="number"
                step="0.5"
                min={-100}
                max={100}
                disabled={!isAdmin}
                value={value.min_margin_percent}
                onChange={(event) => setValue({ ...value, min_margin_percent: Number(event.target.value) })}
                className={inputClass}
              />
            </label>
          </div>
          <p className="text-xs text-[#e5e4e2]/45">
            Marża jest liczona z kosztów pozycji oferty (katalog produktów, podwykonawcy, logistyka). Oferta bez kosztów nie
            jest blokowana progiem marży — interfejs pokazuje wtedy ostrzeżenie.
          </p>
          {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
          {saved && <p role="status" className="text-sm text-emerald-200">Zapisano.</p>}
          {isAdmin ? (
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Zapisz progi
            </button>
          ) : (
            <p className="text-xs text-[#e5e4e2]/45">Progi zmienia administrator.</p>
          )}
        </form>
      )}
      {!value && error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    </div>
  );
}
