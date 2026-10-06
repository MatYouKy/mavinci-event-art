'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  BadgePercent,
  BarChart3,
  Building2,
  Check,
  Hotel,
  Loader2,
  MailPlus,
  Pencil,
  Plus,
  Search,
  Tags,
  UserRound,
  X,
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  CommissionPaymentMethod,
  DEFAULT_DIVIDEND_TAX_RATE,
  commissionPaymentLabels,
  formatCommissionMoney,
} from '@/lib/CRM/events/eventCommission';
import { supabase } from '@/lib/supabase/browser';
import SearchCombobox from '@/components/crm/SearchCombobox';
import SellerInboxPanel, { SellerCountBadge } from '@/components/seller/SellerInboxPanel';
import CrmSellerWorkspace from '@/components/seller/CrmSellerWorkspace';
import { CrmCartesianChart } from '@/components/crm/charts/CrmCharts';
import { sellerInboxCounts, type SellerInboxItem } from '@/lib/seller/inbox';
import { refreshSellerSidebarBadge, useSellerSidebarBadge } from '@/lib/seller/sidebarBadge';

type PartnerType = 'internal_employee' | 'hotel_employee' | 'agency_employee' | 'independent_referrer';
type PartnerStatus = 'onboarding' | 'active' | 'inactive';
type PersonSource = 'contact' | 'employee';

type PartnerProfile = {
  id: string;
  employee_id: string | null;
  contact_id: string | null;
  partner_type: PartnerType;
  organization_id: string | null;
  status: PartnerStatus;
  portal_enabled: boolean;
  portal_auth_user_id: string | null;
  notes: string | null;
};

type PersonOption = {
  id: string;
  label: string;
  detail: string;
  email: string | null;
};

type DirectoryData = {
  employee_id: string;
  is_admin: boolean;
  can_manage: boolean;
  profiles: PartnerProfile[];
  inbox: SellerInboxItem[];
};

type Organization = {
  id: string;
  name: string;
  alias: string | null;
  business_type: string | null;
};

type Company = {
  id: string;
  name: string;
};

type BrandTerm = {
  id?: string;
  sales_partner_id?: string;
  my_company_id: string;
  commission_enabled: boolean;
  default_commission_rate: number;
  default_payment_method: CommissionPaymentMethod;
  dividend_tax_rate: number;
  is_active: boolean;
};

type CommissionSummaryRow = {
  sales_partner_id: string | null;
  amount: number;
  company_cost_amount: number | null;
  status: string;
};

type PartnerOfferRow = {
  id: string;
  offer_number: string | null;
  title: string | null;
  sales_partner_id: string;
  portal_client_name: string | null;
  portal_client_company: string | null;
  commercial_model: 'markup' | 'commission';
  partner_base_net: number;
  client_total_net: number;
  partner_earnings_amount: number;
  partner_approval_status: string;
  status: string;
  created_at: string;
  partner_generated_at: string | null;
  offer_items?: Array<{ name: string; product_id: string | null; quantity: number }>;
};

const partnerTypeLabels: Record<PartnerType, string> = {
  internal_employee: 'Sprzedawca Mavinci',
  hotel_employee: 'Pracownik hotelu',
  agency_employee: 'Pracownik agencji',
  independent_referrer: 'Niezależny polecający',
};

const partnerStatusLabels: Record<PartnerStatus, string> = {
  onboarding: 'Do uzgodnienia',
  active: 'Aktywny',
  inactive: 'Nieaktywny',
};

const fieldClass =
  'w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/60';

export default function SalespeoplePage() {
  const { showSnackbar } = useSnackbar();
  const searchParams = useSearchParams();
  const deepLinkHandled = useRef(false);
  const loadRevision = useRef(0);
  const [directory, setDirectory] = useState<DirectoryData | null>(null);
  const isAdmin = directory?.is_admin === true;
  const canManage = directory?.can_manage === true;
  const canInvitePortal = canManage;
  const sellerNotifications = useSellerSidebarBadge();
  const sellerInbox = { ...sellerNotifications,
    items: sellerNotifications.employeeId === directory?.employee_id ? sellerNotifications.items : [] };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingPortalAccessFor, setSendingPortalAccessFor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [profiles, setProfiles] = useState<PartnerProfile[]>([]);
  const [employees, setEmployees] = useState<PersonOption[]>([]);
  const [contacts, setContacts] = useState<PersonOption[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [terms, setTerms] = useState<BrandTerm[]>([]);
  const [commissionRows, setCommissionRows] = useState<CommissionSummaryRow[]>([]);
  const [partnerOffers, setPartnerOffers] = useState<PartnerOfferRow[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | PartnerType>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [personSource, setPersonSource] = useState<PersonSource>('contact');
  const [personId, setPersonId] = useState('');
  const [partnerType, setPartnerType] = useState<PartnerType>('hotel_employee');
  const [organizationId, setOrganizationId] = useState('');
  const [status, setStatus] = useState<PartnerStatus>('active');
  const [portalEnabled, setPortalEnabled] = useState(false);
  const [portalAuthUserId, setPortalAuthUserId] = useState('');
  const [notes, setNotes] = useState('');
  const [draftTerms, setDraftTerms] = useState<Record<string, BrandTerm>>({});

  const loadData = useCallback(async (background = false) => {
    const revision = ++loadRevision.current;
    if (!background) setLoading(true);
    try {
      // Scope is resolved from the authenticated database session, not a cached
      // useCurrentEmployee/admin flag. Never fall back to the unscoped table.
      const result = await supabase.rpc('get_crm_seller_directory');
      if (result.error) {
        if (['PGRST202', '42883'].includes(result.error.code)) {
          throw new Error('Kartoteka wymaga migracji 20260926140000_scope_seller_directory_to_contact_owner.sql. Ze względów bezpieczeństwa pełna lista nie jest pobierana.');
        }
        throw result.error;
      }
      const access = result.data as DirectoryData | null;
      if (!access?.employee_id || !Array.isArray(access.profiles)) throw new Error('Brak dostępu do kartoteki sprzedawców.');
      if (revision !== loadRevision.current) return;
      const partnerIds = access.profiles.map((profile) => profile.id);
      let contactQuery = supabase.from('contacts').select('id,full_name,email').order('full_name').limit(1500);
      if (!access.is_admin) contactQuery = contactQuery.eq('owner_id', access.employee_id);
      const [employeesResult, contactsResult, organizationsResult, companiesResult, termsResult, commissionsResult, partnerOffersResult] =
      await Promise.all([
        access.is_admin
          ? supabase.from('employees').select('id,name,surname,email').eq('is_active', true).order('surname')
          : Promise.resolve({ data: [], error: null }),
        contactQuery,
        supabase.from('organizations').select('id,name,alias,business_type').order('name').limit(1000),
        supabase.from('my_companies').select('id,name').order('name'),
        partnerIds.length ? supabase
          .from('sales_partner_brand_terms')
          .select('id,sales_partner_id,my_company_id,commission_enabled,default_commission_rate,default_payment_method,dividend_tax_rate,is_active')
          .in('sales_partner_id', partnerIds) : Promise.resolve({ data: [], error: null }),
        partnerIds.length ? supabase
          .from('event_commissions')
          .select('sales_partner_id,amount,company_cost_amount,status')
          .in('sales_partner_id', partnerIds) : Promise.resolve({ data: [], error: null }),
        partnerIds.length ? supabase
          .from('offers')
          .select('id,offer_number,title,sales_partner_id,portal_client_name,portal_client_company,commercial_model,partner_base_net,client_total_net,partner_earnings_amount,partner_approval_status,status,created_at,partner_generated_at,offer_items(name,product_id,quantity)')
          .eq('sales_channel', 'seller_portal')
          .in('sales_partner_id', partnerIds)
          .order('created_at', { ascending: false })
          .limit(250) : Promise.resolve({ data: [], error: null }),
      ]);
      if (revision !== loadRevision.current) return;
      const detailError = [employeesResult, contactsResult, organizationsResult, companiesResult, termsResult, commissionsResult, partnerOffersResult]
        .find((response) => response.error)?.error;
      if (detailError) throw detailError;
      setDirectory(access);
      setProfiles(access.profiles);
      setEmployees((employeesResult.data || []).map((employee) => ({
        id: employee.id,
        label: `${employee.name} ${employee.surname}`.trim(),
        detail: employee.email || 'pracownik CRM',
        email: employee.email || null,
      })));
      setContacts((contactsResult.data || []).map((contact) => ({
        id: contact.id,
        label: contact.full_name,
        detail: contact.email || 'kontakt CRM',
        email: contact.email || null,
      })));
      setOrganizations((organizationsResult.data || []) as Organization[]);
      setCompanies((companiesResult.data || []) as Company[]);
      setTerms((termsResult.data || []) as BrandTerm[]);
      setCommissionRows((commissionsResult.data || []) as CommissionSummaryRow[]);
      setPartnerOffers((partnerOffersResult.data || []) as PartnerOfferRow[]);
      setLoadError('');
      if (!access.can_manage) setShowForm(false);
    } catch (error: unknown) {
      if (revision !== loadRevision.current) return;
      setDirectory(null);
      setProfiles([]);
      setEmployees([]);
      setContacts([]);
      setTerms([]);
      setCommissionRows([]);
      setPartnerOffers([]);
      setShowForm(false);
      setLoadError(error && typeof error === 'object' && 'message' in error
        ? String(error.message) : 'Nie udało się wczytać przypisanych sprzedawców.');
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let authUserId: string | null | undefined;
    void loadData();
    const refresh = () => { if (document.visibilityState === 'visible') void loadData(true); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('seller-workspace-changed', refresh);
    const { data: auth } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') { authUserId = session?.user.id || null; return; }
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
      const nextUserId = session?.user.id || null;
      if (authUserId === nextUserId) return;
      authUserId = nextUserId;
      loadRevision.current += 1;
      setDirectory(null);
      setProfiles([]);
      setShowForm(false);
      setEditingId(null);
      setPersonSource('contact');
      setPartnerType('hotel_employee');
      setTypeFilter('all');
      setLoading(true);
      deepLinkHandled.current = false;
      // Defer database/auth calls until Supabase releases its auth callback lock.
      window.setTimeout(() => { if (active) void loadData(); }, 0);
    });
    return () => {
      active = false;
      loadRevision.current += 1;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('seller-workspace-changed', refresh);
      auth.subscription.unsubscribe();
    };
  }, [loadData]);

  useEffect(() => {
    if (!loading && editingId && !profiles.some((profile) => profile.id === editingId)) {
      setShowForm(false);
      setEditingId(null);
    }
  }, [editingId, loading, profiles]);

  const personMap = useMemo(
    () => new Map([...employees, ...contacts].map((person) => [person.id, person])),
    [contacts, employees],
  );
  const organizationMap = useMemo(
    () => new Map(organizations.map((organization) => [organization.id, organization])),
    [organizations],
  );

  const personOptions = useMemo(
    () => (personSource === 'employee' ? employees : contacts).map((person) => ({
      id: person.id,
      label: person.label,
      description: person.detail,
    })),
    [contacts, employees, personSource],
  );

  const organizationOptions = useMemo(
    () => organizations.map((organization) => ({
      id: organization.id,
      label: organization.alias || organization.name,
      description: organization.alias ? organization.name : null,
      keywords: organization.business_type || '',
    })),
    [organizations],
  );

  const filteredProfiles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pl');
    return profiles.filter((profile) => {
      if (typeFilter !== 'all' && profile.partner_type !== typeFilter) return false;
      const person = personMap.get(profile.employee_id || profile.contact_id || '');
      const organization = organizationMap.get(profile.organization_id || '');
      return !query || `${person?.label || ''} ${person?.detail || ''} ${organization?.name || ''}`
        .toLocaleLowerCase('pl')
        .includes(query);
    });
  }, [organizationMap, personMap, profiles, search, typeFilter]);

  const profileStatusData = useMemo(() => Object.entries(partnerTypeLabels).map(([type, label]) => {
    const selected = filteredProfiles.filter((profile) => profile.partner_type === type);
    return {
      type: label,
      active: selected.filter((profile) => profile.status === 'active').length,
      onboarding: selected.filter((profile) => profile.status === 'onboarding').length,
      inactive: selected.filter((profile) => profile.status === 'inactive').length,
    };
  }).filter((row) => row.active + row.onboarding + row.inactive > 0), [filteredProfiles]);

  const partnerOfferAnalytics = useMemo(() => {
    const productCounts = new Map<string, number>();
    partnerOffers.forEach((offer) => offer.offer_items?.forEach((item) => {
      productCounts.set(item.name, (productCounts.get(item.name) || 0) + Number(item.quantity || 0));
    }));
    return {
      created: partnerOffers.length,
      generated: partnerOffers.filter((offer) => Boolean(offer.partner_generated_at)).length,
      sent: partnerOffers.filter((offer) => ['sent', 'viewed', 'accepted'].includes(offer.status)).length,
      accepted: partnerOffers.filter((offer) => offer.status === 'accepted').length,
      pipelineNet: partnerOffers.reduce((sum, offer) => sum + Number(offer.client_total_net || 0), 0),
      partnerEarnings: partnerOffers.reduce((sum, offer) => sum + Number(offer.partner_earnings_amount || 0), 0),
      topProducts: [...productCounts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5),
    };
  }, [partnerOffers]);

  const resetForm = () => {
    setEditingId(null);
    setPersonSource('contact');
    setPersonId('');
    setPartnerType('hotel_employee');
    setOrganizationId('');
    setStatus('active');
    setPortalEnabled(false);
    setPortalAuthUserId('');
    setNotes('');
    setDraftTerms({});
    setShowForm(false);
  };

  const beginAdd = () => {
    resetForm();
    setDraftTerms(Object.fromEntries(companies.map((company) => [company.id, {
      my_company_id: company.id,
      commission_enabled: false,
      default_commission_rate: 10,
      default_payment_method: 'cash_dividend' as CommissionPaymentMethod,
      dividend_tax_rate: DEFAULT_DIVIDEND_TAX_RATE,
      is_active: false,
    }])));
    setShowForm(true);
  };

  const beginEdit = (profile: PartnerProfile) => {
    const source: PersonSource = profile.employee_id ? 'employee' : 'contact';
    const profileTerms = terms.filter((term) => term.sales_partner_id === profile.id);
    setEditingId(profile.id);
    setPersonSource(source);
    setPersonId(profile.employee_id || profile.contact_id || '');
    setPartnerType(profile.partner_type);
    setOrganizationId(profile.organization_id || '');
    setStatus(profile.status);
    setPortalEnabled(profile.portal_enabled);
    setPortalAuthUserId(profile.portal_auth_user_id || '');
    setNotes(profile.notes || '');
    setDraftTerms(Object.fromEntries(companies.map((company) => {
      const saved = profileTerms.find((term) => term.my_company_id === company.id);
      return [company.id, saved || {
        my_company_id: company.id,
        commission_enabled: false,
        default_commission_rate: 10,
        default_payment_method: 'cash_dividend' as CommissionPaymentMethod,
        dividend_tax_rate: DEFAULT_DIVIDEND_TAX_RATE,
        is_active: false,
      }];
    })));
    setShowForm(true);
  };

  useEffect(() => {
    if (loading || deepLinkHandled.current) return;
    const contactId = searchParams.get('contactId');
    if (!contactId || !contacts.some((contact) => contact.id === contactId)) return;

    deepLinkHandled.current = true;
    const existingProfile = profiles.find((profile) => profile.contact_id === contactId);
    if (existingProfile) {
      const profileTerms = terms.filter((term) => term.sales_partner_id === existingProfile.id);
      setEditingId(existingProfile.id);
      setPersonSource('contact');
      setPersonId(contactId);
      setPartnerType(existingProfile.partner_type);
      setOrganizationId(existingProfile.organization_id || '');
      setStatus(existingProfile.status);
      setPortalEnabled(existingProfile.portal_enabled);
      setPortalAuthUserId(existingProfile.portal_auth_user_id || '');
      setNotes(existingProfile.notes || '');
      setDraftTerms(Object.fromEntries(companies.map((company) => {
        const saved = profileTerms.find((term) => term.my_company_id === company.id);
        return [company.id, saved || {
          my_company_id: company.id,
          commission_enabled: false,
          default_commission_rate: 10,
          default_payment_method: 'cash_dividend' as CommissionPaymentMethod,
          dividend_tax_rate: DEFAULT_DIVIDEND_TAX_RATE,
          is_active: false,
        }];
      })));
      setShowForm(true);
      return;
    }

    setEditingId(null);
    setPersonSource('contact');
    setPersonId(contactId);
    setPartnerType('hotel_employee');
    setOrganizationId('');
    setStatus('active');
    setPortalEnabled(true);
    setPortalAuthUserId('');
    setNotes('');
    setDraftTerms(Object.fromEntries(companies.map((company) => [company.id, {
      my_company_id: company.id,
      commission_enabled: false,
      default_commission_rate: 10,
      default_payment_method: 'cash_dividend' as CommissionPaymentMethod,
      dividend_tax_rate: DEFAULT_DIVIDEND_TAX_RATE,
      is_active: false,
    }])));
    setShowForm(true);
  }, [companies, contacts, loading, profiles, searchParams, terms]);

  const requestPortalAccess = async (profileId: string, forceEmail = false) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error('Sesja wygasła. Zaloguj się ponownie.');

    const response = await fetch('/bridge/seller/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ salesPartnerId: profileId, forceEmail }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Nie udało się przygotować dostępu do portalu');
    return result as { invited: boolean; alreadyLinked: boolean; emailSent: boolean; email: string };
  };

  const savePartner = async () => {
    if (!canManage || (!isAdmin && (personSource !== 'contact' || partnerType === 'internal_employee'
      || !contacts.some((contact) => contact.id === personId)))) {
      showSnackbar('Możesz zarządzać tylko przypisanymi do Ciebie sprzedawcami zewnętrznymi.', 'warning');
      return;
    }
    if (!personId) {
      showSnackbar('Wybierz osobę z bazy pracowników lub kontaktów', 'warning');
      return;
    }
    if (partnerType === 'hotel_employee' && !organizationId) {
      showSnackbar('Pracownik hotelu musi mieć przypisany hotel', 'warning');
      return;
    }
    if (portalEnabled && personSource !== 'contact') {
      showSnackbar('Konto portalu hotelowego musi być powiązane z osobą z kartoteki kontaktów', 'warning');
      return;
    }
    if (portalEnabled && !contacts.find((contact) => contact.id === personId)?.email) {
      showSnackbar('Aby wysłać dane logowania, uzupełnij adres e-mail w kartotece kontaktu', 'warning');
      return;
    }
    if (portalEnabled && status !== 'active') {
      showSnackbar('Dostęp do portalu można nadać tylko aktywnemu sprzedawcy', 'warning');
      return;
    }
    if (!Object.values(draftTerms).some((term) => term.is_active)) {
      showSnackbar('Włącz co najmniej jedną markę dla sprzedawcy', 'warning');
      return;
    }

    setSaving(true);
    const profilePayload = {
      employee_id: personSource === 'employee' ? personId : null,
      contact_id: personSource === 'contact' ? personId : null,
      partner_type: partnerType,
      organization_id: organizationId || null,
      status,
      portal_enabled: portalEnabled,
      portal_auth_user_id: portalEnabled ? (portalAuthUserId.trim() || null) : null,
      notes: notes.trim() || null,
      ...(!editingId ? { created_by: directory?.employee_id || null } : {}),
    };
    const profileResult = editingId
      ? await supabase.from('sales_partner_profiles').update(profilePayload).eq('id', editingId).select('id').single()
      : await supabase.from('sales_partner_profiles').insert(profilePayload).select('id').single();

    if (profileResult.error || !profileResult.data?.id) {
      setSaving(false);
      showSnackbar(profileResult.error?.message || 'Nie udało się zapisać profilu sprzedawcy', 'error');
      return;
    }

    const salesPartnerId = profileResult.data.id;
    const termsPayload = Object.values(draftTerms).map((term) => ({
      sales_partner_id: salesPartnerId,
      my_company_id: term.my_company_id,
      commission_enabled: term.commission_enabled,
      default_commission_rate: Number(term.default_commission_rate || 0),
      default_payment_method: term.default_payment_method,
      dividend_tax_rate: Number(term.dividend_tax_rate || DEFAULT_DIVIDEND_TAX_RATE),
      is_active: term.is_active,
    }));
    const { error: termsError } = await supabase
      .from('sales_partner_brand_terms')
      .upsert(termsPayload, { onConflict: 'sales_partner_id,my_company_id' });

    if (termsError) {
      setSaving(false);
      showSnackbar(termsError.message || 'Profil zapisano, ale nie udało się zapisać warunków marek', 'error');
      return;
    }

    let successMessage = editingId ? 'Profil sprzedawcy został zaktualizowany' : 'Sprzedawca został dodany';
    if (portalEnabled) {
      try {
        const access = await requestPortalAccess(salesPartnerId);
        successMessage = access.emailSent
          ? `Sprzedawca zapisany. Wiadomość do ustawienia hasła wysłano na ${access.email}`
          : `Sprzedawca zapisany. Konto ${access.email} jest połączone z portalem`;
      } catch (error: any) {
        setSaving(false);
        showSnackbar(`Profil zapisano, ale konto portalu nie zostało aktywowane: ${error.message}`, 'warning');
        await loadData();
        return;
      }
    }

    setSaving(false);
    showSnackbar(successMessage, 'success');
    resetForm();
    await loadData();
  };

  const updatePartnerStatus = async (profileId: string, nextStatus: PartnerStatus) => {
    const { error } = await supabase.from('sales_partner_profiles').update({ status: nextStatus }).eq('id', profileId);
    if (error) {
      showSnackbar(error.message || 'Nie udało się zmienić statusu', 'error');
      return;
    }
    await loadData();
  };

  const inviteToPortal = async (profileId: string) => {
    if (sendingPortalAccessFor) return;
    setSendingPortalAccessFor(profileId);
    try {
      const result = await requestPortalAccess(profileId, true);
      showSnackbar(
        result.emailSent
          ? `Wiadomość do ustawienia hasła wysłano na ${result.email}`
          : `Konto ${result.email} jest już powiązane z portalem`,
        'success',
      );
      await loadData();
    } catch (error: any) {
      showSnackbar(error.message || 'Nie udało się wysłać zaproszenia', 'error');
    } finally {
      setSendingPortalAccessFor(null);
    }
  };

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[#d3bb73]" /></div>;
  }

  return (
    <div className="min-h-screen bg-[#0f1119] p-4 text-[#e5e4e2] md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-[#d3bb73]/10 p-3"><BadgePercent className="h-6 w-6 text-[#d3bb73]" /></span>
              <div>
                <h1 className="text-2xl font-light">Sprzedawcy</h1>
                <p className="mt-1 text-sm text-[#e5e4e2]/45">{isAdmin ? 'Wszyscy sprzedawcy CRM oraz zewnętrzni.' : 'Twoi sprzedawcy zewnętrzni — zgodnie z opiekunem w kartotece kontaktu.'}</p>
              </div>
            </div>
          </div>
          {canManage && !showForm && (
            <button type="button" onClick={beginAdd} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#111522]">
              <Plus className="h-4 w-4" /> Dodaj sprzedawcę
            </button>
          )}
        </header>

        {searchParams.get('seller') && profiles.some((profile) => profile.id === searchParams.get('seller')) && <section className="rounded-xl bg-black/10 p-4"><Link href="/crm/salespeople" className="mb-4 inline-block text-xs text-[#d3bb73]">← Wróć do listy sprzedawców</Link><CrmSellerWorkspace key={searchParams.get('seller')} partnerId={searchParams.get('seller')!} contactId={profiles.find((profile) => profile.id === searchParams.get('seller'))?.contact_id || undefined} /></section>}

        {!loadError && searchParams.get('seller') && !profiles.some((profile) => profile.id === searchParams.get('seller')) && (
          <p className="rounded-xl bg-amber-400/10 p-4 text-sm text-amber-100/80">Nie masz dostępu do wskazanego sprzedawcy albo jego profil nie istnieje.</p>
        )}

        {loadError ? (
          <div role="alert" className="rounded-xl bg-amber-400/10 p-5 text-sm text-amber-100/80">
            <p>{loadError}</p>
            <button type="button" onClick={() => void loadData()} className="mt-3 text-[#d3bb73]">Spróbuj ponownie</button>
          </div>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-4">
              {([
                [isAdmin ? 'Wszyscy' : 'Moi sprzedawcy', profiles.length, UserRound],
                ['Pracownicy hoteli', profiles.filter((profile) => profile.partner_type === 'hotel_employee').length, Hotel],
                ['Aktywni', profiles.filter((profile) => profile.status === 'active').length, Check],
                ['Dostęp do portalu', profiles.filter((profile) => profile.portal_enabled).length, Building2],
              ] as const).map(([label, value, Icon]) => (
                <div key={label} className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
                  <div className="flex items-center justify-between"><p className="text-xs text-[#e5e4e2]/45">{label}</p><Icon className="h-4 w-4 text-[#d3bb73]/60" /></div>
                  <p className="mt-2 text-2xl font-light">{value}</p>
                </div>
              ))}
            </section>

            <section className="rounded-xl border border-sky-300/10 bg-[#1c1f33]">
              <div className="flex items-center gap-3 border-b border-white/5 p-5">
                <span className="rounded-lg bg-sky-300/10 p-2"><BarChart3 className="h-5 w-5 text-sky-300" /></span>
                <div><h2 className="font-medium">Oferty z portalu hotelowego</h2><p className="mt-1 text-xs text-[#e5e4e2]/40">Dane o wygenerowanych ofertach, wybranych pozycjach, cenie bazowej i cenie hotelu.</p></div>
              </div>
              <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ['Utworzone / wygenerowane', `${partnerOfferAnalytics.created} / ${partnerOfferAnalytics.generated}`],
                  ['Wysłane', partnerOfferAnalytics.sent],
                  ['Zaakceptowane', partnerOfferAnalytics.accepted],
                  ['Wartość klienta netto', formatCommissionMoney(partnerOfferAnalytics.pipelineNet)],
                  ['Wynagrodzenie partnerów', formatCommissionMoney(partnerOfferAnalytics.partnerEarnings)],
                ].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-[#0f1119] p-3"><p className="text-[10px] uppercase tracking-wide text-white/30">{label}</p><p className="mt-2 text-lg font-light">{value}</p></div>)}
              </div>
              <div className="grid gap-5 border-t border-white/5 p-5 lg:grid-cols-[.7fr_1.3fr]">
                <div><h3 className="text-sm font-medium">Najczęściej wybierane pozycje</h3><div className="mt-3 space-y-2">{partnerOfferAnalytics.topProducts.map(([name, quantity], index) => <div key={name} className="flex items-center justify-between rounded-lg bg-[#0f1119] px-3 py-2 text-xs"><span className="truncate"><span className="mr-2 text-[#d3bb73]">{index + 1}.</span>{name}</span><span className="ml-3 text-white/40">{quantity}×</span></div>)}{partnerOfferAnalytics.topProducts.length === 0 && <p className="py-5 text-xs text-white/30">Brak danych produktowych.</p>}</div></div>
                <div className="space-y-2">
                  <p className="text-xs text-white/50">Powiadomienia: {sellerInbox.scope === 'all' ? 'wszyscy sprzedawcy' : 'przypisani do mnie'}. Ten sam zakres i suma w menu bocznym.</p>
                  <SellerInboxPanel source={{ ...sellerInbox, refresh: refreshSellerSidebarBadge }} />
                </div>
              </div>
            </section>

            {showForm && canManage && (
              <section className="space-y-5 rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-5">
                <div className="flex items-center justify-between gap-3">
                  <div><h2 className="font-medium">{editingId ? 'Edytuj profil sprzedawcy' : 'Nowy sprzedawca'}</h2><p className="mt-1 text-xs text-[#e5e4e2]/40">Osoba pozostaje w swojej kartotece; tutaj zapisujesz tylko warunki handlowe.</p></div>
                  <button type="button" onClick={resetForm} className="rounded p-1.5 text-[#e5e4e2]/40 hover:bg-white/5"><X className="h-4 w-4" /></button>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <label className="text-xs text-[#e5e4e2]/55">Źródło osoby<select value={personSource} disabled={Boolean(editingId) || !isAdmin} onChange={(event) => { const source = event.target.value as PersonSource; setPersonSource(source); setPersonId(''); setPartnerType(source === 'employee' ? 'internal_employee' : 'hotel_employee'); }} className={`${fieldClass} mt-1.5 disabled:opacity-50`}><option value="contact">{isAdmin ? 'Kontakty CRM' : 'Moje kontakty zewnętrzne'}</option>{isAdmin && <option value="employee">Pracownicy Mavinci</option>}</select></label>
                  <label className="text-xs text-[#e5e4e2]/55">Rodzaj współpracy<select value={partnerType} onChange={(event) => setPartnerType(event.target.value as PartnerType)} className={`${fieldClass} mt-1.5`}>{Object.entries(partnerTypeLabels).filter(([value]) => isAdmin || value !== 'internal_employee').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label className="text-xs text-[#e5e4e2]/55">Status<select value={status} onChange={(event) => setStatus(event.target.value as PartnerStatus)} className={`${fieldClass} mt-1.5`}>{Object.entries(partnerStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                </div>

                <div>
                  <label className="block text-xs text-[#e5e4e2]/55">Osoba</label>
                  <SearchCombobox
                    value={personId}
                    options={personOptions}
                    onChange={setPersonId}
                    disabled={Boolean(editingId)}
                    allowClear={!editingId}
                    placeholder="Wyszukaj po imieniu, nazwisku lub e-mailu..."
                    emptyLabel="Brak pasującej osoby"
                    className="mt-1.5"
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-xs text-[#e5e4e2]/55">Hotel / organizacja {partnerType !== 'hotel_employee' && <span className="text-[#e5e4e2]/30">(opcjonalnie)</span>}<SearchCombobox value={organizationId} options={organizationOptions} onChange={setOrganizationId} placeholder="Wyszukaj hotel lub organizację..." emptyLabel="Brak pasującej organizacji" className="mt-1.5" /></label>
                  <label className="text-xs text-[#e5e4e2]/55">Notatka<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className={`${fieldClass} mt-1.5 resize-y`} placeholder="Ustalenia dotyczące współpracy..." /></label>
                </div>

                <div>
                  <h3 className="text-sm font-medium">Warunki dla marek</h3>
                  <p className="mt-1 text-xs text-[#e5e4e2]/40">Każda marka może mieć inną stawkę i sposób rozliczenia.</p>
                  <div className="mt-3 space-y-2">{companies.map((company) => { const term = draftTerms[company.id] || { my_company_id: company.id, commission_enabled: false, default_commission_rate: 10, default_payment_method: 'cash_dividend' as CommissionPaymentMethod, dividend_tax_rate: DEFAULT_DIVIDEND_TAX_RATE, is_active: false }; return <div key={company.id} className={`grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(200px,1fr)_140px_220px_120px] ${term.is_active ? 'border-[#d3bb73]/20 bg-[#d3bb73]/5' : 'border-white/5 bg-[#0f1119]'}`}><div className="space-y-2"><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={term.is_active} onChange={(event) => setDraftTerms({ ...draftTerms, [company.id]: { ...term, is_active: event.target.checked } })} /><span>{company.name}</span></label><label className="flex items-center gap-2 text-[11px] text-[#e5e4e2]/55"><input type="checkbox" disabled={!term.is_active} checked={term.commission_enabled} onChange={(event) => setDraftTerms({ ...draftTerms, [company.id]: { ...term, commission_enabled: event.target.checked } })} /><span>Rozliczenie prowizyjne</span></label></div><label className="text-[11px] text-[#e5e4e2]/45">Prowizja (%)<input type="number" min="0" step="0.01" disabled={!term.is_active || !term.commission_enabled} value={term.default_commission_rate} onChange={(event) => setDraftTerms({ ...draftTerms, [company.id]: { ...term, default_commission_rate: Number(event.target.value || 0) } })} className={`${fieldClass} mt-1 py-1.5 disabled:opacity-30`} /></label><label className="text-[11px] text-[#e5e4e2]/45">Sposób wypłaty<select disabled={!term.is_active || !term.commission_enabled} value={term.default_payment_method} onChange={(event) => setDraftTerms({ ...draftTerms, [company.id]: { ...term, default_payment_method: event.target.value as CommissionPaymentMethod } })} className={`${fieldClass} mt-1 py-1.5 disabled:opacity-30`}>{Object.entries(commissionPaymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-[11px] text-[#e5e4e2]/45">Podatek (%)<input type="number" min="0" max="99.99" step="0.01" disabled={!term.is_active || !term.commission_enabled || term.default_payment_method !== 'cash_dividend'} value={term.dividend_tax_rate} onChange={(event) => setDraftTerms({ ...draftTerms, [company.id]: { ...term, dividend_tax_rate: Number(event.target.value || 0) } })} className={`${fieldClass} mt-1 py-1.5 disabled:opacity-30`} /></label></div>; })}</div>
                </div>

                <div className={`rounded-lg border p-3 ${personSource === 'contact' ? 'border-sky-300/10 bg-sky-300/5' : 'border-white/5 bg-white/[0.02] opacity-45'}`}>
                  <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={portalEnabled} disabled={personSource !== 'contact'} onChange={(event) => setPortalEnabled(event.target.checked)} className="mt-0.5" /><span><span className="block text-sky-100">Nadaj dostęp do portalu sprzedawcy</span><span className="mt-1 block text-xs text-sky-100/45">Po zapisaniu system utworzy lub połączy konto z adresem e-mail kontaktu i od razu wyśle zaproszenie. Portal pokaże wyłącznie dane tej osoby.</span></span></label>
                  {portalEnabled && personSource === 'contact' && <p className="mt-3 text-xs text-sky-100/45">Kontakt będzie mógł się zalogować, wylogować, samodzielnie zmienić hasło oraz odzyskać je z ekranu logowania.</p>}
                </div>

                <div className="flex justify-end gap-2"><button type="button" onClick={resetForm} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-[#e5e4e2]/60">Anuluj</button><button type="button" disabled={saving} onClick={savePartner} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#111522] disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Zapisz profil</button></div>
              </section>
            )}

            <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d3bb73]/10 p-5">
                <div className="relative min-w-64 max-w-md flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-[#e5e4e2]/30" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj sprzedawcy lub hotelu..." className={`${fieldClass} pl-9`} /></div>
                <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | PartnerType)} className="rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2.5 text-sm"><option value="all">Wszystkie rodzaje</option>{Object.entries(partnerTypeLabels).filter(([value]) => isAdmin || value !== 'internal_employee').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              </div>
              <div className="mx-5 my-4 rounded-xl bg-black/10 p-4">
                <h2 className="text-sm font-medium">Sprzedawcy według rodzaju współpracy i statusu</h2>
                <p className="mt-1 mb-4 text-xs text-[#e5e4e2]/45">Liczba profili w aktualnych filtrach: {filteredProfiles.length}. Wykres uwzględnia wyszukiwanie i wybrany rodzaj współpracy.</p>
                <CrmCartesianChart
                  data={profileStatusData}
                  categoryKey="type"
                  series={[
                    { key: 'active', label: 'Aktywni', color: '#34d399' },
                    { key: 'onboarding', label: 'Do uzgodnienia', color: '#d3bb73' },
                    { key: 'inactive', label: 'Nieaktywni', color: '#94a3b8' },
                  ]}
                  kind="bar"
                  horizontal
                  stacked
                  height={280}
                  valueFormatter={(value) => value.toLocaleString('pl-PL', { maximumFractionDigits: 0 })}
                  axisFormatter={(value) => Number.isInteger(value) ? String(value) : ''}
                  ariaLabel="Liczba sprzedawców według rodzaju współpracy i statusu w aktualnym wyszukiwaniu"
                  showLegend
                  emptyMessage="Brak sprzedawców spełniających filtry."
                />
              </div>
<div className="divide-y divide-white/5">{filteredProfiles.map((profile) => { const person = personMap.get(profile.employee_id || profile.contact_id || ''); const organization = organizationMap.get(profile.organization_id || ''); const profileTerms = terms.filter((term) => term.sales_partner_id === profile.id && term.is_active); const rows = commissionRows.filter((row) => row.sales_partner_id === profile.id && row.status !== 'cancelled'); const payable = rows.filter((row) => row.status !== 'paid').reduce((sum, row) => sum + Number(row.amount || 0), 0); const hasCommission = profileTerms.some((term) => term.commission_enabled); const profileHref = profile.contact_id ? `/crm/contacts/${profile.contact_id}?tab=seller` : `/crm/salespeople?seller=${profile.id}`; const alerts = sellerInboxCounts(sellerInbox.items, profile.id); const chatHref = `${profileHref}&section=chat`; const isSendingAccess = sendingPortalAccessFor === profile.id; return <div key={profile.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(220px,1.2fr)_minmax(180px,1fr)_minmax(240px,1.4fr)_150px_auto] lg:items-center"><div className="min-w-0"><div className="flex items-center gap-2">{profile.partner_type === 'hotel_employee' ? <Hotel className="h-4 w-4 text-[#d3bb73]" /> : <UserRound className="h-4 w-4 text-[#d3bb73]" />}{profileHref ? <Link href={profileHref} className="truncate text-sm hover:text-[#d3bb73]">{person?.label || 'Nieznana osoba'}</Link> : <span className="truncate text-sm">{person?.label || 'Nieznana osoba'}</span>}</div><p className="mt-1 text-xs text-[#e5e4e2]/35">{partnerTypeLabels[profile.partner_type]}</p><div className="mt-2 flex flex-wrap gap-2">{alerts.reviews > 0 && <Link href={profileHref} className="flex items-center gap-1.5 rounded-md bg-amber-300/10 px-2 py-1 text-[10px] text-amber-200">Do decyzji <SellerCountBadge count={alerts.reviews} label="Oferty do decyzji" /></Link>}{alerts.messages > 0 && <Link href={chatHref} className="flex items-center gap-1.5 rounded-md bg-sky-300/10 px-2 py-1 text-[10px] text-sky-200">Wiadomości <SellerCountBadge count={alerts.messages} label="Nowe wiadomości" /></Link>}{alerts.notices > 0 && <Link href={profileHref} className="flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 text-[10px] text-white/65">Powiadomienia <SellerCountBadge count={alerts.notices} label="Powiadomienia" /></Link>}<Link href={chatHref} className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-[#d3bb73]">Otwórz rozmowy</Link></div></div><div><p className="text-sm text-[#e5e4e2]/70">{organization?.alias || organization?.name || 'Bez organizacji'}</p>{profile.portal_enabled && <p className={`mt-1 text-[11px] ${profile.portal_auth_user_id ? 'text-emerald-300/70' : 'text-amber-300/70'}`}>{profile.portal_auth_user_id ? 'dostęp do portalu nadany' : 'oczekuje na zaproszenie'}</p>}</div><div className="flex flex-wrap gap-1.5">{profileTerms.map((term) => { const company = companies.find((item) => item.id === term.my_company_id); return <span key={term.my_company_id} className="rounded bg-[#d3bb73]/10 px-2 py-1 text-[11px] text-[#d3bb73]">{company?.name || 'Marka'} · {term.commission_enabled ? `${term.default_commission_rate}%` : 'bez prowizji'}</span>; })}{profileTerms.length === 0 && <span className="text-xs text-amber-300/60">Brak aktywnej marki</span>}</div><div>{hasCommission ? <><p className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/35">Do wypłaty</p><p className="mt-1 text-sm text-violet-200">{formatCommissionMoney(payable)}</p></> : <p className="text-xs text-[#e5e4e2]/35">Bez rozliczeń prowizyjnych</p>}</div><div className="flex items-center justify-end gap-2">{canInvitePortal && profile.portal_enabled && <button type="button" disabled={Boolean(sendingPortalAccessFor)} onClick={() => inviteToPortal(profile.id)} className="flex items-center gap-1 rounded-md bg-sky-300/10 px-2 py-1.5 text-[11px] text-sky-200 hover:bg-sky-300/15 disabled:cursor-wait disabled:opacity-50">{isSendingAccess ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailPlus className="h-3.5 w-3.5" />} {profile.portal_auth_user_id ? 'Wyślij logowanie' : 'Zaproś'}</button>}{canManage && <Link href={`/crm/salespeople/${profile.id}/pricing`} title="Indywidualny cennik" className="rounded p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10"><Tags className="h-4 w-4" /></Link>}{canManage ? <select value={profile.status} onChange={(event) => updatePartnerStatus(profile.id, event.target.value as PartnerStatus)} className="rounded border border-white/10 bg-[#0f1119] px-2 py-1.5 text-xs"><option value="onboarding">Do uzgodnienia</option><option value="active">Aktywny</option><option value="inactive">Nieaktywny</option></select> : <span className="text-xs text-[#e5e4e2]/45">{partnerStatusLabels[profile.status]}</span>}{canManage && <button type="button" onClick={() => beginEdit(profile)} className="rounded p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10"><Pencil className="h-4 w-4" /></button>}</div></div>; })}{filteredProfiles.length === 0 && <p className="px-5 py-12 text-center text-sm text-[#e5e4e2]/35">Brak sprzedawców spełniających filtry.</p>}</div>
            </section>
          </>
        )}
      </div>

      {sendingPortalAccessFor && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Wysyłanie danych logowania">
          <div className="w-full max-w-sm rounded-2xl bg-[#1c1f33] p-7 text-center shadow-[0_24px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/5">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]/10">
              <Loader2 className="h-8 w-8 animate-spin text-[#d3bb73]" />
            </span>
            <h2 className="mt-5 text-lg font-medium text-[#e5e4e2]">Wysyłamy dane logowania</h2>
            <p className="mt-2 text-sm leading-6 text-[#e5e4e2]/50">Przygotowujemy bezpieczny link i wiadomość e-mail. To może potrwać kilka sekund.</p>
          </div>
        </div>
      )}
    </div>
  );
}
