'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, FileText, Loader, Plus, Trash2, Search, Building, Calendar } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  createFinalInvoice,
  type FinalInvoiceItemInput,
  type SettledInvoiceRef,
} from '@/lib/invoices/createFinalInvoice';

interface FinalInvoiceWizardModalProps {
  onClose: () => void;
  onCreated: (invoiceId: string) => void;
  initialEventId?: string | null;
  initialOrganizationId?: string | null;
}

interface CandidateInvoice {
  id: string;
  invoice_number: string;
  invoice_type: 'vat' | 'proforma' | 'advance' | 'corrective';
  status: string;
  issue_date: string;
  total_net: number;
  total_vat: number;
  total_gross: number;
  event_id: string | null;
  organization_id: string | null;
  buyer_name: string;
  buyer_nip: string | null;
  buyer_street: string | null;
  buyer_postal_code: string | null;
  buyer_city: string | null;
  buyer_country: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  buyer_contact_person: string | null;
  payment_method: string | null;
  bank_account: string | null;
  issue_place: string | null;
  my_company_id: string | null;
  seller_name: string | null;
  seller_nip: string | null;
  seller_street: string | null;
  seller_postal_code: string | null;
  seller_city: string | null;
  seller_country: string | null;
  event?: { name: string | null } | null;
  organization?: { id: string; name: string } | null;
}

interface EventOpt {
  id: string;
  name: string | null;
  event_date: string | null;
}

interface OrgOpt {
  id: string;
  name: string;
}

type ContextMode = 'event' | 'organization';

const today = () => new Date().toISOString().split('T')[0];
const plus14 = () => {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().split('T')[0];
};
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function FinalInvoiceWizardModal({
  onClose,
  onCreated,
  initialEventId = null,
  initialOrganizationId = null,
}: FinalInvoiceWizardModalProps) {
  const { showSnackbar } = useSnackbar();

  const [mode, setMode] = useState<ContextMode>(initialEventId ? 'event' : 'organization');
  const [eventId, setEventId] = useState<string | null>(initialEventId);
  const [organizationId, setOrganizationId] = useState<string | null>(initialOrganizationId);

  const [eventOptions, setEventOptions] = useState<EventOpt[]>([]);
  const [orgOptions, setOrgOptions] = useState<OrgOpt[]>([]);
  const [eventQuery, setEventQuery] = useState('');
  const [orgQuery, setOrgQuery] = useState('');

  const [candidates, setCandidates] = useState<CandidateInvoice[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const [customNumber, setCustomNumber] = useState('');
  const [autoPreview, setAutoPreview] = useState('');
  const [useCustomNumber, setUseCustomNumber] = useState(false);
  const [issueDate, setIssueDate] = useState(today());
  const [saleDate, setSaleDate] = useState(today());
  const [paymentDueDate, setPaymentDueDate] = useState(plus14());
  const [items, setItems] = useState<FinalInvoiceItemInput[]>([
    { name: '', unit: 'szt.', quantity: 1, price_net: 0, vat_rate: 23 },
  ]);

  const [creating, setCreating] = useState(false);

  const myCompanyId = useMemo(() => {
    const sel = candidates.find((c) => selectedIds.has(c.id));
    return sel?.my_company_id ?? null;
  }, [candidates, selectedIds]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('generate_invoice_number', {
        p_invoice_type: 'vat',
        p_my_company_id: myCompanyId,
      });
      if (error) {
        console.error('generate_invoice_number error:', error);
        setAutoPreview('');
        return;
      }
      if (data) {
        const { data: existing } = await supabase
          .from('invoices')
          .select('id')
          .eq('invoice_number', data)
          .maybeSingle();
        setAutoPreview(existing ? `${data} (zajete)` : (data as string));
      }
    })();
  }, [myCompanyId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (mode !== 'event') return;
      const q = supabase
        .from('events')
        .select('id, name, event_date')
        .order('event_date', { ascending: false })
        .limit(50);
      if (eventQuery.trim()) q.ilike('name', `%${eventQuery.trim()}%`);
      const { data } = await q;
      if (!cancelled) setEventOptions((data ?? []) as EventOpt[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, eventQuery]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (mode !== 'organization') return;
      const q = supabase.from('organizations').select('id, name').order('name').limit(50);
      if (orgQuery.trim()) q.ilike('name', `%${orgQuery.trim()}%`);
      const { data } = await q;
      if (!cancelled) setOrgOptions((data ?? []) as OrgOpt[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, orgQuery]);

  const fetchCandidates = async () => {
    setLoadingCandidates(true);
    try {
      const select = `
        id, invoice_number, invoice_type, status, issue_date,
        total_net, total_vat, total_gross,
        event_id, organization_id,
        buyer_name, buyer_nip, buyer_street, buyer_postal_code, buyer_city, buyer_country,
        buyer_email, buyer_phone, buyer_contact_person,
        payment_method, bank_account, issue_place, my_company_id,
        seller_name, seller_nip, seller_street, seller_postal_code, seller_city, seller_country,
        event:events(name), organization:organizations(id, name)
      `;
      let query = supabase
        .from('invoices')
        .select(select)
        .in('invoice_type', ['proforma', 'advance'])
        .order('issue_date', { ascending: false });
      if (mode === 'event' && eventId) query = query.eq('event_id', eventId);
      else if (mode === 'organization' && organizationId)
        query = query.eq('organization_id', organizationId);
      else {
        setCandidates([]);
        setLoadingCandidates(false);
        return;
      }
      const { data } = await query;
      setCandidates((data ?? []) as unknown as CandidateInvoice[]);
      setSelectedIds(new Set());
    } finally {
      setLoadingCandidates(false);
    }
  };

  useEffect(() => {
    fetchCandidates();
  }, [mode, eventId, organizationId]);

  const selectedInvoices = useMemo(
    () => candidates.filter((c) => selectedIds.has(c.id)),
    [candidates, selectedIds],
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addItem = () =>
    setItems((prev) => [
      ...prev,
      { name: '', unit: 'szt.', quantity: 1, price_net: 0, vat_rate: 23 },
    ]);
  const removeItem = (idx: number) =>
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  const updateItem = (idx: number, patch: Partial<FinalInvoiceItemInput>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const totals = useMemo(() => {
    const net = round2(items.reduce((s, i) => s + i.quantity * i.price_net, 0));
    const vat = round2(
      items.reduce((s, i) => s + (i.quantity * i.price_net * i.vat_rate) / 100, 0),
    );
    const gross = round2(net + vat);
    return { net, vat, gross };
  }, [items]);

  const settledGross = useMemo(
    () => round2(selectedInvoices.reduce((s, i) => s + Number(i.total_gross), 0)),
    [selectedInvoices],
  );
  const remaining = round2(totals.gross - settledGross);

  const fillItemsFromAdvance = () => {
    const sum = settledGross;
    if (!sum) return;
    setItems([
      { name: 'Usluga zgodnie z umowa', unit: 'szt.', quantity: 1, price_net: round2(sum / 1.23), vat_rate: 23 },
    ]);
  };

  const handleCreate = async () => {
    if (!selectedInvoices.length) {
      showSnackbar('Wybierz co najmniej jedna fakture do rozliczenia', 'error');
      return;
    }
    if (items.some((i) => !i.name.trim())) {
      showSnackbar('Wszystkie pozycje musza miec nazwe', 'error');
      return;
    }
    if (useCustomNumber && !customNumber.trim()) {
      showSnackbar('Podaj numer faktury', 'error');
      return;
    }

    setCreating(true);
    try {
      const ref = selectedInvoices[0];
      const settledRefs: SettledInvoiceRef[] = selectedInvoices.map((i) => ({
        id: i.id,
        invoice_number: i.invoice_number,
        total_net: i.total_net,
        total_vat: i.total_vat,
        total_gross: i.total_gross,
        invoice_type: i.invoice_type,
      }));

      const result = await createFinalInvoice({
        eventId: mode === 'event' ? eventId : ref.event_id,
        organizationId: mode === 'organization' ? organizationId : ref.organization_id,
        myCompanyId: ref.my_company_id,
        customNumber: useCustomNumber ? customNumber : undefined,
        issueDate,
        saleDate,
        paymentDueDate,
        items,
        settledInvoices: settledRefs,
        buyerData: {
          buyer_name: ref.buyer_name,
          buyer_nip: ref.buyer_nip,
          buyer_street: ref.buyer_street,
          buyer_postal_code: ref.buyer_postal_code,
          buyer_city: ref.buyer_city,
          buyer_country: ref.buyer_country,
          buyer_email: ref.buyer_email,
          buyer_phone: ref.buyer_phone,
          buyer_contact_person: ref.buyer_contact_person,
        },
        sellerData: {
          seller_name: ref.seller_name,
          seller_nip: ref.seller_nip,
          seller_street: ref.seller_street,
          seller_postal_code: ref.seller_postal_code,
          seller_city: ref.seller_city,
          seller_country: ref.seller_country,
        },
        paymentMethod: ref.payment_method,
        bankAccount: ref.bank_account,
        issuePlace: ref.issue_place,
      });

      if (!result.success || !result.invoiceId) {
        throw new Error(result.error || 'Blad tworzenia faktury');
      }
      showSnackbar('Faktura koncowa utworzona', 'success');
      onCreated(result.invoiceId);
    } catch (err: any) {
      console.error(err);
      showSnackbar(err.message || 'Blad tworzenia faktury koncowej', 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-[#d3bb73]" />
            <h2 className="text-xl font-light text-[#e5e4e2]">
              Wystaw fakture koncowa (rozliczenie zaliczek)
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={creating}
            className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-6">
          <div>
            <div className="mb-2 text-sm text-[#e5e4e2]/60">Kontekst wyszukiwania faktur</div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setMode('event');
                  setOrganizationId(null);
                }}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                  mode === 'event'
                    ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                    : 'border-[#d3bb73]/20 bg-[#0a0d1a] hover:border-[#d3bb73]/50'
                }`}
              >
                <Calendar className="h-5 w-5 text-[#d3bb73]" />
                <div>
                  <div
                    className={`text-sm font-medium ${
                      mode === 'event' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'
                    }`}
                  >
                    Wedlug eventu
                  </div>
                  <div className="text-xs text-[#e5e4e2]/50">
                    Pobierz wszystkie faktury wystawione dla wybranego eventu
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('organization');
                  setEventId(null);
                }}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                  mode === 'organization'
                    ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                    : 'border-[#d3bb73]/20 bg-[#0a0d1a] hover:border-[#d3bb73]/50'
                }`}
              >
                <Building className="h-5 w-5 text-[#d3bb73]" />
                <div>
                  <div
                    className={`text-sm font-medium ${
                      mode === 'organization' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'
                    }`}
                  >
                    Wedlug podmiotu
                  </div>
                  <div className="text-xs text-[#e5e4e2]/50">
                    Fallback gdy nie ma powiazania z eventem
                  </div>
                </div>
              </button>
            </div>
          </div>

          {mode === 'event' ? (
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wybierz event</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" />
                <input
                  value={eventQuery}
                  onChange={(e) => setEventQuery(e.target.value)}
                  placeholder="Szukaj eventu..."
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] py-2 pl-10 pr-4 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a]">
                {eventOptions.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => setEventId(ev.id)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-[#d3bb73]/10 ${
                      eventId === ev.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]'
                    }`}
                  >
                    <span>{ev.name || '(bez nazwy)'}</span>
                    <span className="text-xs text-[#e5e4e2]/40">{ev.event_date || ''}</span>
                  </button>
                ))}
                {eventOptions.length === 0 && (
                  <div className="px-3 py-4 text-center text-sm text-[#e5e4e2]/40">
                    Brak wynikow
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wybierz podmiot</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" />
                <input
                  value={orgQuery}
                  onChange={(e) => setOrgQuery(e.target.value)}
                  placeholder="Szukaj podmiotu..."
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] py-2 pl-10 pr-4 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a]">
                {orgOptions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setOrganizationId(o.id)}
                    className={`flex w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[#d3bb73]/10 ${
                      organizationId === o.id
                        ? 'bg-[#d3bb73]/15 text-[#d3bb73]'
                        : 'text-[#e5e4e2]'
                    }`}
                  >
                    {o.name}
                  </button>
                ))}
                {orgOptions.length === 0 && (
                  <div className="px-3 py-4 text-center text-sm text-[#e5e4e2]/40">
                    Brak wynikow
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm text-[#e5e4e2]/60">
                Faktury do rozliczenia ({candidates.length})
              </div>
              {settledGross > 0 && (
                <button
                  type="button"
                  onClick={fillItemsFromAdvance}
                  className="rounded-md border border-[#d3bb73]/30 px-3 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                >
                  Wypelnij pozycje na podstawie zaliczek
                </button>
              )}
            </div>
            <div className="overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a]">
              {loadingCandidates ? (
                <div className="px-4 py-6 text-center text-sm text-[#e5e4e2]/50">Ladowanie...</div>
              ) : candidates.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-[#e5e4e2]/50">
                  Brak faktur proforma/zaliczkowych w tym kontekscie
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[#1c1f33] text-xs uppercase text-[#e5e4e2]/50">
                    <tr>
                      <th className="w-10 px-3 py-2 text-left"></th>
                      <th className="px-3 py-2 text-left">Numer</th>
                      <th className="px-3 py-2 text-left">Typ</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Data</th>
                      <th className="px-3 py-2 text-right">Brutto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => {
                      const checked = selectedIds.has(c.id);
                      return (
                        <tr
                          key={c.id}
                          className={`cursor-pointer border-t border-[#d3bb73]/5 transition-colors ${
                            checked ? 'bg-[#d3bb73]/10' : 'hover:bg-[#d3bb73]/5'
                          }`}
                          onClick={() => toggleSelect(c.id)}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelect(c.id)}
                              className="h-4 w-4 accent-[#d3bb73]"
                            />
                          </td>
                          <td className="px-3 py-2 text-[#e5e4e2]">{c.invoice_number}</td>
                          <td className="px-3 py-2 text-[#e5e4e2]/70">
                            {c.invoice_type === 'proforma' ? 'Proforma' : 'Zaliczkowa'}
                          </td>
                          <td className="px-3 py-2 text-[#e5e4e2]/70">{c.status}</td>
                          <td className="px-3 py-2 text-[#e5e4e2]/70">{c.issue_date}</td>
                          <td className="px-3 py-2 text-right font-medium text-[#e5e4e2]">
                            {Number(c.total_gross).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm text-[#e5e4e2]/60">Pozycje faktury koncowej</div>
              <button
                type="button"
                onClick={addItem}
                className="flex items-center gap-1 rounded-md border border-[#d3bb73]/30 px-3 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
              >
                <Plus className="h-3 w-3" /> Dodaj pozycje
              </button>
            </div>
            <div className="overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a]">
              <table className="w-full text-sm">
                <thead className="bg-[#1c1f33] text-xs uppercase text-[#e5e4e2]/50">
                  <tr>
                    <th className="px-3 py-2 text-left">Nazwa</th>
                    <th className="w-20 px-2 py-2 text-left">Jm.</th>
                    <th className="w-20 px-2 py-2 text-right">Ilosc</th>
                    <th className="w-28 px-2 py-2 text-right">Cena netto</th>
                    <th className="w-20 px-2 py-2 text-right">VAT %</th>
                    <th className="w-28 px-2 py-2 text-right">Brutto</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const valueNet = it.quantity * it.price_net;
                    const valueGross = round2(valueNet * (1 + it.vat_rate / 100));
                    return (
                      <tr key={idx} className="border-t border-[#d3bb73]/5">
                        <td className="px-2 py-1">
                          <input
                            value={it.name}
                            onChange={(e) => updateItem(idx, { name: e.target.value })}
                            placeholder="Nazwa pozycji"
                            className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={it.unit}
                            onChange={(e) => updateItem(idx, { unit: e.target.value })}
                            className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            value={it.quantity}
                            min={0}
                            step={0.01}
                            onChange={(e) =>
                              updateItem(idx, { quantity: Number(e.target.value) || 0 })
                            }
                            className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-right text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            value={it.price_net}
                            min={0}
                            step={0.01}
                            onChange={(e) =>
                              updateItem(idx, { price_net: Number(e.target.value) || 0 })
                            }
                            className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-right text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            value={it.vat_rate}
                            min={0}
                            max={100}
                            step={1}
                            onChange={(e) =>
                              updateItem(idx, { vat_rate: Number(e.target.value) || 0 })
                            }
                            className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-right text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1 text-right text-[#e5e4e2]">
                          {valueGross.toFixed(2)}
                        </td>
                        <td className="px-2 py-1">
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            disabled={items.length === 1}
                            className="rounded p-1 text-[#e5e4e2]/40 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-30"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4 md:grid-cols-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-[#e5e4e2]/40">
                Wartosc faktury (brutto)
              </div>
              <div className="mt-1 text-lg font-medium text-[#e5e4e2]">
                {totals.gross.toFixed(2)} PLN
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-[#e5e4e2]/40">
                Rozliczone zaliczki (brutto)
              </div>
              <div className="mt-1 text-lg font-medium text-[#e5e4e2]">
                {settledGross.toFixed(2)} PLN
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-[#e5e4e2]/40">Do doplaty</div>
              <div
                className={`mt-1 text-lg font-medium ${
                  remaining > 0
                    ? 'text-[#d3bb73]'
                    : remaining < 0
                      ? 'text-red-400'
                      : 'text-green-400'
                }`}
              >
                {remaining.toFixed(2)} PLN
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Numer faktury</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setUseCustomNumber(false)}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    !useCustomNumber
                      ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]'
                      : 'border-[#d3bb73]/20 bg-[#0a0d1a] text-[#e5e4e2]'
                  }`}
                >
                  Auto: {autoPreview || '—'}
                </button>
                <button
                  type="button"
                  onClick={() => setUseCustomNumber(true)}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    useCustomNumber
                      ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]'
                      : 'border-[#d3bb73]/20 bg-[#0a0d1a] text-[#e5e4e2]'
                  }`}
                >
                  Wlasny
                </button>
              </div>
              {useCustomNumber && (
                <input
                  value={customNumber}
                  onChange={(e) => setCustomNumber(e.target.value)}
                  placeholder="np. FV/123/2026"
                  className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="mb-2 block text-xs text-[#e5e4e2]/60">Wystawienia</label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-2 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs text-[#e5e4e2]/60">Sprzedazy</label>
                <input
                  type="date"
                  value={saleDate}
                  onChange={(e) => setSaleDate(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-2 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs text-[#e5e4e2]/60">Termin platnosci</label>
                <input
                  type="date"
                  value={paymentDueDate}
                  onChange={(e) => setPaymentDueDate(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-2 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 p-6">
          <button
            onClick={onClose}
            disabled={creating}
            className="rounded-lg px-6 py-2.5 text-[#e5e4e2]/80 transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !selectedInvoices.length}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {creating ? (
              <>
                <Loader className="h-4 w-4 animate-spin" />
                Tworzenie...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4" />
                Wystaw fakture koncowa
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
