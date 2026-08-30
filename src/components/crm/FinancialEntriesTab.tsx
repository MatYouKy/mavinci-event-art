'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Loader2, Plus, Trash2, UserRound, WalletCards, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

type Category = { id: string; code: string; name: string; color: string };
type Company = { id: string; name: string };
type Employee = { id: string; name: string | null; surname: string | null };
type Entry = {
  id: string;
  title: string;
  amount_gross: number;
  recognition_date: string;
  payment_date: string | null;
  status: string;
  payment_method: string;
  entry_type: string;
  my_company_id: string | null;
  employee_id: string | null;
  category_id: string | null;
  company?: Company | Company[] | null;
  employee?: Employee | Employee[] | null;
  category?: Category | Category[] | null;
};

const money = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
const inputClass = 'w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/60';
const labelClass = 'mb-1.5 block text-xs text-[#e5e4e2]/55';

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] || null : value || null;
}

export default function FinancialEntriesTab() {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canManageModule, employee: currentEmployee } = useCurrentEmployee();
  const canManage = canManageModule('invoices') || currentEmployee?.role === 'admin';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    entry_type: 'payroll',
    title: '',
    amount_gross: '',
    recognition_date: today,
    payment_date: today,
    status: 'paid',
    payment_method: 'transfer',
    my_company_id: '',
    category_id: '',
    employee_id: '',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [entriesRes, categoriesRes, companiesRes, employeesRes] = await Promise.all([
      supabase
        .from('financial_entries')
        .select('*, company:my_companies(id,name), employee:employees!financial_entries_employee_id_fkey(id,name,surname), category:finance_categories(id,code,name,color)')
        .order('recognition_date', { ascending: false })
        .limit(200),
      supabase.from('finance_categories').select('id,code,name,color').eq('is_active', true).in('kind', ['expense', 'both']).order('sort_order'),
      supabase.from('my_companies').select('id,name').eq('is_active', true).order('name'),
      supabase.from('employees').select('id,name,surname').eq('is_active', true).order('surname'),
    ]);

    if (entriesRes.error) {
      console.error(entriesRes.error);
      showSnackbar('Nie udało się pobrać kosztów i wypłat.', 'error');
    }
    setEntries((entriesRes.data || []) as Entry[]);
    setCategories((categoriesRes.data || []) as Category[]);
    setCompanies((companiesRes.data || []) as Company[]);
    setEmployees((employeesRes.data || []) as Employee[]);
    setLoading(false);
  }, [showSnackbar]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!form.my_company_id && companies.length === 1) {
      setForm((current) => ({ ...current, my_company_id: companies[0].id }));
    }
    if (!form.category_id && categories.length) {
      const preferred = categories.find((item) => item.code === (form.entry_type === 'payroll' ? 'personnel' : 'other'));
      setForm((current) => ({ ...current, category_id: preferred?.id || categories[0].id }));
    }
  }, [categories, companies, form.category_id, form.entry_type, form.my_company_id]);

  const personnelCategoryId = useMemo(
    () => categories.find((category) => category.code === 'personnel')?.id || '',
    [categories],
  );

  const changeType = (entryType: string) => {
    setForm((current) => ({
      ...current,
      entry_type: entryType,
      category_id: entryType === 'payroll' ? personnelCategoryId : current.category_id,
      employee_id: entryType === 'payroll' ? current.employee_id : '',
    }));
  };

  const save = async () => {
    const amount = Number(form.amount_gross.replace(',', '.'));
    if (!form.title.trim() || !form.my_company_id || !form.category_id || !Number.isFinite(amount) || amount <= 0) {
      showSnackbar('Uzupełnij działalność, kategorię, opis i poprawną kwotę.', 'error');
      return;
    }
    if (form.entry_type === 'payroll' && !form.employee_id) {
      showSnackbar('Dla wypłaty wybierz pracownika.', 'error');
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('financial_entries').insert({
      direction: 'expense',
      entry_type: form.entry_type,
      title: form.title.trim(),
      amount_gross: amount,
      recognition_date: form.recognition_date,
      payment_date: form.status === 'paid' ? form.payment_date || form.recognition_date : null,
      status: form.status,
      payment_method: form.payment_method,
      my_company_id: form.my_company_id,
      category_id: form.category_id,
      employee_id: form.entry_type === 'payroll' ? form.employee_id : null,
      notes: form.notes.trim() || null,
    });
    setSaving(false);

    if (error) {
      console.error(error);
      showSnackbar('Nie udało się zapisać kosztu.', 'error');
      return;
    }
    showSnackbar('Koszt został zapisany i trafi do raportu.', 'success');
    setOpen(false);
    setForm((current) => ({ ...current, title: '', amount_gross: '', notes: '' }));
    load();
  };

  const remove = async (entry: Entry) => {
    const confirmed = await showConfirm({
      title: 'Usuń zapis finansowy',
      message: `Czy usunąć „${entry.title}”?`,
      confirmText: 'Usuń',
    });
    if (!confirmed) return;
    const { error } = await supabase.from('financial_entries').delete().eq('id', entry.id);
    if (error) {
      showSnackbar('Nie udało się usunąć zapisu.', 'error');
      return;
    }
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-light text-[#e5e4e2]"><WalletCards className="h-5 w-5 text-[#d3bb73]" /> Koszty i wypłaty</h2>
          <p className="mt-1 text-xs text-[#e5e4e2]/45">Rejestruj wynagrodzenia, gotówkę i koszty, których nie ma w KSeF ani na fakturach.</p>
        </div>
        {canManage && (
          <button onClick={() => setOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#0f1119]">
            <Plus className="h-4 w-4" /> Dodaj koszt lub wypłatę
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
        {loading ? (
          <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-[#d3bb73]" /></div>
        ) : entries.length === 0 ? (
          <div className="p-10 text-center text-sm text-[#e5e4e2]/40">Nie ma jeszcze ręcznie zapisanych kosztów ani wypłat.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-left text-xs">
              <thead className="bg-[#0f1119] text-[#e5e4e2]/45">
                <tr>
                  <th className="px-4 py-3 font-medium">Data</th><th className="px-4 py-3 font-medium">Opis</th><th className="px-4 py-3 font-medium">Kategoria</th><th className="px-4 py-3 font-medium">Działalność</th><th className="px-4 py-3 font-medium">Rozliczenie</th><th className="px-4 py-3 text-right font-medium">Kwota</th><th className="w-12 px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const company = one(entry.company);
                  const employee = one(entry.employee);
                  const category = one(entry.category);
                  return (
                    <tr key={entry.id} className="border-t border-[#d3bb73]/5 text-[#e5e4e2]/65">
                      <td className="whitespace-nowrap px-4 py-3">{new Date(entry.recognition_date).toLocaleDateString('pl-PL')}</td>
                      <td className="px-4 py-3"><div className="font-medium text-[#e5e4e2]">{entry.title}</div>{employee && <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[#e5e4e2]/40"><UserRound className="h-3 w-3" /> {employee.name} {employee.surname}</div>}</td>
                      <td className="px-4 py-3"><span className="rounded-full px-2 py-1" style={{ backgroundColor: `${category?.color || '#9ca3af'}18`, color: category?.color || '#9ca3af' }}>{category?.name || 'Bez kategorii'}</span></td>
                      <td className="px-4 py-3">{company?.name || 'Nieprzypisana'}</td>
                      <td className="px-4 py-3"><div>{entry.payment_method === 'cash' ? 'Gotówka' : entry.payment_method === 'transfer' ? 'Przelew' : entry.payment_method}</div><div className="text-[11px] text-[#e5e4e2]/35">{entry.status === 'paid' ? 'Zapłacono' : 'Poniesiony, niezapłacony'}</div></td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-red-300">{money.format(entry.amount_gross)}</td>
                      <td className="px-3 py-3">{canManage && <button onClick={() => remove(entry)} className="rounded p-1.5 text-red-300/70 hover:bg-red-400/10 hover:text-red-300" aria-label="Usuń"><Trash2 className="h-4 w-4" /></button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4" onMouseDown={() => !saving && setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#1c1f33] px-5 py-4">
              <div><h3 className="text-lg font-medium text-[#e5e4e2]">Nowy koszt lub wypłata</h3><p className="mt-0.5 text-xs text-[#e5e4e2]/40">Gotówka również trafia do faktycznych wydatków.</p></div>
              <button onClick={() => setOpen(false)} disabled={saving} className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-white/5"><X className="h-5 w-5" /></button>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div><label className={labelClass}>Rodzaj *</label><select className={inputClass} value={form.entry_type} onChange={(e) => changeType(e.target.value)}><option value="payroll">Wynagrodzenie / wypłata</option><option value="contractor">Podwykonawca</option><option value="purchase">Zakup</option><option value="reimbursement">Zwrot kosztów</option><option value="cash">Inny koszt gotówkowy</option><option value="other">Inny koszt</option></select></div>
              <div><label className={labelClass}>Działalność *</label><select className={inputClass} value={form.my_company_id} onChange={(e) => setForm({ ...form, my_company_id: e.target.value })}><option value="">Wybierz</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
              {form.entry_type === 'payroll' && <div><label className={labelClass}>Pracownik *</label><select className={inputClass} value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}><option value="">Wybierz</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} {employee.surname}</option>)}</select></div>}
              <div><label className={labelClass}>Kategoria *</label><select className={inputClass} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
              <div className="sm:col-span-2"><label className={labelClass}>Opis *</label><input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={form.entry_type === 'payroll' ? 'np. Wynagrodzenie za sierpień' : 'Czego dotyczy koszt?'} /></div>
              <div><label className={labelClass}>Kwota brutto *</label><div className="relative"><Banknote className="absolute left-3 top-3 h-4 w-4 text-[#e5e4e2]/30" /><input inputMode="decimal" className={`${inputClass} pl-9`} value={form.amount_gross} onChange={(e) => setForm({ ...form, amount_gross: e.target.value })} placeholder="0,00" /></div></div>
              <div><label className={labelClass}>Forma płatności</label><select className={inputClass} value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}><option value="transfer">Przelew</option><option value="cash">Gotówka do ręki</option><option value="card">Karta</option><option value="blik">BLIK</option><option value="compensation">Kompensata</option><option value="other">Inna</option></select></div>
              <div><label className={labelClass}>Data kosztu</label><input type="date" className={inputClass} value={form.recognition_date} onChange={(e) => setForm({ ...form, recognition_date: e.target.value })} /></div>
              <div><label className={labelClass}>Status</label><select className={inputClass} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="paid">Zapłacono</option><option value="incurred">Koszt poniesiony — do zapłaty</option><option value="planned">Planowany (nie liczy się do wyniku)</option></select></div>
              {form.status === 'paid' && <div><label className={labelClass}>Data zapłaty</label><input type="date" className={inputClass} value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} /></div>}
              <div className="sm:col-span-2"><label className={labelClass}>Uwagi</label><textarea className={`${inputClass} min-h-20`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-[#d3bb73]/10 bg-[#1c1f33] px-5 py-4"><button onClick={() => setOpen(false)} disabled={saving} className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2]/70">Anuluj</button><button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Zapisz</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
