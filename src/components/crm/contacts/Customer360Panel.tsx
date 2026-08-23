'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Clock3,
  FileText,
  Mail,
  MessageSquareText,
  Phone,
  RefreshCw,
  Sparkles,
  Target,
  UserRoundSearch,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import CustomerSegmentationPanel from '@/components/crm/contacts/CustomerSegmentationPanel';

type Contact360 = {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  status: string;
  tags: string[] | null;
  created_at: string;
  owner_id?: string | null;
  lifecycle_status?: string | null;
};

const LIFECYCLE = [
  ['lead', 'Nowy lead'],
  ['prospect', 'Potencjalny klient'],
  ['customer', 'Klient'],
  ['inactive', 'Nieaktywny'],
  ['lost', 'Utracony'],
] as const;

type TimelineKind = 'call' | 'email' | 'inquiry' | 'meeting' | 'offer' | 'event';

type TimelineItem = {
  id: string;
  kind: TimelineKind;
  title: string;
  description?: string | null;
  date: string;
  href?: string;
  status?: string | null;
};

type Customer360State = {
  timeline: TimelineItem[];
  organizations: Array<{ id: string; name: string; position: string | null }>;
  duplicates: Array<{
    id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    reason: string;
  }>;
  openInquiries: number;
  pipelineValue: number;
  upcomingEvents: number;
  dueActions: number;
};

const EMPTY_STATE: Customer360State = {
  timeline: [],
  organizations: [],
  duplicates: [],
  openInquiries: 0,
  pipelineValue: 0,
  upcomingEvents: 0,
  dueActions: 0,
};

const KIND_CONFIG: Record<
  TimelineKind,
  { label: string; className: string; icon: typeof Phone }
> = {
  call: { label: 'Połączenie', className: 'bg-emerald-500/15 text-emerald-300', icon: Phone },
  email: { label: 'E-mail', className: 'bg-sky-500/15 text-sky-300', icon: Mail },
  inquiry: { label: 'Zapytanie', className: 'bg-amber-500/15 text-amber-300', icon: Target },
  meeting: { label: 'Spotkanie', className: 'bg-violet-500/15 text-violet-300', icon: Calendar },
  offer: { label: 'Oferta', className: 'bg-[#d3bb73]/15 text-[#d3bb73]', icon: FileText },
  event: { label: 'Wydarzenie', className: 'bg-fuchsia-500/15 text-fuchsia-300', icon: Briefcase },
};

const normalizeEmail = (value?: string | null) => value?.trim().toLocaleLowerCase('pl-PL') || '';
const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '').replace(/^48(?=\d{9}$)/, '');
const cleanText = (value?: string | null) => (value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const formatDate = (value: string) =>
  new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

const matchesInquiry = (details: any, email: string, phones: string[]) => {
  const inquiryEmail = normalizeEmail(details?.client_email || details?.email);
  const inquiryPhone = normalizePhone(details?.client_phone || details?.phone);
  return Boolean((email && inquiryEmail === email) || (inquiryPhone && phones.includes(inquiryPhone)));
};

export default function Customer360Panel({ contact }: { contact: Contact360 }) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [data, setData] = useState<Customer360State>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [ownerId, setOwnerId] = useState(contact.owner_id || '');
  const [lifecycle, setLifecycle] = useState(contact.lifecycle_status || 'lead');
  const [savingOwnership, setSavingOwnership] = useState(false);
  const [canMerge, setCanMerge] = useState(false);
  const [mergeSource, setMergeSource] = useState<Customer360State['duplicates'][number] | null>(null);
  const [mergePreview, setMergePreview] = useState<any>(null);
  const [mergeLoading, setMergeLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      const email = normalizeEmail(contact.email);
      const phones = [normalizePhone(contact.mobile), normalizePhone(contact.phone)].filter(Boolean);

      try {
        const { data: authData } = await supabase.auth.getUser();
        const [
          callsResult,
          organizationsResult,
          offersResult,
          directEventsResult,
          eventLinksResult,
          meetingsResult,
          inquiriesResult,
          contactsResult,
          receivedResult,
          sentResult,
          employeesResult,
        ] = await Promise.all([
          supabase
            .from('crm_call_activities')
            .select('id, outcome, status, started_at, notes, next_action_at')
            .eq('contact_id', contact.id)
            .order('started_at', { ascending: false })
            .limit(100),
          supabase
            .from('contact_organizations')
            .select('position, organization:organizations(id, name, alias)')
            .eq('contact_id', contact.id)
            .eq('is_current', true),
          supabase
            .from('offers')
            .select('id, offer_number, status, created_at, valid_until')
            .eq('contact_id', contact.id)
            .order('created_at', { ascending: false })
            .limit(100),
          supabase
            .from('events')
            .select('id, name, status, event_date, created_at')
            .eq('contact_person_id', contact.id)
            .order('event_date', { ascending: false })
            .limit(100),
          supabase
            .from('event_contact_persons')
            .select('event:events(id, name, status, event_date, created_at)')
            .eq('contact_id', contact.id),
          supabase
            .from('meeting_participants')
            .select('meeting:meetings(id, title, notes, datetime_start, deleted_at)')
            .eq('contact_id', contact.id),
          supabase
            .from('tasks')
            .select('id, title, description, priority, status, inquiry_stage, inquiry_details, estimated_value, created_at, next_action_at, contact_id')
            .eq('is_inquiry', true)
            .order('created_at', { ascending: false })
            .limit(300),
          supabase
            .from('contacts')
            .select('id, full_name, email, phone, mobile')
            .neq('id', contact.id)
            .limit(1000),
          email
            ? supabase
                .from('received_emails')
                .select('id, from_address, subject, received_date, is_read')
                .ilike('from_address', `%${email}%`)
                .order('received_date', { ascending: false })
                .limit(100)
            : Promise.resolve({ data: [], error: null }),
          email
            ? supabase
                .from('sent_emails')
                .select('id, to_address, subject, sent_at')
                .ilike('to_address', `%${email}%`)
                .order('sent_at', { ascending: false })
                .limit(100)
            : Promise.resolve({ data: [], error: null }),
          supabase.from('employees').select('id, name, surname, role').eq('is_active', true).order('surname'),
        ]);

        const failed = [callsResult, organizationsResult, offersResult, directEventsResult, eventLinksResult, meetingsResult, inquiriesResult, contactsResult, receivedResult, sentResult, employeesResult]
          .find((result: any) => result?.error)?.error;
        if (failed) throw failed;

        const calls = callsResult.data || [];
        const inquiries = (inquiriesResult.data || []).filter((item: any) =>
          item.contact_id === contact.id || matchesInquiry(item.inquiry_details, email, phones),
        );
        const directEvents = directEventsResult.data || [];
        const linkedEvents = (eventLinksResult.data || []).map((item: any) => item.event).filter(Boolean);
        const eventsById = new Map<string, any>();
        [...directEvents, ...linkedEvents].forEach((event: any) => eventsById.set(event.id, event));
        const events = [...eventsById.values()];

        const timeline: TimelineItem[] = [
          ...calls.map((call: any) => ({
            id: `call-${call.id}`,
            kind: 'call' as const,
            title: call.outcome === 'connected' ? 'Rozmowa odbyta' : 'Próba kontaktu telefonicznego',
            description: call.notes,
            date: call.started_at,
            status: call.outcome || call.status,
          })),
          ...(receivedResult.data || []).map((message: any) => ({
            id: `received-${message.id}`,
            kind: 'email' as const,
            title: message.subject || 'Odebrana wiadomość',
            description: `Od: ${message.from_address}`,
            date: message.received_date,
            href: `/crm/messages/${message.id}?type=received`,
            status: message.is_read ? 'przeczytana' : 'nieprzeczytana',
          })),
          ...(sentResult.data || []).map((message: any) => ({
            id: `sent-${message.id}`,
            kind: 'email' as const,
            title: message.subject || 'Wysłana wiadomość',
            description: `Do: ${message.to_address}`,
            date: message.sent_at,
            href: `/crm/messages/${message.id}?type=sent`,
            status: 'wysłana',
          })),
          ...inquiries.map((inquiry: any) => ({
            id: `inquiry-${inquiry.id}`,
            kind: 'inquiry' as const,
            title: inquiry.title,
            description: inquiry.description || inquiry.inquiry_details?.source_message_content,
            date: inquiry.created_at,
            href: `/crm/tasks/${inquiry.id}`,
            status: inquiry.inquiry_stage || inquiry.status,
          })),
          ...(meetingsResult.data || [])
            .map((item: any) => item.meeting)
            .filter((meeting: any) => meeting && !meeting.deleted_at)
            .map((meeting: any) => ({
              id: `meeting-${meeting.id}`,
              kind: 'meeting' as const,
              title: meeting.title,
              description: meeting.notes,
              date: meeting.datetime_start,
              href: `/crm/calendar/meeting/${meeting.id}`,
            })),
          ...(offersResult.data || []).map((offer: any) => ({
            id: `offer-${offer.id}`,
            kind: 'offer' as const,
            title: `Oferta ${offer.offer_number || ''}`.trim(),
            description: offer.valid_until ? `Ważna do ${new Date(offer.valid_until).toLocaleDateString('pl-PL')}` : null,
            date: offer.created_at,
            href: `/crm/offers/${offer.id}`,
            status: offer.status,
          })),
          ...events.map((event: any) => ({
            id: `event-${event.id}`,
            kind: 'event' as const,
            title: event.name || 'Wydarzenie',
            description: `Termin: ${new Date(event.event_date).toLocaleString('pl-PL')}`,
            date: event.event_date || event.created_at,
            href: `/crm/events/${event.id}`,
            status: event.status,
          })),
        ]
          .filter((item) => item.date)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const duplicates = (contactsResult.data || []).flatMap((candidate: any) => {
          const sameEmail = email && normalizeEmail(candidate.email) === email;
          const candidatePhones = [normalizePhone(candidate.mobile), normalizePhone(candidate.phone)].filter(Boolean);
          const samePhone = phones.some((phone) => candidatePhones.includes(phone));
          if (!sameEmail && !samePhone) return [];
          return [{
            id: candidate.id,
            full_name: candidate.full_name,
            email: candidate.email,
            phone: candidate.mobile || candidate.phone,
            reason: sameEmail && samePhone ? 'ten sam e-mail i telefon' : sameEmail ? 'ten sam e-mail' : 'ten sam telefon',
          }];
        });

        const now = Date.now();
        const nextState: Customer360State = {
          timeline,
          organizations: (organizationsResult.data || []).flatMap((row: any) =>
            row.organization
              ? [{ id: row.organization.id, name: row.organization.alias || row.organization.name, position: row.position }]
              : [],
          ),
          duplicates,
          openInquiries: inquiries.filter((item: any) => !['won', 'lost'].includes(item.inquiry_stage)).length,
          pipelineValue: inquiries.reduce((sum: number, item: any) => sum + Number(item.estimated_value || 0), 0),
          upcomingEvents: events.filter((event: any) => new Date(event.event_date).getTime() >= now).length,
          dueActions:
            calls.filter((call: any) => call.next_action_at && new Date(call.next_action_at).getTime() <= now).length +
            inquiries.filter((item: any) => item.next_action_at && new Date(item.next_action_at).getTime() <= now).length,
        };

        if (active) {
          setData(nextState);
          setEmployees(employeesResult.data || []);
          setCanMerge(Boolean((employeesResult.data || []).find((employee: any) => employee.id === authData.user?.id)?.role === 'admin'));
        }
      } catch (loadError: any) {
        console.error('Error loading Customer 360:', loadError);
        if (active) setError(loadError?.message || 'Nie udało się połączyć danych klienta.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [contact]);

  const saveOwnership = async () => {
    setSavingOwnership(true);
    const { error: saveError } = await supabase
      .from('contacts')
      .update({ owner_id: ownerId || null, lifecycle_status: lifecycle })
      .eq('id', contact.id);
    setSavingOwnership(false);
    if (saveError) return showSnackbar(saveError.message || 'Nie udało się zapisać opiekuna', 'error');
    showSnackbar('Opiekun i etap relacji zostały zapisane', 'success');
  };

  const openMergePreview = async (duplicate: Customer360State['duplicates'][number]) => {
    setMergeSource(duplicate);
    setMergeLoading(true);
    setMergePreview(null);
    const { data: preview, error: previewError } = await supabase.rpc('preview_customer360_contact_merge', {
      p_target_contact_id: contact.id,
      p_source_contact_id: duplicate.id,
    });
    setMergeLoading(false);
    if (previewError) {
      setMergeSource(null);
      return showSnackbar(previewError.message || 'Nie udało się przygotować podglądu scalania', 'error');
    }
    setMergePreview(preview);
  };

  const mergeContacts = async () => {
    if (!mergeSource) return;
    setMergeLoading(true);
    const { error: mergeError } = await supabase.rpc('merge_customer360_contacts', {
      p_target_contact_id: contact.id,
      p_source_contact_id: mergeSource.id,
    });
    setMergeLoading(false);
    if (mergeError) return showSnackbar(mergeError.message || 'Nie udało się scalić kontaktów', 'error');
    setMergeSource(null);
    setMergePreview(null);
    showSnackbar('Kontakty zostały scalone, a ich relacje zachowane', 'success');
    router.refresh();
  };

  const recommendation = useMemo(() => {
    if (data.dueActions > 0) return `Wykonaj ${data.dueActions === 1 ? 'zaległy kontakt' : `${data.dueActions} zaległe kontakty`}.`;
    if (data.openInquiries > 0 && !data.timeline.some((item) => item.kind === 'call')) return 'Skontaktuj się z klientem i uzupełnij wynik rozmowy.';
    if (data.openInquiries > 0) return 'Sprawdź najbliższą akcję w otwartym zapytaniu.';
    if (data.timeline.length === 0) return 'Uzupełnij pierwszy kontakt lub utwórz zapytanie sprzedażowe.';
    return 'Brak pilnych działań. Relacja z klientem jest aktualna.';
  }, [data]);

  if (loading) {
    return <div className="flex min-h-72 items-center justify-center rounded-xl border border-gray-800 bg-[#151827]"><RefreshCw className="h-7 w-7 animate-spin text-[#d3bb73]" /></div>;
  }

  if (error) {
    return <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-red-200">{error}</div>;
  }

  const metrics = [
    { label: 'Otwarte zapytania', value: data.openInquiries, icon: Target },
    { label: 'Wartość szans', value: `${data.pipelineValue.toLocaleString('pl-PL')} zł`, icon: Briefcase },
    { label: 'Nadchodzące wydarzenia', value: data.upcomingEvents, icon: Calendar },
    { label: 'Zaległe działania', value: data.dueActions, icon: Clock3 },
  ];

  return (
    <div className="space-y-5">
      {data.duplicates.length > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-amber-100">Możliwy duplikat kontaktu</h3>
              <p className="mt-1 text-sm text-amber-100/70">Nie łączymy danych automatycznie. Administrator może najpierw porównać rekordy.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.duplicates.map((duplicate) => (
                  <button key={duplicate.id} onClick={() => canMerge ? void openMergePreview(duplicate) : router.push(`/crm/contacts/${duplicate.id}`)} className="rounded-lg border border-amber-400/25 bg-black/15 px-3 py-2 text-left text-sm text-amber-50 hover:bg-black/25">
                    <span className="font-medium">{duplicate.full_name}</span>
                    <span className="ml-2 text-amber-100/60">{duplicate.reason}</span>
                    {canMerge && <span className="ml-2 text-xs font-medium text-amber-200">Porównaj i scal</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-gray-800 bg-[#1a1d2e] p-4">
            <div className="flex items-center justify-between"><span className="text-sm text-gray-400">{label}</span><Icon className="h-4 w-4 text-[#d3bb73]" /></div>
            <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.8fr)]">
        <section className="rounded-xl border border-gray-800 bg-[#1a1d2e]">
          <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
            <div><h2 className="font-semibold text-white">Oś aktywności</h2><p className="text-sm text-gray-400">Jedna historia kontaktu we wszystkich kanałach</p></div>
            <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-gray-300">{data.timeline.length}</span>
          </div>
          {data.timeline.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-5 text-center"><MessageSquareText className="h-9 w-9 text-gray-600" /><p className="mt-3 text-gray-300">Brak powiązanych aktywności</p><p className="mt-1 text-sm text-gray-500">Połączenia, maile, zapytania, spotkania, oferty i wydarzenia pojawią się tutaj automatycznie.</p></div>
          ) : (
            <div className="divide-y divide-gray-800">
              {data.timeline.map((item) => {
                const config = KIND_CONFIG[item.kind];
                const Icon = config.icon;
                return (
                  <button key={item.id} disabled={!item.href} onClick={() => item.href && router.push(item.href)} className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors enabled:hover:bg-white/[0.03] disabled:cursor-default">
                    <div className={`mt-0.5 rounded-lg p-2 ${config.className}`}><Icon className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-medium text-gray-100">{item.title}</span><span className={`rounded-full px-2 py-0.5 text-[11px] ${config.className}`}>{config.label}</span>{item.status && <span className="text-xs text-gray-500">{item.status}</span>}</div>{item.description && <p className="mt-1 line-clamp-2 text-sm text-gray-400">{cleanText(item.description)}</p>}<p className="mt-1.5 text-xs text-gray-500">{formatDate(item.date)}</p></div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="rounded-xl border border-[#d3bb73]/25 bg-[#d3bb73]/10 p-5">
            <div className="flex items-center gap-2 text-[#e1cc8d]"><Sparkles className="h-5 w-5" /><h2 className="font-semibold">Następne najlepsze działanie</h2></div>
            <p className="mt-3 text-sm leading-6 text-gray-200">{recommendation}</p>
          </section>

          <section className="rounded-xl border border-gray-800 bg-[#1a1d2e] p-5">
            <h2 className="font-semibold text-white">Odpowiedzialność za klienta</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-xs text-gray-400">Opiekun
                <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white">
                  <option value="">Brak opiekuna</option>
                  {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} {employee.surname}</option>)}
                </select>
              </label>
              <label className="block text-xs text-gray-400">Etap relacji
                <select value={lifecycle} onChange={(event) => setLifecycle(event.target.value)} className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white">
                  {LIFECYCLE.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <button onClick={() => void saveOwnership()} disabled={savingOwnership} className="w-full rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#1c1f33] disabled:opacity-50">
                {savingOwnership ? 'Zapisywanie…' : 'Zapisz odpowiedzialność'}
              </button>
            </div>
          </section>

          <CustomerSegmentationPanel
            entityType="contact"
            entityId={contact.id}
            email={contact.email}
          />

          <section className="rounded-xl border border-gray-800 bg-[#1a1d2e] p-5">
            <div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-[#d3bb73]" /><h2 className="font-semibold text-white">Powiązane organizacje</h2></div>
            {data.organizations.length === 0 ? <p className="mt-3 text-sm text-gray-500">Brak aktywnych powiązań.</p> : <div className="mt-3 space-y-2">{data.organizations.map((organization) => <button key={organization.id} onClick={() => router.push(`/crm/contacts/${organization.id}`)} className="flex w-full items-center justify-between rounded-lg bg-[#0f1119] px-3 py-2 text-left hover:bg-[#121625]"><span className="text-sm text-gray-200">{organization.name}</span><span className="text-xs text-gray-500">{organization.position || 'kontakt'}</span></button>)}</div>}
          </section>

          <section className="rounded-xl border border-gray-800 bg-[#1a1d2e] p-5">
            <div className="flex items-center gap-2"><UserRoundSearch className="h-5 w-5 text-[#d3bb73]" /><h2 className="font-semibold text-white">Jakość danych</h2></div>
            <div className="mt-3 space-y-2 text-sm">
              {[['E-mail', Boolean(contact.email)], ['Telefon', Boolean(contact.mobile || contact.phone)], ['Organizacja', data.organizations.length > 0]].map(([label, complete]) => <div key={String(label)} className="flex items-center justify-between"><span className="text-gray-400">{String(label)}</span>{complete ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <span className="text-xs text-amber-300">uzupełnij</span>}</div>)}
            </div>
          </section>
        </aside>
      </div>

      {mergeSource && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onMouseDown={(event) => event.target === event.currentTarget && !mergeLoading && setMergeSource(null)}>
          <div className="w-full max-w-xl rounded-2xl border border-gray-700 bg-[#1a1d2e] p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-white">Scal duplikat kontaktu</h2>
            <p className="mt-2 text-sm text-gray-400">Dane i relacje z rekordu <strong className="text-white">{mergeSource.full_name}</strong> zostaną przeniesione do <strong className="text-white">{contact.full_name}</strong>. Rekord źródłowy zostanie usunięty.</p>
            {mergeLoading && !mergePreview ? <div className="flex h-28 items-center justify-center"><RefreshCw className="h-6 w-6 animate-spin text-[#d3bb73]" /></div> : mergePreview && (
              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(mergePreview.relations || {}).map(([label, value]) => <div key={label} className="rounded-lg bg-[#0f1119] p-3 text-center"><div className="text-xl text-white">{String(value)}</div><div className="mt-1 text-[11px] text-gray-500">{label}</div></div>)}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setMergeSource(null)} disabled={mergeLoading} className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300">Anuluj</button>
              <button onClick={() => void mergeContacts()} disabled={mergeLoading || !mergePreview} className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{mergeLoading ? 'Scalanie…' : 'Scal kontakty'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
