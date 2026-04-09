'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import BuyerSearchInput from './components/BuyerSearchInput';
import AddBuyerModal from './components/AddBuyerModal';
import InvoiceNumberInput from './components/InvoiceNumberInput';

interface Organization {
  id: string;
  name: string;
  nip: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  client_type?: string;
}

interface MyCompany {
  id: string;
  name: string;
  legal_name: string;
  nip: string;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  email: string | null;
  phone: string | null;
  bank_account: string | null;
  is_default: boolean;
}

interface InvoiceItem {
  position_number: number;
  name: string;
  unit: string;
  quantity: number;
  price_net: number;
  vat_rate: number;
}

export default function NewInvoicePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const eventId = searchParams.get('event');

  const [loading, setLoading] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [myCompanies, setMyCompanies] = useState<MyCompany[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [settings, setSettings] = useState<any>(null);
  const [showAddBuyerModal, setShowAddBuyerModal] = useState(false);

  const [invoiceType, setInvoiceType] = useState<'vat' | 'proforma' | 'advance' | 'corrective'>(
    'vat',
  );
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentDays, setPaymentDays] = useState(14);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [items, setItems] = useState<InvoiceItem[]>([
    { position_number: 1, name: '', unit: 'szt.', quantity: 1, price_net: 0, vat_rate: 23 },
  ]);
  const [simplifiedInvoice, setSimplifiedInvoice] = useState(false);
  const [simplifiedServiceName, setSimplifiedServiceName] = useState('Obsługa muzyczna');

  useEffect(() => {
    fetchData();
  }, [eventId]);

  const fetchData = async () => {
    try {
      const [settingsRes, businessClientsRes, companiesRes] = await Promise.all([
        supabase.rpc('get_invoice_settings_for_creation'),
        supabase.rpc('get_business_clients'),
        supabase
          .from('my_companies')
          .select('*')
          .eq('is_active', true)
          .order('is_default', { ascending: false }),
      ]);

      if (settingsRes.error) {
        console.error('Error fetching invoice settings:', settingsRes.error);
        throw new Error(
          'Brak uprawnień do tworzenia faktur. Wymagane: invoices_manage lub finances_manage',
        );
      }

      if (settingsRes.data && settingsRes.data.length > 0) setSettings(settingsRes.data[0]);
      if (businessClientsRes.data) {
        const formattedClients = businessClientsRes.data.map((client: any) => ({
          id: client.id,
          name: client.name,
          nip: client.nip,
          street: client.address,
          postal_code: client.postal_code,
          city: client.city,
          client_type: client.client_type,
        }));
        setOrganizations(formattedClients);
      }

      if (companiesRes.data) {
        setMyCompanies(companiesRes.data);
        const defaultCompany = companiesRes.data.find((c: MyCompany) => c.is_default);
        if (defaultCompany) {
          setSelectedCompanyId(defaultCompany.id);
        } else if (companiesRes.data.length > 0) {
          setSelectedCompanyId(companiesRes.data[0].id);
        }
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
            'Uwaga: Ten klient nie ma uzupelnionego NIP. Nie bedzie mozna zapisac faktury.',
            'warning',
          );
        }

        if (financialInfo?.accepted_offer_id) {
          const { data: offerData } = await supabase
            .from('offers')
            .select(`
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
            `)
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
              `Pozycje wypelnione z oferty ${financialInfo.accepted_offer_number}: ${totalBrutto.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zl brutto`,
              'success',
            );
          }
        } else if (eventRes.data) {
          setItems([
            {
              position_number: 1,
              name: `Obsluga techniczna - ${eventRes.data.name}`,
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

  const calculatePaymentDueDate = () => {
    const date = new Date(issueDate);
    date.setDate(date.getDate() + paymentDays);
    return date.toISOString().split('T')[0];
  };

  const calculateItemValues = (item: InvoiceItem) => {
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

  const handleSubmit = async () => {
    if (!selectedCompanyId) {
      showSnackbar('Wybierz firmę wystawiającą fakturę', 'error');
      return;
    }

    if (!selectedOrgId) {
      showSnackbar('Wybierz nabywcę', 'error');
      return;
    }

    if (!invoiceNumber) {
      showSnackbar('Numer faktury jest wymagany', 'error');
      return;
    }

    if (items.some((item) => !item.name || item.price_net <= 0)) {
      showSnackbar('Wypełnij wszystkie pozycje faktury', 'error');
      return;
    }

    try {
      setLoading(true);

      const selectedOrg = organizations.find((o) => o.id === selectedOrgId);
      if (!selectedOrg) throw new Error('Organization not found');

      const selectedCompany = myCompanies.find((c) => c.id === selectedCompanyId);
      if (!selectedCompany) throw new Error('Company not found');

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: employee } = await supabase
        .from('employees')
        .select('id')
        .eq('email', user?.email)
        .maybeSingle();

      const missingSellerFields: string[] = [];
      if (!selectedCompany.legal_name) missingSellerFields.push('nazwa firmy');
      if (!selectedCompany.nip) missingSellerFields.push('NIP');
      if (!selectedCompany.address) missingSellerFields.push('adres (ulica)');
      if (!selectedCompany.postal_code) missingSellerFields.push('kod pocztowy');
      if (!selectedCompany.city) missingSellerFields.push('miasto');

      if (missingSellerFields.length > 0) {
        showSnackbar(
          `Uzupelnij dane firmy wystawiajacej: ${missingSellerFields.join(', ')}. Przejdz do Ustawienia > Moje firmy.`,
          'error',
        );
        setLoading(false);
        return;
      }

      if (!selectedOrg.nip) {
        showSnackbar('Nabywca nie ma uzupelnionego NIP. Uzupelnij dane kontrahenta.', 'error');
        setLoading(false);
        return;
      }

      const invoiceData = {
        invoice_number: invoiceNumber,
        invoice_type: invoiceType === 'proforma' ? 'vat' : invoiceType,
        is_proforma: invoiceType === 'proforma',
        status: invoiceType === 'proforma' ? 'proforma' : 'draft',
        issue_date: issueDate,
        sale_date: saleDate,
        payment_due_date: calculatePaymentDueDate(),
        event_id: eventId || null,
        organization_id: selectedOrgId,
        my_company_id: selectedCompanyId,
        seller_name: selectedCompany.legal_name,
        seller_nip: selectedCompany.nip,
        seller_street: selectedCompany.address || '',
        seller_postal_code: selectedCompany.postal_code || '',
        seller_city: selectedCompany.city || '',
        seller_country: 'Polska',
        buyer_name: selectedOrg.name,
        buyer_nip: selectedOrg.nip,
        buyer_street: selectedOrg.street || '',
        buyer_postal_code: selectedOrg.postal_code || '',
        buyer_city: selectedOrg.city || '',
        buyer_country: 'Polska',
        payment_method: settings?.default_payment_method || 'Przelew',
        bank_account: selectedCompany.bank_account || '',
        issue_place: selectedCompany.city || '',
        created_by: employee?.id,
      };

      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert(invoiceData)
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      // Użyj uproszczonych pozycji jeśli checkbox zaznaczony
      const finalItems = getItemsForInvoice();

      const itemsToInsert = finalItems.map((item) => {
        const { valueNet, vatAmount, valueGross } = calculateItemValues(item);
        return {
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
      });

      const { error: itemsError } = await supabase.from('invoice_items').insert(itemsToInsert);

      if (itemsError) throw itemsError;

      await supabase.from('invoice_history').insert({
        invoice_id: invoice.id,
        action: 'created',
        changed_by: employee?.id,
        changes: { invoice_type: invoiceType },
      });

      showSnackbar('Faktura została utworzona', 'success');
      router.push(`/crm/invoices/${invoice.id}`);
    } catch (err: any) {
      console.error('Error creating invoice:', err);
      let msg = 'Blad podczas tworzenia faktury';
      if (err?.code === '23502') {
        const col = err.message?.match(/column "(.+?)"/)?.[1] || '';
        const fieldMap: Record<string, string> = {
          seller_street: 'adres sprzedawcy',
          seller_city: 'miasto sprzedawcy',
          seller_postal_code: 'kod pocztowy sprzedawcy',
          seller_nip: 'NIP sprzedawcy',
          seller_name: 'nazwa sprzedawcy',
          buyer_nip: 'NIP nabywcy',
          buyer_name: 'nazwa nabywcy',
          buyer_street: 'adres nabywcy',
          buyer_city: 'miasto nabywcy',
          invoice_number: 'numer faktury',
        };
        const fieldName = fieldMap[col] || col;
        msg = `Brakuje wymaganego pola: ${fieldName}. Uzupelnij dane i sprobuj ponownie.`;
      } else if (err?.code === '23505') {
        msg = 'Faktura o tym numerze juz istnieje. Wybierz inny numer.';
      } else if (err?.message) {
        msg = err.message;
      }
      showSnackbar(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const totals = calculateTotals();

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

          <div className="space-y-6">
            <div className="mb-6 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/5 p-4">
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Firma wystawiająca fakturę *
              </label>
              <select
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              >
                <option value="">Wybierz firmę...</option>
                {myCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name} - NIP: {company.nip}
                    {company.is_default && ' (domyślna)'}
                  </option>
                ))}
              </select>
              {selectedCompanyId && (
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
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
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
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6">
              <BuyerSearchInput
                contacts={organizations}
                selectedContactId={selectedOrgId}
                onContactSelect={setSelectedOrgId}
                onAddNew={() => setShowAddBuyerModal(true)}
              />
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
            </div>

            <div className="border-t border-[#d3bb73]/10 pt-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-medium text-[#e5e4e2]">Pozycje faktury</h3>
                <button
                  onClick={addItem}
                  className="flex items-center gap-2 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj pozycję
                </button>
              </div>

              {/* Checkbox uproszczonej faktury */}
              {items.length > 1 && (
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
                        Np. zamiast "DJ Standard 2500 zł + Konferansjer 3000 zł" → "Obsługa muzyczna
                        5500 zł"
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-4">
                {items.map((item, index) => {
                  const { valueNet, vatAmount, valueGross } = calculateItemValues(item);
                  return (
                    <div
                      key={index}
                      className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4"
                    >
                      <div className="flex items-start gap-4">
                        <div className="grid flex-1 grid-cols-6 gap-4">
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
                              <option value="usł.">usł.</option>
                              <option value="m">m</option>
                              <option value="m2">m2</option>
                              <option value="kg">kg</option>
                            </select>
                          </div>

                          <div>
                            <label className="mb-1 block text-xs text-[#e5e4e2]/40">Ilość *</label>
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
                            <label className="mb-1 block text-xs text-[#e5e4e2]/40">VAT %</label>
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
                          <span className="ml-2 text-[#e5e4e2]">{vatAmount.toFixed(2)} zł</span>
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
                <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Podsumowanie</h3>

                {simplifiedInvoice && items.length > 1 && (
                  <div className="mb-4 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
                    <div className="mb-2 text-xs font-medium text-blue-400">
                      📄 Podgląd uproszczonej faktury:
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
                    <div className="mb-1 text-sm text-[#e5e4e2]/60">Suma netto</div>
                    <div className="text-2xl font-light text-[#e5e4e2]">
                      {totals.totalNet.toFixed(2)} zł
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-sm text-[#e5e4e2]/60">Suma VAT</div>
                    <div className="text-2xl font-light text-[#e5e4e2]">
                      {totals.totalVat.toFixed(2)} zł
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-sm text-[#e5e4e2]/60">Suma brutto</div>
                    <div className="text-2xl font-medium text-[#d3bb73]">
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
