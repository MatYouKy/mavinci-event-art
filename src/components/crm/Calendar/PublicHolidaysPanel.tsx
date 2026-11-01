'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { invalidateHolidayCache } from '@/hooks/usePublicHolidays';
import {
  fetchPublicHolidays,
  holidayDateLabel,
  indexHolidays,
  isoWeekday,
  workingTimeNorm,
  type PublicHoliday,
} from '@/lib/CRM/calendar/publicHolidays';

const WEEKDAYS = ['', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.', 'niedz.'];
const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];

interface SyncRun { year: number; status: string; message: string | null; requested_at: string; finished_at: string | null }

/** Dni ustawowo wolne w roku, wymiar czasu pracy w miesiącach i stan aktualizacji ze źródła zewnętrznego. */
export default function PublicHolidaysPanel({ initialYear, onClose }: { initialYear: number; onClose: () => void }) {
  const { showSnackbar } = useSnackbar();
  const { isAdmin } = useCurrentEmployee();
  const [year, setYear] = useState(initialYear);
  const [list, setList] = useState<PublicHoliday[]>([]);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [holidays, sync] = await Promise.all([
        fetchPublicHolidays(supabase, `${year}-01-01`, `${year}-12-31`),
        supabase.from('public_holiday_sync_runs').select('year,status,message,requested_at,finished_at').eq('year', year)
          .order('requested_at', { ascending: false }).limit(3),
      ]);
      setList(holidays);
      setRuns((sync.data || []) as SyncRun[]);
    } catch {
      showSnackbar('Nie udało się wczytać dni wolnych.', 'error');
    }
    setLoading(false);
  }, [year, showSnackbar]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    const { error } = await supabase.rpc('request_public_holiday_refresh', { p_years: [year] });
    setRefreshing(false);
    if (error) { showSnackbar(error.message || 'Nie udało się zlecić aktualizacji.', 'error'); return; }
    invalidateHolidayCache();
    showSnackbar('Lista z ustawy odświeżona. Porównanie ze źródłem zewnętrznym pojawi się w ciągu kilku minut.', 'success');
    await load();
  };

  const addManual = async () => {
    if (!newDate || !newName.trim()) { showSnackbar('Podaj datę i nazwę.', 'warning'); return; }
    const { error } = await supabase.rpc('save_public_holiday', { p_date: newDate, p_name: newName.trim() });
    if (error) { showSnackbar(error.message || 'Nie udało się zapisać dnia wolnego.', 'error'); return; }
    setNewDate(''); setNewName('');
    invalidateHolidayCache();
    await load();
  };

  const removeManual = async (date: string) => {
    const { error } = await supabase.rpc('delete_manual_public_holiday', { p_date: date });
    if (error) { showSnackbar(error.message || 'Nie udało się usunąć dnia wolnego.', 'error'); return; }
    invalidateHolidayCache();
    await load();
  };

  const index = indexHolidays(list);
  const lastRun = runs[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-5 py-4">
          <h3 className="flex items-center gap-2 text-lg font-light text-[#e5e4e2]"><CalendarDays className="h-5 w-5 text-[#d3bb73]" /> Dni ustawowo wolne i wymiar czasu pracy</h3>
          <div className="flex items-center gap-2">
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2.5 py-1.5 text-xs text-[#e5e4e2]">
              {Array.from({ length: 5 }, (_, i) => initialYear - 1 + i).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button type="button" onClick={onClose} className="text-[#e5e4e2]/50 hover:text-[#e5e4e2]" aria-label="Zamknij"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="rounded-lg bg-[#0f1119] px-3 py-2.5 text-xs leading-5 text-[#e5e4e2]/60">
            Lista wynika z ustawy o dniach wolnych od pracy i co tydzień jest porównywana ze źródłem zewnętrznym (Nager.Date).
            Gdy przepisy się zmienią, nowy dzień pojawi się tu automatycznie. Wymiar czasu: 8 h × dni od poniedziałku do piątku,
            minus 8 h za każde święto przypadające w inny dzień niż niedziela (art. 130 Kodeksu pracy).
            {lastRun && (
              <span className={`mt-1 block ${lastRun.status === 'error' ? 'text-red-300' : lastRun.message?.startsWith('Zgodne') ? 'text-green-400' : 'text-amber-300'}`}>
                Ostatnie sprawdzenie: {new Date(lastRun.finished_at || lastRun.requested_at).toLocaleString('pl-PL')} —{' '}
                {lastRun.status === 'requested' ? 'czeka na odpowiedź źródła' : lastRun.message || lastRun.status}
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-[#e5e4e2]/50"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Wczytywanie…</div>
          ) : (
            <>
              <section>
                <h4 className="text-sm font-medium text-[#e5e4e2]">Święta w {year} r.</h4>
                <ul className="mt-2 divide-y divide-[#d3bb73]/10 rounded-lg border border-[#d3bb73]/10">
                  {list.map((h) => (
                    <li key={h.date} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                      <span className="w-28 text-[#e5e4e2]">{holidayDateLabel(h)}</span>
                      <span className="w-12 text-[#e5e4e2]/50">{WEEKDAYS[isoWeekday(h.date)]}</span>
                      <span className="min-w-0 flex-1 text-[#e5e4e2]/85">{h.name}</span>
                      {isoWeekday(h.date) === 6 && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">sobota — dzień wolny w zamian</span>}
                      {h.source === 'external' && <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-200">dopisane ze źródła zewnętrznego</span>}
                      {h.source === 'manual' && <span className="rounded bg-[#d3bb73]/10 px-1.5 py-0.5 text-[10px] text-[#d3bb73]">dodane ręcznie</span>}
                      {h.external_confirmed === false && h.source !== 'manual' && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">źródło zewnętrzne nie potwierdza</span>}
                      {h.source === 'manual' && isAdmin && (
                        <button type="button" onClick={() => void removeManual(h.date)} className="text-[#e5e4e2]/40 hover:text-red-300" aria-label="Usuń"><Trash2 className="h-3.5 w-3.5" /></button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h4 className="text-sm font-medium text-[#e5e4e2]">Wymiar czasu pracy (pełny etat)</h4>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {MONTHS.map((label, i) => {
                    const norm = workingTimeNorm(year, i + 1, index);
                    return (
                      <div key={label} className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2">
                        <div className="text-[11px] text-[#e5e4e2]/55">{label}</div>
                        <div className="text-sm text-[#e5e4e2]">{norm.hoursFullTime} h</div>
                        <div className="text-[10px] text-[#e5e4e2]/45">{norm.workingDays} dni roboczych{norm.saturdayHolidays ? ' · święto w sobotę' : ''}</div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] text-[#e5e4e2]/45">
                  Razem w roku: {MONTHS.reduce((sum, _, i) => sum + workingTimeNorm(year, i + 1, index).hoursFullTime, 0)} h. Dla części etatu pomnóż przez jego wymiar (np. ½ etatu = połowa godzin).
                </p>
              </section>

              {isAdmin && (
                <section className="rounded-lg border border-[#d3bb73]/10 p-3">
                  <h4 className="text-xs font-medium text-[#e5e4e2]/80">Dodaj dzień wolny ręcznie (np. decyzja firmy, zmiana przepisów przed aktualizacją źródła)</h4>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2.5 py-1.5 text-xs text-[#e5e4e2]" />
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nazwa" className="min-w-[200px] flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2.5 py-1.5 text-xs text-[#e5e4e2]" />
                    <button type="button" onClick={() => void addManual()} className="inline-flex items-center gap-1 rounded-lg border border-[#d3bb73]/25 px-2.5 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"><Plus className="h-3.5 w-3.5" /> Dodaj</button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        <div className="flex justify-between gap-2 border-t border-[#d3bb73]/10 px-5 py-3">
          <button type="button" disabled={refreshing} onClick={() => void refresh()} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d3bb73]/25 px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50">
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sprawdź aktualność
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-[#e5e4e2]/15 px-3 py-1.5 text-xs text-[#e5e4e2]/70 hover:bg-white/5">Zamknij</button>
        </div>
      </div>
    </div>
  );
}
