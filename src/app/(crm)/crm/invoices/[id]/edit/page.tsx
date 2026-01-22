'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface InvoiceItem {
  id?: string;
  position_number: number;
  name: string;
  unit: string;
  quantity: number;
  price_net: number;
  vat_rate: number;
}

export default function EditInvoicePage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [invoice, setInvoice] = useState<any>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);

  const [issueDate, setIssueDate] = useState('');
  const [saleDate, setSaleDate] = useState('');
  const [paymentDays, setPaymentDays] = useState(14);
  const [selectedOrgId, setSelectedOrgId] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [invoiceRes, itemsRes, clientsRes] = await Promise.all([
        supabase.from('invoices').select('*').eq('id', params.id).single(),
        supabase
          .from('invoice_items')
          .select('*')
          .eq('invoice_id', params.id)
          .order('position_number'),
        supabase.rpc('get_business_clients'),
      ]);

      if (invoiceRes.data) {
        setInvoice(invoiceRes.data);
        setIssueDate(invoiceRes.data.issue_date);
        setSaleDate(invoiceRes.data.sale_date);
        setSelectedOrgId(invoiceRes.data.organization_id);

        const issueD = new Date(invoiceRes.data.issue_date);
        const dueD = new Date(invoiceRes.data.payment_due_date);
        const days = Math.round((dueD.getTime() - issueD.getTime()) / (1000 * 60 * 60 * 24));
        setPaymentDays(days);
      }

      if (itemsRes.data) {
        setItems(itemsRes.data);
      }

      if (clientsRes.data) {
        const formattedClients = clientsRes.data.map((client: any) => ({
          id: client.id,
          name: client.name,
          nip: client.nip,
          street: client.address,
          postal_code: client.postal_code,
          city: client.city,
        }));
        setOrganizations(formattedClients);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
      showSnackbar('Błąd podczas ładowania danych', 'error');
    } finally {
      setLoading(false);
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

  const handleSubmit = async () => {
    if (!selectedOrgId) {
      showSnackbar('Wybierz nabywcę', 'error');
      return;
    }

    if (items.some((item) => !item.name || item.price_net <= 0)) {
      showSnackbar('Wypełnij wszystkie pozycje faktury', 'error');
      return;
    }

    try {
      setSaving(true);

      const selectedOrg = organizations.find((o) => o.id === selectedOrgId);
      if (!selectedOrg) throw new Error('Organization not found');

      const totals = calculateTotals();

      const invoiceData = {
        issue_date: issueDate,
        sale_date: saleDate,
        payment_due_date: calculatePaymentDueDate(),
        organization_id: selectedOrgId,
        buyer_name: selectedOrg.name,
        buyer_nip: selectedOrg.nip,
        buyer_street: selectedOrg.street || '',
        buyer_postal_code: selectedOrg.postal_code || '',
        buyer_city: selectedOrg.city || '',
        total_net: totals.totalNet,
        total_vat: totals.totalVat,
        total_gross: totals.totalGross,
        status: 'draft',
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

      showSnackbar('Faktura została zaktualizowana', 'success');
      router.push(`/crm/invoices/${params.id}`);
    } catch (err: any) {
      console.error('Error updating invoice:', err);
      showSnackbar(err.message || 'Błąd podczas aktualizacji faktury', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]/60">Faktura nie została znaleziona</div>
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
          Powrót
        </button>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8">
          <h1 className="mb-8 text-2xl font-light text-[#e5e4e2]">
            Edytuj fakturę {invoice.invoice_number}
          </h1>

          {invoice.status === 'issued' && (
            <div className="mb-6 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 text-yellow-500">⚠️</div>
                <div className="flex-1">
                  <div className="mb-1 text-sm font-medium text-yellow-500">
                    Uwaga: Edycja wystawionej faktury
                  </div>
                  <div className="mb-3 text-xs text-[#e5e4e2]/60">
                    Ta faktura została już wystawiona. Po zapisaniu zmian, faktura zostanie cofnięta
                    do statusu szkic. Będziesz musiał ją ponownie wystawić.
                  </div>
                  <button
                    onClick={() => router.back()}
                    className="text-xs text-yellow-500 underline hover:text-yellow-400"
                  >
                    Anuluj i wróć
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nabywca *</label>
                <select
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2]"
                >
                  <option value="">Wybierz nabywcę...</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} {org.nip && `(NIP: ${org.nip})`}
                    </option>
                  ))}
                </select>
              </div>

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
    </div>
  );
}
