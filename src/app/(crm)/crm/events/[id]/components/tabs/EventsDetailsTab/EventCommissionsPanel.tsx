'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Banknote,
  Calculator,
  Check,
  Loader2,
  Pencil,
  Plus,
  UserRound,
  X,
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { getOfferTotals } from '@/lib/CRM/Offers/offerTotals';
import {
  CommissionBeneficiaryType,
  CommissionCalculationType,
  CommissionPaymentMethod,
  CommissionStatus,
  DEFAULT_DIVIDEND_TAX_RATE,
  commissionBeneficiaryLabels,
  commissionPaymentLabels,
  commissionStatusLabels,
  formatCommissionMoney,
  getCommissionAmounts,
} from '@/lib/CRM/events/eventCommission';
import { supabase } from '@/lib/supabase/browser';
import SearchCombobox from '@/components/crm/SearchCombobox';

type BeneficiarySource = 'partner' | 'contact' | 'employee' | 'manual';

type Commission = {
  id: string;
  beneficiary_type: CommissionBeneficiaryType;
  beneficiary_name: string;
  salesperson_id: string | null;
  sales_partner_id: string | null;
  employee_id: string | null;
  contact_id: string | null;
  organization_id: string | null;
  calculation_type: CommissionCalculationType;
  rate: number;
  base_amount: number;
  base_description: string | null;
  amount: number;
  payment_method: CommissionPaymentMethod;
  dividend_tax_rate: number;
  company_cost_amount: number | null;
  status: CommissionStatus;
  due_date: string | null;
  paid_at: string | null;
  notes: string | null;
  created_by: string | null;
  automatic_source: string | null;
  automatic_waiting_for_offer: boolean;
};

type EmployeeOption = {
  id: string;
  name: string;
  surname: string;
  email: string | null;
};

type ContactOption = {
  id: string;
  full_name: string;
  email: string | null;
};

type OrganizationOption = {
  id: string;
  name: string;
  alias: string | null;
};

type ContactOrganization = {
  contact_id: string;
  organization_id: string;
  is_primary: boolean | null;
};

type SalesPartnerProfile = {
  id: string;
  employee_id: string | null;
  contact_id: string | null;
  organization_id: string | null;
  partner_type: 'internal_employee' | 'hotel_employee' | 'agency_employee' | 'independent_referrer';
  status: 'onboarding' | 'active' | 'inactive';
};

type SalesPartnerBrandTerm = {
  sales_partner_id: string;
  my_company_id: string;
  commission_enabled: boolean;
  default_commission_rate: number;
  default_payment_method: CommissionPaymentMethod;
  dividend_tax_rate: number;
  is_active: boolean;
};

type CommissionForm = {
  beneficiaryType: CommissionBeneficiaryType;
  beneficiarySource: BeneficiarySource;
  beneficiaryId: string;
  beneficiarySearch: string;
  manualName: string;
  organizationId: string;
  calculationType: CommissionCalculationType;
  baseAmount: number;
  baseDescription: string;
  rate: number;
  fixedAmount: number;
  paymentMethod: CommissionPaymentMethod;
  dividendTaxRate: number;
  dueDate: string;
  notes: string;
};

const emptyForm = (baseAmount = 0): CommissionForm => ({
  beneficiaryType: 'salesperson',
  beneficiarySource: 'partner',
  beneficiaryId: '',
  beneficiarySearch: '',
  manualName: '',
  organizationId: '',
  calculationType: 'percent',
  baseAmount,
  baseDescription: 'Wartość netto zaakceptowanej oferty',
  rate: 0,
  fixedAmount: 0,
  paymentMethod: 'invoice',
  dividendTaxRate: DEFAULT_DIVIDEND_TAX_RATE,
  dueDate: '',
  notes: '',
});

const inputClass =
  'w-full rounded-lg border border-white/10 bg-[#111522] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25 focus:bg-white/[0.06] focus:border-white/20';

export default function EventCommissionsPanel({ eventId }: { eventId: string }) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { currentEmployee, isAdmin, canManageModule, loading: employeeLoading } = useCurrentEmployee();
  const canManage = isAdmin || canManageModule('finances');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schemaAvailable, setSchemaAvailable] = useState(true);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [contactOrganizations, setContactOrganizations] = useState<ContactOrganization[]>([]);
  const [salesPartners, setSalesPartners] = useState<SalesPartnerProfile[]>([]);
  const [salesPartnerTerms, setSalesPartnerTerms] = useState<SalesPartnerBrandTerm[]>([]);
  const [eventCompanyId, setEventCompanyId] = useState<string | null>(null);
  const [acceptedOfferNet, setAcceptedOfferNet] = useState(0);
  const [offerCommission, setOfferCommission] = useState<{ partnerId: string; rate: number } | null>(null);
  const [syncNotice, setSyncNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [customizeTerms, setCustomizeTerms] = useState(false);
  const loadSequence = useRef(0);
  const formOpen = useRef(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CommissionForm>(() => emptyForm());

  formOpen.current = showForm;
  const showDetails = Boolean(editingId) || customizeTerms || form.beneficiarySource !== 'partner';

  const loadData = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError('');
    try {
      let notice = '';
      if (canManage) {
        try {
          const response = await fetch('/bridge/events/commissions/automatic', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId }),
          });
          const result = await response.json();
          notice = response.ok ? result.message || '' : result.error || 'Nie udało się uzupełnić prowizji.';
        } catch {
          notice = 'Nie udało się uzupełnić prowizji. Użyj przycisku „Odśwież”.';
        }
      }
      const [
        commissionsResult,
        offerResult,
        employeesResult,
        contactsResult,
        organizationsResult,
        relationsResult,
        partnersResult,
        partnerTermsResult,
        eventResult,
      ] =
        await Promise.all([
          supabase
            .from('event_commissions')
            .select(
              'id,beneficiary_type,beneficiary_name,salesperson_id,sales_partner_id,employee_id,contact_id,organization_id,calculation_type,rate,base_amount,base_description,amount,payment_method,dividend_tax_rate,company_cost_amount,status,due_date,paid_at,notes,created_by,automatic_source,automatic_waiting_for_offer',
            )
            .eq('event_id', eventId)
            .order('created_at', { ascending: false }),
          supabase
            .from('offers')
            .select('sales_partner_id,commercial_model,partner_commission_rate,subtotal,discount_amount,discount_percent,tax_amount,tax_percent,total_amount')
            .eq('event_id', eventId)
            .eq('status', 'accepted')
            .order('created_at', { ascending: false })
            .order('id')
            .limit(1)
            .maybeSingle(),
          supabase
            .from('employees')
            .select('id,name,surname,email')
            .eq('is_active', true)
            .order('surname')
            .limit(500),
          supabase
            .from('contacts')
            .select('id,full_name,email')
            .order('full_name')
            .limit(1000),
          supabase.from('organizations').select('id,name,alias').order('name').limit(1000),
          supabase
            .from('contact_organizations')
            .select('contact_id,organization_id,is_primary')
            .eq('is_current', true),
          supabase
            .from('sales_partner_profiles')
            .select('id,employee_id,contact_id,organization_id,partner_type,status'),
          supabase
            .from('sales_partner_brand_terms')
            .select('sales_partner_id,my_company_id,commission_enabled,default_commission_rate,default_payment_method,dividend_tax_rate,is_active')
            .eq('is_active', true),
          supabase.from('events').select('my_company_id').eq('id', eventId).maybeSingle(),
        ]);

      if (sequence !== loadSequence.current) return;
      setSyncNotice(notice);
      const sourceError = [offerResult, employeesResult, contactsResult, organizationsResult,
        relationsResult, partnersResult, partnerTermsResult, eventResult].find((result) => result.error)?.error;
      if (sourceError) throw sourceError;

      if (commissionsResult.error) {
        const missingSchema = ['company_cost_amount', 'contact_id', 'payment_method', 'sales_partner_id', 'automatic_source', 'automatic_waiting_for_offer'].some((column) =>
          commissionsResult.error?.message?.includes(column),
        );
        setSchemaAvailable(!missingSchema);
        setCommissions([]);
        if (!missingSchema) throw commissionsResult.error;
      } else {
        setSchemaAvailable(true);
        setCommissions((commissionsResult.data || []) as Commission[]);
      }

      const offerNet = offerResult.data ? getOfferTotals(offerResult.data).net : 0;
      setAcceptedOfferNet(offerNet);
      if (!formOpen.current) setForm(emptyForm(offerNet));
      setOfferCommission(offerResult.data?.sales_partner_id && offerResult.data.commercial_model === 'commission'
        ? { partnerId: offerResult.data.sales_partner_id, rate: Number(offerResult.data.partner_commission_rate) }
        : null);
      setEmployees((employeesResult.data || []) as EmployeeOption[]);
      setContacts((contactsResult.data || []) as ContactOption[]);
      setOrganizations((organizationsResult.data || []) as OrganizationOption[]);
      setContactOrganizations((relationsResult.data || []) as ContactOrganization[]);
      setSalesPartners((partnersResult.data || []) as SalesPartnerProfile[]);
      setSalesPartnerTerms((partnerTermsResult.data || []) as SalesPartnerBrandTerm[]);
      setEventCompanyId(eventResult.data?.my_company_id || null);
    } catch (error) {
      if (sequence === loadSequence.current) {
        console.error('Error loading event commissions:', error);
        setLoadError('Nie udało się wczytać danych prowizji. Odśwież sekcję.');
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [eventId, canManage]);

  useEffect(() => {
    if (employeeLoading) return;
    setCommissions([]);
    setShowForm(false);
    setEditingId(null);
    void loadData();
    const refresh = () => { if (!formOpen.current) void loadData(); };
    window.addEventListener('focus', refresh);
    const channel = supabase.channel(`event-commission-defaults:${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_billing_contacts', filter: `event_id=eq.${eventId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_commissions', filter: `event_id=eq.${eventId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'offers', filter: `event_id=eq.${eventId}` }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events', filter: `id=eq.${eventId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_partner_profiles' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_partner_brand_terms' }, refresh)
      .subscribe();
    return () => {
      loadSequence.current += 1;
      window.removeEventListener('focus', refresh);
      void supabase.removeChannel(channel);
    };
  }, [eventId, employeeLoading, loadData]);

  const selectedEmployee = employees.find((employee) => employee.id === form.beneficiaryId);
  const selectedContact = contacts.find((contact) => contact.id === form.beneficiaryId);
  const selectedPartner = salesPartners.find((partner) => partner.id === form.beneficiaryId);

  const beneficiaryOptions = useMemo(() => {
    const options = form.beneficiarySource === 'partner'
      ? salesPartners.filter((partner) => (partner.status === 'active' && salesPartnerTerms.some((term) =>
          term.sales_partner_id === partner.id
          && term.commission_enabled
          && term.my_company_id === eventCompanyId,
        )) || (Boolean(editingId) && partner.id === form.beneficiaryId)).map((partner) => {
          const employee = employees.find((item) => item.id === partner.employee_id);
          const contact = contacts.find((item) => item.id === partner.contact_id);
          const organization = organizations.find((item) => item.id === partner.organization_id);
          return {
            id: partner.id,
            label: employee
              ? `${employee.name} ${employee.surname}`.trim()
              : contact?.full_name || 'Sprzedawca bez nazwy',
            detail: organization?.alias || organization?.name || (
              partner.partner_type === 'internal_employee' ? 'Mavinci' : 'bez organizacji'
            ),
          };
        })
      : form.beneficiarySource === 'employee'
        ? employees.map((employee) => ({
          id: employee.id,
          label: `${employee.name} ${employee.surname}`.trim(),
          detail: employee.email || 'pracownik CRM',
        }))
        : contacts.map((contact) => ({
          id: contact.id,
          label: contact.full_name,
          detail: contact.email || 'kontakt CRM',
        }));

    return options;
  }, [contacts, employees, eventCompanyId, form.beneficiarySource, form.beneficiaryId, editingId, organizations, salesPartnerTerms, salesPartners]);

  const organizationOptions = useMemo(
    () => organizations.map((organization) => ({
      id: organization.id,
      label: organization.alias || organization.name,
      description: organization.alias ? organization.name : null,
    })),
    [organizations],
  );

  const preview = useMemo(
    () =>
      getCommissionAmounts({
        calculationType: form.calculationType,
        baseAmount: Number(form.baseAmount || 0),
        rate: Number(form.rate || 0),
        fixedAmount: Number(form.fixedAmount || 0),
        paymentMethod: form.paymentMethod,
        dividendTaxRate: Number(form.dividendTaxRate || 0),
      }),
    [form],
  );

  const activeCommissions = commissions.filter((commission) => commission.status !== 'cancelled');
  const nominalTotal = activeCommissions.reduce(
    (sum, commission) => sum + Number(commission.amount || 0),
    0,
  );
  const companyCostTotal = activeCommissions.reduce(
    (sum, commission) => sum + Number(commission.company_cost_amount ?? commission.amount ?? 0),
    0,
  );

  const selectBeneficiary = (id: string) => {
    const source = form.beneficiarySource;
    const partner = salesPartners.find((item) => source === 'partner' ? item.id === id
      : source === 'contact' ? item.contact_id === id
      : source === 'employee' ? item.employee_id === id : false);
    if (partner) {
      const employee = employees.find((item) => item.id === partner.employee_id);
      const contact = contacts.find((item) => item.id === partner.contact_id);
      const term = salesPartnerTerms.find(
        (item) => item.sales_partner_id === partner.id && item.my_company_id === eventCompanyId && item.commission_enabled,
      );
      if (!term || partner.status !== 'active') {
        showSnackbar('Uzupełnij warunki sprzedawcy dla marki wydarzenia w kartotece sprzedawców.', 'warning');
        return;
      }
      setCustomizeTerms(false);
      setForm((current) => ({
        ...current,
        beneficiarySource: 'partner',
        calculationType: 'percent',
        baseAmount: acceptedOfferNet,
        baseDescription: 'Wartość netto zaakceptowanej oferty',
        beneficiaryId: partner.id,
        beneficiarySearch: employee
          ? `${employee.name} ${employee.surname}`.trim()
          : contact?.full_name || '',
        organizationId: partner.organization_id || '',
        beneficiaryType: partner.partner_type === 'internal_employee' ? 'employee' : 'salesperson',
        rate: offerCommission?.partnerId === partner.id ? offerCommission.rate : Number(term.default_commission_rate),
        paymentMethod: term?.default_payment_method || current.paymentMethod,
        dividendTaxRate: Number(term?.dividend_tax_rate ?? current.dividendTaxRate),
      }));
      return;
    }
    const contactRelation = source === 'contact'
      ? contactOrganizations.find((relation) => relation.contact_id === id && relation.is_primary)
        || contactOrganizations.find((relation) => relation.contact_id === id)
      : null;
    const label = source === 'employee'
      ? employees.find((employee) => employee.id === id)
      : contacts.find((contact) => contact.id === id);
    const beneficiaryName = source === 'employee' && label
      ? `${(label as EmployeeOption).name} ${(label as EmployeeOption).surname}`.trim()
      : (label as ContactOption | undefined)?.full_name || '';

    setForm((current) => ({
      ...current,
      beneficiaryId: id,
      beneficiarySearch: beneficiaryName,
      organizationId: contactRelation?.organization_id || current.organizationId,
    }));
  };

  const resetForm = () => {
    setCustomizeTerms(false);
    setEditingId(null);
    setForm(emptyForm(acceptedOfferNet));
    setShowForm(false);
  };

  const editCommission = (commission: Commission) => {
    const source: BeneficiarySource = commission.sales_partner_id
      ? 'partner'
      : commission.employee_id
      ? 'employee'
      : commission.contact_id
        ? 'contact'
        : 'manual';
    setCustomizeTerms(true);
    setEditingId(commission.id);
    setForm({
      beneficiaryType: commission.beneficiary_type,
      beneficiarySource: source,
      beneficiaryId: commission.sales_partner_id || commission.employee_id || commission.contact_id || '',
      beneficiarySearch: commission.beneficiary_name,
      manualName: source === 'manual' ? commission.beneficiary_name : '',
      organizationId: commission.organization_id || '',
      calculationType: commission.calculation_type,
      baseAmount: Number(commission.base_amount || 0),
      baseDescription: commission.base_description || '',
      rate: Number(commission.rate || 0),
      fixedAmount: Number(commission.amount || 0),
      paymentMethod: commission.payment_method || 'invoice',
      dividendTaxRate: Number(commission.dividend_tax_rate ?? DEFAULT_DIVIDEND_TAX_RATE),
      dueDate: commission.due_date || '',
      notes: commission.notes || '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!canManage || saving) return;
    if (!showDetails && form.beneficiarySource === 'partner') {
      if (!form.beneficiaryId) {
        showSnackbar('Wybierz sprzedawcę z kartoteki', 'warning');
        return;
      }
      setSaving(true);
      try {
        const response = await fetch('/bridge/events/commissions/automatic', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId, salesPartnerId: form.beneficiaryId }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Nie udało się zapisać prowizji.');
        if (!result.commissionId) {
          showSnackbar(result.message || 'Uzupełnij dane potrzebne do naliczenia.', 'warning');
          return;
        }
        showSnackbar(result.created ? 'Prowizja została uzupełniona z kartoteki' : 'Prowizja dla tej osoby jest już zapisana', 'success');
        resetForm();
        await loadData();
      } catch (error) {
        showSnackbar(error instanceof Error ? error.message : 'Nie udało się zapisać prowizji.', 'error');
      } finally { setSaving(false); }
      return;
    }
    const partnerEmployee = selectedPartner?.employee_id
      ? employees.find((employee) => employee.id === selectedPartner.employee_id)
      : null;
    const partnerContact = selectedPartner?.contact_id
      ? contacts.find((contact) => contact.id === selectedPartner.contact_id)
      : null;
    const beneficiaryName = form.beneficiarySource === 'partner'
      ? partnerEmployee
        ? `${partnerEmployee.name} ${partnerEmployee.surname}`.trim()
        : partnerContact?.full_name
      : form.beneficiarySource === 'employee'
        ? selectedEmployee && `${selectedEmployee.name} ${selectedEmployee.surname}`.trim()
        : form.beneficiarySource === 'contact'
          ? selectedContact?.full_name
          : form.manualName.trim();

    const savedBeneficiary = editingId ? commissions.find((item) => item.id === editingId) : null;
    const unchangedPerson = savedBeneficiary && form.beneficiaryId === (savedBeneficiary.sales_partner_id || savedBeneficiary.employee_id || savedBeneficiary.contact_id || '');
    const resolvedName = beneficiaryName || (unchangedPerson ? savedBeneficiary?.beneficiary_name : '');
    if (!resolvedName) {
      showSnackbar('Wybierz osobę albo wpisz nazwę beneficjenta', 'warning');
      return;
    }
    if (!Number.isFinite(preview.nominalAmount) || !Number.isFinite(preview.companyCostAmount) || preview.nominalAmount <= 0) {
      showSnackbar('Kwota prowizji musi być większa od zera', 'warning');
      return;
    }

    setSaving(true);
    const employeeId = form.beneficiarySource === 'partner'
      ? selectedPartner?.employee_id || null
      : form.beneficiarySource === 'employee'
        ? form.beneficiaryId
        : null;
    const contactId = form.beneficiarySource === 'partner'
      ? selectedPartner?.contact_id || null
      : form.beneficiarySource === 'contact'
        ? form.beneficiaryId
        : null;
    const payload = {
      event_id: eventId,
      sales_partner_id: form.beneficiarySource === 'partner' ? form.beneficiaryId : null,
      beneficiary_type: form.beneficiaryType,
      beneficiary_name: resolvedName,
      salesperson_id: form.beneficiaryType === 'salesperson' ? employeeId : null,
      employee_id: employeeId,
      contact_id: contactId,
      organization_id: form.organizationId || null,
      calculation_type: form.calculationType,
      rate: form.calculationType === 'percent' ? Number(form.rate || 0) : 0,
      base_amount: form.calculationType === 'percent' ? Number(form.baseAmount || 0) : 0,
      base_description: form.baseDescription.trim() || null,
      amount: preview.nominalAmount,
      payment_method: form.paymentMethod,
      dividend_tax_rate: form.paymentMethod === 'cash_dividend'
        ? Number(form.dividendTaxRate || 0)
        : DEFAULT_DIVIDEND_TAX_RATE,
      company_cost_amount: preview.companyCostAmount,
      due_date: form.dueDate || null,
      notes: form.notes.trim() || null,
      ...(editingId ? { automatic_waiting_for_offer: false } : {}),
      ...(!editingId ? { status: 'planned', created_by: currentEmployee?.id || null } : {}),
    };

    const result = editingId
      ? await supabase.from('event_commissions').update(payload).eq('id', editingId).eq('event_id', eventId).neq('status', 'paid').select('id').maybeSingle()
      : await supabase.from('event_commissions').insert(payload).select('id').single();

    setSaving(false);
    if (result.error || !result.data) {
      showSnackbar(result.error?.message || 'Prowizja została zmieniona lub wypłacona. Odśwież dane przed edycją.', 'error');
      return;
    }

    showSnackbar(editingId ? 'Prowizja została zaktualizowana' : 'Prowizja została naliczona', 'success');
    resetForm();
    await loadData();
  };

  const commissionSettlementsHref = (commission: Commission) => {
    const partner = commission.sales_partner_id
      ? salesPartners.find((item) => item.id === commission.sales_partner_id)
      : null;
    const contactId = commission.contact_id || partner?.contact_id;
    if (contactId) return `/crm/contacts/${contactId}?tab=settlements`;
    const employeeId = commission.employee_id || partner?.employee_id;
    if (employeeId) return `/crm/employees/${employeeId}`;
    return null;
  };

  const handleStatusChange = async (commission: Commission, status: CommissionStatus) => {
    if (!canManage || status === commission.status) return;
    if (commission.status === 'paid') {
      showSnackbar('Wypłacona prowizja pozostaje w historii rozliczeń. Nie można cofnąć jej samą zmianą statusu.', 'warning');
      return;
    }
    if (commission.automatic_waiting_for_offer && (status === 'approved' || status === 'paid')) {
      showSnackbar('Najpierw zaakceptuj ofertę lub zapisz ręcznie podstawę prowizji.', 'warning');
      return;
    }
    const settlementsHref = commissionSettlementsHref(commission);
    if (status === 'paid' && settlementsHref) {
      showSnackbar('Zapisz wypłatę z rzeczywistą kwotą, datą i numerem przelewu w rozliczeniach prowizji.', 'info');
      router.push(settlementsHref);
      return;
    }
    const { error } = await supabase.from('event_commissions').update({ status }).eq('id', commission.id).eq('event_id', eventId);
    if (error) {
      showSnackbar(error.message || 'Nie udało się zmienić statusu', 'error');
      return;
    }
    await loadData();
  };

  const handleCancelCommission = async (commission: Commission) => {
    if (!confirm(`Anulować prowizję dla ${commission.beneficiary_name}?`)) return;
    // Zachowanie wpisu blokuje ponowne automatyczne naliczenie.
    const { data, error } = await supabase.from('event_commissions').update({ status: 'cancelled' }).eq('id', commission.id).eq('event_id', eventId).neq('status', 'paid').select('id').maybeSingle();
    if (error || !data) {
      showSnackbar(error?.message || 'Nie udało się anulować prowizji. Odśwież jej status.', 'error');
      return;
    }
    await loadData();
    showSnackbar('Prowizja została anulowana', 'success');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center border-t border-[#d3bb73]/10 py-8">
        <Loader2 className="h-5 w-5 animate-spin text-[#d3bb73]" />
      </div>
    );
  }

  if (loadError) return (
    <div className="mt-6 rounded-lg bg-white/[0.025] p-4 text-xs text-amber-200/80">
      {loadError}
      <button data-crm-action="secondary" type="button" onClick={() => void loadData()} className="ml-3 rounded px-2 py-1 text-[#d3bb73] hover:bg-white/5">Odśwież</button>
    </div>
  );

  if (!schemaAvailable) {
    return (
      <div className="mt-6 border-t border-[#d3bb73]/10 pt-5 text-xs text-amber-200/70">
        Rozszerzony rejestr prowizji będzie dostępny po uruchomieniu najnowszej migracji bazy.
      </div>
    );
  }

  return (
    <div className="mt-6 border-t border-[#d3bb73]/10 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-violet-400/10 p-2">
            <UserRound className="h-5 w-5 text-violet-300" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-[#e5e4e2]">Sprzedawcy i prowizje</h3>
            <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/45">
              Sprzedawca polecający wydarzenie jest niezależny od płatnika. On, sprzedawcy z kontaktów firmy rozliczającej, sprzedawca z oferty i osoba kontaktowa z kartoteki uzupełniają się automatycznie według warunków marki wydarzenia. Zmiana lub usunięcie przypisania nie anuluje zapisanej prowizji — decyzję podejmujesz tutaj.
            </p>
          </div>
        </div>
        {canManage && !showForm && (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setCustomizeTerms(false);
              setForm(emptyForm(acceptedOfferNet));
              setShowForm(true);
            }}
            className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-violet-200 hover:bg-violet-300/10"
          >
            <Plus className="h-3.5 w-3.5" /> Dodaj osobę
          </button>
        )}
      </div>

      {syncNotice && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.025] p-3 text-xs leading-5 text-[#e5e4e2]/55">
          <span>{syncNotice}</span>
          <button data-crm-action="secondary" type="button" onClick={() => void loadData()} className="rounded px-2 py-1 text-[#d3bb73] hover:bg-white/5">Odśwież</button>
        </div>
      )}

      {activeCommissions.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-white/5 bg-[#0a0d1a] p-3">
            <p className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/35">Do wypłaty osobom</p>
            <p className="mt-1 text-base text-violet-200">{formatCommissionMoney(nominalTotal)}</p>
          </div>
          <div className="rounded-lg border border-white/5 bg-[#0a0d1a] p-3">
            <p className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/35">Koszt dla spółki</p>
            <p className="mt-1 text-base text-amber-200">{formatCommissionMoney(companyCostTotal)}</p>
          </div>
          <div className="rounded-lg border border-white/5 bg-[#0a0d1a] p-3">
            <p className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/35">Narzut wypłat gotówkowych</p>
            <p className="mt-1 text-base text-[#e5e4e2]">
              {formatCommissionMoney(companyCostTotal - nominalTotal)}
            </p>
          </div>
        </div>
      )}

      {showForm && canManage && (
        <div className="mt-4 space-y-4 rounded-xl border border-white/10 bg-[#0a0d1a] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-[#e5e4e2]">
              {editingId ? 'Edytuj warunki dla tego wydarzenia' : 'Wybierz osobę — warunki uzupełnią się automatycznie'}
            </p>
            <button type="button" onClick={resetForm} className="rounded p-1 text-[#e5e4e2]/45 hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>

          {showDetails && (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="text-xs text-[#e5e4e2]/55">
              Rodzaj beneficjenta
              <select
                value={form.beneficiaryType}
                onChange={(event) => setForm({ ...form, beneficiaryType: event.target.value as CommissionBeneficiaryType })}
                className={`${inputClass} mt-1.5`}
              >
                {Object.entries(commissionBeneficiaryLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[#e5e4e2]/55">
              Gdzie jest osoba
              <select
                value={form.beneficiarySource}
                onChange={(event) => setForm({
                  ...form,
                  beneficiarySource: event.target.value as BeneficiarySource,
                  beneficiaryId: '',
                  beneficiarySearch: '',
                })}
                className={`${inputClass} mt-1.5`}
              >
                <option value="partner">Kartoteka sprzedawców</option>
                <option value="contact">Kontakt CRM / osoba z hotelu</option>
                <option value="employee">Pracownik CRM</option>
                <option value="manual">Osoba spoza bazy</option>
              </select>
            </label>
            <label className="text-xs text-[#e5e4e2]/55">
              Powiązany hotel / firma <span className="text-[#e5e4e2]/30">(opcjonalnie)</span>
              <SearchCombobox
                value={form.organizationId}
                options={organizationOptions}
                onChange={(organizationId) => setForm({ ...form, organizationId })}
                placeholder="Wyszukaj hotel lub firmę..."
                emptyLabel="Brak pasującej organizacji"
                className="mt-1.5"
              />
            </label>
          </div>

          )}

          {form.beneficiarySource === 'manual' ? (
            <label className="block text-xs text-[#e5e4e2]/55">
              Imię i nazwisko / nazwa
              <input
                value={form.manualName}
                onChange={(event) => setForm({ ...form, manualName: event.target.value })}
                className={`${inputClass} mt-1.5`}
                placeholder="np. Katarzyna Kowalska"
              />
            </label>
          ) : (
            <div>
              <label className="block text-xs text-[#e5e4e2]/55">
                {form.beneficiarySource === 'partner' ? 'Wyszukaj sprzedawcę' : 'Wyszukaj i wybierz osobę'}
              </label>
              <SearchCombobox
                value={form.beneficiaryId}
                options={beneficiaryOptions.map((option) => ({
                  id: option.id,
                  label: option.label,
                  description: option.detail,
                }))}
                onChange={(beneficiaryId) => {
                  if (beneficiaryId) selectBeneficiary(beneficiaryId);
                  else setForm({ ...form, beneficiaryId: '', beneficiarySearch: '' });
                }}
                placeholder="Wpisz imię, nazwisko lub e-mail..."
                emptyLabel="Brak pasującej osoby"
                className="mt-1.5"
              />
            </div>
          )}

          {!showDetails && selectedPartner && (
            <div className="rounded-lg bg-white/[0.025] p-4 text-xs text-[#e5e4e2]/65">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p>Warunki z kartoteki sprzedawcy dla marki wydarzenia</p>
                <button data-crm-action="secondary" type="button" onClick={() => setCustomizeTerms(true)} className="flex items-center gap-1.5 rounded px-2 py-1 text-[#d3bb73] hover:bg-white/5">
                  <Pencil className="h-3.5 w-3.5" /> Edytuj
                </button>
              </div>
              <p className="mt-3">{form.rate}% od {formatCommissionMoney(form.baseAmount)} netto · {commissionPaymentLabels[form.paymentMethod]}</p>
              {form.organizationId && <p className="mt-1">{organizations.find((item) => item.id === form.organizationId)?.name}</p>}
              {offerCommission?.partnerId === selectedPartner.id && <p className="mt-2 text-[#e5e4e2]/40">Procent zgodny z zaakceptowaną ofertą sprzedawcy.</p>}
            </div>
          )}
          {!showDetails && (
            <button type="button" onClick={() => setCustomizeTerms(true)} className="text-xs text-[#e5e4e2]/45 hover:text-[#e5e4e2]">
              Inna osoba lub własne warunki
            </button>
          )}
          {showDetails && <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs text-[#e5e4e2]/55">
              Sposób naliczenia
              <select
                value={form.calculationType}
                onChange={(event) => setForm({ ...form, calculationType: event.target.value as CommissionCalculationType })}
                className={`${inputClass} mt-1.5`}
              >
                <option value="percent">Procent od podstawy netto</option>
                <option value="fixed">Stała kwota</option>
              </select>
            </label>
            {form.calculationType === 'percent' ? (
              <>
                <label className="text-xs text-[#e5e4e2]/55">
                  Podstawa netto
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.baseAmount}
                    onChange={(event) => setForm({ ...form, baseAmount: Number(event.target.value || 0) })}
                    className={`${inputClass} mt-1.5`}
                  />
                </label>
                <label className="text-xs text-[#e5e4e2]/55">
                  Prowizja (%)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.rate}
                    onChange={(event) => setForm({ ...form, rate: Number(event.target.value || 0) })}
                    className={`${inputClass} mt-1.5`}
                  />
                </label>
              </>
            ) : (
              <label className="text-xs text-[#e5e4e2]/55 md:col-span-2">
                Kwota należna osobie
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.fixedAmount}
                  onChange={(event) => setForm({ ...form, fixedAmount: Number(event.target.value || 0) })}
                  className={`${inputClass} mt-1.5`}
                />
              </label>
            )}
            <label className="text-xs text-[#e5e4e2]/55">
              Sposób wypłaty
              <select
                value={form.paymentMethod}
                onChange={(event) => setForm({ ...form, paymentMethod: event.target.value as CommissionPaymentMethod })}
                className={`${inputClass} mt-1.5`}
              >
                {Object.entries(commissionPaymentLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs text-[#e5e4e2]/55">
              Czego dotyczy podstawa
              <input
                value={form.baseDescription}
                onChange={(event) => setForm({ ...form, baseDescription: event.target.value })}
                className={`${inputClass} mt-1.5`}
                placeholder="np. Podest z zaakceptowanej oferty"
              />
            </label>
            <label className="text-xs text-[#e5e4e2]/55">
              Termin wypłaty <span className="text-[#e5e4e2]/30">(opcjonalnie)</span>
              <input
                type="date"
                value={form.dueDate}
                onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
                className={`${inputClass} mt-1.5`}
              />
            </label>
          </div>

          {form.paymentMethod === 'cash_dividend' && (
            <label className="block max-w-xs text-xs text-[#e5e4e2]/55">
              Modelowa stawka podatku od dywidendy (%)
              <input
                type="number"
                min="0"
                max="99.99"
                step="0.01"
                value={form.dividendTaxRate}
                onChange={(event) => setForm({ ...form, dividendTaxRate: Number(event.target.value || 0) })}
                className={`${inputClass} mt-1.5`}
              />
            </label>
          )}

          <label className="block text-xs text-[#e5e4e2]/55">
            Notatka <span className="text-[#e5e4e2]/30">(opcjonalnie)</span>
            <textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              rows={2}
              className={`${inputClass} mt-1.5 resize-y`}
              placeholder="Ustalenia dotyczące prowizji..."
            />
          </label>

          </>}

          <div className="grid gap-3 rounded-lg border border-white/10 bg-amber-300/5 p-4 sm:grid-cols-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/35">Osoba otrzyma</p>
              <p className="mt-1 text-lg text-violet-200">{formatCommissionMoney(preview.nominalAmount)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/35">Koszt dla spółki</p>
              <p className="mt-1 text-lg text-amber-200">{formatCommissionMoney(preview.companyCostAmount)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/35">Narzut podatkowy</p>
              <p className="mt-1 text-lg text-[#e5e4e2]">{formatCommissionMoney(preview.taxBurdenAmount)}</p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={resetForm} className="rounded-lg border border-white/10 px-4 py-2 text-xs text-[#e5e4e2]/60">
              Anuluj
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-xs font-medium text-[#111522] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {editingId ? 'Zapisz zmiany' : 'Dodaj do rozliczenia'}
            </button>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs leading-5 text-[#e5e4e2]/45">Wypłaty częściowe oraz daty i numery przelewów zapiszesz w Rozliczeniach prowizji. Poniżej są kwoty naliczeń, nie saldo pozostałe po wypłatach.</p>
      <div className="mt-4 space-y-2">
        {commissions.map((commission) => {
          const companyCost = Number(commission.company_cost_amount ?? commission.amount ?? 0);
          const canEdit = canManage && commission.status !== 'paid';
          const isOwnerProfit = commission.automatic_source === 'seller_owner_profit';
          const settlementsHref = commissionSettlementsHref(commission);
          return (
            <div key={commission.id} className="rounded-lg border border-white/5 bg-[#0a0d1a] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-[#e5e4e2]">{commission.beneficiary_name}</p>
                  <p className="mt-1 text-xs text-[#e5e4e2]/40">
                    {commissionBeneficiaryLabels[commission.beneficiary_type]} · {commissionPaymentLabels[commission.payment_method || 'invoice']}
                  </p>
                  {commission.base_description && (
                    <p className="mt-1 text-xs text-[#e5e4e2]/35">{commission.base_description}</p>
                  )}
                  {commission.automatic_source === 'billing_contact' && (
                    <p className="mt-1 text-xs text-[#d3bb73]/70">Dodano z kontaktów firmy rozliczającej</p>
                  )}
                  {commission.automatic_source === 'event_referral' && (
                    <p className="mt-1 text-xs text-[#d3bb73]/70">Dodano z polecenia wydarzenia — niezależnie od płatnika</p>
                  )}
                  {isOwnerProfit && <div className="mt-2 text-xs text-[#d3bb73]/80">
                    <p>Opiekun · prowizja od zysku po kosztach i wynagrodzeniu sprzedawcy, nie od przychodu.</p>
                    <Link href={`/crm/events/${eventId}?tab=seller-arrangements#seller-owner-profit`} className="mt-1 inline-block hover:underline">Otwórz kalkulację i podstawę prowizji</Link>
                  </div>}
                  {settlementsHref && <Link href={settlementsHref} className="mt-2 inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"><Banknote className="h-3.5 w-3.5" />Rozliczenia prowizji i historia wypłat</Link>}
                </div>
                <div className="text-right">
                  <p className="text-sm text-violet-200">
                    {commission.automatic_waiting_for_offer ? 'Kwota: oczekuje na ofertę' : `${isOwnerProfit && commission.payment_method === 'payroll' ? 'brutto pracownika' : 'dla osoby'}: ${formatCommissionMoney(Number(commission.amount || 0))}`}
                  </p>
                  <p className="mt-1 text-xs text-amber-200/80">
                    koszt spółki: {formatCommissionMoney(companyCost)}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#e5e4e2]/40">
                  <span className="rounded bg-white/5 px-2 py-1">{commissionStatusLabels[commission.status]}</span>
                  {commission.calculation_type === 'percent' && (
                    <span>{commission.automatic_waiting_for_offer ? `${commission.rate}% · podstawa netto nieustalona` : `${commission.rate}% od ${formatCommissionMoney(Number(commission.base_amount || 0))} netto`}</span>
                  )}
                  {commission.due_date && <span>termin {new Date(commission.due_date).toLocaleDateString('pl-PL')}</span>}
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <select
                      value={commission.status}
                      disabled={commission.status === 'paid'}
                      onChange={(event) => handleStatusChange(commission, event.target.value as CommissionStatus)}
                      className="rounded border border-white/10 bg-[#111522] px-2 py-1 text-[11px] text-[#e5e4e2]/70"
                    >
                      <option value="planned">Planowana</option>
                      <option value="approved">Zatwierdzona</option>
                      <option value="paid">{commission.status !== 'paid' && settlementsHref ? 'Zapisz wypłatę w rozliczeniach…' : 'Wypłacona'}</option>
                      <option value="cancelled">Anulowana</option>
                    </select>
                    {canEdit && !isOwnerProfit && (
                      <button data-crm-action="secondary" type="button" onClick={() => editCommission(commission)} className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10">
                        <Pencil className="h-3.5 w-3.5" /> Edytuj
                      </button>
                    )}
                    {canEdit && commission.status !== 'cancelled' && (
                      <button type="button" onClick={() => handleCancelCommission(commission)} aria-label={`Anuluj prowizję dla ${commission.beneficiary_name}`} title="Anuluj prowizję" className="rounded p-1.5 text-red-300 hover:bg-red-400/10">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {commissions.length === 0 && !showForm && (
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-white/10 px-4 py-5 text-xs text-[#e5e4e2]/35">
            <Banknote className="h-4 w-4" /> Brak naliczonych prowizji dla tego wydarzenia.
          </div>
        )}
      </div>

      <div className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-[#e5e4e2]/30">
        <Calculator className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Koszt gotówki jest kalkulacją zarządczą: kwota dla osoby jest ubruttawiana podaną stawką podatku od dywidendy.
        Księgowanie wypłaty nadal wymaga właściwego dokumentu i kwalifikacji księgowej.
      </div>
    </div>
  );
}
