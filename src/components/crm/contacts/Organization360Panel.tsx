'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Calendar, CircleDollarSign, Clock3, FileText, Mail, Phone, RefreshCw, Target, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import CustomerSegmentationPanel from '@/components/crm/contacts/CustomerSegmentationPanel';

type Organization360 = {
  id: string;
  name: string;
  alias: string | null;
  email: string | null;
  phone: string | null;
  nip: string | null;
  owner_id?: string | null;
  lifecycle_status?: string | null;
};

type Activity = {
  id: string;
  kind: 'call' | 'email' | 'inquiry' | 'offer' | 'event' | 'invoice';
  title: string;
  date: string;
  status?: string | null;
  href?: string;
};

const KIND = {
  call: { label: 'Połączenie', icon: Phone, color: 'text-emerald-300 bg-emerald-500/15' },
  email: { label: 'E-mail', icon: Mail, color: 'text-sky-300 bg-sky-500/15' },
  inquiry: { label: 'Zapytanie', icon: Target, color: 'text-amber-300 bg-amber-500/15' },
  offer: { label: 'Oferta', icon: FileText, color: 'text-[#d3bb73] bg-[#d3bb73]/15' },
  event: { label: 'Wydarzenie', icon: Calendar, color: 'text-violet-300 bg-violet-500/15' },
  invoice: { label: 'Faktura', icon: CircleDollarSign, color: 'text-fuchsia-300 bg-fuchsia-500/15' },
};

const LIFECYCLE = [
  ['lead', 'Nowy lead'],
  ['prospect', 'Potencjalny klient'],
  ['customer', 'Klient'],
  ['inactive', 'Nieaktywny'],
  ['lost', 'Utracony'],
] as const;

export default function Organization360Panel({ organization }: { organization: Organization360 }) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [ownerId, setOwnerId] = useState(organization.owner_id || '');
  const [lifecycle, setLifecycle] = useState(organization.lifecycle_status || 'lead');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({ openInquiries: 0, pipelineValue: 0, upcomingEvents: 0, overdueActions: 0 });

  const load = async () => {
    setLoading(true);
    const email = organization.email?.trim().toLowerCase() || '';
    const now = Date.now();
    const [calls, inquiries, offers, events, invoices, relations, employeeRows, received, sent] = await Promise.all([
      supabase.from('crm_call_activities').select('id, outcome, status, started_at, next_action_at').eq('organization_id', organization.id).order('started_at', { ascending: false }).limit(100),
      supabase.from('tasks').select('id, title, inquiry_stage, status, estimated_value, next_action_at, created_at').eq('is_inquiry', true).eq('organization_id', organization.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('offers').select('id, offer_number, status, created_at').eq('organization_id', organization.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('events').select('id, name, status, event_date').eq('organization_id', organization.id).order('event_date', { ascending: false }).limit(100),
      supabase.from('invoices').select('id, invoice_number, status, issue_date, total_gross, organization_id, service_recipient_organization_id, billing_arrangement').or(`organization_id.eq.${organization.id},service_recipient_organization_id.eq.${organization.id}`).order('issue_date', { ascending: false }).limit(100),
      supabase.from('contact_organizations').select('position, is_primary, contact:contacts(id, full_name, email, phone, mobile)').eq('organization_id', organization.id).eq('is_current', true),
      supabase.from('employees').select('id, name, surname').eq('is_active', true).order('surname'),
      email ? supabase.from('received_emails').select('id, subject, received_date, from_address, is_read').ilike('from_address', `%${email}%`).order('received_date', { ascending: false }).limit(50) : Promise.resolve({ data: [], error: null }),
      email ? supabase.from('sent_emails').select('id, subject, sent_at, to_address').ilike('to_address', `%${email}%`).order('sent_at', { ascending: false }).limit(50) : Promise.resolve({ data: [], error: null }),
    ]);

    const error = [calls, inquiries, offers, events, invoices, relations, employeeRows, received, sent].find((result: any) => result.error)?.error;
    if (error) {
      console.error('Error loading organization 360:', error);
      showSnackbar(error.message || 'Nie udało się pobrać danych organizacji', 'error');
      setLoading(false);
      return;
    }

    const inquiryRows = inquiries.data || [];
    const eventRows = events.data || [];
    const activityRows: Activity[] = [
      ...(calls.data || []).map((item: any) => ({ id: `call-${item.id}`, kind: 'call' as const, title: item.outcome === 'connected' ? 'Rozmowa odbyta' : 'Próba kontaktu', date: item.started_at, status: item.outcome || item.status })),
      ...inquiryRows.map((item: any) => ({ id: `inquiry-${item.id}`, kind: 'inquiry' as const, title: item.title, date: item.created_at, status: item.inquiry_stage || item.status, href: `/crm/tasks/${item.id}` })),
      ...(offers.data || []).map((item: any) => ({ id: `offer-${item.id}`, kind: 'offer' as const, title: `Oferta ${item.offer_number || ''}`.trim(), date: item.created_at, status: item.status, href: `/crm/offers/${item.id}` })),
      ...eventRows.map((item: any) => ({ id: `event-${item.id}`, kind: 'event' as const, title: item.name || 'Wydarzenie', date: item.event_date, status: item.status, href: `/crm/events/${item.id}` })),
      ...(invoices.data || []).map((item: any) => ({
        id: `invoice-${item.id}`,
        kind: 'invoice' as const,
        title: `Faktura ${item.invoice_number}`,
        date: item.issue_date,
        status:
          item.organization_id === organization.id
            ? item.billing_arrangement === 'hotel'
              ? `${item.status} · płatnik: hotel`
              : item.status
            : item.billing_arrangement === 'hotel'
              ? `${item.status} · opłacana przez hotel`
              : `${item.status} · inny płatnik`,
        href: `/crm/invoices/${item.id}`,
      })),
      ...(received.data || []).map((item: any) => ({ id: `received-${item.id}`, kind: 'email' as const, title: item.subject || 'Odebrana wiadomość', date: item.received_date, status: item.is_read ? 'przeczytana' : 'nieprzeczytana', href: `/crm/messages/${item.id}?type=received` })),
      ...(sent.data || []).map((item: any) => ({ id: `sent-${item.id}`, kind: 'email' as const, title: item.subject || 'Wysłana wiadomość', date: item.sent_at, status: 'wysłana', href: `/crm/messages/${item.id}?type=sent` })),
    ].filter((item) => item.date).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    setActivities(activityRows);
    setContacts((relations.data || []).map((row: any) => ({ ...row.contact, position: row.position, is_primary: row.is_primary })).filter(Boolean));
    setEmployees(employeeRows.data || []);
    setStats({
      openInquiries: inquiryRows.filter((item: any) => !['won', 'lost'].includes(item.inquiry_stage)).length,
      pipelineValue: inquiryRows.filter((item: any) => !['won', 'lost'].includes(item.inquiry_stage)).reduce((sum: number, item: any) => sum + Number(item.estimated_value || 0), 0),
      upcomingEvents: eventRows.filter((item: any) => new Date(item.event_date).getTime() >= now).length,
      overdueActions: inquiryRows.filter((item: any) => item.next_action_at && new Date(item.next_action_at).getTime() < now && !['won', 'lost'].includes(item.inquiry_stage)).length,
    });
    setLoading(false);
  };

  useEffect(() => { void load(); }, [organization.id]);

  const recommendation = useMemo(() => {
    if (stats.overdueActions) return `Wymagane działanie: ${stats.overdueActions} zaległe kontakty sprzedażowe.`;
    if (stats.openInquiries) return 'Sprawdź najbliższy krok w otwartym zapytaniu.';
    return 'Brak pilnych działań dla tej organizacji.';
  }, [stats]);

  const saveOwnership = async () => {
    setSaving(true);
    const { error } = await supabase.from('organizations').update({ owner_id: ownerId || null, lifecycle_status: lifecycle }).eq('id', organization.id);
    setSaving(false);
    if (error) return showSnackbar(error.message || 'Nie udało się zapisać opiekuna', 'error');
    showSnackbar('Opiekun i etap relacji zostały zapisane', 'success');
  };

  if (loading) return <div className="flex min-h-72 items-center justify-center rounded-xl border border-gray-800 bg-[#151827]"><RefreshCw className="h-7 w-7 animate-spin text-[#d3bb73]" /></div>;

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      ['Otwarte zapytania', stats.openInquiries, Target],
      ['Wartość szans', `${stats.pipelineValue.toLocaleString('pl-PL')} zł`, CircleDollarSign],
      ['Nadchodzące eventy', stats.upcomingEvents, Calendar],
      ['Zaległe działania', stats.overdueActions, Clock3],
    ].map(([label, value, Icon]: any) => <div key={label} className="rounded-xl border border-gray-800 bg-[#1a1d2e] p-4"><div className="flex items-center justify-between text-sm text-gray-400"><span>{label}</span><Icon className="h-4 w-4 text-[#d3bb73]" /></div><div className="mt-2 text-2xl font-semibold text-white">{value}</div></div>)}</div>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
      <section className="rounded-xl border border-gray-800 bg-[#1a1d2e]"><div className="border-b border-gray-800 px-5 py-4"><h2 className="font-semibold text-white">Historia organizacji</h2><p className="text-sm text-gray-400">Sprzedaż, realizacje, finanse i korespondencja</p></div>{activities.length === 0 ? <div className="flex min-h-60 items-center justify-center text-sm text-gray-500">Brak powiązanych aktywności</div> : <div className="divide-y divide-gray-800">{activities.map((activity) => { const config = KIND[activity.kind]; const Icon = config.icon; return <button key={activity.id} disabled={!activity.href} onClick={() => activity.href && router.push(activity.href)} className="flex w-full items-start gap-3 px-5 py-4 text-left enabled:hover:bg-white/[0.03]"><span className={`rounded-lg p-2 ${config.color}`}><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-medium text-gray-100">{activity.title}</span><span className={`rounded-full px-2 py-0.5 text-[11px] ${config.color}`}>{config.label}</span>{activity.status && <span className="text-xs text-gray-500">{activity.status}</span>}</span><span className="mt-1 block text-xs text-gray-500">{new Date(activity.date).toLocaleString('pl-PL')}</span></span></button>; })}</div>}</section>

      <aside className="space-y-5">
        <section className="rounded-xl border border-[#d3bb73]/25 bg-[#d3bb73]/10 p-5"><h3 className="font-semibold text-[#e1cc8d]">Następne działanie</h3><p className="mt-2 text-sm leading-6 text-gray-200">{recommendation}</p></section>
        <section className="rounded-xl border border-gray-800 bg-[#1a1d2e] p-5"><div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-[#d3bb73]" /><h3 className="font-semibold text-white">Odpowiedzialność</h3></div><div className="mt-4 space-y-3"><label className="block text-xs text-gray-400">Opiekun<select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white"><option value="">Brak opiekuna</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} {employee.surname}</option>)}</select></label><label className="block text-xs text-gray-400">Etap relacji<select value={lifecycle} onChange={(event) => setLifecycle(event.target.value)} className="mt-1.5 w-full rounded-lg border border-gray-700 bg-[#0f1119] px-3 py-2.5 text-sm text-white">{LIFECYCLE.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button onClick={() => void saveOwnership()} disabled={saving} className="w-full rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#1c1f33] disabled:opacity-50">{saving ? 'Zapisywanie…' : 'Zapisz odpowiedzialność'}</button></div></section>
        <CustomerSegmentationPanel entityType="organization" entityId={organization.id} email={organization.email} />
        <section className="rounded-xl border border-gray-800 bg-[#1a1d2e] p-5"><div className="flex items-center gap-2"><Users className="h-5 w-5 text-[#d3bb73]" /><h3 className="font-semibold text-white">Kontakty ({contacts.length})</h3></div><div className="mt-3 space-y-2">{contacts.map((contact) => <button key={contact.id} onClick={() => router.push(`/crm/contacts/${contact.id}`)} className="flex w-full items-center justify-between rounded-lg bg-[#0f1119] px-3 py-2 text-left"><span className="text-sm text-gray-200">{contact.full_name}</span><span className="text-xs text-gray-500">{contact.position || (contact.is_primary ? 'główny' : 'kontakt')}</span></button>)}</div></section>
      </aside>
    </div>
  </div>;
}
