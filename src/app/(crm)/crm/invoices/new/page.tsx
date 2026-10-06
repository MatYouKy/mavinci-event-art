'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { ArrowLeft, CalendarDays, Link2, Plus, Trash2, Save } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useInvoiceFinanceAccess } from '@/hooks/useInvoiceFinanceAccess';
import BuyerSearchInput from './components/BuyerSearchInput';
import AddBuyerModal from './components/AddBuyerModal';
import InvoiceNumberInput from './components/InvoiceNumberInput';
import InvoiceBillingContext, {
  type BillingArrangement,
} from './components/InvoiceBillingContext';
import { MyCompany } from '../../settings/my-companies/page';
import { loadInvoiceItemSourceChoices, type InvoiceItemSourceChoice } from '@/lib/invoices/invoiceItemSourceChoices';
import { getNextAdvanceContext, type NextAdvanceContext } from '@/lib/invoices/nextAdvancePrefill';
import { DEFAULT_INVOICE_PAYMENT_TERM_DAYS, getInvoicePaymentDueDate } from '@/lib/invoices/paymentTerm';
import { getCurrentInvoiceIssuer } from '@/lib/invoices/currentInvoiceIssuer';

interface EventOption {
  id: string;
  name: string;
  event_date: string | null;
  organization_id: string | null;
  contact_person_id: string | null;
  billing_arrangement?: BillingArrangement | null;
  billing_organization_id?: string | null;
}

interface SettlementGroupContext {
  id: string;
  name: string;
  primary_event_id: string;
  events: Array<Pick<EventOption, 'id' | 'name' | 'event_date'>>;
}

interface IndividualContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
}

interface Organization {
  id: string;
  name: string;
  nip: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  client_type?: string;
  email: string;
  phone: string;
  bank_name: string;
  bank_account: string;
}

interface InvoiceItem {
  position_number: number;
  name: string;
  unit: string;
  quantity: number;
  price_net: number;
  vat_rate: number;
  vat_code: '23' | '8' | '5' | '0' | '0 KR' | '0 WDT' | '0 EX' | 'zw' | 'np' | 'np I' | 'np II' | 'oo';
  vat_exemption_reason?: string;

  before_quantity?: number;
  before_price_net?: number;
  before_value_net?: number;
  before_vat_amount?: number;
  before_value_gross?: number;

  after_quantity?: number;
  after_price_net?: number;
  after_value_net?: number;
  after_vat_amount?: number;
  after_value_gross?: number;
}

const round2 = (value: number) => Number(value.toFixed(2));

const netFromGross = (gross: number, vatRate: number) => {
  return round2(gross / (1 + vatRate / 100));
};

const grossFromNet = (net: number, vatRate: number) => {
  return round2(net * (1 + vatRate / 100));
};

export default function NewInvoicePage() {
  const router = useRouter();
  const {
    employee: currentEmployee,
    isAdmin,
    loading: employeeLoading,
    canManageModule,
  } = useCurrentEmployee();
  const { access: financeAccess, loading: financeAccessLoading, error: financeAccessError } = useInvoiceFinanceAccess();
  const canUseInvoiceEvent = (id: string) => !id || Boolean(financeAccess && (
    financeAccess.scope === 'company' || financeAccess.soldEventIds.includes(id)
  ));
  const canManageInvoices = canManageModule('invoices');
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const eventId = searchParams.get('event');
  const urlType = searchParams.get('type');
  const urlRelated = searchParams.get('related');
  const advanceFrom = urlType === 'advance' ? searchParams.get('advanceFrom') : null;
  const [nextAdvanceContext, setNextAdvanceContext] = useState<NextAdvanceContext | null>(null);
  const [advancePrefillLoading, setAdvancePrefillLoading] = useState(Boolean(advanceFrom));
  const [advancePrefillError, setAdvancePrefillError] = useState<string | null>(null);
  const currencyCode = nextAdvanceContext?.source.currency_code || 'PLN';
  const currencyLabel = currencyCode === 'PLN' ? 'zł' : currencyCode;

  const [loading, setLoading] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [myCompanies, setMyCompanies] = useState<MyCompany[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [settings, setSettings] = useState<any>(null);
  const [showAddBuyerModal, setShowAddBuyerModal] = useState(false);
  const [includeDefaultFooterNote, setIncludeDefaultFooterNote] = useState(true);
  const [invoiceNote, setInvoiceNote] = useState('');

  const [invoiceType, setInvoiceType] = useState<'vat' | 'proforma' | 'advance' | 'corrective'>(
    urlType === 'corrective' ? 'corrective' : urlType === 'advance' ? 'advance' : 'vat',
  );
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [invoiceNumberIsAuto, setInvoiceNumberIsAuto] = useState(true);
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentDays, setPaymentDays] = useState(String(DEFAULT_INVOICE_PAYMENT_TERM_DAYS));
  const [paymentMethod, setPaymentMethod] = useState<'Przelew' | 'Gotówka' | 'Karta' | 'BLIK'>(
    'Przelew',
  );
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [items, setItems] = useState<InvoiceItem[]>([
    {
      position_number: 1,
      name: '',
      unit: 'szt.',
      quantity: 1,
      price_net: 0,
      vat_rate: 23,
      vat_code: '23',
      before_value_net: 0,
      before_vat_amount: 0,
    },
  ]);
  const [simplifiedInvoice, setSimplifiedInvoice] = useState(false);
  const [acceptedPricing, setAcceptedPricing] = useState<{ label: string; net: number; gross: number; discount: number; notice: string } | null>(null);
  const [pricingPrefillError, setPricingPrefillError] = useState<string | null>(null);
  const [simplifiedServiceName, setSimplifiedServiceName] = useState('Obsługa muzyczna');
  const [itemSources, setItemSources] = useState<InvoiceItemSourceChoice[]>([]);
  const [selectedItemSource, setSelectedItemSource] = useState<'calculation' | 'offer' | 'manual'>('manual');
  const [preferredItemSource, setPreferredItemSource] = useState<'calculation' | 'offer' | null>(null);
  const [itemSourcesLoading, setItemSourcesLoading] = useState(false);
  const itemEditRevision = useRef(0);

  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionType, setCorrectionType] = useState<1 | 2 | 3>(2);
  const [correctionScope, setCorrectionScope] = useState<'full' | 'partial'>('full');
  const [relatedInvoiceId, setRelatedInvoiceId] = useState('');
  const [correctedInvoiceNumber, setCorrectedInvoiceNumber] = useState('');
  const [correctedInvoiceIssueDate, setCorrectedInvoiceIssueDate] = useState('');
  const [correctedInvoiceKsefNumber, setCorrectedInvoiceKsefNumber] = useState('');
  const [correctedInvoiceWasInKsef, setCorrectedInvoiceWasInKsef] = useState(false);
  const [availableInvoices, setAvailableInvoices] = useState<any[]>([]);
  const [buyerIsPrivatePerson, setBuyerIsPrivatePerson] = useState(false);

  const [urlRelatedLoaded, setUrlRelatedLoaded] = useState(false);
  const [individualSearch, setIndividualSearch] = useState('');

  const [individualContacts, setIndividualContacts] = useState<IndividualContact[]>([]);
  const [selectedIndividualId, setSelectedIndividualId] = useState('');

  const [selectedEventId, setSelectedEventId] = useState<string>(eventId || '');
  const [organizationEvents, setOrganizationEvents] = useState<EventOption[]>([]);
  const [linkedEvent, setLinkedEvent] = useState<EventOption | null>(null);
  const [settlementGroup, setSettlementGroup] = useState<SettlementGroupContext | null>(null);
  const [billingArrangement, setBillingArrangement] =
    useState<BillingArrangement>('direct');
  const [serviceRecipientOrganizationId, setServiceRecipientOrganizationId] =
    useState<string>('');
  const [serviceRecipientContactId, setServiceRecipientContactId] = useState<string>('');

  const [isPaid, setIsPaid] = useState(false);
  const [paidDate, setPaidDate] = useState(new Date().toISOString().split('T')[0]);
  const [advancePercent, setAdvancePercent] = useState(30);

  const [privateBuyer, setPrivateBuyer] = useState({
    firstName: '',
    lastName: '',
    street: '',
    postalCode: '',
    city: '',
    email: '',
    phone: '',
  });

  useEffect(() => {
    if (employeeLoading || financeAccessLoading || !financeAccess?.canIssueInvoices) return;
    fetchData();
  }, [eventId, employeeLoading, advanceFrom, financeAccessLoading, financeAccess]);

  useEffect(() => {
    if (advanceFrom || invoiceType === 'corrective' || employeeLoading || financeAccessLoading || !financeAccess?.canIssueInvoices || !canUseInvoiceEvent(selectedEventId)) return;
    let active = true;
    const revision = itemEditRevision.current;
    setItemSources([]);
    setSelectedItemSource('manual');
    setPreferredItemSource(null);
    setAcceptedPricing(null);
    setPricingPrefillError(null);
    if (!selectedEventId) {
      setItemSourcesLoading(false);
      return;
    }
    setItemSourcesLoading(true);
    setItems([{ position_number: 1, name: '', unit: 'usł.', quantity: 1, price_net: 0, vat_rate: 23, vat_code: '23' }]);
    (async () => {
      try {
        const result = await loadInvoiceItemSourceChoices(selectedEventId);
        if (!active) return;
        setItemSources(result.choices);
        setPreferredItemSource(result.preferredId);
        setPricingPrefillError(result.warning || null);
        // Selecting a source or editing a title while loading is a user decision.
        if (itemEditRevision.current !== revision) return;
        const preferred = result.choices.find((choice) => choice.id === result.preferredId);
        if (preferred) {
          setItems(preferred.items.map((item) => ({ ...item })));
          setSelectedItemSource(preferred.id);
          setAcceptedPricing(preferred);
        } else {
          setItems([{ position_number: 1, name: `Obsługa techniczna — ${result.eventName}`, unit: 'usł.', quantity: 1, price_net: 0, vat_rate: 23, vat_code: '23' }]);
        }
      } catch (error) {
        if (active) setPricingPrefillError(error instanceof Error ? error.message : 'Nie udało się odczytać źródła pozycji.');
      } finally {
        if (active) setItemSourcesLoading(false);
      }
    })();
    return () => { active = false; };
  }, [selectedEventId, advanceFrom, invoiceType === 'corrective', employeeLoading, financeAccessLoading, financeAccess]);

  const selectItemSource = (sourceId: 'calculation' | 'offer' | 'manual') => {
    itemEditRevision.current += 1;
    setSelectedItemSource(sourceId);
    if (sourceId === 'manual') {
      setAcceptedPricing(null);
      return; // Preserve the user's current lines and amounts for manual editing.
    }
    const choice = itemSources.find((source) => source.id === sourceId);
    if (!choice) return;
    setItems(choice.items.map((item) => ({ ...item })));
    setAcceptedPricing(choice);
  };

  useEffect(() => {
    if (financeAccessLoading || !financeAccess?.canIssueInvoices) return;
    if (!selectedOrgId) {
      setOrganizationEvents([]);
      if (!selectedEventId) setSelectedEventId(eventId || '');
      return;
    }

    fetchOrganizationEvents(selectedOrgId, selectedEventId || eventId || '');
  }, [selectedOrgId, financeAccessLoading, financeAccess]);

  useEffect(() => {
    if (financeAccessLoading || !financeAccess?.canIssueInvoices || !canUseInvoiceEvent(selectedEventId)) return;
    let active = true;

    (async () => {
      if (!selectedEventId) {
        setSettlementGroup(null);
        return;
      }

      const { data: membership, error: membershipError } = await supabase
        .from('event_settlement_group_members')
        .select('group_id')
        .eq('event_id', selectedEventId)
        .maybeSingle();

      if (!active) return;
      if (membershipError || !membership?.group_id) {
        setSettlementGroup(null);
        return;
      }

      const [groupResult, membersResult] = await Promise.all([
        supabase
          .from('event_settlement_groups')
          .select('id,name,primary_event_id')
          .eq('id', membership.group_id)
          .eq('status', 'active')
          .maybeSingle(),
        supabase
          .from('event_settlement_group_members')
          .select('event_id')
          .eq('group_id', membership.group_id),
      ]);

      if (!active) return;
      if (!groupResult.data || !membersResult.data?.length) {
        setSettlementGroup(null);
        return;
      }

      const memberIds = membersResult.data.map((member) => member.event_id)
        .filter((id) => canUseInvoiceEvent(id));
      if (!memberIds.length) { setSettlementGroup(null); return; }
      const { data: memberEvents } = await supabase
        .from('events')
        .select('id,name,event_date')
        .in('id', memberIds)
        .order('event_date', { ascending: true });

      if (!active) return;
      setSettlementGroup({
        ...groupResult.data,
        events: (memberEvents || []) as SettlementGroupContext['events'],
      });
    })();

    return () => {
      active = false;
    };
  }, [selectedEventId, financeAccessLoading, financeAccess]);

  const applyEventContext = (event: EventOption | null) => {
    setLinkedEvent(event);
    setServiceRecipientOrganizationId(event?.organization_id || '');
    setServiceRecipientContactId(event?.contact_person_id || '');
  };

  const fetchEventContext = async (linkedEventId: string, syncRecipients = true) => {
    if (!financeAccess?.canIssueInvoices || !canUseInvoiceEvent(linkedEventId)) {
      applyEventContext(null);
      return null;
    }
    if (!linkedEventId) {
      applyEventContext(null);
      return null;
    }

    const { data, error } = await supabase
      .from('events')
      .select(
        'id,name,event_date,organization_id,contact_person_id,billing_arrangement,billing_organization_id',
      )
      .eq('id', linkedEventId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching invoice event context:', error);
      return null;
    }

    const event = (data as EventOption | null) || null;
    setLinkedEvent(event);
    if (syncRecipients) {
      setServiceRecipientOrganizationId(event?.organization_id || '');
      setServiceRecipientContactId(event?.contact_person_id || '');
      const eventBillingArrangement = event?.billing_arrangement || 'direct';
      setBillingArrangement(eventBillingArrangement);
      setSelectedOrgId(
        eventBillingArrangement !== 'direct' && event?.billing_organization_id
          ? event.billing_organization_id
          : event?.organization_id || '',
      );
    }
    return event;
  };

  const fetchOrganizationEvents = async (organizationId: string, preservedEventId = '') => {
    if (!financeAccess?.canIssueInvoices) return;
    if (financeAccess.scope === 'sales' && !financeAccess.soldEventIds.length) {
      setOrganizationEvents([]);
      return;
    }
    let query = supabase
      .from('events')
      .select(
        'id,name,event_date,organization_id,contact_person_id,billing_arrangement,billing_organization_id',
      )
      .eq('organization_id', organizationId)
      .order('event_date', { ascending: false });
    if (financeAccess.scope === 'sales') query = query.in('id', financeAccess.soldEventIds);
    const { data, error } = await query;

    if (error) {
      console.error('Error fetching organization events:', error);
      return;
    }

    const events = (data || []) as EventOption[];

    if (preservedEventId && !events.some((event) => event.id === preservedEventId)) {
      const preserved =
        linkedEvent?.id === preservedEventId
          ? linkedEvent
          : await fetchEventContext(preservedEventId, !advanceFrom);
      if (preserved) events.unshift(preserved);
    }

    setOrganizationEvents(events);
  };

  const handleEventChange = async (linkedEventId: string) => {
    setSelectedEventId(linkedEventId);
    setBillingArrangement('direct');

    await fetchEventContext(linkedEventId);
  };

  const handleBuyerSelect = (organizationId: string) => {
    setSelectedOrgId(organizationId);

    if (!selectedEventId || !serviceRecipientOrganizationId) return;
    if (organizationId === serviceRecipientOrganizationId) {
      setBillingArrangement('direct');
    } else if (billingArrangement === 'direct') {
      setBillingArrangement('other');
    }
  };

  const handleBillingArrangementChange = (arrangement: BillingArrangement) => {
    setBillingArrangement(arrangement);
    setBuyerIsPrivatePerson(false);

    if (arrangement === 'direct' && serviceRecipientOrganizationId) {
      setSelectedOrgId(serviceRecipientOrganizationId);
    } else if (
      arrangement !== 'direct' &&
      selectedOrgId === serviceRecipientOrganizationId
    ) {
      setSelectedOrgId('');
    }
  };

  useEffect(() => {
    if (
      urlType === 'corrective' &&
      urlRelated &&
      !urlRelatedLoaded &&
      organizations.length > 0 &&
      myCompanies.length > 0 &&
      availableInvoices.length > 0
    ) {
      setUrlRelatedLoaded(true);
      handleSelectOriginalInvoice(urlRelated);
    }
  }, [urlType, urlRelated, urlRelatedLoaded, organizations, myCompanies, availableInvoices]);

  const handleSelectOriginalInvoice = async (invoiceId: string) => {
    if (!financeAccess?.canIssueInvoices) return;
    setRelatedInvoiceId(invoiceId);
    if (!invoiceId) {
      setCorrectedInvoiceNumber('');
      setCorrectedInvoiceIssueDate('');
      setCorrectedInvoiceKsefNumber('');
      setCorrectedInvoiceWasInKsef(false);
      return;
    }

    let originalQuery = supabase
      .from('invoices')
      .select('*, invoice_items(*)')
      .eq('id', invoiceId);
    if (financeAccess.scope === 'sales') originalQuery = originalQuery.in('created_by', [financeAccess.employeeId, financeAccess.authUserId]);
    const { data: origInvoice } = await originalQuery.maybeSingle();

    if (origInvoice) {
      setCorrectedInvoiceNumber(origInvoice.invoice_number || '');
      setCorrectedInvoiceIssueDate(origInvoice.issue_date || '');
      setSelectedOrgId(origInvoice.organization_id || '');
      setSelectedCompanyId(origInvoice.my_company_id || '');
      setSelectedEventId(origInvoice.event_id || '');
      setBillingArrangement(origInvoice.billing_arrangement || 'direct');
      setServiceRecipientOrganizationId(origInvoice.service_recipient_organization_id || '');
      setServiceRecipientContactId(origInvoice.service_recipient_contact_id || '');

      if (origInvoice.event_id) {
        await fetchEventContext(
          origInvoice.event_id,
          !origInvoice.service_recipient_organization_id &&
            !origInvoice.service_recipient_contact_id,
        );
      } else {
        applyEventContext(null);
      }

      if (origInvoice.sale_date) {
        setSaleDate(origInvoice.sale_date.split('T')[0]);
      }

      const { data: ksefRecord } = await supabase
        .from('ksef_invoices')
        .select('ksef_reference_number')
        .eq('invoice_id', invoiceId)
        .eq('sync_status', 'synced')
        .maybeSingle();

      if (ksefRecord?.ksef_reference_number) {
        setCorrectedInvoiceKsefNumber(ksefRecord.ksef_reference_number);
        setCorrectedInvoiceWasInKsef(true);
      } else {
        setCorrectedInvoiceKsefNumber('');
        setCorrectedInvoiceWasInKsef(false);
      }

      if (origInvoice.invoice_items?.length > 0) {
        const sortedItems = [...origInvoice.invoice_items].sort(
          (a: any, b: any) => (a.position_number ?? 0) - (b.position_number ?? 0),
        );
        setItems(
          sortedItems.map((item: any) => {
            const beforeQuantity = Number(item.quantity ?? 0);
            const beforePriceNet = Number(item.price_net ?? 0);
            const beforeValueNet = Number(item.value_net ?? beforeQuantity * beforePriceNet);
            const beforeVatAmount = Number(
              item.vat_amount ?? Math.round(beforeValueNet * Number(item.vat_rate ?? 0)) / 100,
            );
            const beforeValueGross = Number(item.value_gross ?? beforeValueNet + beforeVatAmount);

            return {
              position_number: item.position_number,
              name: item.name,
              unit: item.unit,
              quantity: beforeQuantity,
              price_net: beforePriceNet,
              vat_rate: item.vat_rate,
              vat_code: (item.vat_code || String(item.vat_rate || 23)) as InvoiceItem['vat_code'],
              vat_exemption_reason: item.vat_exemption_reason || '',

              before_quantity: beforeQuantity,
              before_price_net: beforePriceNet,
              before_value_net: beforeValueNet,
              before_vat_amount: beforeVatAmount,
              before_value_gross: beforeValueGross,

              after_quantity: beforeQuantity,
              after_price_net: beforePriceNet,
              after_value_net: beforeValueNet,
              after_vat_amount: beforeVatAmount,
              after_value_gross: beforeValueGross,
            };
          }),
        );
      }
    }
  };

  const fetchData = async () => {
    if (!financeAccess?.canIssueInvoices) return;
    if (advanceFrom) {
      setAdvancePrefillLoading(true);
      setAdvancePrefillError(null);
      setNextAdvanceContext(null);
    }
    try {
      let invoiceQuery = supabase
        .from('invoices')
        .select('id, invoice_number, invoice_type, issue_date, total_gross, buyer_name, status, my_company_id')
        .neq('invoice_type', 'corrective')
        .in('status', ['issued', 'sent', 'paid'])
        .order('issue_date', { ascending: false });
      if (financeAccess.scope === 'sales') invoiceQuery = invoiceQuery.in('created_by', [financeAccess.employeeId, financeAccess.authUserId]);
      const [settingsRes, businessClientsRes, companiesRes, allInvoicesRes, individualContactsRes] =
        await Promise.all([
          supabase.rpc('get_invoice_settings_for_creation'),
          supabase.rpc('get_business_clients'),
          supabase
            .from('my_companies')
            .select('*')
            .eq('is_active', true)
            .order('is_default', { ascending: false }),
          invoiceQuery,
          supabase
            .from('contacts')
            .select(
              'id, first_name, last_name, full_name, email, phone, mobile, address, street, postal_code, city',
            )
            .eq('contact_type', 'individual')
            .order('last_name', { ascending: true }),
        ]);

      if (settingsRes.error) {
        console.error('Error fetching invoice settings:', settingsRes.error);
        throw new Error(
          'Brak uprawnień do tworzenia faktur. Wymagane: invoices_manage lub finances_manage',
        );
      }

      if (settingsRes.data && settingsRes.data.length > 0) {
        setSettings(settingsRes.data[0]);

        const defaultMethod = settingsRes.data[0]?.default_payment_method;
        if (defaultMethod) {
          setPaymentMethod(defaultMethod);
        }
      }

      if (businessClientsRes.data) {
        const formattedClients = businessClientsRes.data.map((client: any) => ({
          id: client.id,
          name: client.name,
          nip: client.nip,
          street: client.address,
          postal_code: client.postal_code,
          city: client.city,
          client_type: client.client_type,
          email: client.email,
          phone: client.phone,
          bank_name: client.bank_name,
          bank_account: client.bank_account,
        }));

        setOrganizations(formattedClients);
      }

      setIndividualContacts(
        individualContactsRes.data?.map((c: any) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          full_name: c.full_name,
          email: c.email,
          phone: c.phone || c.mobile,
          address: c.address || '',
          street: c.street || c.address || '',
          postal_code: c.postal_code || '',
          city: c.city || '',
        })) || [],
      );

      let finalCompaniesList: MyCompany[] = [];

      if (companiesRes.data) {
        let companiesList = companiesRes.data as MyCompany[];

        if (!isAdmin) {
          const allowedIds = (currentEmployee as any)?.my_company_ids;
          const invoicePerms = (currentEmployee as any)?.invoice_company_permissions || {};

          const hasAllowedList = Array.isArray(allowedIds) && allowedIds.length > 0;

          if (hasAllowedList) {
            companiesList = companiesList.filter((c) => allowedIds.includes(c.id));
          }

          const hasAnyPerEntry = Object.values(invoicePerms).some(
            (v) => Array.isArray(v) && v.length > 0,
          );

          if (hasAnyPerEntry) {
            companiesList = companiesList.filter(
              (c) => Array.isArray(invoicePerms[c.id]) && invoicePerms[c.id].includes('issue'),
            );
          } else if (!canManageInvoices && !financeAccess.canIssueInvoices) {
            companiesList = [];
          }
        }

        finalCompaniesList = companiesList;
        setMyCompanies(companiesList);

        /**
         * WAŻNE:
         * Nie nadpisujemy firmy, jeśli user już coś wybrał.
         * Dzięki temu select nie wraca do domyślnej działalności.
         */
        setSelectedCompanyId((prev) => {
          if (prev) return prev;

          const defaultCompany = companiesList.find((c) => c.is_default);
          return defaultCompany?.id || companiesList[0]?.id || '';
        });
      }

      if (allInvoicesRes.data) {
        setAvailableInvoices(allInvoicesRes.data);
      }

      if (advanceFrom) {
        const context = await getNextAdvanceContext(advanceFrom);
        const source = context.source;
        if (!finalCompaniesList.some((company) => company.id === source.my_company_id)) {
          throw new Error('Brak uprawnień do przygotowania kolejnej zaliczki dla firmy z dokumentu źródłowego.');
        }
        if (context.remainingGross <= 0) {
          throw new Error('Zaliczki obejmują już pełną wartość zamówienia. Możesz przygotować fakturę końcową.');
        }
        await fetchEventContext(source.event_id || '', false);
        setInvoiceType('advance');
        setNextAdvanceContext(context);
        setItems(context.orderItems.map((item) => ({ ...item, vat_code: item.vat_code as InvoiceItem['vat_code'] })));
        setSelectedCompanyId(source.my_company_id);
        setSelectedOrgId(source.organization_id || '');
        setSelectedEventId(source.event_id || '');
        setBillingArrangement(source.billing_arrangement || 'direct');
        setServiceRecipientOrganizationId(source.service_recipient_organization_id || '');
        setServiceRecipientContactId(source.service_recipient_contact_id || '');
        setBuyerIsPrivatePerson(Boolean(source.buyer_is_private_person));
        setSelectedIndividualId(source.buyer_contact_id || '');
        const [firstName = '', ...lastName] = String(source.buyer_name || '').split(' ');
        setPrivateBuyer({ firstName, lastName: lastName.join(' '), street: source.buyer_street || '',
          postalCode: source.buyer_postal_code || '', city: source.buyer_city || '',
          email: source.buyer_email || '', phone: source.buyer_phone || '' });
        if (source.organization_id) {
          setOrganizations((current) => [{
            id: source.organization_id, name: source.buyer_name || '', nip: source.buyer_nip || null,
            street: source.buyer_street || '', postal_code: source.buyer_postal_code || '',
            city: source.buyer_city || '', email: source.buyer_email || '', phone: source.buyer_phone || '',
            bank_name: '', bank_account: '',
          }, ...current.filter((organization) => organization.id !== source.organization_id)]);
        }
        // A new deposit has its own amount and receipt confirmation.
        setAdvancePercent(0);
        setIsPaid(false);
        setPaidDate(new Date().toISOString().split('T')[0]);
        setSimplifiedInvoice(false);
        setAcceptedPricing(null);
        setPricingPrefillError(null);
        if (source.sale_date) setSaleDate(source.sale_date.split('T')[0]);
        return;
      }

      if (eventId) {
        setSelectedEventId(eventId);
        const context = await fetchEventContext(eventId);
        if (context?.event_date) setSaleDate(context.event_date.split('T')[0]);
      }
    } catch (err: any) {
      console.error('Error fetching data:', err);
      if (advanceFrom) setAdvancePrefillError(err.message || 'Nie udało się przygotować kolejnej zaliczki.');
      showSnackbar(err.message || 'Błąd podczas ładowania danych', 'error');
    } finally {
      if (advanceFrom) setAdvancePrefillLoading(false);
    }
  };

  const handleSelectIndividual = (contactId: string) => {
    setSelectedIndividualId(contactId);

    const contact = individualContacts.find((c) => c.id === contactId);
    if (!contact) return;

    setPrivateBuyer({
      firstName: contact.first_name || '',
      lastName: contact.last_name || '',
      street: contact.street || '',
      postalCode: contact.postal_code || '',
      city: contact.city || '',
      email: contact.email || '',
      phone: contact.phone || '',
    });
  };

  const isCashPayment =
    paymentMethod === 'Gotówka' || paymentMethod === 'Karta' || paymentMethod === 'BLIK';

  const calculatePaymentDueDate = () => {
    return getInvoicePaymentDueDate(issueDate, paymentDays) || '';
  };

  const calculateItemValues = (item: InvoiceItem) => {
    const vatRate = Number(item.vat_rate ?? 0);

    if (invoiceType === 'corrective') {
      const afterQty = Number(item.quantity ?? 0);
      const afterPrice = Number(item.price_net ?? 0);
      const afterNet = Number((afterQty * afterPrice).toFixed(2));
      const afterVat = Number((Math.round(afterNet * vatRate) / 100).toFixed(2));
      const afterGross = Number((afterNet + afterVat).toFixed(2));

      const beforeNet = Number(item.before_value_net ?? 0);
      const beforeVat = Number(item.before_vat_amount ?? 0);
      const beforeGross = Number(item.before_value_gross ?? beforeNet + beforeVat);

      const valueNet = Number((afterNet - beforeNet).toFixed(2));
      const vatAmount = Number((afterVat - beforeVat).toFixed(2));
      const valueGross = Number((afterGross - beforeGross).toFixed(2));

      return { valueNet, vatAmount, valueGross };
    }

    const valueNet = Number((Number(item.quantity ?? 0) * Number(item.price_net ?? 0)).toFixed(2));
    const vatAmount = Number((Math.round(valueNet * vatRate) / 100).toFixed(2));
    const valueGross = Number((valueNet + vatAmount).toFixed(2));

    return { valueNet, vatAmount, valueGross };
  };

  const calculateTotalsFor = (invoiceItems: InvoiceItem[]) => {
    let totalNet = 0;
    let totalVat = 0;
    let totalGross = 0;

    invoiceItems.forEach((item) => {
      const { valueNet, vatAmount, valueGross } = calculateItemValues(item);
      totalNet += valueNet;
      totalVat += vatAmount;
      totalGross += valueGross;
    });

    return { totalNet, totalVat, totalGross };
  };

  const calculateTotals = () => calculateTotalsFor(getItemsForInvoice());

  const addItem = () => {
    itemEditRevision.current += 1;
    setItems([
      ...items,
      {
        position_number: items.length + 1,
        name: '',
        unit: 'szt.',
        quantity: 1,
        price_net: 0,
        vat_rate: 23,
        vat_code: '23',
        before_value_net: 0,
        after_value_net: 0,
        before_vat_amount: 0,
      },
    ]);
  };

  const removeItem = (index: number) => {
    itemEditRevision.current += 1;
    const newItems = items.filter((_, i) => i !== index);
    newItems.forEach((item, i) => (item.position_number = i + 1));
    setItems(newItems);
  };

  const updateItem = (index: number, field: keyof InvoiceItem, value: any) => {
    itemEditRevision.current += 1;
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const getCombinedItemsError = () => {
    if (!items.length) return 'Dodaj przynajmniej jedną pozycję stanowiącą podstawę kwoty.';
    if (new Set(items.map((item) => `${item.vat_code}|${item.vat_rate}|${item.vat_exemption_reason || ''}`)).size > 1) {
      return 'Jedna pozycja zbiorcza nie może łączyć różnych stawek lub podstaw VAT. Zachowaj pozycje szczegółowe.';
    }
    const source = calculateTotalsFor(items);
    const combinedVat = round2(round2(source.totalNet) * Number(items[0].vat_rate) / 100);
    if (Math.abs(combinedVat - round2(source.totalVat)) > 0.001) {
      return 'Scalenie zmieniłoby VAT przez zaokrąglenia. Zachowaj pozycje szczegółowe, aby nie zmienić uzgodnionej kwoty.';
    }
    return null;
  };

  const getItemsForInvoice = () => {
    if (invoiceType === 'corrective' || !simplifiedInvoice || getCombinedItemsError()) {
      return items;
    }

    // Sumuj wszystkie pozycje w jedną
    const totalNet = items.reduce((sum, item) => {
      const { valueNet } = calculateItemValues(item);
      return sum + valueNet;
    }, 0);

    // Zwróć jedną pozycję z sumą i nową nazwą
    return [
      {
        position_number: 1,
        name: simplifiedServiceName,
        unit: 'usł.',
        quantity: 1,
        price_net: Math.round(totalNet * 100) / 100,
        vat_rate: items[0]?.vat_rate ?? 23,
        vat_code: items[0]?.vat_code ?? ('23' as const),
        vat_exemption_reason: items[0]?.vat_exemption_reason,
        before_value_net: 0,
        after_value_net: 0,
      },
    ];
  };

  const getAdvancePaymentItems = (orderItems: InvoiceItem[]) => {
    const ratio = advancePercent / 100;
    return orderItems.map((item) => ({
      ...item,
      price_net: round2(Number(item.price_net) * ratio),
    }));
  };

  const handleBuyerAdded = async (buyerId: string) => {
    await fetchData();
    handleBuyerSelect(buyerId);
  };

  const buildInvoiceFooterText = () => {
    if (invoiceType === 'corrective') {
      const issueDateText = correctedInvoiceIssueDate
        ? new Date(correctedInvoiceIssueDate).toLocaleDateString('pl-PL')
        : 'brak daty';
  
      return `Faktura korygująca odnosi się do faktury ${correctedInvoiceNumber || '-'} z dnia ${issueDateText}. Przyczyna korekty: ${
        correctionReason || '-'
      }.`;
    }
  
    if (!includeDefaultFooterNote) {
      return null;
    }
  
    return invoiceNote.trim() || null;
  };

  const handleSubmit = async () => {
    if (!financeAccess?.canIssueInvoices || !canUseInvoiceEvent(selectedEventId)) {
      showSnackbar('Nie masz uprawnień do wystawienia faktury dla tego wydarzenia.', 'error');
      return;
    }
    if (!isPaid && !calculatePaymentDueDate()) {
      showSnackbar('Podaj poprawną datę wystawienia i termin płatności w pełnych dniach (0 lub więcej).', 'error');
      return;
    }
    if (!advanceFrom && invoiceType !== 'corrective' && itemSourcesLoading) {
      showSnackbar('Poczekaj na wczytanie źródeł pozycji i kwot wydarzenia.', 'warning');
      return;
    }
    if (advanceFrom && (advancePrefillLoading || advancePrefillError || !nextAdvanceContext)) {
      showSnackbar(advancePrefillError || 'Poczekaj na wczytanie zamówienia i wcześniejszych zaliczek.', 'error');
      return;
    }
    if (!selectedCompanyId) {
      showSnackbar('Wybierz firmę wystawiającą fakturę', 'error');
      return;
    }

    if (selectedEventId && billingArrangement !== 'direct' && buyerIsPrivatePerson) {
      showSnackbar('Hotel lub pośrednik musi być wybrany jako organizacja.', 'error');
      return;
    }

    if (buyerIsPrivatePerson && !nextAdvanceContext) {
      if (
        !privateBuyer.firstName.trim() ||
        !privateBuyer.lastName.trim() ||
        !privateBuyer.street.trim() ||
        !privateBuyer.postalCode.trim() ||
        !privateBuyer.city.trim()
      ) {
        showSnackbar(
          'Uzupełnij dane osoby prywatnej: imię, nazwisko, adres, kod pocztowy i miasto.',
          'error',
        );
        return;
      }
    } else if (!buyerIsPrivatePerson && !selectedOrgId && !nextAdvanceContext) {
      showSnackbar('Wybierz nabywcę', 'error');
      return;
    }

    if (
      selectedEventId &&
      billingArrangement !== 'direct' &&
      selectedOrgId === serviceRecipientOrganizationId
    ) {
      showSnackbar('Wybierz hotel lub inną organizację, która będzie nabywcą faktury.', 'error');
      return;
    }

    if (!invoiceNumber.trim()) {
      showSnackbar('Numer faktury jest wymagany', 'error');
      return;
    }

    if (invoiceType === 'corrective') {
      if (!relatedInvoiceId) {
        showSnackbar('Wybierz fakturę do korekty', 'error');
        return;
      }

      if (!correctionReason.trim()) {
        showSnackbar('Podaj przyczynę korekty', 'error');
        return;
      }

      if (items.some((item) => !item.name.trim())) {
        showSnackbar('Wypełnij nazwy wszystkich pozycji faktury', 'error');
        return;
      }
    } else if (!items.length ||
      items.some(
        (item) =>
          (!simplifiedInvoice && !item.name.trim()) ||
          !Number.isFinite(Number(item.quantity)) ||
          Number(item.quantity) <= 0 ||
          !Number.isFinite(Number(item.price_net)) ||
          Number(item.price_net) < 0,
      )
    ) {
      showSnackbar('Wypełnij wszystkie pozycje faktury', 'error');
      return;
    }

    if (items.some((item) => item.vat_code === 'zw' && !item.vat_exemption_reason?.trim())) {
      showSnackbar('Podaj podstawę prawną dla każdej pozycji zwolnionej z VAT.', 'error');
      return;
    }

    if (items.some((item) => item.vat_code === '0' || item.vat_code === 'np')) {
      showSnackbar('Dla 0% wybierz rodzaj transakcji (krajowa, WDT lub eksport), a dla „np.” wybierz np I albo np II.', 'error');
      return;
    }

    if (invoiceType !== 'corrective' && simplifiedInvoice && (!simplifiedServiceName.trim() || getCombinedItemsError())) {
      showSnackbar(getCombinedItemsError() || 'Wpisz własną nazwę pozycji zbiorczej.', 'error');
      return;
    }

    if (invoiceType === 'advance' && (!Number.isFinite(advancePercent) || advancePercent <= 0 || advancePercent > 100)) {
      showSnackbar('Zaliczka musi być większa od 0% i nie może przekraczać 100%.', 'error');
      return;
    }

    try {
      setLoading(true);

      const normalizedInvoiceNumber = invoiceNumber.trim();

      if (!invoiceNumberIsAuto) {
        const { data: existingInvoiceNumber, error: existingInvoiceNumberError } = await supabase
          .from('invoices')
          .select('id')
          .eq('my_company_id', selectedCompanyId)
          .eq('invoice_number', normalizedInvoiceNumber)
          .maybeSingle();

        if (existingInvoiceNumberError) {
          throw existingInvoiceNumberError;
        }

        if (existingInvoiceNumber) {
          showSnackbar('Ten numer faktury jest już użyty dla wybranej działalności.', 'error');
          setLoading(false);
          return;
        }
      }

      const selectedOrg = buyerIsPrivatePerson
        ? null
        : organizations.find((o) => o.id === selectedOrgId);

      if (!buyerIsPrivatePerson && !selectedOrg && !nextAdvanceContext) {
        throw new Error('Organization not found');
      }

      const selectedCompany = myCompanies.find((c) => c.id === selectedCompanyId);
      if (!selectedCompany) throw new Error('Company not found');

      const issuer = await getCurrentInvoiceIssuer();

      const footerNote = buildInvoiceFooterText();

      const website = selectedCompany.website?.trim() || null;

      const sellerStreet = [
        selectedCompany.street,
        selectedCompany.building_number,
        selectedCompany.apartment_number ? `/${selectedCompany.apartment_number}` : '',
      ]
        .filter(Boolean)
        .join(' ')
        .trim();

      const missingSellerFields: string[] = [];

      if (!selectedCompany.legal_name) missingSellerFields.push('nazwa firmy');
      if (!selectedCompany.nip) missingSellerFields.push('NIP');
      if (!selectedCompany.street) missingSellerFields.push('adres (ulica)');
      if (!selectedCompany.postal_code) missingSellerFields.push('kod pocztowy');
      if (!selectedCompany.city) missingSellerFields.push('miasto');
      if (!selectedCompany.bank_name) missingSellerFields.push('nazwa banku');
      if (!selectedCompany.bank_account) missingSellerFields.push('numer konta bankowego');
      if (!selectedCompany.email) missingSellerFields.push('email');
      if (!selectedCompany.phone) missingSellerFields.push('telefon');

      if (missingSellerFields.length > 0) {
        showSnackbar(
          `Uzupełnij dane firmy wystawiającej: ${missingSellerFields.join(', ')}. Przejdź do Ustawienia > Moje firmy.`,
          'error',
        );
        setLoading(false);
        return;
      }

      if (!buyerIsPrivatePerson && !(nextAdvanceContext?.source.buyer_nip || selectedOrg?.nip)) {
        showSnackbar(
          'Nabywca nie ma uzupełnionego NIP. Uzupełnij dane kontrahenta albo zaznacz fakturę dla osoby prywatnej.',
          'error',
        );
        setLoading(false);
        return;
      }

      const orderItems = getItemsForInvoice();
      const documentItems =
        invoiceType === 'advance' ? getAdvancePaymentItems(orderItems) : orderItems;
      const orderTotals = calculateTotalsFor(orderItems);
      const documentTotals = calculateTotalsFor(documentItems);

      if (advanceFrom) {
        const freshContext = await getNextAdvanceContext(advanceFrom);
        if (documentTotals.totalGross <= 0 || documentTotals.totalGross > freshContext.remainingGross + 0.001) {
          setNextAdvanceContext((current) => current ? { ...current, reservedGross: freshContext.reservedGross, remainingGross: freshContext.remainingGross } : current);
          throw new Error(`Kwota nowej zaliczki przekracza dostępne saldo zamówienia: ${freshContext.remainingGross.toFixed(2)} ${currencyLabel}. Wcześniejsze zaliczki i ich szkice są już uwzględnione.`);
        }
        if (JSON.stringify(freshContext.orderItems) !== JSON.stringify(nextAdvanceContext?.orderItems)) {
          setAdvancePrefillError('Zamówienie źródłowe zmieniło się. Odśwież formularz przed przygotowaniem kolejnej zaliczki.');
          throw new Error('Zamówienie źródłowe zmieniło się. Odśwież formularz przed przygotowaniem kolejnej zaliczki.');
        }
        setNextAdvanceContext(freshContext);
      }

      const invoiceEventId = settlementGroup?.primary_event_id || selectedEventId || null;

      const invoiceData = {
        buyer_is_private_person: buyerIsPrivatePerson,
        invoice_number: normalizedInvoiceNumber,
        auto_number: invoiceNumberIsAuto,
        invoice_type: invoiceType,
        is_proforma: invoiceType === 'proforma',
        status: isPaid ? 'paid' : invoiceType === 'proforma' ? 'proforma' : 'draft',
        paid_at: isPaid ? paidDate : null,
        payment_status: isPaid ? 'paid' : 'unpaid',
        paid_amount: isPaid ? documentTotals.totalGross : 0,
        payment_due_date: isPaid ? paidDate : calculatePaymentDueDate(),
        currency_code: currencyCode,
        order_total_net: invoiceType === 'advance' ? orderTotals.totalNet : null,
        order_total_vat: invoiceType === 'advance' ? orderTotals.totalVat : null,
        order_total_gross: invoiceType === 'advance' ? orderTotals.totalGross : null,
        footer_note: footerNote,
        signature_name: issuer.signatureName,
        website,
        issue_date: issueDate,
        sale_date: saleDate,
        event_id: invoiceEventId,
        organization_id: buyerIsPrivatePerson ? null : selectedOrgId,
        billing_arrangement: selectedEventId ? billingArrangement : 'direct',
        service_recipient_organization_id: selectedEventId
          ? serviceRecipientOrganizationId || null
          : null,
        service_recipient_contact_id: selectedEventId ? serviceRecipientContactId || null : null,

        buyer_name: buyerIsPrivatePerson
          ? `${privateBuyer.firstName} ${privateBuyer.lastName}`.trim()
          : nextAdvanceContext?.source.buyer_name || selectedOrg!.name,

        buyer_nip: buyerIsPrivatePerson ? null : nextAdvanceContext?.source.buyer_nip || selectedOrg!.nip,

        buyer_street: buyerIsPrivatePerson ? privateBuyer.street : nextAdvanceContext?.source.buyer_street || selectedOrg?.street || '',

        buyer_postal_code: buyerIsPrivatePerson
          ? privateBuyer.postalCode
          : nextAdvanceContext?.source.buyer_postal_code || selectedOrg?.postal_code || '',

        buyer_city: buyerIsPrivatePerson ? privateBuyer.city : nextAdvanceContext?.source.buyer_city || selectedOrg?.city || '',
        buyer_country: nextAdvanceContext?.source.buyer_country || 'Polska',
        buyer_email: buyerIsPrivatePerson ? privateBuyer.email || null : selectedOrg?.email || null,
        buyer_phone: buyerIsPrivatePerson ? privateBuyer.phone || null : selectedOrg?.phone || null,

        buyer_contact_id: buyerIsPrivatePerson ? selectedIndividualId || null : null,
        my_company_id: selectedCompanyId,
        seller_name: selectedCompany.legal_name,
        seller_nip: selectedCompany.nip,
        seller_street: sellerStreet,
        seller_postal_code: selectedCompany.postal_code,
        seller_city: selectedCompany.city,
        seller_email: selectedCompany.email,
        seller_phone: selectedCompany.phone,
        seller_country: 'Polska',
        payment_method: paymentMethod,
        bank_name: selectedCompany.bank_name || '',
        bank_account: selectedCompany.bank_account || '',
        bank_swift_code: selectedCompany.bank_swift_code || null,
        issue_place: selectedCompany.city,
        company_logo_url: selectedCompany.logo_url || null,
        created_by: issuer.employeeId,
        ...(nextAdvanceContext ? {
          related_invoice_id: nextAdvanceContext.source.id,
          buyer_name: nextAdvanceContext.source.buyer_name,
          buyer_email: nextAdvanceContext.source.buyer_email,
          buyer_phone: nextAdvanceContext.source.buyer_phone,
          buyer_contact_person: nextAdvanceContext.source.buyer_contact_person,
        } : {}),
        ...(invoiceType === 'corrective'
          ? {
              related_invoice_id: relatedInvoiceId || null,
              correction_reason: correctionReason,
              correction_type: correctionType,
              correction_scope: correctionScope,
              corrected_invoice_number: correctedInvoiceNumber,
              corrected_invoice_issue_date: correctedInvoiceIssueDate || null,
              corrected_invoice_ksef_number: correctedInvoiceKsefNumber || null,
              corrected_invoice_was_in_ksef: correctedInvoiceWasInKsef,
            }
          : {}),
      };

      const itemsToInsert = documentItems.map((item) => {
        if (invoiceType === 'corrective') {
          const vatRate = Number(item.vat_rate ?? 0);
          const beforeQuantity = Number(item.before_quantity ?? 0);
          const beforePriceNet = Number(item.before_price_net ?? 0);
          const afterQuantity = Number(item.quantity ?? beforeQuantity);
          const afterPriceNet = Number(item.price_net ?? beforePriceNet);

          return {
            position_number: item.position_number,
            name: item.name,
            unit: item.unit,
            vat_rate: vatRate,
            vat_code: item.vat_code,
            vat_exemption_reason: item.vat_exemption_reason?.trim() || null,
            before_quantity: beforeQuantity,
            before_price_net: beforePriceNet,
            after_quantity: afterQuantity,
            after_price_net: afterPriceNet,
          };
        }

        const { valueNet, vatAmount, valueGross } = calculateItemValues(item);

        return {
          position_number: item.position_number,
          name: item.name,
          unit: item.unit,
          quantity: item.quantity,
          price_net: item.price_net,
          vat_rate: item.vat_rate,
          vat_code: item.vat_code,
          vat_exemption_reason: item.vat_exemption_reason?.trim() || null,
          value_net: valueNet,
          vat_amount: vatAmount,
          value_gross: valueGross,
        };
      });

      const orderItemsToInsert =
        invoiceType === 'advance'
          ? orderItems.map((item) => {
          const { valueNet, vatAmount, valueGross } = calculateItemValues(item);
          return {
            position_number: item.position_number,
            name: item.name,
            unit: item.unit,
            quantity: item.quantity,
            price_net: item.price_net,
            vat_rate: item.vat_rate,
            vat_code: item.vat_code,
            vat_exemption_reason: item.vat_exemption_reason?.trim() || null,
            value_net: valueNet,
            vat_amount: vatAmount,
            value_gross: valueGross,
          };
            })
          : [];

      const { data: invoiceId, error: createError } = await supabase.rpc(
        'create_invoice_atomic',
        {
          p_invoice: invoiceData,
          p_items: itemsToInsert,
          p_order_items: orderItemsToInsert,
        },
      );
      if (createError || !invoiceId) {
        throw createError || new Error('Nie udało się utworzyć dokumentu');
      }

      if (invoiceEventId && settlementGroup) {
        const { error: settlementLinkError } = await supabase.rpc(
          'link_invoice_to_event_settlement',
          {
            p_invoice_id: invoiceId,
            p_source_event_id: invoiceEventId,
          },
        );
        if (settlementLinkError) {
          console.error('Error linking invoice to settlement group:', settlementLinkError);
          showSnackbar(
            'Faktura powstała, ale nie udało się przypisać jej do wszystkich wydarzeń grupy',
            'warning',
          );
        }
      }

      showSnackbar('Faktura została utworzona', 'success');
      router.push(`/crm/invoices/${invoiceId}`);
    } catch (err: any) {
      console.error('Error creating invoice:', err);

      let msg = 'Błąd podczas tworzenia faktury';

      if (err?.code === '23502') {
        const col = err.message?.match(/column "(.+?)"/)?.[1] || '';

        const fieldMap: Record<string, string> = {
          seller_street: 'adres sprzedawcy',
          seller_city: 'miasto sprzedawcy',
          seller_postal_code: 'kod pocztowy sprzedawcy',
          seller_nip: 'NIP sprzedawcy',
          seller_name: 'nazwa sprzedawcy',
          seller_email: 'email sprzedawcy',
          seller_phone: 'telefon sprzedawcy',
          buyer_nip: 'NIP nabywcy',
          buyer_name: 'nazwa nabywcy',
          buyer_street: 'adres nabywcy',
          buyer_city: 'miasto nabywcy',
          invoice_number: 'numer faktury',
          bank_name: 'nazwa banku sprzedawcy',
          bank_account: 'numer konta bankowego sprzedawcy',
        };

        const fieldName = fieldMap[col] || col;
        msg = `Brakuje wymaganego pola: ${fieldName}. Uzupełnij dane i spróbuj ponownie.`;
      } else if (err?.code === '23505') {
        msg = 'Faktura o tym numerze już istnieje dla tej działalności. Wybierz inny numer.';
      } else if (err?.message) {
        msg = err.message;
      }

      showSnackbar(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!includeDefaultFooterNote) return;
    if (invoiceNote.trim()) return;
  
    const selectedCompany = myCompanies.find((c) => c.id === selectedCompanyId);
  
    if (selectedCompany?.invoice_footer_text) {
      setInvoiceNote(selectedCompany.invoice_footer_text);
    }
  }, [selectedCompanyId, myCompanies, includeDefaultFooterNote]);

  const totals = calculateTotals();
  const advanceTotals =
    invoiceType === 'advance'
      ? calculateTotalsFor(getAdvancePaymentItems(getItemsForInvoice()))
      : null;
  const filteredIndividualContacts = individualContacts.filter((contact) => {
    const search = individualSearch.toLowerCase().trim();

    const name =
      contact.full_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();

    const searchable = [name, contact.email, contact.phone, contact.city]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return searchable.includes(search);
  });

  if (financeAccessLoading || employeeLoading) {
    return <div className="p-6 text-sm text-[#e5e4e2]/60">Sprawdzanie uprawnień do wystawienia faktury…</div>;
  }
  if (financeAccessError || !financeAccess?.canIssueInvoices) {
    return <div role="alert" className="p-6 text-sm text-[#e5e4e2]/70">{financeAccessError || 'Brak uprawnień do wystawienia faktury.'}</div>;
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="mx-auto max-w-5xl">
        <button
          onClick={() => router.back()}
          className="mb-6 flex items-center gap-2 text-[#e5e4e2]/60 hover:text-[#d3bb73]"
        >
          <ArrowLeft className="h-5 w-5" />
          Powrót
        </button>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8">
          <h1 className="mb-8 text-2xl font-light text-[#e5e4e2]">{advanceFrom ? 'Kolejna faktura zaliczkowa' : { vat: 'Wystaw fakturę VAT', proforma: 'Wystaw proformę', advance: 'Wystaw fakturę zaliczkową', corrective: 'Wystaw fakturę korygującą' }[invoiceType]}</h1>
          {advanceFrom && (
            <div className="mb-6 rounded-lg bg-[#d3bb73]/5 p-4 text-sm text-[#e5e4e2]/70">
              {advancePrefillLoading ? <p>Wczytywanie zamówienia i wcześniejszych zaliczek…</p>
                : advancePrefillError ? <p role="alert" className="text-amber-200">{advancePrefillError}</p>
                : nextAdvanceContext && <>
                  <p>Kolejna zaliczka do zamówienia z faktury <span className="text-[#e5e4e2]">{nextAdvanceContext.source.invoice_number}</span>.</p>
                  <p className="mt-1">Wcześniejsze zaliczki i szkice: {nextAdvanceContext.reservedGross.toFixed(2)} {currencyLabel} · Pozostało: <span className="text-[#d3bb73]">{nextAdvanceContext.remainingGross.toFixed(2)} {currencyLabel}</span></p>
                  <p className="mt-1 text-xs">Wpisz procent tej zaliczki. Dane zamówienia i nabywcy są zachowane; potwierdzenie płatności dotyczy wyłącznie nowej zaliczki.</p>
                </>}
            </div>
          )}
          {invoiceType !== 'corrective' && (
            <div className="mb-2 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={buyerIsPrivatePerson}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setBuyerIsPrivatePerson(checked);

                    setSelectedOrgId('');
                    setSelectedIndividualId('');

                    setPrivateBuyer({
                      firstName: '',
                      lastName: '',
                      street: '',
                      postalCode: '',
                      city: '',
                      email: '',
                      phone: '',
                    });
                  }}
                  disabled={Boolean(advanceFrom || (selectedEventId && billingArrangement !== 'direct'))}
                  className="mt-1 h-4 w-4 rounded border-[#d3bb73]/20 text-[#d3bb73]"
                />

                <div>
                  <div className="text-sm font-medium text-[#e5e4e2]">
                    Faktura dla osoby prywatnej
                  </div>

                  <div className="mt-1 text-xs text-[#e5e4e2]/60">
                    Użyj, gdy nabywca jest osobą indywidualną bez NIP. Dokument nie będzie oznaczony
                    jako „Wizualizacja”.
                  </div>
                </div>
              </label>
            </div>
          )}

          <div className="space-y-6">
            <div className="mb-6 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/5 p-4">
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Firma wystawiająca fakturę *
              </label>
              <select
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                disabled={Boolean(advanceFrom || (invoiceType === 'corrective' && relatedInvoiceId))}
                className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">Wybierz firmę...</option>
                {myCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name} - NIP: {company.nip}
                    {company.is_default && ' (domyślna)'}
                  </option>
                ))}
              </select>
              {invoiceType === 'corrective' && relatedInvoiceId && (
                <div className="mt-2 text-xs text-orange-400">
                  Firma wystawiajaca zostala pobrana z faktury korygowanej
                </div>
              )}
              {selectedCompanyId && !(invoiceType === 'corrective' && relatedInvoiceId) && (
                <div className="mt-2 text-xs text-[#e5e4e2]/60">
                  {myCompanies.find((c) => c.id === selectedCompanyId)?.legal_name}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Typ faktury *</label>
                <select
                  value={invoiceType}
                  onChange={(e) => setInvoiceType(e.target.value as any)}
                  disabled={Boolean(advanceFrom || (urlType === 'corrective' && urlRelated))}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="vat">Faktura VAT</option>
                  <option value="proforma">Proforma</option>
                  <option value="advance">Zaliczkowa</option>
                  <option value="corrective">Korygująca</option>
                </select>
              </div>

              <div>
                <InvoiceNumberInput
                  invoiceType={invoiceType}
                  value={invoiceNumber}
                  onChange={setInvoiceNumber}
                  onAutoModeChange={setInvoiceNumberIsAuto}
                  myCompanyId={selectedCompanyId}
                />
              </div>
            </div>

            {invoiceType === 'corrective' && (
              <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-4">
                <h3 className="mb-3 text-sm font-medium text-orange-400">
                  Dane faktury korygowanej
                </h3>

                <div className="mb-4">
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                    Wybierz fakture do korekty *
                  </label>
                  <select
                    value={relatedInvoiceId}
                    onChange={(e) => handleSelectOriginalInvoice(e.target.value)}
                    disabled={!!urlRelated && urlRelatedLoaded}
                    className="w-full rounded-lg border border-orange-500/30 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-orange-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">Wybierz fakture...</option>
                    {availableInvoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number} - {inv.buyer_name} (
                        {Number(inv.total_gross).toFixed(2)} zl) -{' '}
                        {inv.invoice_type === 'advance'
                          ? 'Zaliczkowa'
                          : inv.invoice_type === 'vat'
                            ? 'VAT'
                            : inv.invoice_type}
                      </option>
                    ))}
                  </select>
                </div>

                {correctedInvoiceNumber && (
                  <div className="mb-4 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-[#e5e4e2]/40">Nr faktury korygowanej:</span>
                        <span className="ml-2 text-[#e5e4e2]">{correctedInvoiceNumber}</span>
                      </div>
                      <div>
                        <span className="text-[#e5e4e2]/40">Data wystawienia:</span>
                        <span className="ml-2 text-[#e5e4e2]">
                          {correctedInvoiceIssueDate
                            ? new Date(correctedInvoiceIssueDate).toLocaleDateString('pl-PL')
                            : '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#e5e4e2]/40">Nr KSeF:</span>
                        <span className="ml-2 text-[#e5e4e2]">
                          {correctedInvoiceKsefNumber || 'Nie wyslano do KSeF'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#e5e4e2]/40">W KSeF:</span>
                        <span
                          className={`ml-2 ${correctedInvoiceWasInKsef ? 'text-green-400' : 'text-[#e5e4e2]/60'}`}
                        >
                          {correctedInvoiceWasInKsef ? 'Tak' : 'Nie'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mb-4">
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Zakres korekty *</label>
                  <div className="flex gap-4">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="correctionScope"
                        value="full"
                        checked={correctionScope === 'full'}
                        onChange={() => setCorrectionScope('full')}
                        className="text-orange-500"
                      />
                      <span className="text-sm text-[#e5e4e2]">Calosc faktury</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="correctionScope"
                        value="partial"
                        checked={correctionScope === 'partial'}
                        onChange={() => setCorrectionScope('partial')}
                        className="text-orange-500"
                      />
                      <span className="text-sm text-[#e5e4e2]">Czesc faktury</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                    Skutek korekty w ewidencji VAT *
                  </label>
                  <select
                    value={correctionType}
                    onChange={(e) => setCorrectionType(Number(e.target.value) as 1 | 2 | 3)}
                    className="mb-4 w-full rounded-lg border border-orange-500/30 bg-[#0a0d1a] px-4 py-3 text-sm text-[#e5e4e2] focus:border-orange-500 focus:outline-none"
                  >
                    <option value={1}>Korekta skutkująca w dacie ujęcia faktury pierwotnej</option>
                    <option value={2}>Korekta skutkująca w dacie wystawienia faktury korygującej</option>
                    <option value={3}>Inna data lub różne daty dla pozycji korekty</option>
                  </select>

                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                    Przyczyna korekty *
                  </label>
                  <textarea
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    placeholder="np. Zmiana ceny uslugi, Blad w ilosci, Rabat potransakcyjny..."
                    rows={2}
                    className="w-full rounded-lg border border-orange-500/30 bg-[#0a0d1a] px-4 py-3 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-6">
              {selectedEventId && linkedEvent && !advanceFrom && (
                <InvoiceBillingContext
                  eventName={linkedEvent.name}
                  eventDate={linkedEvent.event_date}
                  serviceRecipientName={
                    organizations.find((organization) =>
                      organization.id === serviceRecipientOrganizationId)?.name || null
                  }
                  arrangement={billingArrangement}
                  payerName={
                    organizations.find((organization) => organization.id === selectedOrgId)?.name ||
                    null
                  }
                  onArrangementChange={handleBillingArrangementChange}
                />
              )}
              {selectedEventId && settlementGroup && settlementGroup.events.length > 1 && (
                <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-sky-400/10 p-2">
                      <Link2 className="h-4 w-4 text-sky-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#e5e4e2]">
                        Faktura wspólna: {settlementGroup.name}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/50">
                        Dokument zostanie automatycznie pokazany i rozliczony w poniższych
                        wydarzeniach. Operacyjnie pozostają one osobnymi realizacjami.
                      </p>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {settlementGroup.events.map((groupEvent) => (
                          <div
                            key={groupEvent.id}
                            className="rounded-lg border border-sky-400/10 bg-[#0a0d1a] px-3 py-2"
                          >
                            <p className="truncate text-xs text-[#e5e4e2]/80">
                              {groupEvent.name}
                            </p>
                            <p className="mt-1 flex items-center gap-1 text-[11px] text-[#e5e4e2]/35">
                              <CalendarDays className="h-3 w-3" />
                              {groupEvent.event_date
                                ? new Date(groupEvent.event_date).toLocaleDateString('pl-PL')
                                : 'Termin nieustalony'}
                              {groupEvent.id === settlementGroup.primary_event_id &&
                                ' · wydarzenie główne'}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {nextAdvanceContext ? (
                <div className="rounded-lg bg-white/[0.03] px-4 py-3 text-sm">
                  <p className="text-[#e5e4e2]">{nextAdvanceContext.source.buyer_name}</p>
                  <p className="mt-1 text-[#e5e4e2]/50">{nextAdvanceContext.source.buyer_nip ? `NIP: ${nextAdvanceContext.source.buyer_nip} · ` : ''}{nextAdvanceContext.source.buyer_street}, {nextAdvanceContext.source.buyer_postal_code} {nextAdvanceContext.source.buyer_city}</p>
                  {linkedEvent && <p className="mt-1 text-[#e5e4e2]/50">Wydarzenie: {linkedEvent.name}</p>}
                </div>
              ) : invoiceType === 'corrective' && relatedInvoiceId ? (
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nabywca *</label>
                  <div className="rounded-lg border border-orange-500/20 bg-[#0a0d1a]/50 px-4 py-3 text-[#e5e4e2]">
                    {organizations.find((o) => o.id === selectedOrgId)?.name ||
                      'Nabywca z faktury korygowanej'}
                  </div>
                </div>
              ) : buyerIsPrivatePerson ? (
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-4">
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Osoba prywatna
                  </label>

                  <div className="mb-4">
                    <div className="relative mb-4">
                      <input
                        type="text"
                        value={individualSearch}
                        onChange={(e) => setIndividualSearch(e.target.value)}
                        placeholder="Szukaj osoby po imieniu, nazwisku, emailu, telefonie lub mieście..."
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/30"
                      />

                      {individualSearch.trim() && (
                        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-72 overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#111827] shadow-2xl backdrop-blur">
                          {filteredIndividualContacts.length > 0 ? (
                            filteredIndividualContacts.slice(0, 20).map((contact) => {
                              const name =
                                contact.full_name ||
                                `${contact.first_name || ''} ${contact.last_name || ''}`.trim();

                              const isSelected = selectedIndividualId === contact.id;

                              return (
                                <button
                                  key={contact.id}
                                  type="button"
                                  onClick={() => {
                                    handleSelectIndividual(contact.id);
                                    setIndividualSearch(name || '');
                                  }}
                                  className={`block w-full border-b border-[#d3bb73]/10 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[#d3bb73]/10 ${
                                    isSelected ? 'bg-[#d3bb73]/10' : ''
                                  }`}
                                >
                                  <div className="text-sm font-medium text-[#e5e4e2]">
                                    {name || 'Bez nazwy'}
                                  </div>

                                  <div className="mt-1 text-xs text-[#e5e4e2]/50">
                                    {[contact.email, contact.phone, contact.city]
                                      .filter(Boolean)
                                      .join(' · ') || 'Brak danych kontaktowych'}
                                  </div>
                                </button>
                              );
                            })
                          ) : (
                            <div className="px-4 py-3 text-sm text-[#e5e4e2]/50">Brak wyników</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <input
                      type="text"
                      value={privateBuyer.firstName}
                      onChange={(e) =>
                        setPrivateBuyer((prev) => ({ ...prev, firstName: e.target.value }))
                      }
                      placeholder="Imię *"
                      className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                    />

                    <input
                      type="text"
                      value={privateBuyer.lastName}
                      onChange={(e) =>
                        setPrivateBuyer((prev) => ({ ...prev, lastName: e.target.value }))
                      }
                      placeholder="Nazwisko *"
                      className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                    />

                    <input
                      type="text"
                      value={privateBuyer.street}
                      onChange={(e) =>
                        setPrivateBuyer((prev) => ({ ...prev, street: e.target.value }))
                      }
                      placeholder="Ulica i numer *"
                      className="col-span-2 rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                    />

                    <input
                      type="text"
                      value={privateBuyer.postalCode}
                      onChange={(e) =>
                        setPrivateBuyer((prev) => ({ ...prev, postalCode: e.target.value }))
                      }
                      placeholder="Kod pocztowy *"
                      className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                    />

                    <input
                      type="text"
                      value={privateBuyer.city}
                      onChange={(e) =>
                        setPrivateBuyer((prev) => ({ ...prev, city: e.target.value }))
                      }
                      placeholder="Miasto *"
                      className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                    />
                  </div>
                </div>
              ) : (
                <BuyerSearchInput
                  contacts={organizations}
                  selectedContactId={selectedOrgId}
                  onContactSelect={handleBuyerSelect}
                  onAddNew={() => setShowAddBuyerModal(true)}
                />
              )}
              {!buyerIsPrivatePerson && selectedOrgId && !eventId && !advanceFrom && (
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-4">
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Powiązane wydarzenie
                  </label>

                  <select
                    value={selectedEventId}
                    onChange={(e) => void handleEventChange(e.target.value)}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                  >
                    <option value="">Brak powiązanego wydarzenia</option>

                    {organizationEvents.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.name}
                        {event.event_date
                          ? ` - ${new Date(event.event_date).toLocaleDateString('pl-PL')}`
                          : ''}
                      </option>
                    ))}
                  </select>

                  <div className="mt-2 text-xs text-[#e5e4e2]/50">
                    Jeśli wybierzesz wydarzenie, PDF faktury zapisze się również w plikach tego
                    eventu.
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data wystawienia *</label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data sprzedaży *</label>
                <input
                  type="date"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Sposób płatności *</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                >
                  <option value="Przelew">Przelew</option>
                  <option value="Gotówka">Gotówka</option>
                  <option value="Karta">Karta</option>
                  <option value="BLIK">BLIK</option>
                </select>
              </div>

              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isPaid}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setIsPaid(checked);

                      if (checked && !paidDate) {
                        setPaidDate(issueDate || new Date().toISOString().split('T')[0]);
                      }
                    }}
                    className="mt-1 h-4 w-4 rounded border-green-500/30 text-green-500"
                  />

                  <div className="flex-1">
                    <div className="text-sm font-medium text-[#e5e4e2]">Faktura opłacona</div>
                    <div className="mt-1 text-xs text-[#e5e4e2]/60">
                      Po zaznaczeniu status faktury zostanie ustawiony jako opłacona, a do zapłaty
                      będzie 0 {currencyLabel}.
                    </div>
                  </div>
                </label>

                {isPaid && (
                  <div className="mt-4">
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data opłacenia *</label>
                    <input
                      type="date"
                      value={paidDate}
                      onChange={(e) => setPaidDate(e.target.value)}
                      className="w-full rounded-lg border border-green-500/30 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                    />
                  </div>
                )}
              </div>

              {!isCashPayment ? (
                <>
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                      Termin płatności (dni od wystawienia) *
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={paymentDays}
                      onChange={(e) => setPaymentDays(e.target.value)}
                      aria-invalid={!calculatePaymentDueDate()}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data płatności</label>
                    <input
                      type="text"
                      value={calculatePaymentDueDate() ? calculatePaymentDueDate().split('-').reverse().join('.') : 'Podaj poprawną liczbę dni i datę wystawienia'}
                      disabled
                      className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a]/50 px-4 py-3 text-[#e5e4e2]/60"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status płatności</label>
                  <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
                    Zapłacono w dniu wystawienia ({paymentMethod})
                  </div>
                </div>
              )}
            </div>

            {invoiceType !== 'corrective' && (
              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={includeDefaultFooterNote}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setIncludeDefaultFooterNote(checked);

                      const selectedCompany = myCompanies.find((c) => c.id === selectedCompanyId);

                      if (checked && selectedCompany?.invoice_footer_text && !invoiceNote.trim()) {
                        setInvoiceNote(selectedCompany.invoice_footer_text);
                      }

                      if (!checked) {
                        setInvoiceNote('');
                      }
                    }}
                    className="mt-1 h-4 w-4 rounded border-[#d3bb73]/20 text-[#d3bb73]"
                  />

                  <div className="flex-1">
                    <div className="text-sm font-medium text-[#e5e4e2]">
                      Dodaj adnotacje do faktury
                    </div>

                    <div className="mt-1 text-xs text-[#e5e4e2]/60">
                      Treść zostanie zapisana na fakturze, pokazana w PDF i może zostać przekazana
                      do KSeF.
                    </div>
                  </div>
                </label>

                {includeDefaultFooterNote && (
                  <div className="mt-4">
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                      Adnotacje / nota płatnicza
                    </label>

                    <textarea
                      value={invoiceNote}
                      onChange={(e) => setInvoiceNote(e.target.value)}
                      rows={4}
                      placeholder="Np. Niniejsza faktura jest wezwaniem do zapłaty..."
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73] focus:outline-none"
                    />
                  </div>
                )}
              </div>
            )}

            {invoiceType === 'advance' && (
              <div className="rounded-lg border border-blue-500/25 bg-blue-500/10 p-4">
                <div className="grid gap-4 md:grid-cols-[220px_1fr] md:items-end">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    {advanceFrom ? 'Procent tej zaliczki *' : 'Wysokość zaliczki *'}
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0.01"
                        max="100"
                        step="0.01"
                        value={advancePercent}
                        onChange={(e) => setAdvancePercent(Number(e.target.value))}
                        className="w-full rounded-lg border border-blue-400/30 bg-[#0a0d1a] px-4 py-3 pr-10 text-[#e5e4e2]"
                      />
                      <span className="absolute right-4 top-3 text-[#e5e4e2]/50">%</span>
                    </div>
                  </div>
                  <div className="text-sm text-[#e5e4e2]/65">
                    Pozycje poniżej opisują pełne zamówienie. Na fakturze zaliczkowej kwoty
                    zostaną proporcjonalnie ograniczone do wskazanego procentu, a pełna wartość
                    zamówienia pozostanie zapisana osobno dla KSeF i faktury końcowej.
                  </div>
                </div>
              </div>
            )}

            <div className="border-t border-[#d3bb73]/10 pt-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-medium text-[#e5e4e2]">
                  {invoiceType === 'corrective' ? 'Pozycje korekty' : advanceFrom ? 'Pełne zamówienie' : 'Pozycje faktury'}
                </h3>
                {invoiceType !== 'corrective' && !advanceFrom && (
                  <button
                    onClick={addItem}
                    className="flex items-center gap-2 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                  >
                    <Plus className="h-4 w-4" />
                    Dodaj pozycję
                  </button>
                )}
              </div>

              {invoiceType !== 'corrective' && !advanceFrom && (
                <div className="mb-4 space-y-3 rounded-lg bg-[#d3bb73]/5 p-4">
                  <label className="block text-sm font-medium text-[#e5e4e2]" htmlFor="invoice-item-source">Podstawa pozycji i kwot zamówienia</label>
                  <select
                    id="invoice-item-source"
                    value={selectedItemSource}
                    disabled={itemSourcesLoading}
                    onChange={(event) => selectItemSource(event.target.value as 'calculation' | 'offer' | 'manual')}
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] disabled:opacity-50"
                  >
                    {(['calculation', 'offer'] as const).map((sourceId) => {
                      const source = itemSources.find((candidate) => candidate.id === sourceId);
                      return source ? (
                        <option key={sourceId} value={sourceId}>
                          {source.label} — {source.net.toFixed(2)} netto / {source.gross.toFixed(2)} {currencyCode} brutto{preferredItemSource === sourceId ? ' · źródło wydarzenia' : ''}
                        </option>
                      ) : (
                        <option key={sourceId} value={sourceId} disabled>
                          {sourceId === 'calculation' ? 'Kalkulacja' : 'Oferta'} — {itemSourcesLoading ? 'wczytywanie…' : !selectedEventId ? 'najpierw wybierz wydarzenie' : 'brak dostępnego zaakceptowanego źródła'}
                        </option>
                      );
                    })}
                    <option value="manual">Pozycje i kwoty wprowadzone ręcznie</option>
                  </select>
                  <p className="text-xs leading-relaxed text-[#e5e4e2]/60">
                    Domyślnie korzystamy ze źródła finansowego wydarzenia po rabatach. Wybór innego źródła zastępuje bieżące pozycje i kwoty — ich podsumowanie widzisz przy każdej opcji. Nie zmienia to ustawień wydarzenia.
                  </p>
                  {selectedItemSource !== 'manual' && preferredItemSource && selectedItemSource !== preferredItemSource && (
                    <p role="status" className="text-xs text-amber-200">Wybrano inne źródło niż finansowe źródło wydarzenia. Sprawdź kwotę zamówienia przed wystawieniem.</p>
                  )}
                  {selectedItemSource === 'manual' && <p className="text-xs text-[#e5e4e2]/60">Zachowano bieżące pozycje do edycji. Ich kwoty nie są automatycznie zastępowane danymi z katalogu.</p>}
                </div>
              )}
              {invoiceType !== 'corrective' && advanceFrom && (
                <div className="mb-4 rounded-lg bg-[#d3bb73]/5 p-4 text-sm text-[#e5e4e2]/75">
                  Pozycje i ich nazwy są dziedziczone z zapisanego zamówienia poprzedniej zaliczki. Własna pozycja zbiorcza pozostaje jedną pozycją — nie zastępujemy jej listą z kalkulacji. Ustaw tylko kwotę nowej zaliczki.
                </div>
              )}
              {invoiceType !== 'corrective' && acceptedPricing && (
                <div className="mb-4 rounded-lg bg-emerald-400/5 p-3 text-xs leading-relaxed text-emerald-100/85">
                  <p className="font-medium">Źródło cen: {acceptedPricing.label} — po rabatach.</p>
                  <p>Uzgodniona kwota: {acceptedPricing.net.toFixed(2)} zł netto · {acceptedPricing.gross.toFixed(2)} zł brutto{acceptedPricing.discount > 0 ? ` · rabat całej oferty: ${acceptedPricing.discount.toFixed(2)} zł netto` : ''}.</p>
                  {acceptedPricing.notice && <p className="mt-1">{acceptedPricing.notice}</p>}
                  <p className="mt-1 text-[#e5e4e2]/55">Rabat jest już uwzględniony w cenach pozycji — nie odejmuj go ponownie. Ręczne zmiany pozycji zmienią kwotę faktury.</p>
                </div>
              )}
              {invoiceType !== 'corrective' && pricingPrefillError && (
                <p role="alert" className="mb-4 rounded-lg bg-amber-300/5 p-3 text-xs leading-relaxed text-amber-100">{pricingPrefillError}</p>
              )}

              {invoiceType === 'corrective' && items.length > 0 && (
                <div className="mb-4 rounded-lg border border-orange-500/20 bg-orange-500/5 p-3 text-sm text-orange-300">
                  Edytuj kolumnę &bdquo;Po korekcie&rdquo; aby zmienić wartości. Kolumna
                  &bdquo;Przed&rdquo; jest tylko do odczytu. Róznica zostanie obliczona
                  automatycznie.
                </div>
              )}

              {invoiceType !== 'corrective' && !advanceFrom && (
                <div className="mb-4 space-y-3 rounded-lg bg-[#d3bb73]/5 p-4">
                  <p className="text-sm font-medium text-[#e5e4e2]">Pozycje widoczne na fakturze</p>
                  <div className="flex flex-wrap gap-4 text-sm text-[#e5e4e2]">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input type="radio" name="invoice-item-presentation" checked={!simplifiedInvoice}
                        onChange={() => setSimplifiedInvoice(false)} className="accent-[#d3bb73]" />
                      Pozycje szczegółowe
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input type="radio" name="invoice-item-presentation" checked={simplifiedInvoice}
                        onChange={() => setSimplifiedInvoice(true)} className="accent-[#d3bb73]" />
                      Własna pozycja zbiorcza
                    </label>
                  </div>
                  <p className="text-xs text-[#e5e4e2]/60">Wybrany układ i wpisane przez Ciebie nazwy zostaną zapisane z zamówieniem. Faktura końcowa odziedziczy je z zaliczki.</p>
                  {simplifiedInvoice && (
                    <div>
                      <label className="mb-2 block text-xs text-[#e5e4e2]/60" htmlFor="invoice-combined-name">Własna nazwa pozycji na fakturze *</label>
                      <input id="invoice-combined-name" type="text" value={simplifiedServiceName}
                        onChange={(event) => setSimplifiedServiceName(event.target.value)}
                        placeholder="Np. Obsługa techniczna konferencji zgodnie z zamówieniem"
                        className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] px-4 py-2 text-sm text-[#e5e4e2]" />
                      <p className="mt-2 text-xs text-[#e5e4e2]/60">Ta nazwa zastąpi nazwy źródłowe, także gdy źródło zawiera tylko jedną pozycję. Kwoty pochodzą z pozycji poniżej.</p>
                      {getCombinedItemsError() && <p role="alert" className="mt-2 text-xs text-amber-200">{getCombinedItemsError()}</p>}
                    </div>
                  )}
                </div>
              )}

              <details open={!simplifiedInvoice || invoiceType === 'corrective'}>
                <summary className="mb-3 cursor-pointer text-sm text-[#d3bb73]">
                  {simplifiedInvoice && invoiceType !== 'corrective' ? 'Podstawa kwoty — pozycje źródłowe, niewidoczne osobno na fakturze' : 'Pozycje i kwoty do sprawdzenia'}
                </summary>
              <fieldset disabled={Boolean(advanceFrom)} className="space-y-4 disabled:opacity-75">
                {invoiceType === 'corrective'
                  ? items.map((item, index) => {
                      const vatRate = Number(item.vat_rate ?? 0);

                      const beforeQty = Number(item.before_quantity ?? 0);
                      const beforePrice = Number(item.before_price_net ?? 0);
                      const beforeNet = Number(item.before_value_net ?? beforeQty * beforePrice);
                      const beforeVat = Number(
                        item.before_vat_amount ?? Math.round(beforeNet * vatRate) / 100,
                      );
                      const beforeGross = Number(item.before_value_gross ?? beforeNet + beforeVat);
                      const beforeGrossPrice = grossFromNet(beforePrice, vatRate);

                      const afterQty = Number(item.quantity ?? beforeQty);
                      const afterPrice = Number(item.price_net ?? beforePrice);
                      const afterNet = Number((afterQty * afterPrice).toFixed(2));
                      const afterVat = Number((Math.round(afterNet * vatRate) / 100).toFixed(2));
                      const afterGross = Number((afterNet + afterVat).toFixed(2));
                      const afterGrossPrice = grossFromNet(afterPrice, vatRate);

                      const deltaNetto = Number((afterNet - beforeNet).toFixed(2));
                      const deltaVat = Number((afterVat - beforeVat).toFixed(2));
                      const deltaGross = Number((afterGross - beforeGross).toFixed(2));

                      return (
                        <div
                          key={index}
                          className="rounded-lg border border-orange-500/15 bg-[#0a0d1a] p-4"
                        >
                          <div className="mb-3 flex items-center justify-between">
                            <div className="text-sm font-medium text-[#e5e4e2]">
                              {item.position_number}. {item.name}
                            </div>

                            <span className="rounded bg-[#1c1f33] px-2 py-0.5 text-xs text-[#e5e4e2]/50">
                              VAT {vatRate}%
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-4">
                            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-3">
                              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/40">
                                Przed korektą
                              </div>

                              <div className="space-y-2">
                                <div>
                                  <span className="text-xs text-[#e5e4e2]/40">Ilość:</span>
                                  <span className="ml-2 text-sm text-[#e5e4e2]/70">
                                    {beforeQty} {item.unit}
                                  </span>
                                </div>

                                <div>
                                  <span className="text-xs text-[#e5e4e2]/40">Cena netto:</span>
                                  <span className="ml-2 text-sm text-[#e5e4e2]/70">
                                    {beforePrice.toFixed(2)} zł
                                  </span>
                                </div>

                                <div>
                                  <span className="text-xs text-[#e5e4e2]/40">Cena brutto:</span>
                                  <span className="ml-2 text-sm text-[#e5e4e2]/70">
                                    {beforeGrossPrice.toFixed(2)} zł
                                  </span>
                                </div>

                                <div className="border-t border-[#d3bb73]/10 pt-2">
                                  <span className="text-xs text-[#e5e4e2]/40">Wartość netto:</span>
                                  <span className="ml-2 text-sm text-[#e5e4e2]/70">
                                    {beforeNet.toFixed(2)} zł
                                  </span>
                                </div>

                                <div>
                                  <span className="text-xs text-[#e5e4e2]/40">Wartość brutto:</span>
                                  <span className="ml-2 text-sm text-[#e5e4e2]/70">
                                    {beforeGross.toFixed(2)} zł
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
                              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-orange-400">
                                Po korekcie
                              </div>

                              <div className="space-y-2">
                                <div>
                                  <label className="mb-0.5 block text-xs text-[#e5e4e2]/40">
                                    Ilość
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={afterQty}
                                    onChange={(e) =>
                                      updateItem(
                                        index,
                                        'quantity',
                                        Number(e.target.value.replace(',', '.')),
                                      )
                                    }
                                    className="w-full rounded border border-orange-500/30 bg-[#1c1f33] px-2 py-1.5 text-sm text-[#e5e4e2] focus:border-orange-500 focus:outline-none"
                                  />
                                </div>

                                <div>
                                  <label className="mb-0.5 block text-xs text-[#e5e4e2]/40">
                                    Cena netto
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={afterPrice}
                                    onChange={(e) =>
                                      updateItem(
                                        index,
                                        'price_net',
                                        Number(e.target.value.replace(',', '.')),
                                      )
                                    }
                                    className="w-full rounded border border-orange-500/30 bg-[#1c1f33] px-2 py-1.5 text-sm text-[#e5e4e2] focus:border-orange-500 focus:outline-none"
                                  />
                                </div>

                                <div>
                                  <label className="mb-0.5 block text-xs text-[#e5e4e2]/40">
                                    Cena brutto
                                  </label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={afterGrossPrice}
                                    onChange={(e) => {
                                      const gross = Number(e.target.value.replace(',', '.'));
                                      updateItem(index, 'price_net', netFromGross(gross, vatRate));
                                    }}
                                    className="w-full rounded border border-orange-500/30 bg-[#1c1f33] px-2 py-1.5 text-sm text-[#e5e4e2] focus:border-orange-500 focus:outline-none"
                                  />
                                </div>

                                <div className="border-t border-orange-500/10 pt-2">
                                  <span className="text-xs text-[#e5e4e2]/40">Wartość netto:</span>
                                  <span className="ml-2 text-sm text-[#e5e4e2]/70">
                                    {afterNet.toFixed(2)} zł
                                  </span>
                                </div>

                                <div>
                                  <span className="text-xs text-[#e5e4e2]/40">Wartość brutto:</span>
                                  <span className="ml-2 text-sm text-[#e5e4e2]/70">
                                    {afterGross.toFixed(2)} zł
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => {
                                    updateItem(index, 'quantity', beforeQty);
                                    updateItem(index, 'price_net', 0);
                                  }}
                                  className="mt-2 w-full rounded border border-red-500/30 px-2 py-1.5 text-xs text-red-400 transition hover:bg-red-500/10"
                                >
                                  Skoryguj pozycję do zera
                                </button>
                              </div>
                            </div>

                            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-3">
                              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[#d3bb73]">
                                Różnica / korekta
                              </div>

                              <div className="space-y-2">
                                <div>
                                  <span className="text-xs text-[#e5e4e2]/40">Netto:</span>
                                  <span
                                    className={`ml-2 text-sm font-medium ${
                                      deltaNetto < 0
                                        ? 'text-red-400'
                                        : deltaNetto > 0
                                          ? 'text-green-400'
                                          : 'text-[#e5e4e2]/70'
                                    }`}
                                  >
                                    {deltaNetto.toFixed(2)} zł
                                  </span>
                                </div>

                                <div>
                                  <span className="text-xs text-[#e5e4e2]/40">VAT:</span>
                                  <span
                                    className={`ml-2 text-sm ${
                                      deltaVat < 0
                                        ? 'text-red-400'
                                        : deltaVat > 0
                                          ? 'text-green-400'
                                          : 'text-[#e5e4e2]/70'
                                    }`}
                                  >
                                    {deltaVat.toFixed(2)} zł
                                  </span>
                                </div>

                                <div className="border-t border-[#d3bb73]/10 pt-2">
                                  <span className="text-xs text-[#e5e4e2]/40">Brutto:</span>
                                  <span
                                    className={`ml-2 text-sm font-medium ${
                                      deltaGross < 0
                                        ? 'text-red-400'
                                        : deltaGross > 0
                                          ? 'text-green-400'
                                          : 'text-[#e5e4e2]/70'
                                    }`}
                                  >
                                    {deltaGross.toFixed(2)} zł
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  : items.map((item, index) => {
                      const { valueNet, vatAmount, valueGross } = calculateItemValues(item);
                      const vatRate = Number(item.vat_rate ?? 0);
                      const priceGross = grossFromNet(Number(item.price_net ?? 0), vatRate);

                      return (
                        <div
                          key={index}
                          className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4"
                        >
                          <div className="flex items-start gap-4">
                            <div className="grid flex-1 grid-cols-7 gap-4">
                              <div className="col-span-2">
                                <label className="mb-1 block text-xs text-[#e5e4e2]/40">
                                  Nazwa *
                                </label>
                                <input
                                  type="text"
                                  value={item.name}
                                  onChange={(e) => updateItem(index, 'name', e.target.value)}
                                  className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                                />
                              </div>

                              <div>
                                <label className="mb-1 block text-xs text-[#e5e4e2]/40">J.m.</label>
                                <select
                                  value={item.unit}
                                  onChange={(e) => updateItem(index, 'unit', e.target.value)}
                                  className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                                >
                                  <option value="szt.">szt.</option>
                                  <option value="godz.">godz.</option>
                                  <option value="usł.">usł.</option>
                                  <option value="m">m</option>
                                  <option value="m2">m2</option>
                                  <option value="kg">kg</option>
                                </select>
                              </div>

                              <div>
                                <label className="mb-1 block text-xs text-[#e5e4e2]/40">
                                  Ilość *
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={item.quantity}
                                  onChange={(e) =>
                                    updateItem(index, 'quantity', parseFloat(e.target.value))
                                  }
                                  className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                                />
                              </div>

                              <div>
                                <label className="mb-1 block text-xs text-[#e5e4e2]/40">
                                  Cena netto *
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={item.price_net}
                                  onChange={(e) =>
                                    updateItem(index, 'price_net', parseFloat(e.target.value))
                                  }
                                  className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                                />
                              </div>

                              <div>
                                <label className="mb-1 block text-xs text-[#e5e4e2]/40">
                                  Cena brutto *
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={priceGross}
                                  onChange={(e) => {
                                    const gross = Number(e.target.value.replace(',', '.'));
                                    updateItem(index, 'price_net', netFromGross(gross, vatRate));
                                  }}
                                  className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                                />
                              </div>

                              <div>
                                <label className="mb-1 block text-xs text-[#e5e4e2]/40">
                                  Stawka VAT
                                </label>
                                <select
                                  value={item.vat_code}
                                  onChange={(e) => {
                                    const newVatCode = e.target.value as InvoiceItem['vat_code'];
                                    const newVatRate = ['23', '8', '5', '0'].includes(newVatCode)
                                      ? Number(newVatCode)
                                      : 0;
                                    const currentGross = grossFromNet(
                                      Number(item.price_net ?? 0),
                                      vatRate,
                                    );

                                    updateItem(index, 'vat_code', newVatCode);
                                    updateItem(index, 'vat_rate', newVatRate);
                                    updateItem(
                                      index,
                                      'price_net',
                                      netFromGross(currentGross, newVatRate),
                                    );
                                  }}
                                  className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                                >
                                  <option value="23">23%</option>
                                  <option value="8">8%</option>
                                  <option value="5">5%</option>
                                  <option value="0" disabled>0% — wybierz właściwy rodzaj</option>
                                  <option value="0 KR">0% — sprzedaż krajowa</option>
                                  <option value="0 WDT">0% — WDT</option>
                                  <option value="0 EX">0% — eksport</option>
                                  <option value="zw">zw. — zwolniona</option>
                                  <option value="np" disabled>np. — wybierz właściwy rodzaj</option>
                                  <option value="np I">np I — poza terytorium kraju</option>
                                  <option value="np II">np II — art. 100 ust. 1 pkt 4 VAT</option>
                                  <option value="oo">oo — odwrotne obciążenie</option>
                                </select>
                              </div>
                            </div>

                            <button
                              onClick={() => removeItem(index)}
                              className="rounded-lg p-2 text-red-400 hover:bg-red-500/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>

                          {item.vat_code === 'zw' && (
                            <div className="mt-3">
                              <label className="mb-1 block text-xs text-[#e5e4e2]/50">
                                Podstawa prawna zwolnienia z VAT *
                              </label>
                              <input
                                type="text"
                                value={item.vat_exemption_reason || ''}
                                onChange={(e) =>
                                  updateItem(index, 'vat_exemption_reason', e.target.value)
                                }
                                placeholder="Np. art. 43 ust. 1 pkt … ustawy o VAT"
                                className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                              />
                            </div>
                          )}

                          <div className="mt-3 grid grid-cols-3 gap-4 border-t border-[#d3bb73]/10 pt-3 text-sm">
                            <div>
                              <span className="text-[#e5e4e2]/40">Wartość netto:</span>
                              <span className="ml-2 text-[#e5e4e2]">{valueNet.toFixed(2)} {currencyLabel}</span>
                            </div>
                            <div>
                              <span className="text-[#e5e4e2]/40">Kwota VAT:</span>
                              <span className="ml-2 text-[#e5e4e2]">{vatAmount.toFixed(2)} {currencyLabel}</span>
                            </div>
                            <div>
                              <span className="text-[#e5e4e2]/40">Wartość brutto:</span>
                              <span className="ml-2 font-medium text-[#d3bb73]">
                                {valueGross.toFixed(2)} {currencyLabel}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
              </fieldset>
              </details>
            </div>

            <div className="border-t border-[#d3bb73]/10 pt-6">
              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-6">
                <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">
                  {invoiceType === 'corrective' ? 'Kwota korekty' : 'Podsumowanie'}
                </h3>

                {invoiceType === 'corrective' &&
                  (() => {
                    const totalBeforeNet = items.reduce(
                      (sum, i) => sum + Number(i.before_value_net ?? 0),
                      0,
                    );
                    const totalBeforeVat = items.reduce(
                      (sum, i) => sum + Number(i.before_vat_amount ?? 0),
                      0,
                    );
                    const totalBeforeGross = totalBeforeNet + totalBeforeVat;
                    const totalAfterNet = totalBeforeNet + totals.totalNet;
                    const totalAfterVat = totalBeforeVat + totals.totalVat;
                    const totalAfterGross = totalAfterNet + totalAfterVat;

                    return (
                      <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-6 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]/30 p-4">
                          <div>
                            <div className="mb-1 text-xs text-[#e5e4e2]/40">
                              Przed korektą - netto
                            </div>
                            <div className="text-lg text-[#e5e4e2]/70">
                              {totalBeforeNet.toFixed(2)} zł
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-[#e5e4e2]/40">
                              Przed korektą - VAT
                            </div>
                            <div className="text-lg text-[#e5e4e2]/70">
                              {totalBeforeVat.toFixed(2)} zł
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-[#e5e4e2]/40">
                              Przed korektą - brutto
                            </div>
                            <div className="text-lg text-[#e5e4e2]/70">
                              {totalBeforeGross.toFixed(2)} zł
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-6">
                          <div>
                            <div className="mb-1 text-sm text-[#e5e4e2]/60">Korekta netto</div>
                            <div
                              className={`text-2xl font-light ${totals.totalNet < 0 ? 'text-red-400' : totals.totalNet > 0 ? 'text-green-400' : 'text-[#e5e4e2]'}`}
                            >
                              {totals.totalNet.toFixed(2)} zł
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-sm text-[#e5e4e2]/60">Korekta VAT</div>
                            <div
                              className={`text-2xl font-light ${totals.totalVat < 0 ? 'text-red-400' : totals.totalVat > 0 ? 'text-green-400' : 'text-[#e5e4e2]'}`}
                            >
                              {totals.totalVat.toFixed(2)} zł
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-sm text-[#e5e4e2]/60">Korekta brutto</div>
                            <div
                              className={`text-2xl font-medium ${totals.totalGross < 0 ? 'text-red-400' : totals.totalGross > 0 ? 'text-green-400' : 'text-[#d3bb73]'}`}
                            >
                              {totals.totalGross.toFixed(2)} zł
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-6 rounded-lg border border-orange-500/15 bg-orange-500/5 p-4">
                          <div>
                            <div className="mb-1 text-xs text-orange-400">Po korekcie - netto</div>
                            <div className="text-lg font-medium text-[#e5e4e2]">
                              {totalAfterNet.toFixed(2)} zł
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-orange-400">Po korekcie - VAT</div>
                            <div className="text-lg font-medium text-[#e5e4e2]">
                              {totalAfterVat.toFixed(2)} zł
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-xs text-orange-400">Po korekcie - brutto</div>
                            <div className="text-lg font-medium text-[#d3bb73]">
                              {totalAfterGross.toFixed(2)} zł
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                {invoiceType !== 'corrective' && (
                  <>
                    {invoiceType === 'advance' && advanceTotals && (
                      <div className="mb-4 grid grid-cols-2 gap-4 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
                        <div>
                          <div className="text-xs uppercase tracking-wide text-blue-300/70">
                            Pełna wartość zamówienia brutto
                          </div>
                          <div className="mt-1 text-xl text-[#e5e4e2]">
                            {totals.totalGross.toFixed(2)} {currencyLabel}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wide text-blue-300/70">
                            Kwota tej zaliczki brutto ({advancePercent}%)
                          </div>
                          <div className="mt-1 text-xl font-medium text-[#d3bb73]">
                            {advanceTotals.totalGross.toFixed(2)} {currencyLabel}
                          </div>
                        </div>
                      </div>
                    )}
                    {simplifiedInvoice && !getCombinedItemsError() && (
                      <div className="mb-4 rounded-lg bg-[#d3bb73]/5 p-3">
                        <div className="mb-2 text-xs font-medium text-[#d3bb73]">
                          Pozycja, która zostanie zapisana na fakturze:
                        </div>
                        <div className="text-sm text-[#e5e4e2]">
                          1. {simplifiedServiceName || 'Wpisz nazwę pozycji'} —{' '}
                          {(advanceTotals?.totalNet ?? totals.totalNet).toFixed(2)} {currencyLabel} netto
                        </div>
                        <div className="mt-2 text-xs text-[#e5e4e2]/60">
                          {invoiceType === 'advance' ? 'Faktura końcowa odziedziczy tę nazwę i pełną wartość zamówienia; odliczy zaliczki w rozliczeniu.' : 'Nazwy źródłowe nie zostaną dodane jako osobne pozycje faktury.'}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-6">
                      <div>
                        <div className="mb-1 text-sm text-[#e5e4e2]/60">Suma netto</div>
                        <div className="text-2xl font-light text-[#e5e4e2]">
                          {(advanceTotals?.totalNet ?? totals.totalNet).toFixed(2)} {currencyLabel}
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 text-sm text-[#e5e4e2]/60">Suma VAT</div>
                        <div className="text-2xl font-light text-[#e5e4e2]">
                          {(advanceTotals?.totalVat ?? totals.totalVat).toFixed(2)} {currencyLabel}
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 text-sm text-[#e5e4e2]/60">Suma brutto</div>
                        <div className="text-2xl font-medium text-[#d3bb73]">
                          {(advanceTotals?.totalGross ?? totals.totalGross).toFixed(2)} {currencyLabel}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {isPaid && (
                  <div className="mt-4 rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-400">
                    Faktura opłacona. Do zapłaty: 0.00 {currencyLabel}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-4 pt-6">
              <button
                onClick={() => router.back()}
                className="rounded-lg border border-[#d3bb73]/20 px-6 py-3 text-[#e5e4e2] hover:bg-[#d3bb73]/5"
              >
                Anuluj
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || (invoiceType !== 'corrective' && itemSourcesLoading) || Boolean(advanceFrom && (advancePrefillLoading || advancePrefillError || !nextAdvanceContext))}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                <Save className="h-5 w-5" />
                {loading ? 'Zapisywanie...' : 'Wystaw fakturę'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <AddBuyerModal
        isOpen={showAddBuyerModal}
        onClose={() => setShowAddBuyerModal(false)}
        onSuccess={handleBuyerAdded}
      />
    </div>
  );
}
