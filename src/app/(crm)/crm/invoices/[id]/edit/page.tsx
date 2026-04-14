'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import BuyerSearchInput from '../../new/components/BuyerSearchInput';
import AddBuyerModal from '../../new/components/AddBuyerModal';
import { MyCompany } from '../../../settings/my-companies/page';

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
}

const PAYMENT_METHODS = ['Przelew', 'Gotówka', 'Karta płatnicza', 'Kompensata'];

export default function EditInvoicePage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [invoice, setInvoice] = useState<any>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [myCompanies, setMyCompanies] = useState<MyCompany[]>([]);
  const [showAddBuyerModal, setShowAddBuyerModal] = useState(false);

  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceType, setInvoiceType] = useState<'vat' | 'proforma' | 'advance' | 'corrective'>('vat');
  const [isProforma, setIsProforma] = useState(false);
  const [issueDate, setIssueDate] = useState('');
  const [saleDate, setSaleDate] = useState('');
  const [paymentDays, setPaymentDays] = useState(14);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Przelew');
  const [issuePlace, setIssuePlace] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [invoiceRes, itemsRes, businessClientsRes, companiesRes] = await Promise.all([
        supabase.from('invoices').select('*').eq('id', params.id).single(),
        supabase
          .from('invoice_items')
          .select('*')
          .eq('invoice_id', params.id)
          .order('position_number'),
        supabase.rpc('get_business_clients'),
        supabase
          .from('my_companies')
          .select('*')
          .eq('is_active', true)
          .order('is_default', { ascending: false }),
      ]);

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
        setIsProforma(inv.is_proforma ?? false);

        if (inv.is_proforma) {
          setInvoiceType('proforma');
        } else if (inv.invoice_type === 'advance') {
          setInvoiceType('advance');
        } else if (inv.invoice_type === 'corrective') {
          setInvoiceType('corrective');
        } else {
          setInvoiceType('vat');
        }

        if (inv.issue_date && inv.payment_due_date) {
          const issueD = new Date(inv.issue_date);
          const dueD = new Date(inv.payment_due_date);
          const days = Math.round((dueD.getTime() - issueD.getTime()) / (1000 * 60 * 60 * 24));
          setPaymentDays(days > 0 ? days : 14);
        }
      }

      if (itemsRes.data) {
        setItems(itemsRes.data);
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

      if (companiesRes.data) {
        setMyCompanies(companiesRes.data);
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

  const calculatePaymentDueDate = () => {
    if (!issueDate) return '';
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

  const handleBuyerAdded = async (buyerId: string) => {
    setSelectedOrgId(buyerId);
    await fetchData();
  };

  const handleSubmit = async () => {
    if (!selectedCompanyId) {
      showSnackbar('Wybierz firme wystawiajaca fakture', 'error');
      return;
    }

    if (!selectedOrgId) {
      showSnackbar('Wybierz nabywce', 'error');
      return;
    }

    if (!invoiceNumber) {
      showSnackbar('Numer faktury jest wymagany', 'error');
      return;
    }

    if (items.some((item) => !item.name || item.price_net <= 0)) {
      showSnackbar('Wypelnij wszystkie pozycje faktury', 'error');
      return;
    }

    try {
      setSaving(true);

      const selectedOrg = organizations.find((o) => o.id === selectedOrgId);
      if (!selectedOrg) throw new Error('Organization not found');

      const selectedCompany = myCompanies.find((c) => c.id === selectedCompanyId);
      if (!selectedCompany) throw new Error('Company not found');

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

      if (!selectedOrg.nip) {
        showSnackbar('Nabywca nie ma uzupelnionego NIP. Uzupelnij dane kontrahenta.', 'error');
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

      const totals = calculateTotals();

      const invoiceData: Record<string, any> = {
        invoice_number: invoiceNumber,
        invoice_type: invoiceType === 'proforma' ? 'vat' : invoiceType,
        is_proforma: invoiceType === 'proforma',
        status: invoice.status === 'issued' ? 'draft' : invoice.status,
        issue_date: issueDate,
        sale_date: saleDate,
        payment_due_date: calculatePaymentDueDate(),
        organization_id: selectedOrgId,
        my_company_id: selectedCompanyId,
        seller_name: selectedCompany.legal_name,
        seller_nip: selectedCompany.nip,
        seller_street: sellerStreet,
        seller_postal_code: selectedCompany.postal_code,
        seller_city: selectedCompany.city,
        seller_email: selectedCompany.email,
        seller_phone: selectedCompany.phone,
        seller_country: 'Polska',
        buyer_name: selectedOrg.name,
        buyer_nip: selectedOrg.nip,
        buyer_street: selectedOrg.street || '',
        buyer_postal_code: selectedOrg.postal_code || '',
        buyer_city: selectedOrg.city || '',
        buyer_country: 'Polska',
        payment_method: paymentMethod,
        bank_name: selectedCompany.bank_name || '',
        bank_account: selectedCompany.bank_account || '',
        issue_place: issuePlace || selectedCompany.city,
        total_net: totals.totalNet,
        total_vat: totals.totalVat,
        total_gross: totals.totalGross,
        updated_at: new Date().toISOString(),
      };

      const { error: invoiceError } = await supabase
        .from('invoices')
        .update(invoiceData)
        .eq('id', params.id);

      if (invoiceError) throw invoiceError;

      await supabase.from('invoice_items').delete().eq('invoice_id', params.id);

      const itemsToInsert = items.map((item) => {
        const { valueNet, vatAmount, valueGross } = calculateItemValues(item);
        return {
          invoice_id: params.id,
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

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data: employee } = await supabase
        .from('employees')
        .select('id')
        .eq('email', user?.email)
        .maybeSingle();

      await supabase.from('invoice_history').insert({
        invoice_id: params.id,
        action: 'edited',
        changed_by: employee?.id,
        changes: { updated_fields: Object.keys(invoiceData) },
      });

      showSnackbar('Faktura zostala zaktualizowana', 'success');
      router.push(`/crm/invoices/${params.id}`);
    } catch (err: any) {
      console.error('Error updating invoice:', err);
      let msg = 'Blad podczas aktualizacji faktury';
      if (err?.code === '23505') {
        msg = 'Faktura o tym numerze juz istnieje. Wybierz inny numer.';
      } else if (err?.message) {
        msg = err.message;
      }
      showSnackbar(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

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

  const totals = calculateTotals();

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="mx-auto max-w-5xl">
        <button
          onClick={() => router.back()}
          className="mb-6 flex items-center gap-2 text-[#e5e4e2]/60 hover:text-[#d3bb73]"
        >
          <ArrowLeft className="h-5 w-5" />
          Powrot
        </button>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8">
          <h1 className="mb-8 text-2xl font-light text-[#e5e4e2]">
            Edytuj fakture {invoice.invoice_number}
          </h1>

          {invoice.status === 'issued' && (
            <div className="mb-6 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="mb-1 text-sm font-medium text-yellow-500">
                    Uwaga: Edycja wystawionej faktury
                  </div>
                  <div className="mb-3 text-xs text-[#e5e4e2]/60">
                    Ta faktura zostala juz wystawiona. Po zapisaniu zmian, faktura zostanie cofnieta do
                    statusu szkic.
                  </div>
                  <button
                    onClick={() => router.back()}
                    className="text-xs text-yellow-500 underline hover:text-yellow-400"
                  >
                    Anuluj i wroc
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-6">
            {/* Firma wystawiajaca */}
            <div className="rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/5 p-4">
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Firma wystawiajaca fakture *
              </label>
              <select
                value={selectedCompanyId}
                onChange={(e) => {
                  setSelectedCompanyId(e.target.value);
                  const company = myCompanies.find((c) => c.id === e.target.value);
                  if (company) {
                    setIssuePlace(company.city);
                  }
                }}
                className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              >
                <option value="">Wybierz firme...</option>
                {myCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name} - NIP: {company.nip}
                    {company.is_default && ' (domyslna)'}
                  </option>
                ))}
              </select>
              {selectedCompanyId && (
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
                  onChange={(e) => setInvoiceType(e.target.value as any)}
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

            {/* Nabywca */}
            <div className="grid grid-cols-1 gap-6">
              <BuyerSearchInput
                contacts={organizations}
                selectedContactId={selectedOrgId}
                onContactSelect={setSelectedOrgId}
                onAddNew={() => setShowAddBuyerModal(true)}
              />
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
                  onChange={(e) => setPaymentDays(parseInt(e.target.value) || 0)}
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
                                updateItem(index, 'quantity', parseFloat(e.target.value) || 0)
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
                                updateItem(index, 'price_net', parseFloat(e.target.value) || 0)
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
                      {totals.totalNet.toFixed(2)} zl
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-sm text-[#e5e4e2]/60">Suma VAT</div>
                    <div className="text-2xl font-light text-[#e5e4e2]">
                      {totals.totalVat.toFixed(2)} zl
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-sm text-[#e5e4e2]/60">Suma brutto</div>
                    <div className="text-2xl font-medium text-[#d3bb73]">
                      {totals.totalGross.toFixed(2)} zl
                    </div>
                  </div>
                </div>
              </div>
            </div>

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
