'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Activity,
  Ban,
  CalendarClock,
  CheckCircle2,
  Eye,
  Mail,
  Megaphone,
  Plus,
  Pause,
  Play,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  TestTube2,
  Users,
  XCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';

type CampaignStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'scheduled'
  | 'sending'
  | 'paused'
  | 'sent'
  | 'cancelled'
  | 'failed';

type Campaign = {
  id: string;
  name: string;
  subject: string;
  content: string;
  preview_text: string | null;
  status: CampaignStatus;
  email_account_id: string | null;
  template_id: string | null;
  segment_ids: string[];
  audience_rules: AudienceRules;
  eligible_count: number;
  excluded_count: number;
  sent_count: number;
  failed_count: number;
  test_sent_at: string | null;
  test_sent_to: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  paused_at: string | null;
  batch_size: number;
  send_interval_seconds: number;
  opened_count: number;
  clicked_count: number;
  unsubscribed_count: number;
  track_opens: boolean;
  track_clicks: boolean;
  updated_at: string;
  brochure_generation_id: string | null;
};

type AudienceRules = {
  entity_types?: Array<'contact' | 'organization'>;
  event_types?: string[];
  regions?: string[];
  budget_min?: number;
  budget_max?: number;
  business_types?: string[];
};

type Segment = { id: string; name: string; color: string; description: string | null };
type EmailAccount = { id: string; email_address: string; from_name: string | null };
type Template = { id: string; name: string; subject_template: string | null; body_template: string };
type Recipient = {
  id: string;
  email: string | null;
  display_name: string | null;
  legal_basis: string | null;
  status: string;
  exclusion_reason: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  failed_at: string | null;
  attempt_count: number;
  error_message: string | null;
};

const statusLabels: Record<CampaignStatus, string> = {
  draft: 'Wersja robocza',
  pending_approval: 'Czeka na zatwierdzenie',
  approved: 'Zatwierdzona',
  scheduled: 'Zaplanowana',
  sending: 'Wysyłanie',
  paused: 'Wstrzymana',
  sent: 'Wysłana',
  cancelled: 'Anulowana',
  failed: 'Błąd',
};

const statusClasses: Record<CampaignStatus, string> = {
  draft: 'border-slate-400/20 bg-slate-400/10 text-slate-300',
  pending_approval: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  approved: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  scheduled: 'border-sky-400/25 bg-sky-400/10 text-sky-300',
  sending: 'border-blue-400/25 bg-blue-400/10 text-blue-300',
  paused: 'border-orange-400/25 bg-orange-400/10 text-orange-300',
  sent: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  cancelled: 'border-red-400/25 bg-red-400/10 text-red-300',
  failed: 'border-red-400/25 bg-red-400/10 text-red-300',
};

const exclusionLabels: Record<string, string> = {
  missing_email: 'Brak adresu e-mail',
  objection: 'Sprzeciw marketingowy',
  unsubscribed: 'Wypisany z komunikacji',
  no_marketing_permission: 'Brak zgody lub podstawy komunikacji',
  missing_legal_basis: 'Brak podstawy prawnej',
  email_bounced: 'Adres wcześniej odbijał wiadomości',
  invalid_email: 'Nieprawidłowy adres',
  suppression_list: 'Centralna lista wykluczeń',
  duplicate_email: 'Duplikat adresu',
  consent_changed: 'Zmieniona zgoda',
  campaign_cancelled: 'Kampania anulowana',
  audience_business_type: 'Inny rodzaj organizacji',
};

const recipientStatusLabels: Record<string, string> = {
  eligible: 'Dopuszczony',
  queued: 'W kolejce',
  processing: 'Wysyłanie',
  retry: 'Ponowienie',
  sent: 'Wysłany',
  delivered: 'Dostarczony',
  opened: 'Otwarty',
  clicked: 'Kliknięty',
  replied: 'Odpowiedź',
  failed: 'Błąd',
  bounced: 'Odbity',
  excluded: 'Wykluczony',
  unsubscribed: 'Wypisany',
};

const recipientStatusClass = (status: string) => {
  if (['sent', 'delivered', 'opened', 'clicked', 'replied'].includes(status)) return 'text-emerald-300';
  if (['failed', 'bounced'].includes(status)) return 'text-red-300';
  if (['excluded', 'unsubscribed'].includes(status)) return 'text-amber-300';
  if (['queued', 'processing', 'retry'].includes(status)) return 'text-sky-300';
  return 'text-[#e5e4e2]/60';
};

const inputClass = 'w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/50 disabled:cursor-not-allowed disabled:opacity-50';
const cardClass = 'rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]';

const splitValues = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const toDateTimeInput = (value: string | null) => {
  const date = value ? new Date(value) : new Date(Date.now() + 5 * 60 * 1000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

export default function CampaignsPageClient() {
  const [requestedCampaignId] = useState(() => typeof window === 'undefined'
    ? null
    : new URLSearchParams(window.location.search).get('campaign'));
  const { showSnackbar } = useSnackbar();
  const { employee, loading: employeeLoading, isAdmin, hasScope } = useCurrentEmployee();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Campaign | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [eventTypes, setEventTypes] = useState('');
  const [regions, setRegions] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [recipientFilter, setRecipientFilter] = useState<'all' | 'eligible' | 'excluded'>('all');
  const [scheduledAt, setScheduledAt] = useState(toDateTimeInput(null));
  const [batchSize, setBatchSize] = useState(10);
  const [sendIntervalSeconds, setSendIntervalSeconds] = useState(60);

  const canView = isAdmin || hasScope('marketing_campaigns_view') || hasScope('marketing_campaigns_manage') || hasScope('marketing_campaigns_approve');
  const canManage = isAdmin || hasScope('marketing_campaigns_manage');
  const canApprove = isAdmin || hasScope('marketing_campaigns_approve');
  const isEditable = draft?.status === 'draft' && canManage;

  const loadBaseData = useCallback(async (quiet = false) => {
    if (!canView) {
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    const [campaignRes, segmentRes, accountRes, templateRes] = await Promise.all([
      supabase.from('mailing_campaigns').select('*').order('updated_at', { ascending: false }),
      supabase.from('marketing_segments').select('id, name, color, description').eq('is_active', true).order('name'),
      supabase.from('employee_email_accounts').select('id, email_address, from_name').eq('is_active', true).order('is_default', { ascending: false }),
      supabase.from('email_templates').select('id, name, subject_template, body_template').order('name'),
    ]);
    const firstError = campaignRes.error || segmentRes.error || accountRes.error || templateRes.error;
    if (firstError) {
      showSnackbar(firstError.message || 'Nie udało się załadować Centrum Kampanii', 'error');
      if (!quiet) setLoading(false);
      return;
    }
    const loadedCampaigns = (campaignRes.data || []) as Campaign[];
    setCampaigns(loadedCampaigns);
    setSegments((segmentRes.data || []) as Segment[]);
    setAccounts((accountRes.data || []) as EmailAccount[]);
    setTemplates((templateRes.data || []) as Template[]);
    setSelectedId((current) => {
      if (current && loadedCampaigns.some((item) => item.id === current)) return current;
      if (requestedCampaignId && loadedCampaigns.some((item) => item.id === requestedCampaignId)) return requestedCampaignId;
      return loadedCampaigns[0]?.id || null;
    });
    if (!quiet) setLoading(false);
  }, [canView, requestedCampaignId, showSnackbar]);

  const loadRecipients = useCallback(async (campaignId: string) => {
    const { data, error } = await supabase
      .from('mailing_recipients')
      .select('id, email, display_name, legal_basis, status, exclusion_reason, sent_at, opened_at, clicked_at, failed_at, attempt_count, error_message')
      .eq('campaign_id', campaignId)
      .order('status')
      .order('display_name');
    if (error) {
      showSnackbar(error.message, 'error');
      return;
    }
    setRecipients((data || []) as Recipient[]);
  }, [showSnackbar]);

  useEffect(() => {
    if (!employeeLoading) void loadBaseData();
  }, [employeeLoading, loadBaseData]);

  useEffect(() => {
    const selected = campaigns.find((item) => item.id === selectedId) || null;
    setDraft(selected ? {
      ...selected,
      content: selected.content || '',
      segment_ids: [...(selected.segment_ids || [])],
      audience_rules: { ...(selected.audience_rules || {}) },
    } : null);
    setEventTypes((selected?.audience_rules?.event_types || []).join(', '));
    setRegions((selected?.audience_rules?.regions || []).join(', '));
    setScheduledAt(toDateTimeInput(selected?.scheduled_at || null));
    setBatchSize(selected?.batch_size || 10);
    setSendIntervalSeconds(selected?.send_interval_seconds || 60);
    if (selected) void loadRecipients(selected.id);
    else setRecipients([]);
  }, [campaigns, loadRecipients, selectedId]);

  const filteredRecipients = useMemo(() => recipientFilter === 'all'
    ? recipients
    : recipients.filter((item) => recipientFilter === 'excluded'
      ? ['excluded', 'unsubscribed'].includes(item.status)
      : !['excluded', 'unsubscribed'].includes(item.status)), [recipientFilter, recipients]);

  useEffect(() => {
    if (!draft || !['scheduled', 'sending'].includes(draft.status)) return;
    const timer = window.setInterval(() => {
      void loadBaseData(true);
      void loadRecipients(draft.id);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [draft?.id, draft?.status, loadBaseData, loadRecipients]);

  const updateDraft = <K extends keyof Campaign>(key: K, value: Campaign[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);

  const runAction = async (name: string, action: () => Promise<void>) => {
    if (busyAction) return;
    setBusyAction(name);
    try {
      await action();
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : 'Operacja nie powiodła się', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const createCampaign = () => void runAction('create', async () => {
    const { data, error } = await supabase.from('mailing_campaigns').insert({
      name: 'Nowa kampania',
      subject: '',
      content: '',
      status: 'draft',
      created_by: employee?.id || null,
    }).select('*').single();
    if (error) throw error;
    setCampaigns((current) => [data as Campaign, ...current]);
    setSelectedId(data.id);
    showSnackbar('Utworzono bezpieczną wersję roboczą kampanii', 'success');
  });

  const saveCampaign = () => void runAction('save', async () => {
    if (!draft || !isEditable) return;
    const audienceRules: AudienceRules = {
      ...(draft.audience_rules || {}),
      event_types: splitValues(eventTypes),
      regions: splitValues(regions),
    };
    if (!audienceRules.event_types?.length) delete audienceRules.event_types;
    if (!audienceRules.regions?.length) delete audienceRules.regions;
    if (!audienceRules.entity_types?.length) delete audienceRules.entity_types;
    if (!audienceRules.budget_min) delete audienceRules.budget_min;
    if (!audienceRules.budget_max) delete audienceRules.budget_max;
    const { data, error } = await supabase.from('mailing_campaigns').update({
      name: draft.name.trim(),
      subject: draft.subject.trim(),
      content: draft.content,
      preview_text: draft.preview_text?.trim() || null,
      email_account_id: draft.email_account_id || null,
      template_id: draft.template_id || null,
      segment_ids: draft.segment_ids,
      audience_rules: audienceRules,
      track_opens: draft.track_opens,
      track_clicks: draft.track_clicks,
    }).eq('id', draft.id).select('*').single();
    if (error) throw error;
    setCampaigns((current) => current.map((item) => item.id === data.id ? data as Campaign : item));
    showSnackbar('Zapisano kampanię. Po zmianach ponownie przelicz odbiorców i wyślij test.', 'success');
  });

  const refreshAudience = () => void runAction('audience', async () => {
    if (!draft) return;
    const { data, error } = await supabase.rpc('refresh_mailing_campaign_audience', { p_campaign_id: draft.id });
    if (error) throw error;
    await Promise.all([loadBaseData(), loadRecipients(draft.id)]);
    const result = data as { eligible?: number; excluded?: number } | null;
    showSnackbar(`Przeliczono odbiorców: ${result?.eligible || 0} dopuszczonych, ${result?.excluded || 0} wykluczonych`, 'success');
  });

  const sendTest = () => void runAction('test', async () => {
    if (!draft) return;
    const { data, error } = await supabase.functions.invoke('send-marketing-campaign-test', {
      body: { campaignId: draft.id, testEmail },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    await loadBaseData();
    showSnackbar(`Test wysłano na ${testEmail.trim().toLowerCase()}`, 'success');
  });

  const submitForApproval = () => void runAction('submit', async () => {
    if (!draft) return;
    const { error } = await supabase.rpc('submit_mailing_campaign_for_approval', { p_campaign_id: draft.id });
    if (error) throw error;
    await loadBaseData();
    showSnackbar('Kampania czeka na zatwierdzenie', 'success');
  });

  const approveCampaign = () => void runAction('approve', async () => {
    if (!draft) return;
    const { error } = await supabase.rpc('approve_mailing_campaign', { p_campaign_id: draft.id, p_note: null });
    if (error) throw error;
    await loadBaseData();
    showSnackbar('Kampania zatwierdzona. Możesz teraz bezpiecznie zaplanować wysyłkę.', 'success');
  });

  const invokeWorker = async () => {
    const { data, error } = await supabase.functions.invoke('process-marketing-campaigns', { body: { source: 'crm' } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
  };

  const scheduleCampaign = () => void runAction('schedule', async () => {
    if (!draft) return;
    const date = new Date(scheduledAt);
    if (Number.isNaN(date.getTime())) throw new Error('Podaj poprawny termin wysyłki');
    const { error } = await supabase.rpc('schedule_mailing_campaign', {
      p_campaign_id: draft.id,
      p_scheduled_at: date.toISOString(),
      p_batch_size: batchSize,
      p_send_interval_seconds: sendIntervalSeconds,
    });
    if (error) throw error;
    if (date.getTime() <= Date.now() + 10_000) await invokeWorker();
    await Promise.all([loadBaseData(), loadRecipients(draft.id)]);
    showSnackbar('Kampania została zaplanowana i przekazana do bezpiecznej kolejki', 'success');
  });

  const pauseCampaign = () => void runAction('pause', async () => {
    if (!draft) return;
    const { error } = await supabase.rpc('pause_mailing_campaign', { p_campaign_id: draft.id });
    if (error) throw error;
    await loadBaseData();
    showSnackbar('Kampania została wstrzymana', 'success');
  });

  const resumeCampaign = () => void runAction('resume', async () => {
    if (!draft) return;
    const { error } = await supabase.rpc('resume_mailing_campaign', { p_campaign_id: draft.id });
    if (error) throw error;
    await invokeWorker();
    await loadBaseData();
    showSnackbar('Kampania została wznowiona', 'success');
  });

  const cancelCampaign = () => void runAction('cancel', async () => {
    if (!draft || !window.confirm('Anulować kampanię? Niewysłane wiadomości zostaną trwale usunięte z kolejki.')) return;
    const { error } = await supabase.rpc('cancel_mailing_campaign', { p_campaign_id: draft.id });
    if (error) throw error;
    await Promise.all([loadBaseData(), loadRecipients(draft.id)]);
    showSnackbar('Kampania została anulowana', 'warning');
  });

  const applyTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      updateDraft('template_id', null);
      return;
    }
    setDraft((current) => current ? {
      ...current,
      template_id: template.id,
      subject: template.subject_template || current.subject,
      content: template.body_template,
    } : current);
  };

  if (employeeLoading || loading) return <div className="flex min-h-[50vh] items-center justify-center"><RefreshCw className="h-7 w-7 animate-spin text-[#d3bb73]" /></div>;
  if (!canView) return <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-6 text-red-200">Nie masz uprawnień do Centrum Kampanii.</div>;

  return (
    <main className="min-h-screen bg-[#0f1119] p-4 text-[#e5e4e2] md:p-6">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-[#d3bb73]"><Megaphone className="h-4 w-4" />Sprzedaż i relacje</div>
            <h1 className="text-2xl font-light md:text-3xl">Centrum Kampanii</h1>
            <p className="mt-1 max-w-3xl text-sm text-[#e5e4e2]/50">Twórz kampanie tylko do klientów z właściwą podstawą komunikacji. Każda grupa jest przeliczana, testowana i zatwierdzana przed wysyłką.</p>
          </div>
          <ResponsiveActionBar disabledBackground actions={[
            { label: 'Odśwież', icon: <RefreshCw className="h-4 w-4" />, onClick: () => void loadBaseData(), disabled: Boolean(busyAction) },
            { label: 'Nowa kampania', icon: <Plus className="h-4 w-4" />, onClick: createCampaign, variant: 'primary', show: canManage, disabled: Boolean(busyAction) },
          ]} />
        </header>

        <section className="grid gap-5 xl:grid-cols-[330px_minmax(0,1fr)]">
          <aside className={`${cardClass} overflow-hidden`}>
            <div className="border-b border-[#d3bb73]/10 px-4 py-3 text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/45">Kampanie</div>
            <div className="max-h-[72vh] space-y-2 overflow-y-auto p-2">
              {campaigns.length === 0 && <div className="p-8 text-center text-sm text-[#e5e4e2]/40">Brak kampanii. Utwórz pierwszą wersję roboczą.</div>}
              {campaigns.map((campaign) => (
                <button key={campaign.id} type="button" onClick={() => setSelectedId(campaign.id)} className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedId === campaign.id ? 'border-[#d3bb73]/45 bg-[#d3bb73]/10' : 'border-transparent bg-[#0f1119]/65 hover:border-[#d3bb73]/20'}`}>
                  <div className="flex items-start justify-between gap-2"><span className="min-w-0 truncate text-sm font-medium">{campaign.name}</span><span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${statusClasses[campaign.status]}`}>{statusLabels[campaign.status]}</span></div>
                  <div className="mt-2 truncate text-xs text-[#e5e4e2]/40">{campaign.subject || 'Brak tematu'}</div>
                  {campaign.brochure_generation_id && <div className="mt-2 inline-flex rounded-full border border-violet-400/20 bg-violet-400/10 px-2 py-0.5 text-[10px] text-violet-200">Broszura PDF · szkic</div>}
                  <div className="mt-3 flex gap-3 text-[11px] text-[#e5e4e2]/35"><span>{campaign.eligible_count} odbiorców</span><span>{formatDate(campaign.updated_at)}</span></div>
                </button>
              ))}
            </div>
          </aside>

          {!draft ? (
            <div className={`${cardClass} flex min-h-[420px] items-center justify-center p-8 text-center text-[#e5e4e2]/40`}>Wybierz kampanię lub utwórz nową.</div>
          ) : (
            <div className="min-w-0 space-y-5">
              <section className={`${cardClass} p-4 md:p-5`}>
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-xs ${statusClasses[draft.status]}`}>{statusLabels[draft.status]}</span>{draft.brochure_generation_id && <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-2.5 py-1 text-xs text-violet-200">Przypisana broszura PDF</span>}{draft.test_sent_at && <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Test {formatDate(draft.test_sent_at)}</span>}</div></div>
                  <button type="button" onClick={saveCampaign} disabled={!isEditable || Boolean(busyAction)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] disabled:cursor-not-allowed disabled:opacity-40">{busyAction === 'save' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Zapisz wersję</button>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Nazwa wewnętrzna</span><input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} disabled={!isEditable} className={inputClass} /></label>
                  <label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Konto nadawcze</span><select value={draft.email_account_id || ''} onChange={(event) => updateDraft('email_account_id', event.target.value || null)} disabled={!isEditable} className={inputClass}><option value="">Wybierz konto</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.from_name ? `${account.from_name} — ` : ''}{account.email_address}</option>)}</select></label>
                  <label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Szablon wiadomości</span><select value={draft.template_id || ''} onChange={(event) => applyTemplate(event.target.value)} disabled={!isEditable} className={inputClass}><option value="">Bez szablonu</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
                  <label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Tekst podglądu w skrzynce</span><input value={draft.preview_text || ''} onChange={(event) => updateDraft('preview_text', event.target.value)} disabled={!isEditable} placeholder="Krótka zapowiedź wiadomości" className={inputClass} /></label>
                  <label className="block lg:col-span-2"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Temat wiadomości</span><input value={draft.subject} onChange={(event) => updateDraft('subject', event.target.value)} disabled={!isEditable} className={inputClass} /></label>
                  <label className="block lg:col-span-2"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Treść HTML</span><textarea value={draft.content} onChange={(event) => updateDraft('content', event.target.value)} disabled={!isEditable} rows={14} className={`${inputClass} resize-y font-mono text-xs leading-5`} /></label>
                  <div className="grid gap-3 lg:col-span-2 sm:grid-cols-2">
                    <label className="flex items-start gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3"><input type="checkbox" checked={draft.track_opens} onChange={(event) => updateDraft('track_opens', event.target.checked)} disabled={!isEditable} className="mt-0.5 h-4 w-4" /><span><span className="block text-sm">Mierz otwarcia</span><span className="mt-1 block text-xs leading-5 text-[#e5e4e2]/40">Pomiar obrazkiem jest orientacyjny i może być blokowany przez program pocztowy.</span></span></label>
                    <label className="flex items-start gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3"><input type="checkbox" checked={draft.track_clicks} onChange={(event) => updateDraft('track_clicks', event.target.checked)} disabled={!isEditable} className="mt-0.5 h-4 w-4" /><span><span className="block text-sm">Mierz kliknięcia</span><span className="mt-1 block text-xs leading-5 text-[#e5e4e2]/40">Linki zostaną przekierowane przez bezpieczny licznik kampanii.</span></span></label>
                  </div>
                </div>
              </section>

              <section className={`${cardClass} p-4 md:p-5`}>
                <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-light"><Users className="h-5 w-5 text-[#d3bb73]" /> Odbiorcy</h2><p className="mt-1 text-xs text-[#e5e4e2]/45">Segment jest tylko filtrem wstępnym. Zgody, sprzeciwy i wykluczenia zawsze mają pierwszeństwo.</p></div><button type="button" onClick={refreshAudience} disabled={!canManage || !['draft', 'pending_approval'].includes(draft.status) || Boolean(busyAction)} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#d3bb73]/25 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-40">{busyAction === 'audience' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Przelicz</button></div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div><span className="mb-2 block text-xs text-[#e5e4e2]/50">Segmenty</span><div className="grid gap-2 sm:grid-cols-2">{segments.length === 0 ? <div className="text-sm text-[#e5e4e2]/35">Brak aktywnych segmentów — zostaną sprawdzone wszystkie profile.</div> : segments.map((segment) => { const checked = draft.segment_ids.includes(segment.id); return <label key={segment.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${checked ? 'border-[#d3bb73]/35 bg-[#d3bb73]/10' : 'border-[#d3bb73]/10 bg-[#0f1119]'}`}><input type="checkbox" checked={checked} disabled={!isEditable} onChange={() => updateDraft('segment_ids', checked ? draft.segment_ids.filter((id) => id !== segment.id) : [...draft.segment_ids, segment.id])} className="mt-0.5 h-4 w-4" /><span><span className="block text-sm">{segment.name}</span>{segment.description && <span className="mt-0.5 block text-xs text-[#e5e4e2]/40">{segment.description}</span>}</span></label>; })}</div></div>
                  <div className="space-y-3"><div><span className="mb-2 block text-xs text-[#e5e4e2]/50">Rodzaj klienta</span><div className="flex gap-2">{([['contact', 'Osoby'], ['organization', 'Firmy']] as const).map(([value, label]) => { const selected = draft.audience_rules.entity_types?.includes(value) || false; return <button key={value} type="button" disabled={!isEditable} onClick={() => updateDraft('audience_rules', { ...draft.audience_rules, entity_types: selected ? (draft.audience_rules.entity_types || []).filter((item) => item !== value) : [...(draft.audience_rules.entity_types || []), value] })} className={`rounded-lg border px-3 py-2 text-sm ${selected ? 'border-[#d3bb73]/40 bg-[#d3bb73]/10 text-[#d3bb73]' : 'border-[#d3bb73]/10 text-[#e5e4e2]/50'}`}>{label}</button>; })}</div></div><label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Typy wydarzeń (po przecinku)</span><input value={eventTypes} onChange={(event) => setEventTypes(event.target.value)} disabled={!isEditable} placeholder="wesele, gala, konferencja" className={inputClass} /></label><label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Regiony (po przecinku)</span><input value={regions} onChange={(event) => setRegions(event.target.value)} disabled={!isEditable} placeholder="warmińsko-mazurskie, mazowieckie" className={inputClass} /></label><div className="grid grid-cols-2 gap-3"><label><span className="mb-2 block text-xs text-[#e5e4e2]/50">Budżet od</span><input type="number" min="0" value={draft.audience_rules.budget_min || ''} onChange={(event) => updateDraft('audience_rules', { ...draft.audience_rules, budget_min: event.target.value ? Number(event.target.value) : undefined })} disabled={!isEditable} className={inputClass} /></label><label><span className="mb-2 block text-xs text-[#e5e4e2]/50">Budżet do</span><input type="number" min="0" value={draft.audience_rules.budget_max || ''} onChange={(event) => updateDraft('audience_rules', { ...draft.audience_rules, budget_max: event.target.value ? Number(event.target.value) : undefined })} disabled={!isEditable} className={inputClass} /></label></div></div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4"><div className="text-xs uppercase tracking-wide text-emerald-200/65">Dopuszczeni</div><div className="mt-1 text-3xl font-light text-emerald-300">{draft.eligible_count}</div></div><div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-4"><div className="text-xs uppercase tracking-wide text-amber-200/65">Wykluczeni</div><div className="mt-1 text-3xl font-light text-amber-300">{draft.excluded_count}</div></div></div>
              </section>

              <section className={`${cardClass} overflow-hidden`}>
                <div className="flex flex-col gap-3 border-b border-[#d3bb73]/10 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-light">Podgląd kwalifikacji</h2><p className="mt-1 text-xs text-[#e5e4e2]/40">Pełna lista przed wysyłką — bez ukrywania odrzuconych rekordów.</p></div><div className="flex rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] p-1">{([['all', 'Wszyscy'], ['eligible', 'Dopuszczeni'], ['excluded', 'Wykluczeni']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setRecipientFilter(value)} className={`rounded-md px-3 py-1.5 text-xs ${recipientFilter === value ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/50'}`}>{label}</button>)}</div></div>
                <div className="max-h-80 overflow-auto">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="sticky top-0 bg-[#151827] text-[#e5e4e2]/45"><tr><th className="px-4 py-2.5 font-medium">Odbiorca</th><th className="px-4 py-2.5 font-medium">E-mail</th><th className="px-4 py-2.5 font-medium">Podstawa</th><th className="px-4 py-2.5 font-medium">Stan</th><th className="px-4 py-2.5 font-medium">Próby</th></tr></thead>
                    <tbody className="divide-y divide-[#d3bb73]/5">
                      {filteredRecipients.map((recipient) => (
                        <tr key={recipient.id} className="hover:bg-[#d3bb73]/5">
                          <td className="px-4 py-2.5">{recipient.display_name || '—'}</td>
                          <td className="px-4 py-2.5 text-[#e5e4e2]/60">{recipient.email || '—'}</td>
                          <td className="px-4 py-2.5 text-[#e5e4e2]/50">{recipient.legal_basis || '—'}</td>
                          <td className={`px-4 py-2.5 ${recipientStatusClass(recipient.status)}`}>
                            <span className="inline-flex items-center gap-1.5">{['excluded', 'unsubscribed'].includes(recipient.status) ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{recipientStatusLabels[recipient.status] || recipient.status}{recipient.exclusion_reason ? ` — ${exclusionLabels[recipient.exclusion_reason] || recipient.exclusion_reason}` : ''}</span>
                            {recipient.error_message && <span className="mt-1 block max-w-xs truncate text-[10px] text-red-300/70" title={recipient.error_message}>{recipient.error_message}</span>}
                          </td>
                          <td className="px-4 py-2.5 text-[#e5e4e2]/45">{recipient.attempt_count || 0}</td>
                        </tr>
                      ))}
                      {filteredRecipients.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-[#e5e4e2]/35">Przelicz odbiorców, aby zobaczyć kwalifikację.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="grid gap-5 lg:grid-cols-2">
                <div className={`${cardClass} p-4 md:p-5`}>
                  <h2 className="flex items-center gap-2 text-lg font-light"><TestTube2 className="h-5 w-5 text-[#d3bb73]" /> Test, zatwierdzenie i wysyłka</h2>
                  <div className="mt-4 flex gap-2"><input type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="Adres odbiorcy testowego" disabled={!canManage || !['draft', 'pending_approval'].includes(draft.status)} className={inputClass} /><button type="button" onClick={sendTest} disabled={!testEmail || !canManage || !['draft', 'pending_approval'].includes(draft.status) || Boolean(busyAction)} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#d3bb73]/25 px-3 text-sm text-[#d3bb73] disabled:opacity-40">{busyAction === 'test' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Test</button></div>
                  <div className="mt-4 space-y-2 text-xs text-[#e5e4e2]/50"><div className="flex items-center gap-2">{draft.eligible_count > 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <AlertTriangle className="h-4 w-4 text-amber-300" />} Grupa odbiorców została przeliczona</div><div className="flex items-center gap-2">{draft.test_sent_at ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <AlertTriangle className="h-4 w-4 text-amber-300" />} Wiadomość testowa została wysłana</div></div>
                  {draft.brochure_generation_id && <div className="mt-4 rounded-lg border border-violet-400/20 bg-violet-400/10 p-3 text-xs leading-5 text-violet-100">To bezpieczny szkic powiązany z konkretną wersją PDF. Zatwierdzenie i masowa wysyłka są zablokowane do czasu aktywacji kontrolowanej dystrybucji linku.</div>}
                  <div className="mt-5 flex flex-wrap gap-2">
                    {draft.status === 'draft' && canManage && <button type="button" onClick={submitForApproval} disabled={Boolean(busyAction) || Boolean(draft.brochure_generation_id)} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#1c1f33] disabled:opacity-40"><ShieldCheck className="h-4 w-4" /> Przekaż do zatwierdzenia</button>}
                    {draft.status === 'pending_approval' && canApprove && <button type="button" onClick={approveCampaign} disabled={Boolean(busyAction)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-medium text-[#0f1119] disabled:opacity-40"><ShieldCheck className="h-4 w-4" /> Zatwierdź kampanię</button>}
                  </div>

                  {draft.status === 'approved' && canManage && (
                    <div className="mt-5 space-y-4 rounded-lg border border-blue-400/20 bg-blue-400/10 p-4">
                      <div><div className="flex items-center gap-2 text-sm font-medium text-blue-100"><CalendarClock className="h-4 w-4" /> Zaplanuj kontrolowaną wysyłkę</div><p className="mt-1 text-xs leading-5 text-blue-200/65">Po uruchomieniu odbiorcy zostaną ponownie sprawdzeni, a wiadomości trafią do kolejki partiami.</p></div>
                      <label className="block"><span className="mb-1.5 block text-xs text-blue-100/70">Termin startu</span><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className={inputClass} /></label>
                      <div className="grid grid-cols-2 gap-3"><label><span className="mb-1.5 block text-xs text-blue-100/70">Wiadomości w partii</span><input type="number" min="1" max="20" value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value))} className={inputClass} /></label><label><span className="mb-1.5 block text-xs text-blue-100/70">Odstęp między partiami</span><select value={sendIntervalSeconds} onChange={(event) => setSendIntervalSeconds(Number(event.target.value))} className={inputClass}><option value={60}>1 minuta</option><option value={120}>2 minuty</option><option value={300}>5 minut</option><option value={600}>10 minut</option></select></label></div>
                      <button type="button" onClick={scheduleCampaign} disabled={Boolean(busyAction) || batchSize < 1 || batchSize > 20} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-300 px-4 py-2.5 text-sm font-medium text-[#0f1119] disabled:opacity-40">{busyAction === 'schedule' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Uruchom bezpieczną kolejkę</button>
                    </div>
                  )}

                  {['scheduled', 'sending', 'paused', 'sent', 'cancelled', 'failed'].includes(draft.status) && (
                    <div className="mt-5 space-y-4">
                      <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 text-xs text-[#e5e4e2]/55"><div>Start: <span className="text-[#e5e4e2]">{formatDate(draft.scheduled_at)}</span></div><div className="mt-1">Partia: <span className="text-[#e5e4e2]">{draft.batch_size} wiadomości co {draft.send_interval_seconds} s</span></div></div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><div className="rounded-lg bg-emerald-400/10 p-3"><span className="block text-[10px] uppercase text-emerald-200/60">Wysłane</span><strong className="mt-1 block text-xl font-light text-emerald-300">{draft.sent_count}</strong></div><div className="rounded-lg bg-red-400/10 p-3"><span className="block text-[10px] uppercase text-red-200/60">Błędy</span><strong className="mt-1 block text-xl font-light text-red-300">{draft.failed_count}</strong></div><div className="rounded-lg bg-sky-400/10 p-3"><span className="block text-[10px] uppercase text-sky-200/60">Otwarcia</span><strong className="mt-1 block text-xl font-light text-sky-300">{draft.opened_count}</strong></div><div className="rounded-lg bg-violet-400/10 p-3"><span className="block text-[10px] uppercase text-violet-200/60">Kliknięcia</span><strong className="mt-1 block text-xl font-light text-violet-300">{draft.clicked_count}</strong></div><div className="rounded-lg bg-amber-400/10 p-3"><span className="block text-[10px] uppercase text-amber-200/60">Wypisani</span><strong className="mt-1 block text-xl font-light text-amber-300">{draft.unsubscribed_count}</strong></div></div>
                      {canManage && <div className="flex flex-wrap gap-2">{['scheduled', 'sending'].includes(draft.status) && <button type="button" onClick={pauseCampaign} disabled={Boolean(busyAction)} className="inline-flex items-center gap-2 rounded-lg border border-amber-400/25 px-3 py-2 text-sm text-amber-300 disabled:opacity-40"><Pause className="h-4 w-4" /> Wstrzymaj</button>}{draft.status === 'paused' && <button type="button" onClick={resumeCampaign} disabled={Boolean(busyAction)} className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/25 px-3 py-2 text-sm text-emerald-300 disabled:opacity-40"><Play className="h-4 w-4" /> Wznów</button>}{['scheduled', 'sending', 'paused'].includes(draft.status) && <button type="button" onClick={cancelCampaign} disabled={Boolean(busyAction)} className="inline-flex items-center gap-2 rounded-lg border border-red-400/25 px-3 py-2 text-sm text-red-300 disabled:opacity-40"><Ban className="h-4 w-4" /> Anuluj</button>}{['scheduled', 'sending'].includes(draft.status) && <span className="inline-flex items-center gap-2 px-2 text-xs text-sky-300"><Activity className="h-4 w-4 animate-pulse" /> Kolejka jest monitorowana automatycznie</span>}</div>}
                    </div>
                  )}
                </div>
                <div className={`${cardClass} overflow-hidden`}><div className="flex items-center gap-2 border-b border-[#d3bb73]/10 px-4 py-3 text-sm"><Eye className="h-4 w-4 text-[#d3bb73]" /> Podgląd wiadomości</div>{draft.preview_text && <div className="border-b border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-xs text-[#e5e4e2]/45"><Mail className="mr-2 inline h-3.5 w-3.5" />{draft.preview_text}</div>}<iframe title="Podgląd kampanii" sandbox="" srcDoc={draft.content || '<div style="font-family:Arial;padding:24px;color:#666">Uzupełnij treść wiadomości.</div>'} className="h-[430px] w-full bg-white" /></div>
              </section>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
