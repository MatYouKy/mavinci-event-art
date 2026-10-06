'use client';

import { loadFinalInvoiceEventOrder, type FinalInvoiceEventOrder } from '@/lib/invoices/finalInvoiceEventOrder';
import { systemLabel } from '@/lib/ui/systemLabels';
import { calculateFinalInvoice } from '@/lib/invoices/finalInvoiceCalculation';
import { inheritFinalInvoicePresentation } from '@/lib/invoices/inheritFinalInvoicePresentation';
import { DEFAULT_INVOICE_PAYMENT_TERM_DAYS, getInvoicePaymentDueDate } from '@/lib/invoices/paymentTerm';
import FinalInvoicePreview from '@/components/crm/invoices/FinalInvoicePreview';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  FileText,
  Loader,
  Plus,
  Trash2,
  Search,
  Building,
  Building2,
  Calendar,
} from 'lucide-react';
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
  initialAdvanceInvoiceId?: string | null;
}

interface CandidateInvoice {
  id: string;
  invoice_number: string;
  invoice_type: 'vat' | 'proforma' | 'advance' | 'corrective' | 'final';
  status: string;
  issue_date: string;
  total_net: number;
  total_vat: number;
  total_gross: number;
  paid_amount: number;
  event_id: string | null;
  related_invoice_id: string | null;
  organization_id: string | null;
  billing_arrangement: 'direct' | 'hotel' | 'agency' | 'other' | null;
  service_recipient_organization_id: string | null;
  service_recipient_contact_id: string | null;
  buyer_name: string;
  buyer_contact_id: string | null;
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
  bank_name: string | null;
  issue_place: string | null;
  my_company_id: string | null;
  currency_code: string | null;
  seller_name: string | null;
  seller_nip: string | null;
  seller_street: string | null;
  seller_postal_code: string | null;
  seller_city: string | null;
  seller_country: string | null;
  event?: { name: string | null } | null;
  organization?: { id: string; name: string } | null;
  invoice_items?: {
    id?: string;
    invoice_id?: string;
    position_number?: number | null;
    name: string;
    unit?: string | null;
    quantity: number;
    price_net: number;
    vat_rate: number;
    vat_code?: '23' | '8' | '5' | '0' | '0 KR' | '0 WDT' | '0 EX' | 'zw' | 'np' | 'np I' | 'np II' | 'oo';
    vat_exemption_reason?: string | null;
  }[];
  invoice_order_items?: CandidateInvoice['invoice_items'];
}

const candidateSelect = `
  id, invoice_number, invoice_type, status, issue_date,
  total_net, total_vat, total_gross, paid_amount,
  event_id, related_invoice_id, organization_id, billing_arrangement,
  service_recipient_organization_id, service_recipient_contact_id,
  buyer_name, buyer_contact_id, buyer_nip, buyer_street, buyer_postal_code, buyer_city, buyer_country,
  buyer_email, buyer_phone, buyer_contact_person,
  payment_method, bank_account, issue_place, my_company_id,
  bank_name, currency_code,
  seller_name, seller_nip, seller_street, seller_postal_code, seller_city, seller_country,
  invoice_items (position_number, name, unit, quantity, price_net, vat_rate, vat_code, vat_exemption_reason),
  invoice_order_items (position_number, name, unit, quantity, price_net, vat_rate, vat_code, vat_exemption_reason),
  event:events(name),
  organization:organizations!invoices_organization_id_fkey(id, name)
`;

const normalizedText = (value: string | null) => (value || '').trim().toLocaleLowerCase('pl-PL');
const normalizedNip = (value: string | null) => (value || '').replace(/[^a-z\d]/gi, '').toUpperCase();

const matchesAdvanceContext = (invoice: CandidateInvoice, source: CandidateInvoice) => {
  const sourceNip = normalizedNip(source.buyer_nip);
  const sameBuyer = sourceNip
    ? normalizedNip(invoice.buyer_nip) === sourceNip
    : source.buyer_contact_id
      ? invoice.buyer_contact_id === source.buyer_contact_id
      : !normalizedNip(invoice.buyer_nip) &&
        normalizedText(invoice.buyer_name) === normalizedText(source.buyer_name) &&
        normalizedText(invoice.buyer_street) === normalizedText(source.buyer_street) &&
        normalizedText(invoice.buyer_postal_code) === normalizedText(source.buyer_postal_code) &&
        normalizedText(invoice.buyer_city) === normalizedText(source.buyer_city);

  return sameBuyer &&
    invoice.my_company_id === source.my_company_id &&
    normalizedNip(invoice.seller_nip) === normalizedNip(source.seller_nip) &&
    (invoice.currency_code || 'PLN') === (source.currency_code || 'PLN') &&
    invoice.organization_id === source.organization_id &&
    invoice.billing_arrangement === source.billing_arrangement &&
    invoice.service_recipient_organization_id === source.service_recipient_organization_id &&
    invoice.service_recipient_contact_id === source.service_recipient_contact_id;
};

async function loadAdvanceOrder(sourceId: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select(candidateSelect)
    .eq('id', sourceId)
    .eq('invoice_type', 'advance')
    .single();
  if (error) throw error;
  const source = data as unknown as CandidateInvoice;
  let orderSnapshot = source.invoice_order_items?.length ? source.invoice_order_items : null;
  let orderEventId = source.event_id;
  const ancestors = new Set([source.id]);
  let root = source;

  // A shared customer or event is not enough to identify the same order.
  while (root.related_invoice_id) {
    if (ancestors.has(root.related_invoice_id) || ancestors.size >= 50) {
      throw new Error('Nie udało się ustalić powiązań zamówienia. Sprawdź powiązane dokumenty.');
    }
    const { data: parentData, error: parentError } = await supabase
      .from('invoices')
      .select(candidateSelect)
      .eq('id', root.related_invoice_id)
      .maybeSingle();
    if (parentError) throw parentError;
    const parent = parentData as unknown as CandidateInvoice | null;
    if (!parent || !['advance', 'proforma'].includes(parent.invoice_type)) break;
    if (!orderSnapshot && parent.invoice_order_items?.length && matchesAdvanceContext(parent, source)) {
      orderSnapshot = parent.invoice_order_items;
    }
    if (!orderEventId && matchesAdvanceContext(parent, source)) orderEventId = parent.event_id;
    ancestors.add(parent.id);
    root = parent;
    if (root.invoice_type === 'proforma') break;
  }

  const family = new Map<string, CandidateInvoice>([[source.id, source]]);
  if (root.invoice_type === 'advance') family.set(root.id, root);
  const visited = new Set([root.id]);
  let parentIds = [root.id];
  let depth = 0;
  while (parentIds.length) {
    if (depth++ >= 50) {
      throw new Error('Nie udało się ustalić wszystkich zaliczek zamówienia. Sprawdź powiązane dokumenty.');
    }
    const { data: children, error: childrenError } = await supabase
      .from('invoices')
      .select(candidateSelect)
      .eq('invoice_type', 'advance')
      .in('related_invoice_id', parentIds);
    if (childrenError) throw childrenError;
    parentIds = [];
    for (const invoice of (children ?? []) as unknown as CandidateInvoice[]) {
      if (visited.has(invoice.id)) continue;
      visited.add(invoice.id);
      family.set(invoice.id, invoice);
      parentIds.push(invoice.id);
    }
  }

  return {
    source,
    orderSnapshot,
    eventId: orderEventId,
    invoices: Array.from(family.values()).filter((invoice) =>
      ['issued', 'sent', 'paid', 'overdue'].includes(invoice.status) && matchesAdvanceContext(invoice, source)
    ),
  };
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

interface MyCompanyOpt {
  id: string;
  name: string;
  nip: string;
  is_default: boolean;
  bank_name: string | null;
  bank_account: string | null;
  bank_swift_code: string | null;
}

type ContextMode = 'event' | 'organization';

const normalizeDecimalInput = (value: string) => {
  return value
    .replace(/[^\d,.-]/g, '')
    .replace('.', ',')
    .replace(/(,.*),/g, '$1');
};

const parseDecimalInput = (value: string) => {
  const normalized = value.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatDecimalInput = (value: number) => {
  return Number(value || 0)
    .toFixed(2)
    .replace('.', ',');
};

const today = () => new Date().toISOString().split('T')[0];
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function FinalInvoiceWizardModal({
  onClose,
  onCreated,
  initialEventId = null,
  initialOrganizationId = null,
  initialAdvanceInvoiceId = null,
}: FinalInvoiceWizardModalProps) {
  const { showSnackbar } = useSnackbar();

  const locked = Boolean(initialEventId || initialOrganizationId || initialAdvanceInvoiceId);
  const [mode, setMode] = useState<ContextMode>(initialEventId ? 'event' : 'organization');
  const [eventId, setEventId] = useState<string | null>(initialEventId);
  const [organizationId, setOrganizationId] = useState<string | null>(initialOrganizationId);
  const [lockedOrgName, setLockedOrgName] = useState<string | null>(null);
  const [sourceAdvance, setSourceAdvance] = useState<CandidateInvoice | null>(null);
  const [sourceOrderItems, setSourceOrderItems] = useState<CandidateInvoice['invoice_items'] | null>(null);
  const [sourceEventId, setSourceEventId] = useState<string | null>(null);
  const [eventOrderState, setEventOrderState] = useState<{
    eventId: string;
    order: FinalInvoiceEventOrder | null;
    error: string | null;
  } | null>(null);
  const [showOrderItems, setShowOrderItems] = useState(false);
  const [presentationMode, setPresentationMode] = useState<'inherited' | 'order'>('inherited');
  const itemDraft = useRef({ context: '', mode: 'inherited', edited: false });
  const [candidatesError, setCandidatesError] = useState<string | null>(null);

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
  const [paymentTermDays, setPaymentTermDays] = useState(String(DEFAULT_INVOICE_PAYMENT_TERM_DAYS));
  const paymentDueDate = getInvoicePaymentDueDate(issueDate, paymentTermDays) || '';
  const [items, setItems] = useState<FinalInvoiceItemInput[]>([
    { name: '', unit: 'szt.', quantity: 1, price_net: 0, vat_rate: 23 },
  ]);

  const [creating, setCreating] = useState(false);
  const [companyTouched, setCompanyTouched] = useState(false);

  const [editingValues, setEditingValues] = useState<Record<string, string>>({});

  const [myCompanies, setMyCompanies] = useState<MyCompanyOpt[]>([]);
  const [manualCompanyId, setManualCompanyId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('my_companies')
        .select('id, name, nip, is_default, bank_name, bank_account, bank_swift_code')
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('name');

      const list = (data ?? []) as MyCompanyOpt[];
      setMyCompanies(list);
    })();
  }, []);

  const myCompanyId = useMemo(() => {
    return manualCompanyId || candidates.find((c) => selectedIds.has(c.id))?.my_company_id || null;
  }, [manualCompanyId, candidates, selectedIds]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('preview_invoice_number', {
        p_invoice_type: 'final',
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
          .eq('my_company_id', myCompanyId)
          .maybeSingle();

        setAutoPreview(existing ? `${data} (zajęte)` : (data as string));
      }
    })();
  }, [myCompanyId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (initialAdvanceInvoiceId || mode !== 'event') return;
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
  }, [mode, eventQuery, initialAdvanceInvoiceId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (initialAdvanceInvoiceId || mode !== 'organization') return;
      const q = supabase.from('organizations').select('id, name').order('name').limit(50);
      if (orgQuery.trim()) q.ilike('name', `%${orgQuery.trim()}%`);
      const { data } = await q;
      if (!cancelled) setOrgOptions((data ?? []) as OrgOpt[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, orgQuery, initialAdvanceInvoiceId]);

  const fetchCandidates = async () => {
    setLoadingCandidates(true);
    setCandidatesError(null);
    setCandidates([]);
    setSelectedIds(new Set());
    try {
      let rawList: CandidateInvoice[];
      if (initialAdvanceInvoiceId) {
        const order = await loadAdvanceOrder(initialAdvanceInvoiceId);
        setSourceAdvance(order.source);
        setSourceOrderItems(order.orderSnapshot);
        setSourceEventId(order.eventId);
        if (order.source.my_company_id) setManualCompanyId(order.source.my_company_id);
        rawList = order.invoices;
      } else {
      let eventInvoiceIds: string[] = [];
      if (mode === 'event' && eventId) {
        const { data: settlementInvoices, error: settlementInvoicesError } = await supabase
          .from('event_invoice_settlements')
          .select('id')
          .eq('event_id', eventId);
        if (settlementInvoicesError) throw settlementInvoicesError;
        eventInvoiceIds = Array.from(
          new Set((settlementInvoices || []).map((invoice) => invoice.id)),
        );
        if (!eventInvoiceIds.length) {
          setCandidates([]);
          setSelectedIds(new Set());
          return;
        }
      }

      let query = supabase
        .from('invoices')
        .select(candidateSelect)
        .eq('invoice_type', 'advance')
        .in('status', ['issued', 'sent', 'paid', 'overdue'])
        .order('issue_date', { ascending: false })
        .order('id', { ascending: true });
      if (mode === 'event' && eventId) query = query.in('id', eventInvoiceIds);
      else if (mode === 'organization' && organizationId)
        query = query.or(
          `organization_id.eq.${organizationId},service_recipient_organization_id.eq.${organizationId}`,
        );
      else {
        setCandidates([]);
        setLoadingCandidates(false);
        return;
      }
      const { data, error } = await query;
      if (error) throw error;
      rawList = (data ?? []) as unknown as CandidateInvoice[];
      }
      const candidateIds = rawList.map((invoice) => invoice.id);
      const { data: settledRows, error: settledError } = candidateIds.length
        ? await supabase
            .from('invoice_settlements')
            .select('advance_invoice_id')
            .in('advance_invoice_id', candidateIds)
        : { data: [], error: null };
      if (settledError) throw settledError;
      const settledIds = new Set((settledRows ?? []).map((row) => row.advance_invoice_id));
      const list = rawList.filter((invoice) =>
        !settledIds.has(invoice.id) &&
        Number(invoice.total_gross) > 0
      );
      setCandidates(list);
      if (locked && list.length) {
        setSelectedIds(new Set(list.map((c) => c.id)));
      } else {
        setSelectedIds(new Set());
      }
    } catch (error: any) {
      setCandidates([]);
      setSelectedIds(new Set());
      setCandidatesError(error.message || 'Nie udało się pobrać zaliczek do rozliczenia.');
    } finally {
      setLoadingCandidates(false);
    }
  };

  useEffect(() => {
    fetchCandidates();
  }, [mode, eventId, organizationId, initialAdvanceInvoiceId]);

  const selectedInvoices = useMemo(
    () => candidates.filter((c) => selectedIds.has(c.id)),
    [candidates, selectedIds],
  );

  const selectedEventIds = Array.from(new Set(selectedInvoices.map((invoice) => invoice.event_id).filter(Boolean)));
  const linkedEventId = initialAdvanceInvoiceId
    ? sourceEventId
    : mode === 'event' ? eventId
    : selectedEventIds.length === 1 ? selectedEventIds[0] ?? null : null;
  const eventOrder = eventOrderState?.eventId === linkedEventId ? eventOrderState.order : null;
  const loadingEventOrder = Boolean(linkedEventId && eventOrderState?.eventId !== linkedEventId);
  const referenceInvoice = sourceAdvance ?? selectedInvoices[0];
  const currencyCode = referenceInvoice?.currency_code || eventOrder?.currencyCode || 'PLN';
  const eventOrderError = (eventOrderState?.eventId === linkedEventId ? eventOrderState.error : null)
    || (eventOrder && referenceInvoice && eventOrder.currencyCode !== currencyCode
      ? 'Waluta zamówienia wydarzenia różni się od waluty zaliczek. Sprawdź dokumenty przed rozliczeniem.' : null)
    || (eventOrder?.myCompanyId && referenceInvoice?.my_company_id && eventOrder.myCompanyId !== referenceInvoice.my_company_id
      ? 'Wydarzenie i zaliczki mają różne firmy wystawiające. Sprawdź rozliczenie wydarzenia.' : null);

  useEffect(() => {
    let cancelled = false;
    if (!linkedEventId) {
      setEventOrderState(null);
      return;
    }
    setEventOrderState(null);
    loadFinalInvoiceEventOrder(linkedEventId)
      .then((order) => {
        if (!cancelled) setEventOrderState({ eventId: linkedEventId, order, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) setEventOrderState({
          eventId: linkedEventId,
          order: null,
          error: error instanceof Error ? error.message : 'Nie udało się pobrać pełnego zamówienia wydarzenia.',
        });
      });
    return () => { cancelled = true; };
  }, [linkedEventId]);

  useEffect(() => {
    let cancelled = false;
    if (mode === 'organization' && organizationId) {
      supabase.from('organizations').select('name').eq('id', organizationId).maybeSingle()
        .then(({ data }) => { if (!cancelled) setLockedOrgName(data?.name ?? null); });
    }
    return () => { cancelled = true; };
  }, [mode, organizationId]);

  const snapshotInvoice = sourceAdvance ?? selectedInvoices[0];
  const snapshotItems = sourceOrderItems?.length ? sourceOrderItems : snapshotInvoice?.invoice_order_items;
  const fullValueItems = useMemo<FinalInvoiceItemInput[] | null>(() => {
    if (linkedEventId) return eventOrder && !eventOrderError ? eventOrder.items : null;
    if (!snapshotItems?.length) return null;
    return [...snapshotItems].sort((a, b) => Number(a.position_number ?? 0) - Number(b.position_number ?? 0)).map((item) => ({
      name: item.name || 'Rozliczenie usługi zgodnie z umową',
      unit: item.unit || 'szt.',
      quantity: Number(item.quantity ?? 1),
      price_net: Number(item.price_net ?? 0),
      vat_rate: Number(item.vat_rate ?? 23),
      vat_code: item.vat_code ?? String(item.vat_rate ?? 23) as FinalInvoiceItemInput['vat_code'],
      vat_exemption_reason: item.vat_exemption_reason ?? null,
    }));
  }, [linkedEventId, eventOrder, eventOrderError, snapshotItems]);

  const inheritedPresentation = useMemo(() => {
    if (!fullValueItems || !snapshotInvoice) return { items: fullValueItems, error: null };
    return inheritFinalInvoicePresentation({
      invoiceItems: snapshotInvoice.invoice_items || [],
      fullOrderItems: fullValueItems,
      snapshotItems,
    });
  }, [fullValueItems, snapshotInvoice, snapshotItems]);
  const orderItems = presentationMode === 'order' ? fullValueItems : inheritedPresentation.items;
  const presentationError = presentationMode === 'inherited' ? inheritedPresentation.error : null;
  const draftContext = `${initialAdvanceInvoiceId || ''}:${mode}:${eventId || ''}:${organizationId || ''}`;

  useEffect(() => {
    if (itemDraft.current.context !== draftContext && presentationMode !== 'inherited') {
      setPresentationMode('inherited');
      itemDraft.current = { context: draftContext, mode: 'inherited', edited: false };
      return;
    }
    if (itemDraft.current.context === draftContext && itemDraft.current.mode === presentationMode && itemDraft.current.edited) return;
    itemDraft.current = { context: draftContext, mode: presentationMode, edited: false };
    setEditingValues({});
    setItems(orderItems ?? [{ name: '', unit: 'szt.', quantity: 1, price_net: 0, vat_rate: 23 }]);
    setShowOrderItems(!orderItems && !linkedEventId);
  }, [orderItems, linkedEventId, draftContext, presentationMode]);

  

  useEffect(() => {
    if (companyTouched) return;

    const eventCompanyId = manualCompanyId;
    if (eventCompanyId) return;

    const companyIdsFromInvoices = Array.from(
      new Set(candidates.map((c) => c.my_company_id).filter(Boolean)),
    ) as string[];

    if (companyIdsFromInvoices.length === 1) {
      setManualCompanyId(companyIdsFromInvoices[0]);
      return;
    }

    if (companyIdsFromInvoices.length > 1) {
      showSnackbar(
        'Wybrane faktury zaliczkowe pochodzą z różnych firm. Nie można ich rozliczyć jedną fakturą końcową.',
        'error',
      );
      return;
    }

    const defaultCompany = myCompanies.find((c) => c.is_default) || myCompanies[0];

    if (defaultCompany?.id) {
      setManualCompanyId(defaultCompany.id);
    }
  }, [candidates, myCompanies, companyTouched, manualCompanyId, showSnackbar]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addItem = () => {
    itemDraft.current.edited = true;
    setItems((prev) => [
      ...prev,
      { name: '', unit: 'szt.', quantity: 1, price_net: 0, vat_rate: 23 },
    ]);
  };
  const removeItem = (idx: number) => {
    itemDraft.current.edited = true;
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };
  const updateItem = (idx: number, patch: Partial<FinalInvoiceItemInput>) => {
    itemDraft.current.edited = true;
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const updateGross = (idx: number, grossValue: number) => {
    itemDraft.current.edited = true;
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;

        const quantity = Number(it.quantity || 1);
        const vatRate = Number(it.vat_rate || 0);
        const gross = Number(grossValue || 0);

        const priceNet = quantity > 0 ? round2(gross / quantity / (1 + vatRate / 100)) : 0;

        return {
          ...it,
          price_net: priceNet,
        };
      }),
    );
  };

  const calculation = useMemo(
    () => calculateFinalInvoice(items, selectedInvoices),
    [items, selectedInvoices],
  );
  const { totals } = calculation;
  const { net: settledNet, vat: settledVat, gross: settledGross } = calculation.settled;
  const { net: remainingNet, vat: remainingVat, gross: remainingGross } = calculation.remaining;
  const formatAmount = (amount: number) => `${amount.toLocaleString('pl-PL', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })} ${currencyCode}`;
  const orderUnavailable = loadingCandidates || loadingEventOrder || Boolean(eventOrderError || presentationError);
  const eventOrderEdited = Boolean(orderItems && (
    items.length !== orderItems.length || items.some((item, index) => {
      const source = orderItems[index];
      return !source || item.name !== source.name || item.unit !== source.unit || item.quantity !== source.quantity || item.price_net !== source.price_net || item.vat_rate !== source.vat_rate;
    })
  ));
  const fillItemsFromOrder = () => {
    if (!orderItems) return;
    if (itemDraft.current.edited && !window.confirm('Przywrócić pozycje źródłowe? Zastąpi to zmiany wpisane w tym formularzu.')) return;
    itemDraft.current.edited = false;
    setEditingValues({});
    setItems(orderItems);
  };
  const changePresentation = (next: 'inherited' | 'order') => {
    if (itemDraft.current.edited && !window.confirm('Zmienić podstawę pozycji faktury? Zastąpi to zmiany wpisane w tym formularzu.')) return;
    itemDraft.current.edited = false;
    setPresentationMode(next);
  };

  const handleCreate = async () => {
    if (!paymentDueDate) {
      showSnackbar('Podaj poprawną datę wystawienia i termin płatności w pełnych dniach (0 lub więcej).', 'error');
      return;
    }
    if (orderUnavailable) {
      showSnackbar(eventOrderError || presentationError || 'Poczekaj na pobranie pełnego zamówienia i zaliczek.', 'error');
      return;
    }
    if (!Number.isFinite(totals.gross) || totals.gross <= 0) {
      showSnackbar('Uzupełnij pozycje pełnego zamówienia przed rozliczeniem zaliczek.', 'error');
      return;
    }

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

    if (remainingGross < -0.01) {
      showSnackbar('Suma zaliczek przekracza wartość faktury końcowej.', 'error');
      return;
    }

    const reference = selectedInvoices[0];
    if (sourceAdvance && selectedInvoices.some((invoice) => !matchesAdvanceContext(invoice, sourceAdvance))) {
      showSnackbar('Wybrane zaliczki muszą dotyczyć tego samego zamówienia, nabywcy i sprzedawcy.', 'error');
      return;
    }
    const normalizeNip = (value: string | null) => (value || '').replace(/\D/g, '');
    const incompatible = selectedInvoices.some((invoice) =>
      invoice.my_company_id !== reference.my_company_id ||
      normalizeNip(invoice.buyer_nip) !== normalizeNip(reference.buyer_nip) ||
      (invoice.currency_code || 'PLN') !== (reference.currency_code || 'PLN') ||
      (!initialAdvanceInvoiceId && mode !== 'event' && invoice.event_id !== reference.event_id) ||
      invoice.organization_id !== reference.organization_id
    );
    if (incompatible) {
      showSnackbar(
        'Wybrane zaliczki muszą mieć tego samego sprzedawcę, nabywcę, walutę, wspólne rozliczenie i płatnika.',
        'error',
      );
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
        issue_date: i.issue_date,
      }));

      const uniqueCompanyIds = Array.from(
        new Set(selectedInvoices.map((i) => i.my_company_id).filter(Boolean)),
      );

      if (uniqueCompanyIds.length > 1) {
        showSnackbar('Nie można wystawić faktury końcowej dla zaliczek z różnych firm.', 'error');
        return;
      }

      const selectedCompany = myCompanies.find((c) => c.id === myCompanyId);

      const result = await createFinalInvoice({
        eventId: linkedEventId || ref.event_id,
        organizationId: ref.organization_id,
        billingArrangement: ref.billing_arrangement || 'direct',
        serviceRecipientOrganizationId: ref.service_recipient_organization_id,
        serviceRecipientContactId: ref.service_recipient_contact_id,
        myCompanyId: myCompanyId || ref.my_company_id,

        customNumber: useCustomNumber ? customNumber : undefined,
        issueDate,
        saleDate,
        paymentDueDate,
        items,

        bankName: selectedCompany?.bank_name ?? ref.bank_name ?? null,
        bankAccount: selectedCompany?.bank_account ?? ref.bank_account ?? null,
        bankSwiftCode: selectedCompany?.bank_swift_code ?? null,

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
        currencyCode: ref.currency_code || 'PLN',
        issuePlace: ref.issue_place,
      });

      if (!result.success || !result.invoiceId) {
        throw new Error(result.error || 'Blad tworzenia faktury');
      }

      const settlementEventId = linkedEventId || ref.event_id;
      if (settlementEventId) {
        const { error: settlementLinkError } = await supabase.rpc(
          'link_invoice_to_event_settlement',
          {
            p_invoice_id: result.invoiceId,
            p_source_event_id: settlementEventId,
          },
        );
        if (settlementLinkError) {
          console.error('Error linking final invoice to settlement group:', settlementLinkError);
          showSnackbar(
            'Faktura końcowa powstała, ale nie udało się przypisać jej do całej grupy wydarzeń',
            'warning',
          );
        }
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
          {locked ? (
            <div className="rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/5 p-4">
              <div className="mb-1 text-xs uppercase tracking-wider text-[#d3bb73]">
                Kontekst faktury końcowej
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm text-[#e5e4e2]">
                {initialAdvanceInvoiceId && (
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-[#d3bb73]" />
                    Do zaliczki: <strong>{sourceAdvance?.invoice_number ?? 'Ładowanie…'}</strong>
                  </span>
                )}
                {linkedEventId && (
                  <span className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-[#d3bb73]" />
                    Wydarzenie: <strong>{eventOrder?.eventName ?? sourceAdvance?.event?.name ?? 'Ładowanie…'}</strong>
                  </span>
                )}
                {initialOrganizationId && (
                  <span className="flex items-center gap-2">
                    <Building className="h-4 w-4 text-[#d3bb73]" />
                    Podmiot: <strong>{lockedOrgName ?? '...'}</strong>
                  </span>
                )}
              </div>
              {initialAdvanceInvoiceId && (
                <p className="mt-2 text-xs text-[#e5e4e2]/60">
                  Wybrano nierozliczone zaliczki powiązane z tym zamówieniem. Możesz zmienić ich wybór poniżej.
                </p>
              )}
            </div>
          ) : (
            <>
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
            </>
          )}

          {myCompanies.length > 1 && (
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                <Building2 className="h-4 w-4 text-[#d3bb73]" />
                Firma wystawiajaca fakture
              </label>
              <select
                value={manualCompanyId || ''}
                disabled={Boolean(initialAdvanceInvoiceId)}
                onChange={(e) => {
                  setCompanyTouched(true);
                  setManualCompanyId(e.target.value || null);
                }}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              >
                {myCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (NIP: {c.nip}){c.is_default ? ' *' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <section aria-label="Podsumowanie rozliczenia" className="space-y-3">
            {loadingEventOrder ? (
              <p role="status" className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                <Loader className="h-4 w-4 animate-spin" /> Pobieranie pełnego zamówienia z wydarzenia…
              </p>
            ) : eventOrderError ? (
              <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{eventOrderError}</p>
            ) : (
              <p className="text-sm text-[#e5e4e2]/65">
                {eventOrder
                  ? `Źródło kwot: ${eventOrder.sourceLabel}. Pełna wartość została pobrana z ${eventOrder.eventIds.length > 1 ? 'wydarzeń we wspólnym rozliczeniu' : 'powiązanego wydarzenia'} z uwzględnieniem uzgodnionych rabatów.`
                  : orderItems
                    ? 'Źródło kwot: pełne zamówienie zapisane przy dokumentach. Zaliczki pomniejszają wyłącznie kwotę do zapłaty.'
                    : 'Brak powiązanego zamówienia. Uzupełnij jego pełne pozycje poniżej — kwota zaliczki nie określa wartości całej usługi.'}
              </p>
            )}
            {snapshotInvoice && fullValueItems && !eventOrderError && (
              <div className="space-y-2 rounded-lg bg-[#d3bb73]/5 p-3 text-sm">
                <p className="text-[#e5e4e2]/70">
                  {presentationMode === 'inherited'
                    ? `Pozycje faktury: nazwy, jednostki i układ z zaliczki ${snapshotInvoice.invoice_number}. Kwoty obejmują pełne zamówienie, nie tylko wpłaconą zaliczkę.`
                    : 'Pozycje faktury: wybrane jawnie z pełnego zamówienia. Zastępują układ zapisany na zaliczce.'}
                </p>
                {presentationError && <p role="alert" className="text-red-300">{presentationError}</p>}
                <button
                  type="button"
                  disabled={creating || loadingCandidates || loadingEventOrder}
                  onClick={() => changePresentation(presentationMode === 'inherited' ? 'order' : 'inherited')}
                  className="rounded-md bg-[#d3bb73]/10 px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/15 disabled:opacity-50"
                >
                  {presentationMode === 'inherited'
                    ? eventOrder ? 'Zamiast tego użyj pozycji z wydarzenia' : 'Zamiast tego użyj pozycji pełnego zamówienia'
                    : 'Przywróć nazwy i układ z zaliczki'}
                </button>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3" aria-live="polite">
              <div className="rounded-lg bg-[#0a0d1a]/40 p-4">
                <p className="text-sm text-[#e5e4e2]/65">Pełna wartość zamówienia</p>
                <p className="mt-2 text-xl font-semibold text-[#e5e4e2]">{orderUnavailable ? '—' : formatAmount(totals.gross)}</p>
                <p className="mt-1 text-xs text-[#e5e4e2]/50">{orderUnavailable ? 'Oczekiwanie na dane zamówienia' : `Netto ${formatAmount(totals.net)} · VAT ${formatAmount(totals.vat)}`}</p>
              </div>
              <div className="rounded-lg bg-[#0a0d1a]/40 p-4">
                <p className="text-sm text-[#e5e4e2]/65">Wybrane zaliczki ({selectedInvoices.length})</p>
                <p className="mt-2 text-xl font-semibold text-[#e5e4e2]">{loadingCandidates ? '—' : formatAmount(settledGross)}</p>
                <p className="mt-1 text-xs text-[#e5e4e2]/50">Netto {formatAmount(settledNet)} · VAT {formatAmount(settledVat)}</p>
              </div>
              <div className="rounded-lg bg-[#d3bb73]/10 p-4">
                <p className="text-sm text-[#d3bb73]">Pozostało do zapłaty</p>
                <p className="mt-2 text-xl font-semibold text-[#d3bb73]">{orderUnavailable ? '—' : formatAmount(remainingGross)}</p>
                <p className="mt-1 text-xs text-[#e5e4e2]/50">{orderUnavailable ? 'Wartość zamówienia minus zaliczki' : `Netto ${formatAmount(remainingNet)} · VAT ${formatAmount(remainingVat)}`}</p>
              </div>
            </div>
            {!orderUnavailable && selectedInvoices.length > 0 && (
              <p className={`text-sm ${remainingGross < -0.01 ? 'text-red-300' : 'text-[#e5e4e2]/65'}`}>
                {remainingGross < -0.01
                  ? 'Wybrane zaliczki przekraczają wartość zamówienia. Sprawdź wybór dokumentów i uzgodnioną kwotę.'
                  : Math.abs(remainingGross) < 0.01
                    ? 'Zaliczki pokrywają całość zamówienia. Faktura końcowa nie będzie wymagać dopłaty.'
                    : 'Faktura końcowa obejmie całe zamówienie. Klient dopłaci tylko pozostałą kwotę.'}
              </p>
            )}
            {eventOrderEdited && !orderUnavailable && (
              <p className="text-sm text-[#d3bb73]">Zmieniono pozycje na fakturze. Podsumowanie uwzględnia te zmiany; wartość zapisana w wydarzeniu pozostaje bez zmian.</p>
            )}
          </section>

          <div>
            <div className="mb-2 text-sm text-[#e5e4e2]/60">
              Wybierz zaliczki do rozliczenia ({candidates.length})
            </div>
            <div className="overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a]">
              {candidatesError ? (
                <div role="alert" className="px-4 py-6 text-center text-sm text-red-300">
                  {candidatesError}
                </div>
              ) : loadingCandidates ? (
                <div className="px-4 py-6 text-center text-sm text-[#e5e4e2]/50">Ladowanie...</div>
              ) : candidates.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-[#e5e4e2]/50">
                  Brak nierozliczonych faktur zaliczkowych w tym kontekście
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
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleSelect(c.id)}
                              className="h-4 w-4 accent-[#d3bb73]"
                            />
                          </td>
                          <td className="px-3 py-2 text-[#e5e4e2]">
                            {c.invoice_number}
                            {Number(c.paid_amount || 0) < Number(c.total_gross) - 0.01 && (
                              <div className="mt-1 text-xs text-[#e5e4e2]/50">
                                Wpłata zostanie zweryfikowana przy wystawieniu
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-[#e5e4e2]/70">Zaliczkowa</td>
                          <td className="px-3 py-2 text-[#e5e4e2]/70">{systemLabel(c.status)}</td>
                          <td className="px-3 py-2 text-[#e5e4e2]/70">{c.issue_date}</td>
                          <td className="px-3 py-2 text-right font-medium text-[#e5e4e2]">
                            {Number(c.total_gross).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {c.currency_code || 'PLN'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-[#0a0d1a]/20 p-4">
            <button
              type="button"
              onClick={() => setShowOrderItems((value) => !value)}
              aria-expanded={showOrderItems}
              aria-controls="final-invoice-order-items"
              className="flex w-full items-center justify-between gap-3 text-left text-sm text-[#e5e4e2]"
            >
              <span>Edycja pozycji faktury — całe zamówienie ({items.length})</span>
              <span className="text-[#d3bb73]">{showOrderItems ? 'Zwiń edycję' : 'Edytuj pozycje'}</span>
            </button>
            {showOrderItems && (
              <fieldset id="final-invoice-order-items" disabled={creating || orderUnavailable} className="mt-4 min-w-0 space-y-3 disabled:opacity-60">
              <p className="text-sm text-[#e5e4e2]/60">
                {snapshotInvoice && presentationMode === 'inherited'
                  ? `Zachowano pozycje z zaliczki ${snapshotInvoice.invoice_number} i przeliczono je do pełnej wartości zamówienia. Nie pomniejszaj ich o zaliczki — są odliczane automatycznie.`
                  : 'Pozycje obejmują całą usługę, także część pokrytą zaliczkami. Zaliczki są odliczane automatycznie.'}
              </p>
              {eventOrder?.notice && <p className="text-xs text-[#e5e4e2]/50">{eventOrder.notice}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                {orderItems && <button
                  type="button"
                  onClick={fillItemsFromOrder}
                  data-crm-action="secondary"
                  className="rounded-md bg-[#d3bb73]/10 px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/15"
                >
                  {presentationMode === 'inherited' && snapshotInvoice ? 'Przywróć pozycje odziedziczone z zaliczki' : 'Przywróć pozycje pełnego zamówienia'}
                </button>}
                <button data-crm-action="secondary"
                type="button"
                onClick={addItem}
                className="flex items-center gap-1 rounded-md bg-[#d3bb73]/10 px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/15"
              >
                <Plus className="h-3 w-3" /> Dodaj pozycję
              </button>
              </div>
            <div className="overflow-x-auto rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a]">
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
                    const valueNet = round2(it.quantity * it.price_net);
                    const valueGross = round2(valueNet + round2(valueNet * it.vat_rate / 100));
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
                            onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                            className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-right text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={
                              editingValues[`net-${idx}`] ?? String(it.price_net).replace('.', ',')
                            }
                            onChange={(e) => {
                              const value = normalizeDecimalInput(e.target.value);

                              setEditingValues((prev) => ({
                                ...prev,
                                [`net-${idx}`]: value,
                              }));

                              if (value === '' || value === '-' || value.endsWith(',')) return;

                              updateItem(idx, {
                                price_net: parseDecimalInput(value),
                              });
                            }}
                            onBlur={() => {
                              const raw = editingValues[`net-${idx}`];

                              if (raw == null) return;

                              const parsed = parseDecimalInput(raw);

                              updateItem(idx, {
                                price_net: parsed,
                              });

                              setEditingValues((prev) => {
                                const next = { ...prev };
                                delete next[`net-${idx}`];
                                return next;
                              });
                            }}
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
                            onChange={(e) => updateItem(idx, { vat_rate: Number(e.target.value) })}
                            className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-right text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={editingValues[`gross-${idx}`] ?? formatDecimalInput(valueGross)}
                            onChange={(e) => {
                              const value = normalizeDecimalInput(e.target.value);

                              setEditingValues((prev) => ({
                                ...prev,
                                [`gross-${idx}`]: value,
                              }));

                              if (value === '' || value === '-' || value.endsWith(',')) return;

                              updateGross(idx, parseDecimalInput(value));
                            }}
                            onBlur={() => {
                              const raw = editingValues[`gross-${idx}`];

                              if (raw == null) return;

                              updateGross(idx, parseDecimalInput(raw));

                              setEditingValues((prev) => {
                                const next = { ...prev };
                                delete next[`gross-${idx}`];
                                return next;
                              });
                            }}
                            className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-right text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            disabled={items.length === 1}
                            className="rounded p-1 text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-60"
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
              </fieldset>
            )}
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
                <label htmlFor="final-invoice-payment-days" className="mb-2 block text-xs text-[#e5e4e2]/60">Termin płatności (dni)</label>
                <input
                  id="final-invoice-payment-days"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={paymentTermDays}
                  onChange={(e) => setPaymentTermDays(e.target.value)}
                  aria-invalid={!paymentDueDate}
                  aria-describedby="final-invoice-payment-days-description"
                  className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-2 py-2 text-sm text-[#e5e4e2] focus:bg-[#d3bb73]/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#d3bb73]/30"
                />
                <p id="final-invoice-payment-days-description" className={`mt-2 text-xs ${paymentDueDate ? 'text-[#e5e4e2]/60' : 'text-red-300'}`}>
                  {paymentDueDate
                    ? `Od daty wystawienia · do ${paymentDueDate.split('-').reverse().join('.')}`
                    : 'Podaj pełną liczbę dni od 0 oraz poprawną datę wystawienia.'}
                </p>
              </div>
            </div>
          </div>

          <FinalInvoicePreview
            calculation={calculation}
            advances={selectedInvoices}
            invoiceNumber={useCustomNumber ? customNumber : autoPreview}
            automaticNumber={!useCustomNumber}
            issueDate={issueDate}
            saleDate={saleDate}
            paymentDueDate={paymentDueDate}
            currencyCode={currencyCode}
            buyerName={selectedInvoices[0]?.buyer_name}
            buyerNip={selectedInvoices[0]?.buyer_nip}
            sellerName={selectedInvoices[0]?.seller_name}
            sellerNip={selectedInvoices[0]?.seller_nip}
            unavailableMessage={eventOrderError || presentationError || candidatesError || (orderUnavailable
              ? 'Podgląd pojawi się po pobraniu pełnego zamówienia i zaliczek.'
              : !selectedInvoices.length ? 'Wybierz zaliczki do rozliczenia, aby zobaczyć treść faktury końcowej.' : null)}
            onEditItems={() => {
              setShowOrderItems(true);
              window.requestAnimationFrame(() => {
                document.getElementById('final-invoice-order-items')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              });
            }}
          />
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
            disabled={creating || orderUnavailable || !paymentDueDate || !selectedInvoices.length || totals.gross <= 0 || remainingGross < -0.01}
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
