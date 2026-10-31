'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Tags } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';
import SearchCombobox from '@/components/crm/SearchCombobox';
import {
  CommissionPaymentMethod, DEFAULT_DIVIDEND_TAX_RATE, commissionPaymentLabels,
} from '@/lib/CRM/events/eventCommission';
import type { SellerInboxItem } from '@/lib/seller/inbox';

export type PartnerType = 'internal_employee' | 'hotel_employee' | 'agency_employee' | 'independent_referrer';
export type PartnerStatus = 'onboarding' | 'active' | 'inactive';
export type PersonSource = 'contact' | 'employee';

export type PartnerProfile = {
  id: string;
  employee_id: string | null;
  contact_id: string | null;
  partner_type: PartnerType;
  organization_id: string | null;
  portal_default_company_id?: string | null;
  status: PartnerStatus;
  portal_enabled: boolean;
  portal_auth_user_id: string | null;
  notes: string | null;
};

export type PersonOption = {
  id: string;
  label: string;
  detail: string;
  email: string | null;
};

export type DirectoryData = {
  employee_id: string;
  is_admin: boolean;
  can_manage: boolean;
  profiles: PartnerProfile[];
  inbox: SellerInboxItem[];
};

export type Organization = {
  id: string;
  name: string;
  alias: string | null;
  business_type: string | null;
  location_id: string | null;
};

export type Company = {
  id: string;
  name: string;
};

export type BrandTerm = {
  id?: string;
  sales_partner_id?: string;
  my_company_id: string;
  commission_enabled: boolean;
  default_commission_rate: number;
  default_payment_method: CommissionPaymentMethod;
  dividend_tax_rate: number;
  is_active: boolean;
};

export const partnerTypeLabels: Record<PartnerType, string> = {
  internal_employee: 'Sprzedawca Mavinci',
  hotel_employee: 'Pracownik hotelu',
  agency_employee: 'Pracownik agencji',
  independent_referrer: 'Niezależny polecający',
};

export const partnerStatusLabels: Record<PartnerStatus, string> = {
  onboarding: 'Do uzgodnienia',
  active: 'Aktywny',
  inactive: 'Nieaktywny',
};

const fieldClass =
  'w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/25';

export const requestPortalAccess = async (profileId: string, forceEmail = false) => {
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

type Props = {
  partnerId?: string;
  contactId?: string;
  onCancel?: () => void;
  onSaved?: (profile: { id: string; contactId: string | null }) => void;
};

export default function CrmSellerProfileSettings({ partnerId, contactId, onCancel, onSaved }: Props) {
  const { showSnackbar } = useSnackbar();
  const [directory, setDirectory] = useState<DirectoryData | null>(null);
  const isAdmin = directory?.is_admin === true;
  const canManage = directory?.can_manage === true;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [employees, setEmployees] = useState<PersonOption[]>([]);
  const [contacts, setContacts] = useState<PersonOption[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const loadRevision = useRef(0);
  const saveLock = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [personSource, setPersonSource] = useState<PersonSource>('contact');
  const [personId, setPersonId] = useState('');
  const [partnerType, setPartnerType] = useState<PartnerType>('hotel_employee');
  const [organizationId, setOrganizationId] = useState('');
  const [defaultCompanyId, setDefaultCompanyId] = useState('');
  const [status, setStatus] = useState<PartnerStatus>('active');
  const [portalEnabled, setPortalEnabled] = useState(false);
  const [portalAuthUserId, setPortalAuthUserId] = useState('');
  const [notes, setNotes] = useState('');
  const [draftTerms, setDraftTerms] = useState<Record<string, BrandTerm>>({});


  const loadData = useCallback(async () => {
    const revision = ++loadRevision.current;
    setLoading(true);
    setLoadError('');
    setSaveNotice('');
    try {
      // Resolve management rights from the current session. Do not use a cached
      // admin flag or fetch unrelated sellers' prices and settlements.
      const result = await supabase.rpc('get_crm_seller_directory');
      if (result.error) throw result.error;
      const access = result.data as DirectoryData | null;
      if (!access?.employee_id || !Array.isArray(access.profiles)) throw new Error('Brak dostępu do ustawień sprzedawcy.');
      if (!access.can_manage) throw new Error('Nie masz uprawnień do zmiany ustawień sprzedawcy.');
      const profile = partnerId
        ? access.profiles.find(item => item.id === partnerId)
        : contactId ? access.profiles.find(item => item.contact_id === contactId) : undefined;
      if (partnerId && !profile) throw new Error('Nie masz dostępu do wskazanego sprzedawcy lub jego profil już nie istnieje.');
      if (profile && contactId && profile.contact_id !== contactId) throw new Error('Profil nie należy do tego kontaktu.');
      const selectedContactId = profile?.contact_id || contactId;
      let contactQuery = supabase.from('contacts').select('id,full_name,email').order('full_name');
      if (selectedContactId) contactQuery = contactQuery.eq('id', selectedContactId);
      else contactQuery = contactQuery.limit(1500);
      if (!access.is_admin) contactQuery = contactQuery.eq('owner_id', access.employee_id);
      let employeeQuery = supabase.from('employees').select('id,name,surname,email').order('surname');
      if (profile?.employee_id) employeeQuery = employeeQuery.eq('id', profile.employee_id);
      else employeeQuery = employeeQuery.eq('is_active', true);
      const [people, staff, orgs, brands, savedTerms, defaults] = await Promise.all([
        contactQuery,
        access.is_admin && (!profile || profile.employee_id)
          ? employeeQuery : Promise.resolve({ data: [], error: null }),
        supabase.from('organizations').select('id,name,alias,business_type,location_id').order('name').limit(1000),
        supabase.from('my_companies').select('id,name').order('name'),
        profile ? supabase.from('sales_partner_brand_terms')
          .select('id,sales_partner_id,my_company_id,commission_enabled,default_commission_rate,default_payment_method,dividend_tax_rate,is_active')
          .eq('sales_partner_id', profile.id) : Promise.resolve({ data: [], error: null }),
        profile ? supabase.from('sales_partner_profiles').select('portal_default_company_id')
          .eq('id', profile.id).single() : Promise.resolve({ data: null, error: null }),
      ]);
      if (revision !== loadRevision.current) return;
      const failure = [people, staff, orgs, brands, savedTerms, defaults].find(item => item.error)?.error;
      if (failure) throw failure;
      if (selectedContactId && !people.data?.some(item => item.id === selectedContactId)) {
        throw new Error('Nie można odczytać kontaktu przypisanego do tego profilu.');
      }
      const loadedCompanies = (brands.data || []) as Company[];
      const loadedTerms = (savedTerms.data || []) as BrandTerm[];
      setDirectory(access);
      setContacts((people.data || []).map(person => ({
        id: person.id, label: person.full_name, detail: person.email || 'kontakt CRM', email: person.email || null,
      })));
      setEmployees((staff.data || []).map(person => ({
        id: person.id, label: `${person.name} ${person.surname}`.trim(), detail: person.email || 'pracownik CRM', email: person.email || null,
      })));
      setOrganizations((orgs.data || []) as Organization[]);
      setCompanies(loadedCompanies);
      setEditingId(profile?.id || null);
      setPersonSource(profile?.employee_id ? 'employee' : 'contact');
      setPersonId(profile?.employee_id || selectedContactId || '');
      setPartnerType(profile?.partner_type || 'hotel_employee');
      setOrganizationId(profile?.organization_id || '');
      setDefaultCompanyId(defaults.data?.portal_default_company_id || '');
      setStatus(profile?.status || 'active');
      setPortalEnabled(profile?.portal_enabled ?? Boolean(contactId));
      setPortalAuthUserId(profile?.portal_auth_user_id || '');
      setNotes(profile?.notes || '');
      setDraftTerms(Object.fromEntries(loadedCompanies.map(company => [company.id,
        loadedTerms.find(term => term.my_company_id === company.id) || {
          my_company_id: company.id, commission_enabled: false, default_commission_rate: 10,
          default_payment_method: 'cash_dividend' as CommissionPaymentMethod,
          dividend_tax_rate: DEFAULT_DIVIDEND_TAX_RATE, is_active: false,
        },
      ])));
    } catch (failure) {
      if (revision !== loadRevision.current) return;
      setDirectory(null);
      setLoadError(failure && typeof failure === 'object' && 'message' in failure
        ? String(failure.message) : 'Nie udało się wczytać ustawień sprzedawcy.');
    } finally { if (revision === loadRevision.current) setLoading(false); }
  }, [partnerId, contactId]);

  useEffect(() => {
    void loadData();
    return () => { loadRevision.current += 1; };
  }, [loadData, attempt]);
  useEffect(() => {
    let active = true;
    let userId: string | null | undefined;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') { userId = session?.user.id || null; return; }
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
      const nextUserId = session?.user.id || null;
      if (nextUserId === userId) return;
      userId = nextUserId;
      loadRevision.current += 1;
      setDirectory(null);
      setLoading(true);
      window.setTimeout(() => { if (active) setAttempt(value => value + 1); }, 0);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

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

  const savePartner = async () => {
    if (saveLock.current) return;
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
    if (portalEnabled && !organizationId) {
      showSnackbar('Wybierz organizację, w imieniu której sprzedawca będzie tworzył oferty', 'warning'); return;
    }
    if ((partnerType === 'hotel_employee' || organizations.find(org => org.id === organizationId)?.business_type === 'hotel') && !organizations.find(org => org.id === organizationId)?.location_id) {
      showSnackbar('Powiąż hotel z lokalizacją w kartotece organizacji. Sale i teren zewnętrzny dodaj w tej lokalizacji.', 'warning'); return;
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
    const activeCompanies = Object.values(draftTerms).filter(term => term.is_active);
    const effectiveDefaultCompany = activeCompanies.length === 1 ? activeCompanies[0].my_company_id : defaultCompanyId;
    if (portalEnabled && !activeCompanies.some(term => term.my_company_id === effectiveDefaultCompany)) {
      showSnackbar('Wskaż domyślny cennik nowych ofert sprzedawcy', 'warning'); return;
    }

    if (Object.values(draftTerms).some(term => !Number.isFinite(Number(term.default_commission_rate)) || Number(term.default_commission_rate) < 0 || !Number.isFinite(Number(term.dividend_tax_rate)) || Number(term.dividend_tax_rate) < 0 || Number(term.dividend_tax_rate) >= 100)) {
      showSnackbar('Podaj nieujemną prowizję oraz podatek od 0 do poniżej 100%.', 'warning');
      return;
    }
    saveLock.current = true;
    setSaving(true);
    setSaveNotice('');
    const operationRevision = loadRevision.current;
    let profileWritten = false;
    try {
    const profilePayload = {
      employee_id: personSource === 'employee' ? personId : null,
      contact_id: personSource === 'contact' ? personId : null,
      partner_type: partnerType,
      organization_id: organizationId || null,
      portal_default_company_id: activeCompanies.some(term => term.my_company_id === effectiveDefaultCompany) ? effectiveDefaultCompany : null,
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
    profileWritten = true;
    if (operationRevision !== loadRevision.current) return;
    // Keep the newly assigned ID even if saving terms or sending an invite fails.
    // A retry must update the same profile instead of creating a duplicate.
    setEditingId(salesPartnerId);
    const termsPayload = Object.values(draftTerms).map((term) => ({
      sales_partner_id: salesPartnerId,
      my_company_id: term.my_company_id,
      commission_enabled: term.commission_enabled,
      default_commission_rate: Number(term.default_commission_rate || 0),
      default_payment_method: term.default_payment_method,
      dividend_tax_rate: Number(term.dividend_tax_rate ?? DEFAULT_DIVIDEND_TAX_RATE),
      is_active: term.is_active,
    }));
    const { error: termsError } = await supabase
      .from('sales_partner_brand_terms')
      .upsert(termsPayload, { onConflict: 'sales_partner_id,my_company_id' });

    if (termsError) {
      setSaving(false);
      const message = 'Profil zapisano, ale nie udało się zapisać warunków marek. Popraw ustawienia i zapisz ponownie. ' + termsError.message;
      setSaveNotice(message);
      showSnackbar(message, 'error');
      return;
    }

    if (operationRevision !== loadRevision.current) return;
    let successMessage = editingId ? 'Profil sprzedawcy został zaktualizowany' : 'Sprzedawca został dodany';
    if (portalEnabled) {
      try {
        const access = await requestPortalAccess(salesPartnerId);
        successMessage = access.emailSent
          ? `Sprzedawca zapisany. Wiadomość do ustawienia hasła wysłano na ${access.email}`
          : `Sprzedawca zapisany. Konto ${access.email} jest połączone z portalem`;
      } catch (error: any) {
        if (operationRevision !== loadRevision.current) return;
        setSaving(false);
        const message = `Profil i warunki zapisano, ale nie udało się przygotować dostępu do portalu: ${error.message}`;
        setSaveNotice(message);
        showSnackbar(message, 'warning');
        return;
      }
    }

    if (operationRevision !== loadRevision.current) return;
    showSnackbar(successMessage, 'success');
    onSaved?.({ id: salesPartnerId, contactId: personSource === 'contact' ? personId : null });
    if (!onSaved) setAttempt(value => value + 1);
    } catch (failure) {
      if (operationRevision !== loadRevision.current) return;
      const message = failure && typeof failure === 'object' && 'message' in failure
        ? String(failure.message) : 'Nie udało się zapisać ustawień sprzedawcy.';
      setSaveNotice(message);
      showSnackbar(message, 'error');
    } finally {
      saveLock.current = false;
      setSaving(false);
      if (profileWritten) window.dispatchEvent(new Event('seller-workspace-changed'));
    }
  };


  if (loading) return <div role="status" className="flex items-center gap-2 rounded-xl bg-white/[0.03] p-6 text-sm text-white/55"><Loader2 className="h-5 w-5 animate-spin text-[#d3bb73]" />Wczytywanie ustawień sprzedawcy…</div>;
  if (loadError || !canManage) return <div role="alert" className="space-y-3 rounded-xl bg-amber-300/5 p-5 text-sm text-amber-200"><p>{loadError || 'Nie masz uprawnień do zmiany ustawień sprzedawcy.'}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="rounded-lg bg-white/5 px-3 py-2">Spróbuj ponownie</button></div>;

  return <div className="space-y-5">
    {saveNotice && <p role="alert" className="rounded-xl bg-amber-300/5 p-4 text-sm text-amber-200">{saveNotice}</p>}
    <fieldset disabled={saving} className="min-w-0 space-y-5 disabled:opacity-60">
        <section className="space-y-4 rounded-xl bg-white/[0.035] p-5" aria-labelledby="seller-organization-heading">
          <h3 id="seller-organization-heading" className="text-sm font-medium">Organizacja i współpraca</h3>
          <p className="text-xs leading-5 text-white/50">To tutaj wybierasz jedną organizację dla nowych ofert. Powiązania firm w nagłówku kontaktu i dotychczasowe oferty pozostają bez zmian.</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="text-xs text-[#e5e4e2]/55">Źródło osoby<select value={personSource} disabled={Boolean(editingId || contactId) || !isAdmin} onChange={(event) => { const source = event.target.value as PersonSource; setPersonSource(source); setPersonId(''); setPartnerType(source === 'employee' ? 'internal_employee' : 'hotel_employee'); }} className={`${fieldClass} mt-1.5 disabled:opacity-50`}><option value="contact">{isAdmin ? 'Kontakty CRM' : 'Moje kontakty zewnętrzne'}</option>{isAdmin && <option value="employee">Pracownicy Mavinci</option>}</select></label>
                  <label className="text-xs text-[#e5e4e2]/55">Rodzaj współpracy<select value={partnerType} onChange={(event) => setPartnerType(event.target.value as PartnerType)} className={`${fieldClass} mt-1.5`}>{Object.entries(partnerTypeLabels).filter(([value]) => isAdmin || value !== 'internal_employee').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label className="text-xs text-[#e5e4e2]/55">Status<select value={status} onChange={(event) => setStatus(event.target.value as PartnerStatus)} className={`${fieldClass} mt-1.5`}>{Object.entries(partnerStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                </div>

                <div>
                  <label className="block text-xs text-[#e5e4e2]/55">Osoba</label>
                  <SearchCombobox
                    value={personId}
                    options={personOptions}
                    onChange={setPersonId}
                    disabled={Boolean(editingId || contactId)}
                    allowClear={!editingId && !contactId}
                    placeholder="Wyszukaj po imieniu, nazwisku lub e-mailu..."
                    emptyLabel="Brak pasującej osoby"
                    className="mt-1.5"
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-xs text-[#e5e4e2]/55">Hotel / organizacja — dla nowych ofert {partnerType !== 'hotel_employee' && !portalEnabled && <span className="text-[#e5e4e2]/30">(opcjonalnie)</span>}<SearchCombobox value={organizationId} options={organizationOptions} onChange={setOrganizationId} placeholder="Wyszukaj hotel lub organizację..." emptyLabel="Brak pasującej organizacji" className="mt-1.5" /><span className="mt-2 block leading-5">Wybierz jedną organizację, w imieniu której sprzedawca przygotowuje oferty. Pozostałe powiązania kontaktu i dotychczasowe oferty nie zostaną zmienione.</span></label>
                  <label className="text-xs text-[#e5e4e2]/55">Notatka<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className={`${fieldClass} mt-1.5 resize-y`} placeholder="Ustalenia dotyczące współpracy..." /></label>
                </div>

        </section>
        <section className="space-y-4 rounded-xl bg-white/[0.035] p-5" aria-labelledby="seller-pricing-heading">
                  <h3 id="seller-pricing-heading" className="text-sm font-medium">Cennik i zasady prowizji</h3>
                  {editingId && <Link href={`/crm/salespeople/${editingId}/pricing`} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/15"><Tags className="h-4 w-4" />Indywidualne ceny produktów i rozszerzeń</Link>}
                  <p className="mt-1 text-xs text-[#e5e4e2]/40">Każda marka może mieć inną stawkę i sposób rozliczenia.</p>
                  <label className="mt-3 block text-sm">Domyślny cennik nowych ofert w portalu<select value={Object.values(draftTerms).filter(term => term.is_active).length === 1 ? Object.values(draftTerms).find(term => term.is_active)!.my_company_id : defaultCompanyId} onChange={event => setDefaultCompanyId(event.target.value)} className={`${fieldClass} mt-1.5`}><option value="">Wybierz aktywną markę</option>{companies.filter(company => draftTerms[company.id]?.is_active).map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select><span className="mt-2 block text-xs text-white/50">Sprzedawca nie wybiera marki realizującej. Przy jednej aktywnej marce cennik zostanie wybrany automatycznie. Logo i kolory pochodzą z organizacji przypisanej powyżej; starsze oferty zachowują swoje powiązania.</span></label>
                  <div className="mt-3 space-y-2">{companies.map((company) => { const term = draftTerms[company.id] || { my_company_id: company.id, commission_enabled: false, default_commission_rate: 10, default_payment_method: 'cash_dividend' as CommissionPaymentMethod, dividend_tax_rate: DEFAULT_DIVIDEND_TAX_RATE, is_active: false }; return <div key={company.id} className={`grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(200px,1fr)_140px_220px_120px] ${term.is_active ? 'border-[#d3bb73]/20 bg-[#d3bb73]/5' : 'border-white/5 bg-[#0f1119]'}`}><div className="space-y-2"><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={term.is_active} onChange={(event) => setDraftTerms({ ...draftTerms, [company.id]: { ...term, is_active: event.target.checked } })} /><span>{company.name}</span></label><label className="flex items-center gap-2 text-[11px] text-[#e5e4e2]/55"><input type="checkbox" disabled={!term.is_active} checked={term.commission_enabled} onChange={(event) => setDraftTerms({ ...draftTerms, [company.id]: { ...term, commission_enabled: event.target.checked } })} /><span>Rozliczenie prowizyjne</span></label></div><label className="text-[11px] text-[#e5e4e2]/45">Prowizja (%)<input type="number" min="0" step="0.01" disabled={!term.is_active || !term.commission_enabled} value={term.default_commission_rate} onChange={(event) => setDraftTerms({ ...draftTerms, [company.id]: { ...term, default_commission_rate: Number(event.target.value || 0) } })} className={`${fieldClass} mt-1 py-1.5 disabled:opacity-30`} /></label><label className="text-[11px] text-[#e5e4e2]/45">Sposób wypłaty<select disabled={!term.is_active || !term.commission_enabled} value={term.default_payment_method} onChange={(event) => setDraftTerms({ ...draftTerms, [company.id]: { ...term, default_payment_method: event.target.value as CommissionPaymentMethod } })} className={`${fieldClass} mt-1 py-1.5 disabled:opacity-30`}>{Object.entries(commissionPaymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-[11px] text-[#e5e4e2]/45">Podatek (%)<input type="number" min="0" max="99.99" step="0.01" disabled={!term.is_active || !term.commission_enabled || term.default_payment_method !== 'cash_dividend'} value={term.dividend_tax_rate} onChange={(event) => setDraftTerms({ ...draftTerms, [company.id]: { ...term, dividend_tax_rate: Number(event.target.value || 0) } })} className={`${fieldClass} mt-1 py-1.5 disabled:opacity-30`} /></label></div>; })}</div>
        </section>
        <section className="space-y-4 rounded-xl bg-white/[0.035] p-5" aria-labelledby="seller-access-heading">
          <h3 id="seller-access-heading" className="text-sm font-medium">Dostęp do portalu</h3>
                <div className={`rounded-lg border p-3 ${personSource === 'contact' ? 'border-sky-300/10 bg-sky-300/5' : 'border-white/5 bg-white/[0.02] opacity-45'}`}>
                  <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={portalEnabled} disabled={personSource !== 'contact'} onChange={(event) => setPortalEnabled(event.target.checked)} className="mt-0.5" /><span><span className="block text-sky-100">Nadaj dostęp do portalu sprzedawcy</span><span className="mt-1 block text-xs text-sky-100/45">Przy pierwszym nadaniu dostępu zapis utworzy lub połączy konto i wyśle zaproszenie na e-mail kontaktu. Zmiana ustawień istniejącego konta nie wysyła ponownie danych logowania. Portal pokazuje tylko dane tego sprzedawcy.</span></span></label>
                  {portalEnabled && personSource === 'contact' && <p className="mt-3 text-xs text-sky-100/45">Kontakt będzie mógł się zalogować, wylogować, samodzielnie zmienić hasło oraz odzyskać je z ekranu logowania.</p>}
                </div>

          {portalAuthUserId && <p className="text-xs text-emerald-200/70">Konto logowania jest połączone z kontaktem.</p>}
        </section>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={saving} onClick={() => onCancel ? onCancel() : setAttempt(value => value + 1)} className="rounded-lg bg-white/5 px-4 py-2 text-sm text-white/60 disabled:opacity-40">{onCancel ? 'Anuluj' : 'Odrzuć niezapisane zmiany'}</button>
        <button type="button" disabled={saving} onClick={() => void savePartner()} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#111522] disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Zapisz ustawienia</button>
      </div>

  </div>;
}
