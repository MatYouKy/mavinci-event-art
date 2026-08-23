'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from '@hello-pangea/dnd';
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  CircleDollarSign,
  Inbox,
  LayoutGrid,
  List,
  Mail,
  Pencil,
  Percent,
  Phone,
  RefreshCw,
  Save,
  Search,
  Settings,
  UserRound,
  UserCheck,
  UsersRound,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import type {
  InquiryEmployee,
  InquiryListItem,
  InquiryStage,
} from '@/lib/CRM/inquiries/inquiriesData.server';

type Filter = 'open' | 'completed' | 'all';
type ViewMode = 'pipeline' | 'list';
type ScopeFilter = 'mine' | 'pool' | 'team' | 'all';
type AttentionFilter = 'all' | 'unassigned' | 'first_contact' | 'overdue' | 'missing_next';

type InquirySlaSettings = {
  id: number;
  is_enabled: boolean;
  unassigned_minutes: number;
  first_contact_minutes: number;
  repeat_minutes: number;
  escalation_minutes: number;
  max_owner_reminders: number;
  offer_followup_days: number[];
  assignment_mode: 'current' | 'round_robin';
  require_next_action_after_contact: boolean;
  default_next_action_hours: number;
  auto_promote_customer_lifecycle: boolean;
};

const STAGES: Array<{
  id: InquiryStage;
  label: string;
  shortLabel: string;
  className: string;
  dot: string;
  defaultProbability: number;
}> = [
  { id: 'new', label: 'Nowe zapytanie', shortLabel: 'Nowe', className: 'border-amber-400/30 bg-amber-400/10 text-amber-300', dot: 'bg-amber-400', defaultProbability: 10 },
  { id: 'contacted', label: 'Kontakt podjęty', shortLabel: 'Kontakt', className: 'border-sky-400/30 bg-sky-400/10 text-sky-300', dot: 'bg-sky-400', defaultProbability: 20 },
  { id: 'qualified', label: 'Zakwalifikowane', shortLabel: 'Kwalifikacja', className: 'border-blue-400/30 bg-blue-400/10 text-blue-300', dot: 'bg-blue-400', defaultProbability: 40 },
  { id: 'proposal', label: 'Oferta wysłana', shortLabel: 'Oferta', className: 'border-violet-400/30 bg-violet-400/10 text-violet-300', dot: 'bg-violet-400', defaultProbability: 60 },
  { id: 'negotiation', label: 'Negocjacje', shortLabel: 'Negocjacje', className: 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300', dot: 'bg-fuchsia-400', defaultProbability: 75 },
  { id: 'won', label: 'Wygrane', shortLabel: 'Wygrane', className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300', dot: 'bg-emerald-400', defaultProbability: 100 },
  { id: 'lost', label: 'Przegrane', shortLabel: 'Przegrane', className: 'border-red-400/30 bg-red-400/10 text-red-300', dot: 'bg-red-400', defaultProbability: 0 },
];

const stageConfig = (stage: InquiryStage) => STAGES.find((item) => item.id === stage) ?? STAGES[0];
const isOpenInquiry = (inquiry: InquiryListItem) => inquiry.inquiry_stage !== 'won' && inquiry.inquiry_stage !== 'lost';

const LOST_REASON_CATEGORIES = [
  ['price', 'Cena'],
  ['availability', 'Brak dostępnego terminu'],
  ['competitor', 'Wybrano konkurencję'],
  ['no_response', 'Brak odpowiedzi klienta'],
  ['scope', 'Zakres poza ofertą'],
  ['timing', 'Odłożona decyzja'],
  ['market_research', 'Badanie rynku'],
  ['duplicate', 'Duplikat zapytania'],
  ['other', 'Inny powód'],
] as const;

const getSourceLabel = (inquiry: InquiryListItem) => {
  const details = inquiry.inquiry_details;
  if (details?.source_kind === 'webhook') return details.source_name || details.source_slug || 'Zewnętrzne źródło';
  if (details?.source_page) return details.source_page;
  return details?.source_kind === 'contact_form' ? 'Formularz WWW' : 'Wprowadzone ręcznie';
};

const formatMoney = (value: number | null) => value === null ? null : new Intl.NumberFormat('pl-PL', {
  style: 'currency', currency: 'PLN', maximumFractionDigits: 0,
}).format(value);

const toDateTimeLocal = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const getInquiryWarnings = (inquiry: InquiryListItem) => {
  if (!isOpenInquiry(inquiry)) return [];
  const warnings: string[] = [];
  const details = inquiry.inquiry_details;
  if (!inquiry.inquiry_owner_id) warnings.push('Brak opiekuna');
  if (!details?.client_email && !details?.client_phone) warnings.push('Brak danych kontaktowych');
  if (!inquiry.next_action_at) warnings.push('Brak następnego działania');
  if (
    ['qualified', 'proposal', 'negotiation'].includes(inquiry.inquiry_stage)
    && !Number(inquiry.estimated_value ?? 0)
  ) warnings.push('Brak wartości');
  if (
    ['proposal', 'negotiation'].includes(inquiry.inquiry_stage)
    && !inquiry.linked_offer_id
  ) warnings.push('Brak powiązanej oferty');
  return warnings;
};

function InquiryCard({ inquiry, onEdit, onClaim, onCompleteContact, onSnooze, canEdit, canClaim, claiming, actionPending, compact = false }: {
  inquiry: InquiryListItem;
  onEdit: (inquiry: InquiryListItem) => void;
  onClaim: (inquiry: InquiryListItem) => void;
  onCompleteContact: (inquiry: InquiryListItem) => void;
  onSnooze: (inquiry: InquiryListItem) => void;
  canEdit: boolean;
  canClaim: boolean;
  claiming: boolean;
  actionPending: boolean;
  compact?: boolean;
}) {
  const details = inquiry.inquiry_details;
  const stage = stageConfig(inquiry.inquiry_stage);
  const warnings = getInquiryWarnings(inquiry);
  const nextActionOverdue = inquiry.next_action_at && new Date(inquiry.next_action_at).getTime() < Date.now() && isOpenInquiry(inquiry);

  return (
    <article className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 transition-colors hover:border-[#d3bb73]/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[#e5e4e2]">{inquiry.title.replace(/^Zapytanie:\s*/i, '')}</div>
          <div className="mt-1 truncate text-xs text-[#e5e4e2]/40">{getSourceLabel(inquiry)}</div>
        </div>
        {canEdit && (
          <button type="button" onClick={() => onEdit(inquiry)} className="shrink-0 rounded-md p-1.5 text-[#e5e4e2]/35 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]" aria-label="Edytuj zapytanie">
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </div>

      {!compact && <p className="mt-3 line-clamp-2 text-xs leading-5 text-[#e5e4e2]/50">{details?.source_message_content || inquiry.description || 'Brak dodatkowej treści'}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`rounded-full border px-2 py-1 text-[11px] ${stage.className}`}>{stage.shortLabel}</span>
        <span className="rounded-full border border-[#d3bb73]/15 bg-[#0f1119] px-2 py-1 text-[11px] text-[#e5e4e2]/55">{inquiry.win_probability}%</span>
      </div>

      <div className="mt-3 space-y-2 text-xs text-[#e5e4e2]/50">
        {details?.client_phone && <a href={`tel:${details.client_phone}`} className="flex items-center gap-1.5 hover:text-[#d3bb73]"><Phone className="h-3.5 w-3.5" /><span className="truncate">{details.client_phone}</span></a>}
        {details?.client_email && <a href={`mailto:${details.client_email}`} className="flex items-center gap-1.5 hover:text-[#d3bb73]"><Mail className="h-3.5 w-3.5" /><span className="truncate">{details.client_email}</span></a>}
        {inquiry.inquiry_owner && <div className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5 text-[#d3bb73]" /><span className="truncate">{inquiry.inquiry_owner.name} {inquiry.inquiry_owner.surname}</span></div>}
        {inquiry.estimated_value !== null && <div className="flex items-center gap-1.5"><CircleDollarSign className="h-3.5 w-3.5 text-[#d3bb73]" />{formatMoney(inquiry.estimated_value)}</div>}
        {inquiry.next_action_at && (
          <div className={`flex items-center gap-1.5 ${nextActionOverdue ? 'text-red-300' : ''}`}>
            <CalendarClock className="h-3.5 w-3.5" />
            {nextActionOverdue ? 'Zaległy kontakt: ' : 'Następny kontakt: '}
            {new Date(inquiry.next_action_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-400/15 bg-amber-400/5 p-2.5 text-[11px] text-amber-200/75">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{warnings.slice(0, compact ? 2 : 3).join(' · ')}</span>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#d3bb73]/10 pt-3">
        <Link href={`/crm/tasks/${inquiry.id}`} className="inline-flex items-center gap-1 text-xs text-[#d3bb73] hover:text-[#d3bb73]/80">Otwórz szczegóły <ChevronRight className="h-3.5 w-3.5" /></Link>
        {canEdit && inquiry.inquiry_owner_id && isOpenInquiry(inquiry) && (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => onSnooze(inquiry)} disabled={actionPending} className="rounded-lg border border-[#d3bb73]/15 px-2.5 py-1.5 text-[11px] text-[#e5e4e2]/65 hover:border-[#d3bb73]/35 disabled:opacity-50">Odłóż 1h</button>
            <button type="button" onClick={() => onCompleteContact(inquiry)} disabled={actionPending} className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1.5 text-[11px] text-emerald-300 hover:bg-emerald-400/15 disabled:opacity-50">Kontakt wykonany</button>
          </div>
        )}
        {canClaim && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClaim(inquiry);
            }}
            disabled={claiming}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-xs font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {claiming ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
            {claiming ? 'Przejmowanie…' : 'Przejmij'}
          </button>
        )}
      </div>
    </article>
  );
}

function InquiryEditorModal({ inquiry, employees, canAssign, onClose, onSaved }: {
  inquiry: InquiryListItem;
  employees: InquiryEmployee[];
  canAssign: boolean;
  onClose: () => void;
  onSaved: (inquiry: InquiryListItem) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [stage, setStage] = useState<InquiryStage>(inquiry.inquiry_stage);
  const [ownerId, setOwnerId] = useState(inquiry.inquiry_owner_id ?? '');
  const [nextActionAt, setNextActionAt] = useState(toDateTimeLocal(inquiry.next_action_at));
  const [lastContactAt, setLastContactAt] = useState(toDateTimeLocal(inquiry.last_contact_at));
  const [estimatedValue, setEstimatedValue] = useState(inquiry.estimated_value === null ? '' : String(inquiry.estimated_value));
  const [probability, setProbability] = useState(String(inquiry.win_probability));
  const [lostReason, setLostReason] = useState(inquiry.lost_reason ?? '');
  const [lostReasonCategory, setLostReasonCategory] = useState(inquiry.lost_reason_category ?? '');
  const [customerKey, setCustomerKey] = useState(
    inquiry.contact_id
      ? `contact:${inquiry.contact_id}`
      : inquiry.organization_id
        ? `organization:${inquiry.organization_id}`
        : '',
  );
  const [customerOptions, setCustomerOptions] = useState<Array<{
    id: string;
    type: 'contact' | 'organization';
    name: string;
  }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      supabase.from('contacts').select('id, full_name').eq('status', 'active').order('last_name').limit(500),
      supabase.from('organizations').select('id, name, alias').eq('status', 'active').order('name').limit(500),
    ]).then(([contactsResult, organizationsResult]) => {
      if (!active) return;
      setCustomerOptions([
        ...(contactsResult.data || []).map((item: any) => ({ id: item.id, type: 'contact' as const, name: item.full_name })),
        ...(organizationsResult.data || []).map((item: any) => ({ id: item.id, type: 'organization' as const, name: item.alias || item.name })),
      ]);
    });
    return () => { active = false; };
  }, []);

  const changeStage = (nextStage: InquiryStage) => {
    setStage(nextStage);
    setProbability(String(stageConfig(nextStage).defaultProbability));
  };

  const save = async () => {
    if (stage === 'lost' && (!lostReasonCategory || !lostReason.trim())) {
      showSnackbar('Wybierz kategorię i opisz powód przegrania zapytania', 'error');
      return;
    }

    const [customerType, customerId] = customerKey.split(':');

    setSaving(true);
    const { data, error } = await supabase.from('tasks').update({
      inquiry_stage: stage,
      inquiry_owner_id: ownerId || null,
      next_action_at: nextActionAt ? new Date(nextActionAt).toISOString() : null,
      last_contact_at: lastContactAt ? new Date(lastContactAt).toISOString() : null,
      estimated_value: estimatedValue === '' ? null : Number(estimatedValue),
      win_probability: Math.max(0, Math.min(100, Number(probability) || 0)),
      lost_reason: stage === 'lost' ? lostReason.trim() : null,
      lost_reason_category: stage === 'lost' ? lostReasonCategory : null,
      contact_id: customerType === 'contact' ? customerId : null,
      organization_id: customerType === 'organization' ? customerId : null,
    }).eq('id', inquiry.id).select(`
      id, title, description, priority, status, board_column, due_date, created_at, updated_at,
      inquiry_details, inquiry_stage, inquiry_owner_id, next_action_at, last_contact_at,
      first_contact_at, sla_first_contact_due_at,
      estimated_value, win_probability, lost_reason, lost_reason_category,
      linked_offer_id, event_id, contact_id, organization_id,
      inquiry_owner:employees!tasks_inquiry_owner_id_fkey(id, name, surname, avatar_url, sales_team_id, is_sales_team_manager)
    `).single();

    setSaving(false);
    if (error) {
      console.error('Error updating inquiry pipeline:', error);
      showSnackbar(error.message || 'Nie udało się zapisać zapytania', 'error');
      return;
    }
    showSnackbar('Zapytanie zostało zaktualizowane', 'success');
    onSaved(data as unknown as InquiryListItem);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#1c1f33] px-5 py-4">
          <div className="min-w-0"><h2 className="truncate text-lg font-light text-[#e5e4e2]">Obsługa zapytania</h2><p className="mt-0.5 truncate text-xs text-[#e5e4e2]/45">{inquiry.title.replace(/^Zapytanie:\s*/i, '')}</p></div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-[#e5e4e2]/45 hover:bg-[#0f1119] hover:text-[#e5e4e2]"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/45">Etap sprzedaży</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {STAGES.map((item) => <button key={item.id} type="button" onClick={() => changeStage(item.id)} className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm ${stage === item.id ? item.className : 'border-[#d3bb73]/10 bg-[#0f1119] text-[#e5e4e2]/60 hover:border-[#d3bb73]/25'}`}><span className={`h-2.5 w-2.5 rounded-full ${item.dot}`} />{item.label}</button>)}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Osoba odpowiedzialna</span><select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} disabled={!canAssign} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50 disabled:cursor-not-allowed disabled:opacity-55"><option value="">Nieprzypisane</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} {employee.surname}</option>)}</select>{!canAssign && <span className="mt-1 block text-[11px] text-[#e5e4e2]/35">Opiekuna może zmienić menedżer lub osoba z uprawnieniem przypisywania.</span>}</label>
            <label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Następne działanie</span><input type="datetime-local" value={nextActionAt} onChange={(event) => setNextActionAt(event.target.value)} disabled={stage === 'won' || stage === 'lost'} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50 disabled:opacity-40" /></label>
            <label className="block sm:col-span-2"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Powiązany klient lub organizacja</span><select value={customerKey} onChange={(event) => setCustomerKey(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50"><option value="">Brak powiązania</option><optgroup label="Kontakty">{customerOptions.filter((item) => item.type === 'contact').map((item) => <option key={`contact:${item.id}`} value={`contact:${item.id}`}>{item.name}</option>)}</optgroup><optgroup label="Organizacje">{customerOptions.filter((item) => item.type === 'organization').map((item) => <option key={`organization:${item.id}`} value={`organization:${item.id}`}>{item.name}</option>)}</optgroup></select><span className="mt-1 block text-[11px] text-[#e5e4e2]/35">Powiązanie zasili historię Klienta 360°.</span></label>
            <label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Szacowana wartość</span><div className="relative"><CircleDollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/30" /><input type="number" min="0" step="100" value={estimatedValue} onChange={(event) => setEstimatedValue(event.target.value)} placeholder="0" className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] py-2.5 pl-10 pr-12 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#e5e4e2]/35">PLN</span></div></label>
            <label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Prawdopodobieństwo wygranej</span><div className="relative"><Percent className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/30" /><input type="number" min="0" max="100" value={probability} onChange={(event) => setProbability(event.target.value)} disabled={stage === 'won' || stage === 'lost'} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] py-2.5 pl-10 pr-3 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50 disabled:opacity-40" /></div></label>
          </div>

          <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><label className="block flex-1"><span className="mb-2 block text-xs text-[#e5e4e2]/50">Ostatni kontakt</span><input type="datetime-local" value={lastContactAt} onChange={(event) => setLastContactAt(event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50" /></label><button type="button" onClick={() => setLastContactAt(toDateTimeLocal(new Date().toISOString()))} className="rounded-lg border border-[#d3bb73]/20 px-4 py-2.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/10">Kontakt teraz</button></div></div>

          {stage === 'lost' && <div className="grid gap-3"><label className="block"><span className="mb-2 block text-xs font-medium text-red-300">Kategoria utraty *</span><select value={lostReasonCategory} onChange={(event) => setLostReasonCategory(event.target.value)} className="w-full rounded-lg border border-red-400/25 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-red-400/50"><option value="">Wybierz kategorię</option>{LOST_REASON_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block"><span className="mb-2 block text-xs font-medium text-red-300">Opis powodu *</span><textarea value={lostReason} onChange={(event) => setLostReason(event.target.value)} rows={3} placeholder="Dodaj kontekst, który pomoże poprawić sprzedaż…" className="w-full resize-y rounded-lg border border-red-400/25 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/25 focus:border-red-400/50" /></label></div>}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-[#d3bb73]/10 bg-[#1c1f33] px-5 py-4"><button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-[#d3bb73]/15 px-4 py-2.5 text-sm text-[#e5e4e2]/65 hover:bg-[#0f1119] disabled:opacity-50">Anuluj</button><button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-2.5 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50">{saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? 'Zapisywanie…' : 'Zapisz'}</button></div>
      </div>
    </div>
  );
}

function InquirySlaSettingsModal({ onClose }: { onClose: () => void }) {
  const { showSnackbar } = useSnackbar();
  const [settings, setSettings] = useState<InquirySlaSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void supabase.from('inquiry_sla_settings').select('*').eq('id', 1).single().then(({ data, error }) => {
      if (error) {
        console.error('Error loading inquiry SLA settings:', error);
        showSnackbar('Nie udało się pobrać ustawień SLA', 'error');
        onClose();
        return;
      }
      setSettings(data as InquirySlaSettings);
    });
  }, [onClose, showSnackbar]);

  const updateNumber = (key: keyof InquirySlaSettings, value: string) => {
    setSettings((current) => current ? { ...current, [key]: Math.max(1, Number(value) || 1) } : current);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    const { error } = await supabase.from('inquiry_sla_settings').update({
      is_enabled: settings.is_enabled,
      unassigned_minutes: settings.unassigned_minutes,
      first_contact_minutes: settings.first_contact_minutes,
      repeat_minutes: settings.repeat_minutes,
      escalation_minutes: settings.escalation_minutes,
      max_owner_reminders: settings.max_owner_reminders,
      offer_followup_days: settings.offer_followup_days,
      assignment_mode: settings.assignment_mode,
      require_next_action_after_contact: settings.require_next_action_after_contact,
      default_next_action_hours: settings.default_next_action_hours,
      auto_promote_customer_lifecycle: settings.auto_promote_customer_lifecycle,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    setSaving(false);
    if (error) {
      showSnackbar(error.message || 'Nie udało się zapisać ustawień SLA', 'error');
      return;
    }
    showSnackbar('Ustawienia SLA zostały zapisane', 'success');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-5 py-4">
          <div><h2 className="text-lg font-light text-[#e5e4e2]">Automatyzacja SLA</h2><p className="mt-1 text-xs text-[#e5e4e2]/45">Czasy obowiązują wszystkie zapytania i są liczone na serwerze.</p></div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-[#e5e4e2]/45 hover:bg-[#0f1119]"><X className="h-5 w-5" /></button>
        </div>
        {!settings ? <div className="flex justify-center p-10"><RefreshCw className="h-5 w-5 animate-spin text-[#d3bb73]" /></div> : (
          <div className="space-y-4 p-5">
            <label className="flex items-center justify-between gap-4 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4"><span><span className="block text-sm text-[#e5e4e2]">Automatyczne przypomnienia</span><span className="mt-1 block text-xs text-[#e5e4e2]/45">Wyłącza nowe wysyłki bez usuwania historii.</span></span><input type="checkbox" checked={settings.is_enabled} onChange={(event) => setSettings({ ...settings, is_enabled: event.target.checked })} className="h-5 w-5" /></label>
            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
              <label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/55">Przydzielanie nowych zapytań</span><select value={settings.assignment_mode} onChange={(event) => setSettings({ ...settings, assignment_mode: event.target.value as InquirySlaSettings['assignment_mode'] })} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2]"><option value="current">Dotychczasowe — autor lub wspólna pula</option><option value="round_robin">Rotacyjne — osoba z najmniejszą liczbą otwartych szans</option></select></label>
              <p className="mt-2 text-xs leading-5 text-[#e5e4e2]/40">Tryb rotacyjny uwzględnia tylko aktywnych pracowników z uprawnieniami sprzedażowymi.</p>
            </div>
            <label className="flex items-center justify-between gap-4 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4"><span><span className="block text-sm text-[#e5e4e2]">Wymagaj kolejnego działania po kontakcie</span><span className="mt-1 block text-xs text-[#e5e4e2]/45">Jeśli pracownik nie poda terminu, CRM zaplanuje go automatycznie.</span></span><input type="checkbox" checked={settings.require_next_action_after_contact} onChange={(event) => setSettings({ ...settings, require_next_action_after_contact: event.target.checked })} className="h-5 w-5" /></label>
            {settings.require_next_action_after_contact && <label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/55">Domyślny kolejny kontakt po</span><div className="relative"><input type="number" min="1" max="720" value={settings.default_next_action_hours} onChange={(event) => updateNumber('default_next_action_hours', event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 pr-16 text-sm text-[#e5e4e2]" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#e5e4e2]/35">godz.</span></div></label>}
            <label className="flex items-center justify-between gap-4 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4"><span><span className="block text-sm text-[#e5e4e2]">Aktualizuj etap klienta automatycznie</span><span className="mt-1 block text-xs text-[#e5e4e2]/45">Wygrana oznacza klienta, a kwalifikacja — potencjalnego klienta.</span></span><input type="checkbox" checked={settings.auto_promote_customer_lifecycle} onChange={(event) => setSettings({ ...settings, auto_promote_customer_lifecycle: event.target.checked })} className="h-5 w-5" /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              {([
                ['unassigned_minutes', 'Nieprzypisane po', 'min'],
                ['first_contact_minutes', 'Pierwszy kontakt w', 'min'],
                ['repeat_minutes', 'Powtórz przypomnienie po', 'min'],
                ['escalation_minutes', 'Eskaluj do managera po', 'min'],
                ['max_owner_reminders', 'Liczba przypomnień opiekuna', 'razy'],
              ] as const).map(([key, label, unit]) => <label key={key} className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/55">{label}</span><div className="relative"><input type="number" min="1" value={settings[key]} onChange={(event) => updateNumber(key, event.target.value)} className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 pr-12 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#e5e4e2]/35">{unit}</span></div></label>)}
              <label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/55">Follow-up po ofercie (dni)</span><input value={settings.offer_followup_days.join(', ')} onChange={(event) => setSettings({ ...settings, offer_followup_days: event.target.value.split(',').map(Number).filter((value) => Number.isInteger(value) && value > 0) })} placeholder="1, 3, 7" className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50" /></label>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-3 border-t border-[#d3bb73]/10 px-5 py-4"><button type="button" onClick={onClose} className="rounded-lg border border-[#d3bb73]/15 px-4 py-2.5 text-sm text-[#e5e4e2]/65">Anuluj</button><button type="button" onClick={() => void save()} disabled={!settings || saving} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-2.5 text-sm font-medium text-[#1c1f33] disabled:opacity-50">{saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Zapisz</button></div>
      </div>
    </div>
  );
}

export default function InquiriesPageClient({ initialInquiries, employees }: { initialInquiries: InquiryListItem[]; employees: InquiryEmployee[] }) {
  const { showSnackbar } = useSnackbar();
  const { employee: currentEmployee, isAdmin, hasScope } = useCurrentEmployee();
  const [inquiries, setInquiries] = useState(initialInquiries);
  const [filter, setFilter] = useState<Filter>('open');
  const [viewMode, setViewMode] = useState<ViewMode>('pipeline');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [editingInquiry, setEditingInquiry] = useState<InquiryListItem | null>(null);
  const [scope, setScope] = useState<ScopeFilter>('pool');
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [actionPendingId, setActionPendingId] = useState<string | null>(null);
  const [showSlaSettings, setShowSlaSettings] = useState(false);
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>('all');

  const currentEmployeeId = currentEmployee?.id ?? null;
  const currentSalesTeamId = currentEmployee?.sales_team_id ?? null;
  const canViewPool = isAdmin || hasScope('inquiries_view') || hasScope('inquiries_manage') || hasScope('inquiries_view_pool');
  const canViewTeam = isAdmin || hasScope('inquiries_view_team') || hasScope('inquiries_manage_team');
  const canViewAll = isAdmin || hasScope('inquiries_view_all') || hasScope('inquiries_manage_all');
  const canAssign = isAdmin || hasScope('inquiries_assign') || hasScope('inquiries_manage_all');
  const canClaim = isAdmin || hasScope('inquiries_assign') || hasScope('inquiries_manage');

  const canManageInquiry = useCallback((inquiry: InquiryListItem) => {
    if (isAdmin || hasScope('inquiries_manage_all')) return true;
    if (
      inquiry.inquiry_owner_id === currentEmployeeId
      && (hasScope('inquiries_manage') || hasScope('inquiries_manage_own'))
    ) return true;
    return Boolean(
      currentEmployee?.is_sales_team_manager
      && currentSalesTeamId
      && inquiry.inquiry_owner?.sales_team_id === currentSalesTeamId
      && hasScope('inquiries_manage_team')
    );
  }, [currentEmployee?.is_sales_team_manager, currentEmployeeId, currentSalesTeamId, hasScope, isAdmin]);

  useEffect(() => {
    const saved = window.localStorage.getItem('crm-inquiries-view');
    if (saved === 'pipeline' || saved === 'list') setViewMode(saved);
    const savedScope = window.localStorage.getItem('crm-inquiries-scope');
    if (savedScope === 'mine' || savedScope === 'pool' || savedScope === 'team' || savedScope === 'all') {
      setScope(savedScope);
    }
  }, []);

  useEffect(() => {
    if (!currentEmployee) return;
    if (scope === 'all' && !canViewAll) setScope(canViewPool ? 'pool' : 'mine');
    if (scope === 'team' && !canViewTeam) setScope(canViewPool ? 'pool' : 'mine');
    if (scope === 'pool' && !canViewPool) setScope('mine');
  }, [canViewAll, canViewPool, canViewTeam, currentEmployee, scope]);

  const changeView = (mode: ViewMode) => {
    setViewMode(mode);
    window.localStorage.setItem('crm-inquiries-view', mode);
  };

  const changeScope = (nextScope: ScopeFilter) => {
    setScope(nextScope);
    window.localStorage.setItem('crm-inquiries-scope', nextScope);
  };

  const reload = useCallback(async () => {
    setRefreshing(true);
    const { data, error } = await supabase.from('tasks').select(`
      id, title, description, priority, status, board_column, due_date, created_at, updated_at,
      inquiry_details, inquiry_stage, inquiry_owner_id, next_action_at, last_contact_at,
      first_contact_at, sla_first_contact_due_at,
      estimated_value, win_probability, lost_reason, lost_reason_category,
      linked_offer_id, event_id, contact_id, organization_id,
      inquiry_owner:employees!tasks_inquiry_owner_id_fkey(id, name, surname, avatar_url, sales_team_id, is_sales_team_manager)
    `).eq('is_inquiry', true).order('created_at', { ascending: false });
    if (!error) setInquiries((data ?? []) as unknown as InquiryListItem[]);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const channel = supabase.channel('web-inquiries-pipeline').on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: 'is_inquiry=eq.true' }, () => void reload()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [reload]);

  const counts = useMemo(() => ({
    open: inquiries.filter(isOpenInquiry).length,
    completed: inquiries.filter((inquiry) => !isOpenInquiry(inquiry)).length,
    all: inquiries.length,
  }), [inquiries]);

  const visibleInquiries = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pl-PL');
    return inquiries.filter((inquiry) => {
      if (scope === 'mine' && inquiry.inquiry_owner_id !== currentEmployeeId) return false;
      if (scope === 'pool' && inquiry.inquiry_owner_id !== null) return false;
      if (
        scope === 'team'
        && (!currentSalesTeamId || inquiry.inquiry_owner?.sales_team_id !== currentSalesTeamId)
      ) return false;
      if (filter === 'open' && !isOpenInquiry(inquiry)) return false;
      if (filter === 'completed' && isOpenInquiry(inquiry)) return false;
      const now = Date.now();
      if (attentionFilter === 'unassigned' && (!isOpenInquiry(inquiry) || inquiry.inquiry_owner_id)) return false;
      if (attentionFilter === 'first_contact' && (!isOpenInquiry(inquiry) || !inquiry.inquiry_owner_id || inquiry.first_contact_at || !inquiry.sla_first_contact_due_at || new Date(inquiry.sla_first_contact_due_at).getTime() >= now)) return false;
      if (attentionFilter === 'overdue' && (!isOpenInquiry(inquiry) || !inquiry.next_action_at || new Date(inquiry.next_action_at).getTime() >= now)) return false;
      if (attentionFilter === 'missing_next' && (!isOpenInquiry(inquiry) || !inquiry.first_contact_at || inquiry.next_action_at)) return false;
      if (!normalizedSearch) return true;
      const details = inquiry.inquiry_details;
      return [inquiry.title, inquiry.description, details?.client_text, details?.client_company, details?.client_email, details?.client_phone, details?.location_text, details?.scope, details?.source_name, details?.source_slug, inquiry.inquiry_owner?.name, inquiry.inquiry_owner?.surname, inquiry.lost_reason].some((value) => String(value ?? '').toLocaleLowerCase('pl-PL').includes(normalizedSearch));
    });
  }, [attentionFilter, currentEmployeeId, currentSalesTeamId, filter, inquiries, scope, search]);

  const scopeCounts = useMemo(() => ({
    mine: inquiries.filter((inquiry) => inquiry.inquiry_owner_id === currentEmployeeId).length,
    pool: inquiries.filter((inquiry) => inquiry.inquiry_owner_id === null).length,
    team: inquiries.filter((inquiry) => Boolean(
      currentSalesTeamId && inquiry.inquiry_owner?.sales_team_id === currentSalesTeamId,
    )).length,
    all: inquiries.length,
  }), [currentEmployeeId, currentSalesTeamId, inquiries]);

  const assignableEmployees = useMemo(() => {
    if (isAdmin || hasScope('inquiries_manage_all') || hasScope('inquiries_view_all')) return employees;
    if (!currentSalesTeamId) return employees.filter((employee) => employee.id === currentEmployeeId);
    return employees.filter((employee) => employee.sales_team_id === currentSalesTeamId);
  }, [currentEmployeeId, currentSalesTeamId, employees, hasScope, isAdmin]);

  const pipelineValue = useMemo(() => visibleInquiries.filter(isOpenInquiry).reduce((sum, inquiry) => sum + Number(inquiry.estimated_value ?? 0) * (Number(inquiry.win_probability ?? 0) / 100), 0), [visibleInquiries]);
  const slaMetrics = useMemo(() => {
    const now = Date.now();
    return {
      unassigned: inquiries.filter((inquiry) => isOpenInquiry(inquiry) && !inquiry.inquiry_owner_id).length,
      firstContactBreached: inquiries.filter((inquiry) => isOpenInquiry(inquiry) && inquiry.inquiry_owner_id && !inquiry.first_contact_at && inquiry.sla_first_contact_due_at && new Date(inquiry.sla_first_contact_due_at).getTime() < now).length,
      overdueActions: inquiries.filter((inquiry) => isOpenInquiry(inquiry) && inquiry.next_action_at && new Date(inquiry.next_action_at).getTime() < now).length,
      missingNextAction: inquiries.filter((inquiry) => isOpenInquiry(inquiry) && inquiry.first_contact_at && !inquiry.next_action_at).length,
    };
  }, [inquiries]);
  const updateInquiry = (updated: InquiryListItem) => { setInquiries((current) => current.map((item) => item.id === updated.id ? updated : item)); setEditingInquiry(null); };

  const completeContact = async (inquiry: InquiryListItem) => {
    setActionPendingId(inquiry.id);
    const { error } = await supabase.rpc('complete_inquiry_followup', {
      p_inquiry_id: inquiry.id,
      p_next_action_at: null,
    });
    setActionPendingId(null);
    if (error) {
      showSnackbar(error.message || 'Nie udało się potwierdzić kontaktu', 'error');
      return;
    }
    await reload();
    showSnackbar('Kontakt został zapisany. Ustaw termin kolejnego działania, jeśli jest potrzebny.', 'success');
  };

  const snoozeFollowup = async (inquiry: InquiryListItem) => {
    setActionPendingId(inquiry.id);
    const { error } = await supabase.rpc('snooze_inquiry_followup', { p_inquiry_id: inquiry.id, p_minutes: 60 });
    setActionPendingId(null);
    if (error) {
      showSnackbar(error.message || 'Nie udało się odłożyć przypomnienia', 'error');
      return;
    }
    await reload();
    showSnackbar('Następne działanie ustawiono za godzinę', 'success');
  };

  const claimInquiry = async (inquiry: InquiryListItem) => {
    if (!canClaim || inquiry.inquiry_owner_id) return;
    setClaimingId(inquiry.id);
    const { error } = await supabase.rpc('claim_inquiry', { p_inquiry_id: inquiry.id });
    if (error) {
      console.error('Error claiming inquiry:', error);
      showSnackbar(error.message || 'Nie udało się przejąć zapytania', 'error');
      await reload();
      setClaimingId(null);
      return;
    }
    await reload();
    setClaimingId(null);
    changeScope('mine');
    showSnackbar('Zapytanie zostało przypisane do Ciebie', 'success');
  };

  const moveInquiry = async (result: DropResult) => {
    if (!result.destination) return;
    const inquiry = inquiries.find((item) => item.id === result.draggableId);
    const nextStage = result.destination.droppableId as InquiryStage;
    if (!inquiry || inquiry.inquiry_stage === nextStage) return;
    if (!canManageInquiry(inquiry)) {
      showSnackbar('Najpierw przejmij zapytanie lub poproś menedżera o przypisanie', 'error');
      return;
    }

    const nextProbability = stageConfig(nextStage).defaultProbability;
    if (nextStage === 'lost') {
      setEditingInquiry({
        ...inquiry,
        inquiry_stage: nextStage,
        win_probability: nextProbability,
      });
      return;
    }

    const previous = inquiry;
    setInquiries((current) => current.map((item) => item.id === inquiry.id ? {
      ...item,
      inquiry_stage: nextStage,
      win_probability: nextProbability,
      lost_reason: null,
      lost_reason_category: null,
    } : item));

    const { data, error } = await supabase.from('tasks').update({
      inquiry_stage: nextStage,
      win_probability: nextProbability,
      lost_reason: null,
      lost_reason_category: null,
    }).eq('id', inquiry.id).select(`
      id, title, description, priority, status, board_column, due_date, created_at, updated_at,
      inquiry_details, inquiry_stage, inquiry_owner_id, next_action_at, last_contact_at,
      estimated_value, win_probability, lost_reason, lost_reason_category,
      linked_offer_id, event_id, contact_id, organization_id,
      inquiry_owner:employees!tasks_inquiry_owner_id_fkey(id, name, surname, avatar_url, sales_team_id, is_sales_team_manager)
    `).single();

    if (error) {
      setInquiries((current) => current.map((item) => item.id === previous.id ? previous : item));
      console.error('Error moving inquiry:', error);
      showSnackbar(error.message || 'Nie udało się przenieść zapytania', 'error');
      return;
    }

    updateInquiry(data as unknown as InquiryListItem);
    showSnackbar(`Przeniesiono do etapu „${stageConfig(nextStage).label}”`, 'success');
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="mb-2 flex items-center gap-2 text-sm text-[#d3bb73]"><Inbox className="h-4 w-4" />Centrum sprzedaży</div><h1 className="text-2xl font-light text-[#e5e4e2] md:text-3xl">Lejek zapytań</h1><p className="mt-1 text-sm text-[#e5e4e2]/55">Formularze, webhooki i zapytania ręczne w jednym procesie sprzedażowym.</p></div>
        <div className="flex flex-wrap gap-2"><div className="flex rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] p-1"><button type="button" onClick={() => changeView('pipeline')} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm ${viewMode === 'pipeline' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/55'}`}><LayoutGrid className="h-4 w-4" /> Lejek</button><button type="button" onClick={() => changeView('list')} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm ${viewMode === 'list' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/55'}`}><List className="h-4 w-4" /> Lista</button></div>{isAdmin && <button type="button" onClick={() => setShowSlaSettings(true)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/25 bg-[#1c1f33] px-4 py-2 text-sm text-[#e5e4e2] hover:border-[#d3bb73]/50"><Settings className="h-4 w-4" /> SLA</button>}<button type="button" onClick={() => void reload()} disabled={refreshing} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/25 bg-[#1c1f33] px-4 py-2 text-sm text-[#e5e4e2] hover:border-[#d3bb73]/50 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Odśwież</button></div>
      </div>

      {(slaMetrics.unassigned > 0 || slaMetrics.firstContactBreached > 0 || slaMetrics.overdueActions > 0 || slaMetrics.missingNextAction > 0) && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <button type="button" onClick={() => setAttentionFilter(attentionFilter === 'unassigned' ? 'all' : 'unassigned')} className={`rounded-xl border p-3 text-left ${attentionFilter === 'unassigned' ? 'border-amber-300 bg-amber-400/15' : 'border-amber-400/20 bg-amber-400/5'}`}><div className="text-xs text-amber-200/65">Bez opiekuna</div><div className="mt-1 text-xl text-amber-200">{slaMetrics.unassigned}</div></button>
          <button type="button" onClick={() => setAttentionFilter(attentionFilter === 'first_contact' ? 'all' : 'first_contact')} className={`rounded-xl border p-3 text-left ${attentionFilter === 'first_contact' ? 'border-red-300 bg-red-400/15' : 'border-red-400/20 bg-red-400/5'}`}><div className="text-xs text-red-200/65">SLA pierwszego kontaktu</div><div className="mt-1 text-xl text-red-200">{slaMetrics.firstContactBreached}</div></button>
          <button type="button" onClick={() => setAttentionFilter(attentionFilter === 'overdue' ? 'all' : 'overdue')} className={`rounded-xl border p-3 text-left ${attentionFilter === 'overdue' ? 'border-orange-300 bg-orange-400/15' : 'border-orange-400/20 bg-orange-400/5'}`}><div className="text-xs text-orange-200/65">Zaległe działania</div><div className="mt-1 text-xl text-orange-200">{slaMetrics.overdueActions}</div></button>
          <button type="button" onClick={() => setAttentionFilter(attentionFilter === 'missing_next' ? 'all' : 'missing_next')} className={`rounded-xl border p-3 text-left ${attentionFilter === 'missing_next' ? 'border-violet-300 bg-violet-400/15' : 'border-violet-400/20 bg-violet-400/5'}`}><div className="text-xs text-violet-200/65">Brak następnego działania</div><div className="mt-1 text-xl text-violet-200">{slaMetrics.missingNextAction}</div></button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {([['open', 'Aktywne', counts.open], ['completed', 'Zamknięte', counts.completed], ['all', 'Wszystkie', counts.all]] as const).map(([key, label, value]) => <button key={key} type="button" onClick={() => setFilter(key)} className={`rounded-xl border p-4 text-left ${filter === key ? 'border-[#d3bb73]/60 bg-[#d3bb73]/10' : 'border-[#d3bb73]/10 bg-[#1c1f33] hover:border-[#d3bb73]/30'}`}><div className="text-xs uppercase tracking-wide text-[#e5e4e2]/45">{label}</div><div className="mt-1 text-2xl font-light text-[#e5e4e2]">{value}</div></button>)}
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4"><div className="text-xs uppercase tracking-wide text-[#e5e4e2]/45">Ważona wartość lejka</div><div className="mt-1 text-2xl font-light text-[#d3bb73]">{formatMoney(pipelineValue)}</div></div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-2">
        <span className="px-2 text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/35">Zakres</span>
        <button type="button" onClick={() => changeScope('mine')} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${scope === 'mine' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/60 hover:bg-[#0f1119]'}`}><UserRound className="h-4 w-4" />Moje <span className="opacity-60">{scopeCounts.mine}</span></button>
        {canViewPool && <button type="button" onClick={() => changeScope('pool')} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${scope === 'pool' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/60 hover:bg-[#0f1119]'}`}><Inbox className="h-4 w-4" />Nieprzypisane <span className="opacity-60">{scopeCounts.pool}</span></button>}
        {canViewTeam && <button type="button" onClick={() => changeScope('team')} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${scope === 'team' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/60 hover:bg-[#0f1119]'}`}><UsersRound className="h-4 w-4" />Zespół <span className="opacity-60">{scopeCounts.team}</span></button>}
        {canViewAll && <button type="button" onClick={() => changeScope('all')} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${scope === 'all' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/60 hover:bg-[#0f1119]'}`}><LayoutGrid className="h-4 w-4" />Wszystkie <span className="opacity-60">{scopeCounts.all}</span></button>}
      </div>

      <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/35" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj po kliencie, firmie, e-mailu, telefonie, źródle lub opiekunie…" className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] py-3 pl-10 pr-4 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/30 focus:border-[#d3bb73]/50" /></div>

      {visibleInquiries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#d3bb73]/20 bg-[#1c1f33]/50 px-6 py-16 text-center"><Inbox className="mx-auto h-10 w-10 text-[#e5e4e2]/25" /><div className="mt-4 text-[#e5e4e2]">Brak zapytań w tym widoku</div><div className="mt-1 text-sm text-[#e5e4e2]/45">Zmień filtr lub wyszukiwaną frazę.</div></div>
      ) : viewMode === 'pipeline' ? (
        <DragDropContext onDragEnd={(result) => void moveInquiry(result)}>
        <div className="overflow-x-auto pb-4"><div className="flex min-w-max items-start gap-4">{STAGES.map((stage) => {
          const items = visibleInquiries.filter((inquiry) => inquiry.inquiry_stage === stage.id);
          const value = items.reduce((sum, inquiry) => sum + Number(inquiry.estimated_value ?? 0), 0);
          return <section key={stage.id} className="w-[310px] shrink-0 rounded-xl border border-[#d3bb73]/10 bg-[#0f1119]/70 p-3"><div className="mb-3 flex items-start justify-between gap-2 px-1"><div><div className="flex items-center gap-2 text-sm font-medium text-[#e5e4e2]"><span className={`h-2.5 w-2.5 rounded-full ${stage.dot}`} />{stage.label}</div><div className="mt-1 text-xs text-[#e5e4e2]/35">{formatMoney(value) || '0 zł'}</div></div><span className="rounded-full bg-[#1c1f33] px-2 py-1 text-xs text-[#e5e4e2]/55">{items.length}</span></div><Droppable droppableId={stage.id}>{(dropProvided, dropSnapshot) => <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className={`min-h-24 space-y-3 rounded-lg transition-colors ${dropSnapshot.isDraggingOver ? 'bg-[#d3bb73]/5 ring-1 ring-[#d3bb73]/30' : ''}`}>{items.length === 0 && !dropSnapshot.isDraggingOver ? <div className="rounded-lg border border-dashed border-[#d3bb73]/10 px-3 py-8 text-center text-xs text-[#e5e4e2]/25">Przeciągnij tutaj</div> : items.map((inquiry, index) => <Draggable key={inquiry.id} draggableId={inquiry.id} index={index} isDragDisabled={!canManageInquiry(inquiry)}>{(dragProvided, dragSnapshot) => <div ref={dragProvided.innerRef} {...dragProvided.draggableProps} {...dragProvided.dragHandleProps} className={`${canManageInquiry(inquiry) ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} ${dragSnapshot.isDragging ? 'rotate-1 opacity-95 shadow-2xl' : ''}`}><InquiryCard inquiry={inquiry} onEdit={setEditingInquiry} onClaim={(item) => void claimInquiry(item)} onCompleteContact={(item) => void completeContact(item)} onSnooze={(item) => void snoozeFollowup(item)} canEdit={canManageInquiry(inquiry)} canClaim={canClaim && !inquiry.inquiry_owner_id} claiming={claimingId === inquiry.id} actionPending={actionPendingId === inquiry.id} compact /></div>}</Draggable>)}{dropProvided.placeholder}</div>}</Droppable></section>;
        })}</div></div>
        </DragDropContext>
      ) : <div className="grid gap-3 lg:grid-cols-2">{visibleInquiries.map((inquiry) => <InquiryCard key={inquiry.id} inquiry={inquiry} onEdit={setEditingInquiry} onClaim={(item) => void claimInquiry(item)} onCompleteContact={(item) => void completeContact(item)} onSnooze={(item) => void snoozeFollowup(item)} canEdit={canManageInquiry(inquiry)} canClaim={canClaim && !inquiry.inquiry_owner_id} claiming={claimingId === inquiry.id} actionPending={actionPendingId === inquiry.id} />)}</div>}

      {editingInquiry && <InquiryEditorModal inquiry={editingInquiry} employees={assignableEmployees} canAssign={canAssign} onClose={() => setEditingInquiry(null)} onSaved={updateInquiry} />}
      {showSlaSettings && <InquirySlaSettingsModal onClose={() => setShowSlaSettings(false)} />}
    </div>
  );
}
