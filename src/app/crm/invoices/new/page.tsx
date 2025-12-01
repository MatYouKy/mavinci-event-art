'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface Organization {
  id: string;
  name: string;
  nip: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
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
  const [settings, setSettings] = useState<any>(null);

  const [invoiceType, setInvoiceType] = useState<'vat' | 'proforma' | 'advance' | 'corrective'>('vat');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentDays, setPaymentDays] = useState(14);
  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const [items, setItems] = useState<InvoiceItem[]>([
    { position_number: 1, name: '', unit: 'szt.', quantity: 1, price_net: 0, vat_rate: 23 }
  ]);
  const [simplifiedInvoice, setSimplifiedInvoice] = useState(false);
  const [simplifiedServiceName, setSimplifiedServiceName] = useState('Obsługa muzyczna');

  useEffect(() => {
    fetchData();
  }, [eventId]);

  const fetchData = async () => {
    try {
      const [settingsRes, businessClientsRes] = await Promise.all([
        supabase.rpc('get_invoice_settings_for_creation'),
        supabase.rpc('get_business_clients')
      ]);

      if (settingsRes.error) {
        console.error('Error fetching invoice settings:', settingsRes.error);
        throw new Error('Brak uprawnień do tworzenia faktur. Wymagane: invoices_manage lub finances_manage');
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
          client_type: client.client_type
        }));
        setOrganizations(formattedClients);
      }

      if (eventId) {
        const [eventRes, financialInfoRes] = await Promise.all([
          supabase.from('events').select('name, organization_id, contact_person_id').eq('id', eventId).maybeSingle(),
          supabase.rpc('get_event_financial_info', { p_event_id: eventId })
        ]);

        if (eventRes.data && financialInfoRes.data?.[0]) {
          const financialInfo = financialInfoRes.data[0];

          // Auto-wybór nabywcy (organizacja lub kontakt businessowy)
          if (eventRes.data.organization_id) {
            setSelectedOrgId(eventRes.data.organization_id);
          } else if (eventRes.data.contact_person_id && financialInfo.is_business) {
            setSelectedOrgId(eventRes.data.contact_person_id);
          }

          // Auto-wypełnienie kwoty z zaakceptowanej oferty (z budżetu eventu)
          const offerTotal = financialInfo.accepted_offer_total || financialInfo.expected_revenue || 0;
          const priceNet = offerTotal > 0 ? Math.round((offerTotal / 1.23) * 100) / 100 : 0;

          setItems([{
            position_number: 1,
            name: `Obsługa techniczna - ${eventRes.data.name}`,
            unit: 'szt.',
            quantity: 1,
            price_net: priceNet,
            vat_rate: 23
          }]);

          if (priceNet > 0 && financialInfo.accepted_offer_number) {
            showSnackbar(`Kwota została automatycznie wypełniona z oferty ${financialInfo.accepted_offer_number}: ${offerTotal.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł brutto`, 'success');
          } else if (priceNet > 0) {
            showSnackbar(`Kwota została automatycznie wypełniona z budżetu eventu: ${offerTotal.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł brutto`, 'success');
          }

          // Ostrzeżenie jeśli nie można wystawić faktury
          if (!financialInfo.can_invoice) {
            showSnackbar('Uwaga: Ten klient nie ma uzupełnionego NIP. Nie będzie można zapisać faktury.', 'warning');
          }
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

    items.forEach(item => {
      const { valueNet, vatAmount, valueGross } = calculateItemValues(item);
      totalNet += valueNet;
      totalVat += vatAmount;
      totalGross += valueGross;
    });

    return { totalNet, totalVat, totalGross };
  };

  const addItem = () => {
    setItems([...items, {
      position_number: items.length + 1,
      name: '',
      unit: 'szt.',
      quantity: 1,
      price_net: 0,
      vat_rate: 23
    }]);
  };

  const removeItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    newItems.forEach((item, i) => item.position_number = i + 1);
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
    return [{
      position_number: 1,
      name: simplifiedServiceName,
      unit: 'usł.',
      quantity: 1,
      price_net: Math.round(totalNet * 100) / 100,
      vat_rate: 23
    }];
  };

  const handleSubmit = async () => {
    if (!selectedOrgId) {
      showSnackbar('Wybierz nabywcę', 'error');
      return;
    }

    if (items.some(item => !item.name || item.price_net <= 0)) {
      showSnackbar('Wypełnij wszystkie pozycje faktury', 'error');
      return;
    }

    try {
      setLoading(true);

      const selectedOrg = organizations.find(o => o.id === selectedOrgId);
      if (!selectedOrg) throw new Error('Organization not found');

      const { data: invoiceNumber } = await supabase
        .rpc('generate_invoice_number', { p_invoice_type: invoiceType });

      if (!invoiceNumber) throw new Error('Failed to generate invoice number');

      const { data: { user } } = await supabase.auth.getUser();
      const { data: employee } = await supabase
        .from('employees')
        .select('id')
        .eq('email', user?.email)
        .maybeSingle();

      const invoiceData = {
        invoice_number: invoiceNumber,
        invoice_type: invoiceType,
        status: 'draft',
        issue_date: issueDate,
        sale_date: saleDate,
        payment_due_date: calculatePaymentDueDate(),
        event_id: eventId || null,
        organization_id: selectedOrgId,
        seller_name: settings.company_name,
        seller_nip: settings.company_nip,
        seller_street: settings.company_street,
        seller_postal_code: settings.company_postal_code,
        seller_city: settings.company_city,
        seller_country: 'Polska',
        buyer_name: selectedOrg.name,
        buyer_nip: selectedOrg.nip,
        buyer_street: selectedOrg.street || '',
        buyer_postal_code: selectedOrg.postal_code || '',
        buyer_city: selectedOrg.city || '',
        buyer_country: 'Polska',
        payment_method: settings.default_payment_method,
        bank_account: settings.bank_account,
        issue_place: settings.invoice_issue_place,
        created_by: employee?.id
      };

      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert(invoiceData)
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      // Użyj uproszczonych pozycji jeśli checkbox zaznaczony
      const finalItems = getItemsForInvoice();

      const itemsToInsert = finalItems.map(item => {
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
          value_gross: valueGross
        };
      });

      const { error: itemsError } = await supabase
        .from('invoice_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      await supabase.from('invoice_history').insert({
        invoice_id: invoice.id,
        action: 'created',
        changed_by: employee?.id,
        changes: { invoice_type: invoiceType }
      });

      showSnackbar('Faktura została utworzona', 'success');
      router.push(`/crm/invoices/${invoice.id}`);
    } catch (err: any) {
      console.error('Error creating invoice:', err);
      showSnackbar(err.message || 'Błąd podczas tworzenia faktury', 'error');
    } finally {
      setLoading(false);
    }
  };

  const totals = calculateTotals();

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="max-w-5xl mx-auto">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-[#e5e4e2]/60 hover:text-[#d3bb73] mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
          Powrót
        </button>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-8">
          <h1 className="text-2xl font-light text-[#e5e4e2] mb-8">Wystaw fakturę VAT</h1>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Typ faktury *</label>
                <select
                  value={invoiceType}
                  onChange={(e) => setInvoiceType(e.target.value as any)}
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2]"
                >
                  <option value="vat">Faktura VAT</option>
                  <option value="proforma">Proforma</option>
                  <option value="advance">Zaliczkowa</option>
                  <option value="corrective">Korygująca</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nabywca *</label>
                <select
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2]"
                >
                  <option value="">Wybierz nabywcę...</option>
                  {organizations.map(org => (
                    <option key={org.id} value={org.id}>
                      {org.name} {org.nip && `(NIP: ${org.nip})`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Data wystawienia *</label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Data sprzedaży *</label>
                <input
                  type="date"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Termin płatności (dni) *</label>
                <input
                  type="number"
                  value={paymentDays}
                  onChange={(e) => setPaymentDays(parseInt(e.target.value))}
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Data płatności</label>
                <input
                  type="text"
                  value={calculatePaymentDueDate()}
                  disabled
                  className="w-full bg-[#0a0d1a]/50 border border-[#d3bb73]/10 rounded-lg px-4 py-3 text-[#e5e4e2]/60"
                />
              </div>
            </div>

            <div className="border-t border-[#d3bb73]/10 pt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-[#e5e4e2]">Pozycje faktury</h3>
                <button
                  onClick={addItem}
                  className="flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Dodaj pozycję
                </button>
              </div>

              {/* Checkbox uproszczonej faktury */}
              {items.length > 1 && (
                <div className="mb-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={simplifiedInvoice}
                      onChange={(e) => setSimplifiedInvoice(e.target.checked)}
                      className="mt-1 w-4 h-4 rounded border-[#d3bb73]/20 text-[#d3bb73] focus:ring-[#d3bb73]"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[#e5e4e2] mb-1">
                        Uproszczona faktura (jedna pozycja)
                      </div>
                      <div className="text-xs text-[#e5e4e2]/60">
                        Wszystkie pozycje zostaną zsumowane w jedną z własną nazwą usługi
                      </div>
                    </div>
                  </label>

                  {simplifiedInvoice && (
                    <div className="mt-3">
                      <label className="block text-xs text-[#e5e4e2]/60 mb-2">
                        Nazwa usługi na fakturze *
                      </label>
                      <input
                        type="text"
                        value={simplifiedServiceName}
                        onChange={(e) => setSimplifiedServiceName(e.target.value)}
                        placeholder="np. Obsługa muzyczna"
                        className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] text-sm"
                      />
                      <div className="mt-2 text-xs text-blue-400">
                        Np. zamiast "DJ Standard 2500 zł + Konferansjer 3000 zł" → "Obsługa muzyczna 5500 zł"
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-4">
                {items.map((item, index) => {
                  const { valueNet, vatAmount, valueGross } = calculateItemValues(item);
                  return (
                    <div key={index} className="bg-[#0a0d1a] border border-[#d3bb73]/10 rounded-lg p-4">
                      <div className="flex items-start gap-4">
                        <div className="flex-1 grid grid-cols-6 gap-4">
                          <div className="col-span-2">
                            <label className="block text-xs text-[#e5e4e2]/40 mb-1">Nazwa *</label>
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) => updateItem(index, 'name', e.target.value)}
                              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 text-sm text-[#e5e4e2]"
                            />
                          </div>

                          <div>
                            <label className="block text-xs text-[#e5e4e2]/40 mb-1">J.m.</label>
                            <select
                              value={item.unit}
                              onChange={(e) => updateItem(index, 'unit', e.target.value)}
                              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 text-sm text-[#e5e4e2]"
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
                            <label className="block text-xs text-[#e5e4e2]/40 mb-1">Ilość *</label>
                            <input
                              type="number"
                              step="0.01"
                              value={item.quantity}
                              onChange={(e) => updateItem(index, 'quantity', parseFloat(e.target.value))}
                              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 text-sm text-[#e5e4e2]"
                            />
                          </div>

                          <div>
                            <label className="block text-xs text-[#e5e4e2]/40 mb-1">Cena netto *</label>
                            <input
                              type="number"
                              step="0.01"
                              value={item.price_net}
                              onChange={(e) => updateItem(index, 'price_net', parseFloat(e.target.value))}
                              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 text-sm text-[#e5e4e2]"
                            />
                          </div>

                          <div>
                            <label className="block text-xs text-[#e5e4e2]/40 mb-1">VAT %</label>
                            <select
                              value={item.vat_rate}
                              onChange={(e) => updateItem(index, 'vat_rate', parseInt(e.target.value))}
                              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 text-sm text-[#e5e4e2]"
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
                          className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="mt-3 pt-3 border-t border-[#d3bb73]/10 grid grid-cols-3 gap-4 text-sm">
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
                          <span className="ml-2 text-[#d3bb73] font-medium">{valueGross.toFixed(2)} zł</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-[#d3bb73]/10 pt-6">
              <div className="bg-[#d3bb73]/5 border border-[#d3bb73]/20 rounded-lg p-6">
                <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">Podsumowanie</h3>

                {simplifiedInvoice && items.length > 1 && (
                  <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <div className="text-xs text-blue-400 mb-2 font-medium">
                      📄 Podgląd uproszczonej faktury:
                    </div>
                    <div className="text-sm text-[#e5e4e2]">
                      1. {simplifiedServiceName || 'Obsługa muzyczna'} - {totals.totalNet.toFixed(2)} zł netto
                    </div>
                    <div className="text-xs text-[#e5e4e2]/60 mt-2">
                      Oryginalne pozycje ({items.length}): {items.map(i => i.name).join(', ')}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <div className="text-sm text-[#e5e4e2]/60 mb-1">Suma netto</div>
                    <div className="text-2xl font-light text-[#e5e4e2]">
                      {totals.totalNet.toFixed(2)} zł
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-[#e5e4e2]/60 mb-1">Suma VAT</div>
                    <div className="text-2xl font-light text-[#e5e4e2]">
                      {totals.totalVat.toFixed(2)} zł
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-[#e5e4e2]/60 mb-1">Suma brutto</div>
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
                className="px-6 py-3 border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] hover:bg-[#d3bb73]/5"
              >
                Anuluj
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg font-medium hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                <Save className="w-5 h-5" />
                {loading ? 'Zapisywanie...' : 'Wystaw fakturę'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
