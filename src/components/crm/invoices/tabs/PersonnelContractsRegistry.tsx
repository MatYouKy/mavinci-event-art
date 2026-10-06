'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { MoreVertical, Eye, Trash2, Briefcase, CalendarDays, CheckCircle2, Link2, Loader2, Pencil, Plus, ReceiptText, Save, Search, UserRound, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { PortalDropdownMenu } from '@/components/UI/PortalDropdownMenu/PortalDropdownMenu';
import { usePortalDropdown } from '@/hooks/usePortalDropdown';
import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import Link from 'next/link';
import { PersonnelContractDetails } from '@/components/crm/personnel/PersonnelContractDetails';
import { PersonnelPersonForm } from '@/components/crm/personnel/PersonnelPersonForm';
import { type PersonnelPerson, type PersonnelSettlement, personName, personnelInput } from '@/lib/personnel/workspace';
import { ContractDateField } from '@/components/crm/invoices/ContractTermFields';

import SearchCombobox from '@/components/crm/SearchCombobox';
import { PersonnelNetCostFields, PersonnelNetCostInfo } from '@/components/crm/personnel/PersonnelNetCostFields';
import { emptyNetCostSettings, normalizeNetCostSettings, netBasisLabels, estimateNetCost, type NetCostSettings } from '@/lib/personnel/netCostEstimate';
import { PersonnelDocumentFields } from '@/components/crm/personnel/PersonnelDocumentFields';
import { PersonnelContractAddressFields } from '@/components/crm/personnel/PersonnelContractAddressFields';
import { matchesProfileAddress, normalizeProfileAddress } from '@/components/crm/subcontractors/profileAddress';
import { employeeContractAddress, formatPersonnelAddress as formatProfileAddress } from '@/lib/personnel/employeeAddress';
import { emptyDocumentDetails, normalizeDocumentDetails, type PersonnelDocumentDetails } from '@/lib/personnel/documentFields';
import { PersonnelQuestionnaireFields, PersonnelWizardIssues, PersonnelWizardSummary } from '@/components/crm/personnel/PersonnelQuestionnaireFields';
import { assessQuestionnaire, newQuestionnaire, profileFromQuestionnaire, wizardSteps } from '@/lib/personnel/questionnaire';
import { contractWizardIssues } from '@/lib/personnel/contractWizard';
import { emptyPayrollProfile, normalizePayrollProfile, contractPrefix, type PersonnelPayrollProfile } from '@/lib/personnel/legal';

type ContractKind = 'employment' | 'mandate' | 'specific_work';
type ContractKindChoice = ContractKind | 'oral';
type ContractStatus = 'draft' | 'active' | 'completed' | 'terminated';
type ContractTerm = 'fixed' | 'indefinite';
type LinkType = 'none' | 'employee' | 'person' | 'subcontractor';
type PaymentType = 'salary' | 'advance' | 'tax' | 'zus' | 'reimbursement' | 'other';
type Relation = { id: string; name?: string; surname?: string; company_name?: string; contact_person?: string };
type Company = { id: string; name: string; legal_name?: string | null; is_default?: boolean };

type ContractRow = {
  agreement_form: string; payment_method: string; engagement_scope: string; event_id: string | null; settlement_cycle: string; payroll_profile: PersonnelPayrollProfile;
  id: string;
  subcontractor_task_id: string | null;
  person_id: string | null;
  signed_date: string | null;
  party_address: string | null;
  party_bank_account: string | null;
  party_kind: string | null;
  work_scope: string | null;
  payment_terms: string | null;
  additional_terms: string | null;
  issuer_representative: string | null;
  updated_at: string;
  employee_id: string | null;
  subcontractor_id: string | null;
  my_company_id: string | null;
  party_name: string;
  party_identifier: string | null;
  contract_kind: ContractKind;
  contract_term?: ContractTerm | null;
  contract_number: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  gross_value: number | null;
  document_details: PersonnelDocumentDetails;
  planned_net_amount: number | null;
  net_cost_settings: NetCostSettings | null;
  currency: string;
  status: ContractStatus;
  notes: string | null;
  employees?: Relation | Relation[] | null;
  subcontractors?: Relation | Relation[] | null;
  paymentCount?: number;
  registeredPayments?: number;
  registeredByCurrency?: Record<string, number>;
};

type ContractPayment = {
  payment_method: string; receipt_reference: string | null;
  id: string;
  settlement_id: string | null;
  personnel_contract_id: string;
  payment_date: string;
  amount: number;
  currency: string;
  payment_type: PaymentType;
  recipient_name: string;
  title: string | null;
  notes: string | null;
  bank_transaction_id: string | null;
  payroll_total_amount: number | null;
  payroll_net_confirmed: boolean;
  updated_at: string;
};

const kindLabels: Record<ContractKind, string> = {
  employment: 'Umowa o pracę',
  mandate: 'Umowa zlecenie',
  specific_work: 'Umowa o dzieło',
};
const oralContractLabel = 'Umowa ustna — dżentelmeńska';
const displayedContractKind = (contract: Pick<ContractRow, 'agreement_form' | 'contract_kind'>) => contract.agreement_form === 'oral' ? oralContractLabel : kindLabels[contract.contract_kind];
const statusLabels: Record<ContractStatus, string> = {
  draft: 'Szkic',
  active: 'Aktywna',
  completed: 'Zakończona',
  terminated: 'Rozwiązana',
};
const termLabels: Record<ContractTerm, string> = { fixed: 'Na czas określony', indefinite: 'Na czas nieokreślony' };
const isClosedContract = (status: ContractStatus) => status === 'completed' || status === 'terminated';
function validContractDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
function contractOccursInMonth(contract: ContractRow, start: string, end: string): boolean {
  if (!contract.start_date || !validContractDate(contract.start_date)) return false;
  const startsThisMonth = contract.start_date >= start && contract.start_date < end;
  if (contract.contract_term === 'fixed') return startsThisMonth;
  // Legacy rows retain their date range; a closed record without an end is not perpetual.
  if (isClosedContract(contract.status) && !contract.end_date) return startsThisMonth;
  return contract.start_date < end && (!contract.end_date || contract.end_date >= start);
}
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
  agreement_form: 'written', payment_method:'bank', engagement_scope:'period', event_id:'', settlement_cycle:'monthly', payroll_profile:{...emptyPayrollProfile(),questionnaire:newQuestionnaire()},
  link_type: 'none' as LinkType,
  employee_id: '', subcontractor_id: '', party_name: '', party_identifier: '',
  subcontractor_task_id: '', person_id: '', signed_date: '', party_address: '', party_bank_account: '', party_kind: 'person', work_scope: '', payment_terms: '', additional_terms: '', issuer_representative: '',
  contract_kind: 'mandate' as ContractKind,
  contract_term: 'fixed' as ContractTerm | '', term_ended: false,
  contract_number: '', title: 'Umowa zlecenie', start_date: '', end_date: '', gross_value: '',
  document_details:emptyDocumentDetails(),
  planned_net_amount: '', net_cost_settings: {...emptyNetCostSettings(), payment_date:'',work_from:'',work_to:''},
  currency: 'PLN', status: 'draft' as ContractStatus, notes: '',
});
const emptyPaymentForm = (recipient = '') => ({
  settlement_id: '', payment_method:'bank', receipt_reference:'',
  payment_date: new Date().toISOString().slice(0, 10), amount: '', currency: 'PLN',
  payment_type: 'salary' as PaymentType, recipient_name: recipient, title: '', notes: '',
  payroll_total_amount: '', payroll_net_confirmed: false,
});
const paymentToForm = (payment: ContractPayment) => ({
  settlement_id: payment.settlement_id || '', payment_method:payment.payment_method||'bank',receipt_reference:payment.receipt_reference||'',
  payment_date: payment.payment_date, amount: String(payment.amount), currency: payment.currency,
  payment_type: payment.payment_type, recipient_name: payment.recipient_name,
  title: payment.title || '', notes: payment.notes || '',
  payroll_total_amount: payment.payroll_total_amount == null ? '' : String(payment.payroll_total_amount),
  payroll_net_confirmed: payment.payroll_net_confirmed,
});

export function PersonnelContractsRegistry({ filterCompanyIds = null, month, year, readOnly = false, onChanged, filterPersonId, filterEmployeeId, filterSubcontractorId, periodMode = 'accounting', statusFilter = '', kindFilter = '', startNew = false }: {
  startNew?: boolean;
  filterPersonId?: string; filterEmployeeId?: string; filterSubcontractorId?: string;
  periodMode?: 'accounting' | 'signed' | 'active'; statusFilter?: string; kindFilter?: string;
  filterCompanyIds?: string[] | null;
  month?: number;
  year?: number;
  readOnly?: boolean;
  onChanged?: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const contractMenu = usePortalDropdown({menuWidth:208,align:'right',closeOnScroll:true});
  const deleteLock = useRef(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  async function deleteDraft(contract: ContractRow) {
    if (readOnly || contract.status !== 'draft' || deleteLock.current) return;
    deleteLock.current = true;
    try {
      if (!await showConfirm({title:'Usuń szkic umowy',message:`Czy usunąć szkic „${contract.title || contract.contract_number}” dla ${contract.party_name || 'tej osoby'}? Tej operacji nie można cofnąć.`,confirmText:'Usuń szkic',cancelText:'Anuluj'})) return;
      setDeletingId(contract.id);
      const { error } = await supabase.rpc('delete_personnel_contract_draft', {p_id:contract.id,p_updated_at:contract.updated_at});
      if(error) throw error;
      setContracts(current=>current.filter(row=>row.id!==contract.id));
      showSnackbar('Szkic umowy został usunięty.', 'success');
      onChanged?.();
    } catch(error:any) {showSnackbar(error.message || 'Nie udało się usunąć szkicu.', 'error');}
    finally {deleteLock.current=false;setDeletingId(null);}
  }
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [subcontractorTasks,setSubcontractorTasks] = useState<{id:string;task_name:string;event_id:string}[]>([]);
  const [periodSettlements,setPeriodSettlements] = useState<PersonnelSettlement[]>([]);
  const [events,setEvents] = useState<{id:string;name:string}[]>([]);
  const [people, setPeople] = useState<PersonnelPerson[]>([]);
  const [addingPerson, setAddingPerson] = useState(false);
  const [settlements, setSettlements] = useState<PersonnelSettlement[]>([]);
  const [revision, setRevision] = useState(0);
  const [originalUpdatedAt, setOriginalUpdatedAt] = useState<string | null>(null);
  const [formOriginal, setFormOriginal] = useState('');
  const [employees, setEmployees] = useState<Relation[]>([]);
  const [subcontractors, setSubcontractors] = useState<Relation[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [termSchemaAvailable, setTermSchemaAvailable] = useState<boolean | null>(null);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [activeContractId, setActiveContractId] = useState<string | null>(null);
  const [form, setFormState] = useState(emptyContractForm());
  const [wizardStep,setWizardStep] = useState(0);
  const [stepAttempted,setStepAttempted] = useState(false);
  const wizardBody = useRef<HTMLFieldSetElement>(null);
  const setForm = useCallback((action:SetStateAction<ReturnType<typeof emptyContractForm>>) => setFormState(current=>{
    let next=typeof action==='function'?action(current):action;
    const partyChanged=next.person_id!==current.person_id||next.employee_id!==current.employee_id||next.subcontractor_id!==current.subcontractor_id||next.link_type!==current.link_type;
    if(partyChanged || (next.party_address!==current.party_address && next.document_details.party_address_parts===current.document_details.party_address_parts)) {
      const {party_address_parts:previousParts,...details}=next.document_details;
      const person=partyChanged ? people.find(p=>(next.person_id&&p.id===next.person_id)||(next.employee_id&&p.employee_id===next.employee_id)||(next.subcontractor_id&&p.subcontractor_id===next.subcontractor_id)) : undefined;
      const parts=person?.address_parts ? normalizeProfileAddress(person.address_parts) : undefined;
      next={...next,document_details:parts&&(matchesProfileAddress(parts,next.party_address)||formatProfileAddress(parts)===next.party_address)?{...details,party_address_parts:parts}:details};
      if(parts&&(matchesProfileAddress(parts,next.party_address)||formatProfileAddress(parts)===next.party_address))next.party_address=formatProfileAddress(parts);
    }
    const fingerprint=(f:ReturnType<typeof emptyContractForm>)=>JSON.stringify({...f,status:undefined,notes:undefined,payroll_profile:{...f.payroll_profile,questionnaire:{...f.payroll_profile.questionnaire,confirmed:undefined}}});
    if(fingerprint(current)!==fingerprint(next))return {...next,payroll_profile:{...next.payroll_profile,questionnaire:{...(next.payroll_profile.questionnaire||newQuestionnaire()),confirmed:false}}};
    return next;
  }),[people]);
  const questionnaireContext={kind:form.contract_kind,profile:profileFromQuestionnaire(form.payroll_profile),settings:form.net_cost_settings,partyKind:form.party_kind,currency:form.currency};
  const questionnaireResult=assessQuestionnaire(questionnaireContext);
  const guidedSettings={...form.net_cost_settings,...questionnaireResult.settings};
  const wizardIssues=contractWizardIssues(form);
  const navigateWizard=(step:number)=>{
    const incomplete=wizardIssues.filter(i=>!i.review&&i.step<step);
    if(step>wizardStep&&incomplete.length){setWizardStep(incomplete[0].step);setStepAttempted(true);}
    else {setWizardStep(step);setStepAttempted(false);}
    wizardBody.current?.scrollTo({top:0,behavior:'smooth'});
  };

  const [saving, setSaving] = useState(false);
  const [payments, setPayments] = useState<ContractPayment[]>([]);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm());
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editingPaymentOriginal, setEditingPaymentOriginal] = useState<ContractPayment | null>(null);
  const paymentFormRef = useRef<HTMLFieldSetElement>(null);
  const paymentSaveLock = useRef(false);
  const paymentDirty = editingPaymentOriginal != null && JSON.stringify(paymentForm) !== JSON.stringify(paymentToForm(editingPaymentOriginal));
  const companyFilterKey = filterCompanyIds === null ? '*' : [...filterCompanyIds].sort().join(',');
  const periodStart = year && (month || periodMode !== 'accounting') ? `${year}-${String(month || 1).padStart(2, '0')}-01` : null;
  const periodEnd = periodStart && year ? new Date(Date.UTC(year, month || 12, 1)).toISOString().slice(0, 10) : null;
  const monthlyPaymentForm = (recipient = '') => ({ ...emptyPaymentForm(recipient), ...(periodStart ? { payment_date: periodStart } : {}) });

  const loadPayments = useCallback(async (contractId: string) => {
    const { data, error } = await supabase.from('personnel_contract_payments')
      .select('id,settlement_id,personnel_contract_id,payment_date,amount,currency,payment_type,recipient_name,title,notes,bank_transaction_id,payroll_total_amount,payroll_net_confirmed,updated_at,payment_method,receipt_reference')
      .eq('personnel_contract_id', contractId).order('payment_date', { ascending: false });
    if (error) throw error;
    const balances = await supabase.from('personnel_settlement_balances').select('*').eq('contract_id',contractId).order('period',{ascending:false});
    if (balances.error) throw balances.error;
    setSettlements(balances.data || []);
    setPayments((data || []).map((row: any) => ({
      ...row, amount: Number(row.amount || 0),
      payroll_total_amount: row.payroll_total_amount == null ? null : Number(row.payroll_total_amount),
      payroll_net_confirmed: row.payroll_net_confirmed === true,
    })));
  }, []);

  const loadRegistry = useCallback(async () => {
    setLoading(true);
    setContracts([]);setPeriodSettlements([]);
    try {
      const allowedCompanyIds = companyFilterKey === '*' ? null : companyFilterKey.split(',').filter(Boolean);
      const loadContracts = async () => {
        if (allowedCompanyIds?.length === 0) return { data: [], error: null };
        const rows: ContractRow[] = [];
        for (let from = 0; ; from += 200) {
          let query = supabase.from('personnel_contracts')
            .select('*')
            .order('id').range(from, from + 199);
          if (allowedCompanyIds) query = query.in('my_company_id', allowedCompanyIds);
          if (filterPersonId) query = query.eq('person_id',filterPersonId);
          if (filterEmployeeId) {
            const identity = await supabase.from('personnel_people').select('id').eq('employee_id',filterEmployeeId).maybeSingle();
            if(identity.error) throw identity.error;
            query = identity.data ? query.or(`employee_id.eq.${filterEmployeeId},person_id.eq.${identity.data.id}`) : query.eq('employee_id',filterEmployeeId);
          }
          if (filterSubcontractorId) {
            const identity = await supabase.from('personnel_people').select('id').eq('subcontractor_id',filterSubcontractorId).maybeSingle();
            if(identity.error) throw identity.error;
            query = identity.data ? query.or(`subcontractor_id.eq.${filterSubcontractorId},person_id.eq.${identity.data.id}`) : query.eq('subcontractor_id',filterSubcontractorId);
          }
          const result = await query;
          if (result.error) throw result.error;
          rows.push(...(result.data || []) as ContractRow[]);
          if (!result.data || result.data.length < 200) return { data: rows, error: null };
        }
      };
      const [contractsResult, employeesResult, subcontractorsResult, companiesResult, peopleResult] = await Promise.all([
        loadContracts(),
        readOnly ? Promise.resolve({data:[],error:null}) : supabase.rpc('personnel_picker_employees'),
        readOnly ? Promise.resolve({data:[],error:null}) : supabase.rpc('personnel_picker_subcontractors'),
        readOnly ? Promise.resolve({data:[],error:null}) : supabase.rpc('personnel_picker_companies'),
        supabase.from('personnel_people').select('*').order('surname'),
      ]);
      const firstError = contractsResult.error || employeesResult.error || subcontractorsResult.error || companiesResult.error || peopleResult.error;
      if (firstError) throw firstError;

      const allContracts = contractsResult.data as ContractRow[];
      const employeeAddresses = new Map<string, {id:string;address_street:string|null;address_city:string|null;address_postal_code:string|null}>();
      if (!readOnly) {
        for (let from = 0; ; from += 500) {
          const result = await supabase.from('employees').select('id,address_street,address_city,address_postal_code').order('id').range(from, from + 499);
          if (result.error) throw result.error;
          (result.data || []).forEach(row => employeeAddresses.set(row.id, row));
          if (!result.data || result.data.length < 500) break;
        }
      }
      setPeople(((peopleResult.data || []) as PersonnelPerson[]).map(person => {
        const parts = person.employee_id ? employeeContractAddress(employeeAddresses.get(person.employee_id), person.address_parts) : undefined;
        return parts ? { ...person, address_parts: parts, address: formatProfileAddress(parts) } : person;
      }));
      setTermSchemaAvailable(allContracts.length ? allContracts.every((contract) => Object.prototype.hasOwnProperty.call(contract, 'contract_term')) : null);
      const settlementRows: PersonnelSettlement[] = [];
      const paymentTotals = new Map<string, { count: number; byCurrency: Record<string, number> }>();
      for (let offset = 0; offset < allContracts.length; offset += 100) {
        const ids = allContracts.slice(offset, offset + 100).map((contract) => contract.id);
        for(let from=0;;from+=200){
          let q=supabase.from('personnel_settlement_balances').select('*').in('contract_id',ids).order('id').range(from,from+199);
          if(periodStart && periodEnd) q=q.gte('period',periodStart).lt('period',periodEnd);
          const {data,error}=await q;if(error)throw error;settlementRows.push(...(data||[]));if(!data||data.length<200)break;
        }
        for (let from = 0; ; from += 200) {
          let query = supabase.from('personnel_contract_payments').select('id,personnel_contract_id,amount,currency')
            .in('personnel_contract_id', ids).order('id').range(from, from + 199);
          if (periodStart && periodEnd) query = query.gte('payment_date', periodStart).lt('payment_date', periodEnd);
          const { data: paymentRows, error: paymentError } = await query;
          if (paymentError) throw paymentError;
          (paymentRows || []).forEach((payment) => {
            const current = paymentTotals.get(payment.personnel_contract_id) || { count: 0, byCurrency: {} };
            const currency = payment.currency || 'PLN';
            current.count += 1;
            current.byCurrency[currency] = (current.byCurrency[currency] || 0) + Number(payment.amount || 0);
            paymentTotals.set(payment.personnel_contract_id, current);
          });
          if (!paymentRows || paymentRows.length < 200) break;
        }
      }
      const visibleContracts = allContracts.filter(contract => {
        if(statusFilter && contract.status!==statusFilter) return false;
        if(kindFilter && (kindFilter==='oral' ? contract.agreement_form!=='oral' : contract.contract_kind!==kindFilter || contract.agreement_form==='oral')) return false;
        if(!periodStart || !periodEnd) return true;
        if(periodMode==='signed') return !!contract.signed_date && contract.signed_date>=periodStart && contract.signed_date<periodEnd;
        if(periodMode==='active') return contract.status!=='draft' && !!contract.start_date && contract.start_date<periodEnd && (!contract.end_date || contract.end_date>=periodStart);
        return settlementRows.some(s=>s.contract_id===contract.id) || Boolean(paymentTotals.get(contract.id)?.count) || contractOccursInMonth(contract,periodStart,periodEnd);
      });
      setPeriodSettlements(settlementRows.filter(s=>visibleContracts.some(c=>c.id===s.contract_id)));
      setContracts(visibleContracts.map((contract: any) => ({
        ...contract,
        gross_value: contract.gross_value == null ? null : Number(contract.gross_value),
        paymentCount: paymentTotals.get(contract.id)?.count || 0,
        registeredByCurrency: paymentTotals.get(contract.id)?.byCurrency || {},
        registeredPayments: paymentTotals.get(contract.id)?.byCurrency[contract.currency || 'PLN'] || 0,
      })).sort((left, right) => String(right.start_date || '').localeCompare(String(left.start_date || '')) || left.id.localeCompare(right.id)));
      setEmployees((employeesResult.data || []) as Relation[]);
      setSubcontractors((subcontractorsResult.data || []) as Relation[]);
      setCompanies(((companiesResult.data || []) as Company[]).filter((company) => !allowedCompanyIds || allowedCompanyIds.includes(company.id)));
    } catch (error: any) {
      console.error('Personnel contracts registry error:', error);
      showSnackbar(error?.message || 'Nie udało się pobrać rejestru umów', 'error');
    } finally { setLoading(false); }
  }, [companyFilterKey, periodStart, periodEnd, showSnackbar, readOnly, filterPersonId, filterEmployeeId, filterSubcontractorId, periodMode, statusFilter, kindFilter]);

  useEffect(() => { void loadRegistry(); }, [loadRegistry]);
  useEffect(()=>{if(readOnly||!showModal)return;let cancelled=false;void(async()=>{const all:{id:string;name:string}[]=[];for(let from=0;;from+=500){const r=await supabase.from('events').select('id,name').order('id').range(from,from+499);if(r.error)throw r.error;all.push(...r.data);if(r.data.length<500)break;}if(!cancelled)setEvents(all);})().catch(e=>showSnackbar(e.message,'error'));return()=>{cancelled=true;};},[readOnly,showModal,showSnackbar]);
  useEffect(()=>{
    setSubcontractorTasks([]);
    if(form.link_type==='subcontractor' && form.subcontractor_id && !readOnly) void supabase.from('subcontractor_tasks').select('id,task_name,event_id').eq('subcontractor_id',form.subcontractor_id).neq('status','cancelled').then(({data,error})=>{if(error)showSnackbar(error.message,'error');else setSubcontractorTasks(data||[]);});
  },[form.link_type,form.subcontractor_id,readOnly,showSnackbar]);
  useEffect(() => {
    if (!editingPaymentId) return;
    paymentFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    paymentFormRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true });
  }, [editingPaymentId]);

  const cancelPaymentEdit = () => {
    if (paymentSaveLock.current) return;
    if (paymentDirty && !window.confirm('Odrzucić niezapisane zmiany tej wypłaty?')) return;
    setEditingPaymentId(null); setEditingPaymentOriginal(null);
    setPaymentForm({...emptyPaymentForm(form.party_name),payment_method:form.payment_method});
  };
  const closeModal = () => {
    if (saving || paymentSaveLock.current) return;
    if ((paymentDirty || (formOriginal && JSON.stringify(form) !== formOriginal)) && !window.confirm('Zamknąć okno i odrzucić niezapisane zmiany?')) return;
    setShowModal(false);
  };

  const openNew = () => {
    if (readOnly) return;
    const preferredCompany = filterCompanyIds?.length === 1 ? filterCompanyIds[0] : companies.find((company) => company.is_default)?.id || '';
    setActiveContractId(null);
    const person = people.find(p => p.id === filterPersonId || (filterEmployeeId && p.employee_id === filterEmployeeId));
    const subcontractor = subcontractors.find(p => p.id === filterSubcontractorId);
    const subcontractorPerson = people.find(p => p.subcontractor_id === filterSubcontractorId);
    const next = { ...emptyContractForm(preferredCompany), signed_date: localToday(), start_date: periodStart || localToday(),
      ...(person ? {person_id:person.id,employee_id:person.employee_id || '',link_type:(person.employee_id?'employee':'person') as LinkType,party_name:personName(person),party_identifier:person.identifier || '',party_address:person.address || '',party_bank_account:person.bank_account || ''} : {}),
      ...(subcontractor ? {subcontractor_id:subcontractor.id,link_type:'subcontractor' as LinkType,party_name:subcontractor.company_name || '',party_kind:subcontractorPerson||startNew?'person':'',party_identifier:subcontractorPerson?.identifier||'',party_address:subcontractorPerson?.address||'',party_bank_account:subcontractorPerson?.bank_account||''} : {}) };
    const sourcePerson=person || subcontractorPerson;
    if(sourcePerson?.address_parts) {
      const parts=normalizeProfileAddress(sourcePerson.address_parts);
      if((matchesProfileAddress(parts,next.party_address)||formatProfileAddress(parts)===next.party_address)) {
        next.document_details={...next.document_details,party_address_parts:parts};
        next.party_address=formatProfileAddress(parts);
      }
    }
    setFormState(next);setWizardStep(0);setStepAttempted(false);setFormOriginal(JSON.stringify(next));setOriginalUpdatedAt(null);setAddingPerson(false);setSettlements([]);
    setPayments([]);
    setPaymentForm(monthlyPaymentForm());
    setEditingPaymentId(null);
    setEditingPaymentOriginal(null);
    setShowModal(true);
  };

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!startNew || autoStarted.current || readOnly || !subcontractors.some(s => s.id === filterSubcontractorId) || !companies.length) return;
    autoStarted.current = true;
    openNew();
  }, [startNew, readOnly, subcontractors, companies, filterSubcontractorId]);

  const openContract = (contract: ContractRow) => {
    const linkedPerson = people.find(p=>p.id===contract.person_id);
    const linkType: LinkType = (linkedPerson?.employee_id || contract.employee_id) ? 'employee' : contract.person_id ? 'person' : contract.subcontractor_id ? 'subcontractor' : 'none';
    setActiveContractId(contract.id);
    const next = {
      ...emptyContractForm(),
      agreement_form:contract.agreement_form||'written',payment_method:contract.payment_method||'bank',engagement_scope:contract.engagement_scope||'period',event_id:contract.event_id||'',settlement_cycle:contract.settlement_cycle||'monthly',payroll_profile:{...normalizePayrollProfile(contract.payroll_profile),questionnaire:contract.payroll_profile?.questionnaire||newQuestionnaire()},
      my_company_id: contract.my_company_id || '', link_type: linkType,
      employee_id: linkedPerson?.employee_id || contract.employee_id || '', subcontractor_id: contract.subcontractor_id || '',
      subcontractor_task_id: contract.subcontractor_task_id || '',
      person_id: contract.person_id || '', signed_date: contract.signed_date || '', party_address: contract.party_address || '', party_bank_account: contract.party_bank_account || '', party_kind: contract.party_kind || '', work_scope: contract.work_scope || '', payment_terms: contract.payment_terms || '', additional_terms: contract.additional_terms || '', issuer_representative: contract.issuer_representative || '',
      party_name: contract.party_name || '', party_identifier: contract.party_identifier || '',
      contract_kind: contract.contract_kind, contract_number: contract.contract_number || '',
      contract_term: (contract.contract_term || '') as ContractTerm | '',
      term_ended: contract.contract_term === 'indefinite' && (Boolean(contract.end_date) || isClosedContract(contract.status)),
      title: contract.title || kindLabels[contract.contract_kind], start_date: contract.start_date || '',
      end_date: contract.end_date || '', gross_value: contract.gross_value == null ? '' : String(contract.gross_value),
      document_details:normalizeDocumentDetails(contract.document_details),
      planned_net_amount: contract.planned_net_amount == null ? '' : String(contract.planned_net_amount),
      net_cost_settings: {...normalizeNetCostSettings(contract.net_cost_settings),payment_date:contract.net_cost_settings?.payment_date||localToday()},
      currency: contract.currency || 'PLN', status: contract.status, notes: contract.notes || '',
    };
    const addressPerson = people.find(person => person.id === next.person_id || Boolean(next.employee_id && person.employee_id === next.employee_id));
    if (!next.party_address.trim() && addressPerson?.address) {
      next.party_address = addressPerson.address;
      if (addressPerson.address_parts) next.document_details.party_address_parts = normalizeProfileAddress(addressPerson.address_parts);
    } else if (!next.document_details.party_address_parts && addressPerson?.address_parts) {
      const parts = normalizeProfileAddress(addressPerson.address_parts);
      if (matchesProfileAddress(parts, next.party_address) || formatProfileAddress(parts) === next.party_address) next.document_details.party_address_parts = parts;
    }
    setFormState(next);setWizardStep(5);setStepAttempted(false);setFormOriginal(JSON.stringify(next));setOriginalUpdatedAt(contract.updated_at);setAddingPerson(false);
    setPaymentForm({...monthlyPaymentForm(contract.party_name),payment_method:contract.payment_method||'bank'});
    setEditingPaymentId(null);
    setEditingPaymentOriginal(null);
    setPayments([]);
    setShowModal(true);
    void loadPayments(contract.id).catch((error: any) => showSnackbar(error?.message || 'Nie udało się pobrać opłat do umowy', 'error'));
  };

  const selectEmployee = (employeeId: string) => {
    const person = people.find(p=>p.employee_id===employeeId);
    const employee = employees.find((item) => item.id === employeeId);
    setForm((current) => ({ ...current, payroll_profile:{...emptyPayrollProfile(),questionnaire:newQuestionnaire()}, net_cost_settings:{...current.net_cost_settings,insurance:'auto',youth_remaining:'',pit_credit:'0',sickness:false}, employee_id: employeeId, subcontractor_id: '', person_id: person?.id || '', party_kind:'person', party_identifier:person?.identifier||'',party_address:person?.address||'',party_bank_account:person?.bank_account||'',
      party_name: employee ? [employee.name, employee.surname].filter(Boolean).join(' ') || employee.company_name || current.party_name : current.party_name }));
  };
  const selectSubcontractor = (subcontractorId: string) => {
    const subcontractor = subcontractors.find((item) => item.id === subcontractorId);
    const person = people.find(p=>p.subcontractor_id===subcontractorId);
    setForm((current) => ({ ...current, payroll_profile:{...emptyPayrollProfile(),questionnaire:newQuestionnaire()}, net_cost_settings:{...current.net_cost_settings,insurance:'auto',youth_remaining:'',pit_credit:'0',sickness:false}, employee_id: '', subcontractor_id: subcontractorId,person_id:'',subcontractor_task_id:'',party_kind:person?'person':'',party_identifier:person?.identifier||'',party_address:person?.address||'',party_bank_account:person?.bank_account||'',
      party_name: subcontractor?.company_name || subcontractor?.contact_person || current.party_name }));
  };

  const selectPerson = (person: PersonnelPerson) => setForm(current => ({...current,payroll_profile:{...emptyPayrollProfile(),questionnaire:newQuestionnaire()},net_cost_settings:{...current.net_cost_settings,insurance:'auto',youth_remaining:'',pit_credit:'0',sickness:false},person_id:person.id,employee_id:person.employee_id || '',subcontractor_id:'',link_type:person.employee_id?'employee':'person',party_kind:'person',party_name:personName(person),party_identifier:person.identifier||'',party_address:person.address||'',party_bank_account:person.bank_account||''}));

  // The visible oral option is a preset; stored legal kind still controls numbering and settlements.
  const selectContractKind = (choice: ContractKindChoice) => {
    setForm(current => {
      const oral = choice === 'oral';
      const kind: ContractKind = oral ? (current.contract_kind === 'employment' ? 'mandate' : current.contract_kind) : choice;
      const defaultTitle = Object.values(kindLabels).includes(current.title) || current.title === oralContractLabel;
      return {
        ...current,
        contract_kind: kind,
        agreement_form: oral ? 'oral' : 'written',
        payment_method: oral ? 'cash' : current.payment_method,
        settlement_cycle: kind === 'employment' ? 'monthly' : current.settlement_cycle,
        net_cost_settings: {...current.net_cost_settings, small_contract:kind==='employment'?false:current.net_cost_settings.small_contract},
        title: defaultTitle ? (oral ? oralContractLabel : kindLabels[kind]) : current.title,
      };
    });
  };

  const saveContract = async (draftOnly=false) => {
    const requestedStatus=draftOnly?'draft':form.status;
    const issues=contractWizardIssues(form);
    if(!draftOnly && (issues.length || !form.payroll_profile.questionnaire?.confirmed)) {
      setWizardStep(5);setStepAttempted(true);
      showSnackbar('Uzupełnij kroki i potwierdź podsumowanie albo zapisz szkic do uzupełnienia.','error');return;
    }
    const resolvedProfile=profileFromQuestionnaire({...form.payroll_profile,questionnaire:{...(form.payroll_profile.questionnaire||newQuestionnaire()),confirmed:!draftOnly&&form.payroll_profile.questionnaire?.confirmed===true}});
    const resolvedSettings={...form.net_cost_settings,...assessQuestionnaire({...questionnaireContext,profile:resolvedProfile}).settings};
    const estimate=estimateNetCost(Number(form.planned_net_amount),resolvedSettings,{...questionnaireContext,profile:resolvedProfile});
    if(!draftOnly&&form.contract_kind==='employment'&&estimate.breakdown){const [n,d]=form.document_details.work_time_fraction.split('/').map(Number);if(n>0&&d>0&&estimate.breakdown.gross<4806*n/d){setWizardStep(4);showSnackbar('Plan netto daje brutto poniżej minimum dla tego wymiaru etatu. Zwiększ kwotę albo popraw wymiar.','error');return;}}
    if(!draftOnly && estimate.issue){setWizardStep(4);showSnackbar(estimate.issue,'error');return;}

    if (readOnly) return;
    if (filterCompanyIds && (!draftOnly || form.my_company_id) && !filterCompanyIds.includes(form.my_company_id)) { showSnackbar('Wybierz działalność z bieżącego kontekstu rozliczenia.', 'error'); return; }
    if (saving || paymentSaveLock.current) return;
    if (termSchemaAvailable === false) {
      showSnackbar('Wybór czasu trwania umowy wymaga aktualizacji bazy. Wdróż migrację zakresów umów i odśwież rejestr. Dotychczasowe dane i wypłaty pozostają bez zmian.', 'error'); return;
    }
    if (!draftOnly && form.contract_term !== 'fixed' && form.contract_term !== 'indefinite') {
      showSnackbar('Wybierz, czy umowa jest na czas określony, czy nieokreślony. W starszych umowach ten wybór nie był zapisany.', 'error'); return;
    }
    if ((!draftOnly || form.start_date) && !validContractDate(form.start_date)) {
      showSnackbar('Podaj prawidłową datę rozpoczęcia umowy w formacie DD.MM.RRRR.', 'error'); return;
    }
    const needsEndDate = form.contract_term === 'fixed' || form.term_ended;
    if (needsEndDate && (!draftOnly || form.end_date) && !validContractDate(form.end_date)) {
      showSnackbar(form.contract_term === 'fixed' ? 'Umowa na czas określony wymaga prawidłowej daty końca.' : 'Zaznaczone zakończenie umowy wymaga prawidłowej daty końca.', 'error'); return;
    }
    if (needsEndDate && form.end_date && form.start_date && form.end_date < form.start_date) {
      showSnackbar('Data końca umowy nie może być wcześniejsza od daty rozpoczęcia.', 'error'); return;
    }
    if (form.contract_term === 'indefinite' && !form.term_ended && isClosedContract(requestedStatus)) {
      showSnackbar('Aby zamknąć umowę bezterminową, zaznacz zakończenie i podaj datę końca.', 'error'); return;
    }
    let savedStatus = requestedStatus;
    if (!draftOnly && form.contract_term === 'indefinite' && form.term_ended) {
      if (form.end_date > localToday() && isClosedContract(savedStatus)) savedStatus = 'active';
      else if (form.end_date <= localToday() && !isClosedContract(savedStatus)) savedStatus = 'completed';
    }
    if (!draftOnly && (!form.title.trim() || !form.party_name.trim())) {
      showSnackbar('Podaj tytuł i osobę lub firmę będącą stroną umowy', 'error'); return;
    }
    if (!draftOnly && (form.link_type === 'employee' && !form.employee_id)) { showSnackbar('Wybierz pracownika albo ustaw brak powiązania', 'error'); return; }
    if (!draftOnly && (form.link_type === 'subcontractor' && !form.subcontractor_id)) { showSnackbar('Wybierz podwykonawcę albo ustaw brak powiązania', 'error'); return; }
    if(!draftOnly && (form.link_type==='person'&&!form.person_id)){showSnackbar('Wybierz współpracownika.','error');return;}
    if(!draftOnly && (!activeContractId && !form.my_company_id)){showSnackbar('Wybierz działalność do numeracji umowy.','error');return;}
    if((!draftOnly || form.signed_date) && !validContractDate(form.signed_date)){showSnackbar('Podaj prawidłową datę zawarcia.','error');return;}
    if(!draftOnly && (['mandate','employment'].includes(form.contract_kind)&&form.party_kind!=='person')){showSnackbar('Umowa zlecenie wymaga osoby jako strony.','error');return;}
    if([form.payroll_profile.birth_date,form.payroll_profile.education_from,form.payroll_profile.education_to].some(d=>d&&!validContractDate(d))){showSnackbar('Popraw daty w danych do PIT i ZUS.','error');return;}
    if(form.payroll_profile.education_from&&form.payroll_profile.education_to&&form.payroll_profile.education_to<form.payroll_profile.education_from){showSnackbar('Koniec statusu edukacji nie może poprzedzać początku.','error');return;}
    const plannedNet = form.planned_net_amount === '' ? null : Number(form.planned_net_amount);
    if (plannedNet != null && (!Number.isFinite(plannedNet) || plannedNet <= 0 || plannedNet > 1000000)) { showSnackbar('Podaj dodatnią planowaną kwotę netto do 1 000 000 zł.', 'error'); return; }
    const grossValue = form.gross_value === '' ? null : Number(form.gross_value);
    if (grossValue != null && (!Number.isFinite(grossValue) || grossValue < 0)) { showSnackbar('Podaj prawidłową wartość umowy', 'error'); return; }
    try {
      setSaving(true);
      const payload = {
        my_company_id: form.my_company_id || null,
        document_details:form.document_details,
        planned_net_amount: plannedNet, net_cost_settings:resolvedSettings,
        agreement_form:form.agreement_form,payment_method:form.payment_method,engagement_scope:form.engagement_scope,event_id:form.engagement_scope==='event'?form.event_id||null:null,settlement_cycle:form.settlement_cycle,payroll_profile:resolvedProfile,
        subcontractor_task_id: form.link_type==='subcontractor' ? form.subcontractor_task_id || null : null,
        person_id: ['person','employee'].includes(form.link_type) ? form.person_id || null : null,
        signed_date:form.signed_date||null,party_address:(form.document_details.party_address_parts ? formatProfileAddress(form.document_details.party_address_parts) : form.party_address.trim())||null,party_bank_account:form.party_bank_account.trim()||null,party_kind:form.party_kind||null,work_scope:form.work_scope.trim()||null,payment_terms:form.payment_terms.trim()||null,additional_terms:form.additional_terms.trim()||null,issuer_representative:form.issuer_representative.trim()||null,
        employee_id: form.link_type === 'employee' ? form.employee_id || null : null,
        subcontractor_id: form.link_type === 'subcontractor' ? form.subcontractor_id || null : null,
        party_name: form.party_name.trim(), party_identifier: form.party_identifier.trim() || null,
        contract_kind: form.contract_kind, contract_number: form.contract_number.trim(), title: form.title.trim() || kindLabels[form.contract_kind],
        contract_term: form.contract_term || null,
        start_date: form.start_date || null, end_date: needsEndDate ? form.end_date || null : null, gross_value: grossValue,
        currency: form.currency.trim().toUpperCase() || 'PLN', status: savedStatus, notes: form.notes.trim() || null,
      };
      let savedId = activeContractId;
      let savedNumber = form.contract_number;
      if (activeContractId) {
        const { data, error } = await supabase.from('personnel_contracts').update(payload).eq('id', activeContractId).eq('updated_at',originalUpdatedAt).select('updated_at,contract_number').maybeSingle();
        if (error) throw error;
        if(!data) throw new Error('Umowa została zmieniona. Otwórz ją ponownie przed zapisem.');
        setOriginalUpdatedAt(data.updated_at); savedNumber=data.contract_number;
      } else {
        const { data, error } = await supabase.from('personnel_contracts').insert(payload).select('id,updated_at,contract_number').single();
        if (error) throw error;
        savedNumber=data.contract_number; savedId = data.id; setActiveContractId(data.id);setOriginalUpdatedAt(data.updated_at);
      }
      setTermSchemaAvailable(true);
      const savedForm={...form,payroll_profile:{...resolvedProfile,questionnaire:{...(resolvedProfile.questionnaire||newQuestionnaire()),confirmed:!draftOnly&&resolvedProfile.questionnaire?.confirmed===true}},net_cost_settings:resolvedSettings,contract_number:savedNumber,status:savedStatus,end_date:needsEndDate?form.end_date:''};
      setFormState(savedForm);if(!draftOnly)setWizardStep(5);setFormOriginal(JSON.stringify(savedForm));setRevision(v=>v+1);
      setPaymentForm((current) => ({ ...current, recipient_name: current.recipient_name || form.party_name.trim(),payment_method:form.payment_method }));
      showSnackbar(draftOnly ? 'Zapisano szkic. Możesz wrócić do uzupełniania pozostałych kroków.' : activeContractId ? 'Umowa została zaktualizowana' : 'Umowa została dodana. Możesz teraz dopisać wypłaty i opłaty.', 'success');
      await loadRegistry();
      if (savedId) await loadPayments(savedId);
      onChanged?.();
    } catch (error: any) {
      const missingTermColumn = ['PGRST204', '42703'].includes(error?.code) && /contract_term/.test(String(error?.message || error?.details || ''));
      if (missingTermColumn) setTermSchemaAvailable(false);
      showSnackbar(missingTermColumn ? 'Nie zapisano umowy: baza nie ma jeszcze pola czasu trwania. Wdróż migrację zakresów umów i odśwież rejestr. Formularz pozostaje otwarty.' : error?.message || 'Nie udało się zapisać umowy', 'error');
    }
    finally { setSaving(false); }
  };

  const editPayment = (payment: ContractPayment) => {
    if (readOnly) return;
    if (saving || paymentSaveLock.current) return;
    if (payment.id === editingPaymentId) {
      paymentFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      paymentFormRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true });
      return;
    }
    if (paymentDirty && !window.confirm('Odrzucić niezapisane zmiany i otworzyć inną wypłatę?')) return;
    setEditingPaymentId(payment.id);
    setEditingPaymentOriginal({ ...payment });
    setPaymentForm(paymentToForm(payment));
  };

  const savePayment = async () => {
    if (readOnly) return;
    if (saving || paymentSaveLock.current) return;
    if (!activeContractId) { showSnackbar('Najpierw zapisz umowę', 'error'); return; }
    const amount = Number(paymentForm.amount);
    if (!validContractDate(paymentForm.payment_date) || !Number.isFinite(amount) || amount <= 0 || !paymentForm.recipient_name.trim()) {
      showSnackbar('Podaj datę, kwotę i odbiorcę opłaty', 'error'); return;
    }
    const isSalary = paymentForm.payment_type === 'salary';
    const payrollTotal = isSalary && paymentForm.payroll_total_amount !== '' ? Number(paymentForm.payroll_total_amount) : null;
    if (isSalary && !paymentForm.payroll_net_confirmed) {
      showSnackbar('Potwierdź, że kwota wynagrodzenia jest kwotą netto do wypłaty, nie brutto umowy.', 'error'); return;
    }
    if (payrollTotal != null && (!Number.isFinite(payrollTotal) || payrollTotal < amount)) {
      showSnackbar('Kwota dokumentu rozliczeniowego nie może być mniejsza od kwoty netto do wypłaty.', 'error'); return;
    }
    const currency = paymentForm.currency.trim().toUpperCase() || 'PLN';
    if (!/^[A-Z]{3}$/.test(currency)) { showSnackbar('Podaj trzyznakowy kod waluty, np. PLN.', 'error'); return; }
    if (editingPaymentId && (!editingPaymentOriginal || editingPaymentOriginal.id !== editingPaymentId)) {
      showSnackbar('Otwórz ponownie pozycję do edycji — nie udało się odczytać jej wersji.', 'error'); return;
    }
    if (editingPaymentOriginal?.bank_transaction_id && (amount !== editingPaymentOriginal.amount || currency !== editingPaymentOriginal.currency || paymentForm.payment_type !== editingPaymentOriginal.payment_type)) {
      showSnackbar('Najpierw usuń dopasowanie przelewu w analizie, aby zmienić kwotę, walutę lub rodzaj wypłaty.', 'error'); return;
    }
    try {
      paymentSaveLock.current = true;
      setPaymentSaving(true);
      const payload = {
        settlement_id: ['salary','advance'].includes(paymentForm.payment_type) ? paymentForm.settlement_id || null : null,
        payment_date: paymentForm.payment_date, amount, payment_method:paymentForm.payment_method,receipt_reference:paymentForm.receipt_reference.trim()||null,
        currency, payment_type: paymentForm.payment_type,
        recipient_name: paymentForm.recipient_name.trim(), title: paymentForm.title.trim() || null, notes: paymentForm.notes.trim() || null,
        payroll_total_amount: payrollTotal, payroll_net_confirmed: isSalary && paymentForm.payroll_net_confirmed,
      };
      const { data, error } = editingPaymentId
        ? await supabase.from('personnel_contract_payments').update(payload).eq('id', editingPaymentId).eq('personnel_contract_id', activeContractId).eq('updated_at', editingPaymentOriginal!.updated_at).select('id').maybeSingle()
        : await supabase.from('personnel_contract_payments').insert({ ...payload, personnel_contract_id: activeContractId }).select('id').single();
      if (error) throw error;
      if (!data) throw new Error('Pozycja zmieniła się od otwarcia albo nie masz już dostępu. Twoje zmiany pozostają w formularzu. Skopiuj je i otwórz umowę ponownie — nie nadpisano nowszego rozliczenia.');
      showSnackbar(editingPaymentId ? editingPaymentOriginal?.bank_transaction_id ? 'Zmiany wypłaty zapisane. Powiązanie z przelewem zostało zachowane.' : 'Zmiany zapisane w istniejącej pozycji — nie dodano kolejnej wypłaty.' : 'Wypłata lub opłata została dopisana do umowy', 'success');
      setPaymentForm({...monthlyPaymentForm(form.party_name),payment_method:form.payment_method});
      setEditingPaymentId(null);
      setEditingPaymentOriginal(null);
      await Promise.all([loadPayments(activeContractId), loadRegistry()]);
      setRevision(v=>v+1);
      onChanged?.();
    } catch (error: any) { showSnackbar(error?.message || 'Nie udało się zapisać rozliczenia', 'error'); }
    finally { paymentSaveLock.current = false; setPaymentSaving(false); }
  };

  const filteredContracts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pl-PL');
    return needle ? contracts.filter((contract) => [contract.contract_number, contract.title, contract.party_name, contract.party_identifier, displayedContractKind(contract), kindLabels[contract.contract_kind]].join(' ').toLocaleLowerCase('pl-PL').includes(needle)) : contracts;
  }, [contracts, search]);
  const paymentTotalsByCurrency = contracts.reduce<Record<string, number>>((sums, contract) => {
    Object.entries(contract.registeredByCurrency || {}).forEach(([currency, amount]) => { sums[currency] = (sums[currency] || 0) + amount; });
    return sums;
  }, {});
  const editingLinkedPayment = Boolean(editingPaymentOriginal?.bank_transaction_id);
  const payrollDifference = paymentForm.payroll_total_amount !== '' && paymentForm.amount !== ''
    ? Math.round((Number(paymentForm.payroll_total_amount) - Number(paymentForm.amount)) * 100) / 100
    : null;

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
        <div className="flex flex-col gap-4 border-b border-[#d3bb73]/10 p-5 lg:flex-row lg:items-center">
          <div className="flex-1"><h3 className="font-medium text-[#e5e4e2]">Umowy pracowników i wykonawców</h3><p className="mt-1 text-xs leading-5 text-[#e5e4e2]/45">Dane osoby są zachowywane w umowie niezależnie od powiązania z kartą w CRM.</p></div>
          <div className="crm-search-field relative min-w-[260px] rounded-lg border bg-[#0a0d1a]"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/35" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj osoby, firmy lub numeru…" className="crm-search-input w-full rounded-lg bg-transparent py-2.5 pl-10 pr-3 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/30" /></div>
          {!readOnly && <button type="button" onClick={openNew} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#0a0d1a] hover:bg-[#e5d799]"><Plus className="h-4 w-4" /> Dodaj umowę</button>}
        </div>
        {periodStart && periodMode === 'accounting' && <p className="px-5 py-3 text-xs leading-5 text-[#e5e4e2]/55">Zakres: {String(month).padStart(2, '0')}/{year}. Umowy na czas określony pokazujemy w miesiącu rozpoczęcia, bez automatycznego powtarzania. Bezterminowe — od rozpoczęcia do miesiąca zakończenia włącznie. Zawsze pozostają widoczne umowy z rzeczywistą wypłatą / opłatą w tym miesiącu. Starsze umowy bez oznaczonego rodzaju okresu zachowują zapisany zakres dat. Nie tworzymy nowych wypłat ani kosztów; szczegóły pokazują pełną historię.</p>}
        {termSchemaAvailable === false && <p role="status" className="mx-5 mb-3 rounded-lg bg-amber-400/5 p-3 text-xs leading-5 text-amber-200">Baza wymaga aktualizacji, aby zapisywać czas określony / nieokreślony. Istniejące umowy i wypłaty pozostają dostępne.</p>}
        <div className="grid gap-px border-b border-[#d3bb73]/10 bg-[#d3bb73]/10 sm:grid-cols-3">
          <div className="bg-[#141827] px-5 py-3"><span className="text-xs text-[#e5e4e2]/40">Umowy</span><strong className="ml-2 text-[#e5e4e2]">{contracts.length}</strong></div>
          <div className="bg-[#141827] px-5 py-3"><span className="text-xs text-[#e5e4e2]/40">Umowy o pracę</span><strong className="ml-2 text-violet-200">{contracts.filter((contract) => contract.contract_kind === 'employment').length}</strong></div>
          <div className="bg-[#141827] px-5 py-3"><span className="text-xs text-[#e5e4e2]/40">Zapisane wypłaty i opłaty{periodStart ? ' w miesiącu' : ''}</span><strong className="ml-2 text-[#d3bb73]">{Object.entries(paymentTotalsByCurrency).map(([currency, amount]) => money(amount, currency)).join(' · ') || 'Brak pozycji'}</strong></div>
        </div>
        {!!periodSettlements.length && <div className="flex flex-wrap gap-5 bg-white/[0.025] px-5 py-3 text-sm">{Array.from(new Set(periodSettlements.map(s=>s.currency))).map(currency=>{const rows=periodSettlements.filter(s=>s.currency===currency);return <div key={currency}><p className="text-xs opacity-60">Zatwierdzone rozliczenia {periodStart?'w okresie':''}</p><p className="mt-1">Netto: {money(rows.reduce((n,s)=>n+Number(s.net_amount),0),currency)} · Koszt firmy: {money(rows.reduce((n,s)=>n+Number(s.company_cost),0),currency)} · Pozostało: {money(rows.reduce((n,s)=>n+Number(s.remaining_amount),0),currency)}</p></div>;})}</div>}
        {loading ? <div className="flex min-h-48 items-center justify-center text-sm text-[#e5e4e2]/50"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Ładowanie umów…</div> : filteredContracts.length === 0 ? <div className="px-6 py-14 text-center text-sm text-[#e5e4e2]/50"><Briefcase className="mx-auto mb-3 h-10 w-10 text-[#d3bb73]/45" />Brak umów. Możesz dodać także umowę osoby, której nie ma już w CRM.</div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[980px]"><thead className="bg-[#0a0d1a]/50 text-left text-xs uppercase tracking-wider text-[#e5e4e2]/40"><tr><th className="px-5 py-3">Umowa</th><th className="px-5 py-3">Osoba / firma</th><th className="px-5 py-3">Okres</th><th className="px-5 py-3 text-right">Wartość</th><th className="px-5 py-3 text-right">Wypłaty i opłaty</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Akcja</th></tr></thead><tbody className="divide-y divide-[#d3bb73]/10">{filteredContracts.map((contract) => (
            <tr key={contract.id} className="hover:bg-[#d3bb73]/[0.035]"><td className="px-5 py-4"><span className={`rounded px-2 py-1 text-[11px] ${contract.contract_kind === 'employment' ? 'bg-violet-500/15 text-violet-200' : 'bg-emerald-500/15 text-emerald-200'}`}>{displayedContractKind(contract)}</span><div className="mt-2 font-medium text-[#e5e4e2]">{contract.contract_number}</div><div className="mt-1 max-w-[240px] truncate text-xs text-[#e5e4e2]/45">{contract.title}</div></td><td className="px-5 py-4"><Link className="font-medium text-[#e5e4e2] hover:text-[#d3bb73]" href={contract.employee_id ? `/crm/employees/${contract.employee_id}` : contract.person_id ? `/crm/employees/collaborators/${contract.person_id}` : contract.subcontractor_id ? `/crm/subcontractors/${contract.subcontractor_id}` : '#'}>{contract.party_name}</Link><div className="mt-1 flex items-center gap-1 text-xs text-[#e5e4e2]/40">{contract.person_id || contract.employee_id || contract.subcontractor_id ? <><Link2 className="h-3 w-3" /> Powiązana z CRM</> : <><UserRound className="h-3 w-3" /> Dane zapisane w umowie</>}</div></td><td className="px-5 py-4 text-sm text-[#e5e4e2]/60">{contract.signed_date && <div className="mb-1 text-xs opacity-60">Zawarta: {new Date(contract.signed_date).toLocaleDateString('pl-PL')}</div>}{contract.start_date ? new Date(contract.start_date).toLocaleDateString('pl-PL') : '—'}{contract.end_date ? ` – ${new Date(contract.end_date).toLocaleDateString('pl-PL')}` : ''}</td><td className="px-5 py-4 text-right text-sm font-medium text-[#e5e4e2]">{contract.planned_net_amount != null ? <>{money(contract.planned_net_amount,contract.currency)}<div className="mt-1 text-[11px] font-normal opacity-50">Plan netto · {netBasisLabels[normalizeNetCostSettings(contract.net_cost_settings).basis]}</div></> : contract.gross_value == null ? '—' : <>{money(contract.gross_value, contract.currency)}<div className="mt-1 text-[11px] font-normal opacity-50">Wartość brutto umowy</div></>}</td><td className="px-5 py-4 text-right"><div className="text-sm font-medium text-[#d3bb73]">{money(contract.registeredPayments, contract.currency)}</div><div className="mt-1 text-xs text-[#e5e4e2]/40">{contract.paymentCount || 0} pozycji</div></td><td className="px-5 py-4"><span className="rounded-full bg-[#d3bb73]/10 px-2 py-1 text-xs text-[#d3bb73]">{statusLabels[contract.status]}</span></td><td className="px-5 py-4 text-right"><button type="button" disabled={!!deletingId} onClick={e=>contractMenu.toggle(contract.id,e)} aria-label={`Akcje umowy ${contract.contract_number}`} aria-expanded={contractMenu.openId===contract.id} className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73] disabled:opacity-50">{deletingId===contract.id?<Loader2 className="h-4 w-4 animate-spin"/>:<MoreVertical className="h-4 w-4"/>}</button>
              <PortalDropdownMenu open={contractMenu.openId===contract.id} position={contractMenu.position} className="!rounded-lg !border-white/5 !bg-[#381020] overflow-hidden" content={<>
                <button type="button" onClick={()=>{contractMenu.close();openContract(contract);}} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10"><Eye className="h-4 w-4 opacity-60"/>Otwórz</button>
                {!readOnly && contract.status==='draft' && <button type="button" disabled={!!deletingId} onClick={()=>{contractMenu.close();void deleteDraft(contract);}} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"><Trash2 className="h-4 w-4"/>Usuń szkic</button>}
              </>}/>
              </td></tr>
          ))}</tbody></table></div>
        )}
      </div>

      {showModal && <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-3 sm:p-5"><div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/25 bg-[#141827] shadow-2xl">
        <header className="flex items-start justify-between border-b border-[#d3bb73]/15 px-5 py-4"><div><h3 className="text-lg font-medium text-[#e5e4e2]">{activeContractId ? 'Umowa i rozliczenia' : 'Nowa umowa'}</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">Przejdź krok po kroku. Jeśli brakuje danych, zapisz szkic — system nie zgaduje odpowiedzi.</p></div><button type="button" disabled={saving || paymentSaving} onClick={closeModal} aria-label="Zamknij umowę i rozliczenia" className="rounded p-2 text-[#e5e4e2]/55 hover:bg-white/5 disabled:opacity-40"><X className="h-5 w-5" /></button></header>
        <div className={`grid min-h-0 flex-1 overflow-y-auto lg:overflow-hidden ${wizardStep===5?'lg:grid-cols-[1.05fr_0.95fr]':''}`}>
          <fieldset ref={wizardBody} disabled={readOnly||saving} className="min-w-0 space-y-4 border-b border-[#d3bb73]/10 p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <legend className="float-left mb-4 flex w-full flex-wrap gap-2" aria-label="Kroki umowy">{wizardSteps.map((label,index)=><button key={label} type="button" aria-current={wizardStep===index?'step':undefined} onClick={()=>readOnly?setWizardStep(index):navigateWizard(index)} className={`rounded-lg px-3 py-2 text-xs ${wizardStep===index?'bg-[#d3bb73]/15 text-[#e5d799]':'bg-white/5 text-[#e5e4e2]/65'}`}>{index+1}. {label}</button>)}</legend>
            <h4 tabIndex={-1} aria-live="polite" className="clear-both text-base font-medium">Krok {wizardStep+1} z {wizardSteps.length}: {wizardSteps[wizardStep]}</h4>
            {wizardStep===0&&<div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs text-[#e5e4e2]/60">Rodzaj umowy<select disabled={!!activeContractId} value={form.agreement_form==='oral'?'oral':form.contract_kind} onChange={event=>selectContractKind(event.target.value as ContractKindChoice)} className="mt-2 w-full rounded-lg border border-white/10 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="employment">Umowa o pracę</option><option value="mandate">Umowa zlecenie</option><option value="specific_work">Umowa o dzieło</option><option value="oral">{oralContractLabel}</option></select></label>
              <label className="text-xs text-[#e5e4e2]/60">Działalność<select disabled={!!activeContractId} value={form.my_company_id} onChange={(event) => setForm({ ...form, my_company_id: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="">Nie przypisano</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
              {form.agreement_form==='oral'&&<div className="space-y-2 rounded-lg bg-white/[0.025] p-3 sm:col-span-2"><p className="text-xs leading-5 text-[#e5e4e2]/65">Ustalenia ustne, domyślnie rozliczane gotówką za potwierdzeniem odbioru. Stawkę godzinową, kwotę stałą lub akord dodasz po zapisaniu umowy.</p><label className="block text-xs text-[#e5e4e2]/65">Podstawa rozliczenia<select disabled={!!activeContractId} className={personnelInput} value={form.contract_kind} onChange={e=>setForm({...form,contract_kind:e.target.value as ContractKind})}><option value="mandate">Wykonywanie usług — zlecenie</option><option value="specific_work">Wykonanie określonego rezultatu — dzieło</option></select></label></div>}
              <label className="text-xs text-[#e5e4e2]/60">Numer umowy<input readOnly value={form.contract_number || `${contractPrefix(form.contract_kind)}/${form.signed_date.slice(0,4) || new Date().getFullYear()}/…`} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none" /><span className="mt-1 block opacity-60">Nadawany przy zapisie. Osobna seria dla działalności, rodzaju i roku.</span></label>

              <label className="text-xs text-[#e5e4e2]/60 sm:col-span-2">Tytuł<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none" /></label>
            </div>
            <div className="rounded-lg border border-violet-400/15 bg-violet-400/5 p-4"><div className="mb-3 text-sm font-medium text-violet-100">Strona umowy</div><div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs text-violet-100/65">Opcjonalne powiązanie<select value={form.link_type} onChange={(event) => setForm({ ...form, link_type: event.target.value as LinkType, payroll_profile:{...emptyPayrollProfile(),questionnaire:newQuestionnaire()}, net_cost_settings:{...form.net_cost_settings,insurance:'auto',youth_remaining:'',pit_credit:'0',sickness:false}, employee_id: '', subcontractor_id: '', person_id:'',subcontractor_task_id:'',party_name:'',party_identifier:'',party_address:'',party_bank_account:'',party_kind:event.target.value==='subcontractor'?'':'person' })} className="mt-2 w-full rounded-lg border border-violet-400/20 bg-[#141827] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="none">Bez powiązania z CRM</option><option value="employee">Pracownik CRM</option><option value="person">Współpracownik</option><option value="subcontractor">Podwykonawca w CRM</option></select></label>
              {form.link_type === 'person' ? <label className="text-xs text-violet-100/65">Współpracownik<select className={personnelInput} value={form.person_id} onChange={e=>{const p=people.find(p=>p.id===e.target.value);if(p)selectPerson(p);else setForm({...form,person_id:'',party_name:'',party_identifier:'',party_address:'',party_bank_account:''});}}><option value="">Wybierz…</option>{people.filter(p=>!p.employee_id).map(p=><option key={p.id} value={p.id}>{personName(p)}</option>)}</select>{!readOnly && <button type="button" className="mt-2 text-[#d3bb73]" onClick={()=>setAddingPerson(true)}>+ Dodaj współpracownika</button>}</label> : form.link_type === 'employee' ? <label className="text-xs text-violet-100/65">Pracownik<select value={form.employee_id} onChange={(event) => selectEmployee(event.target.value)} className="mt-2 w-full rounded-lg border border-violet-400/20 bg-[#141827] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="">Wybierz…</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{[employee.name, employee.surname].filter(Boolean).join(' ')}</option>)}</select></label> : form.link_type === 'subcontractor' ? <label className="text-xs text-violet-100/65">Podwykonawca<SearchCombobox className="mt-2" value={form.subcontractor_id} options={subcontractors.map(p=>({id:p.id,label:p.company_name||'Podwykonawca',description:p.contact_person}))} onChange={selectSubcontractor} placeholder="Szukaj podwykonawcy…" disabled={readOnly}/></label> : <div className="rounded-lg bg-[#141827] px-3 py-2.5 text-xs leading-5 text-violet-100/55">Wpisz dane ręcznie — umowa pozostanie kompletna bez rekordu osoby w CRM.</div>}
              <label className="text-xs text-violet-100/65">Imię i nazwisko / firma<input value={form.party_name} onChange={(event) => setForm({ ...form, party_name: event.target.value })} className="mt-2 w-full rounded-lg border border-violet-400/20 bg-[#141827] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none" /></label>
              <label className="text-xs text-violet-100/65">PESEL lub NIP — opcjonalnie<input value={form.party_identifier} onChange={(event) => setForm({ ...form, party_identifier: event.target.value })} className="mt-2 w-full rounded-lg border border-violet-400/20 bg-[#141827] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none" /></label>
              {form.link_type==='subcontractor' && <label className="text-xs sm:col-span-2">Zlecenie podwykonawcy rozliczane tą umową<select className={personnelInput} value={form.subcontractor_task_id} onChange={e=>setForm({...form,subcontractor_task_id:e.target.value})}><option value="">Umowa niezależna od zleceń podwykonawcy</option>{subcontractorTasks.map(t=><option key={t.id} value={t.id}>{t.task_name}</option>)}</select><span className="mt-1 block opacity-60">Powiązane zlecenie nie będzie liczone drugi raz w rentowności wydarzenia.</span></label>}
              {form.link_type==='subcontractor' && <label className="text-xs sm:col-span-2">Stroną umowy jest<select className={personnelInput} value={form.party_kind} onChange={e=>setForm({...form,party_kind:e.target.value})}><option value="">Wskaż rodzaj strony</option><option value="person">Osoba fizyczna — dane osoby wpisuję poniżej</option><option value="company">Firma</option></select><span className="mt-1 block opacity-60">Osoba kontaktowa nie jest automatycznie stroną umowy.</span></label>}
            </div></div>
            {addingPerson && <PersonnelPersonForm onCancel={()=>setAddingPerson(false)} onSaved={p=>{setPeople(current=>[...current,p]);selectPerson(p);setAddingPerson(false);}}/>}
            </div>}
            {wizardStep===1&&<div className="space-y-4">
            <div className="grid gap-3 rounded-lg bg-white/[0.025] p-4 sm:grid-cols-2">
              <label className="text-xs">Forma ustaleń<select className={personnelInput} value={form.agreement_form} onChange={e=>selectContractKind(e.target.value==='oral'?'oral':form.contract_kind)}><option value="written">Pisemna</option>{form.contract_kind!=='employment'&&<option value="oral">Ustna — dżentelmeńska</option>}</select></label>
              <label className="text-xs">Sposób wypłaty<select className={personnelInput} value={form.payment_method} onChange={e=>setForm({...form,payment_method:e.target.value})}><option value="bank">Przelew</option><option value="cash">Gotówka za potwierdzeniem odbioru</option></select></label>
              {form.payment_method==='cash'&&form.contract_kind==='employment'&&<label className="flex gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={form.payroll_profile.cash_requested} onChange={e=>setForm({...form,payroll_profile:{...form.payroll_profile,cash_requested:e.target.checked}})}/>Pracownik złożył wniosek o wypłatę do rąk własnych.</label>}
              {form.agreement_form==='oral'&&<><p className="text-xs leading-5 text-amber-100/80 sm:col-span-2">Ustalenia ustne zachowują wybrany rodzaj umowy oraz zasady podatków, składek i ewidencji godzin. Sprawdź wymóg formy pisemnej, w szczególności przy zatrudnianiu cudzoziemca.</p><label className="flex gap-2 text-xs leading-5 sm:col-span-2"><input type="checkbox" checked={form.payroll_profile.oral_confirmed} onChange={e=>setForm({...form,payroll_profile:{...form.payroll_profile,oral_confirmed:e.target.checked}})}/>Potwierdzono dopuszczalność formy ustnej dla tej umowy i tej osoby.</label></>}
              <label className="text-xs">Zakres współpracy<select className={personnelInput} value={form.engagement_scope} onChange={e=>setForm({...form,engagement_scope:e.target.value,event_id:'',contract_term:e.target.value==='event'?'fixed':form.contract_term})}><option value="period">Współpraca w okresie — wiele realizacji</option><option value="event">Jedna realizacja</option></select></label>
              <label className="text-xs">Rozliczenie<select className={personnelInput} value={form.settlement_cycle} onChange={e=>setForm({...form,settlement_cycle:e.target.value})}><option value="monthly">Co miesiąc</option>{form.contract_kind!=='employment'&&<option value="on_completion">Po realizacji w jednym miesiącu</option>}</select></label>
              {form.engagement_scope==='event'&&<label className="text-xs sm:col-span-2">Realizacja<SearchCombobox className="mt-1" value={form.event_id} options={events.map(e=>({id:e.id,label:e.name}))} onChange={id=>setForm({...form,event_id:id})} placeholder="Szukaj realizacji…" disabled={readOnly}/></label>}
              <p className="text-xs leading-5 opacity-65 sm:col-span-2">Umowa np. 01.01–31.12 pozostaje jedną umową. Dla każdego miesiąca naliczamy godziny × obowiązująca stawka albo jednostki × stawka akordowa. Kwoty wypłat zatwierdzasz osobno. Pracę na przełomie miesięcy rozliczaj miesięcznie.</p>
            </div>
<PersonnelQuestionnaireFields step={1} context={questionnaireContext} value={form.payroll_profile.questionnaire||newQuestionnaire()} onChange={questionnaire=>setForm({...form,payroll_profile:{...form.payroll_profile,questionnaire}})}/>            <div className="grid gap-3 rounded-lg bg-white/[0.025] p-4 sm:grid-cols-2">
              <ContractDateField label="Data zawarcia" value={form.signed_date} onChange={v=>setForm({...form,signed_date:v})}/>
              <label className="text-xs">Reprezentacja zleceniodawcy<input className={personnelInput} value={form.issuer_representative} onChange={e=>setForm({...form,issuer_representative:e.target.value})}/></label>
              {form.employee_id && <p className="text-xs opacity-65 sm:col-span-2">Adres jest pobierany z karty pracownika. Po zapisaniu kompletnego adresu w umowie zaktualizujemy również jego kartę. Na wydruku używamy prefiksów ul., pl. i al.; pozostałe nazwy drukujemy bez prefiksu.</p>}
              {form.employee_id && people.some(person => person.employee_id === form.employee_id && person.address) && <button type="button" className="text-left text-xs text-[#d3bb73] hover:underline sm:col-span-2" onClick={() => {
                const person = people.find(person => person.employee_id === form.employee_id);
                if (!person?.address) return;
                setForm(current => ({ ...current, party_address: person.address || '', document_details: { ...current.document_details, party_address_parts: person.address_parts ? normalizeProfileAddress(person.address_parts) : undefined } }));
              }}>Pobierz aktualny adres z karty pracownika</button>}
              <PersonnelContractAddressFields value={form.party_address} parts={form.document_details.party_address_parts} onChange={(party_address,party_address_parts)=>setForm({...form,party_address,document_details:{...form.document_details,party_address_parts}})}/>
              {form.payment_method==='bank'&&<label className="text-xs sm:col-span-2">Rachunek do wypłaty<input className={personnelInput} value={form.party_bank_account} onChange={e=>setForm({...form,party_bank_account:e.target.value})}/></label>}
              <label className="text-xs sm:col-span-2">{form.contract_kind==='specific_work'?'Opis indywidualnego rezultatu dzieła':form.contract_kind==='employment'?'Zakres umówionej pracy':'Przedmiot i zakres zlecenia'}<textarea className={personnelInput} rows={3} value={form.work_scope} onChange={e=>setForm({...form,work_scope:e.target.value})}/></label>
              <label className="text-xs sm:col-span-2">Warunki i termin płatności<textarea className={personnelInput} rows={2} value={form.payment_terms} onChange={e=>setForm({...form,payment_terms:e.target.value})}/></label>
              <label className="text-xs sm:col-span-2">Dodatkowe ustalenia<textarea className={personnelInput} rows={2} value={form.additional_terms} onChange={e=>setForm({...form,additional_terms:e.target.value})}/></label>
            </div>
            <div className="space-y-3 rounded-lg bg-[var(--brand-burgundy-900)] p-4">
              <label className="block text-xs text-[#e5e4e2]/65">Czas trwania umowy<select value={form.contract_term} onChange={(event) => {
                const term = event.target.value as ContractTerm | '';
                setForm((current) => ({ ...current, contract_term: term,
                  term_ended: term === 'indefinite' && (Boolean(current.end_date) || isClosedContract(current.status)) }));
              }} className="mt-2 w-full rounded-lg border border-white/10 bg-[var(--brand-burgundy-800)] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/30">
                <option value="" disabled>Wybierz zakres umowy</option>{Object.entries(termLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              {!form.contract_term && <p className="text-xs leading-5 text-amber-200/80">W tej starszej umowie nie zapisano rodzaju okresu. Wybierz go na podstawie dokumentu — brak daty końca sam w sobie nie potwierdza umowy bezterminowej.</p>}
              {form.contract_term === 'fixed' && <p className="text-xs leading-5 text-[#e5e4e2]/55">Podaj początek i koniec. W tym okresie obowiązuje jedna umowa. W rozliczeniach miesięcznych wykorzystamy pracę wykonaną w danym miesiącu.</p>}
              {form.contract_term === 'indefinite' && <><p className="text-xs leading-5 text-[#e5e4e2]/55">Umowa będzie widoczna w kolejnych miesiącach, bez tworzenia nowych wypłat. Aby przestała przechodzić dalej, zaznacz zakończenie i podaj datę.</p><label className="flex items-start gap-2 text-sm text-[#e5e4e2]/80"><input type="checkbox" checked={form.term_ended} onChange={(event) => {
                const ending = event.target.checked;
                if (!ending && form.end_date && !window.confirm('Usunąć datę zakończenia? Umowa będzie ponownie widoczna bez ograniczenia do miesiąca końca.')) return;
                setForm((current) => ({ ...current, term_ended: ending, end_date: ending ? current.end_date : '', status: !ending && isClosedContract(current.status) ? 'active' : current.status }));
              }} className="mt-0.5 accent-[#d3bb73]" />Umowa się kończy / została zakończona</label></>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ContractDateField label="Data rozpoczęcia" value={form.start_date} onChange={(value) => setForm({ ...form, start_date: value })} required disabled={readOnly} />
              {(form.contract_term !== 'indefinite' || form.term_ended) && <ContractDateField label={form.contract_term === 'indefinite' ? 'Data zakończenia' : 'Data końca umowy'} value={form.end_date} onChange={(value) => setForm({ ...form, end_date: value })} required disabled={readOnly} />}
              {form.contract_term === 'indefinite' && form.term_ended && validContractDate(form.end_date) && form.end_date > localToday() && <p className="text-xs leading-5 text-[#e5e4e2]/60 sm:col-span-2">Zaplanowane zakończenie w przyszłości. Umowa pozostaje widoczna do miesiąca tej daty włącznie; zapis nie oznaczy jej jako już zakończonej.</p>}
            </div>
            <PersonnelDocumentFields value={form.document_details} onChange={document_details=>setForm({...form,document_details})} kind={form.contract_kind} term={form.contract_term}/>

              <section className="grid gap-3 rounded-lg bg-white/[0.035] p-4 sm:grid-cols-2"><h4 className="text-sm font-medium sm:col-span-2">Pierwszy okres do kalkulacji</h4><p className="text-xs leading-5 opacity-65 sm:col-span-2">Umowa może trwać cały rok. Tutaj wybierz pracę z jednego miesiąca i datę jej wypłaty. Oświadczenia i limit ulgi muszą odpowiadać temu okresowi.</p>
                <ContractDateField label="Praca od" value={form.net_cost_settings.work_from} onChange={v=>setForm({...form,net_cost_settings:{...form.net_cost_settings,work_from:v}})} required/>
                <ContractDateField label="Praca do" value={form.net_cost_settings.work_to} onChange={v=>setForm({...form,net_cost_settings:{...form.net_cost_settings,work_to:v}})} required/>
                <ContractDateField label="Planowana data wypłaty" value={form.net_cost_settings.payment_date} onChange={v=>setForm({...form,net_cost_settings:{...form.net_cost_settings,payment_date:v}})} required/>
              </section>
            </div>}
            {wizardStep===2&&<PersonnelQuestionnaireFields step={2} context={questionnaireContext} value={form.payroll_profile.questionnaire||newQuestionnaire()} onChange={questionnaire=>setForm({...form,payroll_profile:{...form.payroll_profile,questionnaire}})}/>}
            {wizardStep===3&&<PersonnelQuestionnaireFields step={3} context={questionnaireContext} value={form.payroll_profile.questionnaire||newQuestionnaire()} onChange={questionnaire=>setForm({...form,payroll_profile:{...form.payroll_profile,questionnaire}})}/>}
            {wizardStep===4&&<div className="space-y-4"><PersonnelQuestionnaireFields step={4} context={questionnaireContext} value={form.payroll_profile.questionnaire||newQuestionnaire()} onChange={questionnaire=>setForm({...form,payroll_profile:{...form.payroll_profile,questionnaire}})}/>            <div className="grid gap-4 sm:grid-cols-2">
              <PersonnelNetCostFields guided amount={form.planned_net_amount} onAmountChange={value=>setForm({...form,planned_net_amount:value})} settings={guidedSettings} onSettingsChange={value=>setForm({...form,net_cost_settings:value})} context={questionnaireContext} paymentMethod={form.payment_method}/>
              <label className="text-xs text-[#e5e4e2]/60">Wartość brutto dokumentu — opcjonalnie<input type="number" min="0" step="0.01" value={form.gross_value} onChange={(event) => setForm({ ...form, gross_value: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none" /></label><label className="text-xs text-[#e5e4e2]/60">Waluta<input maxLength={3} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm uppercase text-[#e5e4e2] outline-none" /></label>
              <label className="text-xs text-[#e5e4e2]/60 sm:col-span-2">Notatki<textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none" /></label>
            </div>
</div>}
            {wizardStep===5&&<div className="space-y-4"><PersonnelWizardSummary context={questionnaireContext} issues={wizardIssues} partyName={form.party_name} companyName={companies.find(c=>c.id===form.my_company_id)?.name||'Nie wybrano'} contractLabel={form.agreement_form==='oral'?oralContractLabel:kindLabels[form.contract_kind]} onStep={step=>{setWizardStep(step);setStepAttempted(true);}} confirmed={form.payroll_profile.questionnaire?.confirmed===true} onConfirm={confirmed=>setForm({...form,payroll_profile:{...form.payroll_profile,questionnaire:{...(form.payroll_profile.questionnaire||newQuestionnaire()),confirmed}}})}/>
              <label className="text-xs text-[#e5e4e2]/60">Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ContractStatus })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2]">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value} disabled={form.contract_term === 'indefinite' && (!form.term_ended || (validContractDate(form.end_date) && form.end_date > localToday())) && isClosedContract(value as ContractStatus)}>{label}</option>)}</select></label>
              <button type="button" disabled={saving||paymentSaving||wizardIssues.length>0||!form.payroll_profile.questionnaire?.confirmed} onClick={()=>void saveContract()} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#141827] disabled:opacity-40">{saving?<Loader2 className="h-4 w-4 animate-spin"/>:<CheckCircle2 className="h-4 w-4"/>}{activeContractId?'Zapisz potwierdzone dane':'Zapisz umowę'}</button>
            </div>}
            {stepAttempted&&wizardStep!==5&&<PersonnelWizardIssues issues={wizardIssues.filter(i=>i.step===wizardStep)}/>}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
              <button type="button" disabled={wizardStep===0||saving} className="rounded-lg bg-white/5 px-4 py-2 text-sm disabled:opacity-30" onClick={()=>navigateWizard(wizardStep-1)}>Wstecz</button>
              {(!activeContractId||form.status==='draft')&&<button data-crm-action="secondary" type="button" disabled={saving||paymentSaving} className="rounded-lg px-3 py-2 text-xs text-[#d3bb73] disabled:opacity-40" onClick={()=>void saveContract(true)}>Zapisz szkic do uzupełnienia</button>}
              {wizardStep<5&&<button type="button" disabled={saving} className="rounded-lg bg-[#d3bb73] px-5 py-2 text-sm font-medium text-[#141827]" onClick={()=>navigateWizard(wizardStep+1)}>Dalej</button>}
            </div>
          </fieldset>
          <section className={`min-h-0 space-y-4 p-5 lg:overflow-y-auto ${wizardStep===5?'':'hidden'}`}>{activeContractId && <PersonnelContractDetails key={activeContractId} contractId={activeContractId} readOnly={readOnly} hasUnsavedChanges={JSON.stringify(form)!==formOriginal} refreshKey={revision} onChanged={()=>{void Promise.all([loadPayments(activeContractId),loadRegistry()]).catch(e=>showSnackbar(e.message,'error'));onChanged?.();}}/>}<div><h4 className="flex items-center gap-2 font-medium text-[#e5e4e2]"><ReceiptText className="h-4 w-4 text-[#d3bb73]" /> Wypłaty i inne obciążenia</h4><p className="mt-1 text-xs leading-5 text-[#e5e4e2]/45">Wynagrodzenie zapisuj jako netto należne osobie — przelewem albo gotówką. PIT, ZUS i inne przelewy dodawaj osobno, na podstawie rozliczenia od księgowej. Kwota brutto umowy nie jest kwotą przelewu.</p></div>
            {!activeContractId ? <div className="rounded-lg border border-dashed border-[#d3bb73]/20 px-5 py-10 text-center text-sm text-[#e5e4e2]/45">Zapisz umowę, aby dodać wcześniejsze płatności.</div> : <>
              <fieldset ref={paymentFormRef} disabled={readOnly || paymentSaving || saving} className="grid min-w-0 gap-3 rounded-lg border border-white/[0.07] bg-[#1c1f33] p-4 sm:grid-cols-2">
                <label className="text-xs">Sposób wypłaty<select className={personnelInput} value={paymentForm.payment_method} onChange={e=>setPaymentForm({...paymentForm,payment_method:e.target.value})}><option value="bank">Przelew</option><option value="cash">Gotówka</option></select></label>
                {paymentForm.payment_method==='cash'&&<label className="text-xs">Potwierdzenie odbioru gotówki<input className={personnelInput} value={paymentForm.receipt_reference} onChange={e=>setPaymentForm({...paymentForm,receipt_reference:e.target.value})} placeholder="Numer / opis pokwitowania"/></label>}

                <div className="flex items-start justify-between gap-3 sm:col-span-2"><div><p className="text-sm font-medium text-[#e5e4e2]">{editingPaymentId ? 'Edytuj zapisaną wypłatę / opłatę' : 'Dodaj wypłatę / opłatę'}</p>{editingPaymentId && <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/55">Zmieniasz istniejącą pozycję. Zapis nie utworzy kolejnej wypłaty.</p>}</div>{editingPaymentId && <button type="button" onClick={cancelPaymentEdit} className="shrink-0 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-[#d3bb73] hover:bg-white/10">Anuluj edycję</button>}</div>
                {['salary','advance'].includes(paymentForm.payment_type) && <label className="text-xs sm:col-span-2">Rozliczenie miesiąca<select className={personnelInput} value={paymentForm.settlement_id} onChange={e=>setPaymentForm({...paymentForm,settlement_id:e.target.value})}><option value="">Bez przypisania do zatwierdzonego rozliczenia</option>{settlements.map(s=><option key={s.id} value={s.id}>{s.period.slice(0,7)} · pozostaje {money(s.remaining_amount,s.currency)}</option>)}</select></label>}
                {editingLinkedPayment && <p className="rounded-lg bg-sky-400/5 p-3 text-xs leading-5 text-sky-200/80 sm:col-span-2">Ta pozycja ma już przypisany przelew. Kwotę, walutę i rodzaj można zmienić dopiero po usunięciu dopasowania; opis i rozbicie możesz uzupełnić tutaj.</p>}
                <label className="text-xs text-[#e5e4e2]/60">Rodzaj<select disabled={editingLinkedPayment} value={paymentForm.payment_type} onChange={(event) => setPaymentForm({ ...paymentForm, payment_type: event.target.value as PaymentType, payroll_total_amount: '', payroll_net_confirmed: false })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#141827] px-3 py-2 text-sm text-[#e5e4e2] disabled:opacity-50">{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs text-[#e5e4e2]/60">Data<input type="date" value={paymentForm.payment_date} onChange={(event) => setPaymentForm({ ...paymentForm, payment_date: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#141827] px-3 py-2 text-sm text-[#e5e4e2]" /></label>
                <label className="text-xs text-[#e5e4e2]/60">{paymentForm.payment_type === 'salary' ? (paymentForm.payment_method==='cash'?'Netto do wypłaty gotówką':'Netto na konto — do dopasowania') : (paymentForm.payment_method==='cash'?'Kwota wypłaty gotówką':'Kwota przelewu do odbiorcy')}<input disabled={editingLinkedPayment} type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value, payroll_net_confirmed: false })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#141827] px-3 py-2 text-sm text-[#e5e4e2] outline-none disabled:opacity-50" /></label><label className="text-xs text-[#e5e4e2]/60">Waluta<input disabled={editingLinkedPayment} maxLength={3} value={paymentForm.currency} onChange={(event) => setPaymentForm({ ...paymentForm, currency: event.target.value.toUpperCase() })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#141827] px-3 py-2 text-sm uppercase text-[#e5e4e2] outline-none disabled:opacity-50" /></label>
                {paymentForm.payment_type === 'salary' && <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/65 sm:col-span-2"><PersonnelNetCostInfo amount={Number(paymentForm.amount)} settings={{...form.net_cost_settings,basis:'fixed',quantity:'1',payment_date:paymentForm.payment_date}} context={{kind:form.contract_kind,profile:form.payroll_profile,currency:paymentForm.currency,partyKind:form.party_kind}}/><span>Szacunek kosztu dla tej kwoty. Zakłada jedną pełną wypłatę w miesiącu i bieżące założenia formularza.</span></div>}
                {paymentForm.payment_type === 'salary' && <div className="space-y-3 rounded-lg bg-white/[0.025] p-3 sm:col-span-2">
                  <label className="block text-xs text-[#e5e4e2]/60">Kwota dokumentu rozliczeniowego — opcjonalnie<input type="number" min="0.01" step="0.01" value={paymentForm.payroll_total_amount} onChange={(event) => setPaymentForm({ ...paymentForm, payroll_total_amount: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/15 bg-[#141827] px-3 py-2 text-sm text-[#e5e4e2] outline-none" placeholder="Kwota źródłowa obejmująca netto i pozostałe obciążenia" /></label>
                  {payrollDifference != null && Number.isFinite(payrollDifference) && payrollDifference >= 0 && <p className="text-xs text-[#e5e4e2]/70">Pozostałe obciążenia: <strong className="font-medium text-[#d3bb73]">{money(payrollDifference, /^[A-Z]{3}$/.test(paymentForm.currency) ? paymentForm.currency : 'PLN')}</strong>. Nie są częścią przelewu do wykonawcy.</p>}
                  <p className="text-xs leading-5 text-[#e5e4e2]/45">Różnica nie tworzy automatycznie zobowiązań ani nie określa podziału na PIT i ZUS. Wpisz taki podział osobno dopiero z dokumentu od księgowej; nie dodawaj tej różnicy drugi raz do kosztów.</p>
                  <label className="flex items-start gap-2 text-xs leading-5 text-[#e5e4e2]/75"><input type="checkbox" checked={paymentForm.payroll_net_confirmed} onChange={(event) => setPaymentForm({ ...paymentForm, payroll_net_confirmed: event.target.checked })} className="mt-1 accent-[#d3bb73]" />Potwierdzam, że wpisana kwota jest kwotą netto należną osobie do wypłaty, a nie brutto umowy.</label>
                </div>}
                <label className="text-xs text-[#e5e4e2]/60 sm:col-span-2">Odbiorca<input value={paymentForm.recipient_name} onChange={(event) => setPaymentForm({ ...paymentForm, recipient_name: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#141827] px-3 py-2 text-sm text-[#e5e4e2] outline-none" placeholder="Pracownik, ZUS lub urząd skarbowy" /></label><label className="text-xs text-[#e5e4e2]/60 sm:col-span-2">Tytuł / okres<input value={paymentForm.title} onChange={(event) => setPaymentForm({ ...paymentForm, title: event.target.value })} className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#141827] px-3 py-2 text-sm text-[#e5e4e2] outline-none" placeholder="np. wynagrodzenie za maj 2025" /></label><label className="text-xs text-[#e5e4e2]/60 sm:col-span-2">Notatka<textarea rows={4} value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })} className="mt-2 w-full rounded-lg border border-white/10 bg-[#141827] px-3 py-2 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/30" /></label>
                <button type="button" disabled={paymentSaving || saving || Boolean(editingPaymentId && !paymentDirty)} onClick={() => void savePayment()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#141827] disabled:opacity-50 sm:col-span-2">{paymentSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingPaymentId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editingPaymentId ? 'Zapisz zmiany wypłaty' : 'Dodaj pozycję'}</button>
              </fieldset>
              <div className="space-y-2">{payments.length === 0 ? <p className="rounded-lg border border-dashed border-[#d3bb73]/15 p-5 text-center text-xs text-[#e5e4e2]/40">Brak zapisanych wypłat lub opłat.</p> : payments.map((payment) => <div key={payment.id} className={`rounded-lg border border-white/[0.07] p-3 ${editingPaymentId === payment.id ? 'bg-[#d3bb73]/[0.09]' : 'bg-[#1c1f33]'}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><span className="rounded bg-[#d3bb73]/10 px-2 py-0.5 text-[11px] text-[#d3bb73]">{paymentLabels[payment.payment_type]}</span><div className="mt-2 break-words text-sm font-medium text-[#e5e4e2]">{payment.recipient_name}</div></div><div className="text-right"><strong className="text-sm text-[#e5e4e2]">{money(payment.amount, payment.currency)}</strong><p className="mt-1 text-[11px] text-[#e5e4e2]/50">{payment.payment_type === 'salary' ? payment.payroll_net_confirmed ? (payment.payment_method==='cash'?'Netto — gotówka':'Netto na konto') : 'Kwota wpisana — netto niepotwierdzone' : (payment.payment_method==='cash'?'Wypłata gotówką':'Do odbiorcy przelewu')}</p><button type="button" disabled={paymentSaving || saving} onClick={() => editPayment(payment)} aria-label={`Edytuj: ${paymentLabels[payment.payment_type]}, ${payment.recipient_name}, ${money(payment.amount, payment.currency)}`} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#d3bb73]/10 px-3 py-1.5 text-xs font-medium text-[#d3bb73] hover:bg-[#d3bb73]/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#d3bb73]/30 disabled:opacity-40"><Pencil className="h-3.5 w-3.5" />{editingPaymentId === payment.id ? 'W edycji' : 'Edytuj'}</button></div></div>
                {payment.payment_type === 'salary' && payment.payroll_total_amount != null && <div className="mt-3 space-y-1 rounded-lg bg-white/[0.025] p-2 text-xs text-[#e5e4e2]/60"><p>Kwota dokumentu rozliczeniowego: {money(payment.payroll_total_amount, payment.currency)}</p><p>Pozostałe obciążenia: {money(payment.payroll_total_amount - payment.amount, payment.currency)} — podział PIT / ZUS wymaga dokumentu źródłowego.</p></div>}
                <div className="mt-2 flex items-center gap-2 text-xs text-[#e5e4e2]/45"><CalendarDays className="h-3.5 w-3.5" /> {new Date(payment.payment_date).toLocaleDateString('pl-PL')}{payment.title ? ` • ${payment.title}` : ''}</div>{payment.notes && <p className="mt-2 text-xs text-[#e5e4e2]/50">{payment.notes}</p>}
                <div className="mt-3 flex items-center justify-between gap-2 text-xs"><span className={payment.bank_transaction_id ? 'text-emerald-200/80' : 'text-[#e5e4e2]/45'}>{payment.bank_transaction_id ? 'Przelew przypisany' : 'Bez przypisanego przelewu'}</span>{editingPaymentId === payment.id && <span className="text-[#d3bb73]">Edytowana pozycja</span>}</div>
              </div>)}</div>
            </>}
          </section>
        </div>
      </div></div>}
    </>
  );
}
