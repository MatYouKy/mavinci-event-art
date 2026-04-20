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
  const [invoiceType, setInvoiceType] = useState<'vat' | 'proforma' | 'advance' | 'corrective'>(
    'vat',
  );
  const [isProforma, setIsProforma] = useState(false);
  const [issueDate, setIssueDate] = useState('');
  const [saleDate, setSaleDate] = useState('');
  const [paymentDays, setPaymentDays] = useState(14);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Przelew');
  const [issuePlace, setIssuePlace] = useState('');
  const [includeDefaultFooterNote, setIncludeDefaultFooterNote] = useState(true);
  const [customFooterNote, setCustomFooterNote] = useState('');
  const [website, setWebsite] = useState('');
  const [signatureName, setSignatureName] = useState('');

  const [invoiceStatus, setInvoiceStatus] = useState('draft');

  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionScope, setCorrectionScope] = useState<'full' | 'partial'>('full');
  const [relatedInvoiceId, setRelatedInvoiceId] = useState('');
  const [correctedInvoiceNumber, setCorrectedInvoiceNumber] = useState('');
  const [correctedInvoiceIssueDate, setCorrectedInvoiceIssueDate] = useState('');
  const [correctedInvoiceKsefNumber, setCorrectedInvoiceKsefNumber] = useState('');
  const [correctedInvoiceWasInKsef, setCorrectedInvoiceWasInKsef] = useState(false);
  const [availableInvoices, setAvailableInvoices] = useState<any[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [invoiceRes, itemsRes, businessClientsRes, companiesRes, allInvoicesRes] =
        await Promise.all([
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
          supabase
            .from('invoices')
            .select('id, invoice_number, invoice_type, issue_date, total_gross, buyer_name, status')
            .neq('id', params.id)
            .neq('invoice_type', 'corrective')
            .in('status', ['issued', 'sent', 'paid'])
            .order('issue_date', { ascending: false }),
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
        setIsProforma(inv.is_proforma ?? false);
        setInvoiceStatus(inv.status || 'draft');
        setCustomFooterNote(inv.invoice_footer_text || '');
        setWebsite(inv.website || 'www.mavinci.pl');
        setSignatureName(inv.signature_name || '');
        setIncludeDefaultFooterNote(Boolean(inv.invoice_footer_text));

        if (inv.is_proforma) {
          setInvoiceType('proforma');
        } else if (inv.invoice_type === 'advance') {
          setInvoiceType('advance');
        } else if (inv.invoice_type === 'corrective') {
          setInvoiceType('corrective');
        } else {
          setInvoiceType('vat');
        }

        setCorrectionReason(inv.correction_reason || '');
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
            id: undefined,
            position_number: item.position_number,
            name: item.name,
            unit: item.unit,
            quantity: item.quantity,
            price_net: Number(item.price_net),
            vat_rate: item.vat_rate,
          })),
        );
      }
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

  const buildInvoiceFooterText = () => {
    const selectedCompany = myCompanies.find((c) => c.id === selectedCompanyId);

    if (invoiceType === 'corrective') {
      const issueDateText = correctedInvoiceIssueDate
        ? new Date(correctedInvoiceIssueDate).toLocaleDateString('pl-PL')
        : '-';

      return `Faktura korygująca odnosi się do faktury ${correctedInvoiceNumber || '-'} z dnia ${issueDateText}.<br /> Przyczyna korekty: ${correctionReason || '-'}.`;
    }

    if (!includeDefaultFooterNote) {
      return null;
    }

    return (
      selectedCompany?.invoice_footer_text ||
      'Niniejsza faktura jest wezwaniem do zapłaty zgodnie z artykułem 455 kc. Po przekroczeniu terminu płatności będą naliczane ustawowe odsetki za zwłokę.'
    );
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

    try {
      setSaving(true);

      const selectedOrg = organizations.find((o) => o.id === selectedOrgId);
      if (!selectedOrg) throw new Error('Organization not found');

      const selectedCompany = myCompanies.find((c) => c.id === selectedCompanyId);
      if (!selectedCompany) throw new Error('Company not found');

      const footerNote =
        invoiceType === 'corrective'
          ? buildInvoiceFooterText()
          : includeDefaultFooterNote
            ? customFooterNote?.trim() ||
              selectedCompany.invoice_footer_text ||
              'Niniejsza faktura jest wezwaniem do zapłaty zgodnie z artykułem 455 kc. Po przekroczeniu terminu płatności będą naliczane ustawowe odsetki za zwłokę.'
            : null;

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
        invoice_number: invoiceNumber,
        invoice_type: invoiceType,
        is_proforma: invoiceType === 'proforma',
        status: invoiceStatus,
        issue_date: issueDate,
        sale_date: saleDate,
        footer_note: footerNote,
        signature_name: signatureName,
        website: website,
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

      if (invoiceType === 'corrective') {
        invoiceData.related_invoice_id = relatedInvoiceId || null;
        invoiceData.correction_reason = correctionReason;
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

      const changes: Record<string, any> = { updated_fields: Object.keys(invoiceData) };
      if (invoiceStatus !== invoice.status) {
        changes.status_change = { from: invoice.status, to: invoiceStatus };
      }

      await supabase.from('invoice_history').insert({
        invoice_id: params.id,
        action: invoiceStatus !== invoice.status ? 'status_changed' : 'edited',
        changed_by: employee?.id,
        changes,
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
                  setSelectedCompanyId(e.target.value);
                  const company = myCompanies.find((c) => c.id === e.target.value);
                  if (company) {
                    setIssuePlace(company.city);
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

            {/* Nabywca */}
            <div className="grid grid-cols-1 gap-6">
              {invoiceType === 'corrective' && relatedInvoiceId ? (
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nabywca *</label>
                  <div className="rounded-lg border border-orange-500/20 bg-[#0a0d1a]/50 px-4 py-3 text-[#e5e4e2]">
                    {organizations.find((o) => o.id === selectedOrgId)?.name ||
                      'Nabywca z faktury korygowanej'}
                    {organizations.find((o) => o.id === selectedOrgId)?.nip && (
                      <span className="ml-2 text-xs text-[#e5e4e2]/40">
                        NIP: {organizations.find((o) => o.id === selectedOrgId)?.nip}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-orange-400">
                    Nabywca zostal pobrany z faktury korygowanej
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
