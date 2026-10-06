'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarDays,
  Link2,
  Loader2,
  Pencil,
  ReceiptText,
  Save,
  Search,
  Unlink,
  Users,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import EventCommissionsPanel from './EventCommissionsPanel';
import SearchCombobox from '@/components/crm/SearchCombobox';

type BillingArrangement = 'direct' | 'hotel' | 'agency' | 'other';

type OrganizationOption = {
  id: string;
  name: string;
  alias: string | null;
};

type BillingContact = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  position: string | null;
};

type ReferralSellerOption = {
  id: string;
  label: string;
  description: string;
  keywords: string;
  status: string;
  commissionReady: boolean;
};

type SettlementEvent = {
  id: string;
  name: string;
  event_date: string | null;
  organization_id: string | null;
  billing_organization_id: string | null;
  contact_person_id: string | null;
};

interface Props {
  eventId: string;
  clientOrganizationId: string | null;
  clientOrganizationName?: string | null;
  initialArrangement?: BillingArrangement | null;
  initialBillingOrganizationId?: string | null;
  initialPurchaseOrderNumber?: string | null;
  canEdit: boolean;
  onSaved?: (value: {
    billing_arrangement: BillingArrangement;
    billing_organization_id: string | null;
    purchase_order_number: string | null;
  }) => void | Promise<void>;
}

const arrangementLabels: Record<BillingArrangement, string> = {
  direct: 'Bezpośrednio przez klienta wydarzenia',
  hotel: 'Przez hotel',
  agency: 'Przez agencję',
  other: 'Przez inną organizację',
};

export default function EventBillingContextCard({
  eventId,
  clientOrganizationId,
  clientOrganizationName,
  initialArrangement = 'direct',
  initialBillingOrganizationId = null,
  initialPurchaseOrderNumber = null,
  canEdit,
  onSaved,
}: Props) {
  const { showSnackbar } = useSnackbar();
  const [arrangement, setArrangement] = useState<BillingArrangement>(
    initialArrangement || 'direct',
  );
  const [billingOrganizationId, setBillingOrganizationId] = useState(
    initialBillingOrganizationId || '',
  );
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState(
    initialPurchaseOrderNumber || '',
  );
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [contacts, setContacts] = useState<BillingContact[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [referralEnabled, setReferralEnabled] = useState(false);
  const [referralPartnerId, setReferralPartnerId] = useState('');
  const [savedReferralPartnerId, setSavedReferralPartnerId] = useState('');
  const [referralSellers, setReferralSellers] = useState<ReferralSellerOption[]>([]);
  const [referralLoading, setReferralLoading] = useState(true);
  const [referralError, setReferralError] = useState('');
  const [referralReload, setReferralReload] = useState(0);
  const [referralSchemaUnavailable, setReferralSchemaUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settlementLoading, setSettlementLoading] = useState(true);
  const [settlementGroupId, setSettlementGroupId] = useState<string | null>(null);
  const [settlementName, setSettlementName] = useState('Wspólne rozliczenie wydarzeń');
  const [settlementEvents, setSettlementEvents] = useState<SettlementEvent[]>([]);
  const [selectedSettlementEventIds, setSelectedSettlementEventIds] = useState<string[]>([
    eventId,
  ]);
  const [primarySettlementEventId, setPrimarySettlementEventId] = useState(eventId);
  const [eventSearch, setEventSearch] = useState('');
  const [editingBilling, setEditingBilling] = useState(false);
  const [billingSnapshot, setBillingSnapshot] = useState<{
    arrangement: BillingArrangement;
    organizationId: string;
    contactIds: string[];
    purchaseOrderNumber: string;
    referralEnabled: boolean;
    referralPartnerId: string;
  } | null>(null);
  const [editingSettlement, setEditingSettlement] = useState(false);
  const [settlementSnapshot, setSettlementSnapshot] = useState<{
    name: string;
    eventIds: string[];
    primaryEventId: string;
  } | null>(null);

  const effectiveOrganizationId =
    arrangement === 'direct' ? clientOrganizationId || '' : billingOrganizationId;

  useEffect(() => {
    setArrangement(initialArrangement || 'direct');
    setBillingOrganizationId(initialBillingOrganizationId || '');
    setPurchaseOrderNumber(initialPurchaseOrderNumber || '');
  }, [initialArrangement, initialBillingOrganizationId, initialPurchaseOrderNumber]);

  useEffect(() => {
    let active = true;
    setReferralLoading(true);
    setReferralError('');
    setReferralSchemaUnavailable(false);
    setReferralSellers([]);
    setReferralEnabled(false);
    setReferralPartnerId('');
    setSavedReferralPartnerId('');
    void (async () => {
      try {
        const { data: event, error: eventError } = await supabase.from('events')
          .select('my_company_id,referring_sales_partner_id').eq('id', eventId).single();
        if (eventError && ['42703', 'PGRST204'].includes(eventError.code)) {
          if (active) setReferralSchemaUnavailable(true);
          return;
        }
        if (eventError) throw eventError;
        const selectedId = event.referring_sales_partner_id || '';
        const options: ReferralSellerOption[] = [];
        // Page the seller catalogue; a search must not silently omit later records.
        for (let from = 0; ; from += 200) {
          let query = supabase.from('sales_partner_profiles')
            .select('id,organization_id,status,employee:employees!employee_id(name,surname,email),contact:contacts!contact_id(full_name,email),organization:organizations!organization_id(name,alias)');
          query = selectedId ? query.or(`status.eq.active,id.eq.${selectedId}`) : query.eq('status', 'active');
          const { data: profiles, error: profilesError } = await query.order('id').range(from, from + 199);
          if (profilesError) throw profilesError;
          if (!active) return;
          const rows = profiles || [];
          const termsResult = event.my_company_id && rows.length
            ? await supabase.from('sales_partner_brand_terms')
                .select('sales_partner_id,is_active,commission_enabled,default_commission_rate')
                .eq('my_company_id', event.my_company_id).in('sales_partner_id', rows.map((row) => row.id))
            : { data: [], error: null };
          if (termsResult.error) throw termsResult.error;
          if (!active) return;
          for (const row of rows as any[]) {
            const employee = Array.isArray(row.employee) ? row.employee[0] : row.employee;
            const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
            const organization = Array.isArray(row.organization) ? row.organization[0] : row.organization;
            const term = termsResult.data?.find((item) => item.sales_partner_id === row.id);
            const label = employee ? [employee.name, employee.surname].filter(Boolean).join(' ') : contact?.full_name;
            const commissionReady = Boolean(term?.is_active && term.commission_enabled && Number(term.default_commission_rate) > 0);
            const termsLabel = !event.my_company_id ? 'Wybierz markę wydarzenia'
              : commissionReady ? `Domyślna prowizja: ${Number(term!.default_commission_rate)}%`
              : 'Warunki prowizji wymagają uzupełnienia';
            options.push({
              id: row.id, label: label || 'Sprzedawca — dane osoby niedostępne',
              description: [organization?.alias || organization?.name, row.status === 'active' ? termsLabel : 'Profil nieaktywny — wcześniejsze przypisanie'].filter(Boolean).join(' · '),
              keywords: [employee?.email, contact?.email, organization?.name, organization?.alias].filter(Boolean).join(' '),
              status: row.status, commissionReady,
            });
          }
          if (rows.length < 200) break;
        }
        if (!active) return;
        setReferralSellers(options.sort((a, b) => a.label.localeCompare(b.label, 'pl')));
        setReferralPartnerId(selectedId);
        setSavedReferralPartnerId(selectedId);
        setReferralEnabled(Boolean(selectedId));
      } catch {
        if (active) setReferralError('Nie udało się wczytać przypisanego sprzedawcy i jego warunków. Odśwież dane przed zapisem.');
      } finally {
        if (active) setReferralLoading(false);
      }
    })();
    return () => { active = false; };
  }, [eventId, referralReload]);

  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      setSettlementLoading(true);
      const [organizationsResult, selectedContactsResult, eventsResult, membershipResult] = await Promise.all([
        supabase.from('organizations').select('id,name,alias').order('name'),
        supabase
          .from('event_billing_contacts')
          .select('contact_id')
          .eq('event_id', eventId),
        supabase
          .from('events')
          .select('id,name,event_date,organization_id,billing_organization_id,contact_person_id')
          .order('event_date', { ascending: false })
          .limit(300),
        supabase
          .from('event_settlement_group_members')
          .select('group_id,is_primary')
          .eq('event_id', eventId)
          .maybeSingle(),
      ]);

      if (!active) return;
      if (organizationsResult.data) {
        setOrganizations(organizationsResult.data as OrganizationOption[]);
      }
      if (selectedContactsResult.data) {
        setSelectedContactIds(selectedContactsResult.data.map((row) => row.contact_id));
      }
      if (eventsResult.data) {
        setSettlementEvents(eventsResult.data as SettlementEvent[]);
      }

      if (membershipResult.data?.group_id) {
        const groupId = membershipResult.data.group_id;
        const [groupResult, membersResult] = await Promise.all([
          supabase
            .from('event_settlement_groups')
            .select('id,name,primary_event_id')
            .eq('id', groupId)
            .maybeSingle(),
          supabase
            .from('event_settlement_group_members')
            .select('event_id,is_primary')
            .eq('group_id', groupId),
        ]);

        if (!active) return;
        if (groupResult.data && membersResult.data) {
          setSettlementGroupId(groupId);
          setSettlementName(groupResult.data.name || 'Wspólne rozliczenie wydarzeń');
          setSelectedSettlementEventIds(membersResult.data.map((member) => member.event_id));
          setPrimarySettlementEventId(
            groupResult.data.primary_event_id ||
              membersResult.data.find((member) => member.is_primary)?.event_id ||
              eventId,
          );
          setEditingSettlement(false);
        }
      } else {
        setSettlementGroupId(null);
        setSelectedSettlementEventIds([eventId]);
        setPrimarySettlementEventId(eventId);
        setEditingSettlement(false);
      }
      setLoading(false);
      setSettlementLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [eventId]);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!effectiveOrganizationId) {
        setContacts([]);
        return;
      }

      setContactsLoading(true);
      const { data, error } = await supabase
        .from('contact_organizations')
        .select(
          `
            contact_id,
            position,
            is_primary,
            contact:contacts(id,full_name,first_name,last_name,email,phone,mobile)
          `,
        )
        .eq('organization_id', effectiveOrganizationId)
        .eq('is_current', true)
        .order('is_primary', { ascending: false });

      if (!active) return;
      if (error) {
        console.error('Error loading billing contacts:', error);
        setContacts([]);
      } else {
        setContacts(
          (data || [])
            .map((relation: any) => {
              const contact = relation.contact;
              if (!contact) return null;
              return {
                id: contact.id,
                fullName:
                  contact.full_name ||
                  `${contact.first_name || ''} ${contact.last_name || ''}`.trim() ||
                  'Kontakt bez nazwy',
                email: contact.email || null,
                phone: contact.mobile || contact.phone || null,
                position: relation.position || null,
              } satisfies BillingContact;
            })
            .filter(Boolean) as BillingContact[],
        );
      }
      setContactsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [effectiveOrganizationId]);

  useEffect(() => {
    const availableIds = new Set(contacts.map((contact) => contact.id));
    setSelectedContactIds((current) => current.filter((id) => availableIds.has(id)));
  }, [contacts]);

  const selectedOrganization = useMemo(
    () => organizations.find((organization) => organization.id === effectiveOrganizationId),
    [effectiveOrganizationId, organizations],
  );
  const selectedReferralSeller = referralSellers.find((seller) => seller.id === referralPartnerId);

  const billingOrganizationOptions = useMemo(
    () => organizations
      .filter((organization) => organization.id !== clientOrganizationId)
      .map((organization) => ({
        id: organization.id,
        label: organization.alias || organization.name,
        description: organization.alias ? organization.name : null,
      })),
    [clientOrganizationId, organizations],
  );

  const selectedSettlementEvents = useMemo(
    () =>
      selectedSettlementEventIds
        .map((selectedId) => settlementEvents.find((event) => event.id === selectedId))
        .filter(Boolean) as SettlementEvent[],
    [selectedSettlementEventIds, settlementEvents],
  );

  const availableSettlementEvents = useMemo(() => {
    const normalizedSearch = eventSearch.trim().toLocaleLowerCase('pl');
    const payerId = arrangement === 'direct' ? clientOrganizationId : billingOrganizationId;
    const currentContactId = settlementEvents.find(
      (settlementEvent) => settlementEvent.id === eventId,
    )?.contact_person_id;

    return settlementEvents.filter((event) => {
      if (event.id === eventId || selectedSettlementEventIds.includes(event.id)) return false;

      const matchesContext =
        (clientOrganizationId && event.organization_id === clientOrganizationId) ||
        (currentContactId && event.contact_person_id === currentContactId) ||
        (payerId &&
          (event.billing_organization_id === payerId || event.organization_id === payerId));
      if (!matchesContext) return false;

      if (!normalizedSearch) return true;
      return `${event.name} ${event.event_date || ''}`
        .toLocaleLowerCase('pl')
        .includes(normalizedSearch);
    });
  }, [
    arrangement,
    billingOrganizationId,
    clientOrganizationId,
    eventId,
    eventSearch,
    selectedSettlementEventIds,
    settlementEvents,
  ]);

  const formatEventDate = (date: string | null) =>
    date ? new Date(date).toLocaleDateString('pl-PL') : 'Termin nieustalony';

  const addSettlementEvent = (selectedId: string) => {
    setSelectedSettlementEventIds((current) =>
      current.includes(selectedId) ? current : [...current, selectedId],
    );
    setEventSearch('');
  };

  const removeSettlementEvent = (selectedId: string) => {
    if (selectedId === eventId) return;
    setSelectedSettlementEventIds((current) => current.filter((id) => id !== selectedId));
    if (primarySettlementEventId === selectedId) setPrimarySettlementEventId(eventId);
  };

  const beginSettlementEditing = () => {
    setSettlementSnapshot({
      name: settlementName,
      eventIds: [...selectedSettlementEventIds],
      primaryEventId: primarySettlementEventId,
    });
    setEventSearch('');
    setEditingSettlement(true);
  };

  const cancelSettlementEditing = () => {
    if (settlementSnapshot) {
      setSettlementName(settlementSnapshot.name);
      setSelectedSettlementEventIds(settlementSnapshot.eventIds);
      setPrimarySettlementEventId(settlementSnapshot.primaryEventId);
    }
    setEventSearch('');
    setSettlementSnapshot(null);
    setEditingSettlement(false);
  };

  const toggleContact = (contactId: string) => {
    setSelectedContactIds((current) =>
      current.includes(contactId)
        ? current.filter((id) => id !== contactId)
        : [...current, contactId],
    );
  };

  const beginBillingEditing = () => {
    setBillingSnapshot({
      arrangement,
      organizationId: billingOrganizationId,
      contactIds: [...selectedContactIds],
      purchaseOrderNumber,
      referralEnabled,
      referralPartnerId,
    });
    setEditingBilling(true);
  };

  const cancelBillingEditing = () => {
    if (billingSnapshot) {
      setArrangement(billingSnapshot.arrangement);
      setBillingOrganizationId(billingSnapshot.organizationId);
      setSelectedContactIds(billingSnapshot.contactIds);
      setPurchaseOrderNumber(billingSnapshot.purchaseOrderNumber);
      setReferralEnabled(billingSnapshot.referralEnabled);
      setReferralPartnerId(billingSnapshot.referralPartnerId);
    }
    setBillingSnapshot(null);
    setEditingBilling(false);
  };

  const handleSave = async () => {
    if (!canEdit || saving) return;
    if (editingBilling && (referralLoading || referralError)) {
      showSnackbar('Poczekaj na wczytanie danych sprzedawcy lub odśwież je przed zapisem.', 'error');
      return;
    }
    if (editingBilling && referralEnabled && !referralPartnerId) {
      showSnackbar('Wybierz sprzedawcę, który pozyskał wydarzenie, albo odznacz pole polecenia.', 'error');
      return;
    }
    if (editingBilling && referralEnabled && referralPartnerId !== savedReferralPartnerId
      && (!selectedReferralSeller || selectedReferralSeller.status !== 'active')) {
      showSnackbar('Wybierz aktywnego sprzedawcę z kartoteki.', 'error');
      return;
    }
    if (arrangement !== 'direct' && !billingOrganizationId) {
      showSnackbar('Wybierz organizację, która będzie rozliczać wydarzenie', 'error');
      return;
    }

    if (editingSettlement && selectedSettlementEventIds.length < 2) {
      showSnackbar(
        settlementGroupId
          ? 'Grupa musi zawierać co najmniej dwa wydarzenia. Aby ją usunąć, wybierz „Rozłącz grupę”.'
          : 'Wybierz co najmniej dwa wydarzenia do wspólnego rozliczenia.',
        'warning',
      );
      return;
    }

    setSaving(true);
    try {
      const storedBillingOrganizationId =
        arrangement === 'direct' ? null : billingOrganizationId;
      const storedPurchaseOrderNumber = purchaseOrderNumber.trim() || null;

      const storedReferralPartnerId = referralEnabled ? referralPartnerId || null : null;
      let eventUpdate = supabase
        .from('events')
        .update({
          billing_arrangement: arrangement,
          billing_organization_id: storedBillingOrganizationId,
          purchase_order_number: storedPurchaseOrderNumber,
        ...(editingBilling && !referralSchemaUnavailable ? { referring_sales_partner_id: storedReferralPartnerId } : {}),
        })
        .eq('id', eventId);
      if (editingBilling && !referralSchemaUnavailable) {
        eventUpdate = savedReferralPartnerId
          ? eventUpdate.eq('referring_sales_partner_id', savedReferralPartnerId)
          : eventUpdate.is('referring_sales_partner_id', null);
      }
      const { data: savedEvent, error: eventError } = await eventUpdate.select('id').maybeSingle();
      if (eventError) throw eventError;
      if (!savedEvent) throw new Error('Przypisanie sprzedawcy zmieniło się w innej karcie albo brak dostępu do zapisu. Odśwież dane przed ponowieniem.');
      if (editingBilling && !referralSchemaUnavailable) setSavedReferralPartnerId(storedReferralPartnerId || '');

      const { error: deleteError } = await supabase
        .from('event_billing_contacts')
        .delete()
        .eq('event_id', eventId);
      if (deleteError) throw deleteError;

      if (arrangement !== 'direct' && selectedContactIds.length > 0) {
        const { error: contactsError } = await supabase.from('event_billing_contacts').insert(
          selectedContactIds.map((contactId, index) => ({
            event_id: eventId,
            organization_id: billingOrganizationId,
            contact_id: contactId,
            is_primary: index === 0,
          })),
        );
        if (contactsError) throw contactsError;
      }

      if (selectedSettlementEventIds.length > 1) {
        const { data: savedGroupId, error: settlementError } = await supabase.rpc(
          'save_event_settlement_group',
          {
            p_anchor_event_id: eventId,
            p_event_ids: selectedSettlementEventIds,
            p_name: settlementName,
            p_primary_event_id: primarySettlementEventId,
          },
        );
        if (settlementError) throw settlementError;
        if (savedGroupId) {
          setSettlementGroupId(savedGroupId);
          setSettlementSnapshot(null);
          setEditingSettlement(false);
          setEventSearch('');
        }
      }

      await onSaved?.({
        billing_arrangement: arrangement,
        billing_organization_id: storedBillingOrganizationId,
        purchase_order_number: storedPurchaseOrderNumber,
      });
      setBillingSnapshot(null);
      setEditingBilling(false);
      showSnackbar('Sposób rozliczenia wydarzenia został zapisany', 'success');
    } catch (error: any) {
      console.error('Error saving event billing context:', error);
      showSnackbar(error?.message || 'Nie udało się zapisać rozliczenia wydarzenia', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDissolveSettlement = async () => {
    if (!settlementGroupId) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('dissolve_event_settlement_group', {
        p_event_id: eventId,
      });
      if (error) throw error;
      setSettlementGroupId(null);
      setSettlementName('Wspólne rozliczenie wydarzeń');
      setSelectedSettlementEventIds([eventId]);
      setPrimarySettlementEventId(eventId);
      setSettlementSnapshot(null);
      setEditingSettlement(false);
      setEventSearch('');
      showSnackbar('Wydarzenia zostały rozłączone. Historia faktur pozostała zachowana.', 'success');
    } catch (error: any) {
      console.error('Error dissolving event settlement:', error);
      showSnackbar(error?.message || 'Nie udało się rozłączyć wydarzeń', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-[#d3bb73]/10 p-2">
            <ReceiptText className="h-5 w-5 text-[#d3bb73]" />
          </div>
          <div>
            <h2 className="text-lg font-light text-[#e5e4e2]">Rozliczenie wydarzenia</h2>
            <p className="mt-1 text-sm text-[#e5e4e2]/50">
              Określ nabywcę faktur i osoby odpowiedzialne za rozliczenie.
            </p>
          </div>
        </div>
        {canEdit && !editingBilling && !editingSettlement && (
          <button data-crm-action="secondary"
            type="button"
            onClick={beginBillingEditing}
            disabled={saving || referralLoading || Boolean(referralError)}
            className="flex shrink-0 items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-xs text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edytuj
          </button>
        )}
        {canEdit && editingBilling && !editingSettlement && (
          <button
            type="button"
            onClick={cancelBillingEditing}
            disabled={saving}
            className="shrink-0 rounded-lg border border-[#e5e4e2]/15 px-3 py-2 text-xs text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/5 disabled:opacity-50"
          >
            Anuluj
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" />
        </div>
      ) : (
        <div className="space-y-5">
          {editingBilling ? (
            <>
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Sposób rozliczenia</label>
                <select
                  value={arrangement}
                  disabled={!canEdit || saving}
                  onChange={(event) => {
                    const value = event.target.value as BillingArrangement;
                    setArrangement(value);
                    if (value === 'direct') setBillingOrganizationId('');
                  }}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-60"
                >
                  {(Object.keys(arrangementLabels) as BillingArrangement[]).map((value) => (
                    <option key={value} value={value}>
                      {arrangementLabels[value]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Numer PO / zamówienia klienta{' '}
                  <span className="text-[#e5e4e2]/35">(opcjonalnie)</span>
                </label>
                <input
                  type="text"
                  value={purchaseOrderNumber}
                  maxLength={200}
                  disabled={!canEdit || saving}
                  onChange={(event) => setPurchaseOrderNumber(event.target.value)}
                  placeholder="np. Order No. 5501949741"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73] focus:outline-none disabled:opacity-60"
                />
                <p className="mt-2 text-xs text-[#e5e4e2]/40">
                  Numer będzie dostępny w umowie jako zmienna „Numer PO / zamówienia klienta”.
                </p>
              </div>

              {arrangement === 'direct' ? (
                <div className="flex items-center gap-3 rounded-lg border border-emerald-400/15 bg-emerald-400/5 p-4">
                  <Building2 className="h-5 w-5 text-emerald-300" />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-emerald-200/60">Nabywca faktury</p>
                    <p className="mt-1 text-sm text-[#e5e4e2]">
                      {clientOrganizationName || 'Klient przypisany do wydarzenia'}
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                    Organizacja będąca nabywcą faktur
                  </label>
                  <SearchCombobox
                    value={billingOrganizationId}
                    disabled={!canEdit || saving}
                    onChange={(organizationId) => {
                      setBillingOrganizationId(organizationId);
                      setSelectedContactIds([]);
                    }}
                    options={billingOrganizationOptions}
                    placeholder="Wyszukaj hotel lub inną organizację..."
                    emptyLabel="Brak pasującej organizacji"
                  />
                </div>
              )}

              <div className="rounded-lg bg-white/[0.035] p-4">
                <label className="flex cursor-pointer items-start gap-3 text-sm text-[#e5e4e2]">
                  <input
                    type="checkbox"
                  checked={referralEnabled}
                  title={referralSchemaUnavailable ? 'Wybór sprzedawcy oczekuje na włączenie zapisu w bazie. Pozostałe dane rozliczenia możesz zapisać.' : undefined}
                  disabled={!canEdit || saving || referralLoading || referralSchemaUnavailable || Boolean(referralError)}
                    onChange={(event) => setReferralEnabled(event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#d3bb73]"
                  />
                  <span>Wydarzenie pozyskane przez sprzedawcę</span>
                </label>
                <p className="mt-2 text-xs leading-5 text-[#e5e4e2]/50">
                  Sprzedawca może otrzymać prowizję także wtedy, gdy klient rozlicza się bezpośrednio. Przypisanie nie zmienia nabywcy faktury ani osoby kontaktowej klienta.
                </p>
                {referralEnabled && <div className="mt-3 space-y-2">
                  <SearchCombobox
                    value={referralPartnerId}
                    options={referralSellers}
                    onChange={setReferralPartnerId}
                    disabled={!canEdit || saving || referralLoading || Boolean(referralError)}
                    placeholder="Wyszukaj sprzedawcę po nazwisku, firmie lub e-mailu…"
                    ariaLabel="Sprzedawca, który pozyskał wydarzenie"
                    emptyLabel="Brak sprzedawcy — dodaj profil w kartotece sprzedawców"
                  />
                  {selectedReferralSeller && <p className="text-xs text-[#d3bb73]/80">{selectedReferralSeller.description}</p>}
                  {selectedReferralSeller && !selectedReferralSeller.commissionReady && <p className="text-xs leading-5 text-amber-200/80">
                    Przypisanie osoby nie ustala kwoty do wypłaty. Uzupełnij warunki dla marki lub ustal prowizję ręcznie w sekcji „Sprzedawcy i prowizje”.
                  </p>}
                  <p className="text-xs leading-5 text-[#e5e4e2]/45">
                    Po zapisie obowiązują warunki sprzedawcy dla marki wydarzenia, z uwzględnieniem uzgodnień zaakceptowanej oferty. Prowizję umowną możesz edytować poniżej. Bez zaakceptowanej oferty naliczenie oczekuje na podstawę netto po rabacie.
                  </p>
                </div>}
                {savedReferralPartnerId && (!referralEnabled || referralPartnerId !== savedReferralPartnerId) && <p className="mt-3 text-xs leading-5 text-amber-200/80">
                  Zmiana lub usunięcie przypisania nie kasuje wcześniejszej prowizji ani wypłaty. Sprawdź dotychczasowe naliczenie w sekcji „Sprzedawcy i prowizje”.
                </p>}
              </div>

              {arrangement !== 'direct' && effectiveOrganizationId && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <Users className="h-4 w-4 text-[#d3bb73]" />
                    <p className="text-sm font-medium text-[#e5e4e2]">
                      Opiekunowie rozliczenia po stronie {selectedOrganization?.alias || selectedOrganization?.name || 'organizacji'}
                    </p>
                  </div>
                  <p className="mb-3 text-xs leading-5 text-[#e5e4e2]/50">
                    Jeśli zaznaczona osoba jest sprzedawcą z aktywną prowizją dla marki wydarzenia, zapis doda ją automatycznie do sekcji „Sprzedawcy i prowizje”. Kwota jest liczona od wartości netto zaakceptowanej oferty. Bez niej zapisujemy stawkę i oczekiwanie na podstawę.
                  </p>

                  {contactsLoading ? (
                    <div className="flex items-center gap-2 py-4 text-sm text-[#e5e4e2]/50">
                      <Loader2 className="h-4 w-4 animate-spin" /> Ładowanie kontaktów...
                    </div>
                  ) : contacts.length > 0 ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      {contacts.map((contact) => {
                        const selected = selectedContactIds.includes(contact.id);
                        return (
                          <button
                            key={contact.id}
                            type="button"
                            disabled={!canEdit || saving}
                            onClick={() => toggleContact(contact.id)}
                            className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
                              selected
                                ? 'border-[#d3bb73]/60 bg-[#d3bb73]/10'
                                : 'border-[#d3bb73]/10 bg-[#0a0d1a] hover:border-[#d3bb73]/30'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <span
                                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                  selected
                                    ? 'border-[#d3bb73] bg-[#d3bb73] text-[#1c1f33]'
                                    : 'border-[#e5e4e2]/30'
                                }`}
                              >
                                {selected ? '✓' : ''}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm text-[#e5e4e2]">{contact.fullName}</p>
                                {contact.position && (
                                  <p className="truncate text-xs text-[#e5e4e2]/45">{contact.position}</p>
                                )}
                                <p className="mt-1 truncate text-xs text-[#d3bb73]/80">
                                  {contact.email || contact.phone || 'Brak danych kontaktowych'}
                                </p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-amber-400/15 bg-amber-400/5 p-4 text-sm text-amber-100/70">
                      Ta organizacja nie ma jeszcze osób kontaktowych. Dodaj je w kartotece organizacji,
                      aby system mógł podpowiadać odbiorców faktur.
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4">
              <Building2 className="h-5 w-5 shrink-0 text-[#d3bb73]" />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-[#d3bb73]/60">Rozlicza</p>
                <p className="mt-1 truncate text-sm text-[#e5e4e2]">
                  {arrangement === 'direct'
                    ? clientOrganizationName || 'Klient przypisany do wydarzenia'
                    : selectedOrganization?.alias || selectedOrganization?.name || 'Nie wybrano organizacji'}
                </p>
                <p className="mt-1 text-xs text-[#e5e4e2]/40">{arrangementLabels[arrangement]}</p>
                {arrangement !== 'direct' && selectedContactIds.length > 0 && (
                  <p className="mt-1 truncate text-xs text-[#e5e4e2]/50">
                    Kontakt: {contacts
                      .filter((contact) => selectedContactIds.includes(contact.id))
                      .map((contact) => contact.fullName)
                      .join(', ')}
                  </p>
                )}
              </div>
            </div>
          )}

          {referralLoading && <p className="flex items-center gap-2 text-xs text-[#e5e4e2]/50"><Loader2 className="h-4 w-4 animate-spin" />Wczytuję przypisanie sprzedawcy…</p>}
          {referralError && <div className="rounded-lg bg-amber-400/5 p-3 text-xs text-amber-200">
            <p>{referralError}</p>
            <button type="button" disabled={saving} onClick={() => setReferralReload((value) => value + 1)} className="mt-2 rounded-md bg-white/5 px-3 py-1.5 text-[#d3bb73]">Odśwież sprzedawców</button>
          </div>}
          {!editingBilling && !referralLoading && !referralError && savedReferralPartnerId && <div className="rounded-lg bg-white/[0.035] p-4">
            <p className="text-xs uppercase tracking-wide text-[#d3bb73]/60">Sprzedawca pozyskujący wydarzenie</p>
            <p className="mt-1 text-sm text-[#e5e4e2]">{referralSellers.find((seller) => seller.id === savedReferralPartnerId)?.label || 'Przypisany sprzedawca'}</p>
            <p className="mt-1 text-xs text-[#e5e4e2]/45">Prowizja niezależna od nabywcy faktury — szczegóły poniżej.</p>
          </div>}

          {!editingBilling && (
            <div className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4">
              <ReceiptText className="h-5 w-5 shrink-0 text-[#d3bb73]" />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-[#d3bb73]/60">
                  Numer PO / zamówienia klienta
                </p>
                <p className="mt-1 break-words text-sm text-[#e5e4e2]">
                  {purchaseOrderNumber || 'Nie podano — pole opcjonalne'}
                </p>
              </div>
            </div>
          )}

          {(editingBilling || editingSettlement || settlementGroupId) && (
          <div className="rounded-xl border border-sky-400/15 bg-sky-400/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-sky-400/10 p-2">
                  <Link2 className="h-4 w-4 text-sky-300" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[#e5e4e2]">Wspólne rozliczenie</p>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-[#e5e4e2]/50">
                    Połącz osobne realizacje, gdy mają otrzymać jedną fakturę. Timeline, zespół,
                    sprzęt i koszty pozostają oddzielne, a przychód faktury jest przypisywany do
                    każdego wydarzenia.
                  </p>
                </div>
              </div>
              {canEdit && !editingSettlement && (
                <button
                  type="button"
                  onClick={beginSettlementEditing}
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg border border-sky-400/20 px-3 py-2 text-xs text-sky-200 transition-colors hover:bg-sky-400/10 disabled:opacity-50"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {settlementGroupId ? 'Edytuj powiązanie' : 'Połącz wydarzenia'}
                </button>
              )}
            </div>

            {settlementLoading ? (
              <div className="flex items-center gap-2 py-5 text-xs text-[#e5e4e2]/50">
                <Loader2 className="h-4 w-4 animate-spin" /> Ładowanie powiązań...
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {editingSettlement ? (
                  <div>
                    <label className="mb-2 block text-xs text-[#e5e4e2]/50">Nazwa rozliczenia</label>
                    <input
                      value={settlementName}
                      disabled={!canEdit || saving}
                      onChange={(event) => setSettlementName(event.target.value)}
                      className="w-full rounded-lg border border-sky-400/15 bg-[#0a0d1a] px-3 py-2.5 text-sm text-[#e5e4e2] focus:border-sky-300 focus:outline-none disabled:opacity-60"
                    />
                  </div>
                ) : settlementGroupId ? (
                  <div className="rounded-lg border border-sky-400/10 bg-[#0a0d1a] px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-sky-300/60">
                      Nazwa rozliczenia
                    </p>
                    <p className="mt-1 text-sm text-[#e5e4e2]">{settlementName}</p>
                  </div>
                ) : (
                  <p className="rounded-lg border border-[#e5e4e2]/10 bg-[#0a0d1a] px-3 py-3 text-xs text-[#e5e4e2]/45">
                    To wydarzenie jest obecnie rozliczane samodzielnie.
                  </p>
                )}

                {(editingSettlement || settlementGroupId) && <div>
                  <p className="mb-2 text-xs text-[#e5e4e2]/50">Wydarzenia w rozliczeniu</p>
                  <div className="space-y-2">
                    {selectedSettlementEvents.map((settlementEvent) => (
                      <div
                        key={settlementEvent.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-sky-400/15 bg-[#0a0d1a] px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-[#e5e4e2]">{settlementEvent.name}</p>
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-[#e5e4e2]/40">
                            <CalendarDays className="h-3 w-3" />
                            {formatEventDate(settlementEvent.event_date)}
                            {settlementEvent.id === eventId && ' · aktualne wydarzenie'}
                          </p>
                        </div>
                        {editingSettlement && settlementEvent.id !== eventId && canEdit && (
                          <button
                            type="button"
                            onClick={() => removeSettlementEvent(settlementEvent.id)}
                            className="rounded-md px-2 py-1 text-xs text-red-200/70 hover:bg-red-400/10 hover:text-red-200"
                          >
                            Usuń
                          </button>
                        )}
                        {!editingSettlement && settlementEvent.id === primarySettlementEventId && (
                          <span className="shrink-0 rounded bg-sky-400/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-sky-300">
                            Główne
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>}

                {canEdit && editingSettlement && (
                  <div>
                    <label className="mb-2 block text-xs text-[#e5e4e2]/50">
                      Dodaj wydarzenie tego klienta lub płatnika
                    </label>
                    <div className="relative">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-[#e5e4e2]/30" />
                      <input
                        value={eventSearch}
                        onChange={(event) => setEventSearch(event.target.value)}
                        placeholder="Szukaj po nazwie lub dacie..."
                        className="w-full rounded-lg border border-sky-400/15 bg-[#0a0d1a] py-2.5 pl-10 pr-3 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/25 focus:border-sky-300 focus:outline-none"
                      />
                    </div>
                    {eventSearch.trim() && (
                      <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-sky-400/10 bg-[#0a0d1a] p-1">
                        {availableSettlementEvents.length > 0 ? (
                          availableSettlementEvents.map((candidate) => (
                            <button
                              key={candidate.id}
                              type="button"
                              onClick={() => addSettlementEvent(candidate.id)}
                              className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-sky-400/10"
                            >
                              <span className="truncate text-sm text-[#e5e4e2]/80">{candidate.name}</span>
                              <span className="shrink-0 text-xs text-[#e5e4e2]/35">
                                {formatEventDate(candidate.event_date)}
                              </span>
                            </button>
                          ))
                        ) : (
                          <p className="px-3 py-2 text-xs text-[#e5e4e2]/35">
                            Brak kolejnych wydarzeń tego klienta lub płatnika.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {editingSettlement && selectedSettlementEventIds.length > 1 && (
                  <div>
                    <label className="mb-2 block text-xs text-[#e5e4e2]/50">
                      Wydarzenie główne dla faktury
                    </label>
                    <select
                      value={primarySettlementEventId}
                      disabled={!canEdit || saving}
                      onChange={(event) => setPrimarySettlementEventId(event.target.value)}
                      className="w-full rounded-lg border border-sky-400/15 bg-[#0a0d1a] px-3 py-2.5 text-sm text-[#e5e4e2] focus:border-sky-300 focus:outline-none disabled:opacity-60"
                    >
                      {selectedSettlementEvents.map((settlementEvent) => (
                        <option key={settlementEvent.id} value={settlementEvent.id}>
                          {settlementEvent.name} · {formatEventDate(settlementEvent.event_date)}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs text-[#e5e4e2]/35">
                      Dokument pozostaje jeden. W pozostałych wydarzeniach będzie widoczny jako
                      faktura wspólna wraz z przypisaną częścią przychodu.
                    </p>
                  </div>
                )}

                {editingSettlement && (
                  <div className="flex flex-wrap justify-between gap-2 border-t border-sky-400/10 pt-3">
                    <div>
                      {settlementGroupId && (
                        <button
                          type="button"
                          onClick={handleDissolveSettlement}
                          disabled={saving}
                          className="flex items-center gap-2 rounded-lg border border-red-400/20 px-3 py-2 text-xs text-red-200 transition-colors hover:bg-red-400/10 disabled:opacity-50"
                        >
                          <Unlink className="h-3.5 w-3.5" />
                          Rozłącz grupę
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={cancelSettlementEditing}
                      disabled={saving}
                      className="rounded-lg border border-[#e5e4e2]/15 px-3 py-2 text-xs text-[#e5e4e2]/60 hover:bg-[#e5e4e2]/5 disabled:opacity-50"
                    >
                      Anuluj edycję
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {canEdit && (editingBilling || editingSettlement) && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || (editingBilling && (referralLoading || Boolean(referralError)))}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Zapisz rozliczenie
              </button>
            </div>
          )}

          {!editingBilling && !editingSettlement && <EventCommissionsPanel eventId={eventId} />}
        </div>
      )}
    </div>
  );
}
