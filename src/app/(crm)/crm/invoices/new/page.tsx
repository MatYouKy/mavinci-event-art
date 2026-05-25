'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import BuyerSearchInput from './components/BuyerSearchInput';
import AddBuyerModal from './components/AddBuyerModal';
import InvoiceNumberInput from './components/InvoiceNumberInput';
import { MyCompany } from '../../settings/my-companies/page';

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
  before_quantity?: number;
  before_price_net?: number;
  after_quantity?: number;
  after_price_net?: number;
}

export default function NewInvoicePage() {
  const router = useRouter();
  const {
    employee: currentEmployee,
    isAdmin,
    loading: employeeLoading,
    canManageModule,
  } = useCurrentEmployee();
  const canManageInvoices = canManageModule('invoices');
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const eventId = searchParams.get('event');
  const urlType = searchParams.get('type');
  const urlRelated = searchParams.get('related');

  const [loading, setLoading] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [myCompanies, setMyCompanies] = useState<MyCompany[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [settings, setSettings] = useState<any>(null);
  const [showAddBuyerModal, setShowAddBuyerModal] = useState(false);
  const [includeDefaultFooterNote, setIncludeDefaultFooterNote] = useState(true);

  const [invoiceType, setInvoiceType] = useState<'vat' | 'proforma' | 'advance' | 'corrective'>(
    urlType === 'corrective' ? 'corrective' : 'vat',
  );
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentDays, setPaymentDays] = useState(7);
  const [paymentMethod, setPaymentMethod] = useState<'Przelew' | 'Gotówka' | 'Karta' | 'BLIK'>(
    'Przelew',
  );
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [items, setItems] = useState<InvoiceItem[]>([
    { position_number: 1, name: '', unit: 'szt.', quantity: 1, price_net: 0, vat_rate: 23 },
  ]);
  const [simplifiedInvoice, setSimplifiedInvoice] = useState(false);
  const [simplifiedServiceName, setSimplifiedServiceName] = useState('Obsługa muzyczna');

  const [correctionReason, setCorrectionReason] = useState('');
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
    if (employeeLoading) return;
    fetchData();
  }, [eventId, employeeLoading]);

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
          sortedItems.map((item: any) => ({
            position_number: item.position_number,
            name: item.name,
            unit: item.unit,
            quantity: Number(item.quantity),
            price_net: Number(item.price_net),
            vat_rate: item.vat_rate,
            before_quantity: Number(item.quantity),
            before_price_net: Number(item.price_net),
            after_quantity: Number(item.quantity),
            after_price_net: Number(item.price_net),
          })),
        );
      }
    }
  };

  const fetchData = async () => {
    try {
      const [settingsRes, businessClientsRes, companiesRes, allInvoicesRes, individualContactsRes] =
        await Promise.all([
          supabase.rpc('get_invoice_settings_for_creation'),
          supabase.rpc('get_business_clients'),
          supabase
            .from('my_companies')
            .select('*')
            .eq('is_active', true)
            .order('is_default', { ascending: false }),
          supabase
            .from('invoices')
            .select(
              'id, invoice_number, invoice_type, issue_date, total_gross, buyer_name, status, my_company_id',
            )
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
          } else if (!canManageInvoices) {
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

      if (eventId) {
        const [eventRes, financialInfoRes] = await Promise.all([
          supabase
            .from('events')
            .select('name, event_date, organization_id, contact_person_id')
            .eq('id', eventId)
            .maybeSingle(),
          supabase.rpc('get_event_financial_info', { p_event_id: eventId }),
        ]);

        if (eventRes.data) {
          if (eventRes.data.organization_id) {
            setSelectedOrgId(eventRes.data.organization_id);
          }

          if (eventRes.data.event_date) {
            setSaleDate(eventRes.data.event_date.split('T')[0]);
          }
        }

        const financialInfo = financialInfoRes.data?.[0];

        if (financialInfo && !financialInfo.can_invoice) {
          showSnackbar(
            'Uwaga: Ten klient nie ma uzupełnionego NIP. Nie będzie można zapisać faktury.',
            'warning',
          );
        }

        if (financialInfo?.accepted_offer_id) {
          const { data: offerData } = await supabase
            .from('offers')
            .select(
              `
              tax_percent,
              offer_items (
                name,
                quantity,
                unit,
                unit_price,
                discount_percent,
                total,
                display_order
              )
            `,
            )
            .eq('id', financialInfo.accepted_offer_id)
            .maybeSingle();

          if (offerData?.offer_items && offerData.offer_items.length > 0) {
            const vatRate = offerData.tax_percent ?? 23;

            const sortedItems = [...offerData.offer_items].sort(
              (a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0),
            );

            setItems(
              sortedItems.map((oi: any, idx: number) => ({
                position_number: idx + 1,
                name: oi.name || '',
                unit: oi.unit || 'szt.',
                quantity: oi.quantity ?? 1,
                price_net: Number(oi.total ?? 0) / Math.max(oi.quantity ?? 1, 1),
                vat_rate: vatRate,
              })),
            );

            const totalNetto = sortedItems.reduce(
              (sum: number, oi: any) => sum + Number(oi.total ?? 0),
              0,
            );

            const totalBrutto = totalNetto * (1 + vatRate / 100);

            showSnackbar(
              `Pozycje wypełnione z oferty ${financialInfo.accepted_offer_number}: ${totalBrutto.toLocaleString(
                'pl-PL',
                { minimumFractionDigits: 2 },
              )} zł brutto`,
              'success',
            );
          }
        } else if (eventRes.data) {
          setItems([
            {
              position_number: 1,
              name: `Obsługa techniczna - ${eventRes.data.name}`,
              unit: 'szt.',
              quantity: 1,
              price_net: 0,
              vat_rate: 23,
            },
          ]);
        }
      }
    } catch (err: any) {
      console.error('Error fetching data:', err);
      showSnackbar(err.message || 'Błąd podczas ładowania danych', 'error');
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
    if (isCashPayment) return issueDate;
    const date = new Date(issueDate);
    date.setDate(date.getDate() + paymentDays);
    return date.toISOString().split('T')[0];
  };

  const calculateItemValues = (item: InvoiceItem) => {
    if (invoiceType === 'corrective' && item.before_quantity != null && item.before_price_net != null) {
      const beforeNet = item.before_quantity * item.before_price_net;
      const afterNet = (item.after_quantity ?? item.before_quantity) * (item.after_price_net ?? item.before_price_net);
      const diffNet = afterNet - beforeNet;
      const diffVat = Math.round(diffNet * item.vat_rate) / 100;
      const diffGross = diffNet + diffVat;
      return { valueNet: diffNet, vatAmount: diffVat, valueGross: diffGross };
    }
    const valueNet = item.quantity * item.price_net;
    const vatAmount = Math.round(valueNet * item.vat_rate) / 100;
    const valueGross = valueNet + vatAmount;
    return { valueNet, vatAmount, valueGross };
  };

  const calculateTotals = () => {
    let totalNet = 0;
    let totalVat = 0;
    let totalGross = 0;

    items.forEach((item) => {
      const { valueNet, vatAmount, valueGross } = calculateItemValues(item);
      totalNet += valueNet;
      totalVat += vatAmount;
      totalGross += valueGross;
    });

    return { totalNet, totalVat, totalGross };
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

  const getItemsForInvoice = () => {
    if (!simplifiedInvoice || items.length <= 1) {
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
        vat_rate: 23,
      },
    ];
  };

  const handleBuyerAdded = async (buyerId: string) => {
    setSelectedOrgId(buyerId);
    await fetchData();
  };

  const buildInvoiceFooterText = (selectedCompany: MyCompany) => {
    if (invoiceType === 'corrective') {
      const issueDateText = correctedInvoiceIssueDate
        ? new Date(correctedInvoiceIssueDate).toLocaleDateString('pl-PL')
        : 'brak daty';

      return `Faktura korygująca odnosi się do faktury ${correctedInvoiceNumber || '-'} z dnia ${issueDateText}. <br />Przyczyna korekty: ${correctionReason || '-'}.`;
    }

    if (includeDefaultFooterNote) {
      return selectedCompany.invoice_footer_text || '';
    }

    return null;
  };

  const handleSubmit = async () => {
    if (!selectedCompanyId) {
      showSnackbar('Wybierz firmę wystawiającą fakturę', 'error');
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
      showSnackbar('Wybierz nabywcę', 'error');
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
    } else if (items.some((item) => !item.name.trim() || item.price_net === 0)) {
      showSnackbar('Wypełnij wszystkie pozycje faktury', 'error');
      return;
    }

    try {
      setLoading(true);

      const normalizedInvoiceNumber = invoiceNumber.trim();

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

      const selectedOrg = buyerIsPrivatePerson
        ? null
        : organizations.find((o) => o.id === selectedOrgId);

      if (!buyerIsPrivatePerson && !selectedOrg) {
        throw new Error('Organization not found');
      }

      const selectedCompany = myCompanies.find((c) => c.id === selectedCompanyId);
      if (!selectedCompany) throw new Error('Company not found');

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

      const footerNote = buildInvoiceFooterText(selectedCompany);

      const website = selectedCompany.website || 'www.mavinci.pl';

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

      if (!buyerIsPrivatePerson && !selectedOrg.nip) {
        showSnackbar(
          'Nabywca nie ma uzupełnionego NIP. Uzupełnij dane kontrahenta albo zaznacz fakturę dla osoby prywatnej.',
          'error',
        );
        setLoading(false);
        return;
      }

      const invoiceData = {
        buyer_is_private_person: buyerIsPrivatePerson,
        invoice_number: normalizedInvoiceNumber,
        invoice_type: invoiceType,
        is_proforma: invoiceType === 'proforma',
        status: invoiceType === 'proforma' ? 'proforma' : 'draft',
        footer_note: footerNote,
        signature_name: signatureName,
        website,
        issue_date: issueDate,
        sale_date: saleDate,
        payment_due_date: calculatePaymentDueDate(),
        event_id: eventId || null,
        organization_id: buyerIsPrivatePerson ? null : selectedOrgId,

        buyer_name: buyerIsPrivatePerson
          ? `${privateBuyer.firstName} ${privateBuyer.lastName}`.trim()
          : selectedOrg!.name,

        buyer_nip: buyerIsPrivatePerson ? null : selectedOrg!.nip,

        buyer_street: buyerIsPrivatePerson ? privateBuyer.street : selectedOrg!.street || '',

        buyer_postal_code: buyerIsPrivatePerson
          ? privateBuyer.postalCode
          : selectedOrg!.postal_code || '',

        buyer_city: buyerIsPrivatePerson ? privateBuyer.city : selectedOrg!.city || '',

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
        issue_place: selectedCompany.city,
        company_logo_url: selectedCompany.logo_url || null,
        created_by: employee?.id,
        ...(invoiceType === 'corrective'
          ? {
              related_invoice_id: relatedInvoiceId || null,
              correction_reason: correctionReason,
              correction_scope: correctionScope,
              corrected_invoice_number: correctedInvoiceNumber,
              corrected_invoice_issue_date: correctedInvoiceIssueDate || null,
              corrected_invoice_ksef_number: correctedInvoiceKsefNumber || null,
              corrected_invoice_was_in_ksef: correctedInvoiceWasInKsef,
            }
          : {}),
      };

      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert(invoiceData)
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      const finalItems = getItemsForInvoice();

      const itemsToInsert = finalItems.map((item) => {
        const { valueNet, vatAmount, valueGross } = calculateItemValues(item);

        const base: any = {
          invoice_id: invoice.id,
          position_number: item.position_number,
          name: item.name,
          unit: item.unit,
          quantity: item.quantity,
          price_net: item.price_net,
          vat_rate: item.vat_rate,
          value_net: valueNet,
          vat_amount: vatAmount,
          value_gross: valueGross,
        };

        if (invoiceType === 'corrective' && item.before_quantity != null) {
          const beforeNet = item.before_quantity * (item.before_price_net ?? 0);
          const beforeVat = Math.round(beforeNet * item.vat_rate) / 100;
          const beforeGross = beforeNet + beforeVat;

          const afterQty = item.after_quantity ?? item.before_quantity;
          const afterPrice = item.after_price_net ?? item.before_price_net ?? 0;
          const afterNet = afterQty * afterPrice;
          const afterVat = Math.round(afterNet * item.vat_rate) / 100;
          const afterGross = afterNet + afterVat;

          base.before_quantity = item.before_quantity;
          base.before_price_net = item.before_price_net;
          base.before_value_net = beforeNet;
          base.before_vat_amount = beforeVat;
          base.before_value_gross = beforeGross;
          base.after_quantity = afterQty;
          base.after_price_net = afterPrice;
          base.after_value_net = afterNet;
          base.after_vat_amount = afterVat;
          base.after_value_gross = afterGross;
          base.quantity = afterQty;
          base.price_net = afterPrice;
        }

        return base;
      });

      const { error: itemsError } = await supabase.from('invoice_items').insert(itemsToInsert);

      if (itemsError) throw itemsError;

      await supabase.from('invoice_history').insert({
        invoice_id: invoice.id,
        action: 'created',
        changed_by: employee?.id,
        changes: {
          invoice_type: invoiceType,
          my_company_id: selectedCompanyId,
          invoice_number: normalizedInvoiceNumber,
        },
      });

      showSnackbar('Faktura została utworzona', 'success');
      router.push(`/crm/invoices/${invoice.id}`);
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

  const totals = calculateTotals();
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
          <h1 className="mb-8 text-2xl font-light text-[#e5e4e2]">Wystaw fakturę VAT</h1>
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
                disabled={invoiceType === 'corrective' && !!relatedInvoiceId}
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
                  disabled={urlType === 'corrective' && !!urlRelated}
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
              {invoiceType === 'corrective' && relatedInvoiceId ? (
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
                  onContactSelect={setSelectedOrgId}
                  onAddNew={() => setShowAddBuyerModal(true)}
                />
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

              {!isCashPayment ? (
                <>
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                      Termin płatności (dni) *
                    </label>
                    <input
                      type="number"
                      value={paymentDays}
                      onChange={(e) => setPaymentDays(parseInt(e.target.value))}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data płatności</label>
                    <input
                      type="text"
                      value={calculatePaymentDueDate()}
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
                    onChange={(e) => setIncludeDefaultFooterNote(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-[#d3bb73]/20 text-[#d3bb73]"
                  />
                  <div>
                    <div className="text-sm font-medium text-[#e5e4e2]">
                      Dodaj standardową notę płatniczą
                    </div>
                    <div className="mt-1 text-xs text-[#e5e4e2]/60">
                      Nota zostanie zapisana na fakturze i pokazana w PDF.
                    </div>
                  </div>
                </label>
              </div>
            )}

            <div className="border-t border-[#d3bb73]/10 pt-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-medium text-[#e5e4e2]">
                  {invoiceType === 'corrective' ? 'Pozycje korekty' : 'Pozycje faktury'}
                </h3>
                {invoiceType !== 'corrective' && (
                  <button
                    onClick={addItem}
                    className="flex items-center gap-2 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                  >
                    <Plus className="h-4 w-4" />
                    Dodaj pozycję
                  </button>
                )}
              </div>

              {invoiceType === 'corrective' && items.length > 0 && (
                <div className="mb-4 rounded-lg border border-orange-500/20 bg-orange-500/5 p-3 text-sm text-orange-300">
                  Edytuj kolumnę &bdquo;Po korekcie&rdquo; aby zmienić wartości. Kolumna
                  &bdquo;Przed&rdquo; jest tylko do odczytu. Róznica zostanie obliczona
                  automatycznie.
                </div>
              )}

              {/* Checkbox uproszczonej faktury */}
              {invoiceType !== 'corrective' && items.length > 1 && (
                <div className="mb-4 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={simplifiedInvoice}
                      onChange={(e) => setSimplifiedInvoice(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-[#d3bb73]/20 text-[#d3bb73] focus:ring-[#d3bb73]"
                    />
                    <div className="flex-1">
                      <div className="mb-1 text-sm font-medium text-[#e5e4e2]">
                        Uproszczona faktura (jedna pozycja)
                      </div>
                      <div className="text-xs text-[#e5e4e2]/60">
                        Wszystkie pozycje zostaną zsumowane w jedną z własną nazwą usługi
                      </div>
                    </div>
                  </label>

                  {simplifiedInvoice && (
                    <div className="mt-3">
                      <label className="mb-2 block text-xs text-[#e5e4e2]/60">
                        Nazwa usługi na fakturze *
                      </label>
                      <input
                        type="text"
                        value={simplifiedServiceName}
                        onChange={(e) => setSimplifiedServiceName(e.target.value)}
                        placeholder="np. Obsługa muzyczna"
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-sm text-[#e5e4e2]"
                      />
                      <div className="mt-2 text-xs text-blue-400">
                        {`Np. zamiast "DJ Standard 2500 zł + Konferansjer 3000 zł" → "Obsługa muzyczna 5500 zł"`}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-4">
                {invoiceType === 'corrective'
                  ? items.map((item, index) => {
                      const { valueNet, vatAmount, valueGross } = calculateItemValues(item);
                      const beforeNet = (item.before_quantity ?? 0) * (item.before_price_net ?? 0);
                      const afterQty = item.after_quantity ?? item.before_quantity ?? 0;
                      const afterPrice = item.after_price_net ?? item.before_price_net ?? 0;
                      const afterNet = afterQty * afterPrice;
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
                              VAT {item.vat_rate}%
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-4">
                            {/* PRZED */}
                            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-3">
                              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/40">
                                Przed korektą
                              </div>
                              <div className="space-y-2">
                                <div>
                                  <span className="text-xs text-[#e5e4e2]/40">Ilość:</span>
                                  <span className="ml-2 text-sm text-[#e5e4e2]/70">
                                    {item.before_quantity ?? 0} {item.unit}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-xs text-[#e5e4e2]/40">Cena netto:</span>
                                  <span className="ml-2 text-sm text-[#e5e4e2]/70">
                                    {(item.before_price_net ?? 0).toFixed(2)} zł
                                  </span>
                                </div>
                                <div className="border-t border-[#d3bb73]/10 pt-2">
                                  <span className="text-xs text-[#e5e4e2]/40">Wartość netto:</span>
                                  <span className="ml-2 text-sm text-[#e5e4e2]/70">
                                    {beforeNet.toFixed(2)} zł
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* PO */}
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
                                    value={item.after_quantity ?? item.before_quantity ?? 0}
                                    onChange={(e) =>
                                      updateItem(index, 'after_quantity' as any, parseFloat(e.target.value) || 0)
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
                                    value={item.after_price_net ?? item.before_price_net ?? 0}
                                    onChange={(e) =>
                                      updateItem(index, 'after_price_net' as any, parseFloat(e.target.value) || 0)
                                    }
                                    className="w-full rounded border border-orange-500/30 bg-[#1c1f33] px-2 py-1.5 text-sm text-[#e5e4e2] focus:border-orange-500 focus:outline-none"
                                  />
                                </div>
                                <div className="border-t border-orange-500/10 pt-2">
                                  <span className="text-xs text-[#e5e4e2]/40">Wartość netto:</span>
                                  <span className="ml-2 text-sm text-[#e5e4e2]">
                                    {afterNet.toFixed(2)} zł
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* RÓŻNICA */}
                            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-3">
                              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[#d3bb73]">
                                Różnica (korekta)
                              </div>
                              <div className="space-y-2">
                                <div>
                                  <span className="text-xs text-[#e5e4e2]/40">Netto:</span>
                                  <span
                                    className={`ml-2 text-sm font-medium ${valueNet < 0 ? 'text-red-400' : valueNet > 0 ? 'text-green-400' : 'text-[#e5e4e2]/50'}`}
                                  >
                                    {valueNet >= 0 ? '+' : ''}
                                    {valueNet.toFixed(2)} zł
                                  </span>
                                </div>
                                <div>
                                  <span className="text-xs text-[#e5e4e2]/40">VAT:</span>
                                  <span
                                    className={`ml-2 text-sm ${vatAmount < 0 ? 'text-red-400' : vatAmount > 0 ? 'text-green-400' : 'text-[#e5e4e2]/50'}`}
                                  >
                                    {vatAmount >= 0 ? '+' : ''}
                                    {vatAmount.toFixed(2)} zł
                                  </span>
                                </div>
                                <div className="border-t border-[#d3bb73]/10 pt-2">
                                  <span className="text-xs text-[#e5e4e2]/40">Brutto:</span>
                                  <span
                                    className={`ml-2 text-sm font-medium ${valueGross < 0 ? 'text-red-400' : valueGross > 0 ? 'text-green-400' : 'text-[#e5e4e2]/50'}`}
                                  >
                                    {valueGross >= 0 ? '+' : ''}
                                    {valueGross.toFixed(2)} zł
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
                      return (
                        <div
                          key={index}
                          className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4"
                        >
                          <div className="flex items-start gap-4">
                            <div className="grid flex-1 grid-cols-6 gap-4">
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
                                  VAT %
                                </label>
                                <select
                                  value={item.vat_rate}
                                  onChange={(e) =>
                                    updateItem(index, 'vat_rate', parseInt(e.target.value))
                                  }
                                  className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                                >
                                  <option value={0}>0%</option>
                                  <option value={5}>5%</option>
                                  <option value={8}>8%</option>
                                  <option value={23}>23%</option>
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

                          <div className="mt-3 grid grid-cols-3 gap-4 border-t border-[#d3bb73]/10 pt-3 text-sm">
                            <div>
                              <span className="text-[#e5e4e2]/40">Wartość netto:</span>
                              <span className="ml-2 text-[#e5e4e2]">{valueNet.toFixed(2)} zł</span>
                            </div>
                            <div>
                              <span className="text-[#e5e4e2]/40">Kwota VAT:</span>
                              <span className="ml-2 text-[#e5e4e2]">
                                {vatAmount.toFixed(2)} zł
                              </span>
                            </div>
                            <div>
                              <span className="text-[#e5e4e2]/40">Wartość brutto:</span>
                              <span className="ml-2 font-medium text-[#d3bb73]">
                                {valueGross.toFixed(2)} zł
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
              </div>
            </div>

            <div className="border-t border-[#d3bb73]/10 pt-6">
              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-6">
                <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">
                  {invoiceType === 'corrective' ? 'Kwota korekty' : 'Podsumowanie'}
                </h3>

                {invoiceType === 'corrective' && (
                  <div className="mb-4 text-xs text-[#e5e4e2]/50">
                    Poniższe wartości to suma różnic między stanem przed i po korekcie.
                  </div>
                )}

                {simplifiedInvoice && items.length > 1 && invoiceType !== 'corrective' && (
                  <div className="mb-4 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                    <div className="mb-2 text-xs font-medium text-blue-400">
                      Podgląd uproszczonej faktury:
                    </div>
                    <div className="text-sm text-[#e5e4e2]">
                      1. {simplifiedServiceName || 'Obsługa muzyczna'} -{' '}
                      {totals.totalNet.toFixed(2)} zł netto
                    </div>
                    <div className="mt-2 text-xs text-[#e5e4e2]/60">
                      Oryginalne pozycje ({items.length}): {items.map((i) => i.name).join(', ')}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <div className="mb-1 text-sm text-[#e5e4e2]/60">
                      {invoiceType === 'corrective' ? 'Korekta netto' : 'Suma netto'}
                    </div>
                    <div className={`text-2xl font-light ${invoiceType === 'corrective' ? (totals.totalNet < 0 ? 'text-red-400' : totals.totalNet > 0 ? 'text-green-400' : 'text-[#e5e4e2]') : 'text-[#e5e4e2]'}`}>
                      {invoiceType === 'corrective' && totals.totalNet >= 0 ? '+' : ''}
                      {totals.totalNet.toFixed(2)} zł
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-sm text-[#e5e4e2]/60">
                      {invoiceType === 'corrective' ? 'Korekta VAT' : 'Suma VAT'}
                    </div>
                    <div className={`text-2xl font-light ${invoiceType === 'corrective' ? (totals.totalVat < 0 ? 'text-red-400' : totals.totalVat > 0 ? 'text-green-400' : 'text-[#e5e4e2]') : 'text-[#e5e4e2]'}`}>
                      {invoiceType === 'corrective' && totals.totalVat >= 0 ? '+' : ''}
                      {totals.totalVat.toFixed(2)} zł
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-sm text-[#e5e4e2]/60">
                      {invoiceType === 'corrective' ? 'Korekta brutto' : 'Suma brutto'}
                    </div>
                    <div className={`text-2xl font-medium ${invoiceType === 'corrective' ? (totals.totalGross < 0 ? 'text-red-400' : totals.totalGross > 0 ? 'text-green-400' : 'text-[#d3bb73]') : 'text-[#d3bb73]'}`}>
                      {invoiceType === 'corrective' && totals.totalGross >= 0 ? '+' : ''}
                      {totals.totalGross.toFixed(2)} zł
                    </div>
                  </div>
                </div>
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
                disabled={loading}
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
