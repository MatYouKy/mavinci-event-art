import 'server-only';
import type { NativeContext } from './auth';
import { registerEventActions, registerEventQueries, registerEventTab } from './eventTabs';
import { parseEventAccess } from '@/lib/events/access/eventAccess';

/*
 * Zakładka „Agenda” karty wydarzenia dla Maca — te same zapytania i zapisy co `EventAgendaTab` (harmonogram, uwagi
 * w drzewie, PDF w Dokumenty → Agenda przez `/bridge/events/agenda-pdf`), tokenem pracownika (RLS).
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
function fail(message: string): never {
  throw new Error(message);
}

// Te same konwersje co w zakładce: czas bez strefy, z tekstu zapisanego w bazie.
const isoToDateInput = (value?: string | null): string => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value.includes('T')) return value.split('T')[0];
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const isoToTimeInput = (value?: string | null): string => {
  if (!value) return '';
  if (/^\d{2}:\d{2}$/.test(value)) return value;
  if (value.includes('T')) {
    const part = value.split('T')[1];
    if (part) return part.slice(0, 5);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const buildIsoDateTime = (dateOnly: string, time: string): string | null => {
  if (!dateOnly || !time || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly) || !/^\d{2}:\d{2}$/.test(time)) return null;
  return `${dateOnly}T${time}:00`;
};
const minutes = (time: string) => {
  const [h, m] = isoToTimeInput(time).split(':').map(Number);
  return h * 60 + m + (h < 6 ? 24 * 60 : 0);
};
/** `getSortedAgendaItems`: po godzinie, godziny przed 6:00 jako noc po wydarzeniu. */
const sortItems = <T extends { time: string }>(items: T[]) =>
  [...items].sort((a, b) => (!a.time && !b.time ? 0 : !a.time ? 1 : !b.time ? -1 : minutes(a.time) - minutes(b.time)));

type Note = { id: string; content: string; order_index: number; level: number; parent_id: string | null; children: Note[] };

function noteTree(flat: any[]): Note[] {
  const map = new Map<string, Note>();
  const roots: Note[] = [];
  for (const note of flat) map.set(note.id, { ...note, children: [] });
  for (const note of flat) {
    const node = map.get(note.id)!;
    if (note.parent_id) map.get(note.parent_id)?.children.push(node);
    else roots.push(node);
  }
  return roots;
}

async function canManageEvent(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.rpc('current_employee_can_manage_event', { p_event_id: eventId });
  if (!error && typeof data === 'boolean') return data;
  return ctx.employee.permissions.includes('events_manage') || ctx.employee.permissions.includes('admin');
}

/** Agenda z bazy; zapisany PDF sprawdzany jak `checkGeneratedPdfExists` (brak pliku → agenda oznaczona do ponownego wygenerowania). */
async function loadAgenda(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const { data: agenda, error } = await s.from('event_agendas').select('*').eq('event_id', eventId).maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  if (!agenda) return { agenda: null, items: [] as any[], notes: [] as Note[] };
  let pdfExists = false;
  let path = (agenda as any).generated_pdf_path || null;
  let modified = (agenda as any).modified_after_generation === true;
  if (path && !modified) {
    const signed = await s.storage.from('event-files').createSignedUrl(path, 60);
    const ok = !signed.error && signed.data?.signedUrl
      ? await fetch(signed.data.signedUrl, { method: 'HEAD' }).then((r) => r.ok).catch(() => false)
      : false;
    if (ok) pdfExists = true;
    else {
      await s.from('event_agendas').update({ generated_pdf_path: null, generated_pdf_at: null, modified_after_generation: true }).eq('id', (agenda as any).id);
      path = null;
      modified = true;
    }
  }
  const [items, notes] = await Promise.all([
    s.from('event_agenda_items').select('*').eq('agenda_id', (agenda as any).id).order('order_index'),
    s.from('event_agenda_notes').select('*').eq('agenda_id', (agenda as any).id).order('order_index'),
  ]);
  if (items.error) throw items.error;
  if (notes.error) throw notes.error;
  return {
    agenda: {
      id: (agenda as any).id, start: isoToTimeInput((agenda as any).start_time), end: isoToTimeInput((agenda as any).end_time),
      generatedPdfPath: path, modified, pdfExists,
    },
    items: (items.data || []).map((item: any) => ({ id: item.id, time: isoToTimeInput(item.time) || '', title: item.title || '', description: item.description || '' })),
    notes: noteTree(notes.data || []),
  };
}

async function agendaTab(ctx: NativeContext, eventId: string) {
  const { data: event, error } = await ctx.supabase.from('events').select('name, event_date, event_end_date').eq('id', eventId).single();
  if (error) throw error;
  const [canManage, agenda] = await Promise.all([canManageEvent(ctx, eventId), loadAgenda(ctx, eventId)]);
  const e = event as any;
  return {
    canManage,
    event: { name: e.name || '', date: isoToDateInput(e.event_date), start: isoToTimeInput(e.event_date), end: isoToTimeInput(e.event_end_date) },
    ...agenda,
    items: sortItems(agenda.items),
  };
}

registerEventTab('agenda', agendaTab);

/** Kontakt i organizacja klienta — tylko gdy pracownik widzi dane klienta (jak strona wydarzenia). */
async function clientInfo(ctx: NativeContext, eventId: string, event: any) {
  const access = await ctx.supabase.rpc('get_event_access', { p_event_id: eventId });
  const canViewClient = !access.error && parseEventAccess(access.data)?.areas?.client === true;
  if (!canViewClient) return { contact: null as any, organization: null as any };
  const [contact, organization] = await Promise.all([
    event.contact_person_id ? ctx.supabase.from('contacts').select('*').eq('id', event.contact_person_id).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    event.organization_id ? ctx.supabase.from('organizations').select('id, name, alias').eq('id', event.organization_id).maybeSingle().then((r) => r.data) : Promise.resolve(null),
  ]);
  return { contact: contact as any, organization: organization as any };
}

/** `handleSave`: agenda, etapy (z poprawną godziną i tytułem) i uwagi w drzewie — zastępowane w całości. */
async function saveAgenda(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const s = ctx.supabase;
  if (!(await canManageEvent(ctx, eventId))) fail('Nie masz uprawnień do zapisywania agendy');
  const { data: event, error: eventError } = await s.from('events').select('name, event_date, contact_person_id, organization_id').eq('id', eventId).single();
  if (eventError) throw eventError;
  const e = event as any;
  const date = isoToDateInput(e.event_date);
  if (!e.name || !date) fail('Nazwa wydarzenia i data są wymagane');
  const items = sortItems((Array.isArray(body.items) ? body.items : []).map((item: any) => ({
    time: String(item?.time || ''), title: String(item?.title || ''), description: String(item?.description || ''),
  })));
  const valid = items.filter((item) => buildIsoDateTime(date, isoToTimeInput(item.time)) && item.title.trim());
  if (!valid.length && items.length) fail('Każdy etap harmonogramu musi mieć poprawną godzinę i tytuł.');
  const { contact } = await clientInfo(ctx, eventId, e);
  const start = buildIsoDateTime(date, String(body.start || ''));
  const end = buildIsoDateTime(date, String(body.end || ''));
  const { data: existing } = await s.from('event_agendas').select('id, generated_pdf_path').eq('event_id', eventId).maybeSingle();
  let agendaId = (existing as any)?.id as string | undefined;
  if (!agendaId) {
    const { data: created, error } = await s.from('event_agendas').insert([{
      event_id: eventId, event_name: e.name, event_date: date, start_time: start, end_time: end, client_contact: contact?.full_name || null, created_by: ctx.employee.id,
    }]).select().single();
    if (error) throw error;
    agendaId = (created as any).id;
  } else {
    const { error } = await s.from('event_agendas').update({
      event_name: e.name, event_date: date, start_time: start, end_time: end, client_contact: contact?.full_name || null,
      modified_after_generation: Boolean((existing as any).generated_pdf_path),
    }).eq('id', agendaId);
    if (error) throw error;
  }
  const { error: deleteItems } = await s.from('event_agenda_items').delete().eq('agenda_id', agendaId);
  if (deleteItems) throw deleteItems;
  if (valid.length) {
    const { error } = await s.from('event_agenda_items').insert(valid.map((item, index) => ({
      agenda_id: agendaId, time: buildIsoDateTime(date, isoToTimeInput(item.time)), title: item.title.trim(), description: item.description.trim() || '', order_index: index,
    })));
    if (error) throw error;
  }
  const { error: deleteNotes } = await s.from('event_agenda_notes').delete().eq('agenda_id', agendaId);
  if (deleteNotes) throw deleteNotes;
  // `flattenNotes`: rodzic przed dziećmi, kolejność w obrębie poziomu.
  const flat: { key: string; parent: string | null; content: string; order: number; level: number }[] = [];
  const walk = (notes: any[], parent: string | null, level: number) => {
    (Array.isArray(notes) ? notes : []).forEach((note, index) => {
      const key = String(note?.id || `${parent || 'root'}-${index}`);
      flat.push({ key, parent, content: String(note?.content || ''), order: index, level: Math.min(2, Math.max(0, Number(note?.level ?? level) || level)) });
      walk(note?.children, key, level + 1);
    });
  };
  walk(body.notes, null, 0);
  const ids = new Map<string, string>();
  for (const note of flat.filter((n) => n.content.trim())) {
    const { data: inserted, error } = await s.from('event_agenda_notes').insert([{
      agenda_id: agendaId, parent_id: note.parent && ids.has(note.parent) ? ids.get(note.parent) : null, content: note.content.trim(), order_index: note.order, level: note.level,
    }]).select().single();
    if (error) throw error;
    ids.set(note.key, (inserted as any).id);
  }
  return { ok: true, agendaId };
}

registerEventActions('agenda', { save: saveAgenda });

/** Dane do PDF jak `handleGeneratePDF` (kontakt klienta, logo firmy wydarzenia, opiekun, etapy i uwagi) — Mac przekazuje je do `/bridge/events/agenda-pdf`. */
async function pdfPayload(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const { data: event, error } = await s.from('events').select('name, event_date, created_by, my_company_id, contact_person_id, organization_id').eq('id', eventId).single();
  if (error) throw error;
  const e = event as any;
  const loaded = await loadAgenda(ctx, eventId);
  if (!loaded.agenda) fail('Najpierw zapisz agendę');
  const { contact, organization } = await clientInfo(ctx, eventId, e);
  const personName = contact ? (contact.full_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim()) : '';
  const number = contact?.business_phone || '';
  const clientContact = organization && contact ? organization.alias || organization.name || '' : personName;
  let companyQuery = s.from('my_companies').select('id, logo_url').eq('is_active', true);
  companyQuery = e.my_company_id ? companyQuery.eq('id', e.my_company_id) : companyQuery.eq('is_default', true);
  const { data: company } = await companyQuery.maybeSingle();
  let companyLogoUrl: string | null = null;
  const raw = (company as any)?.logo_url as string | undefined;
  if (raw) {
    companyLogoUrl = /^https?:\/\//i.test(raw) || raw.startsWith('data:') ? raw : s.storage.from('company-logos').getPublicUrl(raw).data.publicUrl;
  }
  const { data: author } = e.created_by ? await s.from('employees').select('name, surname, phone_number').eq('id', e.created_by).maybeSingle() : { data: null };
  const items = sortItems(loaded.items);
  const date = isoToDateInput(e.event_date);
  return {
    eventId,
    agendaId: loaded.agenda.id,
    eventName: e.name || '',
    htmlPayload: {
      eventName: e.name || '',
      eventDate: date,
      startTime: items[0]?.time || loaded.agenda.start || isoToTimeInput(e.event_date),
      endTime: items[items.length - 1]?.time || loaded.agenda.end,
      clientContact,
      contactName: personName,
      contactNumber: number,
      agendaItems: items.map((item, index) => ({ ...item, order_index: index })),
      agendaNotes: loaded.notes,
      lastUpdated: new Date().toISOString(),
      authorName: author ? `${(author as any).name} ${(author as any).surname}` : '',
      authorNumber: (author as any)?.phone_number || '',
      companyLogoUrl,
    },
  };
}

/** Zapisany PDF agendy do podglądu i pobrania. */
async function pdfFile(ctx: NativeContext, eventId: string) {
  const loaded = await loadAgenda(ctx, eventId);
  const path = loaded.agenda?.generatedPdfPath;
  if (!path || !loaded.agenda?.pdfExists) fail('Plik PDF nie istnieje już w folderze. Wygeneruj agendę ponownie.');
  const signed = await ctx.supabase.storage.from('event-files').createSignedUrl(path, 3600);
  if (signed.error || !signed.data?.signedUrl) fail('Błąd podczas otwierania PDF');
  return { url: signed.data.signedUrl, name: path.split('/').pop() || 'agenda.pdf' };
}

registerEventQueries('agenda', { pdfPayload: (ctx, eventId) => pdfPayload(ctx, eventId), pdf: (ctx, eventId) => pdfFile(ctx, eventId) });
