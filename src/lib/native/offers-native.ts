import 'server-only';
import type { NativeContext } from './auth';
import { can } from './auth';
import { allRows } from './page';
import {
  day, dateTime, eventLink, fitSpans, grosz, revisionOf, rows, searchText, str, zl,
  type DocAction, type DocRecord, type DocSection, type DocSectionMeta, type DocTone,
} from './protocol';

/*
 * Oferty — karty natywne (lista, szczegóły, pozycje, powiązane wydarzenie). Dane czytane tokenem pracownika (RLS jak w CRM).
 * Edytor oferty, generowanie i wysyłka PDF zostają na razie w CRM (przycisk „Otwórz w CRM”); kolejne czynności dochodzą w `actions.ts`.
 */

const statusLabels: Record<string, string> = {
  draft: 'Szkic', sent: 'Wysłana', viewed: 'Otwarta przez klienta', accepted: 'Zaakceptowana', rejected: 'Odrzucona',
  expired: 'Wygasła', cancelled: 'Anulowana', archived: 'Archiwalna',
};
const tones: Record<string, DocTone> = {
  draft: 'new', sent: 'wait', viewed: 'progress', accepted: 'done', rejected: 'closed', expired: 'closed', cancelled: 'closed', archived: 'closed',
};
const closedStatuses = ['accepted', 'rejected', 'expired', 'cancelled', 'archived'];
const crmUrl = () => (process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://mavinci.pl').replace(/\/+$/, '');

export const offersMeta = (ctx: NativeContext): DocSectionMeta => ({
  id: 'offers',
  title: 'Oferty',
  href: '/crm/offers',
  param: 'id',
  headers: ['Numer', 'Oferta', 'Klient', 'Wydarzenie', 'Status', 'Wartość'],
  openLabel: 'Otwarte (szkice i wysłane)',
  hint: can(ctx.employee, 'offers_manage')
    ? 'Oferty z CRM. Edytor, generowanie i wysyłka PDF są na razie w CRM — „Otwórz w CRM” na karcie.'
    : 'Oferty z CRM w zakresie Twoich uprawnień.',
  icon: 'doc.text',
  create: [],
  group: 'sales',
});

const select = [
  'id,offer_number,title,description,status,total_amount,subtotal,discount_amount,tax_amount,valid_until,created_at,updated_at',
  'sent_at,viewed_at,accepted_at,event_id,inquiry_id,approval_status,modified_after_generation,generated_pdf_url,event_date,event_location,notes',
  'organization:organizations!offers_organization_id_fkey(id,name)',
  'contact:contacts!offers_contact_id_fkey(id,first_name,last_name,full_name,email,phone,mobile)',
  'event:events!offers_event_id_fkey(id,name,event_date,event_end_date,status,location)',
  'creator:employees!offers_created_by_fkey(name,surname)',
  'items:offer_items(id,name,quantity,unit,unit_price,discount_percent,total,display_order)',
].join(',');

type Obj = Record<string, any>;
const person = (c: Obj | null | undefined) =>
  c ? str(c.full_name) || [str(c.first_name), str(c.last_name)].filter(Boolean).join(' ') : '';
const number = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('pl-PL', { maximumFractionDigits: 2 }) : '';
};

function card(ctx: NativeContext, o: Obj): DocRecord {
  const status = str(o.status) || 'draft';
  const organization = o.organization as Obj | null;
  const contact = o.contact as Obj | null;
  const event = o.event as Obj | null;
  const client = str(organization?.name) || person(contact);
  const total = grosz(o.total_amount);
  const items = ((o.items as Obj[] | null) || []).slice().sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
  const eventDate = str(event?.event_date) || str(o.event_date);
  const sections: DocSection[] = [
    {
      id: 'offer',
      title: 'Oferta',
      rows: rows([
        ['Numer', o.offer_number],
        ['Tytuł', o.title],
        ['Status', statusLabels[status] || status],
        ['Ważna do', day(o.valid_until)],
        ['Utworzona', dateTime(o.created_at)],
        ['Wysłana', dateTime(o.sent_at)],
        ['Otwarta przez klienta', dateTime(o.viewed_at)],
        ['Zaakceptowana', dateTime(o.accepted_at)],
        ['Autor', [str(o.creator?.name), str(o.creator?.surname)].filter(Boolean).join(' ')],
        ['PDF', o.generated_pdf_url ? (o.modified_after_generation ? 'Nieaktualny — oferta zmieniona po wygenerowaniu' : 'Wygenerowany') : 'Brak'],
      ]),
    },
    {
      id: 'client',
      title: 'Klient',
      rows: rows([
        ['Organizacja', organization?.name],
        ['Osoba kontaktowa', person(contact)],
        ['Telefon', str(contact?.mobile) || str(contact?.phone), str(contact?.mobile) || str(contact?.phone) ? { type: 'tel', href: `tel:${str(contact?.mobile) || str(contact?.phone)}` } : undefined],
        ['E-mail', contact?.email, contact?.email ? { type: 'mail', href: `mailto:${contact.email}` } : undefined],
      ]),
    },
  ];
  if (event) {
    sections.push({
      id: 'event',
      title: 'Wydarzenie',
      rows: rows([
        ['Nazwa', event.name, eventLink(String(event.id), 'offer')],
        ['Termin', [day(event.event_date), day(event.event_end_date)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' – ')],
        ['Miejsce', event.location || o.event_location],
      ]),
    });
  } else if (o.event_location || o.event_date) {
    sections.push({ id: 'event', title: 'Wydarzenie', rows: rows([['Termin', day(o.event_date)], ['Miejsce', o.event_location]]) });
  }
  if (items.length) {
    sections.push({
      id: 'items',
      title: `Pozycje (${items.length})`,
      table: {
        columns: ['Lp.', 'Nazwa', 'Ilość', 'Cena jedn.', 'Rabat', 'Wartość'],
        rows: items.map((i, index) => [
          String(index + 1), str(i.name), [number(i.quantity), str(i.unit)].filter(Boolean).join(' '),
          zl(grosz(i.unit_price)), Number(i.discount_percent) ? `${number(i.discount_percent)}%` : '—', zl(grosz(i.total)),
        ]),
      },
    });
  }
  if (total !== null) {
    sections.push({
      id: 'totals',
      title: 'Podsumowanie',
      rows: rows([
        ['Suma pozycji', zl(grosz(o.subtotal))],
        ['Rabat', Number(o.discount_amount) ? zl(grosz(o.discount_amount)) : ''],
        ['VAT', Number(o.tax_amount) ? zl(grosz(o.tax_amount)) : ''],
        ['Razem', zl(total)],
      ]),
    });
  }
  if (str(o.description) || str(o.notes)) {
    sections.push({ id: 'notes', title: 'Opis i notatki', text: [str(o.description), str(o.notes)].filter(Boolean).join('\n\n') });
  }
  const actions: DocAction[] = [
    { id: 'panel', label: 'Otwórz w CRM', icon: 'open', url: `${crmUrl()}/crm/offers/${o.id}`, role: 'primary' },
  ];
  if (event) actions.push({ id: 'panel', label: 'Otwórz wydarzenie', icon: 'open', open: `mavinci://event/${event.id}` });
  return {
    id: String(o.id),
    kind: 'offer',
    number: str(o.offer_number),
    title: str(o.title) || str(o.offer_number) || 'Oferta',
    subtitle: [client, str(event?.name)].filter(Boolean).join(' · '),
    counterpartyId: str(organization?.id),
    locationId: '',
    status,
    statusLabel: statusLabels[status] || status,
    tone: tones[status] || 'new',
    open: !closedStatuses.includes(status),
    shop: false,
    date: eventDate,
    dateText: day(eventDate),
    createdAt: str(o.created_at),
    amountGrosz: total,
    amountText: zl(total),
    channelLabel: str(event?.name),
    search: searchText([o.offer_number, o.title, client, person(contact), contact?.email, event?.name, o.event_location]),
    revision: revisionOf(o.updated_at),
    updatedAt: str(o.updated_at),
    panelHref: `/crm/offers/${o.id}`,
    sections: fitSpans(sections),
    actions,
    filters: o.approval_status === 'pending' ? [{ id: 'approval', label: 'Czeka na akceptację', tone: 'warn' }] : undefined,
  };
}

export async function offerRecords(ctx: NativeContext): Promise<DocRecord[]> {
  const data = await allRows<Obj>((c) => c.from('offers').select(select).order('created_at', { ascending: false }).order('id'), ctx.supabase);
  return data.map((o) => card(ctx, o));
}
