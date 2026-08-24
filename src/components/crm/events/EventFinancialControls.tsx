'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useSnackbar } from '@/contexts/SnackbarContext';

type InvoiceOption = { id: string; invoice_number: string; status: string; total_gross: number };
type PaymentMilestone = {
  id: string;
  label: string;
  milestone_type: 'deposit' | 'installment' | 'balance' | 'other';
  amount: number;
  due_date: string;
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
  planned: 'Planowana', invoiced: 'Zafakturowana', paid: 'Opłacona', overdue: 'Po terminie', waived: 'Niewymagana',
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
      supabase.from('events').select('event_date').eq('id', eventId).maybeSingle(),
    ]);
    if (milestonesResult.error) {
      if (['42P01', 'PGRST205'].includes(milestonesResult.error.code ?? '')) setAvailable(false);
      setLoading(false);
      return;
    }
    setMilestones((milestonesResult.data ?? []) as PaymentMilestone[]);
    setCloseout((closeoutResult.data as Closeout | null) ?? null);
    setEventDate(eventResult.data?.event_date ?? null);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => ({
    expected: milestones.filter((item) => item.status !== 'waived').reduce((sum, item) => sum + Number(item.amount), 0),
    paid: milestones.reduce((sum, item) => sum + Number(item.paid_amount), 0),
    overdue: milestones.filter((item) => item.status === 'overdue').reduce((sum, item) => sum + Math.max(Number(item.amount) - Number(item.paid_amount), 0), 0),
  }), [milestones]);

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
          <div><h3 className="flex items-center gap-2 text-lg font-medium text-[#e5e4e2]"><CircleDollarSign className="h-5 w-5 text-[#d3bb73]" />Harmonogram płatności</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">Zaliczki i raty są kontrolowane niezależnie od statusu faktury.</p></div>
          {canManage && <button onClick={() => setShowForm((value) => !value)} className="flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#11131d]"><Plus className="h-4 w-4" />Dodaj płatność</button>}
        </div>

        {showForm && (
          <div className="mt-4 grid gap-3 rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] p-4 sm:grid-cols-2 lg:grid-cols-4">
            <input className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]" placeholder="Nazwa" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            <select className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]" value={form.milestone_type} onChange={(e) => setForm({ ...form, milestone_type: e.target.value as PaymentMilestone['milestone_type'] })}><option value="deposit">Zaliczka</option><option value="installment">Rata</option><option value="balance">Płatność końcowa</option><option value="other">Inna</option></select>
            <input type="number" min="0" step="0.01" className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]" placeholder="Kwota" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <input type="date" className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            <select className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] sm:col-span-2" value={form.invoice_id} onChange={(e) => setForm({ ...form, invoice_id: e.target.value })}><option value="">Bez powiązanej faktury</option>{invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · {Number(invoice.total_gross).toLocaleString('pl-PL')} zł</option>)}</select>
            <input className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] sm:col-span-2" placeholder="Uwagi" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <button disabled={saving} onClick={addMilestone} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#11131d] disabled:opacity-50">Zapisz</button>
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-[#0f1119] p-3 text-center text-xs"><div><span className="block text-[#e5e4e2]/40">Plan</span><strong className="text-[#e5e4e2]">{totals.expected.toLocaleString('pl-PL')} zł</strong></div><div><span className="block text-[#e5e4e2]/40">Zapłacono</span><strong className="text-green-400">{totals.paid.toLocaleString('pl-PL')} zł</strong></div><div><span className="block text-[#e5e4e2]/40">Po terminie</span><strong className="text-red-400">{totals.overdue.toLocaleString('pl-PL')} zł</strong></div></div>

        <div className="mt-3 space-y-2">
          {milestones.length === 0 ? <div className="rounded-lg border border-dashed border-amber-500/20 p-5 text-center text-sm text-amber-200/70">Brak harmonogramu płatności — kontrola wydarzenia potraktuje to jako ryzyko.</div> : milestones.map((item) => (
            <div key={item.id} className="flex flex-col gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 sm:flex-row sm:items-center">
              <CalendarClock className="h-4 w-4 flex-none text-[#d3bb73]" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium text-[#e5e4e2]">{item.label}</span><span className={`rounded px-2 py-0.5 text-[10px] ${statusStyles[item.status]}`}>{statusLabels[item.status]}</span></div><div className="mt-1 text-xs text-[#e5e4e2]/45">Termin: {new Date(`${item.due_date}T12:00:00`).toLocaleDateString('pl-PL')} · {Number(item.amount).toLocaleString('pl-PL')} zł</div></div>
              {canManage && <div className="flex items-center gap-1">{!['paid','waived'].includes(item.status) && <button onClick={() => updateMilestone(item.id, { paid_amount: item.amount, paid_at: new Date().toISOString() })} className="rounded-lg px-2.5 py-1.5 text-xs text-green-300 hover:bg-green-500/10">Oznacz jako opłaconą</button>}{item.status !== 'paid' && <button onClick={() => updateMilestone(item.id, { status: 'waived' })} className="rounded-lg px-2.5 py-1.5 text-xs text-[#e5e4e2]/45 hover:bg-[#1c1f33]">Niewymagana</button>}<button onClick={() => deleteMilestone(item.id)} className="rounded-lg p-2 text-red-400/70 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /></button></div>}
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
