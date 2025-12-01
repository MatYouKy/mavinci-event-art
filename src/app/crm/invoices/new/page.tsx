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

  useEffect(() => {
    fetchData();
  }, [eventId]);

  const fetchData = async () => {
    try {
      const [settingsRes, orgsRes] = await Promise.all([
        supabase.from('invoice_settings').select('*').limit(1).maybeSingle(),
        supabase.from('organizations').select('id, name, nip, street, postal_code, city').order('name')
      ]);

      if (settingsRes.data) setSettings(settingsRes.data);
      if (orgsRes.data) setOrganizations(orgsRes.data);

      if (eventId) {
        const { data: eventData } = await supabase
          .from('events')
          .select('name, organization_id, organizations(id, name, nip, street, postal_code, city)')
          .eq('id', eventId)
          .maybeSingle();

        if (eventData) {
          if (eventData.organization_id) {
            setSelectedOrgId(eventData.organization_id);
          }
          setItems([{
            position_number: 1,
            name: `Obsługa techniczna - ${eventData.name}`,
            unit: 'szt.',
            quantity: 1,
            price_net: 0,
            vat_rate: 23
          }]);
        }
      }
    } catch (err) {
      console.error('Error fetching data:', err);
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

  const handleSubmit = async () => {
    if (!selectedOrgId) {
      showSnackbar('Wybierz organizację (nabywcę)', 'error');
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

      const itemsToInsert = items.map(item => {
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
                  <option value="">Wybierz organizację...</option>
                  {organizations.map(org => (
                    <option key={org.id} value={org.id}>
                      {org.name} {org.nip && `(${org.nip})`}
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
