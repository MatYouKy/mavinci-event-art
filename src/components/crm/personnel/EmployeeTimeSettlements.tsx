'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { personnelInput as input, personnelButton as button, personnelSecondary as secondary } from '@/lib/personnel/workspace';

type Settlement = {
  id: string; settled_until: string; hours: number; hourly_rate: number; amount: number;
  report_minutes: number; created_at: string; notes: string | null;
  voided_at: string | null; void_reason: string | null;
};
type Preview = { can_manage: boolean; latest: Settlement | null; latest_changed: boolean; history: Settlement[]; minutes: number; entry_count: number; crossing_count: number; signature: string };
const money = (value: number) => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value);
const when = (value: string) => new Date(value).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
function isoDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function dateText(value: string) { return value.split('-').reverse().join('.'); }
function parseDate(value: string) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (!match) return '';
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number(year) >= 1900 && date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day) ? `${year}-${month}-${day}` : '';
}
function decimal(value: string) {
  const text = value.trim().replace(',', '.');
  return /^\d+(?:\.\d{1,2})?$/.test(text) ? Number(text) : NaN;
}

export default function EmployeeTimeSettlements({ employeeId, dateTo, refreshKey = 0 }: { employeeId: string; dateTo?: string; refreshKey?: number }) {
  const { showSnackbar } = useSnackbar();
  const [date, setDate] = useState(() => dateText(dateTo && dateTo < isoDate(new Date()) ? dateTo : isoDate(new Date())));
  const [time, setTime] = useState(() => dateTo && dateTo < isoDate(new Date()) ? '23:59:59' : new Date().toTimeString().slice(0, 8));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [hours, setHours] = useState('');
  const [rate, setRate] = useState('');
  const [notes, setNotes] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const lock = useRef(false);
  const hoursEdited = useRef(false);
  const retry = useRef<{ key: string; id: string } | null>(null);
  const parsedDate = parseDate(date);
  const until = parsedDate && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time) ? new Date(`${parsedDate}T${time.length === 5 ? time + ':00' : time}`).toISOString() : '';
  const load = useCallback(async () => {
    const request = ++sequence.current;
    if (!until) { setError('Podaj poprawną datę DD.MM.RRRR i godzinę.'); setLoading(false); return; }
    setLoading(true); setError(''); setAccepted(false);
    try {
      const { data, error: failure } = await supabase.rpc('get_employee_time_settlement_preview', { p_employee: employeeId, p_until: until });
      if (failure) throw failure;
      if (request !== sequence.current) return;
      const next = data as Preview;
      setPreview(next);
      if (!hoursEdited.current) setHours((Number(next.minutes) / 60).toFixed(2).replace('.', ','));
      setRate(current => current || (next.latest ? String(next.latest.hourly_rate).replace('.', ',') : ''));
    } catch (failure: any) { if (request === sequence.current) setError(failure.message || 'Nie udało się pobrać rozliczeń.'); }
    finally { if (request === sequence.current) setLoading(false); }
  }, [employeeId, until]);
  useEffect(() => {
    void load();
    const focus = () => { if (!lock.current) void load(); };
    window.addEventListener('focus', focus);
    const channel = supabase.channel(`time-settlement-${employeeId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'time_entries', filter: `employee_id=eq.${employeeId}` }, focus).subscribe();
    return () => { ++sequence.current; window.removeEventListener('focus', focus); void supabase.removeChannel(channel); };
  }, [load, refreshKey]);
  const count = decimal(hours), hourlyRate = decimal(rate);
  const amount = Number.isFinite(count * hourlyRate) ? Math.round((count * hourlyRate + Number.EPSILON) * 100) / 100 : 0;
  const differs = preview ? count !== Math.round(Number(preview.minutes) / 60 * 100) / 100 : false;
  const needsAcceptance = differs || Boolean(preview?.latest_changed);
  const valid = !!until && new Date(until).getTime() <= Date.now() && count > 0 && count <= 1000000 && hourlyRate > 0 && hourlyRate <= 1000000
    && (!preview?.latest || new Date(until) > new Date(preview.latest.settled_until));
  const save = async () => {
    if (lock.current || !preview || !valid || loading || error || preview.crossing_count || needsAcceptance && !accepted) return;
    lock.current = true; setBusy(true); setError('');
    const payload = { p_employee: employeeId, p_until: until, p_hours: count, p_rate: hourlyRate, p_previous: preview.latest?.id || null, p_signature: preview.signature, p_notes: notes.trim() || null, p_accept_adjustment: accepted };
    const key = JSON.stringify(payload);
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
    try {
      const { error: failure } = await supabase.rpc('save_employee_time_settlement', { ...payload, p_id: retry.current!.id });
      if (failure) throw failure;
      retry.current = null; hoursEdited.current = false; setExpanded(false); setNotes('');
      showSnackbar(`Zapisano rozliczenie do ${when(until)}: ${money(amount)} netto.`, 'success');
      await load();
    } catch (failure: any) { setError(failure.message || 'Nie udało się zapisać rozliczenia.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const undo = async () => {
    if (!preview?.latest || lock.current) return;
    const reason = window.prompt('Podaj powód cofnięcia ostatniego rozliczenia. Zapis pozostanie w historii.');
    if (!reason?.trim()) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const { error: failure } = await supabase.rpc('void_employee_time_settlement', { p_id: preview.latest.id, p_reason: reason });
      if (failure) throw failure;
      hoursEdited.current = false;
      await load(); showSnackbar('Cofnięto oznaczenie ostatniego rozliczenia.', 'success');
    } catch (failure: any) { setError(failure.message || 'Nie udało się cofnąć rozliczenia.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section className="space-y-4 rounded-xl bg-white/[0.035] p-5 text-[var(--brand-platinum)]">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg">Rozliczenie czasu pracy</h2>
        <p className="mt-1 flex items-center gap-2 text-sm text-[#d3bb73]">{preview?.latest && !preview.latest_changed && <CheckCircle2 className="h-4 w-4" />}{preview?.latest ? `${preview.latest_changed ? 'Do sprawdzenia — ostatnie rozliczenie do' : 'Rozliczony do'} ${when(preview.latest.settled_until)}` : loading ? 'Ładowanie rozliczeń…' : error ? 'Rozliczenia niedostępne' : 'Brak zapisanego rozliczenia'}</p>
      </div>
      {preview?.can_manage && <button type="button" disabled={busy} className={secondary} onClick={() => setExpanded(current => !current)}>{expanded ? 'Zamknij formularz' : 'Rozlicz pracownika'}</button>}
    </div>
    {preview?.latest_changed && <p className="text-sm text-amber-200">Raport za wcześniej rozliczony okres został zmieniony. Sprawdź dodane lub poprawione godziny przed kolejnym rozliczeniem.</p>}
    {preview?.latest && <p className="text-sm opacity-65">Ostatnio: {preview.latest.hours} godz. × {money(Number(preview.latest.hourly_rate))} netto = <strong>{money(Number(preview.latest.amount))} netto</strong></p>}
    {expanded && preview?.can_manage && <fieldset disabled={busy} className="space-y-4 rounded-lg bg-black/10 p-4">
      <p className="text-xs opacity-60">{preview.latest ? `Kolejne rozliczenie obejmie okres po ${when(preview.latest.settled_until)}.` : 'Pierwsze rozliczenie obejmie dotychczasowy raport do wskazanego momentu.'} Kwota dotyczy wypłaty netto. Zapis zachowuje uzgodnienie w raporcie czasu pracy; przelew wykonujesz osobno.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="text-xs"><label htmlFor={`settlement-date-${employeeId}`}>Rozliczony do dnia</label><div className="flex items-center gap-1"><input id={`settlement-date-${employeeId}`} className={input} value={date} placeholder="DD.MM.RRRR" inputMode="numeric" maxLength={10} onChange={event => { hoursEdited.current = false; setDate(event.target.value); }} /><label className="relative mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5"><CalendarDays className="h-4 w-4" /><input type="date" aria-label="Wybierz dzień rozliczenia" max={isoDate(new Date())} value={parsedDate} onClick={event => event.currentTarget.showPicker?.()} onChange={event => { hoursEdited.current = false; setDate(dateText(event.target.value)); }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" /></label></div></div>
        <label className="text-xs">Do godziny<input className={input} type="time" step={1} value={time} onChange={event => { hoursEdited.current = false; setTime(event.target.value); }} /></label>
        <label className="text-xs">Liczba rozliczanych godzin<input className={input} inputMode="decimal" value={hours} onChange={event => { hoursEdited.current = true; setAccepted(false); setHours(event.target.value); }} /></label>
        <label className="text-xs">Stawka netto za godzinę (zł)<input className={input} inputMode="decimal" value={rate} onChange={event => setRate(event.target.value)} /></label>
      </div>
      <p className="text-xs opacity-65">{loading ? 'Przeliczam raport…' : `Raport od poprzedniego rozliczenia: ${(Number(preview.minutes) / 60).toFixed(2).replace('.', ',')} godz. (${preview.entry_count} zakończonych wpisów).`} Liczbę godzin możesz uzgodnić ręcznie.</p>
      {preview.crossing_count > 0 && <p className="text-sm text-amber-200">Wpis czasu trwa przez wybrany moment. Zakończ go lub wybierz moment pomiędzy wpisami.</p>}
      <label className="block text-xs">Notatka (opcjonalnie)<textarea rows={2} className={input} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      {needsAcceptance && <label className="flex items-start gap-2 text-sm text-amber-100"><input type="checkbox" className="mt-1" checked={accepted} onChange={event => setAccepted(event.target.checked)} />Potwierdzam, że wpisana liczba godzin uwzględnia uzgodnione korekty i zamyka rozliczenie pracy do wskazanego momentu.</label>}
      <div className="flex flex-wrap items-end justify-between gap-3"><p className="text-sm">Do wypłaty netto<strong className="mt-1 block text-2xl text-[#d3bb73]">{money(amount)}</strong></p><button type="button" className={`${button} inline-flex items-center gap-2`} disabled={busy || loading || !!error || !valid || preview.crossing_count > 0 || needsAcceptance && !accepted} onClick={() => void save()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Zastosuj rozliczenie</button></div>
      {!valid && !loading && <p className="text-xs text-amber-200">Wpisz dodatnią liczbę godzin i stawkę (do dwóch miejsc po przecinku), a także moment późniejszy od poprzedniego rozliczenia i nie późniejszy niż teraz.</p>}
    </fieldset>}
    {error && <p role="alert" className="text-sm text-amber-200">{error} <button type="button" disabled={busy} className="underline" onClick={() => void load()}>Odśwież podgląd</button></p>}
    {!!preview?.history.length && <details><summary className="cursor-pointer text-sm opacity-70">Historia rozliczeń (ostatnie {preview.history.length})</summary><div className="mt-3 space-y-2">{preview.history.map(item => <div key={item.id} className="rounded-lg bg-white/[0.025] p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span>Do {when(item.settled_until)}</span><strong>{item.hours} godz. × {money(Number(item.hourly_rate))} = {money(Number(item.amount))} netto</strong></div><p className="mt-1 text-xs opacity-50">Zapisano {when(item.created_at)}{item.voided_at ? ` · Cofnięto: ${item.void_reason}` : ''}</p>{item.notes && <p className="mt-1 text-xs opacity-65">{item.notes}</p>}</div>)}</div></details>}
    {preview?.can_manage && preview.latest && <button type="button" disabled={busy || loading} onClick={() => void undo()} className="text-xs opacity-60 hover:underline disabled:opacity-30">Cofnij ostatnie rozliczenie</button>}
  </section>;
}
