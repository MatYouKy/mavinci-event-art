'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { supabase } from '@/lib/supabase/browser';
import { loadCompensationSettings } from '@/lib/personnel/compensationData';
import { compensationSettingLabels, type CompensationSettings } from '@/lib/personnel/compensation';
export default function CompensationSettingsPage() {
  const { isAdmin, loading } = useCurrentEmployee();
  const [value, setValue] = useState<CompensationSettings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let live = true;
    if (isAdmin)
      loadCompensationSettings()
        .then((data) => {
          if (live) setValue(data);
        })
        .catch(() => {
          if (live) setError('Nie udało się pobrać parametrów.');
        });
    return () => {
      live = false;
    };
  }, [isAdmin]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value || busy) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const { data, error } = await supabase
        .from('compensation_settings')
        .update({ ...value, updated_at: new Date().toISOString() })
        .eq('id', 1)
        .eq('updated_at', value.updated_at!)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Ustawienia zmieniły się. Odśwież stronę przed zapisem.');
      setValue(data);
      setSaved(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <p>Ładowanie…</p>;
  if (!isAdmin) return <p>Dostęp tylko dla administratora.</p>;
  return (
    <main className="mx-auto max-w-4xl p-4 text-[#e5e4e2] sm:p-6">
      <Link href="/crm/settings?tab=admin" className="text-[#d3bb73]">
        ← Administracja
      </Link>
      <h1 className="my-5 text-xl uppercase">Wynagrodzenia i koszty pracy</h1>
      <p className="mb-5 text-sm text-white/65">
        Wspólne parametry symulacji kosztów. Stawki poszczególnych osób zapisujesz na profilach
        pracowników. Zmiany parametrów wpływają na nowe porównania, nie przeliczają historii wypłat.
      </p>
      {error && (
        <p role="alert" className="mb-4 text-red-300">
          {error}
        </p>
      )}
      {value && (
        <form onSubmit={save}>
          <fieldset
            disabled={busy}
            className="grid gap-4 rounded-xl bg-[#351020] p-4 sm:grid-cols-2"
          >
            {Object.entries(compensationSettingLabels).map(([key, label]) => (
              <label key={key} className="text-sm">
                {label}
                <input
                  required
                  type="number"
                  min={key === 'reference_hours' ? 1 : 0}
                  max={key === 'reference_hours' ? 744 : key.endsWith('_rate') ? 50 : 10000}
                  step="0.01"
                  value={value[key as keyof typeof compensationSettingLabels]}
                  onChange={(e) => {
                    setSaved(false);
                    setValue({ ...value, [key]: Number(e.target.value) });
                  }}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-[#250914] px-3 py-2"
                />
              </label>
            ))}
            <button className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#250914]">
              {busy ? 'Zapisywanie…' : 'Zapisz wspólne parametry'}
            </button>
          </fieldset>
        </form>
      )}
      {saved && (
        <p role="status" className="mt-3 text-[#d3bb73]">
          Parametry zapisane.
        </p>
      )}
      <p className="mt-5 text-sm text-white/60">
        Założenia startowe: standardowy dorosły pracownik, brak PPK i ulg, zlecenie bez dobrowolnego
        chorobowego, przykładowa stopa wypadkowa 1,67% w łącznym narzucie pracodawcy. Potwierdź
        właściwy CIT, składki, PIT i odliczenie z księgowością. Symulacja nie ustala uprawnienia do
        stawki 9% ani nie obsługuje estońskiego CIT.
      </p>
      <p className="mt-3 text-sm text-[#d3bb73]">
        Źródła:{' '}
        <a
          href="https://www.podatki.gov.pl/cit/stawki-podatkowe/?altTemplate=ArticlePdf&download=True"
          target="_blank"
          rel="noreferrer"
        >
          CIT i dywidendy (MF)
        </a>{' '}
        ·{' '}
        <a
          href="https://www.zus.pl/en/pracujacy/system-ubezpieczen-spolecznych-w-polsce/finansowanie-skladek-na-ubezpieczenia-spoleczne"
          target="_blank"
          rel="noreferrer"
        >
          Składki (ZUS)
        </a>{' '}
        ·{' '}
        <a
          href="https://www.podatki.gov.pl/podatki-osobiste/pit/informacje-podstawowe/co-jest-opodatkowane/dochody-z-pracy"
          target="_blank"
          rel="noreferrer"
        >
          PIT (MF)
        </a>
      </p>
    </main>
  );
}
