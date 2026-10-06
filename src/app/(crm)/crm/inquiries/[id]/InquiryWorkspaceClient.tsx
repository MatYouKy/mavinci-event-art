'use client';

import { inquiryTitleLabel, inquirySourceLabel, systemLabel } from '@/lib/ui/systemLabels';
import InquiryAnalysisPanel from '@/components/crm/inquiries/InquiryAnalysisPanel';
import InquiryContextEditor from '@/components/crm/inquiries/InquiryContextEditor';
import { useInquiryCorrespondence } from '@/lib/CRM/inquiries/useInquiryCorrespondence';
import InquiryCorrespondencePanel from '@/components/crm/inquiries/InquiryCorrespondencePanel';
import InquiryTypeBadges from '@/components/crm/inquiries/InquiryTypeBadges';
import InquiryOffersPanel from '@/components/crm/inquiries/InquiryOffersPanel';
import InquiryQuestions from '@/components/crm/inquiries/InquiryQuestions';
import { InquiryQuestion } from '@/lib/CRM/inquiries/questions';
import SystemBadge from '@/components/UI/SystemBadge';

import { useDialog } from '@/contexts/DialogContext';
import { matchOrganizationByEmail } from '@/lib/CRM/inquiries/matchOrganizationByEmail';
import { getContactOrganizations, useInquiryContactOrganizations } from '@/lib/CRM/inquiries/useInquiryContactOrganizations';
import { confirmAndRemoveInquiry } from '@/lib/CRM/inquiries/removeInquiry';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import InquiryTeamPanel from '@/components/crm/inquiries/InquiryTeamPanel';
import InquiryNotesPanel from '@/components/crm/inquiries/InquiryNotesPanel';
import InquiryStageModal from '@/components/crm/inquiries/InquiryStageModal';
import InquiryHandoffModal from '@/components/crm/inquiries/InquiryHandoffModal';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRightLeft,
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
  Trash2,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import ComposeEmailModal from '@/components/crm/ComposeEmailModal';
import { CalculationEditor } from '@/components/crm/events/calculations/CalculationEditor';
import InquiryCalculationsPanel from '@/components/crm/inquiries/InquiryCalculationsPanel';
import InquirySourceContextPanel from '@/components/crm/inquiries/InquirySourceContextPanel';
import { TasksPageClient } from '@/app/(crm)/crm/tasks/TaskPageClient';
import { useGetTasksListQuery } from '@/store/api/tasksApi';
import { dispatchCrmEmail, formatScheduledEmailDate } from '@/lib/emailScheduling';

import {
  EventAssumptionItem,
  formatEventAssumptionItems,
  normalizeEventAssumptionItems,
} from '@/lib/CRM/Offers/eventAssumptions';

type InquiryClientLink = { contactId: string; organizationId: string | null };

type Tab = 'notes' | 'overview' | 'tasks' | 'offers' | 'calculations' | 'history' | 'correspondence' | 'analysis' | 'team';

type Recommendation = {
  client_needs?: string[];
  correspondence_findings?: Array<{ finding: string; source_keys: string[] }>;
  correspondence_message_count?: number;
  summary: string;
  event_assumptions: string;
  event_assumption_items: EventAssumptionItem[];
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
  location_text: string;
  location_id: string;
  event_start_time: string;
  event_end_time: string;
  event_end_next_day: boolean;
  termin: string;
  scope: string;
  questions: InquiryQuestion[];
  conversation_notes: string;
  event_assumptions: string;
  event_assumption_items: EventAssumptionItem[];
  event_goal: string;
  preliminary_budget_min: string;
  preliminary_budget_max: string;
  preliminary_budget_text: string;
};

const createInquiryBriefDraft = (inquiry: any): InquiryBriefDraft => {
  const details = inquiry?.inquiry_details || {};
  return {
    location_text: String(details.location_text || ''),
    location_id: String(details.location_id || ''),
    event_start_time: String(details.event_start_time || ''),
    event_end_time: String(details.event_end_time || ''),
    event_end_next_day: details.event_end_next_day === true,
    termin: String(details.termin !== undefined ? details.termin || '' : inquiry?.due_date || ''),
    scope: String(details.scope || ''),
    questions: Array.isArray(details.questions) ? details.questions : [],
    conversation_notes: String(details.conversation_notes || ''),
    event_assumptions: String(details.event_assumptions || ''),
    event_assumption_items: normalizeEventAssumptionItems(details.event_assumption_items, String(details.event_assumptions || '')),
    event_goal: String(details.event_goal || ''),
    preliminary_budget_min: details.preliminary_budget_min !== null && details.preliminary_budget_min !== undefined
      ? String(details.preliminary_budget_min)
      : details.preliminary_budget_max == null && inquiry?.estimated_value != null && Number(inquiry.estimated_value) > 0 ? String(inquiry.estimated_value) : '',
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

const formatInquirySchedule = (details: any, fallback?: string | null) => {
  const value = details.termin !== undefined ? details.termin : fallback;
  const date = value ? new Date(value) : null;
  const dateLabel = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('pl-PL') : value || '';
  const hours = details.event_start_time || details.event_end_time
    ? `${details.event_start_time || '?'} – ${details.event_end_time || '?'}${details.event_end_next_day ? ' (następnego dnia)' : ''}`
    : details.event_start_time === undefined && details.event_end_time === undefined ? details.event_hours || details.hours || '' : '';
  return [dateLabel, hours].filter(Boolean).join('\n');
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
  if (status === 409) return 'Zapytanie zmieniło się podczas analizy. Odśwież dane i uruchom analizę ponownie.';
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
  const searchParams = useSearchParams();
  const conversionRequestHandled = useRef(false);
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { employee, isAdmin, hasScope } = useCurrentEmployee();
  const [data, setData] = useState(initialData);
  const [activeTab, setActiveTab] = useState<Tab>(searchParams.get('tab') === 'notes' ? 'notes' : searchParams.get('tab') === 'team' ? 'team' : searchParams.get('tab') === 'analysis' ? 'analysis' : searchParams.get('tab') === 'correspondence' ? 'correspondence' : searchParams.get('tab') === 'offers' ? 'offers' : searchParams.get('tab') === 'calculations' ? 'calculations' : 'overview');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showStageModal, setShowStageModal] = useState(false);
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showConversionModal, setShowConversionModal] = useState(false);
  const [deletingInquiry, setDeletingInquiry] = useState(false);
  const deletingInquiryRef = useRef(false);
  const [creatingOffer, setCreatingOffer] = useState(false);
  const [creatingCalculation, setCreatingCalculation] = useState(false);
  const [activeCalculationId, setActiveCalculationId] = useState<string | null>(null);
  const [loadingRecommendation, setLoadingRecommendation] = useState(false);
  const [briefDraft, setBriefDraft] = useState<InquiryBriefDraft>(() => createInquiryBriefDraft(initialData.inquiry));
  const [briefDirty, setBriefDirty] = useState(false);
  const [editingContext, setEditingContext] = useState(false);
  const [savingBrief, setSavingBrief] = useState(false);
  const [assistantAutoError, setAssistantAutoError] = useState('');
  const creatingOfferRef = useRef(false);
  const briefRevisionRef = useRef(initialData.inquiry.brief_revision || 1);
  const pendingOfferIdRef = useRef<string | null>(null);
  const pendingContactIdRef = useRef<string | null>(null);
  const ensuringContactRef = useRef<Promise<InquiryClientLink> | null>(null);
  const [markingContact, setMarkingContact] = useState(false);
  const contactLock = useRef(false);
  const [savingClient, setSavingClient] = useState(false);
  const briefDraftRef = useRef<InquiryBriefDraft>(createInquiryBriefDraft(initialData.inquiry));

  useEffect(() => {
    const nextBrief = createInquiryBriefDraft(initialData.inquiry);
    setData(initialData);
    briefRevisionRef.current = initialData.inquiry.brief_revision || 1;
    setBriefDraft(nextBrief);
    briefDraftRef.current = nextBrief;
    setBriefDirty(false);
  }, [initialData]);

  const inquiry = data.inquiry;
  const contactOrganizations = useInquiryContactOrganizations(inquiry.contact_id || null);
  const displayedOrganizations = inquiry.organization_id
    ? [{ id: inquiry.organization_id, name: inquiry.organization?.name || 'Otwórz organizację', alias: inquiry.organization?.alias }]
    : contactOrganizations.organizations;
  const correspondence = useInquiryCorrespondence(inquiry.id, initialData.viewerId || employee?.id || '');
  useEffect(() => {
    let active = true;
    const refreshContact = async () => {
      if (document.visibilityState !== 'visible') return;
      const { data: saved } = await supabase.from('tasks').select('last_contact_at,inquiry_stage').eq('id', inquiry.id).maybeSingle();
      if (active && saved) setData((current: any) => ({ ...current, inquiry: { ...current.inquiry, ...saved } }));
    };
    const timer = window.setInterval(() => void refreshContact(), 60000);
    window.addEventListener('focus', refreshContact);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refreshContact); };
  }, [inquiry.id]);
  const approvedSummary = inquiry.inquiry_details?.approved_summary || null;
  const approvedCurrent = Boolean(approvedSummary && !briefDirty
    && approvedSummary.analysis_id === data.analyses?.[0]?.id
    && approvedSummary.brief_revision === inquiry.brief_revision
    && approvedSummary.correspondence_signature === correspondence.signature);
  const { currentData: inquiryTasks } = useGetTasksListQuery({ inquiryId: inquiry.id }, { refetchOnMountOrArgChange: true });
  const details = inquiry.inquiry_details || {};
  const canLead = !inquiry.archived_at && (isAdmin
    || hasScope('inquiries_manage_all')
    || (inquiry.inquiry_owner_id === employee?.id && (hasScope('inquiries_manage') || hasScope('inquiries_manage_own')))
    || Boolean(
      employee?.is_sales_team_manager
      && employee.sales_team_id
      && inquiry.inquiry_owner?.sales_team_id === employee.sales_team_id
      && hasScope('inquiries_manage_team'),
    ));
  const canManage = !inquiry.archived_at && (canLead || Boolean(data.team?.isMember));
  useEffect(() => {
    if (searchParams.get('action') !== 'create-event' || conversionRequestHandled.current || !employee) return;
    conversionRequestHandled.current = true;
    if (inquiry.event_id) { router.replace(`/crm/events/${inquiry.event_id}`); return; }
    const sourceOfferId = searchParams.get('offerId');
    const sourceOffer = data.offers.find((row: any) => row.id === sourceOfferId);
    if (!canLead) { showSnackbar('Nie masz uprawnień do utworzenia wydarzenia z tego zapytania.', 'error'); }
    else if (sourceOfferId && (!sourceOffer || sourceOffer.status !== 'accepted')) { showSnackbar('Oferta nie jest już zaakceptowana lub nie należy do tego zapytania. Odśwież jej dane.', 'warning'); }
    else { setShowConversionModal(true); }
    router.replace(`/crm/inquiries/${inquiry.id}`, {scroll:false});
  }, [searchParams, employee, canLead, inquiry.id, inquiry.event_id, data.offers, router, showSnackbar]);
  const clientEmail = inquiry.contact?.email || details.client_email || inquiry.organization?.email || '';
  const clientPhone = inquiry.contact?.mobile || inquiry.contact?.phone || inquiry.organization?.phone || details.client_phone || '';
  const clientName = inquiry.contact?.full_name
    || inquiry.organization?.alias
    || inquiry.organization?.name
    || details.client_text
    || inquiryTitleLabel(inquiry.title);
  const sourceMessage = details.source_message_content || inquiry.description || '';
  const sourceHref = details.received_email_id
    ? `/crm/messages/${details.received_email_id}?type=received`
    : details.source_message_id
      ? `/crm/messages/${details.source_message_id}?type=contact`
      : null;

  const calculationContext = useMemo(() => ({
    inquiryId: inquiry.id,
    name: inquiryTitleLabel(inquiry.title),
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
      throw new Error(['correspondence_too_large', 'correspondence_changed', 'correspondence_unavailable', 'conversation_changed', 'conversation_unavailable', 'analysis_save_failed'].includes(result.error_code) ? result.error : friendlyAssistantError(response.status));
    }
    return result.result;
  };

  const updateBriefField = <K extends keyof InquiryBriefDraft,>(field: K, value: InquiryBriefDraft[K]) => {
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
    setSavingBrief(true);
    try {
      const nextDetails = {
        ...(data.inquiry.inquiry_details || {}),
        questions: draft.questions,
        conversation_notes: draft.conversation_notes,
        location_text: draft.location_text.trim(),
        location_id: draft.location_id || null,
        ...(draft.event_start_time || draft.event_end_time || data.inquiry.inquiry_details?.event_start_time !== undefined || data.inquiry.inquiry_details?.event_end_time !== undefined ? {
          event_start_time: draft.event_start_time || null,
          event_end_time: draft.event_end_time || null,
          event_end_next_day: Boolean(draft.event_end_time && draft.event_end_next_day),
        } : {}),
        termin: draft.termin || null,
        scope: draft.scope.trim(),
        preliminary_budget_min: draft.preliminary_budget_min || null,
        preliminary_budget_max: draft.preliminary_budget_max || null,
      };
      if (draft.questions.some(q => q.status === 'answered' && !q.answer.trim())) throw new Error('Uzupełnij odpowiedzi oznaczone jako gotowe.');
      const { data: saved, error } = await supabase.rpc('save_inquiry_brief', {
        p_inquiry: inquiry.id, p_expected_revision: briefRevisionRef.current, p_details: nextDetails,
        p_contact_note: draft.conversation_notes !== String(data.inquiry.inquiry_details?.conversation_notes || '') ? draft.conversation_notes : null,
      });
      if (error) throw error;
      briefRevisionRef.current = saved.brief_revision;

      const normalizedDraft = createInquiryBriefDraft(saved);
      setData((current: any) => ({
        ...current,
        inquiry: { ...current.inquiry, ...saved },
      }));
      setBriefDraft(normalizedDraft);
      briefDraftRef.current = normalizedDraft;
      setBriefDirty(false);
      setAssistantAutoError('');
      if (!options.quiet) showSnackbar('Ustalenia i notatka zostały zapisane.', 'success');
      return true;
    } catch (error: unknown) {
      const message = friendlyDataError(error, 'Nie udało się zapisać ustaleń zapytania.');
      if (!options.quiet) showSnackbar(message, 'error');
      else setAssistantAutoError(message);
      return false;
    } finally {
      setSavingBrief(false);
    }
  };

  const loadRecommendation = async (chatMessage: string, requestId: string) => {
    setLoadingRecommendation(true);
    try {
      if (briefDirty && !(await saveInquiryBrief(briefDraftRef.current))) throw new Error('Zapisz ustalenia przed analizą.');
      await invokeAssistant({ action: 'recommend', chatMessage, requestId });
      const { data: analyses, error } = await supabase.from('inquiry_analyses').select('*').eq('inquiry_id', inquiry.id)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(30);
      if (error) throw new Error('Odpowiedź została zapisana, ale nie udało się odświeżyć rozmowy. Spróbuj ponownie.');
      setData((current: any) => ({ ...current, analyses: analyses || [] }));
      void correspondence.refresh(true);
    } finally { setLoadingRecommendation(false); }
  };

  const approveSummary = async (analysisId: string) => {
    const { data: saved, error } = await supabase.rpc('approve_inquiry_summary', {
      p_inquiry: inquiry.id, p_analysis: analysisId, p_revision: briefRevisionRef.current,
    });
    if (error) throw error;
    briefRevisionRef.current = saved.brief_revision;
    setData((current: any) => ({ ...current, inquiry: { ...current.inquiry, ...saved } }));
    showSnackbar('Podsumowanie zostało zatwierdzone do oferty i kalkulacji.', 'success');
  };

  const getApprovedSummary = async () => {
    if (!data.inquiry.inquiry_details?.approved_summary) return null;
    const { data: summary, error } = await supabase.rpc('get_inquiry_approved_summary', { p_inquiry: inquiry.id });
    if (error) throw error;
    return summary as string | null;
  };

  const ensureContact = (): Promise<InquiryClientLink> => {
    if (!canManage) return Promise.reject(new Error('Nie masz uprawnień do zmiany klienta zapytania.'));
    if (ensuringContactRef.current) return ensuringContactRef.current;
    if (inquiry.contact_id && inquiry.organization_id) {
      return Promise.resolve({ contactId: inquiry.contact_id, organizationId: inquiry.organization_id });
    }
    setSavingClient(true);
    ensuringContactRef.current = (async () => {
      try {
        // A manual relationship from the client card takes precedence over domain guessing.
        const manualOrganizations = !inquiry.organization_id && inquiry.contact_id
          ? await getContactOrganizations(inquiry.contact_id) : [];
        if (manualOrganizations.length > 1) {
          throw new Error('Klient jest powiązany z kilkoma organizacjami. Wybierz organizację dla zapytania przed utworzeniem oferty.');
        }
        const match = inquiry.organization_id
          ? { organization: inquiry.organization, ambiguous: false }
          : manualOrganizations.length === 1
            ? { organization: manualOrganizations[0], ambiguous: false }
            : await matchOrganizationByEmail(clientEmail);
        const organizationId = inquiry.organization_id || match.organization?.id || null;
        const sourceName = String(details.client_text || clientName || '').trim();
        const parts = sourceName.split(/\s+/).filter(Boolean);
        const fallback = String(clientEmail || 'Nowy kontakt').split('@')[0].replace(/[._-]+/g, ' ');
        const firstName = parts[0] || fallback || 'Nowy';
        const lastName = parts.slice(1).join(' ') || '(zapytanie)';
        const contactId = inquiry.contact_id || pendingContactIdRef.current || crypto.randomUUID();
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
        if (!inquiry.contact_id) {
          const { error } = await supabase.from('contacts')
            .upsert(contactPayload, { onConflict: 'id', ignoreDuplicates: true });
          if (error) throw error;
        }
        if (organizationId) {
          const existing = await supabase.from('contact_organizations').select('id,is_current')
            .eq('contact_id', contactId).eq('organization_id', organizationId).maybeSingle();
          if (existing.error) throw existing.error;
          if (existing.data && !existing.data.is_current) {
            throw new Error('Ten klient ma zakończoną współpracę z dopasowaną organizacją. Sprawdź powiązanie w Karcie Klienta 360°.');
          }
          if (!existing.data) {
            const { error } = await supabase.from('contact_organizations').upsert({
              contact_id: contactId, organization_id: organizationId, is_current: true,
              notes: `Powiązanie z zapytania ${inquiry.id}`,
            }, { onConflict: 'contact_id,organization_id', ignoreDuplicates: true });
            if (error) throw error;
          }
        }
        // Preserve another user's choice if the inquiry changed while matching.
        let update = supabase.from('tasks').update({ contact_id: contactId, organization_id: organizationId })
          .eq('id', inquiry.id);
        update = inquiry.organization_id ? update.eq('organization_id', inquiry.organization_id) : update.is('organization_id', null);
        update = inquiry.contact_id ? update.eq('contact_id', inquiry.contact_id) : update.is('contact_id', null);
        const linked = await update.select('id').maybeSingle();
        if (linked.error) throw linked.error;
        if (!linked.data) throw new Error('Dane klienta zostały zmienione lub nie masz dostępu do zapisu. Odśwież zapytanie.');
        const contact = inquiry.contact || { ...contactPayload, full_name: `${firstName} ${lastName}`.trim() };
        setData((current: any) => ({ ...current, inquiry: {
          ...current.inquiry, contact_id: contactId, contact,
          organization_id: organizationId, organization: match.organization || current.inquiry.organization,
        } }));
        if (organizationId) {
          showSnackbar(`Klient został powiązany z organizacją ${match.organization?.alias || match.organization?.name || ''} i zapytaniem.`, 'success');
        } else if (match.ambiguous) {
          showSnackbar('Klient jest powiązany z zapytaniem. Domena pasuje do kilku organizacji — wybierz właściwą w Karcie Klienta 360°.', 'warning');
        } else {
          showSnackbar(inquiry.contact_id
            ? 'Nie znaleziono jednoznacznego dopasowania organizacji po domenie e-mail. Możesz przypisać ją w Karcie Klienta 360°.'
            : 'Klient został dodany i powiązany z zapytaniem.', inquiry.contact_id ? 'info' : 'success');
        }
        return { contactId, organizationId };
      } finally {
        ensuringContactRef.current = null;
        setSavingClient(false);
      }
    })();
    return ensuringContactRef.current;
  };

  const createOffer = async () => {
    if (!canManage || creatingOfferRef.current) return;
    if (loadingRecommendation || savingBrief) {
      showSnackbar('Poczekaj na zakończenie analizy i zapisanie założeń.', 'warning');
      return;
    }
    creatingOfferRef.current = true;
    setCreatingOffer(true);
    try {
      if (briefDirty && !(await saveInquiryBrief())) return;
      const offerBrief = briefDraftRef.current;
      const approvedBrief = await getApprovedSummary();
      const clientLink = inquiry.organization_id
        ? { contactId: inquiry.contact_id || null, organizationId: inquiry.organization_id }
        : await ensureContact();
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 14);
      const offerId = pendingOfferIdRef.current || crypto.randomUUID();
      pendingOfferIdRef.current = offerId;
      const { error } = await supabase.from('offers').upsert({
        id: offerId,
        inquiry_id: inquiry.id,
        source_brief_revision: briefRevisionRef.current,
        notes: approvedBrief ? `Zatwierdzone podsumowanie zapytania:\n${approvedBrief}` : null,
        event_id: inquiry.event_id || null,
        client_type: clientLink.organizationId ? 'business' : 'individual',
        organization_id: clientLink.organizationId,
        contact_id: clientLink.contactId,
        valid_until: validUntil.toISOString(),
        status: 'draft',
        total_amount: 0,
        created_by: employee?.id || null,
        event_location: offerBrief.location_text || null,
        event_assumptions: formatEventAssumptionItems(offerBrief.event_assumption_items) || offerBrief.scope || null,
        event_assumption_items: offerBrief.event_assumption_items,
        event_goal: offerBrief.event_goal || null,
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
      pendingOfferIdRef.current = null;
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
    if (!canManage || creatingCalculation || loadingRecommendation || savingBrief) return;
    setCreatingCalculation(true);
    try {
      if (briefDirty && !(await saveInquiryBrief())) return;
      const approvedBrief = await getApprovedSummary();
      const { data: calculation, error } = await supabase.from('event_calculations').insert({
        event_id: inquiry.event_id || null,
        inquiry_id: inquiry.id,
        name: `Kalkulacja — ${inquiryTitleLabel(inquiry.title)}`,
        notes: approvedBrief ? `Zatwierdzone podsumowanie zapytania:\n${approvedBrief}` : null,
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

  const markContact = async () => {
    if (!canManage || contactLock.current) return;
    contactLock.current = true; setMarkingContact(true);
    try {
      const { data: saved, error } = await supabase.rpc('mark_inquiry_contacted', { p_inquiry: inquiry.id });
      if (error) throw error;
      setData((current: any) => ({ ...current, inquiry: { ...current.inquiry, ...saved } }));
      showSnackbar('Oznaczono kontakt jako podjęty.', 'success');
    } catch (error: any) { showSnackbar(error.message || 'Nie udało się oznaczyć kontaktu.', 'error'); }
    finally { contactLock.current = false; setMarkingContact(false); }
  };

  const sendEmail = async (message: any) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error('Brak aktywnej sesji');
    const attachments = await Promise.all((message.attachments || []).map(fileToAttachment));
    const result = await dispatchCrmEmail({
      accessToken: token,
      functionName: 'send-email',
      scheduledAt: message.scheduledAt,
      metadata: {
        entityType: 'inquiry',
        entityId: inquiry.id,
        inquiryId: inquiry.id,
        actionUrl: `/crm/inquiries/${inquiry.id}`,
      },
      payload: {
        inquiryId: inquiry.id,
        emailAccountId: message.fromAccountId,
        to: message.to,
        cc: message.cc,
        bcc: message.bcc,
        subject: message.subject,
        body: message.bodyHtml,
        attachments,
      },
    });
    showSnackbar(
      result.scheduled && result.scheduledAt
        ? `Wiadomość zostanie wysłana ${formatScheduledEmailDate(result.scheduledAt)}`
        : 'Wiadomość została wysłana i zapisana jako kontakt',
      'success',
    );
    reload();
  };

  const deleteInquiry = async () => {
    if (!canLead || deletingInquiryRef.current) return;
    deletingInquiryRef.current = true;
    setDeletingInquiry(true);
    try {
      const result = await confirmAndRemoveInquiry(inquiry.id, showConfirm);
      if (!result) {
        deletingInquiryRef.current = false;
        setDeletingInquiry(false);
        return;
      }
      showSnackbar(result === 'deleted' ? 'Zapytanie usunięte trwale' : 'Zapytanie zarchiwizowane', 'success');
      router.replace('/crm/inquiries');
      router.refresh();
    } catch (error) {
      showSnackbar(friendlyDataError(error, 'Nie udało się usunąć zapytania. Sprawdź uprawnienia i spróbuj ponownie.'), 'error');
      deletingInquiryRef.current = false;
      setDeletingInquiry(false);
    }
  };

  const actions = [
    { label: 'Zmień etap', icon: <ArrowRightLeft className="h-4 w-4" />, onClick: () => setShowStageModal(true), show: canLead },
    { label: 'Nowe zadanie', icon: <ClipboardList className="h-4 w-4" />, onClick: () => { setActiveTab('tasks'); setShowTaskModal(true); }, show: canManage },
    { label: 'Kalkulacja', icon: creatingCalculation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />, onClick: () => void createCalculation(), disabled: creatingCalculation, show: canManage },
    { label: 'Oferta', icon: creatingOffer ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />, onClick: () => void createOffer(), disabled: creatingOffer, show: canManage, variant: 'primary' as const },
    { label: 'Napisz e-mail', icon: <Mail className="h-4 w-4" />, onClick: () => setShowEmailModal(true), disabled: !clientEmail, show: canManage },
    { label: 'Przygotuj realizację', icon: <Briefcase className="h-4 w-4" />, onClick: () => setShowConversionModal(true), show: canLead && Boolean(inquiry.accepted_offer_id) && !(data.activity || []).some((entry: any) => entry.kind === 'handoff') },
    { label: inquiry.event_id ? 'Otwórz wydarzenie' : 'Utwórz wydarzenie', icon: <Briefcase className="h-4 w-4" />, onClick: () => inquiry.event_id ? router.push(`/crm/events/${inquiry.event_id}`) : setShowConversionModal(true), show: canLead && (!inquiry.accepted_offer_id || Boolean(inquiry.event_id)) },
    { label: deletingInquiry ? 'Usuwanie zapytania…' : 'Usuń zapytanie', icon: deletingInquiry ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />, onClick: () => void deleteInquiry(), disabled: deletingInquiry, show: canLead, variant: 'danger' as const },
  ].map(action => ({ ...action, disabled: deletingInquiry || action.disabled }));

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'overview', label: 'Podsumowanie' },
    { id: 'team', label: 'Zespół', count: data.team ? data.team.members.length + (inquiry.inquiry_owner_id ? 1 : 0) : undefined },
    { id: 'tasks', label: 'Zadania', count: (inquiryTasks || data.tasks).length },
    { id: 'offers', label: 'Oferty', count: data.offers.length },
    { id: 'calculations', label: 'Kalkulacje', count: data.calculations.length },
    { id: 'correspondence', label: 'Korespondencja', count: correspondence.count },
    { id: 'analysis', label: 'Analiza i AI', count: data.analyses.length },
    { id: 'notes', label: 'Notatki' },
    { id: 'history', label: 'Historia', count: data.history.length },
  ];

  if (activeCalculationId) {
    return (
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <InquirySourceContextPanel
          inquiryTitle={inquiryTitleLabel(inquiry.title)}
          message={sourceMessage}
          sourceLabel={inquirySourceLabel(details)}
          clientName={clientName}
          clientEmail={clientEmail}
          clientPhone={clientPhone}
          sourceHref={sourceHref}
          items={[
            { label: 'Termin', value: details.termin || inquiry.due_date, kind: 'date' },
            { label: 'Miejsce', value: details.location_text, kind: 'location' },
            { label: 'Zakres', value: details.scope || (details.event_type ? systemLabel(details.event_type, 'eventType') : null), kind: 'scope' },
          ]}
          className="xl:sticky xl:top-4 xl:self-start"
        />
        <div className="min-w-0">
          <CalculationEditor
            calculationId={activeCalculationId}
            eventId={inquiry.event_id || null}
            readOnly={!canManage}
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
            <h1 className="truncate text-2xl font-light text-[#e5e4e2]">{inquiryTitleLabel(inquiry.title)}</h1>
            <InquiryTypeBadges title={inquiry.title} details={details} />
            <span className="rounded-full border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-3 py-1 text-xs text-[#d3bb73]">{STAGE_LABELS[inquiry.inquiry_stage] || systemLabel(inquiry.inquiry_stage)}</span>
          </div>
          <p className="mt-2 text-sm text-[#e5e4e2]/45">Zapytanie #{inquiry.id.slice(0, 8)} · utworzone {formatDate(inquiry.created_at)}</p>
        </div>
        <ResponsiveActionBar actions={actions} disabledBackground={false} />
      </div>

      <div className="overflow-x-auto border-b border-[#d3bb73]/10">
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <button data-crm-tab-active={activeTab === tab.id} key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`border-b-2 px-4 py-3 text-sm transition-colors ${activeTab === tab.id ? 'border-[#d3bb73] text-[#d3bb73]' : 'border-transparent text-[#e5e4e2]/50 hover:text-[#e5e4e2]'}`}>
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

            </section>

            <button type="button" onClick={() => setActiveTab('analysis')} className="flex w-full items-center gap-3 rounded-xl bg-white/5 p-4 text-left text-sm text-[#d3bb73] hover:bg-white/10">
              <Sparkles className="h-5 w-5 shrink-0" />
              <span>Otwórz analizę, ustalenia i rozmowę z AI</span>
            </button>
          </div>

          <div className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-105px)] xl:self-start xl:overflow-y-auto xl:overscroll-contain">
            <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <h2 className="text-lg font-light text-[#e5e4e2]">Klient</h2>
              <div className="mt-4 space-y-3 text-sm text-[#e5e4e2]/65">
                <div className="flex items-center gap-2"><UserRound className="h-4 w-4 text-[#d3bb73]" />{clientName}</div>
                {clientEmail && <a href={`mailto:${clientEmail}`} className="flex items-center gap-2 hover:text-[#d3bb73]"><Mail className="h-4 w-4" />{clientEmail}</a>}
                {clientPhone && <a href={`tel:${clientPhone}`} className="flex items-center gap-2 hover:text-[#d3bb73]"><Phone className="h-4 w-4" />{clientPhone}</a>}
              </div>
              {canManage && (!inquiry.contact_id || (!inquiry.organization_id && clientEmail && !contactOrganizations.loading && !contactOrganizations.error && displayedOrganizations.length === 0)) && (
                <button data-crm-action="secondary" type="button" disabled={savingClient}
                  onClick={() => void ensureContact().catch((error) => showSnackbar(error.message, 'error'))}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73] hover:bg-white/10 disabled:opacity-50"
                >
                  {savingClient ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  {savingClient ? 'Zapisuję powiązanie…' : inquiry.contact_id ? 'Powiąż organizację po e-mailu' : 'Dodaj klienta do bazy'}
                </button>
              )}
              {!inquiry.organization_id && contactOrganizations.loading && displayedOrganizations.length === 0 && <p className="mt-3 text-xs text-white/45">Wczytuję organizację klienta…</p>}
              {!inquiry.organization_id && contactOrganizations.error && <p role="alert" className="mt-3 text-xs text-amber-200">{contactOrganizations.error} <button type="button" onClick={() => void contactOrganizations.refresh()} className="underline">Ponów</button></p>}
              {displayedOrganizations.map(organization => (
                <Link key={organization.id} href={`/crm/contacts/${organization.id}`} className="mt-3 flex items-center gap-2 text-sm text-[#d3bb73] hover:underline">
                  <Briefcase className="h-4 w-4 shrink-0" />
                  {organization.alias || organization.name}
                </Link>
              ))}
              {inquiry.contact_id && <Link href={`/crm/contacts/${inquiry.contact_id}`} className="mt-4 inline-flex text-sm text-[#d3bb73] hover:underline">Otwórz Kartę Klienta 360°</Link>}
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <div><Info icon={MapPin} label="Miejsce" value={details.location_text} />
                  {details.location_id && <Link href={`/crm/locations/${details.location_id}`} className="mt-1 inline-block text-xs text-[#d3bb73] hover:underline">Otwórz lokalizację</Link>}</div>
                <Info icon={CalendarClock} label="Termin / szacowane godziny" value={formatInquirySchedule(details, inquiry.due_date)} />
                <div className="sm:col-span-2 xl:col-span-1 2xl:col-span-2"><Info icon={Target} label="Zakres" value={details.scope || (details.event_type ? systemLabel(details.event_type, 'eventType') : null)} /></div>
                <div className="sm:col-span-2 xl:col-span-1 2xl:col-span-2"><Info icon={CircleDollarSign} label="Budżet / wartość" value={
                  details.preliminary_budget_min != null && details.preliminary_budget_max != null && Number(details.preliminary_budget_min) !== Number(details.preliminary_budget_max)
                    ? `${formatMoney(details.preliminary_budget_min)} – ${formatMoney(details.preliminary_budget_max)}`
                    : details.preliminary_budget_min != null || details.preliminary_budget_max != null
                      ? formatMoney(details.preliminary_budget_min ?? details.preliminary_budget_max)
                      : inquiry.estimated_value ? formatMoney(inquiry.estimated_value) : details.budget
                } /></div>
              </div>
              {canManage && !editingContext && <button type="button" disabled={savingBrief || loadingRecommendation} onClick={() => setEditingContext(true)} className="mt-3 text-sm text-[#d3bb73] hover:underline disabled:opacity-50">Uzupełnij / edytuj kontekst</button>}
              {canManage && editingContext && <InquiryContextEditor initial={createInquiryBriefDraft(inquiry)} disabled={savingBrief || loadingRecommendation}
                onCancel={() => setEditingContext(false)} onSave={context => saveInquiryBrief({ ...briefDraftRef.current, ...context })} />}
            </section>

            <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <h2 className="text-lg font-light text-[#e5e4e2]">Prowadzenie sprzedaży</h2>
              <div className="mt-4 space-y-3 text-sm">
                <Row label="Opiekun" value={inquiry.inquiry_owner ? `${inquiry.inquiry_owner.name} ${inquiry.inquiry_owner.surname}` : 'Nieprzypisane'} />
                {canLead && inquiry.inquiry_owner_id && !['won','lost'].includes(inquiry.inquiry_stage) && <button type="button" onClick={() => setShowHandoffModal(true)} className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/15">Przekaż / oddaj zapytanie</button>}
                {showHandoffModal && inquiry.inquiry_owner_id && <InquiryHandoffModal inquiryId={inquiry.id} ownerId={inquiry.inquiry_owner_id} title={inquiry.title} onClose={() => setShowHandoffModal(false)} onSaved={() => { router.push('/crm/inquiries'); router.refresh(); }} />}
                <div className="rounded-lg bg-white/5 p-3">
                  <p className="flex items-center gap-2 text-sm">{inquiry.last_contact_at ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Phone className="h-4 w-4 text-white/45" />}{inquiry.last_contact_at ? 'Kontakt podjęty' : 'Kontakt jeszcze niepodjęty'}</p>
                  {inquiry.last_contact_at && <p className="mt-1 text-xs text-white/45">Ostatni kontakt: {formatDate(inquiry.last_contact_at)}</p>}
                  {canManage && <button type="button" disabled={markingContact} onClick={() => void markContact()} className="mt-2 text-sm text-[#d3bb73] disabled:opacity-50">{markingContact ? 'Zapisuję…' : inquiry.last_contact_at ? 'Odnotuj kolejny kontakt' : 'Oznacz kontakt jako podjęty'}</button>}
                </div>
                <Row label="Następne działanie" value={formatDate(inquiry.next_action_at)} />
                <Row label="Prawdopodobieństwo" value={`${inquiry.win_probability || 0}%`} />
                <Row label="Szacowana wartość" value={formatMoney(inquiry.estimated_value)} />
                {canLead && <><Link href={`/crm/inquiries?edit=${inquiry.id}`} className="block text-[#d3bb73]">Zmień opiekuna, etap i termin działania</Link>{inquiry.accepted_offer_id && <button type="button" className="text-[#d3bb73]" onClick={async () => { const reason = window.prompt('Powód ponownego otwarcia negocjacji'); if (!reason?.trim()) return; const { error } = await supabase.rpc('reopen_inquiry_negotiation', { p_inquiry: inquiry.id, p_reason: reason }); if (error) showSnackbar(error.message, 'error'); else reload(); }}>Otwórz negocjacje ponownie</button>}</>}
              </div>
            </section>
          </div>
        </div>
      )}

      <div hidden={activeTab !== 'correspondence'}>
        <InquiryCorrespondencePanel inquiryId={inquiry.id} canManage={canManage} correspondence={correspondence}
          analyzing={loadingRecommendation || savingBrief} onAnalyze={() => setActiveTab('analysis')} />
      </div>
      <div hidden={activeTab !== 'analysis'}>
        <InquiryAnalysisPanel analyses={data.analyses} approved={approvedSummary} approvedCurrent={approvedCurrent}
          canManage={canManage} busy={loadingRecommendation || savingBrief} dirty={briefDirty}
          onSend={loadRecommendation} onApprove={approveSummary} renderResult={result => <RecommendationView recommendation={result} />}>
          <section className="rounded-xl bg-[#1c1f33] p-5">
            <h2 className="text-lg">Ustalenia i notatka z rozmowy</h2>
              <InquiryQuestions questions={briefDraft.questions} disabled={!canManage || savingBrief || loadingRecommendation} onChange={questions => updateBriefField('questions', questions)} />
              <label className="mt-4 block text-sm">Notatka z rozmowy<textarea rows={3} value={briefDraft.conversation_notes} disabled={!canManage || savingBrief || loadingRecommendation} onChange={e => updateBriefField('conversation_notes', e.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 p-3" /></label>
              {canManage && (
                <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
                  <p role="status" className="text-xs text-[#e5e4e2]/55">{savingBrief ? 'Zapisuję ustalenia…' : briefDirty ? 'Masz niezapisane zmiany' : ''}</p>
                  <button type="button" onClick={() => void saveInquiryBrief()} disabled={!briefDirty || savingBrief || loadingRecommendation} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-45"><Save className="h-4 w-4" />Zapisz ustalenia</button>
                </div>
              )}
          </section>
        </InquiryAnalysisPanel>
      </div>
      {activeTab === 'team' && <InquiryTeamPanel inquiryId={inquiry.id} owner={inquiry.inquiry_owner} team={data.team} error={data.teamError} onChanged={team => setData((current: any) => ({ ...current, team, teamError: '' }))} onRefresh={reload} />}
      {activeTab === 'tasks' && <TasksPageClient key={inquiry.id} initialTasks={data.tasks} inquiryId={inquiry.id} canManageInquiry={canManage} openCreateModal={showTaskModal} onCreateModalHandled={() => setShowTaskModal(false)} />}
      {activeTab === 'offers' && <InquiryOffersPanel offers={data.offers} selectedId={inquiry.accepted_offer_id || null} canManage={canManage} onCreate={() => void createOffer()} onChanged={reload} />}
      {activeTab === 'calculations' && <InquiryCalculationsPanel
        key={inquiry.id} selectedId={inquiry.accepted_calculation_id || null} calculations={data.calculations} context={calculationContext} canManage={canManage} creating={creatingCalculation}
        onCreate={() => void createCalculation()} onEdit={setActiveCalculationId} onChanged={reload}
      />}
      {activeTab === 'notes' && <InquiryNotesPanel key={inquiry.id} inquiryId={inquiry.id} canWrite={canLead} phone={clientPhone} onSaved={reload} />}
      {activeTab === 'history' && <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5"><h2 className="text-lg font-light text-[#e5e4e2]">Historia sprzedaży</h2>{(data.activity || []).map((entry: any) => <details key={entry.id} className="mt-4 rounded-lg bg-black/20 p-3"><summary className="text-sm">{entry.body} · {formatDate(entry.created_at)}</summary>{entry.metadata?.note && <p className="mt-2 whitespace-pre-wrap text-sm">{entry.metadata.note}</p>}{entry.metadata?.details?.questions?.map((q: any) => <p key={q.id} className="mt-2 text-sm">{q.question}: {q.answer || "Brak odpowiedzi"} · {q.source}</p>)}</details>)}<div className="mt-5 space-y-4">{data.history.map((entry: any) => <div key={entry.id} className="flex gap-3 border-l border-[#d3bb73]/20 pl-4"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]" /><div><p className="text-sm text-[#e5e4e2]">{STAGE_LABELS[entry.from_stage] || 'Początek'} → {STAGE_LABELS[entry.to_stage] || systemLabel(entry.to_stage)}</p><p className="mt-1 text-xs text-[#e5e4e2]/40">{formatDate(entry.created_at)}{entry.changed_by_employee ? ` · ${entry.changed_by_employee.name} ${entry.changed_by_employee.surname}` : ''}</p>{entry.reason && <p className="mt-1 text-xs text-[#e5e4e2]/55">{entry.reason}</p>}</div></div>)}</div></section>}

      {showConversionModal && <ConvertInquiryModal inquiry={inquiry} categories={data.categories} companies={data.companies} onBeforeConvert={async () => { if (briefDirty && !(await saveInquiryBrief())) throw new Error('Zapisz dane przed utworzeniem wydarzenia.'); if (!inquiry.contact_id && !inquiry.organization_id) await ensureContact(); }} onClose={() => setShowConversionModal(false)} onConverted={(eventId) => router.push(`/crm/events/${eventId}`)} />}
      {showStageModal && canLead && <InquiryStageModal inquiry={inquiry} onClose={() => setShowStageModal(false)} onSaved={(saved) => {
        setData((current: any) => ({ ...current, inquiry: { ...current.inquiry, ...saved } }));
        setShowStageModal(false);
        reload();
      }} />}
      <ComposeEmailModal
        isOpen={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        onSend={sendEmail}
        initialTo={clientEmail}
        initialSubject={`Zapytanie: ${inquiryTitleLabel(inquiry.title)}`}
        initialBody={`Dzień dobry${clientName ? ` ${clientName}` : ''},\n\nDziękuję za przesłane zapytanie.\n\n`}
        emailAccounts={data.emailAccounts}
        selectedAccountId={data.emailAccounts.find((account: any) => account.is_default)?.id}
        onImproveWithAI={async ({ subject, body }) => invokeAssistant({ action: 'improve_email', subject, draft: body })}
      />
    </div>
  );
}

function Info({ icon: Icon, label, value, format }: { icon: any; label: string; value?: any; format?: 'date' }) {
  return <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3"><div className="flex items-center gap-2 text-xs text-[#e5e4e2]/40"><Icon className="h-4 w-4 text-[#d3bb73]" />{label}</div><div className="mt-1 whitespace-pre-wrap break-words text-sm text-[#e5e4e2]/75">{value ? (format === 'date' ? formatDate(value) : String(value)) : 'Nie podano'}</div></div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 border-b border-[#d3bb73]/10 pb-3 last:border-0 last:pb-0"><span className="text-[#e5e4e2]/45">{label}</span><span className="text-right text-[#e5e4e2]/75">{value}</span></div>;
}

function RecommendationView({ recommendation }: { recommendation: Recommendation }) {
  const assumptions = normalizeEventAssumptionItems(recommendation.event_assumption_items, recommendation.event_assumptions || '');
  const estimate = recommendation.preliminary_estimate;
  const hasEstimate = estimate && Number.isFinite(estimate.min_net) && Number.isFinite(estimate.max_net)
    && estimate.min_net >= 0 && estimate.max_net > 0 && estimate.max_net >= estimate.min_net;
  return <div className="mt-5 grid gap-4 lg:grid-cols-2">
    <div className="rounded-lg bg-black/15 p-4 lg:col-span-2">
      <h3 className="text-sm font-medium">Podsumowanie zapytania i korespondencji</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/75">{recommendation.summary}</p>
      {recommendation.event_goal && <p className="mt-3 text-sm text-white/60">Cel wydarzenia: {recommendation.event_goal}</p>}
    </div>
    <RecommendationList title="Założenia wydarzenia" items={assumptions.map(item => `${item.label ? item.label + ': ' : ''}${item.value}`)} />
    {recommendation.client_needs?.length ? <RecommendationList title="Potrzeby klienta" items={recommendation.client_needs} /> : null}
    <RecommendationList title="Co trzeba doprecyzować" items={recommendation.missing_information || []} />
    <div className="rounded-lg bg-black/15 p-4 lg:col-span-2">
      <h3 className="text-sm font-medium">Szacunkowa kalkulacja</h3>
      <p className="mt-2 text-lg text-[#d3bb73]">{hasEstimate ? `${formatMoney(estimate.min_net)} – ${formatMoney(estimate.max_net)} netto` : 'Brak podstaw do określenia kwoty'}</p>
      {estimate?.summary && <p className="mt-2 text-sm text-white/70">{estimate.summary}</p>}
      {!!estimate?.basis?.length && <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-white/60">{estimate.basis.map((item, index) => <li key={index}>{item}</li>)}</ul>}
      <p className="mt-3 text-xs text-white/40">Wstępny szacunek na podstawie dostępnych cen i założeń. Wymaga doprecyzowania przed ofertą.</p>
    </div>
    <RecommendationList title="Co możemy zaproponować" items={(recommendation.suggested_products || []).map(item => `${item.name} — ${item.reason}`)} />
    <RecommendationList title="Następne działania" items={recommendation.next_actions || []} />
    {(recommendation.correspondence_findings || []).length > 0 && <details className="space-y-3 rounded-lg bg-black/10 p-4 lg:col-span-2">
      <summary className="cursor-pointer text-sm text-white/55">Ustalenia i źródła ({recommendation.correspondence_message_count || 0} wiadomości)</summary>
      {recommendation.correspondence_findings?.map((item, index) => <div key={index} className="text-sm text-white/75">
        <p>{item.finding}</p><div className="mt-1 flex flex-wrap gap-3">{item.source_keys.map(source => {
          const match = /^(received|sent):([0-9a-f-]{36})$/i.exec(source);
          return match ? <Link key={source} className="text-xs text-[#d3bb73] hover:underline" href={`/crm/messages/${match[2]}?type=${match[1]}`}>Źródło: {match[1] === 'received' ? 'mail odebrany' : 'mail wysłany'}</Link> : null;
        })}</div>
      </div>)}
    </details>}
    <details className="rounded-lg bg-black/10 p-3 lg:col-span-2"><summary className="cursor-pointer text-sm text-white/55">Zasoby i ryzyka</summary><div className="mt-3 grid gap-3 lg:grid-cols-2">
      <RecommendationList title="Sugerowane zasoby" items={(recommendation.suggested_resources || []).map(item => `${item.name} — ${item.reason}`)} />
      <RecommendationList title="Ryzyka" items={recommendation.risks || []} />
    </div></details>
  </div>;
}

function RecommendationList({ title, items }: { title: string; items: string[] }) {
  return <div className="rounded-lg border border-violet-300/10 bg-[#0f1119] p-4"><h3 className="text-sm font-medium text-violet-100">{title}</h3>{items.length ? <ul className="mt-3 space-y-2 text-xs leading-5 text-[#e5e4e2]/65">{items.map((item, index) => <li key={`${item}-${index}`} className="flex gap-2"><span className="text-violet-300">•</span><span>{item}</span></li>)}</ul> : <p className="mt-3 text-xs text-[#e5e4e2]/35">Brak sugestii</p>}</div>;
}

function RecordsPanel({ title, empty, actionLabel, onAction, rows, canManage = true }: { title: string; empty: string; actionLabel: string; onAction: () => void; rows: any[]; canManage?: boolean }) {
  return <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5"><div className="flex items-center justify-between gap-4"><h2 className="text-lg font-light text-[#e5e4e2]">{title}</h2>{canManage && <button type="button" onClick={onAction} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33]"><Plus className="h-4 w-4" />{actionLabel}</button>}</div>{rows.length === 0 ? <div className="mt-5 rounded-lg border border-dashed border-[#d3bb73]/15 p-10 text-center text-sm text-[#e5e4e2]/40">{empty}</div> : <div className="mt-5 divide-y divide-[#d3bb73]/10 rounded-lg border border-[#d3bb73]/10">{rows.map((row) => { const content = <div className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-[#d3bb73]/5"><div className="min-w-0"><p className="truncate text-sm text-[#e5e4e2]">{row.title}</p><p className="mt-1 truncate text-xs text-[#e5e4e2]/40">{row.subtitle}</p></div><SystemBadge value={row.badge} className="shrink-0" /></div>; return row.href ? <Link key={row.id} href={row.href}>{content}</Link> : <button type="button" key={row.id} onClick={row.onClick} className="block w-full text-left">{content}</button>; })}</div>}</section>;
}

function ConvertInquiryModal({ inquiry, categories, companies, onBeforeConvert, onClose, onConverted }: { inquiry: any; categories: any[]; companies: any[]; onBeforeConvert: () => Promise<void>; onClose: () => void; onConverted: (eventId: string) => void }) {
  const { showSnackbar } = useSnackbar();
  const details = inquiry.inquiry_details || {};
  const [name, setName] = useState(inquiryTitleLabel(inquiry.title));
  const [date, setDate] = useState(toLocalInput(details.termin || inquiry.due_date));
  const [categoryId, setCategoryId] = useState('');
  const [companyId, setCompanyId] = useState(companies.find((item) => item.is_default)?.id || companies[0]?.id || '');
  const [saving, setSaving] = useState(false);
  const convertLock = useRef(false);
  const convert = async () => {
    if(convertLock.current) return;
    if (!date || !Number.isFinite(new Date(date).getTime())) { showSnackbar('Uzupełnij poprawny termin wydarzenia', 'warning'); return; }
    convertLock.current = true;
    setSaving(true);
    try {
      await onBeforeConvert();
    const { data, error } = await supabase.rpc(inquiry.accepted_offer_id ? 'prepare_inquiry_realization' : 'convert_inquiry_to_event', { p_inquiry_id: inquiry.id, p_event_name: name.trim(), p_event_date: new Date(date).toISOString(), p_category_id: categoryId || null, p_my_company_id: companyId || null });
      if (error) throw error;
    showSnackbar('Zapytanie zostało przekształcone w wydarzenie', 'success'); onConverted(data);
    } catch (error: any) {
      showSnackbar(error.message || 'Nie udało się utworzyć wydarzenia', 'error');
    } finally {
      convertLock.current = false;
      setSaving(false);
    }
  };
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onMouseDown={() => { if(!convertLock.current) onClose(); }}><div className="w-full max-w-xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-5" onMouseDown={(event) => event.stopPropagation()}><h2 className="text-lg font-light text-[#e5e4e2]">Utwórz wydarzenie z zapytania</h2><p className="mt-1 text-xs text-[#e5e4e2]/45">Dokumenty i zadania zachowają powiązania. Przy zaakceptowanej ofercie przeniesiemy wycenę oraz plan zasobów i dodamy zadanie weryfikacji dostępności. Bez akceptacji utworzymy robocze wydarzenie, pozostawiając sprzedaż otwartą.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="sm:col-span-2"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Nazwa</span><input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]" /></label><label><span className="mb-2 block text-xs text-[#e5e4e2]/50">Termin *</span><input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]" /></label><label><span className="mb-2 block text-xs text-[#e5e4e2]/50">Kategoria</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="">Bez kategorii</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="sm:col-span-2"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Działalność</span><select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="">Nieprzypisana</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.legal_name || item.name}</option>)}</select></label></div><div className="mt-5 flex justify-end gap-3"><button type="button" disabled={saving} onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/60">Anuluj</button><button type="button" onClick={() => void convert()} disabled={!name.trim() || !date || saving} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Utwórz wydarzenie</button></div></div></div>;
}
