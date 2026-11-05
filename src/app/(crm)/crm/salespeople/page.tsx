'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BadgePercent,
  BarChart3,
  Building2,
  Check,
  Hotel,
  LayoutDashboard,
  ListChecks,
  Loader2,
  MailPlus,
  Pencil,
  Plus,
  Presentation,
  Search,
  Tags,
  UserRound,
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { formatCommissionMoney } from '@/lib/CRM/events/eventCommission';
import { supabase } from '@/lib/supabase/browser';
import CrmSellerProfileSettings, {
  requestPortalAccess, partnerTypeLabels, partnerStatusLabels,
  type PartnerType, type PartnerStatus, type PartnerProfile, type PersonOption,
  type DirectoryData, type Organization, type Company, type BrandTerm,
} from '@/components/seller/CrmSellerProfileSettings';
import SellerInboxPanel, { SellerCountBadge } from '@/components/seller/SellerInboxPanel';
import CrmSellerWorkspace from '@/components/seller/CrmSellerWorkspace';
import { CrmCartesianChart } from '@/components/crm/charts/CrmCharts';
import { sellerInboxCounts } from '@/lib/seller/inbox';
import SalesCommissionSettingsSection from '@/components/crm/commissions/SalesCommissionSettingsSection';
import { refreshSellerSidebarBadge, useSellerSidebarBadge } from '@/lib/seller/sidebarBadge';
import SellerManagerCockpit from '@/components/crm/sellers/SellerManagerCockpit';
import { PortalAccountPill, SellerCountChip, formatSellerRelative, sellerWriteErrorText } from '@/components/crm/sellers/sellerUi';

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

const fieldClass =
  'w-full rounded-lg bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none ring-1 ring-white/[0.06] placeholder:text-[#e5e4e2]/25 focus:ring-[#d3bb73]/30';

export default function SalespeoplePage() {
  const { showSnackbar } = useSnackbar();
  const searchParams = useSearchParams();
  const router = useRouter();
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
  const [scopeFilter, setScopeFilter] = useState<'all' | 'mine'>('all');
  const [todayCount, setTodayCount] = useState(0);
  const view: 'cockpit' | 'directory' = searchParams.get('view') === 'directory' ? 'directory' : 'cockpit';
  const setView = (next: 'cockpit' | 'directory') => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'directory') params.set('view', 'directory'); else params.delete('view');
    const query = params.toString();
    router.replace(`/crm/salespeople${query ? `?${query}` : ''}`, { scroll: false });
  };
  const [showForm, setShowForm] = useState(false);
  const [newContactId, setNewContactId] = useState<string | undefined>();

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
      const [employeesResult, contactsResult, organizationsResult, companiesResult, termsResult, commissionsResult, partnerOffersResult, defaultsResult] =
      await Promise.all([
        access.is_admin
          ? supabase.from('employees').select('id,name,surname,email').eq('is_active', true).order('surname')
          : Promise.resolve({ data: [], error: null }),
        contactQuery,
        supabase.from('organizations').select('id,name,alias,business_type,location_id').order('name').limit(1000),
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
        partnerIds.length ? supabase.from('sales_partner_profiles').select('id,portal_default_company_id').in('id', partnerIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (revision !== loadRevision.current) return;
      const detailError = [employeesResult, contactsResult, organizationsResult, companiesResult, termsResult, commissionsResult, partnerOffersResult, defaultsResult]
        .find((response) => response.error)?.error;
      if (detailError) throw detailError;
      setDirectory(access);
      setProfiles(access.profiles.map(profile => ({ ...profile, portal_default_company_id: defaultsResult.data?.find(row => row.id === profile.id)?.portal_default_company_id || null })));
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
      setNewContactId(undefined);
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

  const personMap = useMemo(
    () => new Map([...employees, ...contacts].map((person) => [person.id, person])),
    [contacts, employees],
  );
  const organizationMap = useMemo(
    () => new Map(organizations.map((organization) => [organization.id, organization])),
    [organizations],
  );

  // „Moi” = jestem opiekunem lub zastępcą. Dla administratora pole is_mine z bazy jest zawsze prawdą,
  // dlatego najpierw porównujemy identyfikatory opiekuna.
  const isMineProfile = useCallback((profile: PartnerProfile) => {
    const employeeId = directory?.employee_id;
    if (profile.manager_id !== undefined || profile.backup_manager_id !== undefined) {
      return Boolean(employeeId) && (profile.manager_id === employeeId || profile.backup_manager_id === employeeId);
    }
    return profile.is_mine === true;
  }, [directory?.employee_id]);
  const hasManagerFields = profiles.some((profile) => profile.manager_id !== undefined || profile.is_mine !== undefined);

  const filteredProfiles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pl');
    return profiles.filter((profile) => {
      if (typeFilter !== 'all' && profile.partner_type !== typeFilter) return false;
      if (scopeFilter === 'mine' && !isMineProfile(profile)) return false;
      const person = personMap.get(profile.employee_id || profile.contact_id || '');
      const organization = organizationMap.get(profile.organization_id || '');
      return !query || `${person?.label || ''} ${person?.detail || ''} ${organization?.name || ''}`
        .toLocaleLowerCase('pl')
        .includes(query);
    });
  }, [organizationMap, personMap, profiles, search, typeFilter, scopeFilter, isMineProfile]);

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


  const beginAdd = () => {
    if (!canManage) return;
    setNewContactId(undefined);
    setShowForm(true);
  };

  // Older links pointed to an editor above this list. Existing contact sellers
  // now have one home: the sales workspace in their contact profile.
  useEffect(() => {
    if (loading || loadError || deepLinkHandled.current) return;
    const contactId = searchParams.get('contactId');
    const selectedProfile = profiles.find(profile =>
      contactId ? profile.contact_id === contactId : profile.id === searchParams.get('seller'));
    if (selectedProfile?.contact_id) {
      deepLinkHandled.current = true;
      const target = new URLSearchParams(searchParams.toString());
      target.delete('contactId');
      target.delete('seller');
      target.delete('new');
      target.set('tab', 'seller');
      if (contactId) target.set('section', 'settings');
      router.replace(`/crm/contacts/${selectedProfile.contact_id}?${target}${target.get('section') === 'settings' ? '#seller-profile-settings' : ''}`);
      return;
    }
    if (contactId && canManage && contacts.some(contact => contact.id === contactId)) {
      deepLinkHandled.current = true;
      setNewContactId(contactId);
      setShowForm(true);
    } else if (searchParams.get('new') === '1' && canManage && !contactId) {
      deepLinkHandled.current = true;
      setShowForm(true);
    }
  }, [loading, loadError, profiles, contacts, canManage, searchParams, router]);

  useEffect(() => {
    if (!showForm || !canManage) return;
    const frame = window.requestAnimationFrame(() => {
      const form = document.getElementById('seller-create-profile');
      form?.scrollIntoView({ block: 'start', behavior: 'instant' });
      form?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showForm, newContactId, canManage]);

  const updatePartnerStatus = async (profileId: string, nextStatus: PartnerStatus) => {
    const { data: updated, error } = await supabase.from('sales_partner_profiles').update({ status: nextStatus }).eq('id', profileId).select('id');
    if (error || !updated?.length) {
      showSnackbar(sellerWriteErrorText(error || { code: 'PGRST116' }, 'Nie udało się zmienić statusu'), 'error');
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

  const workspaceSellerId = searchParams.get('seller');
  const workspaceProfile = workspaceSellerId ? profiles.find((profile) => profile.id === workspaceSellerId) : undefined;

  return (
    <div className="min-h-screen bg-[#0f1119] p-4 text-[#e5e4e2] md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-[#d3bb73]/10 p-3"><BadgePercent className="h-6 w-6 text-[#d3bb73]" /></span>
              <div>
                <h1 className="text-2xl font-light">Sprzedawcy</h1>
                <p className="mt-1 text-sm text-[#e5e4e2]/45">{isAdmin ? 'Wszyscy sprzedawcy CRM oraz zewnętrzni.' : 'Twoi sprzedawcy zewnętrzni — zgodnie z opiekunem przypisanym przez administratora.'}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/crm/salespeople/demo" className="flex items-center gap-2 rounded-lg bg-white/5 px-4 py-2.5 text-sm text-[#e5e4e2]/80 hover:bg-white/10">
              <Presentation className="h-4 w-4 text-[#d3bb73]" /> Pokaż portal hotelowi
            </Link>
            {canManage && !showForm && (
              <button type="button" onClick={beginAdd} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#111522]">
                <Plus className="h-4 w-4" /> Dodaj sprzedawcę
              </button>
            )}
          </div>
        </header>

        {workspaceProfile && <section className="rounded-xl bg-black/10 p-4"><Link href="/crm/salespeople" className="mb-4 inline-block text-xs text-[#d3bb73]">← Wróć do sprzedawców</Link><CrmSellerWorkspace key={workspaceProfile.id} partnerId={workspaceProfile.id} contactId={workspaceProfile.contact_id || undefined} /></section>}

        {!loading && !loadError && workspaceSellerId && !workspaceProfile && (
          <p className="rounded-xl bg-amber-400/10 p-4 text-sm text-amber-100/80">Nie masz dostępu do wskazanego sprzedawcy albo jego profil nie istnieje.</p>
        )}

        {showForm && canManage && (
          <section id="seller-create-profile" tabIndex={-1} className="scroll-mt-24 space-y-5 rounded-xl bg-[#1c1f33] p-5 focus:outline-none">
                <h2 className="font-medium">Nowy sprzedawca</h2>
                <CrmSellerProfileSettings
                  key={newContactId || 'new'}
                  contactId={newContactId}
                  onCancel={() => setShowForm(false)}
                  onSaved={profile => {
                    setShowForm(false);
                    router.push(profile.contactId
                      ? `/crm/contacts/${profile.contactId}?tab=seller&section=settings#seller-profile-settings`
                      : `/crm/salespeople?seller=${profile.id}&section=settings`);
                    void loadData(true);
                  }}
                />
              </section>
            )}


        {!workspaceProfile && <>
          <nav className="flex flex-wrap gap-2" aria-label="Widok sprzedawców">
            {([
              { id: 'cockpit', label: 'Kokpit opiekuna', icon: LayoutDashboard, count: todayCount },
              { id: 'directory', label: 'Kartoteka sprzedawców', icon: ListChecks, count: 0 },
            ] as const).map((item) => (
              <button key={item.id} type="button" data-crm-tab-active={view === item.id} onClick={() => setView(item.id)} className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm transition-colors ${view === item.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/[0.03] text-white/55 hover:bg-white/5'}`}>
                <item.icon className="h-4 w-4" />{item.label}<SellerCountChip count={item.count} />
              </button>
            ))}
          </nav>

          {view === 'cockpit' ? <SellerManagerCockpit onTodayCount={setTodayCount} /> : loading ? (
            <div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[#d3bb73]" /></div>
          ) : loadError ? (
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
                <div key={label} className="rounded-xl bg-[#1c1f33] p-4">
                  <div className="flex items-center justify-between"><p className="text-xs text-[#e5e4e2]/45">{label}</p><Icon className="h-4 w-4 text-[#d3bb73]/60" /></div>
                  <p className="mt-2 text-2xl font-light">{value}</p>
                </div>
              ))}
            </section>

            <section className="rounded-xl bg-[#1c1f33]">
              <div className="flex items-center gap-3 p-5 pb-0">
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
              <div className="mx-5 mb-5 grid gap-5 rounded-xl bg-black/10 p-5 lg:grid-cols-[.7fr_1.3fr]">
                <div><h3 className="text-sm font-medium">Najczęściej wybierane pozycje</h3><div className="mt-3 space-y-2">{partnerOfferAnalytics.topProducts.map(([name, quantity], index) => <div key={name} className="flex items-center justify-between rounded-lg bg-[#0f1119] px-3 py-2 text-xs"><span className="truncate"><span className="mr-2 text-[#d3bb73]">{index + 1}.</span>{name}</span><span className="ml-3 text-white/40">{quantity}×</span></div>)}{partnerOfferAnalytics.topProducts.length === 0 && <p className="py-5 text-xs text-white/30">Brak danych produktowych.</p>}</div></div>
                <div className="space-y-2">
                  <p className="text-xs text-white/50">Powiadomienia: {sellerInbox.scope === 'all' ? 'wszyscy sprzedawcy' : 'przypisani do mnie'}. Ten sam zakres i suma w menu bocznym.</p>
                  <SellerInboxPanel source={{ ...sellerInbox, refresh: refreshSellerSidebarBadge }} />
                </div>
              </div>
            </section>

            {isAdmin && <SalesCommissionSettingsSection />}

            <section className="rounded-xl bg-[#1c1f33]">
              <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-1">
                <div className="relative min-w-64 max-w-md flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-[#e5e4e2]/30" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj sprzedawcy lub hotelu..." className={`${fieldClass} pl-9`} /></div>
                {isAdmin && hasManagerFields && <div className="flex rounded-lg bg-[#0f1119] p-1" role="group" aria-label="Zakres sprzedawców">{([['all', 'Wszyscy'], ['mine', 'Moi']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={scopeFilter === value} onClick={() => setScopeFilter(value)} className={`rounded-md px-3 py-1.5 text-sm ${scopeFilter === value ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-white/50 hover:text-white/80'}`}>{label}</button>)}</div>}
                <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | PartnerType)} className="rounded-lg bg-[#0f1119] px-3 py-2.5 text-sm ring-1 ring-white/[0.06]"><option value="all">Wszystkie rodzaje</option>{Object.entries(partnerTypeLabels).filter(([value]) => isAdmin || value !== 'internal_employee').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
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
<div className="divide-y divide-white/5">{filteredProfiles.map((profile) => { const person = personMap.get(profile.employee_id || profile.contact_id || ''); const organization = organizationMap.get(profile.organization_id || ''); const profileTerms = terms.filter((term) => term.sales_partner_id === profile.id && term.is_active); const rows = commissionRows.filter((row) => row.sales_partner_id === profile.id && row.status !== 'cancelled'); const payable = rows.filter((row) => row.status !== 'paid').reduce((sum, row) => sum + Number(row.amount || 0), 0); const hasCommission = profileTerms.some((term) => term.commission_enabled); const profileHref = profile.contact_id ? `/crm/contacts/${profile.contact_id}?tab=seller` : `/crm/salespeople?seller=${profile.id}`; const alerts = sellerInboxCounts(sellerInbox.items, profile.id); const chatHref = `${profileHref}&section=chat`; const isSendingAccess = sendingPortalAccessFor === profile.id; return <div key={profile.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(220px,1.2fr)_minmax(180px,1fr)_minmax(240px,1.4fr)_150px_auto] lg:items-center"><div className="min-w-0"><div className="flex items-center gap-2">{profile.partner_type === 'hotel_employee' ? <Hotel className="h-4 w-4 text-[#d3bb73]" /> : <UserRound className="h-4 w-4 text-[#d3bb73]" />}{profileHref ? <Link href={profileHref} className="truncate text-sm hover:text-[#d3bb73]">{person?.label || 'Nieznana osoba'}</Link> : <span className="truncate text-sm">{person?.label || 'Nieznana osoba'}</span>}</div><p className="mt-1 text-xs text-[#e5e4e2]/35">{partnerTypeLabels[profile.partner_type]}</p>{profile.manager_name !== undefined && <p className="mt-1 text-[11px] text-white/45">Opiekun: <span className="text-white/70">{profile.manager_name || 'brak'}</span>{isAdmin && isMineProfile(profile) && <span className="ml-2 rounded-full bg-[#d3bb73]/10 px-1.5 py-0.5 text-[10px] text-[#d3bb73]">mój</span>}</p>}<div className="mt-2 flex flex-wrap gap-2">{alerts.reviews > 0 && <Link href={profileHref} className="flex items-center gap-1.5 rounded-md bg-amber-300/10 px-2 py-1 text-[10px] text-amber-200">Do decyzji <SellerCountBadge count={alerts.reviews} label="Oferty do decyzji" /></Link>}{alerts.messages > 0 && <Link href={chatHref} className="flex items-center gap-1.5 rounded-md bg-sky-300/10 px-2 py-1 text-[10px] text-sky-200">Wiadomości <SellerCountBadge count={alerts.messages} label="Nowe wiadomości" /></Link>}{alerts.notices > 0 && <Link href={profileHref} className="flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 text-[10px] text-white/65">Powiadomienia <SellerCountBadge count={alerts.notices} label="Powiadomienia" /></Link>}<Link href={chatHref} className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-[#d3bb73]">Otwórz rozmowy</Link></div></div><div><p className="text-sm text-[#e5e4e2]/70">{organization?.alias || organization?.name || 'Bez organizacji'}</p>{profile.portal_account ? <div className="mt-1.5 space-y-1"><PortalAccountPill account={profile.portal_account} enabled={profile.portal_enabled} />{profile.portal_enabled && <p className="text-[11px] text-white/40">Logowanie: {formatSellerRelative(profile.last_sign_in_at)}</p>}</div> : profile.portal_enabled && <p className={`mt-1 text-[11px] ${profile.portal_auth_user_id ? 'text-emerald-300/70' : 'text-amber-300/70'}`}>{profile.portal_auth_user_id ? 'dostęp do portalu nadany' : 'oczekuje na zaproszenie'}</p>}{profile.last_activity_at !== undefined && <p className="mt-1 text-[11px] text-white/40">Aktywność: {formatSellerRelative(profile.last_activity_at, 'brak')}</p>}</div><div className="flex flex-wrap gap-1.5">{profileTerms.map((term) => { const company = companies.find((item) => item.id === term.my_company_id); return <span key={term.my_company_id} className="rounded bg-[#d3bb73]/10 px-2 py-1 text-[11px] text-[#d3bb73]">{company?.name || 'Marka'} · {term.commission_enabled ? `${term.default_commission_rate}%` : 'bez prowizji'}</span>; })}{profileTerms.length === 0 && <span className="text-xs text-amber-300/60">Brak aktywnej marki</span>}</div><div>{hasCommission ? <><p className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/35">Do wypłaty</p><p className="mt-1 text-sm text-violet-200">{formatCommissionMoney(payable)}</p></> : <p className="text-xs text-[#e5e4e2]/35">Bez rozliczeń prowizyjnych</p>}</div><div className="flex items-center justify-end gap-2">{canInvitePortal && profile.portal_enabled && <button type="button" disabled={Boolean(sendingPortalAccessFor)} onClick={() => inviteToPortal(profile.id)} className="flex items-center gap-1 rounded-md bg-sky-300/10 px-2 py-1.5 text-[11px] text-sky-200 hover:bg-sky-300/15 disabled:cursor-wait disabled:opacity-50">{isSendingAccess ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailPlus className="h-3.5 w-3.5" />} {profile.portal_auth_user_id ? 'Wyślij logowanie' : 'Zaproś'}</button>}{canManage && <Link href={`/crm/salespeople/${profile.id}/pricing`} title="Indywidualny cennik" className="rounded p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10"><Tags className="h-4 w-4" /></Link>}{canManage ? <select value={profile.status} onChange={(event) => updatePartnerStatus(profile.id, event.target.value as PartnerStatus)} className="rounded bg-[#0f1119] px-2 py-1.5 text-xs ring-1 ring-white/[0.06]"><option value="onboarding">Do uzgodnienia</option><option value="active">Aktywny</option><option value="inactive">Nieaktywny</option></select> : <span className="text-xs text-[#e5e4e2]/45">{partnerStatusLabels[profile.status]}</span>}{canManage && <Link href={`${profileHref}&section=settings#seller-profile-settings`} aria-label={`Otwórz ustawienia sprzedawcy: ${person?.label || 'wybrana osoba'}`} title="Ustawienia w profilu sprzedawcy" className="rounded p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10"><Pencil className="h-4 w-4" aria-hidden="true" /></Link>}</div></div>; })}{filteredProfiles.length === 0 && <p className="px-5 py-12 text-center text-sm text-[#e5e4e2]/35">Brak sprzedawców spełniających filtry.</p>}</div>
            </section>
            </>
          )}
        </>}
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
