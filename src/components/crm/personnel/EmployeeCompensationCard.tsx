'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import {
  loadCompensationSettings,
  loadEmployeeCompensation,
} from '@/lib/personnel/compensationData';
import {
  compensationComparison,
  emptyCompensation,
  type EmployeeCompensation,
  type CompensationSettings,
} from '@/lib/personnel/compensation';
const input = 'mt-1 w-full rounded-lg border border-white/10 bg-[#250914] px-3 py-2 text-sm';
const fmt = (n: number) => n.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
export default function EmployeeCompensationCard({ employeeId }: { employeeId: string }) {
  const { isAdmin, canManageModule, canViewModule } = useCurrentEmployee();
  const canEdit = isAdmin || canManageModule('employees') || canManageModule('finances');
  const canView = canEdit || canViewModule('finances');
  const [settings, setSettings] = useState<CompensationSettings | null>(null);
  const [profile, setProfile] = useState<EmployeeCompensation | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [hours, setHours] = useState(160);
  const [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setProfile(null);
    setSettings(null);
    setError('');
    setSaved(false);
    if (canView)
      Promise.all([loadCompensationSettings(), loadEmployeeCompensation(employeeId)])
        .then(([s, p]) => {
          if (live) {
            setSettings(s);
            setProfile(p || emptyCompensation(employeeId));
            setOriginal(p?.updated_at || null);
            setHours(s.reference_hours);
          }
        })
        .catch(() => {
          if (live) setError('Nie udało się pobrać ustawień wynagrodzeń.');
        });
    return () => {
      live = false;
    };
  }, [employeeId, canView]);
  if (!canView) return null;
  const change = (patch: Partial<EmployeeCompensation>) => {
    setProfile((p) => (p ? { ...p, ...patch } : p));
    setSaved(false);
  };
  let comparison: ReturnType<typeof compensationComparison> = null;
  if (profile && settings && hours > 0) {
    try {
      comparison = compensationComparison(profile, settings, hours);
    } catch {}
  }
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || busy) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const { data, error } = await supabase.rpc('save_employee_compensation', {
        p_employee_id: employeeId,
        p_profile: profile,
        p_expected_updated_at: original,
      });
      if (error) throw error;
      setProfile(data);
      setOriginal(data.updated_at);
      setSaved(true);
    } catch (e: any) {
      setError(e.message || 'Nie udało się zapisać');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-xl bg-[#351020] p-4 text-[#e5e4e2] sm:p-6 lg:col-span-2">
      <h2 className="mb-4 text-lg uppercase">Wynagrodzenie i koszt pracy</h2>
      {error && (
        <p role="alert" className="mb-3 text-red-300">
          {error}
        </p>
      )}
      {!profile || !settings ? (
        <p>Ładowanie ustawień…</p>
      ) : (
        <>
          <form onSubmit={save}>
            <fieldset
              disabled={!canEdit || busy}
              className="grid gap-4 disabled:opacity-70 sm:grid-cols-2 lg:grid-cols-3"
            >
              <label className="text-sm">
                Sposób naliczania
                <select
                  className={input}
                  value={profile.pay_basis}
                  onChange={(e) => change({ pay_basis: e.target.value as any })}
                >
                  <option value="hourly">Według godzin</option>
                  <option value="monthly">Stała kwota miesięczna</option>
                </select>
              </label>
              <label className="text-sm">
                {profile.pay_basis === 'hourly'
                  ? 'Stawka za godzinę (zł)'
                  : 'Wynagrodzenie miesięczne (zł)'}
                <input
                  required
                  type="number"
                  min="0"
                  max="10000000"
                  step="0.01"
                  className={input}
                  value={
                    profile.pay_basis === 'hourly' ? profile.hourly_rate : profile.monthly_salary
                  }
                  onChange={(e) =>
                    change(
                      profile.pay_basis === 'hourly'
                        ? { hourly_rate: Number(e.target.value) }
                        : { monthly_salary: Number(e.target.value) },
                    )
                  }
                />
              </label>
              <label className="text-sm">
                Podana kwota
                <select
                  className={input}
                  value={profile.rate_basis}
                  onChange={(e) => change({ rate_basis: e.target.value as any })}
                >
                  <option value="net">Netto — do wypłaty</option>
                  <option value="gross">Brutto — przed potrąceniami</option>
                </select>
              </label>
              <label className="text-sm">
                Podstawa współpracy
                <select
                  className={input}
                  value={profile.contract_kind}
                  onChange={(e) => change({ contract_kind: e.target.value as any })}
                >
                  <option value="employment">Umowa o pracę</option>
                  <option value="mandate">Umowa zlecenie</option>
                  <option value="other">Inna — ustalenia indywidualne</option>
                </select>
              </label>
              <label className="text-sm">
                Sposób wypłaty
                <select
                  className={input}
                  value={profile.payment_method}
                  onChange={(e) => change({ payment_method: e.target.value as any })}
                >
                  <option value="bank">Przelew</option>
                  <option value="cash">Gotówka</option>
                </select>
              </label>
              <label className="text-sm">
                Źródło finansowania w symulacji
                <select
                  className={input}
                  value={profile.funding_source}
                  onChange={(e) => change({ funding_source: e.target.value as any })}
                >
                  <option value="company">Środki firmowe</option>
                  <option value="dividend">Zysk po CIT i dywidendzie</option>
                </select>
              </label>
              {canEdit && (
                <button type="submit" className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#250914]">
                  {busy ? 'Zapisywanie…' : 'Zapisz warunki wynagrodzenia'}
                </button>
              )}
            </fieldset>
          </form>
          {saved && (
            <p role="status" className="mt-3 text-[#d3bb73]">
              Warunki zapisane. Historyczne stawki pozostają bez zmian.
            </p>
          )}
          <div className="mt-6 border-t border-white/5 pt-4">
            <h3 className="font-medium">Porównanie dla tej samej kwoty netto</h3>
            <label className="mt-3 block max-w-xs text-sm">
              Godziny w miesiącu porównawczym
              <input
                className={input}
                type="number"
                min="1"
                max="744"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              />
            </label>
            {comparison ? (
              <>
                <p className="my-3 text-sm">
                  Do wypłaty: <strong>{fmt(comparison.net)}</strong> / miesiąc (
                  {fmt(comparison.net / hours)} / h)
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-white/60">
                        <th className="py-2">Wariant</th>
                        <th>Brutto</th>
                        <th>Koszt / miesiąc</th>
                        <th>Koszt / h</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ['Umowa o pracę', comparison.employment],
                          ['Umowa zlecenie', comparison.mandate],
                        ] as const
                      ).map(([name, row]) => (
                        <tr key={name} className="border-t border-white/5">
                          <td className="py-3">{name}</td>
                          <td>{fmt(row.gross)}</td>
                          <td>{fmt(row.companyCost)}</td>
                          <td>{fmt(row.companyCost / hours)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {profile.funding_source === 'dividend' && (
                  <div className="mt-4 rounded-lg bg-white/5 p-3 text-sm">
                    <p>
                      Zysk przed CIT potrzebny do wypłaty tej kwoty przez dywidendę:{' '}
                      <strong>{fmt(comparison.dividend)}</strong> (
                      {fmt(comparison.dividend / hours)} / h).
                    </p>
                    <p className="mt-1 text-white/60">
                      Mnożnik:{' '}
                      {(comparison.net
                        ? comparison.dividend / comparison.net
                        : 1 / ((1 - settings.cit_rate / 100) * (1 - settings.dividend_rate / 100))
                      ).toFixed(3)}
                      . CIT {settings.cit_rate}%, dywidenda {settings.dividend_rate}%. To
                      zapotrzebowanie na zysk, a nie koszt płacowy spółki.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm text-amber-200">
                Podaj liczbę godzin. Dla innej podstawy współpracy porównanie wymaga kwoty netto.
              </p>
            )}
            <p className="mt-4 text-xs leading-relaxed text-white/55">
              Symulacja standardowego miesiąca: pełne składki, bez PPK i ulg (np. student / osoba do
              26 lat), bez zbiegu tytułów i rocznego limitu ZUS. PIT {settings.pit_rate}%,
              miesięczne odliczenie {settings.monthly_tax_credit} zł. Zlecenie: składki społeczne{' '}
              {settings.mandate_social_rate}%. Nie uwzględnia urlopu, absencji ani kosztów
              pośrednich. Wynik nie zastępuje listy płac; CIT klasyczny, bez modelu estońskiego.
              Gotówka i przelew mają te same obowiązki płacowe. Wyświetlane porównanie uwzględnia
              także niezapisane zmiany formularza.
            </p>
            {isAdmin && (
              <Link
                href="/crm/settings/compensation"
                className="mt-3 inline-block text-sm text-[#d3bb73]"
              >
                Administracja: wspólne parametry kosztów →
              </Link>
            )}
            <div className="mt-3 flex gap-4 text-sm text-[#d3bb73]">
              <Link href={`/crm/time-tracking/${employeeId}`}>Ewidencja godzin →</Link>
              <Link href="/crm/invoices?tab=external&section=contracts">Umowy i zarejestrowane wypłaty →</Link>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
