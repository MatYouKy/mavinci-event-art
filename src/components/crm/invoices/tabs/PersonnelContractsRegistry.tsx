'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, CalendarDays, CheckCircle2, Link2, Loader2, Plus, ReceiptText, Search, UserRound, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

type ContractKind = 'employment' | 'mandate' | 'specific_work';
type ContractStatus = 'draft' | 'active' | 'completed' | 'terminated';
type LinkType = 'none' | 'employee' | 'subcontractor';
type PaymentType = 'salary' | 'advance' | 'tax' | 'zus' | 'reimbursement' | 'other';
type Relation = { id: string; name?: string; surname?: string; company_name?: string; contact_person?: string };
type Company = { id: string; name: string; legal_name?: string | null; is_default?: boolean };

type ContractRow = {
  id: string;
  employee_id: string | null;
  subcontractor_id: string | null;
  my_company_id: string | null;
  party_name: string;
  party_identifier: string | null;
  contract_kind: ContractKind;
  contract_number: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  gross_value: number | null;
  currency: string;
  status: ContractStatus;
  notes: string | null;
  employees?: Relation | Relation[] | null;
  subcontractors?: Relation | Relation[] | null;
  paymentCount?: number;
  registeredPayments?: number;
};

type ContractPayment = {
  id: string;
  personnel_contract_id: string;
  payment_date: string;
  amount: number;
  currency: string;
  payment_type: PaymentType;
  recipient_name: string;
  title: string | null;
  notes: string | null;
};

const kindLabels: Record<ContractKind, string> = {
  employment: 'Umowa o pracę',
  mandate: 'Umowa zlecenie',
  specific_work: 'Umowa o dzieło',
};
const statusLabels: Record<ContractStatus, string> = {
  draft: 'Szkic',
  active: 'Aktywna',
  completed: 'Zakończona',
  terminated: 'Rozwiązana',
};
const paymentLabels: Record<PaymentType, string> = {
  salary: 'Wynagrodzenie',
  advance: 'Zaliczka',
  tax: 'Podatek / PIT',
  zus: 'ZUS / składki',
  reimbursement: 'Zwrot kosztów',
  other: 'Inna opłata',
};

const money = (value: number | null | undefined, currency = 'PLN') => new Intl.NumberFormat('pl-PL', {
  style: 'currency', currency: currency || 'PLN', maximumFractionDigits: 2,
}).format(Number(value || 0));

const emptyContractForm = (companyId = '') => ({
  my_company_id: companyId,
  link_type: 'none' as LinkType,
  employee_id: '', subcontractor_id: '', party_name: '', party_identifier: '',
  contract_kind: 'employment' as ContractKind,
  contract_number: '', title: 'Umowa o pracę', start_date: '', end_date: '', gross_value: '',
  currency: 'PLN', status: 'draft' as ContractStatus, notes: '',
});
const emptyPaymentForm = (recipient = '') => ({
  payment_date: new Date().toISOString().slice(0, 10), amount: '', currency: 'PLN',
  payment_type: 'salary' as PaymentType, recipient_name: recipient, title: '', notes: '',
});

export function PersonnelContractsRegistry({ filterCompanyIds = null, onChanged }: {
  filterCompanyIds?: string[] | null;
  onChanged?: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [employees, setEmployees] = useState<Relation[]>([]);
  const [subcontractors, setSubcontractors] = useState<Relation[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [activeContractId, setActiveContractId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyContractForm());
  const [saving, setSaving] = useState(false);
  const [payments, setPayments] = useState<ContractPayment[]>([]);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm());
  const [paymentSaving, setPaymentSaving] = useState(false);
  const companyFilterKey = filterCompanyIds === null ? '*' : [...filterCompanyIds].sort().join(',');

  const loadPayments = useCallback(async (contractId: string) => {
    const { data, error } = await supabase.from('personnel_contract_payments')
      .select('id,personnel_contract_id,payment_date,amount,currency,payment_type,recipient_name,title,notes')
      .eq('personnel_contract_id', contractId).order('payment_date', { ascending: false });
    if (error) throw error;
    setPayments((data || []).map((row: any) => ({ ...row, amount: Number(row.amount || 0) })));
  }, []);

  const loadRegistry = useCallback(async () => {
    setLoading(true);
    try {
      const [contractsResult, employeesResult, subcontractorsResult, companiesResult] = await Promise.all([
        supabase.from('personnel_contracts')
          .select('id,employee_id,subcontractor_id,my_company_id,party_name,party_identifier,contract_kind,contract_number,title,start_date,end_date,gross_value,currency,status,notes')
          .order('start_date', { ascending: false }),
        supabase.from('employees').select('id,name,surname,company_name').eq('is_active', true).order('surname'),
        supabase.from('subcontractors').select('id,company_name,contact_person').neq('status', 'inactive').order('company_name'),
        supabase.from('my_companies').select('id,name,legal_name,is_default').eq('is_active', true).order('is_default', { ascending: false }),
      ]);
      const firstError = contractsResult.error || employeesResult.error || subcontractorsResult.error || companiesResult.error;
      if (firstError) throw firstError;

      const allowedCompanyIds = companyFilterKey === '*' ? null : new Set(companyFilterKey.split(',').filter(Boolean));
      const visibleContracts = ((contractsResult.data || []) as any[]).filter(
        (contract) => !allowedCompanyIds || !contract.my_company_id || allowedCompanyIds.has(contract.my_company_id),
      );
      const paymentTotals = new Map<string, { count: number; amount: number }>();
      if (visibleContracts.length) {
        const { data: paymentRows, error: paymentError } = await supabase.from('personnel_contract_payments')
          .select('personnel_contract_id,amount').in('personnel_contract_id', visibleContracts.map((contract) => contract.id));
        if (paymentError) throw paymentError;
        (paymentRows || []).forEach((payment: any) => {
          const current = paymentTotals.get(payment.personnel_contract_id) || { count: 0, amount: 0 };
          paymentTotals.set(payment.personnel_contract_id, { count: current.count + 1, amount: current.amount + Number(payment.amount || 0) });
        });
      }
      setContracts(visibleContracts.map((contract: any) => ({
        ...contract,
        gross_value: contract.gross_value == null ? null : Number(contract.gross_value),
        paymentCount: paymentTotals.get(contract.id)?.count || 0,
        registeredPayments: paymentTotals.get(contract.id)?.amount || 0,
      })));
      setEmployees((employeesResult.data || []) as Relation[]);
      setSubcontractors((subcontractorsResult.data || []) as Relation[]);
      setCompanies((companiesResult.data || []) as Company[]);
    } catch (error: any) {
      console.error('Personnel contracts registry error:', error);
      showSnackbar(error?.message || 'Nie udało się pobrać rejestru umów', 'error');
    } finally { setLoading(false); }
  }, [companyFilterKey, showSnackbar]);

  useEffect(() => { void loadRegistry(); }, [loadRegistry]);

  const openNew = () => {
    const preferredCompany = filterCompanyIds?.length === 1 ? filterCompanyIds[0] : companies.find((company) => company.is_default)?.id || '';
    setActiveContractId(null);
    setForm(emptyContractForm(preferredCompany));
    setPayments([]);
    setPaymentForm(emptyPaymentForm());
    setShowModal(true);
  };

  const openContract = (contract: ContractRow) => {
    const linkType: LinkType = contract.employee_id ? 'employee' : contract.subcontractor_id ? 'subcontractor' : 'none';
    setActiveContractId(contract.id);
    setForm({
      my_company_id: contract.my_company_id || '', link_type: linkType,
      employee_id: contract.employee_id || '', subcontractor_id: contract.subcontractor_id || '',
      party_name: contract.party_name || '', party_identifier: contract.party_identifier || '',
      contract_kind: contract.contract_kind, contract_number: contract.contract_number || '',
      title: contract.title || kindLabels[contract.contract_kind], start_date: contract.start_date || '',
      end_date: contract.end_date || '', gross_value: contract.gross_value == null ? '' : String(contract.gross_value),
      currency: contract.currency || 'PLN', status: contract.status, notes: contract.notes || '',
    });
    setPaymentForm(emptyPaymentForm(contract.party_name));
    setShowModal(true);
    void loadPayments(contract.id).catch((error: any) => showSnackbar(error?.message || 'Nie udało się pobrać opłat do umowy', 'error'));
  };

  const selectEmployee = (employeeId: string) => {
    const employee = employees.find((item) => item.id === employeeId);
    setForm((current) => ({ ...current, employee_id: employeeId, subcontractor_id: '',
      party_name: employee ? [employee.name, employee.surname].filter(Boolean).join(' ') || employee.company_name || current.party_name : current.party_name }));
  };
  const selectSubcontractor = (subcontractorId: string) => {
    const subcontractor = subcontractors.find((item) => item.id === subcontractorId);
    setForm((current) => ({ ...current, employee_id: '', subcontractor_id: subcontractorId,
      party_name: subcontractor?.company_name || subcontractor?.contact_person || current.party_name }));
  };

  const saveContract = async () => {
    if (!form.contract_number.trim() || !form.title.trim() || !form.party_name.trim()) {
      showSnackbar('Podaj numer, tytuł i osobę lub firmę będącą stroną umowy', 'error'); return;
    }
    if (form.link_type === 'employee' && !form.employee_id) { showSnackbar('Wybierz pracownika albo ustaw brak powiązania', 'error'); return; }
    if (form.link_type === 'subcontractor' && !form.subcontractor_id) { showSnackbar('Wybierz podwykonawcę albo ustaw brak powiązania', 'error'); return; }
    const grossValue = form.gross_value === '' ? null : Number(form.gross_value);
    if (grossValue != null && (!Number.isFinite(grossValue) || grossValue < 0)) { showSnackbar('Podaj prawidłową wartość umowy', 'error'); return; }
    try {
      setSaving(true);
      const payload = {
        my_company_id: form.my_company_id || null,
        employee_id: form.link_type === 'employee' ? form.employee_id : null,
        subcontractor_id: form.link_type === 'subcontractor' ? form.subcontractor_id : null,
        party_name: form.party_name.trim(), party_identifier: form.party_identifier.trim() || null,
        contract_kind: form.contract_kind, contract_number: form.contract_number.trim(), title: form.title.trim(),
        start_date: form.start_date || null, end_date: form.end_date || null, gross_value: grossValue,
        currency: form.currency.trim().toUpperCase() || 'PLN', status: form.status, notes: form.notes.trim() || null,
      };
      let savedId = activeContractId;
      if (activeContractId) {
        const { error } = await supabase.from('personnel_contracts').update(payload).eq('id', activeContractId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('personnel_contracts').insert(payload).select('id').single();
        if (error) throw error;
        savedId = data.id; setActiveContractId(data.id);
      }
      setPaymentForm((current) => ({ ...current, recipient_name: current.recipient_name || form.party_name.trim() }));
      showSnackbar(activeContractId ? 'Umowa została zaktualizowana' : 'Umowa została dodana. Możesz teraz dopisać wypłaty i opłaty.', 'success');
      await loadRegistry();
      if (savedId) await loadPayments(savedId);
      onChanged?.();
    } catch (error: any) { showSnackbar(error?.message || 'Nie udało się zapisać umowy', 'error'); }
    finally { setSaving(false); }
  };

  const addPayment = async () => {
    if (!activeContractId) { showSnackbar('Najpierw zapisz umowę', 'error'); return; }
    const amount = Number(paymentForm.amount);
    if (!paymentForm.payment_date || !Number.isFinite(amount) || amount <= 0 || !paymentForm.recipient_name.trim()) {
      showSnackbar('Podaj datę, kwotę i odbiorcę opłaty', 'error'); return;
    }
    try {
      setPaymentSaving(true);
      const { error } = await supabase.from('personnel_contract_payments').insert({
        personnel_contract_id: activeContractId, payment_date: paymentForm.payment_date, amount,
        currency: paymentForm.currency.trim().toUpperCase() || 'PLN', payment_type: paymentForm.payment_type,
        recipient_name: paymentForm.recipient_name.trim(), title: paymentForm.title.trim() || null, notes: paymentForm.notes.trim() || null,
      });
      if (error) throw error;
      showSnackbar('Wypłata lub opłata została dopisana do umowy', 'success');
      setPaymentForm(emptyPaymentForm(form.party_name));
      await Promise.all([loadPayments(activeContractId), loadRegistry()]);
      onChanged?.();
    } catch (error: any) { showSnackbar(error?.message || 'Nie udało się dodać opłaty', 'error'); }
    finally { setPaymentSaving(false); }
  };

  const filteredContracts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pl-PL');
    return needle ? contracts.filter((contract) => [contract.contract_number, contract.title, contract.party_name, contract.party_identifier, kindLabels[contract.contract_kind]].join(' ').toLocaleLowerCase('pl-PL').includes(needle)) : contracts;
  }, [contracts, search]);
  const registeredPaymentsTotal = contracts.reduce((sum, contract) => sum + Number(contract.registeredPayments || 0), 0);

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
        <div className="flex flex-col gap-4 border-b border-[#d3bb73]/10 p-5 lg:flex-row lg:items-center">
          <div className="flex-1"><h3 className="font-medium text-[#e5e4e2]">Umowy pracowników i wykonawców</h3><p className="mt-1 text-xs leading-5 text-[#e5e4e2]/45">Dane osoby są zachowywane w umowie niezależnie od powiązania z kartą w CRM.</p></div>
          <div className="relative min-w-[260px]"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/35" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj osoby, firmy lub numeru…" className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] py-2.5 pl-10 pr-3 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/30 focus:border-[#d3bb73]/45" /></div>
          <button type="button" onClick={openNew} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#0a0d1a] hover:bg-[#e5d799]"><Plus className="h-4 w-4" /> Dodaj umowę</button>
        </div>
        <div className="grid gap-px border-b border-[#d3bb73]/10 bg-[#d3bb73]/10 sm:grid-cols-3">
          <div className="bg-[#141827] px-5 py-3"><span className="text-xs text-[#e5e4e2]/40">Umowy</span><strong className="ml-2 text-[#e5e4e2]">{contracts.length}</strong></div>
          <div className="bg-[#141827] px-5 py-3"><span className="text-xs text-[#e5e4e2]/40">Umowy o pracę</span><strong className="ml-2 text-violet-200">{contracts.filter((contract) => contract.contract_kind === 'employment').length}</strong></div>
          <div className="bg-[#141827] px-5 py-3"><span className="text-xs text-[#e5e4e2]/40">Wypłaty i opłaty</span><strong className="ml-2 text-[#d3bb73]">{money(registeredPaymentsTotal)}</strong></div>
        </div>
        {loading ? <div className="flex min-h-48 items-center justify-center text-sm text-[#e5e4e2]/50"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Ładowanie umów…</div> : filteredContracts.length === 0 ? <div className="px-6 py-14 text-center text-sm text-[#e5e4e2]/50"><Briefcase className="mx-auto mb-3 h-10 w-10 text-[#d3bb73]/45" />Brak umów. Możesz dodać także umowę osoby, której nie ma już w CRM.</div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[980px]"><thead className="bg-[#0a0d1a]/50 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/40"><tr><th className="px-5 py-3">Umowa</th><th className="px-5 py-3">Osoba / firma</th><th className="px-5 py-3">Okres</th><th className="px-5 py-3 text-right">Wartość</th><th className="px-5 py-3 text-right">Wypłaty i opłaty</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Akcja</th></tr></thead><tbody className="divide-y divide-[#d3bb73]/10">{filteredContracts.map((contract) => (
            <tr key={contract.id} className="hover:bg-[#d3bb73]/[0.035]"><td className="px-5 py-4"><span className={`rounded px-2 py-1 text-[11px] ${contract.contract_kind === 'employment' ? 'bg-violet-500/15 text-violet-200' : 'bg-emerald-500/15 text-emerald-200'}`}>{kindLabels[contract.contract_kind]}</span><div className="mt-2 font-medium text-[#e5e4e2]">{contract.contract_number}</div><div className="mt-1 max-w-[240px] truncate text-xs text-[#e5e4e2]/45">{contract.title}</div></td><td className="px-5 py-4"><div className="font-medium text-[#e5e4e2]">{contract.party_name}</div><div className="mt-1 flex items-center gap-1 text-xs text-[#e5e4e2]/40">{contract.employee_id || contract.subcontractor_id ? <><Link2 className="h-3 w-3" /> Powiązana z CRM</> : <><UserRound className="h-3 w-3" /> Dane zapisane w umowie</>}</div></td><td className="px-5 py-4 text-sm text-[#e5e4e2]/60">{contract.start_date ? new Date(contract.start_date).toLocaleDateString('pl-PL') : '—'}{contract.end_date ? ` – ${new Date(contract.end_date).toLocaleDateString('pl-PL')}` : ''}</td><td className="px-5 py-4 text-right text-sm font-medium text-[#e5e4e2]">{contract.gross_value == null ? '—' : money(contract.gross_value, contract.currency)}</td><td className="px-5 py-4 text-right"><div className="text-sm font-medium text-[#d3bb73]">{money(contract.registeredPayments, contract.currency)}</div><div className="mt-1 text-xs text-[#e5e4e2]/40">{contract.paymentCount || 0} pozycji</div></td><td className="px-5 py-4"><span className="rounded-full bg-[#d3bb73]/10 px-2 py-1 text-xs text-[#d3bb73]">{statusLabels[contract.status]}</span></td><td className="px-5 py-4 text-right"><button type="button" onClick={() => openContract(contract)} className="text-xs font-medium text-[#d3bb73] hover:text-[#e5d799]">Otwórz</button></td></tr>
          ))}</tbody></table></div>
        )}
      </div>

      {showModal && <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-3 sm:p-5"><div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/25 bg-[#141827] shadow-2xl">
        <header className="flex items-start justify-between border-b border-[#d3bb73]/15 px-5 py-4"><div><h3 className="text-lg font-medium text-[#e5e4e2]">{activeContractId ? 'Umowa i rozliczenia' : 'Nowa umowa'}</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">Powiązanie z kartą pracownika lub podwykonawcy nie jest wymagane.</p></div><button type="button" onClick={() => setShowModal(false)} className="rounded p-2 text-[#e5e4e2]/55 hover:bg-white/5"><X className="h-5 w-5" /></button></header>
        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1.05fr_0.95fr] lg:overflow-hidden">
          <section className="space-y-4 border-b border-[#d3bb73]/10 p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs text-[#e5e4e2]/60">Rodzaj umowy<select value={form.contract_kind} onChange={(event) => { const kind = event.target.value as ContractKind; setForm((current) => ({ ...current, contract_kind: kind, title: current.title === kindLabels[current.contract_kind] ? kindLabels[kind] : current.title })); }} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="employment">Umowa o pracę</option><option value="mandate">Umowa zlecenie</option><option value="specific_work">Umowa o dzieło</option></select></label>
              <label className="text-xs text-[#e5e4e2]/60">Działalność<select value={form.my_company_id} onChange={(event) => setForm({ ...form, my_company_id: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="">Nie przypisano</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
              <label className="text-xs text-[#e5e4e2]/60">Numer umowy<input value={form.contract_number} onChange={(event) => setForm({ ...form, contract_number: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none" placeholder="np. UOP/01/2025" /></label>
              <label className="text-xs text-[#e5e4e2]/60">Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ContractStatus })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2]">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="text-xs text-[#e5e4e2]/60 sm:col-span-2">Tytuł<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none" /></label>
            </div>
            <div className="rounded-lg border border-violet-400/15 bg-violet-400/5 p-4"><div className="mb-3 text-sm font-medium text-violet-100">Strona umowy</div><div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs text-violet-100/65">Opcjonalne powiązanie<select value={form.link_type} onChange={(event) => setForm({ ...form, link_type: event.target.value as LinkType, employee_id: '', subcontractor_id: '' })} className="mt-2 w-full rounded-lg border border-violet-400/20 bg-[#141827] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="none">Bez powiązania z CRM</option><option value="employee">Pracownik w CRM</option><option value="subcontractor">Podwykonawca w CRM</option></select></label>
              {form.link_type === 'employee' ? <label className="text-xs text-violet-100/65">Pracownik<select value={form.employee_id} onChange={(event) => selectEmployee(event.target.value)} className="mt-2 w-full rounded-lg border border-violet-400/20 bg-[#141827] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="">Wybierz…</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{[employee.name, employee.surname].filter(Boolean).join(' ')}</option>)}</select></label> : form.link_type === 'subcontractor' ? <label className="text-xs text-violet-100/65">Podwykonawca<select value={form.subcontractor_id} onChange={(event) => selectSubcontractor(event.target.value)} className="mt-2 w-full rounded-lg border border-violet-400/20 bg-[#141827] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="">Wybierz…</option>{subcontractors.map((subcontractor) => <option key={subcontractor.id} value={subcontractor.id}>{subcontractor.company_name}</option>)}</select></label> : <div className="rounded-lg bg-[#141827] px-3 py-2.5 text-xs leading-5 text-violet-100/55">Wpisz dane ręcznie — umowa pozostanie kompletna bez rekordu osoby w CRM.</div>}
              <label className="text-xs text-violet-100/65">Imię i nazwisko / firma<input value={form.party_name} onChange={(event) => setForm({ ...form, party_name: event.target.value })} className="mt-2 w-full rounded-lg border border-violet-400/20 bg-[#141827] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none" /></label>
              <label className="text-xs text-violet-100/65">PESEL lub NIP — opcjonalnie<input value={form.party_identifier} onChange={(event) => setForm({ ...form, party_identifier: event.target.value })} className="mt-2 w-full rounded-lg border border-violet-400/20 bg-[#141827] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none" /></label>
            </div></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs text-[#e5e4e2]/60">Od<input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2]" /></label><label className="text-xs text-[#e5e4e2]/60">Do<input type="date" value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2]" /></label>
              <label className="text-xs text-[#e5e4e2]/60">Wartość brutto<input type="number" min="0" step="0.01" value={form.gross_value} onChange={(event) => setForm({ ...form, gross_value: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none" /></label><label className="text-xs text-[#e5e4e2]/60">Waluta<input maxLength={3} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm uppercase text-[#e5e4e2] outline-none" /></label>
              <label className="text-xs text-[#e5e4e2]/60 sm:col-span-2">Notatki<textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none" /></label>
            </div>
            <button type="button" disabled={saving} onClick={() => void saveContract()} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#141827] disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{activeContractId ? 'Zapisz zmiany' : 'Zapisz umowę'}</button>
          </section>
          <section className="min-h-0 space-y-4 p-5 lg:overflow-y-auto"><div><h4 className="flex items-center gap-2 font-medium text-[#e5e4e2]"><ReceiptText className="h-4 w-4 text-[#d3bb73]" /> Wypłaty i inne obciążenia</h4><p className="mt-1 text-xs leading-5 text-[#e5e4e2]/45">Zapisuj wynagrodzenia, zaliczki, PIT, ZUS, zwroty kosztów i inne opłaty związane z tą umową.</p></div>
            {!activeContractId ? <div className="rounded-lg border border-dashed border-[#d3bb73]/20 px-5 py-10 text-center text-sm text-[#e5e4e2]/45">Zapisz umowę, aby dodać wcześniejsze płatności.</div> : <>
              <div className="grid gap-3 rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] p-4 sm:grid-cols-2">
                <label className="text-xs text-[#e5e4e2]/60">Rodzaj<select value={paymentForm.payment_type} onChange={(event) => setPaymentForm({ ...paymentForm, payment_type: event.target.value as PaymentType })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#141827] px-3 py-2 text-sm text-[#e5e4e2]">{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs text-[#e5e4e2]/60">Data<input type="date" value={paymentForm.payment_date} onChange={(event) => setPaymentForm({ ...paymentForm, payment_date: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#141827] px-3 py-2 text-sm text-[#e5e4e2]" /></label>
                <label className="text-xs text-[#e5e4e2]/60">Kwota<input type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#141827] px-3 py-2 text-sm text-[#e5e4e2] outline-none" /></label><label className="text-xs text-[#e5e4e2]/60">Waluta<input maxLength={3} value={paymentForm.currency} onChange={(event) => setPaymentForm({ ...paymentForm, currency: event.target.value.toUpperCase() })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#141827] px-3 py-2 text-sm uppercase text-[#e5e4e2] outline-none" /></label>
                <label className="text-xs text-[#e5e4e2]/60 sm:col-span-2">Odbiorca<input value={paymentForm.recipient_name} onChange={(event) => setPaymentForm({ ...paymentForm, recipient_name: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#141827] px-3 py-2 text-sm text-[#e5e4e2] outline-none" placeholder="Pracownik, ZUS lub urząd skarbowy" /></label><label className="text-xs text-[#e5e4e2]/60 sm:col-span-2">Tytuł / okres<input value={paymentForm.title} onChange={(event) => setPaymentForm({ ...paymentForm, title: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#141827] px-3 py-2 text-sm text-[#e5e4e2] outline-none" placeholder="np. wynagrodzenie za maj 2025" /></label><label className="text-xs text-[#e5e4e2]/60 sm:col-span-2">Notatka<input value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#141827] px-3 py-2 text-sm text-[#e5e4e2] outline-none" /></label>
                <button type="button" disabled={paymentSaving} onClick={() => void addPayment()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#141827] disabled:opacity-50 sm:col-span-2">{paymentSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Dodaj pozycję</button>
              </div>
              <div className="space-y-2">{payments.length === 0 ? <p className="rounded-lg border border-dashed border-[#d3bb73]/15 p-5 text-center text-xs text-[#e5e4e2]/40">Brak zapisanych wypłat lub opłat.</p> : payments.map((payment) => <div key={payment.id} className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-3"><div className="flex items-start justify-between gap-3"><div><span className="rounded bg-[#d3bb73]/10 px-2 py-0.5 text-[11px] text-[#d3bb73]">{paymentLabels[payment.payment_type]}</span><div className="mt-2 text-sm font-medium text-[#e5e4e2]">{payment.recipient_name}</div></div><strong className="text-sm text-[#e5e4e2]">{money(payment.amount, payment.currency)}</strong></div><div className="mt-2 flex items-center gap-2 text-xs text-[#e5e4e2]/45"><CalendarDays className="h-3.5 w-3.5" /> {new Date(payment.payment_date).toLocaleDateString('pl-PL')}{payment.title ? ` • ${payment.title}` : ''}</div>{payment.notes && <p className="mt-2 text-xs text-[#e5e4e2]/50">{payment.notes}</p>}</div>)}</div>
            </>}
          </section>
        </div>
      </div></div>}
    </>
  );
}
