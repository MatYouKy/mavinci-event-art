'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Briefcase,
  Calculator,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  Save,
  Sparkles,
  Target,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import ComposeEmailModal from '@/components/crm/ComposeEmailModal';
import { CalculationEditor } from '@/components/crm/events/calculations/CalculationEditor';
import InquirySourceContextPanel from '@/components/crm/inquiries/InquirySourceContextPanel';
import { sendTaskAssignmentPush } from '@/lib/CRM/tasks/sendTaskAssignmentPush';

type Tab = 'overview' | 'tasks' | 'offers' | 'calculations' | 'history';

type Recommendation = {
  summary: string;
  event_assumptions: string;
  event_goal: string;
  preliminary_estimate: {
    min_net: number;
    max_net: number;
    summary: string;
    basis: string[];
  };
  missing_information: string[];
  suggested_products: Array<{ product_id: string; name: string; reason: string }>;
  suggested_resources: Array<{ resource_id: string; name: string; reason: string }>;
  next_actions: string[];
  risks: string[];
};

type InquiryBriefDraft = {
  event_assumptions: string;
  event_goal: string;
  preliminary_budget_min: string;
  preliminary_budget_max: string;
  preliminary_budget_text: string;
};

const createInquiryBriefDraft = (inquiry: any): InquiryBriefDraft => {
  const details = inquiry?.inquiry_details || {};
  return {
    event_assumptions: String(details.event_assumptions || ''),
    event_goal: String(details.event_goal || ''),
    preliminary_budget_min: details.preliminary_budget_min !== null && details.preliminary_budget_min !== undefined
      ? String(details.preliminary_budget_min)
      : '',
    preliminary_budget_max: details.preliminary_budget_max !== null && details.preliminary_budget_max !== undefined
      ? String(details.preliminary_budget_max)
      : '',
    preliminary_budget_text: String(details.preliminary_budget_text || ''),
  };
};

const STAGE_LABELS: Record<string, string> = {
  new: 'Nowe zapytanie',
  contacted: 'Kontakt podjęty',
  qualified: 'Zakwalifikowane',
  proposal: 'Oferta',
  negotiation: 'Negocjacje',
  won: 'Wygrane',
  lost: 'Przegrane',
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const formatMoney = (value?: number | null) => new Intl.NumberFormat('pl-PL', {
  style: 'currency', currency: 'PLN', maximumFractionDigits: 0,
}).format(Number(value || 0));

const toLocalInput = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const friendlyAssistantError = (status: number) => {
  if (status === 401) return 'Sesja wygasła. Zaloguj się ponownie.';
  if (status === 403 || status === 404) return 'Nie masz dostępu do tego zapytania.';
  if (status === 429) return 'Limit usługi AI został chwilowo przekroczony. Spróbuj ponownie za moment.';
  if (status === 503) return 'Asystent AI nie jest obecnie skonfigurowany lub dostępny.';
  return 'Nie udało się przeanalizować zapytania. Spróbuj ponownie.';
};

const isTransientDataError = (error: unknown) => {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return message.includes('<!doctype html')
    || message.includes('connection timed out')
    || message.includes('error code 522')
    || message.includes('fetch failed')
    || message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('service unavailable')
    || message.includes('gateway timeout');
};

const friendlyDataError = (error: unknown, fallback: string) => {
  if (isTransientDataError(error)) {
    return 'Baza danych chwilowo nie odpowiada. Operację można bezpiecznie ponowić za moment.';
  }
  const message = String((error as any)?.message || '').trim();
  if (!message || message.length > 180 || /<[^>]+>/.test(message)) return fallback;
  return message;
};

const fileToAttachment = async (file: File) => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return {
    filename: file.name,
    content: dataUrl.split(',')[1] || '',
    contentType: file.type || 'application/octet-stream',
    contentDisposition: 'attachment',
  };
};

export default function InquiryWorkspaceClient({ initialData }: { initialData: any }) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { employee, isAdmin, hasScope } = useCurrentEmployee();
  const [data, setData] = useState(initialData);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showConversionModal, setShowConversionModal] = useState(false);
  const [creatingOffer, setCreatingOffer] = useState(false);
  const [creatingCalculation, setCreatingCalculation] = useState(false);
  const [activeCalculationId, setActiveCalculationId] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [loadingRecommendation, setLoadingRecommendation] = useState(false);
  const [briefDraft, setBriefDraft] = useState<InquiryBriefDraft>(() => createInquiryBriefDraft(initialData.inquiry));
  const [briefDirty, setBriefDirty] = useState(false);
  const [savingBrief, setSavingBrief] = useState(false);
  const [assistantAutoError, setAssistantAutoError] = useState('');
  const creatingOfferRef = useRef(false);
  const pendingOfferIdRef = useRef<string | null>(null);
  const pendingContactIdRef = useRef<string | null>(null);
  const automaticAnalysisRef = useRef<string | null>(null);
  const briefDraftRef = useRef<InquiryBriefDraft>(createInquiryBriefDraft(initialData.inquiry));

  useEffect(() => {
    const nextBrief = createInquiryBriefDraft(initialData.inquiry);
    setData(initialData);
    setBriefDraft(nextBrief);
    briefDraftRef.current = nextBrief;
    setBriefDirty(false);
  }, [initialData]);

  const inquiry = data.inquiry;
  const details = inquiry.inquiry_details || {};
  const canManage = isAdmin
    || hasScope('inquiries_manage_all')
    || (inquiry.inquiry_owner_id === employee?.id && (hasScope('inquiries_manage') || hasScope('inquiries_manage_own')))
    || Boolean(
      employee?.is_sales_team_manager
      && employee.sales_team_id
      && inquiry.inquiry_owner?.sales_team_id === employee.sales_team_id
      && hasScope('inquiries_manage_team'),
    );
  const clientEmail = inquiry.contact?.email || inquiry.organization?.email || details.client_email || '';
  const clientPhone = inquiry.contact?.mobile || inquiry.contact?.phone || inquiry.organization?.phone || details.client_phone || '';
  const clientName = inquiry.contact?.full_name
    || inquiry.organization?.alias
    || inquiry.organization?.name
    || details.client_text
    || inquiry.title.replace(/^Zapytanie:\s*/i, '');
  const sourceMessage = details.source_message_content || inquiry.description || '';
  const sourceHref = details.received_email_id
    ? `/crm/messages/${details.received_email_id}?type=received`
    : details.source_message_id
      ? `/crm/messages/${details.source_message_id}?type=contact`
      : null;

  const calculationContext = useMemo(() => ({
    inquiryId: inquiry.id,
    name: inquiry.title.replace(/^Zapytanie:\s*/i, ''),
    date: details.termin || inquiry.due_date || null,
    contactPerson: {
      id: inquiry.contact_id || inquiry.id,
      name: clientName,
      email: clientEmail || null,
      phone: clientPhone || null,
    },
  }), [clientEmail, clientName, clientPhone, details.termin, inquiry.due_date, inquiry.id, inquiry.title, inquiry.contact_id]);

  const reload = () => router.refresh();

  const invokeAssistant = async (payload: Record<string, unknown>) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/assist-inquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ inquiryId: inquiry.id, ...payload }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('assist-inquiry failed', { status: response.status, code: result.error_code });
      throw new Error(friendlyAssistantError(response.status));
    }
    return result.result;
  };

  const updateBriefField = (field: keyof InquiryBriefDraft, value: string) => {
    setBriefDraft((current) => {
      const next = { ...current, [field]: value };
      briefDraftRef.current = next;
      return next;
    });
    setBriefDirty(true);
  };

  const saveInquiryBrief = async (
    draft: InquiryBriefDraft = briefDraftRef.current,
    options: { quiet?: boolean; fromAssistant?: boolean } = {},
  ) => {
    if (!canManage) return false;
    const min = draft.preliminary_budget_min.trim() === '' ? null : Number(draft.preliminary_budget_min);
    const max = draft.preliminary_budget_max.trim() === '' ? null : Number(draft.preliminary_budget_max);
    if ((min !== null && (!Number.isFinite(min) || min < 0)) || (max !== null && (!Number.isFinite(max) || max < 0))) {
      if (!options.quiet) showSnackbar('Widełki kosztorysu muszą być poprawnymi kwotami.', 'warning');
      return false;
    }
    if (min !== null && max !== null && min > max) {
      if (!options.quiet) showSnackbar('Dolna granica kosztorysu nie może być wyższa od górnej.', 'warning');
      return false;
    }

    setSavingBrief(true);
    try {
      const nextDetails = {
        ...(data.inquiry.inquiry_details || {}),
        event_assumptions: draft.event_assumptions.trim() || null,
        event_goal: draft.event_goal.trim() || null,
        preliminary_budget_min: min,
        preliminary_budget_max: max,
        preliminary_budget_text: draft.preliminary_budget_text.trim() || null,
        preliminary_budget_currency: 'PLN',
        ...(options.fromAssistant ? { assistant_analysis_generated_at: new Date().toISOString() } : {}),
      };
      const estimatedValue = min !== null && max !== null
        ? Math.round((min + max) / 2)
        : (max ?? min ?? null);
      const { error } = await supabase
        .from('tasks')
        .update({ inquiry_details: nextDetails, estimated_value: estimatedValue })
        .eq('id', inquiry.id)
        .eq('is_inquiry', true);
      if (error) throw error;

      const normalizedDraft = createInquiryBriefDraft({ inquiry_details: nextDetails });
      setData((current: any) => ({
        ...current,
        inquiry: { ...current.inquiry, inquiry_details: nextDetails, estimated_value: estimatedValue },
      }));
      setBriefDraft(normalizedDraft);
      briefDraftRef.current = normalizedDraft;
      setBriefDirty(false);
      if (!options.quiet) showSnackbar('Założenia i wstępny kosztorys zostały zapisane.', 'success');
      return true;
    } catch (error: unknown) {
      const message = friendlyDataError(error, 'Nie udało się zapisać roboczych danych zapytania.');
      if (!options.quiet) showSnackbar(message, 'error');
      else setAssistantAutoError(message);
      return false;
    } finally {
      setSavingBrief(false);
    }
  };

  const loadRecommendation = async ({ automatic = false }: { automatic?: boolean } = {}) => {
    setLoadingRecommendation(true);
    setAssistantAutoError('');
    try {
      const result = await invokeAssistant({ action: 'recommend' }) as Recommendation;
      setRecommendation(result);

      // AI uzupełnia tylko puste pola. Ręcznie zatwierdzona treść użytkownika
      // pozostaje źródłem prawdy także po ponownej analizie zapytania.
      const currentBrief = briefDraftRef.current;
      const nextDraft: InquiryBriefDraft = {
        event_assumptions: currentBrief.event_assumptions.trim() || result.event_assumptions,
        event_goal: currentBrief.event_goal.trim() || result.event_goal,
        preliminary_budget_min: currentBrief.preliminary_budget_min.trim() || String(result.preliminary_estimate.min_net),
        preliminary_budget_max: currentBrief.preliminary_budget_max.trim() || String(result.preliminary_estimate.max_net),
        preliminary_budget_text: currentBrief.preliminary_budget_text.trim() || [
          result.preliminary_estimate.summary,
          ...result.preliminary_estimate.basis.map((item) => `• ${item}`),
        ].filter(Boolean).join('\n'),
      };
      setBriefDraft(nextDraft);
      briefDraftRef.current = nextDraft;
      setBriefDirty(true);
      await saveInquiryBrief(nextDraft, { quiet: true, fromAssistant: true });
    } catch (error: any) {
      const message = error.message || 'Nie udało się przygotować sugestii.';
      if (automatic) setAssistantAutoError(message);
      else showSnackbar(message, 'error');
    } finally {
      setLoadingRecommendation(false);
    }
  };

  useEffect(() => {
    if (!canManage || automaticAnalysisRef.current === inquiry.id) return;
    const hasCompleteBrief = Boolean(
      briefDraft.event_assumptions.trim()
      && briefDraft.event_goal.trim()
      && briefDraft.preliminary_budget_min.trim()
      && briefDraft.preliminary_budget_max.trim()
      && briefDraft.preliminary_budget_text.trim(),
    );
    if (hasCompleteBrief) return;
    automaticAnalysisRef.current = inquiry.id;
    void loadRecommendation({ automatic: true });
    // Automatyczna analiza ma wystartować raz dla danego zapytania. Kolejne próby
    // pozostają pod kontrolą użytkownika przez przycisk „Przeanalizuj ponownie”.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, inquiry.id]);

  const ensureContact = async () => {
    if (inquiry.contact_id) return inquiry.contact_id as string;
    const sourceName = String(details.client_text || clientName || '').trim();
    const parts = sourceName.split(/\s+/).filter(Boolean);
    const fallback = String(clientEmail || 'Nowy kontakt').split('@')[0].replace(/[._-]+/g, ' ');
    const firstName = parts[0] || fallback || 'Nowy';
    const lastName = parts.slice(1).join(' ') || '(zapytanie)';
    const contactId = pendingContactIdRef.current || crypto.randomUUID();
    pendingContactIdRef.current = contactId;
    const contactPayload = {
      id: contactId,
      first_name: firstName,
      last_name: lastName,
      email: clientEmail || null,
      phone: clientPhone || null,
      lifecycle_status: 'prospect',
      created_by: employee?.id || null,
      notes: `Kontakt utworzony z zapytania ${inquiry.id}`,
    };
    const { error } = await supabase
      .from('contacts')
      .upsert(contactPayload, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
    const { error: linkError } = await supabase.from('tasks').update({ contact_id: contactId }).eq('id', inquiry.id);
    if (linkError) throw linkError;
    const contact = { ...contactPayload, full_name: `${firstName} ${lastName}`.trim() };
    setData((current: any) => ({ ...current, inquiry: { ...current.inquiry, contact_id: contactId, contact } }));
    showSnackbar('Klient został dodany i powiązany z zapytaniem', 'success');
    return contactId;
  };

  const createOffer = async () => {
    if (creatingOfferRef.current) return;
    creatingOfferRef.current = true;
    setCreatingOffer(true);
    try {
      if (inquiry.linked_offer_id) {
        router.push(`/crm/offers/${inquiry.linked_offer_id}`);
        return;
      }
      const contactId = inquiry.organization_id ? null : await ensureContact();
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 14);
      const offerId = pendingOfferIdRef.current || crypto.randomUUID();
      pendingOfferIdRef.current = offerId;
      const { error } = await supabase.from('offers').upsert({
        id: offerId,
        inquiry_id: inquiry.id,
        event_id: inquiry.event_id || null,
        client_type: inquiry.organization_id ? 'business' : 'individual',
        organization_id: inquiry.organization_id || null,
        contact_id: inquiry.organization_id ? inquiry.contact_id || null : contactId,
        valid_until: validUntil.toISOString(),
        status: 'draft',
        total_amount: 0,
        created_by: employee?.id || null,
        event_location: details.location_text || null,
        event_assumptions: details.event_assumptions || details.scope || null,
        event_goal: details.event_goal || null,
      }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw error;
      const { error: linkError } = await supabase
        .from('tasks')
        .update({ linked_offer_id: offerId })
        .eq('id', inquiry.id);
      if (linkError) throw linkError;
      setData((current: any) => ({
        ...current,
        inquiry: { ...current.inquiry, linked_offer_id: offerId },
      }));
      showSnackbar('Szkic oferty został utworzony', 'success');
      router.push(`/crm/offers/${offerId}`);
    } catch (error: unknown) {
      console.error('create inquiry offer failed', {
        transient: isTransientDataError(error),
        code: (error as any)?.code,
        message: String((error as any)?.message || '').slice(0, 240),
        details: String((error as any)?.details || '').slice(0, 240),
      });
      showSnackbar(friendlyDataError(error, 'Nie udało się utworzyć oferty.'), 'error');
    } finally {
      creatingOfferRef.current = false;
      setCreatingOffer(false);
    }
  };

  const createCalculation = async () => {
    setCreatingCalculation(true);
    try {
      const { data: calculation, error } = await supabase.from('event_calculations').insert({
        event_id: inquiry.event_id || null,
        inquiry_id: inquiry.id,
        name: `Kalkulacja — ${inquiry.title.replace(/^Zapytanie:\s*/i, '')}`,
        created_by: employee?.id || null,
      }).select('id').single();
      if (error) throw error;
      setActiveTab('calculations');
      setActiveCalculationId(calculation.id);
      showSnackbar('Kalkulacja została utworzona', 'success');
    } catch (error: any) {
      showSnackbar(error.message || 'Nie udało się utworzyć kalkulacji', 'error');
    } finally {
      setCreatingCalculation(false);
    }
  };

  const sendEmail = async (message: any) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Brak aktywnej sesji');
    const attachments = await Promise.all((message.attachments || []).map(fileToAttachment));
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        emailAccountId: message.fromAccountId,
        to: message.to,
        cc: message.cc,
        bcc: message.bcc,
        subject: message.subject,
        body: message.bodyHtml,
        attachments,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || result.message || 'Nie udało się wysłać wiadomości');
    await supabase.from('tasks').update({
      last_contact_at: new Date().toISOString(),
      inquiry_stage: inquiry.inquiry_stage === 'new' ? 'contacted' : inquiry.inquiry_stage,
    }).eq('id', inquiry.id);
    showSnackbar('Wiadomość została wysłana i zapisana jako kontakt', 'success');
    reload();
  };

  const actions = [
    { label: 'Nowe zadanie', icon: <ClipboardList className="h-4 w-4" />, onClick: () => setShowTaskModal(true), show: canManage },
    { label: 'Kalkulacja', icon: creatingCalculation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />, onClick: () => void createCalculation(), disabled: creatingCalculation, show: canManage },
    { label: 'Oferta', icon: creatingOffer ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />, onClick: () => void createOffer(), disabled: creatingOffer, show: canManage, variant: 'primary' as const },
    { label: 'Napisz e-mail', icon: <Mail className="h-4 w-4" />, onClick: () => setShowEmailModal(true), disabled: !clientEmail, show: canManage },
    { label: inquiry.event_id ? 'Otwórz wydarzenie' : 'Utwórz wydarzenie', icon: <Briefcase className="h-4 w-4" />, onClick: () => inquiry.event_id ? router.push(`/crm/events/${inquiry.event_id}`) : setShowConversionModal(true), show: canManage },
  ];

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'overview', label: 'Podsumowanie' },
    { id: 'tasks', label: 'Zadania', count: data.tasks.length },
    { id: 'offers', label: 'Oferty', count: data.offers.length },
    { id: 'calculations', label: 'Kalkulacje', count: data.calculations.length },
    { id: 'history', label: 'Historia', count: data.history.length },
  ];

  if (activeCalculationId) {
    return (
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <InquirySourceContextPanel
          inquiryTitle={inquiry.title.replace(/^Zapytanie:\s*/i, '')}
          message={sourceMessage}
          sourceLabel={details.source || details.source_name || 'Zapytanie'}
          clientName={clientName}
          clientEmail={clientEmail}
          clientPhone={clientPhone}
          sourceHref={sourceHref}
          items={[
            { label: 'Termin', value: details.termin || inquiry.due_date, kind: 'date' },
            { label: 'Miejsce', value: details.location_text, kind: 'location' },
            { label: 'Zakres', value: details.scope || details.event_type, kind: 'scope' },
          ]}
          className="xl:sticky xl:top-4 xl:self-start"
        />
        <div className="min-w-0">
          <CalculationEditor
            calculationId={activeCalculationId}
            eventId={inquiry.event_id || null}
            inquiryContext={calculationContext}
            onBack={() => { setActiveCalculationId(null); reload(); }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link href="/crm/inquiries" className="mb-3 inline-flex items-center gap-2 text-sm text-[#e5e4e2]/50 hover:text-[#d3bb73]"><ArrowLeft className="h-4 w-4" />Wróć do lejka</Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-light text-[#e5e4e2]">{inquiry.title.replace(/^Zapytanie:\s*/i, '')}</h1>
            <span className="rounded-full border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-3 py-1 text-xs text-[#d3bb73]">{STAGE_LABELS[inquiry.inquiry_stage] || inquiry.inquiry_stage}</span>
          </div>
          <p className="mt-2 text-sm text-[#e5e4e2]/45">Zapytanie #{inquiry.id.slice(0, 8)} · utworzone {formatDate(inquiry.created_at)}</p>
        </div>
        <ResponsiveActionBar actions={actions} disabledBackground={false} />
      </div>

      <div className="overflow-x-auto border-b border-[#d3bb73]/10">
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`border-b-2 px-4 py-3 text-sm transition-colors ${activeTab === tab.id ? 'border-[#d3bb73] text-[#d3bb73]' : 'border-transparent text-[#e5e4e2]/50 hover:text-[#e5e4e2]'}`}>
              {tab.label}{typeof tab.count === 'number' && <span className="ml-2 rounded-full bg-[#1c1f33] px-2 py-0.5 text-xs">{tab.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'overview' && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
          <div className="space-y-6">
            <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <h2 className="text-lg font-light text-[#e5e4e2]">Treść i potrzeby klienta</h2>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[#e5e4e2]/70">{details.source_message_content || inquiry.description || 'Brak treści zapytania.'}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Info icon={CalendarClock} label="Termin" value={details.termin || inquiry.due_date} format="date" />
                <Info icon={MapPin} label="Miejsce" value={details.location_text} />
                <Info icon={Target} label="Zakres" value={details.scope || details.event_type} />
                <Info icon={CircleDollarSign} label="Budżet / wartość" value={inquiry.estimated_value ? formatMoney(inquiry.estimated_value) : details.budget} />
              </div>
            </section>

            <section className="rounded-xl border border-violet-400/15 bg-violet-400/5 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div><h2 className="flex items-center gap-2 text-lg font-light text-violet-100"><Sparkles className="h-5 w-5" />Asystent zapytania</h2><p className="mt-1 text-sm text-violet-100/55">Asystent sam tworzy roboczy brief i widełki netto na podstawie zapytania oraz aktualnego katalogu. Każde pole możesz poprawić ręcznie.</p></div>
                <button type="button" onClick={() => void loadRecommendation()} disabled={loadingRecommendation || savingBrief || !canManage} className="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-300/25 bg-violet-300/10 px-4 py-2 text-sm text-violet-100 hover:bg-violet-300/15 disabled:opacity-50">{loadingRecommendation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{recommendation ? 'Przeanalizuj ponownie' : 'Przeanalizuj zapytanie'}</button>
              </div>

              <div className="mt-5 rounded-xl border border-violet-300/10 bg-[#0f1119] p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-violet-100">Robocze dane wydarzenia</h3>
                    <p className="mt-1 text-xs text-[#e5e4e2]/40">Zapisane dane są później wykorzystywane przy tworzeniu oferty.</p>
                  </div>
                  {loadingRecommendation && <span className="inline-flex items-center gap-2 text-xs text-violet-200/70"><Loader2 className="h-3.5 w-3.5 animate-spin" />AI przygotowuje propozycję…</span>}
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-[#d3bb73]/70">Założenia wydarzenia</span>
                    <textarea value={briefDraft.event_assumptions} onChange={(event) => updateBriefField('event_assumptions', event.target.value)} disabled={!canManage || savingBrief} rows={6} placeholder="Format wydarzenia, liczba uczestników, miejsce, czas, układ sali i najważniejsze potrzeby…" className="w-full resize-y rounded-lg border border-[#d3bb73]/15 bg-[#090b13] px-3 py-2.5 text-sm leading-6 text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25 focus:border-violet-300/40 disabled:opacity-60" />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-[#d3bb73]/70">Cel wydarzenia</span>
                    <textarea value={briefDraft.event_goal} onChange={(event) => updateBriefField('event_goal', event.target.value)} disabled={!canManage || savingBrief} rows={6} placeholder="Jaki rezultat organizator chce osiągnąć i co jest najważniejsze dla uczestników…" className="w-full resize-y rounded-lg border border-[#d3bb73]/15 bg-[#090b13] px-3 py-2.5 text-sm leading-6 text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25 focus:border-violet-300/40 disabled:opacity-60" />
                  </label>
                </div>

                <div className="mt-4 rounded-lg border border-[#d3bb73]/10 bg-[#151827] p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-[#e5e4e2]"><CircleDollarSign className="h-4 w-4 text-[#d3bb73]" />Wstępny kosztorys</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/45">Od netto</span><div className="relative"><input type="number" min="0" step="100" value={briefDraft.preliminary_budget_min} onChange={(event) => updateBriefField('preliminary_budget_min', event.target.value)} disabled={!canManage || savingBrief} placeholder="0" className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#090b13] px-3 py-2.5 pr-12 text-sm text-[#e5e4e2] outline-none focus:border-violet-300/40 disabled:opacity-60" /><span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-[#e5e4e2]/35">PLN</span></div></label>
                    <label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/45">Do netto</span><div className="relative"><input type="number" min="0" step="100" value={briefDraft.preliminary_budget_max} onChange={(event) => updateBriefField('preliminary_budget_max', event.target.value)} disabled={!canManage || savingBrief} placeholder="0" className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#090b13] px-3 py-2.5 pr-12 text-sm text-[#e5e4e2] outline-none focus:border-violet-300/40 disabled:opacity-60" /><span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-[#e5e4e2]/35">PLN</span></div></label>
                  </div>
                  <label className="mt-3 block">
                    <span className="mb-2 block text-xs text-[#e5e4e2]/45">Zakres i podstawa widełek</span>
                    <textarea value={briefDraft.preliminary_budget_text} onChange={(event) => updateBriefField('preliminary_budget_text', event.target.value)} disabled={!canManage || savingBrief} rows={5} placeholder="Co obejmuje wstępny kosztorys i jakie założenia przyjęto…" className="w-full resize-y rounded-lg border border-[#d3bb73]/15 bg-[#090b13] px-3 py-2.5 text-sm leading-6 text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25 focus:border-violet-300/40 disabled:opacity-60" />
                  </label>
                  <p className="mt-2 text-[11px] leading-5 text-[#e5e4e2]/35">Widełki są roboczą kwotą netto i nie zastępują właściwej kalkulacji ani oferty.</p>
                </div>

                {assistantAutoError && <p className="mt-3 rounded-lg border border-amber-300/15 bg-amber-300/5 px-3 py-2 text-xs text-amber-100/75">Automatyczne uzupełnienie nie powiodło się: {assistantAutoError} Możesz wpisać dane ręcznie lub ponowić analizę.</p>}

                {canManage && (
                  <div className="mt-4 flex justify-end">
                    <button type="button" onClick={() => void saveInquiryBrief()} disabled={!briefDirty || savingBrief || loadingRecommendation} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-45">{savingBrief ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Zapisz dane</button>
                  </div>
                )}
              </div>
              {recommendation && <RecommendationView recommendation={recommendation} />}
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <h2 className="text-lg font-light text-[#e5e4e2]">Klient</h2>
              <div className="mt-4 space-y-3 text-sm text-[#e5e4e2]/65">
                <div className="flex items-center gap-2"><UserRound className="h-4 w-4 text-[#d3bb73]" />{clientName}</div>
                {clientEmail && <a href={`mailto:${clientEmail}`} className="flex items-center gap-2 hover:text-[#d3bb73]"><Mail className="h-4 w-4" />{clientEmail}</a>}
                {clientPhone && <a href={`tel:${clientPhone}`} className="flex items-center gap-2 hover:text-[#d3bb73]"><Phone className="h-4 w-4" />{clientPhone}</a>}
              </div>
              {!inquiry.contact_id && canManage && <button type="button" onClick={() => void ensureContact().catch((error) => showSnackbar(error.message, 'error'))} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/10"><UserPlus className="h-4 w-4" />Dodaj klienta do bazy</button>}
              {inquiry.contact_id && <Link href={`/crm/contacts/${inquiry.contact_id}`} className="mt-4 inline-flex text-sm text-[#d3bb73] hover:underline">Otwórz Kartę Klienta 360°</Link>}
            </section>

            <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <h2 className="text-lg font-light text-[#e5e4e2]">Prowadzenie sprzedaży</h2>
              <div className="mt-4 space-y-3 text-sm">
                <Row label="Opiekun" value={inquiry.inquiry_owner ? `${inquiry.inquiry_owner.name} ${inquiry.inquiry_owner.surname}` : 'Nieprzypisane'} />
                <Row label="Następne działanie" value={formatDate(inquiry.next_action_at)} />
                <Row label="Prawdopodobieństwo" value={`${inquiry.win_probability || 0}%`} />
                <Row label="Szacowana wartość" value={formatMoney(inquiry.estimated_value)} />
              </div>
            </section>
          </div>
        </div>
      )}

      {activeTab === 'tasks' && <RecordsPanel title="Działania sprzedażowe" empty="Brak zadań powiązanych z tym zapytaniem." actionLabel="Dodaj zadanie" onAction={() => setShowTaskModal(true)} rows={data.tasks.map((task: any) => ({ id: task.id, title: task.title, subtitle: `${task.assignee ? `${task.assignee.name} ${task.assignee.surname} · ` : ''}${formatDate(task.due_date)}`, badge: task.status, href: `/crm/tasks/${task.id}` }))} />}
      {activeTab === 'offers' && <RecordsPanel title="Oferty" empty="Nie przygotowano jeszcze oferty." actionLabel="Utwórz ofertę" onAction={() => void createOffer()} rows={data.offers.map((offer: any) => ({ id: offer.id, title: offer.offer_number || 'Oferta robocza', subtitle: `${formatMoney(offer.total_amount)} · ważna do ${formatDate(offer.valid_until)}`, badge: offer.status, href: `/crm/offers/${offer.id}` }))} />}
      {activeTab === 'calculations' && <RecordsPanel title="Kalkulacje" empty="Nie przygotowano jeszcze kalkulacji." actionLabel="Utwórz kalkulację" onAction={() => void createCalculation()} rows={data.calculations.map((calculation: any) => ({ id: calculation.id, title: calculation.name, subtitle: `${calculation.event_calculation_items?.length || 0} pozycji · ${formatMoney((calculation.event_calculation_items || []).reduce((sum: number, item: any) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0) * Number(item.days || 1), 0))}`, badge: calculation.generated_pdf_path ? 'PDF gotowy' : 'Robocza', onClick: () => setActiveCalculationId(calculation.id) }))} />}
      {activeTab === 'history' && <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5"><h2 className="text-lg font-light text-[#e5e4e2]">Historia lejka</h2><div className="mt-5 space-y-4">{data.history.map((entry: any) => <div key={entry.id} className="flex gap-3 border-l border-[#d3bb73]/20 pl-4"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]" /><div><p className="text-sm text-[#e5e4e2]">{STAGE_LABELS[entry.from_stage] || 'Początek'} → {STAGE_LABELS[entry.to_stage] || entry.to_stage}</p><p className="mt-1 text-xs text-[#e5e4e2]/40">{formatDate(entry.created_at)}{entry.changed_by_employee ? ` · ${entry.changed_by_employee.name} ${entry.changed_by_employee.surname}` : ''}</p>{entry.reason && <p className="mt-1 text-xs text-[#e5e4e2]/55">{entry.reason}</p>}</div></div>)}</div></section>}

      {showTaskModal && <NewInquiryTaskModal inquiryId={inquiry.id} employees={data.employees || []} onClose={() => setShowTaskModal(false)} onSaved={() => { setShowTaskModal(false); reload(); }} />}
      {showConversionModal && <ConvertInquiryModal inquiry={inquiry} categories={data.categories} companies={data.companies} onBeforeConvert={async () => { if (!inquiry.contact_id && !inquiry.organization_id) await ensureContact(); }} onClose={() => setShowConversionModal(false)} onConverted={(eventId) => router.push(`/crm/events/${eventId}`)} />}
      <ComposeEmailModal
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        onSend={sendEmail}
        initialTo={clientEmail}
        initialSubject={`Zapytanie: ${inquiry.title.replace(/^Zapytanie:\s*/i, '')}`}
        initialBody={`Dzień dobry${clientName ? ` ${clientName}` : ''},\n\nDziękuję za przesłane zapytanie.\n\n`}
        emailAccounts={data.emailAccounts}
        selectedAccountId={data.emailAccounts.find((account: any) => account.is_default)?.id}
        onImproveWithAI={async ({ subject, body }) => invokeAssistant({ action: 'improve_email', subject, draft: body })}
      />
    </div>
  );
}

function Info({ icon: Icon, label, value, format }: { icon: any; label: string; value?: any; format?: 'date' }) {
  return <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3"><div className="flex items-center gap-2 text-xs text-[#e5e4e2]/40"><Icon className="h-4 w-4 text-[#d3bb73]" />{label}</div><div className="mt-2 text-sm text-[#e5e4e2]/75">{value ? (format === 'date' ? formatDate(value) : String(value)) : 'Nie podano'}</div></div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 border-b border-[#d3bb73]/10 pb-3 last:border-0 last:pb-0"><span className="text-[#e5e4e2]/45">{label}</span><span className="text-right text-[#e5e4e2]/75">{value}</span></div>;
}

function RecommendationView({ recommendation }: { recommendation: Recommendation }) {
  return <div className="mt-5 grid gap-4 lg:grid-cols-2"><div className="rounded-lg border border-violet-300/10 bg-[#0f1119] p-4 lg:col-span-2"><p className="text-sm leading-6 text-[#e5e4e2]/75">{recommendation.summary}</p></div><RecommendationList title="Sugerowane produkty" items={recommendation.suggested_products.map((item) => `${item.name} — ${item.reason}`)} /><RecommendationList title="Sugerowane zasoby" items={recommendation.suggested_resources.map((item) => `${item.name} — ${item.reason}`)} /><RecommendationList title="Brakujące informacje" items={recommendation.missing_information} /><RecommendationList title="Następne działania" items={recommendation.next_actions} /><RecommendationList title="Ryzyka" items={recommendation.risks} /></div>;
}

function RecommendationList({ title, items }: { title: string; items: string[] }) {
  return <div className="rounded-lg border border-violet-300/10 bg-[#0f1119] p-4"><h3 className="text-sm font-medium text-violet-100">{title}</h3>{items.length ? <ul className="mt-3 space-y-2 text-xs leading-5 text-[#e5e4e2]/65">{items.map((item, index) => <li key={`${item}-${index}`} className="flex gap-2"><span className="text-violet-300">•</span><span>{item}</span></li>)}</ul> : <p className="mt-3 text-xs text-[#e5e4e2]/35">Brak sugestii</p>}</div>;
}

function RecordsPanel({ title, empty, actionLabel, onAction, rows }: { title: string; empty: string; actionLabel: string; onAction: () => void; rows: any[] }) {
  return <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5"><div className="flex items-center justify-between gap-4"><h2 className="text-lg font-light text-[#e5e4e2]">{title}</h2><button type="button" onClick={onAction} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33]"><Plus className="h-4 w-4" />{actionLabel}</button></div>{rows.length === 0 ? <div className="mt-5 rounded-lg border border-dashed border-[#d3bb73]/15 p-10 text-center text-sm text-[#e5e4e2]/40">{empty}</div> : <div className="mt-5 divide-y divide-[#d3bb73]/10 rounded-lg border border-[#d3bb73]/10">{rows.map((row) => { const content = <div className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-[#d3bb73]/5"><div className="min-w-0"><p className="truncate text-sm text-[#e5e4e2]">{row.title}</p><p className="mt-1 truncate text-xs text-[#e5e4e2]/40">{row.subtitle}</p></div><span className="shrink-0 rounded-full border border-[#d3bb73]/15 px-2 py-1 text-[11px] text-[#d3bb73]">{row.badge}</span></div>; return row.href ? <Link key={row.id} href={row.href}>{content}</Link> : <button type="button" key={row.id} onClick={row.onClick} className="block w-full text-left">{content}</button>; })}</div>}</section>;
}

function NewInquiryTaskModal({ inquiryId, employees, onClose, onSaved }: { inquiryId: string; employees: Array<{ id: string; name: string; surname: string }>; onClose: () => void; onSaved: () => void }) {
  const { showSnackbar } = useSnackbar();
  const { employee } = useCurrentEmployee();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState(employee?.id || '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const { data: task, error } = await supabase.from('tasks').insert({ title: title.trim(), description: description.trim() || null, due_date: dueDate ? new Date(dueDate).toISOString() : null, priority: 'high', status: 'todo', board_column: 'todo', inquiry_id: inquiryId, is_inquiry: false, assigned_to: assigneeId || null, created_by: employee?.id || null }).select('id').single();
      if (error) throw error;
      if (assigneeId) {
        const { data: assignment, error: assignmentError } = await supabase.from('task_assignees').insert({ task_id: task.id, employee_id: assigneeId, assigned_by: employee?.id || null }).select('id').single();
        if (assignmentError) throw assignmentError;
        try {
          await sendTaskAssignmentPush(assignment.id);
        } catch (pushError) {
          console.warn('task assignment push failed', pushError);
        }
      }
      showSnackbar(assigneeId ? 'Zadanie zostało przypisane i powiązane z zapytaniem' : 'Zadanie zostało powiązane z zapytaniem', 'success');
      onSaved();
    } catch (error: unknown) {
      console.error('create inquiry task failed', { code: (error as any)?.code });
      showSnackbar(friendlyDataError(error, 'Nie udało się utworzyć zadania.'), 'error');
    } finally {
      setSaving(false);
    }
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}><div className="w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-5" onMouseDown={(event) => event.stopPropagation()}><h2 className="text-lg font-light text-[#e5e4e2]">Nowe działanie sprzedażowe</h2><div className="mt-5 space-y-4"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Tytuł zadania" className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]" /><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Opis" rows={4} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]" /><label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Przypisz pracownika</span><select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="">Nieprzypisane</option>{employees.map((item) => <option key={item.id} value={item.id}>{item.name} {item.surname}</option>)}</select></label><label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Termin wykonania</span><input type="datetime-local" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]" /></label></div><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/60">Anuluj</button><button type="button" onClick={() => void save()} disabled={!title.trim() || saving} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#1c1f33] disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Zapisz</button></div></div></div>;
}

function ConvertInquiryModal({ inquiry, categories, companies, onBeforeConvert, onClose, onConverted }: { inquiry: any; categories: any[]; companies: any[]; onBeforeConvert: () => Promise<void>; onClose: () => void; onConverted: (eventId: string) => void }) {
  const { showSnackbar } = useSnackbar();
  const details = inquiry.inquiry_details || {};
  const [name, setName] = useState(inquiry.title.replace(/^Zapytanie:\s*/i, ''));
  const [date, setDate] = useState(toLocalInput(details.termin || inquiry.due_date));
  const [categoryId, setCategoryId] = useState('');
  const [companyId, setCompanyId] = useState(companies.find((item) => item.is_default)?.id || companies[0]?.id || '');
  const [saving, setSaving] = useState(false);
  const convert = async () => {
    if (!date) { showSnackbar('Uzupełnij termin wydarzenia', 'warning'); return; }
    setSaving(true);
    try {
      await onBeforeConvert();
    const { data, error } = await supabase.rpc('convert_inquiry_to_event', { p_inquiry_id: inquiry.id, p_event_name: name.trim(), p_event_date: new Date(date).toISOString(), p_category_id: categoryId || null, p_my_company_id: companyId || null });
      if (error) throw error;
    showSnackbar('Zapytanie zostało przekształcone w wydarzenie', 'success'); onConverted(data);
    } catch (error: any) {
      showSnackbar(error.message || 'Nie udało się utworzyć wydarzenia', 'error');
    } finally {
      setSaving(false);
    }
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}><div className="w-full max-w-xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-5" onMouseDown={(event) => event.stopPropagation()}><h2 className="text-lg font-light text-[#e5e4e2]">Utwórz wydarzenie z zapytania</h2><p className="mt-1 text-xs text-[#e5e4e2]/45">Oferta, kalkulacje i zadania zostaną przepięte bez utraty historii sprzedaży.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Nazwa</span><input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]" /></label><label><span className="mb-2 block text-xs text-[#e5e4e2]/50">Termin *</span><input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]" /></label><label><span className="mb-2 block text-xs text-[#e5e4e2]/50">Kategoria</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="">Bez kategorii</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="sm:col-span-2"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Działalność</span><select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="">Nieprzypisana</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.legal_name || item.name}</option>)}</select></label></div><div className="mt-5 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/60">Anuluj</button><button type="button" onClick={() => void convert()} disabled={!name.trim() || !date || saving} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Utwórz wydarzenie</button></div></div></div>;
}
