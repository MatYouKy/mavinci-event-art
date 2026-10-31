'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { getOfferTotals, roundMoney } from '@/lib/CRM/Offers/offerTotals';
import { useSnackbar } from '@/contexts/SnackbarContext';

type InvoiceOption = { id: string; invoice_number: string; status: string; total_gross: number };
type PaymentMilestone = {
  payment_plan_mode?: 'advance_balance' | 'final_only' | 'earnest_event' | null;
  id: string;
  label: string;
  milestone_type: 'deposit' | 'installment' | 'balance' | 'other';
  amount: number;
  due_date: string | null;
  payment_due_days?: number | null;
  status: 'planned' | 'invoiced' | 'paid' | 'overdue' | 'waived';
  invoice_id: string | null;
  paid_amount: number;
  paid_at: string | null;
  notes: string | null;
};

type Closeout = {
  id: string;
  equipment_returned: boolean;
  vehicles_returned: boolean;
  damages_resolved: boolean;
  subcontractors_settled: boolean;
  employee_time_approved: boolean;
  client_balance_settled: boolean;
  documents_archived: boolean;
  lessons_learned: string | null;
  completed_at: string | null;
};

const closeoutItems: Array<[keyof Closeout, string]> = [
  ['equipment_returned', 'Sprzęt został zwrócony i sprawdzony'],
  ['vehicles_returned', 'Pojazdy zostały zdane'],
  ['damages_resolved', 'Szkody i uwagi zostały rozliczone'],
  ['subcontractors_settled', 'Podwykonawcy zostali rozliczeni'],
  ['employee_time_approved', 'Czas pracy zespołu został zatwierdzony'],
  ['client_balance_settled', 'Saldo klienta jest rozliczone'],
  ['documents_archived', 'Dokumentacja została zamknięta'],
];

const statusStyles: Record<PaymentMilestone['status'], string> = {
  planned: 'bg-blue-500/10 text-blue-300',
  invoiced: 'bg-violet-500/10 text-violet-300',
  paid: 'bg-green-500/10 text-green-300',
  overdue: 'bg-red-500/10 text-red-300',
  waived: 'bg-[#e5e4e2]/10 text-[#e5e4e2]/45',
};

const statusLabels: Record<PaymentMilestone['status'], string> = {
  planned: 'Planowana', invoiced: 'Faktura wystawiona', paid: 'Opłacona', overdue: 'Po terminie', waived: 'Niewymagana',
};

export default function EventFinancialControls({
  eventId,
  invoices,
  canManage,
}: {
  eventId: string;
  invoices: InvoiceOption[];
  canManage: boolean;
}) {
  const { showSnackbar } = useSnackbar();
  const [milestones, setMilestones] = useState<PaymentMilestone[]>([]);
  const [closeout, setCloseout] = useState<Closeout | null>(null);
  const [eventDate, setEventDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const planLock = useRef(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planMode, setPlanMode] = useState('advance_balance');
  const [firstAmount, setFirstAmount] = useState('');
  const [firstPercentInput, setFirstPercentInput] = useState<string | null>(null);
  const [firstDate, setFirstDate] = useState('');
  const [finalDays, setFinalDays] = useState('14');
  const [acceptedTotal, setAcceptedTotal] = useState<number | null>(null);
  const [budgetError, setBudgetError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showCloseout, setShowCloseout] = useState(false);
  const [available, setAvailable] = useState(true);
  const [form, setForm] = useState({
    label: 'Zaliczka', milestone_type: 'deposit' as PaymentMilestone['milestone_type'], amount: '', due_date: '', invoice_id: '', notes: '',
  });

  const load = useCallback(async () => {
    const [milestonesResult, closeoutResult, eventResult] = await Promise.all([
      supabase.from('event_payment_milestones').select('*').eq('event_id', eventId).order('due_date'),
      supabase.from('event_closeouts').select('*').eq('event_id', eventId).maybeSingle(),
      supabase.from('events').select('event_date,financial_source').eq('id', eventId).maybeSingle(),
    ]);
    if (milestonesResult.error) {
      if (['42P01', 'PGRST205'].includes(milestonesResult.error.code ?? '')) setAvailable(false);
      setLoading(false);
      return;
    }
    setMilestones((milestonesResult.data ?? []) as PaymentMilestone[]);
    setCloseout((closeoutResult.data as Closeout | null) ?? null);
    setEventDate(eventResult.data?.event_date ?? null);
    setBudgetError(''); setAcceptedTotal(null);
    try {
      if (eventResult.error) throw eventResult.error;
      if (eventResult.data?.financial_source === 'calculation') {
        const result = await supabase.from('event_calculations').select('event_calculation_items(quantity,unit_price,days,vat_rate)').eq('event_id',eventId).eq('is_accepted',true).maybeSingle();
        if (result.error) throw result.error;
        if (result.data) setAcceptedTotal(roundMoney(result.data.event_calculation_items.reduce((sum, item) => sum + roundMoney(Number(item.quantity) * Number(item.unit_price) * Number(item.days ?? 1) * (1 + Number(item.vat_rate ?? 23) / 100)), 0)));
      } else {
        const result = await supabase.from('offers').select('subtotal,discount_amount,tax_amount,tax_percent,total_amount,logistics_enabled,logistics_price_net,totals_include_logistics,accepted_package_id').eq('event_id',eventId).eq('status','accepted').order('accepted_at',{ascending:false,nullsFirst:false}).limit(1).maybeSingle();
        if (result.error) throw result.error;
        if (result.data?.accepted_package_id) {
          const pack = await supabase.from('offer_packages').select('price_net').eq('id',result.data.accepted_package_id).single();
          if (pack.error) throw pack.error;
          setAcceptedTotal(roundMoney((Number(pack.data.price_net) + (result.data.logistics_enabled ? Number(result.data.logistics_price_net || 0) : 0)) * (1 + Number(result.data.tax_percent ?? 23) / 100)));
        } else if (result.data) setAcceptedTotal(getOfferTotals(result.data).gross);
      }
    } catch { setBudgetError('Nie udało się odczytać zaakceptowanej kwoty. Odśwież dane przed ustaleniem rozliczenia.'); }
    setLoading(false);
  }, [eventId]);

  const invoiceState = invoices.map(invoice => `${invoice.id}:${invoice.status}`).join('|');
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      if (canManage) {
        const result = await supabase.rpc('refresh_event_payment_plan', {p_event_id:eventId});
        if (result.error && !['42883','PGRST202'].includes(result.error.code || '')) {
          showSnackbar('Nie udało się zsynchronizować płatności z fakturami.', 'error');
        }
      }
      if (live) await load();
    };
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { live = false; window.removeEventListener('focus', onFocus); };
  }, [load, eventId, canManage, invoiceState, showSnackbar]);

  const totals = useMemo(() => ({
    expected: milestones.filter((item) => item.status !== 'waived').reduce((sum, item) => sum + Number(item.amount), 0),
    paid: milestones.reduce((sum, item) => sum + Number(item.paid_amount), 0),
    overdue: milestones.filter((item) => item.status === 'overdue').reduce((sum, item) => sum + Math.max(Number(item.amount) - Number(item.paid_amount), 0), 0),
  }), [milestones]);

  const eventDay = eventDate ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(eventDate)) : '';
  const planLabels: Record<string,string> = {advance_balance:'Zaliczka + płatność końcowa',final_only:'Jedna płatność końcowa',earnest_event:'Zadatek + dopłata w dniu uroczystości'};
  const openPlan = () => {
    const first = milestones.find(item => item.milestone_type === 'deposit');
    setPlanMode(milestones.find(item => item.payment_plan_mode)?.payment_plan_mode || (first ? 'advance_balance' : milestones.length ? 'final_only' : 'advance_balance'));
    setFirstPercentInput(null);
    setFirstAmount(first ? String(first.amount) : ''); setFirstDate(first?.due_date || '');
    setFinalDays(String(milestones.find(item => item.milestone_type === 'balance')?.payment_due_days ?? 14));
    setPlanOpen(true);
  };
  const savePlan = async () => {
    if (planLock.current) return;
    const amount = planMode === 'final_only' ? 0 : Number(firstAmount.replace(',', '.'));
    const end = planMode === 'earnest_event' ? eventDay : null;
    const days = Number(finalDays);
    if (acceptedTotal === null || acceptedTotal <= 0 || !Number.isFinite(amount) || (planMode !== 'final_only' && (amount <= 0 || amount >= acceptedTotal || !firstDate)) || (planMode === 'earnest_event' ? !end || firstDate > end : !finalDays.trim() || !Number.isInteger(days) || days < 0 || days > 3650)) {
      showSnackbar('Sprawdź kwotę i terminy. Zaliczka lub zadatek musi być mniejszy od całości, a termin końcowy musi być liczbą całych dni od wystawienia faktury (0–3650).', 'error'); return;
    }
    planLock.current = true; setSaving(true);
    try {
      const {error} = await supabase.rpc('set_event_payment_plan', {p_event_id:eventId,p_mode:planMode,p_total:acceptedTotal,p_first_amount:amount,p_first_date:planMode === 'final_only' ? null : firstDate,p_final_date:end,p_final_days:planMode === 'earnest_event' ? null : days});
      if (error) throw error;
      setPlanOpen(false); await load(); showSnackbar('Zapisano sposób rozliczenia i terminy płatności.', 'success');
    } catch (error: any) { showSnackbar(error.message || 'Nie udało się zapisać rozliczenia.', 'error'); }
    finally { planLock.current = false; setSaving(false); }
  };

  const addMilestone = async () => {
    if (!form.label.trim() || !form.due_date || Number(form.amount) <= 0) {
      return showSnackbar('Podaj nazwę, kwotę i termin płatności', 'error');
    }
    setSaving(true);
    const { error } = await supabase.from('event_payment_milestones').insert({
      event_id: eventId, label: form.label.trim(), milestone_type: form.milestone_type,
      amount: Number(form.amount), due_date: form.due_date, invoice_id: form.invoice_id || null,
      notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (error) return showSnackbar(error.message, 'error');
    setShowForm(false);
    setForm({ label: 'Zaliczka', milestone_type: 'deposit', amount: '', due_date: '', invoice_id: '', notes: '' });
    await load();
    showSnackbar('Dodano termin płatności', 'success');
  };

  const updateMilestone = async (id: string, patch: Record<string, unknown>) => {
    setSaving(true);
    const { error } = await supabase.from('event_payment_milestones').update(patch).eq('id', id);
    setSaving(false);
    if (error) return showSnackbar(error.message, 'error');
    await load();
    showSnackbar('Zaktualizowano płatność.', 'success');
  };

  const deleteMilestone = async (id: string) => {
    if (!window.confirm('Usunąć ten termin płatności?')) return;
    const { error } = await supabase.from('event_payment_milestones').delete().eq('id', id);
    if (error) return showSnackbar(error.message, 'error');
    await load();
  };

  const ensureCloseout = async () => {
    if (closeout) return closeout;
    const { data, error } = await supabase.from('event_closeouts').insert({ event_id: eventId }).select('*').single();
    if (error) { showSnackbar(error.message, 'error'); return null; }
    setCloseout(data as Closeout);
    return data as Closeout;
  };

  const toggleCloseout = async (key: keyof Closeout) => {
    const current = await ensureCloseout();
    if (!current) return;
    setSaving(true);
    const { error } = await supabase.from('event_closeouts').update({ [key]: !Boolean(current[key]) }).eq('id', current.id);
    setSaving(false);
    if (error) return showSnackbar(error.message, 'error');
    await load();
  };

  if (!available || loading) return loading ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-[#d3bb73]" /></div> : null;

  const eventFinished = eventDate ? new Date(eventDate).getTime() < Date.now() : false;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div><h3 className="flex items-center gap-2 text-lg font-medium text-[#e5e4e2]"><CircleDollarSign className="h-5 w-5 text-[#d3bb73]" />Sposób rozliczenia</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">Ustal, kiedy klient płaci. Wystawienie faktury nie oznacza otrzymania pieniędzy. Kwoty brutto.</p></div>
          {canManage && <button onClick={() => setShowForm((value) => !value)} className="flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#11131d]"><Plus className="h-4 w-4" />Dodaj płatność</button>}
        </div>

        <div className="mt-4 space-y-3">
          <p className="text-sm text-[#e5e4e2]">{milestones.find(item => item.payment_plan_mode)?.payment_plan_mode ? planLabels[milestones.find(item => item.payment_plan_mode)!.payment_plan_mode!] : milestones.length ? 'Indywidualne terminy płatności' : 'Ustal sposób rozliczenia'}</p>
          {acceptedTotal !== null && <p className="text-sm text-[#d3bb73]">Zaakceptowana kwota: {acceptedTotal.toLocaleString('pl-PL',{minimumFractionDigits:2})} zł brutto</p>}
          {budgetError && <p role="alert" className="text-red-300 text-sm">{budgetError}</p>}
          {acceptedTotal === null && !budgetError && <p className="text-sm text-[#e5e4e2]/60">Zaakceptuj ofertę lub kalkulację, aby automatycznie wyliczyć płatności.</p>}
          {acceptedTotal !== null && milestones.length > 0 && Math.abs(totals.expected - acceptedTotal) > 0.01 && <p className="text-sm text-amber-200">Suma zaplanowanych płatności różni się od aktualnej zaakceptowanej kwoty. Sprawdź rozliczenie — zapisane wpłaty nie są zmieniane automatycznie.</p>}
          {canManage && !planOpen && <button type="button" onClick={openPlan} disabled={saving || acceptedTotal === null || milestones.some(item => Number(item.paid_amount)>0 || !!item.paid_at || !!item.invoice_id || item.status === 'paid')} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#250914] disabled:opacity-40">{milestones.length ? 'Zmień sposób rozliczenia' : 'Ustal sposób rozliczenia'}</button>}
          {canManage && milestones.some(item => Number(item.paid_amount)>0 || !!item.paid_at || !!item.invoice_id || item.status === 'paid') && <p className="text-xs text-[#e5e4e2]/60">Rozliczenie ma już wpłatę lub powiązaną fakturę. Zmiana całego schematu jest zablokowana, aby zachować historię.</p>}
          {milestones.some(item => item.payment_plan_mode === 'earnest_event' && item.milestone_type === 'balance' && item.due_date !== eventDay) && <p className="text-sm text-amber-200">Termin wydarzenia zmienił się po zapisaniu rozliczenia. Zaktualizuj termin dopłaty.</p>}
          {planOpen && <fieldset disabled={saving} className="grid gap-3 rounded-lg bg-black/15 p-4 sm:grid-cols-2">
            <div className={`grid gap-3 sm:col-span-2 ${planMode !== 'final_only' ? 'sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.2fr)]' : ''}`}>
              <label className="min-w-0 text-sm">Sposób rozliczenia<select value={planMode} onChange={e=>setPlanMode(e.target.value)} className="mt-1 w-full rounded-lg bg-[#250914] border border-white/10 p-2">{Object.entries(planLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
              {planMode !== 'final_only' && <>
                <label className="min-w-0 text-sm">Kwota {planMode === 'earnest_event' ? 'zadatku' : 'zaliczki'} brutto<input inputMode="decimal" value={firstAmount} onChange={e=>{setFirstAmount(e.target.value);setFirstPercentInput(null);}} className="mt-1 w-full rounded-lg bg-[#250914] border border-white/10 p-2"/></label>
                <label className="min-w-0 text-sm">{planMode === 'earnest_event' ? 'Zadatek' : 'Zaliczka'} (%)<input type="number" min="0.01" max="99.99" step="0.01" disabled={!acceptedTotal || acceptedTotal <= 0} value={firstPercentInput ?? (acceptedTotal && firstAmount.trim() && Number.isFinite(Number(firstAmount.replace(',','.'))) ? String(roundMoney(Number(firstAmount.replace(',','.')) / acceptedTotal * 100)) : '')} onChange={e=>{
                  const value = e.target.value;
                  setFirstPercentInput(value);
                  setFirstAmount(value && acceptedTotal ? String(roundMoney(acceptedTotal * Number(value) / 100)) : '');
                }} className="mt-1 w-full rounded-lg bg-[#250914] border border-white/10 p-2 disabled:opacity-40" title="Procent zaakceptowanej kwoty brutto"/></label>
                <label className="min-w-0 text-sm">Termin {planMode === 'earnest_event' ? 'zadatku' : 'zaliczki'}<input type="date" value={firstDate} onChange={e=>setFirstDate(e.target.value)} className="mt-1 w-full min-w-0 rounded-lg bg-[#250914] border border-white/10 p-2"/></label>
              </>}
            </div>
            {planMode !== 'final_only' && <p className="text-xs text-[#e5e4e2]/60 sm:col-span-2">Procent jest liczony od zaakceptowanej kwoty brutto. Zmiana kwoty lub procentu przelicza drugie pole.</p>}
            {planMode === 'earnest_event' ? <p className="self-center text-sm">Dopłata w dniu uroczystości: {eventDay ? new Date(`${eventDay}T12:00:00`).toLocaleDateString('pl-PL') : 'Ustal datę wydarzenia'}</p> : <label className="text-sm">Termin płatności końcowej — dni od wystawienia faktury<input type="number" min="0" max="3650" step="1" value={finalDays} onChange={e=>setFinalDays(e.target.value)} className="mt-1 w-full rounded-lg bg-[#250914] border border-white/10 p-2"/><span className="mt-1 block text-xs text-[#e5e4e2]/60">0 oznacza płatność w dniu wystawienia faktury. Data zostanie wyliczona po powiązaniu wystawionej faktury.</span></label>}
            <p className="self-center text-sm">{planMode === 'final_only' ? 'Do zapłaty' : 'Dopłata'}: {Math.max(0,roundMoney((acceptedTotal || 0) - (planMode === 'final_only' ? 0 : Number(firstAmount.replace(',','.') || 0)))).toLocaleString('pl-PL',{minimumFractionDigits:2})} zł brutto</p>
            <p className="text-xs text-[#e5e4e2]/60 sm:col-span-2">{planMode === 'earnest_event' ? 'Dopłata przypada w dniu rozpoczęcia wydarzenia. ' : ''}Wystawiona faktura zostanie powiązana automatycznie, jeśli jej typ i kwota jednoznacznie pasują do płatności. Zapis zastępuje dotychczasowe nieopłacone terminy bez faktur.</p>
            <button type="button" onClick={savePlan} className="rounded-lg bg-[#d3bb73] p-2 text-[#250914]">{saving ? 'Zapisywanie…' : 'Zapisz rozliczenie'}</button><button type="button" onClick={()=>setPlanOpen(false)}>Anuluj</button>
          </fieldset>}
        </div>

        {showForm && (
          <div className="mt-4 grid gap-3 rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] p-4 sm:grid-cols-2 lg:grid-cols-4">
            <input className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]" placeholder="Nazwa" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            <select className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]" value={form.milestone_type} onChange={(e) => setForm({ ...form, milestone_type: e.target.value as PaymentMilestone['milestone_type'], label: ({deposit:'Zaliczka',installment:'Rata',balance:'Płatność końcowa',other:'Inna płatność'} as Record<string,string>)[e.target.value] })}><option value="deposit">Zaliczka</option><option value="installment">Rata</option><option value="balance">Płatność końcowa</option><option value="other">Inna</option></select>
            <input type="number" min="0" step="0.01" className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]" placeholder="Kwota" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <input type="date" className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            <select className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] sm:col-span-2" value={form.invoice_id} onChange={(e) => setForm({ ...form, invoice_id: e.target.value })}><option value="">Bez powiązanej faktury</option>{invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · {Number(invoice.total_gross).toLocaleString('pl-PL')} zł</option>)}</select>
            <input className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] sm:col-span-2" placeholder="Uwagi" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <button disabled={saving} onClick={addMilestone} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#11131d] disabled:opacity-50">Zapisz</button>
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-[#0f1119] p-3 text-center text-xs"><div><span className="block text-[#e5e4e2]/40">Plan</span><strong className="text-[#e5e4e2]">{totals.expected.toLocaleString('pl-PL')} zł</strong></div><div><span className="block text-[#e5e4e2]/40">Zapłacono</span><strong className="text-green-400">{totals.paid.toLocaleString('pl-PL')} zł</strong></div><div><span className="block text-[#e5e4e2]/40">Po terminie</span><strong className="text-red-400">{totals.overdue.toLocaleString('pl-PL')} zł</strong></div></div>

        <div className="mt-3 space-y-2">
          {milestones.length === 0 ? <div className="rounded-lg border border-dashed border-amber-500/20 p-5 text-center text-sm text-amber-200/70">Nie ustalono sposobu rozliczenia. Nie blokuje to przygotowania wydarzenia.</div> : milestones.map((item) => (
            <div key={item.id} className="flex flex-col gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 sm:flex-row sm:items-center">
              <CalendarClock className="h-4 w-4 flex-none text-[#d3bb73]" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium text-[#e5e4e2]">{item.label}</span><span className={`rounded px-2 py-0.5 text-[10px] ${statusStyles[item.status]}`}>{statusLabels[item.status]}</span></div><div className="mt-1 text-xs text-[#e5e4e2]/45">Termin: {item.payment_due_days != null ? `${item.payment_due_days} dni od wystawienia faktury · ` : ''}{item.due_date ? new Date(`${item.due_date}T12:00:00`).toLocaleDateString('pl-PL') : 'Oczekuje na wystawioną fakturę'} · {Number(item.amount).toLocaleString('pl-PL')} zł · Zapłacono: {Number(item.paid_amount).toLocaleString('pl-PL')} zł</div></div>
              {item.invoice_id && <a href={`/crm/invoices/${item.invoice_id}`} className="text-xs text-[#d3bb73] underline">{invoices.find(invoice=>invoice.id === item.invoice_id)?.invoice_number || 'Otwórz fakturę'} · płatność aktualizowana z finansów</a>}
              {canManage && item.payment_due_days == null && <label className="text-xs text-[#e5e4e2]/60">Termin płatności<input type="date" disabled={saving || item.status === 'paid'} defaultValue={item.due_date || ''} key={item.due_date || 'pending'} onBlur={e=>{if(e.target.value && e.target.value !== item.due_date) void updateMilestone(item.id,{due_date:e.target.value});}} className="mt-1 block rounded-lg bg-[#250914] border border-white/10 p-2"/></label>}
              {canManage && <select aria-label={`Faktura: ${item.label}`} disabled={saving} value={item.invoice_id || ''} onChange={e=>updateMilestone(item.id,{invoice_id:e.target.value || null})} className="max-w-56 rounded-lg bg-[#250914] border border-white/10 p-2 text-xs"><option value="">Bez powiązanej faktury</option>{invoices.map(invoice=><option key={invoice.id} value={invoice.id}>{invoice.invoice_number}</option>)}</select>}
              {canManage && <div className="flex items-center gap-1">{!item.invoice_id && !['paid','waived'].includes(item.status) && <button onClick={() => updateMilestone(item.id, { paid_amount: item.amount, paid_at: new Date().toISOString() })} className="rounded-lg px-2.5 py-1.5 text-xs text-green-300 hover:bg-green-500/10">Oznacz jako opłaconą</button>}{item.status !== 'paid' && <button onClick={() => updateMilestone(item.id, { status: 'waived' })} className="rounded-lg px-2.5 py-1.5 text-xs text-[#e5e4e2]/45 hover:bg-[#1c1f33]">Niewymagana</button>}<button onClick={() => deleteMilestone(item.id)} className="rounded-lg p-2 text-red-400/70 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /></button></div>}
            </div>
          ))}
        </div>
      </section>

      {(eventFinished || closeout) && (
        <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
          <button onClick={() => setShowCloseout((value) => !value)} className="flex w-full items-center justify-between p-5 text-left"><div><h3 className="flex items-center gap-2 text-lg font-medium text-[#e5e4e2]"><CheckCircle2 className="h-5 w-5 text-[#d3bb73]" />Zamknięcie wydarzenia</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">Rozliczenie ludzi, zasobów, dokumentów i wyniku.</p></div>{showCloseout ? <ChevronUp className="h-5 w-5 text-[#e5e4e2]/40" /> : <ChevronDown className="h-5 w-5 text-[#e5e4e2]/40" />}</button>
          {showCloseout && <div className="grid gap-2 border-t border-[#d3bb73]/10 p-5 sm:grid-cols-2">{closeoutItems.map(([key, label]) => { const checked = Boolean(closeout?.[key]); return <button key={key} disabled={!canManage || saving} onClick={() => toggleCloseout(key)} className={`flex items-center gap-3 rounded-lg border p-3 text-left text-sm ${checked ? 'border-green-500/15 bg-green-500/5 text-green-200' : 'border-[#d3bb73]/10 bg-[#0f1119] text-[#e5e4e2]/70'}`}><span className={`flex h-5 w-5 items-center justify-center rounded border ${checked ? 'border-green-400 bg-green-400 text-[#11131d]' : 'border-[#e5e4e2]/25'}`}>{checked && <Check className="h-3.5 w-3.5" />}</span>{label}</button>; })}{closeout?.completed_at && <div className="sm:col-span-2 rounded-lg bg-green-500/10 p-3 text-sm text-green-300">Wydarzenie zostało operacyjnie zamknięte {new Date(closeout.completed_at).toLocaleString('pl-PL')}.</div>}</div>}
        </section>
      )}
    </div>
  );
}
