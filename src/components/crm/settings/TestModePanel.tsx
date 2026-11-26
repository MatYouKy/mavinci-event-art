'use client';

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, FlaskConical, History, Loader2, LogIn, RefreshCw, Search, ShieldCheck, Store, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { DEPARTMENTS, department } from '@/lib/CRM/meetings/teamAvailability';
import { TEST_MODE_MAX_HOURS, setTestModeNavigation } from '@/lib/testMode/shared';

/*
 * Ustawienia → „Tryb testowy” (tylko administrator, `docs/test-mode.md`): wybór pracownika albo sprzedawcy zewnętrznego
 * i wejście w jego widok CRM / portalu (`/bridge/test-mode/start`). Lista osób i dziennik wejść — `test_mode_targets`,
 * `test_mode_history` (baza sprawdza, że to administrator).
 */

type EmployeeTarget = {
  kind: 'employee';
  id: string;
  name: string | null;
  nickname: string | null;
  avatar_url: string | null;
  occupation: string | null;
  department: string | null;
  role: string | null;
  access_level: string | null;
  permissions: number;
};
type SellerTarget = { kind: 'seller'; id: string; name: string; organization: string | null; partner_type: string | null; status: string | null };
type HistoryRow = {
  id: string;
  admin: string | null;
  kind: 'employee' | 'seller';
  target: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  active: boolean;
};

const END_REASONS: Record<string, string> = {
  exit: 'Wyjście z trybu',
  expired: 'Wygasła',
  replaced: 'Zastąpiona nowym wejściem',
  rollback_unconfirmed: 'Przerwana (baza nie potwierdziła wycofania zapisu)',
};

const when = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

const folded = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();
const matches = (query: string, ...fields: Array<string | null | undefined>) => {
  const words = folded(query).split(/\s+/).filter(Boolean);
  const haystack = folded(fields.filter(Boolean).join(' '));
  return words.every((word) => haystack.includes(word));
};

const initials = (name: string | null) =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

export default function TestModePanel() {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const [employees, setEmployees] = useState<EmployeeTarget[]>([]);
  const [sellers, setSellers] = useState<SellerTarget[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'employee' | 'seller'>('employee');
  const [query, setQuery] = useState('');
  const [starting, setStarting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [targets, log] = await Promise.all([
      supabase.rpc('test_mode_targets'),
      supabase.rpc('test_mode_history', { p_limit: 20 }),
    ]);
    if (targets.error) {
      setError(/test_mode_targets/.test(targets.error.message)
        ? 'Tryb testowy nie jest jeszcze włączony w bazie (migracja 20261202100000_crm_test_mode.sql).'
        : targets.error.message || 'Nie udało się pobrać listy osób.');
    } else {
      const data = (targets.data || {}) as { employees?: EmployeeTarget[]; sellers?: SellerTarget[] };
      setEmployees(data.employees || []);
      setSellers(data.sellers || []);
    }
    setHistory(log.error ? [] : ((log.data || []) as HistoryRow[]));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const start = async (kind: 'employee' | 'seller', id: string, name: string) => {
    if (starting) return;
    setStarting(id);
    showLoader('Otwieram widok testowy', name);
    // Ta karta przechodzi do widoku osoby sama — bez automatycznego przeładowania po zmianie ciasteczka.
    setTestModeNavigation(true);
    try {
      const response = await fetch('/bridge/test-mode/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id }),
      });
      const body = (await response.json().catch(() => null)) as { landing?: string; error?: string } | null;
      if (!response.ok || !body?.landing) throw new Error(body?.error || 'Nie udało się włączyć trybu testowego.');
      // Pełne przeładowanie — klient Supabase w przeglądarce przełącza się na sesję oglądanej osoby.
      window.location.assign(body.landing === '/seller' ? '/seller' : '/crm');
    } catch (failure) {
      setTestModeNavigation(false);
      hideLoader();
      setStarting(null);
      showSnackbar(failure instanceof Error ? failure.message : 'Nie udało się włączyć trybu testowego.', 'error');
    }
  };

  const employeeGroups = useMemo(() => {
    const visible = employees.filter((person) =>
      matches(query, person.name, person.nickname, person.occupation, person.access_level, person.role));
    return DEPARTMENTS.map((option) => ({
      ...option,
      people: visible.filter((person) => department(person.department) === option.value),
    })).filter((group) => group.people.length > 0);
  }, [employees, query]);

  const visibleSellers = useMemo(
    () => sellers.filter((seller) => matches(query, seller.name, seller.organization, seller.partner_type)),
    [query, sellers],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-300/25 bg-[#1c1f33] p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-300/10">
            <FlaskConical className="h-5 w-5 text-amber-300" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <h3 className="text-lg font-light uppercase tracking-wide text-[#e5e4e2]">Tryb testowy — widok jako</h3>
            <p className="text-sm text-[#e5e4e2]/70">
              Wejdź w CRM (albo portal sprzedawcy) oczami wybranej osoby i sprawdź, co widzi, jakie ma funkcje i czy działają — czy nie
              ma za dużych albo za małych uprawnień.
            </p>
            <ul className="grid gap-x-6 gap-y-1 text-sm text-[#e5e4e2]/60 lg:grid-cols-2">
              <li>• Widzisz dokładnie to, co ta osoba: menu, zakładki, przyciski i dane (te same uprawnienia bazy).</li>
              <li>• Zapis wykonuje się jako ta osoba i jest od razu wycofywany — sprawdzisz, czy się uda, ale nic nie zostaje i nikt tego nie zobaczy.</li>
              <li>• Wysyłka e-maili, pliki, KSeF, dokumenty zapisywane na serwerze i funkcje serwera są wyłączone (komunikat w miejscu akcji).</li>
              <li>• Na środku u góry jest pasek „Wyjdź z trybu” — po wyjściu wraca Twoja sesja. Tryb kończy się sam po {TEST_MODE_MAX_HOURS} godzinach.</li>
              <li>• Osoba nie dostaje e-maila ani powiadomienia; każde wejście zapisuje się w dzienniku poniżej.</li>
              <li>• Aplikacje na Maca i telefon — bez zmian (tryb działa w przeglądarce).</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-white/10 p-0.5" role="tablist" aria-label="Rodzaj osoby">
            {([['employee', `Pracownicy (${employees.length})`, Users], ['seller', `Sprzedawcy zewnętrzni (${sellers.length})`, Store]] as const).map(([value, label, Icon]) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${tab === value ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/70 hover:bg-white/5'}`}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </div>
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" aria-hidden />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj osoby, stanowiska, poziomu dostępu…"
              className="w-full rounded-lg border border-white/10 bg-[#0f1119] py-2 pl-9 pr-3 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73]/60 focus:outline-none" />
          </div>
          <button type="button" onClick={() => void load()} disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73] hover:bg-white/10 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Odśwież
          </button>
        </div>

        {error && <p role="alert" className="mb-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}

        {loading && !employees.length && !sellers.length ? (
          <p className="p-6 text-center text-sm text-[#e5e4e2]/60">Wczytywanie…</p>
        ) : tab === 'employee' ? (
          employeeGroups.length === 0 ? (
            <p className="p-6 text-center text-sm text-[#e5e4e2]/60">Brak pracowników do wyboru (bez administratorów i osób bez konta logowania).</p>
          ) : (
            <div className="space-y-6">
              {employeeGroups.map((group) => (
                <div key={group.value}>
                  <p className="mb-2 text-xs uppercase tracking-wide text-[#d3bb73]/80">{group.label}</p>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {group.people.map((person) => (
                      <div key={person.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#0f1119]/60 p-3">
                        {person.avatar_url
                          ? <img src={person.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" loading="lazy" />
                          : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/15 text-sm text-[#d3bb73]">{initials(person.name)}</span>}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-[#e5e4e2]">{person.name || 'Pracownik'}</p>
                          <p className="truncate text-xs text-[#e5e4e2]/55">
                            {[person.occupation, person.access_level, `uprawnienia: ${person.permissions}`].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <button type="button" onClick={() => void start('employee', person.id, person.name || 'Pracownik')} disabled={Boolean(starting)}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-xs font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50">
                          {starting === person.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}Wejdź jako
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : visibleSellers.length === 0 ? (
          <p className="p-6 text-center text-sm text-[#e5e4e2]/60">Brak sprzedawców zewnętrznych z włączonym portalem.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visibleSellers.map((seller) => (
              <div key={seller.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#0f1119]/60 p-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/15 text-[#d3bb73]">
                  <Building2 className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[#e5e4e2]">{seller.name}</p>
                  <p className="truncate text-xs text-[#e5e4e2]/55">{[seller.organization, seller.partner_type].filter(Boolean).join(' · ') || 'Portal sprzedawcy'}</p>
                </div>
                <button type="button" onClick={() => void start('seller', seller.id, seller.name)} disabled={Boolean(starting)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-xs font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50">
                  {starting === seller.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}Wejdź jako
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="mb-4 flex items-center gap-2">
          <History className="h-4 w-4 text-[#d3bb73]" />
          <h3 className="text-lg font-light uppercase tracking-wide text-[#e5e4e2]">Dziennik wejść</h3>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-[#e5e4e2]/60">Nikt jeszcze nie korzystał z trybu testowego.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-[#e5e4e2]/50">
                <tr>
                  <th className="py-2 pr-3 font-normal">Początek</th>
                  <th className="py-2 pr-3 font-normal">Administrator</th>
                  <th className="py-2 pr-3 font-normal">Widok jako</th>
                  <th className="py-2 font-normal">Zakończenie</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} className="border-t border-white/5">
                    <td className="py-2 pr-3 text-[#e5e4e2]/80">{when(row.started_at)}</td>
                    <td className="py-2 pr-3 text-[#e5e4e2]/80">{row.admin || '—'}</td>
                    <td className="py-2 pr-3 text-[#e5e4e2]">{row.target}</td>
                    <td className="py-2 text-[#e5e4e2]/70">
                      {row.active ? (
                        <span className="inline-flex items-center gap-1 text-amber-200"><ShieldCheck className="h-3.5 w-3.5" />W toku</span>
                      ) : (
                        `${when(row.ended_at)}${row.end_reason ? ` · ${END_REASONS[row.end_reason] || row.end_reason}` : ''}`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
