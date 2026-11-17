'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, History, Loader2, Lock, Unlock, RefreshCw, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useInvoiceFinanceAccess } from '@/hooks/useInvoiceFinanceAccess';
import { canFinanceCompany, filterFinanceCompanies } from '@/lib/invoices/financeAccess';

/**
 * Zamknięcie miesiąca (sekcja „Dla księgowej”): po przekazaniu miesiąca księgowej zamyka się go, żeby wyciągi,
 * dopasowania i faktury z tego miesiąca nie zmieniały się bez śladu. Ponowne otwarcie wymaga uzasadnienia i zostaje
 * w historii. Dane: get_finance_periods, lock_finance_period, unlock_finance_period
 * (migracja 20261117132000_finance_period_close.sql) — blokadę pilnuje baza, także dla Maca i telefonu.
 */

const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const card = 'rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]';
const input = 'rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2.5 py-1.5 text-xs text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50';
const ghost = 'inline-flex items-center gap-1 rounded-lg border border-[#d3bb73]/25 px-2.5 py-1 text-[11px] text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50';
const textareaClass = 'mt-1 block w-full rounded-lg border border-[#d3bb73]/10 bg-black/20 px-3 py-2 text-[#e5e4e2]';

const dateTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '';

interface Reopening {
  unlocked_at: string;
  reason: string | null;
  by_name: string | null;
}

interface PeriodState {
  month: number;
  locked: boolean;
  locked_at: string | null;
  locked_by_name: string | null;
  lock_note: string | null;
  handed_over_at: string | null;
  reopenings: Reopening[];
}

interface Company { id: string; name: string }

export default function FinancePeriodClosePanel({ filterCompanyIds = null }: { filterCompanyIds?: string[] | null }) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { access } = useInvoiceFinanceAccess();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [year, setYear] = useState(currentMonth === 1 ? currentYear - 1 : currentYear);
  const [periods, setPeriods] = useState<PeriodState[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyMonth, setBusyMonth] = useState<number | null>(null);

  const canManage = canFinanceCompany(access, companyId, 'finance_manage');
  const companyKey = filterCompanyIds === null ? '*' : [...filterCompanyIds].sort().join(',');
  const years = [currentYear, currentYear - 1, currentYear - 2];

  useEffect(() => {
    let cancelled = false;
    if (!access) return () => { cancelled = true; };
    (async () => {
      let query = supabase.from('my_companies').select('id,name').eq('is_active', true).order('name');
      if (filterCompanyIds) query = query.in('id', filterCompanyIds.length ? filterCompanyIds : ['00000000-0000-0000-0000-000000000000']);
      const { data: rows, error } = await query;
      if (cancelled) return;
      if (error) { showSnackbar('Nie udało się wczytać firm.', 'error'); setLoading(false); return; }
      const list = filterFinanceCompanies(access, (rows || []) as Company[], 'finance_view');
      setCompanies(list);
      setCompanyId((current) => (current && list.some((c) => c.id === current) ? current : list[0]?.id || ''));
      if (list.length === 0) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey, access]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('get_finance_periods', { p_company_id: companyId, p_year: year });
    if (error) {
      showSnackbar(error.message || 'Nie udało się wczytać zamknięć miesięcy.', 'error');
      setPeriods([]);
    } else {
      setPeriods((data || []) as PeriodState[]);
    }
    setLoading(false);
  }, [companyId, year, showSnackbar]);

  useEffect(() => { void load(); }, [load]);

  const lockMonth = async (period: PeriodState) => {
    if (!canManage || busyMonth !== null) return;
    let note = '';
    const label = `${MONTHS[period.month - 1].toLowerCase()} ${year}`;
    const confirmed = await showConfirm({
      title: `Zamknięcie: ${label}`,
      confirmText: 'Zamknij miesiąc',
      message: (
        <div className="space-y-3 text-left text-sm">
          <p>Po zamknięciu w tym miesiącu nie da się:</p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-[#e5e4e2]/70">
            <li>wczytać ani usunąć wyciągu, wyjaśniać operacji, przypinać i odpinać dokumentów, przypisywać przelewów do ZUS i podatków,</li>
            <li>wystawić, usunąć ani anulować faktury z datą w tym miesiącu, zmienić jej numeru, dat, kwot, nabywcy i pozycji,</li>
            <li>usunąć ani zmienić kwot i dat dokumentów spoza KSeF.</li>
          </ul>
          <p className="text-xs text-[#e5e4e2]/60">
            Zapłaty faktur, wysyłka do KSeF i e-maile działają dalej. Szkice i pro formy nie są blokowane.
            {!period.handed_over_at && ' Ten miesiąc nie był jeszcze przekazany księgowej z CRM.'}
          </p>
          <label className="block text-sm">
            Notatka (opcjonalnie)
            <textarea rows={2} maxLength={500} className={textareaClass} onChange={(event) => { note = event.target.value; }} />
          </label>
        </div>
      ),
    });
    if (!confirmed) return;
    setBusyMonth(period.month);
    const { error } = await supabase.rpc('lock_finance_period', {
      p_company_id: companyId, p_year: year, p_month: period.month, p_note: note.trim() || null,
    });
    setBusyMonth(null);
    if (error) { showSnackbar(error.message || 'Nie udało się zamknąć miesiąca.', 'error'); return; }
    showSnackbar(`Miesiąc ${label} zamknięty.`, 'success');
    await load();
  };

  const unlockMonth = async (period: PeriodState) => {
    if (!canManage || busyMonth !== null) return;
    let reason = '';
    const label = `${MONTHS[period.month - 1].toLowerCase()} ${year}`;
    const confirmed = await showConfirm({
      title: `Ponowne otwarcie: ${label}`,
      confirmText: 'Otwórz miesiąc',
      message: (
        <div className="space-y-3 text-left text-sm">
          <p className="text-xs text-[#e5e4e2]/70">
            Uzasadnienie zostaje w historii miesiąca (kto, kiedy, dlaczego). Po zmianach przekaż miesiąc księgowej ponownie
            i zamknij go.
          </p>
          <label className="block text-sm">
            Uzasadnienie
            <textarea required rows={3} maxLength={500} className={textareaClass} onChange={(event) => { reason = event.target.value; }} />
          </label>
        </div>
      ),
      validate: () => {
        if (reason.trim().length < 10) {
          showSnackbar('Podaj uzasadnienie ponownego otwarcia (co najmniej 10 znaków).', 'warning');
          return false;
        }
        return true;
      },
    });
    if (!confirmed) return;
    setBusyMonth(period.month);
    const { error } = await supabase.rpc('unlock_finance_period', {
      p_company_id: companyId, p_year: year, p_month: period.month, p_reason: reason.trim(),
    });
    setBusyMonth(null);
    if (error) { showSnackbar(error.message || 'Nie udało się otworzyć miesiąca.', 'error'); return; }
    showSnackbar(`Miesiąc ${label} otwarty ponownie.`, 'success');
    await load();
  };

  if (!loading && companies.length === 0) return null;

  return (
    <section className={card}>
      <header className="flex flex-wrap items-center gap-3 border-b border-[#d3bb73]/10 px-4 py-3">
        <Lock className="h-4 w-4 text-[#d3bb73]" />
        <div className="mr-auto">
          <h3 className="text-sm font-medium text-[#e5e4e2]">Zamknięcie miesięcy</h3>
          <p className="text-[11px] text-[#e5e4e2]/50">
            Po przekazaniu księgowej zamknij miesiąc — wyciągi, dopasowania i faktury z tego miesiąca nie zmienią się bez śladu.
          </p>
        </div>
        {companies.length > 1 && (
          <select className={input} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <select className={input} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button type="button" className={ghost} onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Odśwież
        </button>
      </header>

      {loading && periods.length === 0 ? (
        <div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-[#d3bb73]" /></div>
      ) : (
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {periods.map((period) => {
            const future = year > currentYear || (year === currentYear && period.month > currentMonth);
            const handedOverOpen = !period.locked && Boolean(period.handed_over_at);
            return (
              <div
                key={period.month}
                className={`rounded-lg border p-3 text-xs ${
                  period.locked
                    ? 'border-emerald-500/25 bg-emerald-500/[0.06]'
                    : handedOverOpen
                      ? 'border-amber-500/30 bg-amber-500/[0.06]'
                      : 'border-white/[0.07] bg-[#0f1119]'
                } ${future ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span className="mr-auto text-sm text-[#e5e4e2]">{MONTHS[period.month - 1]}</span>
                  {period.locked ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                      <Lock className="h-3 w-3" />Zamknięty
                    </span>
                  ) : handedOverOpen ? (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">Przekazany · otwarty</span>
                  ) : (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-[#e5e4e2]/55">{future ? 'Przyszły' : 'Otwarty'}</span>
                  )}
                </div>
                <div className="mt-2 space-y-1 text-[11px] text-[#e5e4e2]/55">
                  {period.handed_over_at && (
                    <div className="flex items-center gap-1"><Send className="h-3 w-3" />Przekazany księgowej {dateTime(period.handed_over_at)}</div>
                  )}
                  {period.locked && (
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-emerald-300/80" />
                      Zamknięty {dateTime(period.locked_at)}{period.locked_by_name ? ` · ${period.locked_by_name}` : ''}
                    </div>
                  )}
                  {period.lock_note && <div className="text-[#e5e4e2]/70">„{period.lock_note}”</div>}
                  {period.reopenings.length > 0 && (
                    <details>
                      <summary className="flex cursor-pointer items-center gap-1 text-[#e5e4e2]/60">
                        <History className="h-3 w-3" />Otwierany ponownie: {period.reopenings.length}×
                      </summary>
                      <ul className="mt-1 space-y-1 pl-4">
                        {period.reopenings.map((item) => (
                          <li key={item.unlocked_at}>
                            {dateTime(item.unlocked_at)}{item.by_name ? ` · ${item.by_name}` : ''} — {item.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                {canManage && !future && (
                  <div className="mt-2">
                    {period.locked ? (
                      <button type="button" className={ghost} disabled={busyMonth !== null} onClick={() => void unlockMonth(period)}>
                        {busyMonth === period.month ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlock className="h-3 w-3" />}
                        Otwórz ponownie
                      </button>
                    ) : (
                      <button type="button" className={ghost} disabled={busyMonth !== null} onClick={() => void lockMonth(period)}>
                        {busyMonth === period.month ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />}
                        Zamknij miesiąc
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="border-t border-[#d3bb73]/10 px-4 py-2 text-[10px] text-[#e5e4e2]/45">
        Zamyka i otwiera osoba z „Zarządzaniem finansami” działalności. Blokadę sprawdza baza — obowiązuje w CRM, na Macu
        i w telefonie. Miesiąc wyciągu decyduje o operacjach bankowych, data wystawienia — o fakturach.
      </p>
    </section>
  );
}
