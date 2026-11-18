import 'server-only';
import { can, type NativeContext } from './auth';
import { CardFailure } from './contactCard';
import { formatSystemSubject, inquiryTitleLabel, systemLabel, systemTone } from '@/lib/ui/systemLabels';
import { STAGES } from '@/lib/CRM/inquiries/pipeline';

/*
 * Zakładki karty kontaktu dla Maca, dotąd tylko w CRM (`/crm/contacts/[id]`):
 * - „Klient 360°” osoby (`Customer360Panel`: oś aktywności — połączenia, e-maile, zapytania, spotkania, oferty, wydarzenia;
 *   wskaźniki, następne działanie, powiązane organizacje, jakość danych) i organizacji (`Organization360Panel`: historia —
 *   połączenia, zapytania, oferty, wydarzenia, faktury, korespondencja z dociąganiem starszej; wskaźniki, kontakty,
 *   sprzedawcy organizacji — `OrganizationSellersPanel`);
 * - „Zapytania” (`CustomerInquiryHistory`) i „Oferty” (`CustomerOffersPanel`) — po 25, z dociąganiem starszych;
 * - dane klienta do „Dodaj zapytanie” (`ContactQuickActions`).
 * Te same zapytania co w przeglądarce, tokenem pracownika (RLS decyduje, co widać).
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 25;

const fail = (message: string, status = 400): never => {
  throw new CardFailure(message, status);
};
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Row[] : []);
const one = (value: unknown): Row | null => (Array.isArray(value) ? (value[0] ?? null) : value && typeof value === 'object' ? value as Row : null);
const idOf = (value: unknown) => {
  const id = str(value);
  if (!UUID.test(id)) fail('Nieprawidłowy kontakt.');
  return id;
};
const offsetOf = (value: unknown) => {
  const offset = Number(value || 0);
  return Number.isInteger(offset) && offset >= 0 && offset <= 100_000 ? offset : 0;
};
const time = (value: unknown) => {
  const parsed = new Date(str(value)).getTime();
  return Number.isFinite(parsed) ? parsed : NaN;
};
const normalizeEmail = (value?: string | null) => value?.trim().toLocaleLowerCase('pl-PL') || '';
const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '').replace(/^48(?=\d{9}$)/, '');
const cleanText = (value?: string | null) => (value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
/** Plakietka statusu jak `SystemBadge` (etykieta i ton). */
const badge = (value: unknown, label?: string) => {
  const code = str(value);
  if (!code) return null;
  return { label: label || systemLabel(code), tone: systemTone(code, 'status') };
};
const check = (results: { error?: { message?: string } | null }[], fallback: string) => {
  const failed = results.find((result) => result?.error)?.error;
  if (failed) fail(failed.message || fallback, 500);
};

type Activity = {
  id: string; kind: string; title: string; description: string; date: string; target: { type: string; id: string } | null;
  status: { label: string; tone: string } | null;
  /** Oferta — „Ważna do …”, wydarzenie — „Termin: …” (daty formatuje Mac jak przeglądarka). */
  validUntil?: string; eventDate?: string;
};
const byDate = (a: Activity, b: Activity) => time(b.date) - time(a.date);

/** Korespondencja organizacji (`organization360_correspondence`, po 100) jako aktywności e-mail. */
function mailActivities(list: Row[]): Activity[] {
  return list.map((item) => {
    const status = item.direction === 'sent' ? 'wysłana' : item.is_read ? 'przeczytana' : 'nieprzeczytana';
    return {
      id: `${str(item.direction)}-${str(item.id)}`, kind: 'email', title: str(item.subject) || 'Wiadomość bez tematu', description: '',
      date: str(item.occurred_at), target: { type: item.direction === 'sent' ? 'sentEmail' : 'receivedEmail', id: str(item.id) },
      status: badge(status),
    };
  });
}

/** Sprzedawcy organizacji (`OrganizationSellersPanel`): obecnie zatrudnione osoby z profilem sprzedawcy i pozostałe osoby. */
async function organizationSellers(ctx: NativeContext, organizationId: string) {
  const links = await ctx.supabase.from('contact_organizations').select('contact_id,position').eq('organization_id', organizationId).eq('is_current', true);
  if (links.error) return { error: links.error.message || 'Nie udało się wczytać sprzedawców organizacji.', sellers: [], others: [] };
  const positions = new Map(rows(links.data).filter((link) => link.contact_id).map((link) => [str(link.contact_id), str(link.position)]));
  const ids = [...positions.keys()];
  if (!ids.length) return { error: null, sellers: [], others: [] };
  const [profiles, people] = await Promise.all([
    ctx.supabase.from('sales_partner_profiles').select('id,contact_id,status,portal_enabled').in('contact_id', ids),
    ctx.supabase.from('contacts').select('id,full_name,first_name,last_name,email,position').in('id', ids),
  ]);
  if (profiles.error || people.error) {
    return { error: (profiles.error || people.error)?.message || 'Nie udało się wczytać sprzedawców organizacji.', sellers: [], others: [] };
  }
  const byContact = new Map(rows(profiles.data).filter((profile) => profile.contact_id).map((profile) => [str(profile.contact_id), profile]));
  const nameOf = (person: Row) => str(person.full_name) || `${str(person.first_name)} ${str(person.last_name)}`.trim() || 'Bez nazwy';
  const sellers: Row[] = [];
  const others: Row[] = [];
  for (const person of rows(people.data)) {
    const profile = byContact.get(str(person.id));
    const position = positions.get(str(person.id)) || str(person.position);
    if (profile) {
      sellers.push({ profileId: str(profile.id), contactId: str(person.id), name: nameOf(person), email: str(person.email), status: str(profile.status) || 'active',
        portalEnabled: profile.portal_enabled === true, position });
    } else {
      others.push({ contactId: str(person.id), name: nameOf(person), email: str(person.email), position });
    }
  }
  const order: Record<string, number> = { active: 0, onboarding: 1, inactive: 2 };
  sellers.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.name.localeCompare(b.name, 'pl'));
  others.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  return { error: null, sellers, others };
}

/** „Klient 360°” osoby kontaktowej — jak `Customer360Panel` (bez duplikatów: te liczy karta na Macu z listy kontaktów). */
async function contact360(ctx: NativeContext, id: string) {
  const s = ctx.supabase;
  const { data: contact, error } = await s.from('contacts').select('id,full_name,email,phone,mobile').eq('id', id).maybeSingle();
  if (error) fail(error.message || 'Nie udało się połączyć danych klienta.', 500);
  if (!contact) fail('Nie znaleziono kontaktu lub nie masz do niego dostępu.', 404);
  const email = normalizeEmail((contact as Row).email);
  const phones = [normalizePhone((contact as Row).mobile), normalizePhone((contact as Row).phone)].filter(Boolean);
  const [calls, organizations, offers, directEvents, eventLinks, meetings, inquiriesAll, received, sent, seller] = await Promise.all([
    s.from('crm_call_activities').select('id, outcome, status, started_at, notes, next_action_at').eq('contact_id', id).order('started_at', { ascending: false }).limit(100),
    s.from('contact_organizations').select('position, organization:organizations(id, name, alias)').eq('contact_id', id).eq('is_current', true),
    s.from('offers').select('id, offer_number, status, created_at, valid_until').eq('contact_id', id).order('created_at', { ascending: false }).limit(100),
    s.from('events').select('id, name, status, event_date, created_at').eq('contact_person_id', id).order('event_date', { ascending: false }).limit(100),
    s.from('event_contact_persons').select('event:events(id, name, status, event_date, created_at)').eq('contact_id', id),
    s.from('meeting_participants').select('meeting:meetings(id, title, notes, datetime_start, deleted_at)').eq('contact_id', id),
    s.from('tasks').select('id, title, description, priority, status, inquiry_stage, inquiry_details, estimated_value, created_at, next_action_at, contact_id')
      .eq('is_inquiry', true).order('created_at', { ascending: false }).limit(300),
    email ? s.from('received_emails').select('id, from_address, subject, received_date, is_read').ilike('from_address', `%${email}%`)
      .order('received_date', { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
    email ? s.from('sent_emails').select('id, to_address, subject, sent_at').ilike('to_address', `%${email}%`)
      .order('sent_at', { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
    s.from('sales_partner_profiles').select('id,status').eq('contact_id', id).maybeSingle(),
  ]);
  check([calls, organizations, offers, directEvents, eventLinks, meetings, inquiriesAll, received, sent], 'Nie udało się połączyć danych klienta.');
  const matches = (details: Row | null) => {
    const inquiryEmail = normalizeEmail(details?.client_email || details?.email);
    const inquiryPhone = normalizePhone(details?.client_phone || details?.phone);
    return Boolean((email && inquiryEmail === email) || (inquiryPhone && phones.includes(inquiryPhone)));
  };
  const inquiries = rows(inquiriesAll.data).filter((item) => str(item.contact_id) === id || matches(one(item.inquiry_details)));
  const eventsById = new Map<string, Row>();
  [...rows(directEvents.data), ...rows(eventLinks.data).map((item) => one(item.event)).filter((event): event is Row => Boolean(event))]
    .forEach((event) => eventsById.set(str(event.id), event));
  const events = [...eventsById.values()];
  const callRows = rows(calls.data);
  const timeline: Activity[] = [
    ...callRows.map((call) => ({
      id: `call-${str(call.id)}`, kind: 'call', title: call.outcome === 'connected' ? 'Rozmowa odbyta' : 'Próba kontaktu telefonicznego',
      description: cleanText(call.notes), date: str(call.started_at), target: null, status: badge(call.outcome || call.status),
    })),
    ...rows(received.data).map((message) => ({
      id: `received-${str(message.id)}`, kind: 'email', title: str(message.subject) || 'Odebrana wiadomość',
      description: `Od: ${str(message.from_address)}`, date: str(message.received_date), target: { type: 'receivedEmail', id: str(message.id) },
      status: badge(message.is_read ? 'przeczytana' : 'nieprzeczytana'),
    })),
    ...rows(sent.data).map((message) => ({
      id: `sent-${str(message.id)}`, kind: 'email', title: str(message.subject) || 'Wysłana wiadomość',
      description: `Do: ${str(message.to_address)}`, date: str(message.sent_at), target: { type: 'sentEmail', id: str(message.id) }, status: badge('wysłana'),
    })),
    ...inquiries.map((inquiry) => ({
      id: `inquiry-${str(inquiry.id)}`, kind: 'inquiry', title: formatSystemSubject(inquiry.title),
      description: cleanText(inquiry.description || one(inquiry.inquiry_details)?.source_message_content), date: str(inquiry.created_at),
      target: { type: 'inquiry', id: str(inquiry.id) }, status: badge(inquiry.inquiry_stage || inquiry.status),
    })),
    ...rows(meetings.data).map((item) => one(item.meeting)).filter((meeting): meeting is Row => Boolean(meeting) && !meeting!.deleted_at)
      .map((meeting) => ({
        id: `meeting-${str(meeting.id)}`, kind: 'meeting', title: str(meeting.title), description: cleanText(meeting.notes),
        date: str(meeting.datetime_start), target: { type: 'meeting', id: str(meeting.id) }, status: null,
      })),
    ...rows(offers.data).map((offer) => ({
      id: `offer-${str(offer.id)}`, kind: 'offer', title: `Oferta ${str(offer.offer_number)}`.trim(),
      description: '', validUntil: str(offer.valid_until),
      date: str(offer.created_at), target: { type: 'offer', id: str(offer.id) }, status: badge(offer.status),
    })),
    ...events.map((event) => ({
      id: `event-${str(event.id)}`, kind: 'event', title: str(event.name) || 'Wydarzenie', description: '', eventDate: str(event.event_date),
      date: str(event.event_date) || str(event.created_at), target: { type: 'event', id: str(event.id) }, status: badge(event.status),
    })),
  ].filter((item) => item.date).sort(byDate);
  const now = Date.now();
  const sellerRow = seller.error ? null : one(seller.data);
  return {
    kind: 'contact',
    timeline,
    organizations: rows(organizations.data).flatMap((row) => {
      const organization = one(row.organization);
      return organization ? [{ id: str(organization.id), name: str(organization.alias) || str(organization.name), position: str(row.position) }] : [];
    }),
    metrics: {
      openInquiries: inquiries.filter((item) => !['won', 'lost'].includes(str(item.inquiry_stage))).length,
      pipelineValue: inquiries.reduce((sum, item) => sum + Number(item.estimated_value || 0), 0),
      upcomingEvents: events.filter((event) => time(event.event_date) >= now).length,
      dueActions: callRows.filter((call) => call.next_action_at && time(call.next_action_at) <= now).length
        + inquiries.filter((item) => item.next_action_at && time(item.next_action_at) <= now).length,
    },
    quality: {
      email: Boolean(str((contact as Row).email)),
      phone: Boolean(str((contact as Row).mobile) || str((contact as Row).phone)),
      organization: rows(organizations.data).some((row) => one(row.organization)),
    },
    sellerProfile: sellerRow ? { id: str(sellerRow.id), status: str(sellerRow.status) || 'active' } : null,
    hasMoreMail: false,
    mailOffset: 0,
  };
}

/** „Klient 360°” organizacji — jak `Organization360Panel` (domeny, opiekun i segmentacja są na karcie w „Relacji”). */
async function organization360(ctx: NativeContext, id: string) {
  const s = ctx.supabase;
  const [calls, inquiries, offers, events, invoices, relations, correspondence] = await Promise.all([
    s.from('crm_call_activities').select('id, outcome, status, started_at, next_action_at').eq('organization_id', id).order('started_at', { ascending: false }).limit(100),
    s.from('tasks').select('id, title, inquiry_stage, status, estimated_value, next_action_at, created_at').eq('is_inquiry', true).eq('organization_id', id)
      .order('created_at', { ascending: false }).limit(100),
    s.from('offers').select('id, offer_number, status, created_at').eq('organization_id', id).order('created_at', { ascending: false }).limit(100),
    s.from('events').select('id, name, status, event_date').eq('organization_id', id).order('event_date', { ascending: false }).limit(100),
    s.from('invoices').select('id, invoice_number, status, issue_date, total_gross, organization_id, service_recipient_organization_id, billing_arrangement')
      .or(`organization_id.eq.${id},service_recipient_organization_id.eq.${id}`).order('issue_date', { ascending: false }).limit(100),
    s.from('contact_organizations').select('position, is_primary, contact:contacts(id, full_name, email, phone, mobile)').eq('organization_id', id).eq('is_current', true),
    s.rpc('organization360_correspondence', { p_organization_id: id, p_offset: 0 }),
  ]);
  check([calls, inquiries, offers, events, invoices, relations, correspondence], 'Nie udało się pobrać danych organizacji');
  const inquiryRows = rows(inquiries.data);
  const eventRows = rows(events.data);
  const mail = rows(correspondence.data);
  const activities: Activity[] = [
    ...rows(calls.data).map((item) => ({
      id: `call-${str(item.id)}`, kind: 'call', title: item.outcome === 'connected' ? 'Rozmowa odbyta' : 'Próba kontaktu', description: '',
      date: str(item.started_at), target: null, status: badge(item.outcome || item.status),
    })),
    ...inquiryRows.map((item) => ({
      id: `inquiry-${str(item.id)}`, kind: 'inquiry', title: formatSystemSubject(item.title), description: '', date: str(item.created_at),
      target: { type: 'inquiry', id: str(item.id) }, status: badge(item.inquiry_stage || item.status),
    })),
    ...rows(offers.data).map((item) => ({
      id: `offer-${str(item.id)}`, kind: 'offer', title: `Oferta ${str(item.offer_number)}`.trim(), description: '', date: str(item.created_at),
      target: { type: 'offer', id: str(item.id) }, status: badge(item.status),
    })),
    ...eventRows.map((item) => ({
      id: `event-${str(item.id)}`, kind: 'event', title: str(item.name) || 'Wydarzenie', description: '', date: str(item.event_date),
      target: { type: 'event', id: str(item.id) }, status: badge(item.status),
    })),
    ...rows(invoices.data).map((item) => {
      const label = str(item.organization_id) === id
        ? item.billing_arrangement === 'hotel' ? `${systemLabel(item.status)} · płatnik: hotel` : systemLabel(item.status)
        : item.billing_arrangement === 'hotel' ? `${systemLabel(item.status)} · opłacana przez hotel` : `${systemLabel(item.status)} · inny płatnik`;
      return {
        id: `invoice-${str(item.id)}`, kind: 'invoice', title: `Faktura ${str(item.invoice_number)}`, description: '', date: str(item.issue_date),
        target: { type: 'invoice', id: str(item.id) }, status: badge(item.status, label),
      };
    }),
    ...mailActivities(mail),
  ].filter((item) => item.date).sort(byDate);
  const now = Date.now();
  const open = inquiryRows.filter((item) => !['won', 'lost'].includes(str(item.inquiry_stage)));
  const sellers = await organizationSellers(ctx, id);
  return {
    kind: 'organization',
    timeline: activities,
    contacts: rows(relations.data).map((row): Row => ({ ...(one(row.contact) || {}), position: str(row.position), isPrimary: row.is_primary === true }))
      .filter((person) => person.id).map((person) => ({ id: str(person.id), name: str(person.full_name), position: str(person.position), isPrimary: person.isPrimary })),
    metrics: {
      openInquiries: open.length,
      pipelineValue: open.reduce((sum, item) => sum + Number(item.estimated_value || 0), 0),
      upcomingEvents: eventRows.filter((item) => time(item.event_date) >= now).length,
      dueActions: open.filter((item) => item.next_action_at && time(item.next_action_at) < now).length,
    },
    sellers: sellers.sellers,
    otherPeople: sellers.others,
    sellersError: sellers.error,
    // Jak `canManageSalespeople` na karcie CRM.
    canManageSellers: can(ctx.employee, 'contacts_manage') || can(ctx.employee, 'finances_manage'),
    hasMoreMail: mail.length === 100,
    mailOffset: mail.length,
  };
}

export async function customer360(ctx: NativeContext, kind: string, idParam: unknown) {
  const id = idOf(idParam);
  return kind === 'organization' ? organization360(ctx, id) : contact360(ctx, id);
}

/** „Pokaż starszą korespondencję” (organizacja). */
export async function customer360Mail(ctx: NativeContext, idParam: unknown, offsetParam: unknown) {
  const id = idOf(idParam);
  const offset = offsetOf(offsetParam);
  const { data, error } = await ctx.supabase.rpc('organization360_correspondence', { p_organization_id: id, p_offset: offset });
  if (error) fail('Nie udało się pobrać kolejnych wiadomości', 500);
  const list = rows(data);
  return { items: mailActivities(list), hasMore: list.length === 100, mailOffset: offset + list.length };
}

/** „Oferty” klienta (`CustomerOffersPanel`): najnowsze po 25. */
export async function customerOffers(ctx: NativeContext, kind: string, idParam: unknown, offsetParam: unknown) {
  const id = idOf(idParam);
  const offset = offsetOf(offsetParam);
  const { data, error } = await ctx.supabase.from('offers').select('id,offer_number,status,created_at,valid_until')
    .eq(kind === 'organization' ? 'organization_id' : 'contact_id', id)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + PAGE - 1);
  if (error) fail('Nie udało się pobrać ofert.', 500);
  const list = rows(data);
  return {
    items: list.map((item) => ({
      id: str(item.id), number: str(item.offer_number), status: badge(item.status), createdAt: str(item.created_at), validUntil: str(item.valid_until),
    })),
    hasMore: list.length === PAGE,
  };
}

/** „Zapytania i notatki klienta” (`CustomerInquiryHistory`): osoba — jej zapytania; organizacja — jej i osób w niej zatrudnionych. */
export async function customerInquiries(ctx: NativeContext, kind: string, idParam: unknown, offsetParam: unknown) {
  const id = idOf(idParam);
  const offset = offsetOf(offsetParam);
  let query = ctx.supabase.from('tasks').select('id,title,inquiry_stage,created_at,archived_at').eq('is_inquiry', true);
  if (kind === 'organization') {
    const relations = await ctx.supabase.from('contact_organizations').select('contact_id').eq('organization_id', id).eq('is_current', true);
    if (relations.error) fail('Nie udało się pobrać historii.', 500);
    const contactIds = [...new Set(rows(relations.data).map((row) => str(row.contact_id)))].filter((value) => UUID.test(value));
    // Organizacja wskazana wprost ma pierwszeństwo przed zatrudnieniem osoby kontaktowej.
    query = contactIds.length
      ? query.or(`organization_id.eq.${id},and(organization_id.is.null,contact_id.in.(${contactIds.join(',')}))`)
      : query.eq('organization_id', id);
  } else {
    query = query.eq('contact_id', id);
  }
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + PAGE - 1);
  if (error) fail('Nie udało się pobrać historii.', 500);
  const list = rows(data);
  return {
    items: list.map((item) => ({
      id: str(item.id), title: inquiryTitleLabel(item.title), stage: str(item.inquiry_stage),
      stageLabel: STAGES.find((stage) => stage.id === item.inquiry_stage)?.label || 'Zapytanie',
      createdAt: str(item.created_at), archived: Boolean(item.archived_at),
    })),
    hasMore: list.length === PAGE,
  };
}

/** Klient do „Dodaj zapytanie” (`ContactQuickActions.createInquiry`): organizacja — jej dane; osoba — jej dane i jedyna organizacja. */
export async function inquiryClient(ctx: NativeContext, kind: string, idParam: unknown) {
  const id = idOf(idParam);
  if (kind === 'organization') {
    const { data, error } = await ctx.supabase.from('organizations').select('name,alias,email,phone').eq('id', id).single();
    if (error || !data) fail('Nie udało się pobrać danych klienta do zapytania. Spróbuj ponownie.', error ? 500 : 404);
    const row = data as Row;
    return { organizationId: id, contactId: null, name: str(row.alias) || str(row.name), email: str(row.email), phone: str(row.phone) };
  }
  const [contact, links] = await Promise.all([
    ctx.supabase.from('contacts').select('full_name,email,phone').eq('id', id).single(),
    ctx.supabase.from('contact_organizations').select('organization_id').eq('contact_id', id).eq('is_current', true),
  ]);
  if (contact.error || links.error || !contact.data) fail('Nie udało się pobrać danych klienta do zapytania. Spróbuj ponownie.', 500);
  const ids = [...new Set(rows(links.data).map((link) => str(link.organization_id)).filter(Boolean))];
  const row = contact.data as Row;
  return { contactId: id, organizationId: ids.length === 1 ? ids[0] : null, name: str(row.full_name), email: str(row.email), phone: str(row.phone) };
}
