'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import BuyerSearchInput from '../../new/components/BuyerSearchInput';
import AddBuyerModal from '../../new/components/AddBuyerModal';
import InvoiceBillingContext, {
  type BillingArrangement,
} from '../../new/components/InvoiceBillingContext';
import { MyCompany } from '../../../settings/my-companies/page';

interface OrganizationEvent {
  id: string;
  name: string;
  event_date: string | null;
  organization_id: string | null;
  contact_person_id: string | null;
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
  id?: string;
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

const grossFromNet = (net: number, vatRate: number) => {
  return Number((net * (1 + vatRate / 100)).toFixed(2));
};

const netFromGross = (gross: number, vatRate: number) => {
  return Number((gross / (1 + vatRate / 100)).toFixed(2));
};

const PAYMENT_METHODS = ['Przelew', 'Gotówka', 'Karta płatnicza', 'Kompensata'];

export default function EditInvoicePage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [invoice, setInvoice] = useState<any | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [myCompanies, setMyCompanies] = useState<MyCompany[]>([]);
  const [showAddBuyerModal, setShowAddBuyerModal] = useState(false);

  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceType, setInvoiceType] = useState<
    'vat' | 'proforma' | 'advance' | 'final' | 'corrective'
  >('vat');

  const [issueDate, setIssueDate] = useState('');
  const [saleDate, setSaleDate] = useState('');
  const [paymentDays, setPaymentDays] = useState(14);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Przelew');
  const [issuePlace, setIssuePlace] = useState('');
  const [includeDefaultFooterNote, setIncludeDefaultFooterNote] = useState(true);
  const [customFooterNote, setCustomFooterNote] = useState('');
  const [website, setWebsite] = useState('');

  const [buyerIsPrivatePerson, setBuyerIsPrivatePerson] = useState(false);
  const [individualContacts, setIndividualContacts] = useState<IndividualContact[]>([]);
  const [selectedIndividualId, setSelectedIndividualId] = useState('');
  const [individualSearch, setIndividualSearch] = useState('');

  const [organizationEvents, setOrganizationEvents] = useState<OrganizationEvent[]>([]);

  const [privateBuyer, setPrivateBuyer] = useState({
    firstName: '',
    lastName: '',
    street: '',
    postalCode: '',
    city: '',
    email: '',
    phone: '',
  });

  const [invoiceStatus, setInvoiceStatus] = useState('draft');

  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionType, setCorrectionType] = useState<1 | 2 | 3>(2);
  const [correctionScope, setCorrectionScope] = useState<'full' | 'partial'>('full');
  const [relatedInvoiceId, setRelatedInvoiceId] = useState('');
  const [correctedInvoiceNumber, setCorrectedInvoiceNumber] = useState('');
  const [correctedInvoiceIssueDate, setCorrectedInvoiceIssueDate] = useState('');
  const [correctedInvoiceKsefNumber, setCorrectedInvoiceKsefNumber] = useState('');
  const [correctedInvoiceWasInKsef, setCorrectedInvoiceWasInKsef] = useState(false);
  const [availableInvoices, setAvailableInvoices] = useState<any[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [linkedEvent, setLinkedEvent] = useState<OrganizationEvent | null>(null);
  const [billingArrangement, setBillingArrangement] =
    useState<BillingArrangement>('direct');
  const [serviceRecipientOrganizationId, setServiceRecipientOrganizationId] =
    useState<string>('');
  const [serviceRecipientContactId, setServiceRecipientContactId] = useState<string>('');

  const [paidDate, setPaidDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentStatus, setPaymentStatus] = useState<
    'unpaid' | 'partially_paid' | 'paid'
  >('unpaid');
  const [paidAmount, setPaidAmount] = useState(0);
  const [advancePercent, setAdvancePercent] = useState(30);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [
        invoiceRes,
        itemsRes,
        orderItemsRes,
        businessClientsRes,
        companiesRes,
        allInvoicesRes,
        individualContactsRes,
      ] = await Promise.all([
        supabase.from('invoices').select('*').eq('id', params.id).single(),
        supabase
          .from('invoice_items')
          .select('*')
          .eq('invoice_id', params.id)
          .order('position_number'),
        supabase
          .from('invoice_order_items')
          .select('*')
          .eq('invoice_id', params.id)
          .order('position_number'),
        supabase.rpc('get_business_clients'),
        supabase
          .from('my_companies')
          .select('*')
          .eq('is_active', true)
          .order('is_default', { ascending: false }),
        supabase
          .from('invoices')
          .select(
            'id, invoice_number, invoice_type, issue_date, total_gross, buyer_name, status, buyer_is_private_person, event_id',
          )
          .neq('id', params.id)
          .neq('invoice_type', 'corrective')
          .in('status', ['issued', 'sent', 'paid'])
          .order('issue_date', { ascending: false }),
        supabase
          .from('contacts')
          .select(
            'id, first_name, last_name, full_name, email, phone, mobile, address, street, postal_code, city',
          )
          .eq('contact_type', 'individual')
          .order('last_name', { ascending: true }),
      ]);

      if (allInvoicesRes.data) {
        setAvailableInvoices(allInvoicesRes.data);
      }

      if (invoiceRes.data) {
        const inv = invoiceRes.data;
        setInvoice(inv);
        setInvoiceNumber(inv.invoice_number || '');
        setIssueDate(inv.issue_date || '');
        setSaleDate(inv.sale_date || '');
        setSelectedOrgId(inv.organization_id || '');
        setSelectedCompanyId(inv.my_company_id || '');
        setPaymentMethod(inv.payment_method || 'Przelew');
        setIssuePlace(inv.issue_place || '');
        setInvoiceStatus(inv.status || 'draft');
        setPaymentStatus(
          ['unpaid', 'partially_paid', 'paid'].includes(inv.payment_status)
            ? inv.payment_status
            : inv.status === 'paid'
              ? 'paid'
              : 'unpaid',
        );
        setPaidAmount(Number(inv.paid_amount ?? 0));
        setCustomFooterNote(inv.footer_note || '');
        setWebsite(inv.website || 'www.mavinci.pl');
        setIncludeDefaultFooterNote(Boolean(inv.footer_note));
        setBuyerIsPrivatePerson(inv.buyer_is_private_person ?? false);
        setPaidDate(
          inv.paid_at ? inv.paid_at.split('T')[0] : inv.payment_due_date || inv.issue_date || '',
        );
        setSelectedIndividualId(inv.buyer_contact_id || '');
        setSelectedEventId(inv.event_id || null);
        setBillingArrangement(inv.billing_arrangement || 'direct');
        setServiceRecipientOrganizationId(inv.service_recipient_organization_id || '');
        setServiceRecipientContactId(inv.service_recipient_contact_id || '');

        if (inv.event_id) {
          await fetchEventContext(
            inv.event_id,
            !inv.service_recipient_organization_id && !inv.service_recipient_contact_id,
          );
        }

        if (inv.organization_id) {
          await fetchOrganizationEvents(inv.organization_id, inv.event_id || null);
        }
        if (inv.buyer_is_private_person) {
          const [firstName = '', ...rest] = String(inv.buyer_name || '').split(' ');

          setPrivateBuyer({
            firstName,
            lastName: rest.join(' '),
            street: inv.buyer_street || '',
            postalCode: inv.buyer_postal_code || '',
            city: inv.buyer_city || '',
            email: inv.buyer_email || '',
            phone: inv.buyer_phone || '',
          });

          setIndividualSearch(inv.buyer_name || '');
        }

        if (inv.is_proforma) {
          setInvoiceType('proforma');
        } else if (inv.invoice_type === 'advance') {
          setInvoiceType('advance');
        } else if (inv.invoice_type === 'corrective') {
          setInvoiceType('corrective');
        } else if (inv.invoice_type === 'final') {
          setInvoiceType('final');
        } else {
          setInvoiceType('vat');
        }

        setCorrectionReason(inv.correction_reason || '');
        setCorrectionType([1, 2, 3].includes(Number(inv.correction_type)) ? inv.correction_type : 2);
        setCorrectionScope(inv.correction_scope || 'full');
        setRelatedInvoiceId(inv.related_invoice_id || '');
        setCorrectedInvoiceNumber(inv.corrected_invoice_number || '');
        setCorrectedInvoiceIssueDate(inv.corrected_invoice_issue_date || '');
        setCorrectedInvoiceKsefNumber(inv.corrected_invoice_ksef_number || '');
        setCorrectedInvoiceWasInKsef(inv.corrected_invoice_was_in_ksef ?? false);

        if (inv.issue_date && inv.payment_due_date) {
          const issueD = new Date(inv.issue_date);
          const dueD = new Date(inv.payment_due_date);
          const days = Math.round((dueD.getTime() - issueD.getTime()) / (1000 * 60 * 60 * 24));
          setPaymentDays(days > 0 ? days : 14);
        }
      }

      if (itemsRes.data) {
        const sourceItems =
          invoiceRes.data?.invoice_type === 'advance' && orderItemsRes.data?.length
            ? orderItemsRes.data
            : itemsRes.data;
        setItems(
          sourceItems.map((item: any) => ({
            ...item,
            vat_code: (item.vat_code || String(item.vat_rate || 23)) as InvoiceItem['vat_code'],
            vat_exemption_reason: item.vat_exemption_reason || '',
            quantity: Number(item.quantity ?? item.after_quantity ?? 0),
            price_net: Number(item.price_net ?? item.after_price_net ?? 0),
          })),
        );

        if (invoiceRes.data?.invoice_type === 'advance') {
          const orderGross = Number(
            invoiceRes.data.order_total_gross ??
              orderItemsRes.data?.reduce(
                (sum: number, item: any) => sum + Number(item.value_gross ?? 0),
                0,
              ) ??
              0,
          );
          const paidGross = Number(invoiceRes.data.total_gross ?? 0);
          if (orderGross > 0) setAdvancePercent(Number(((paidGross / orderGross) * 100).toFixed(2)));
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

      if (individualContactsRes.data) {
        setIndividualContacts(
          individualContactsRes.data.map((c: any) => ({
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
          })),
        );
      }

      if (companiesRes.data) {
        setMyCompanies(companiesRes.data);
        const selectedCompany =
          companiesRes.data.find((c: MyCompany) => c.id === invoiceRes.data?.my_company_id) ||
          companiesRes.data.find((c: MyCompany) => c.is_default) ||
          companiesRes.data[0];

        if (selectedCompany && !invoiceRes.data?.website) {
          setWebsite(selectedCompany.website || '');
        }

        if (!invoiceRes.data?.my_company_id && companiesRes.data.length > 0) {
          const defaultCompany = companiesRes.data.find((c: MyCompany) => c.is_default);
          setSelectedCompanyId(defaultCompany?.id || companiesRes.data[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching data:', err);
      showSnackbar('Blad podczas ladowania danych', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOriginalInvoice = async (invoiceId: string) => {
    setRelatedInvoiceId(invoiceId);

    if (!invoiceId) {
      setCorrectedInvoiceNumber('');
      setCorrectedInvoiceIssueDate('');
      setCorrectedInvoiceKsefNumber('');
      setCorrectedInvoiceWasInKsef(false);
      return;
    }

    const { data: origInvoice } = await supabase
      .from('invoices')
      .select('*, invoice_items(*)')
      .eq('id', invoiceId)
      .single();

    if (origInvoice) {
      setCorrectedInvoiceNumber(origInvoice.invoice_number || '');
      setCorrectedInvoiceIssueDate(origInvoice.issue_date || '');
      setSelectedOrgId(origInvoice.organization_id || '');
      setSelectedCompanyId(origInvoice.my_company_id || '');
      setSelectedEventId(origInvoice.event_id || null);
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
        setLinkedEvent(null);
      }

      if (origInvoice.organization_id) {
        await fetchOrganizationEvents(origInvoice.organization_id, origInvoice.event_id || null);
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
            return {
              id: undefined,
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
              before_value_gross: Number(item.value_gross ?? beforeValueNet + beforeVatAmount),
              after_quantity: beforeQuantity,
              after_price_net: beforePriceNet,
            };
          }),
        );
      }
    }
  };

  const fetchEventContext = async (eventId: string, syncRecipients = true) => {
    const { data, error } = await supabase
      .from('events')
      .select('id, name, event_date, organization_id, contact_person_id')
      .eq('id', eventId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching invoice event context:', error);
      return null;
    }

    const event = (data as OrganizationEvent | null) || null;
    setLinkedEvent(event);

    if (syncRecipients) {
      setServiceRecipientOrganizationId(event?.organization_id || '');
      setServiceRecipientContactId(event?.contact_person_id || '');
    }

    return event;
  };

  const fetchOrganizationEvents = async (
    organizationId?: string | null,
    preservedEventId?: string | null,
  ) => {
    if (!organizationId) {
      setOrganizationEvents([]);
      return;
    }

    const { data, error } = await supabase
      .from('events')
      .select('id, name, event_date, organization_id, contact_person_id')
      .eq('organization_id', organizationId)
      .order('event_date', { ascending: false });

    if (error) {
      console.error('Error fetching organization events:', error);
      showSnackbar('Błąd podczas pobierania wydarzeń organizacji', 'error');
      return;
    }

    const events = (data || []) as OrganizationEvent[];
    if (preservedEventId && !events.some((event) => event.id === preservedEventId)) {
      const preserved =
        linkedEvent?.id === preservedEventId
          ? linkedEvent
          : await fetchEventContext(preservedEventId, false);
      if (preserved) events.unshift(preserved);
    }

    setOrganizationEvents(events);
  };

  const handleEventChange = async (eventId: string | null) => {
    setSelectedEventId(eventId);
    setBillingArrangement('direct');

    if (!eventId) {
      setLinkedEvent(null);
      setServiceRecipientOrganizationId('');
      setServiceRecipientContactId('');
      return;
    }

    const event = await fetchEventContext(eventId);
    if (event?.organization_id) setSelectedOrgId(event.organization_id);
  };

  const handleBuyerSelect = (organizationId: string) => {
    setSelectedOrgId(organizationId);
    void fetchOrganizationEvents(organizationId, selectedEventId);

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
      void fetchOrganizationEvents(serviceRecipientOrganizationId, selectedEventId);
    } else if (
      arrangement !== 'direct' &&
      selectedOrgId === serviceRecipientOrganizationId
    ) {
      setSelectedOrgId('');
    }
  };

  const calculatePaymentDueDate = () => {
    if (!issueDate) return '';
    const date = new Date(issueDate);
    date.setDate(date.getDate() + paymentDays);
    return date.toISOString().split('T')[0];
  };

  const calculateItemValues = (item: InvoiceItem) => {
    const afterNet = Number((item.quantity * item.price_net).toFixed(2));
    const afterVat = Number((Math.round(afterNet * item.vat_rate) / 100).toFixed(2));
    const afterGross = Number((afterNet + afterVat).toFixed(2));

    if (invoiceType === 'corrective') {
      const beforeNet = Number(
        item.before_value_net ??
          Number(item.before_quantity ?? 0) * Number(item.before_price_net ?? 0),
      );
      const beforeVat = Number(
        item.before_vat_amount ?? Math.round(beforeNet * item.vat_rate) / 100,
      );
      return {
        valueNet: Number((afterNet - beforeNet).toFixed(2)),
        vatAmount: Number((afterVat - beforeVat).toFixed(2)),
        valueGross: Number((afterGross - beforeNet - beforeVat).toFixed(2)),
      };
    }

    const valueNet = afterNet;
    const vatAmount = afterVat;
    const valueGross = afterGross;
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

  const calculateTotals = () => calculateTotalsFor(items);

  const getAdvancePaymentItems = (orderItems: InvoiceItem[]) => {
    const ratio = advancePercent / 100;
    return orderItems.map((item) => ({
      ...item,
      price_net: Number((Number(item.price_net) * ratio).toFixed(2)),
    }));
  };

  const addItem = () => {
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
      },
    ]);
  };

  const removeItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    newItems.forEach((item, i) => (item.position_number = i + 1));
    setItems(newItems);
  };

  const updateItem = (index: number, field: keyof InvoiceItem, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const handleBuyerAdded = async (buyerId: string) => {
    await fetchData();
    handleBuyerSelect(buyerId);
  };

  const buildInvoiceFooterText = () => {
    if (invoiceType === 'corrective') {
      const issueDateText = correctedInvoiceIssueDate
        ? new Date(correctedInvoiceIssueDate).toLocaleDateString('pl-PL')
        : '-';

      return `Faktura korygująca odnosi się do faktury ${correctedInvoiceNumber || '-'} z dnia ${issueDateText}. Przyczyna korekty: ${
        correctionReason || '-'
      }.`;
    }

    if (!includeDefaultFooterNote) {
      return null;
    }

    return customFooterNote.trim() || null;
  };

  const handleSubmit = async () => {
    if (
      !invoice ||
      invoice.invoice_type === 'final' ||
      invoice.ksef_status === 'pending' ||
      invoice.ksef_status === 'accepted' ||
      invoice.ksef_reference_number ||
      !['draft', 'proforma'].includes(invoice.status)
    ) {
      showSnackbar('Tego dokumentu nie można edytować. Wystaw korektę.', 'error');
      return;
    }
    if (!selectedCompanyId) {
      showSnackbar('Wybierz firme wystawiajaca fakture', 'error');
      return;
    }

    if (selectedEventId && billingArrangement !== 'direct' && buyerIsPrivatePerson) {
      showSnackbar('Hotel lub pośrednik musi być wybrany jako organizacja.', 'error');
      return;
    }

    if (buyerIsPrivatePerson) {
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
    } else if (!selectedOrgId) {
      showSnackbar('Wybierz nabywce', 'error');
      return;
    }

    if (!invoiceNumber) {
      showSnackbar('Numer faktury jest wymagany', 'error');
      return;
    }

    if (invoiceType === 'corrective') {
      if (items.some((item) => !item.name)) {
        showSnackbar('Wypelnij nazwy wszystkich pozycji faktury', 'error');
        return;
      }
    } else {
      if (items.some((item) => !item.name || item.price_net <= 0)) {
        showSnackbar('Wypelnij wszystkie pozycje faktury', 'error');
        return;
      }
    }

    if (items.some((item) => item.vat_code === 'zw' && !item.vat_exemption_reason?.trim())) {
      showSnackbar('Podaj podstawę prawną dla każdej pozycji zwolnionej z VAT.', 'error');
      return;
    }

    if (items.some((item) => item.vat_code === '0' || item.vat_code === 'np')) {
      showSnackbar('Dla 0% wybierz rodzaj transakcji (krajowa, WDT lub eksport), a dla „np.” wybierz np I albo np II.', 'error');
      return;
    }

    if (invoiceType === 'advance' && (advancePercent <= 0 || advancePercent > 100)) {
      showSnackbar('Zaliczka musi być większa od 0% i nie może przekraczać 100%.', 'error');
      return;
    }

    try {
      setSaving(true);

      const selectedOrg = buyerIsPrivatePerson
        ? null
        : organizations.find((o) => o.id === selectedOrgId);

      if (!buyerIsPrivatePerson && !selectedOrg) {
        throw new Error('Organization not found');
      }

      const selectedCompany = myCompanies.find((c) => c.id === selectedCompanyId);
      if (!selectedCompany) throw new Error('Company not found');

      const footerNote = buildInvoiceFooterText();

      const missingSellerFields: string[] = [];
      if (!selectedCompany.legal_name) missingSellerFields.push('nazwa firmy');
      if (!selectedCompany.nip) missingSellerFields.push('NIP');
      if (!selectedCompany.street) missingSellerFields.push('adres (ulica)');
      if (!selectedCompany.postal_code) missingSellerFields.push('kod pocztowy');
      if (!selectedCompany.city) missingSellerFields.push('miasto');
      if (!selectedCompany.bank_name) missingSellerFields.push('nazwa banku');
      if (!selectedCompany.bank_account) missingSellerFields.push('numer konta bankowego');

      if (missingSellerFields.length > 0) {
        showSnackbar(
          `Uzupelnij dane firmy wystawiajacej: ${missingSellerFields.join(', ')}. Przejdz do Ustawienia > Moje firmy.`,
          'error',
        );
        setSaving(false);
        return;
      }

      if (!buyerIsPrivatePerson && !selectedOrg?.nip) {
        showSnackbar('Nabywca nie ma uzupelnionego NIP. Uzupelnij dane kontrahenta.', 'error');
        setSaving(false);
        return;
      }

      if (
        selectedEventId &&
        billingArrangement !== 'direct' &&
        selectedOrgId === serviceRecipientOrganizationId
      ) {
        showSnackbar('Wybierz hotel lub inną organizację, która będzie nabywcą faktury.', 'error');
        setSaving(false);
        return;
      }

      const sellerStreet = [
        selectedCompany.street,
        selectedCompany.building_number,
        selectedCompany.apartment_number ? `/${selectedCompany.apartment_number}` : '',
      ]
        .filter(Boolean)
        .join(' ')
        .trim();

      const orderItems = items;
      const documentItems =
        invoiceType === 'advance' ? getAdvancePaymentItems(orderItems) : orderItems;
      const orderTotals = calculateTotalsFor(orderItems);
      const documentTotals = calculateTotalsFor(documentItems);

      if (
        paymentStatus === 'partially_paid' &&
        (paidAmount <= 0 || paidAmount >= documentTotals.totalGross)
      ) {
        showSnackbar(
          'Wpłata częściowa musi być większa od zera i mniejsza od kwoty dokumentu.',
          'error',
        );
        setSaving(false);
        return;
      }

      if (invoiceType === 'corrective' && !relatedInvoiceId) {
        showSnackbar('Wybierz fakture do korekty', 'error');
        setSaving(false);
        return;
      }

      if (invoiceType === 'corrective' && !correctionReason.trim()) {
        showSnackbar('Podaj przyczyne korekty', 'error');
        setSaving(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: employee } = await supabase
        .from('employees')
        .select('id, name, surname')
        .eq('email', user?.email)
        .maybeSingle();

      const signatureName =
        [employee?.name, employee?.surname].filter(Boolean).join(' ').trim() ||
        selectedCompany.signature_name ||
        '';

      const invoiceData: Record<string, any> = {
        event_id: selectedEventId,
        invoice_number: invoiceNumber,
        invoice_type: invoiceType,
        is_proforma: invoiceType === 'proforma',
        payment_status: paymentStatus,
        paid_amount:
          paymentStatus === 'paid'
            ? documentTotals.totalGross
            : paymentStatus === 'partially_paid'
              ? paidAmount
              : 0,
        paid_at: paymentStatus === 'unpaid' ? null : paidDate || null,
        status: paymentStatus === 'paid' ? 'paid' : invoiceStatus,
        payment_due_date:
          paymentStatus === 'paid' ? paidDate || issueDate : calculatePaymentDueDate(),
        issue_date: issueDate,
        sale_date: saleDate,
        footer_note: footerNote,
        signature_name: signatureName,
        website: website,
        organization_id: buyerIsPrivatePerson ? null : selectedOrgId,
        buyer_contact_id: buyerIsPrivatePerson ? selectedIndividualId || null : null,
        billing_arrangement: selectedEventId ? billingArrangement : 'direct',
        service_recipient_organization_id: selectedEventId
          ? serviceRecipientOrganizationId || null
          : null,
        service_recipient_contact_id: selectedEventId ? serviceRecipientContactId || null : null,

        buyer_name: buyerIsPrivatePerson
          ? `${privateBuyer.firstName} ${privateBuyer.lastName}`.trim()
          : selectedOrg!.name,

        buyer_nip: buyerIsPrivatePerson ? null : selectedOrg!.nip,

        buyer_street: buyerIsPrivatePerson ? privateBuyer.street : selectedOrg!.street || '',

        buyer_postal_code: buyerIsPrivatePerson
          ? privateBuyer.postalCode
          : selectedOrg!.postal_code || '',

        buyer_city: buyerIsPrivatePerson ? privateBuyer.city : selectedOrg!.city || '',

        buyer_country: 'Polska',
        buyer_email: buyerIsPrivatePerson ? privateBuyer.email || null : selectedOrg!.email || null,
        buyer_phone: buyerIsPrivatePerson ? privateBuyer.phone || null : selectedOrg!.phone || null,
        buyer_is_private_person: buyerIsPrivatePerson,
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
        issue_place: issuePlace || selectedCompany.city,
        currency_code: invoice.currency_code || 'PLN',
        order_total_net: invoiceType === 'advance' ? orderTotals.totalNet : null,
        order_total_vat: invoiceType === 'advance' ? orderTotals.totalVat : null,
        order_total_gross: invoiceType === 'advance' ? orderTotals.totalGross : null,
        updated_at: new Date().toISOString(),
      };

      if (invoiceType === 'corrective') {
        invoiceData.related_invoice_id = relatedInvoiceId || null;
        invoiceData.correction_reason = correctionReason;
        invoiceData.correction_type = correctionType;
        invoiceData.correction_scope = correctionScope;
        invoiceData.corrected_invoice_number = correctedInvoiceNumber;
        invoiceData.corrected_invoice_issue_date = correctedInvoiceIssueDate || null;
        invoiceData.corrected_invoice_ksef_number = correctedInvoiceKsefNumber || null;
        invoiceData.corrected_invoice_was_in_ksef = correctedInvoiceWasInKsef;
      } else {
        invoiceData.related_invoice_id = null;
        invoiceData.correction_reason = null;
        invoiceData.correction_scope = null;
        invoiceData.corrected_invoice_number = null;
        invoiceData.corrected_invoice_issue_date = null;
        invoiceData.corrected_invoice_ksef_number = null;
        invoiceData.corrected_invoice_was_in_ksef = false;
      }

      const itemsToInsert = documentItems.map((item) => {
        const { valueNet, vatAmount, valueGross } = calculateItemValues(item);
        if (invoiceType === 'corrective') {
          return {
            position_number: item.position_number,
            name: item.name,
            unit: item.unit,
            vat_rate: item.vat_rate,
            vat_code: item.vat_code,
            vat_exemption_reason: item.vat_exemption_reason?.trim() || null,
            before_quantity: Number(item.before_quantity ?? 0),
            before_price_net: Number(item.before_price_net ?? 0),
            after_quantity: Number(item.quantity ?? 0),
            after_price_net: Number(item.price_net ?? 0),
          };
        }
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

      const { error: updateError } = await supabase.rpc('update_invoice_draft_atomic', {
        p_invoice_id: params.id,
        p_invoice: invoiceData,
        p_items: itemsToInsert,
        p_order_items: orderItemsToInsert,
      });
      if (updateError) throw updateError;

      if (selectedEventId) {
        const { error: settlementLinkError } = await supabase.rpc(
          'link_invoice_to_event_settlement',
          {
            p_invoice_id: params.id,
            p_source_event_id: selectedEventId,
          },
        );
        if (settlementLinkError) {
          console.error('Error refreshing invoice settlement links:', settlementLinkError);
          showSnackbar(
            'Faktura została zapisana, ale nie udało się odświeżyć wspólnego rozliczenia',
            'warning',
          );
        }
      }

      showSnackbar('Faktura zostala zaktualizowana', 'success');
      router.push(`/crm/invoices/${params.id}`);
      } catch (err: unknown | Error) {
      if (err instanceof Error) {
      console.error('Error updating invoice:', err);
      let msg = 'Blad podczas aktualizacji faktury';
      if (err.message.includes('23505')) {
        msg = 'Faktura o tym numerze juz istnieje. Wybierz inny numer.';
      } else if (err?.message) {
        msg = err.message;
      }
      showSnackbar(msg, 'error');
      }
    } finally {
      setSaving(false);
    }
  };
  const handleSelectIndividual = (contactId: string) => {
    setSelectedIndividualId(contactId);

    const contact = individualContacts.find((c) => c.id === contactId);
    if (!contact) return;

    const name =
      contact.full_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();

    setIndividualSearch(name);

    setPrivateBuyer({
      firstName: contact.first_name || '',
      lastName: contact.last_name || '',
      street: contact.street || contact.address || '',
      postalCode: contact.postal_code || '',
      city: contact.city || '',
      email: contact.email || '',
      phone: contact.phone || '',
    });
  };

  const filteredIndividualContacts = individualContacts.filter((contact) => {
    const search = individualSearch.toLowerCase().trim();

    if (!search) return false;

    const name =
      contact.full_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();

    return [name, contact.email, contact.phone, contact.city]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(search);
  });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]/60">Ladowanie...</div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]/60">Faktura nie zostala znaleziona</div>
      </div>
    );
  }

  const accountingLocked =
    invoice.invoice_type === 'final' ||
    invoice.ksef_status === 'pending' ||
    invoice.ksef_status === 'accepted' ||
    Boolean(invoice.ksef_reference_number) ||
    !['draft', 'proforma'].includes(invoice.status);

  if (accountingLocked) {
    return (
      <div className="min-h-screen bg-[#0a0d1a] p-6">
        <div className="mx-auto max-w-3xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-8">
          <h1 className="text-2xl text-[#e5e4e2]">Dokument jest chroniony przed edycją</h1>
          <p className="mt-3 text-[#e5e4e2]/65">
            {invoice.invoice_type === 'final'
              ? 'Fakturę końcową edytuje się wyłącznie w dedykowanym procesie rozliczenia zaliczek. Zwykły edytor mógłby zerwać jej powiązania.'
              : invoice.ksef_status === 'pending'
                ? 'Poprzednia wysyłka oczekuje na rozstrzygnięcie KSeF. Do tego czasu treść faktury nie może się zmienić.'
                : 'Po wystawieniu dokumentu jego treści księgowej nie wolno nadpisywać. Zmiany wykonuje się fakturą korygującą.'}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => router.push(`/crm/invoices/${params.id}`)}
              className="rounded-lg border border-[#d3bb73]/20 px-5 py-3 text-[#e5e4e2]"
            >
              Wróć do dokumentu
            </button>
            {invoice.invoice_type !== 'proforma' && invoice.invoice_type !== 'final' && (
              <button
                onClick={() =>
                  router.push(`/crm/invoices/new?type=corrective&related=${params.id}`)
                }
                className="rounded-lg bg-[#d3bb73] px-5 py-3 font-medium text-[#1c1f33]"
              >
                Wystaw korektę
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const totals = calculateTotals();
  const advanceTotals =
    invoiceType === 'advance' ? calculateTotalsFor(getAdvancePaymentItems(items)) : null;
  const displayedTotals = advanceTotals ?? totals;

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="mx-auto max-w-5xl">
        <button
          onClick={() => router.push('/crm/invoices')}
          className="mb-6 flex items-center gap-2 text-[#e5e4e2]/60 hover:text-[#d3bb73]"
        >
          <ArrowLeft className="h-5 w-5" />
          Powrot
        </button>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8">
          <h1 className="mb-8 text-2xl font-light text-[#e5e4e2]">
            Edytuj fakture {invoice.invoice_number}
          </h1>

          <div className="space-y-6">
            {/* Status faktury */}
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status faktury</label>
              <select
                value={invoiceStatus}
                onChange={(e) => setInvoiceStatus(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
              >
                {invoiceType === 'proforma' ? (
                  <>
                    <option value="draft">Szkic</option>
                    <option value="proforma">Proforma</option>
                    <option value="cancelled">Anulowana</option>
                  </>
                ) : (
                  <>
                    <option value="draft">Szkic</option>
                    <option value="issued">Wystawiona</option>
                    <option value="sent">Wysłana</option>
                    <option value="paid">Opłacona</option>
                    <option value="overdue">Przeterminowana</option>
                    <option value="cancelled">Anulowana</option>
                  </>
                )}
              </select>
            </div>

            {/* KSeF Info (read-only) */}
            {invoice?.ksef_status && (
              <div
                className={`rounded-lg border p-4 ${
                  invoice.ksef_status === 'accepted'
                    ? 'border-green-500/30 bg-green-500/10'
                    : invoice.ksef_status === 'rejected'
                      ? 'border-red-500/30 bg-red-500/10'
                      : 'border-blue-500/30 bg-blue-500/10'
                }`}
              >
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status KSeF</label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-[#e5e4e2]/40">Status</div>
                    <div
                      className={`font-medium ${
                        invoice.ksef_status === 'accepted'
                          ? 'text-green-400'
                          : invoice.ksef_status === 'rejected'
                            ? 'text-red-400'
                            : 'text-blue-400'
                      }`}
                    >
                      {invoice.ksef_status === 'accepted'
                        ? 'Zaakceptowana'
                        : invoice.ksef_status === 'rejected'
                          ? 'Odrzucona'
                          : invoice.ksef_status === 'sent'
                            ? 'Wysłana'
                            : 'Szkic'}
                    </div>
                  </div>
                  {invoice.ksef_reference_number && (
                    <div>
                      <div className="text-xs text-[#e5e4e2]/40">Nr referencyjny KSeF</div>
                      <div className="font-mono text-sm text-[#e5e4e2]">
                        {invoice.ksef_reference_number}
                      </div>
                    </div>
                  )}
                  {invoice.ksef_sent_at && (
                    <div>
                      <div className="text-xs text-[#e5e4e2]/40">Data wysyłki</div>
                      <div className="text-sm text-[#e5e4e2]">
                        {new Date(invoice.ksef_sent_at).toLocaleString('pl-PL')}
                      </div>
                    </div>
                  )}
                </div>
                {invoice.ksef_error && (
                  <div className="mt-3 rounded border border-red-500/20 bg-red-500/5 p-2 text-sm text-red-400">
                    {invoice.ksef_error}
                  </div>
                )}
              </div>
            )}

            {/* Firma wystawiajaca */}
            <div className="rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/5 p-4">
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Firma wystawiajaca fakture *
              </label>
              <select
                value={selectedCompanyId}
                onChange={(e) => {
                  const companyId = e.target.value;
                  setSelectedCompanyId(companyId);

                  const company = myCompanies.find((c) => c.id === companyId);

                  if (company) {
                    setIssuePlace(company.city || '');
                    setWebsite(company.website || 'www.mavinci.pl');
                  }
                }}
                disabled={invoiceType === 'corrective' && !!relatedInvoiceId}
                className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">Wybierz firme...</option>
                {myCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name} - NIP: {company.nip}
                    {company.is_default && ' (domyslna)'}
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

            {/* Typ + numer */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Typ faktury *</label>
                <select
                  value={invoiceType}
                  onChange={(e) =>
                    setInvoiceType(
                      e.target.value as 'vat' | 'proforma' | 'advance' | 'corrective',
                    )
                  }
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                >
                  <option value="vat">Faktura VAT</option>
                  <option value="proforma">Proforma</option>
                  <option value="advance">Zaliczkowa</option>
                  <option value="corrective">Korygujaca</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Numer faktury *</label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
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
                    className="w-full rounded-lg border border-orange-500/30 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-orange-500 focus:outline-none"
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
                    className="mb-4 w-full rounded-lg border border-orange-500/30 bg-[#0a0d1a] px-4 py-3 text-sm text-[#e5e4e2]"
                  >
                    <option value={1}>W dacie ujęcia faktury pierwotnej</option>
                    <option value={2}>W dacie wystawienia faktury korygującej</option>
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

            {invoiceType === 'corrective' && correctedInvoiceNumber && (
              <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-4">
                <div className="mb-2 text-sm font-medium text-orange-400">
                  Nota dla faktury korygującej
                </div>
                <div className="text-sm text-[#e5e4e2]/80">{buildInvoiceFooterText()}</div>
              </div>
            )}

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-4">
              <input
                type="checkbox"
                checked={buyerIsPrivatePerson}
                onChange={(e) => setBuyerIsPrivatePerson(e.target.checked)}
                disabled={Boolean(selectedEventId && billingArrangement !== 'direct')}
                className="mt-1 h-4 w-4 rounded border-[#d3bb73]/20 text-[#d3bb73]"
              />

              <div>
                <div className="text-sm font-medium text-[#e5e4e2]">
                  Faktura dla osoby prywatnej
                </div>

                <div className="mt-1 text-xs text-[#e5e4e2]/60">
                  Ukrywa oznaczenie „Wizualizacja” i dostosowuje dokument dla klienta
                  indywidualnego.
                </div>
              </div>
            </label>
            {/* Nabywca */}
            <div className="grid grid-cols-1 gap-6">
              {selectedEventId && linkedEvent && (
                <InvoiceBillingContext
                  eventName={linkedEvent.name}
                  eventDate={linkedEvent.event_date}
                  serviceRecipientName={
                    organizations.find(
                      (organization) => organization.id === serviceRecipientOrganizationId,
                    )?.name || null
                  }
                  arrangement={billingArrangement}
                  payerName={
                    organizations.find((organization) => organization.id === selectedOrgId)?.name ||
                    null
                  }
                  onArrangementChange={handleBillingArrangementChange}
                />
              )}
              {buyerIsPrivatePerson ? (
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-4">
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Osoba prywatna
                  </label>

                  <div className="relative mb-4">
                    <input
                      type="text"
                      value={individualSearch}
                      onChange={(e) => setIndividualSearch(e.target.value)}
                      placeholder="Szukaj osoby po imieniu, nazwisku, emailu, telefonie lub mieście..."
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/30"
                    />

                    {individualSearch.trim() && filteredIndividualContacts.length > 0 && (
                      <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-72 overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#111827] shadow-2xl">
                        {filteredIndividualContacts.slice(0, 20).map((contact) => {
                          const name =
                            contact.full_name ||
                            `${contact.first_name || ''} ${contact.last_name || ''}`.trim();

                          return (
                            <button
                              key={contact.id}
                              type="button"
                              onClick={() => handleSelectIndividual(contact.id)}
                              className="block w-full border-b border-[#d3bb73]/10 px-4 py-3 text-left last:border-b-0 hover:bg-[#d3bb73]/10"
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
                        })}
                      </div>
                    )}
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

                    <input
                      type="email"
                      value={privateBuyer.email}
                      onChange={(e) =>
                        setPrivateBuyer((prev) => ({ ...prev, email: e.target.value }))
                      }
                      placeholder="E-mail"
                      className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                    />

                    <input
                      type="tel"
                      value={privateBuyer.phone}
                      onChange={(e) =>
                        setPrivateBuyer((prev) => ({ ...prev, phone: e.target.value }))
                      }
                      placeholder="Telefon"
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

              {!buyerIsPrivatePerson && selectedOrgId && (
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-4">
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Powiązane wydarzenie
                  </label>

                  <select
                    value={selectedEventId || ''}
                    onChange={(e) => void handleEventChange(e.target.value || null)}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                  >
                    <option value="">Brak powiązanego wydarzenia</option>

                    {organizationEvents.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.name}
                        {event.event_date
                          ? ` — ${new Date(event.event_date).toLocaleDateString('pl-PL')}`
                          : ''}
                      </option>
                    ))}
                  </select>

                  {organizationEvents.length === 0 && (
                    <div className="mt-2 text-xs text-[#e5e4e2]/50">
                      Brak wydarzeń przypisanych do tej organizacji.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Daty + platnosc */}
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
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data sprzedazy *</label>
                <input
                  type="date"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Termin platnosci (dni) *
                </label>
                <input
                  type="number"
                  value={paymentDays}
                  onChange={(e) => setPaymentDays(parseInt(e.target.value))}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data platnosci</label>
                <input
                  type="text"
                  value={calculatePaymentDueDate()}
                  disabled
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a]/50 px-4 py-3 text-[#e5e4e2]/60"
                />
              </div>
            </div>

            {invoiceType !== 'corrective' && (
              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={includeDefaultFooterNote}
                    onChange={(e) => setIncludeDefaultFooterNote(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-[#d3bb73]/20 text-[#d3bb73]"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[#e5e4e2]">Dodaj notę płatniczą</div>
                    <div className="mt-1 text-xs text-[#e5e4e2]/60">
                      Nota zostanie zapisana na fakturze i pokazana w PDF.
                    </div>
                  </div>
                </label>

                {includeDefaultFooterNote && (
                  <textarea
                    value={customFooterNote}
                    onChange={(e) => setCustomFooterNote(e.target.value)}
                    rows={3}
                    className="mt-3 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="Treść noty na fakturze"
                  />
                )}
              </div>
            )}

            {/* Metoda platnosci + miejsce */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Metoda platnosci *</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Miejsce wystawienia</label>
                <input
                  type="text"
                  value={issuePlace}
                  onChange={(e) => setIssuePlace(e.target.value)}
                  placeholder="np. Warszawa"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                />
              </div>
            </div>
            {invoiceStatus === 'paid' && (
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4">
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data opłacenia *</label>
                <input
                  type="date"
                  value={paidDate}
                  onChange={(e) => setPaidDate(e.target.value)}
                  className="w-full rounded-lg border border-green-500/30 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                />

                <div className="mt-3 rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-400">
                  Faktura opłacona. Do zapłaty: 0.00 zł
                </div>
              </div>
            )}

            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-4">
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Status płatności
              </label>

              <select
                value={paymentStatus}
                onChange={(e) => {
                  const nextStatus = e.target.value as
                    | 'unpaid'
                    | 'partially_paid'
                    | 'paid';
                  setPaymentStatus(nextStatus);

                  if (nextStatus === 'unpaid') {
                    setPaidAmount(0);
                  }

                  if (nextStatus === 'paid') {
                    setPaidAmount(displayedTotals.totalGross);
                    setPaidDate(
                      (prev) => prev || issueDate || new Date().toISOString().split('T')[0],
                    );
                  }
                }}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
              >
                <option value="unpaid">Do zapłaty</option>
                <option value="partially_paid">Częściowo zapłacono</option>
                <option value="paid">Zapłacono</option>
              </select>

              {paymentStatus !== 'unpaid' && (
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data płatności</label>
                    <input
                      type="date"
                      value={paidDate}
                      onChange={(e) => setPaidDate(e.target.value)}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kwota zapłacona</label>
                    <input
                      type="number"
                      step="0.01"
                      value={paidAmount}
                      onChange={(e) => setPaidAmount(Number(e.target.value.replace(',', '.')) || 0)}
                      disabled={paymentStatus === 'paid'}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] disabled:opacity-60"
                    />
                  </div>
                </div>
              )}

              <div className="mt-4 rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a]/50 p-3 text-sm">
                <span className="text-[#e5e4e2]/50">Do zapłaty:</span>
                <span className="ml-2 font-medium text-[#d3bb73]">
                  {Math.max(displayedTotals.totalGross - paidAmount, 0).toFixed(2)} zł
                </span>
              </div>
            </div>

            {invoiceType === 'advance' && (
              <div className="rounded-lg border border-blue-500/25 bg-blue-500/10 p-4">
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Wysokość zaliczki *
                </label>
                <div className="grid gap-4 md:grid-cols-[220px_1fr] md:items-center">
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
                  <p className="text-sm text-[#e5e4e2]/60">
                    Pozycje opisują pełne zamówienie. Kwota zaliczki jest zapisywana osobno.
                  </p>
                </div>
              </div>
            )}

            {/* Pozycje */}
            <div className="border-t border-[#d3bb73]/10 pt-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-medium text-[#e5e4e2]">Pozycje faktury</h3>
                <button
                  onClick={addItem}
                  className="flex items-center gap-2 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj pozycje
                </button>
              </div>

              <div className="space-y-4">
                {items.map((item, index) => {
                  const { valueNet, vatAmount, valueGross } = calculateItemValues(item);

                  const vatRate = Number(item.vat_rate ?? 0);
                  const priceNet = Number(item.price_net ?? 0);
                  const priceGross = grossFromNet(priceNet, vatRate);

                  return (
                    <div
                      key={index}
                      className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4"
                    >
                      <div className="flex items-start gap-4">
                        <div className="grid flex-1 grid-cols-7 gap-4">
                          <div className="col-span-2">
                            <label className="mb-1 block text-xs text-[#e5e4e2]/40">Nazwa *</label>
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
                              <option value="usl.">usl.</option>
                              <option value="m">m</option>
                              <option value="m2">m2</option>
                              <option value="kg">kg</option>
                            </select>
                          </div>

                          <div>
                            <label className="mb-1 block text-xs text-[#e5e4e2]/40">Ilosc *</label>
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
                              value={priceNet}
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
                                const nextVatCode = e.target.value as InvoiceItem['vat_code'];
                                const nextVatRate = ['23', '8', '5', '0'].includes(nextVatCode)
                                  ? Number(nextVatCode)
                                  : 0;
                                const currentGross = grossFromNet(priceNet, vatRate);

                                updateItem(index, 'vat_code', nextVatCode);
                                updateItem(index, 'vat_rate', nextVatRate);
                                updateItem(
                                  index,
                                  'price_net',
                                  netFromGross(currentGross, nextVatRate),
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

                      {invoiceType === 'corrective' && item.before_quantity != null && (
                        <div className="mt-3 rounded border border-orange-500/15 bg-orange-500/5 px-3 py-2 text-xs text-orange-200/75">
                          Przed korektą: {Number(item.before_quantity).toFixed(2)} {item.unit} ×{' '}
                          {Number(item.before_price_net ?? 0).toFixed(2)} zł netto. Pola powyżej
                          przedstawiają stan po korekcie.
                        </div>
                      )}

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
                            className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                          />
                        </div>
                      )}

                      <div className="mt-3 grid grid-cols-3 gap-4 border-t border-[#d3bb73]/10 pt-3 text-sm">
                        <div>
                          <span className="text-[#e5e4e2]/40">Wartosc netto:</span>
                          <span className="ml-2 text-[#e5e4e2]">{valueNet.toFixed(2)} zl</span>
                        </div>

                        <div>
                          <span className="text-[#e5e4e2]/40">Kwota VAT:</span>
                          <span className="ml-2 text-[#e5e4e2]">{vatAmount.toFixed(2)} zl</span>
                        </div>

                        <div>
                          <span className="text-[#e5e4e2]/40">Wartosc brutto:</span>
                          <span className="ml-2 font-medium text-[#d3bb73]">
                            {valueGross.toFixed(2)} zl
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Podsumowanie */}
            <div className="border-t border-[#d3bb73]/10 pt-6">
              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-6">
                <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Podsumowanie</h3>
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <div className="mb-1 text-sm text-[#e5e4e2]/60">Suma netto</div>
                    <div className="text-2xl font-light text-[#e5e4e2]">
                      {displayedTotals.totalNet.toFixed(2)} zl
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-sm text-[#e5e4e2]/60">Suma VAT</div>
                    <div className="text-2xl font-light text-[#e5e4e2]">
                      {displayedTotals.totalVat.toFixed(2)} zl
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-sm text-[#e5e4e2]/60">Suma brutto</div>
                    <div className="text-2xl font-medium text-[#d3bb73]">
                      {paymentStatus === 'paid' ? '0.00' : displayedTotals.totalGross.toFixed(2)} zl
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {paymentStatus !== 'unpaid' && (
              <div className="mt-4 border-t border-[#d3bb73]/10 pt-4 text-sm">
                <div className="text-[#e5e4e2]/60">
                  Zapłacono: <span className="text-green-400">{paidAmount.toFixed(2)} zł</span>
                </div>
                <div className="mt-1 text-[#e5e4e2]/60">
                  Do zapłaty:{' '}
                  <span className="font-medium text-[#d3bb73]">
                    {Math.max(totals.totalGross - paidAmount, 0).toFixed(2)} zł
                  </span>
                </div>
              </div>
            )}

            {/* Przyciski */}
            <div className="flex justify-end gap-4 pt-6">
              <button
                onClick={() => router.back()}
                className="rounded-lg border border-[#d3bb73]/20 px-6 py-3 text-[#e5e4e2] hover:bg-[#d3bb73]/5"
              >
                Anuluj
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                <Save className="h-5 w-5" />
                {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
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
