import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NativeContext } from './auth';
import { collectionItems, collectionState, invalidateNativeSync } from './sync';
import { buildCompanySignatureHtml } from '@/lib/buildCompanySignature';
import { formatSystemSubject } from '@/lib/ui/systemLabels';
import { inboxMailboxIds, mailboxFilter } from '@/lib/CRM/messages/mailboxPreferences';
import { readMessageSalesContext } from '@/lib/CRM/messages/salesContext';
import { emailPreviewDocument, escapeHtml, isPlainEmailHtml } from './messages';

/*
 * Kopia Wiadomości na Macu: aplikacja trzyma na dysku wszystkie widoczne dla pracownika wiadomości (metadane) i ich treść,
 * a serwer wysyła tylko zmiany. Metadane — te same reguły widoczności co lista `/crm/messages` (`listMessages`): własne
 * i przypisane skrzynki bez ukrytych, formularz kontaktowy dla uprawnionych, własne wersje robocze; RLS jak w przeglądarce.
 * Zmiany wykrywa skrót treści koszyków (`sync.ts`) — także odczytanie, gwiazdki, przypisania, kosz i usunięcia.
 */

export const MAIL_SET = 'mail';
const PAGE = 1000;

type Row = Record<string, any>;
type Item = { id: string; item: Record<string, unknown> };

/** PostgREST zwraca najwyżej 1000 wierszy — pobieramy stronami w stałej kolejności. */
async function allRows(build: () => any): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order('id').range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

const preview = (text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 100 ? `${clean.substring(0, 100)}...` : clean;
};
const stripHtml = (html: string) =>
  html
    .replace(/<(head|style|script|title)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'");
const person = (value: any) => (value && typeof value === 'object' && !Array.isArray(value) ? { name: value.name ?? null, surname: value.surname ?? null } : null);

async function loadMail(ctx: NativeContext): Promise<Item[]> {
  const supabase = ctx.supabase;
  const { data: employee } = await supabase.from('employees')
    .select('permissions, can_receive_contact_forms').eq('id', ctx.employee.id).maybeSingle();
  const permissions: string[] = Array.isArray(employee?.permissions) ? employee.permissions : [];
  const canViewContactForm = permissions.includes('admin') || permissions.includes('messages_manage') || employee?.can_receive_contact_forms === true;
  const accounts = mailboxFilter(await inboxMailboxIds(supabase, ctx.employee.id));

  const [received, sent, contact, drafts] = await Promise.all([
    allRows(() => supabase.from('received_emails')
      .select('id, from_address, to_address, subject, received_date, is_read, is_starred, assigned_to, email_account_id, deleted_at, assigned_employee:employees!assigned_to(name, surname)')
      .in('email_account_id', accounts)),
    allRows(() => supabase.from('sent_emails')
      .select('id, to_address, subject, sent_at, email_account_id, deleted_at, employees!employee_id(name, surname)')
      .in('email_account_id', accounts)),
    canViewContactForm
      ? allRows(() => supabase.from('contact_messages')
        .select('id, name, email, subject, message, created_at, status, assigned_to, deleted_at, assigned_employee:employees!assigned_to(name, surname)'))
      : Promise.resolve([] as Row[]),
    allRows(() => supabase.from('email_drafts')
      .select('id, to_address, subject, body, email_account_id, created_at, updated_at')
      .eq('employee_id', ctx.employee.id).is('deleted_at', null)),
  ]);

  const items: Item[] = [];
  const add = (type: string, item: Record<string, unknown>) => items.push({ id: `${type}:${item.id}`, item: { ...item, type } });
  for (const m of received) {
    add('received', {
      id: m.id, from: m.from_address, to: m.to_address, subject: m.subject, subjectLabel: formatSystemSubject(m.subject),
      preview: '', date: m.received_date, isRead: Boolean(m.is_read), isStarred: Boolean(m.is_starred),
      assigned_to: m.assigned_to ?? null, assigned_employee: person(m.assigned_employee), email_account_id: m.email_account_id, isDeleted: Boolean(m.deleted_at),
    });
  }
  for (const m of sent) {
    const author = person(m.employees);
    add('sent', {
      id: m.id, from: author ? `${author.name ?? ''} ${author.surname ?? ''}`.trim() : 'System', to: m.to_address, subject: m.subject,
      subjectLabel: formatSystemSubject(m.subject), preview: '', date: m.sent_at, isRead: true, isStarred: false,
      email_account_id: m.email_account_id, isDeleted: Boolean(m.deleted_at),
    });
  }
  for (const m of contact) {
    const subject = m.subject || 'Wiadomość z formularza';
    add('contact_form', {
      id: m.id, from: `${m.name} <${m.email}>`, to: 'Formularz kontaktowy', subject, subjectLabel: formatSystemSubject(subject),
      preview: preview(m.message || ''), date: m.created_at, isRead: m.status !== 'new', isStarred: false, status: m.status,
      assigned_to: m.assigned_to ?? null, assigned_employee: person(m.assigned_employee), isDeleted: Boolean(m.deleted_at),
    });
  }
  for (const m of drafts) {
    const subject = m.subject || '(Brak tematu)';
    add('draft', {
      id: m.id, from: 'Wersja robocza', to: m.to_address || '', subject, subjectLabel: formatSystemSubject(subject),
      preview: preview(stripHtml(m.body || '')), date: m.updated_at || m.created_at, isRead: true, isStarred: false,
      email_account_id: m.email_account_id, isDeleted: false,
    });
  }
  return items;
}

export const mailState = (ctx: NativeContext, hash?: string) => collectionState(ctx, MAIL_SET, loadMail, hash);
export const mailItems = (ctx: NativeContext, buckets: unknown[]) => collectionItems(ctx, MAIL_SET, loadMail, buckets);
/** Po zmianie wiadomości (z aplikacji, przeglądarki lub synchronizacji poczty) kolejna synchronizacja ma ją od razu widzieć. */
export const invalidateMail = () => invalidateNativeSync([MAIL_SET]);

export type MailRef = { id: string; type: 'received' | 'sent' | 'contact_form' };
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
export const mailRefs = (value: unknown, limit: number): MailRef[] =>
  (Array.isArray(value) ? value : [])
    .filter((ref: any) => ref && uuid.test(String(ref.id)) && ['received', 'sent', 'contact_form'].includes(ref.type))
    .slice(0, limit)
    .map((ref: any) => ({ id: String(ref.id), type: ref.type }));

const BODY_BUDGET = 8 * 1024 * 1024;

/**
 * Treść wielu wiadomości naraz (pobieranie w tle na dysk Maca): podgląd HTML jak w CRM, tekst, załączniki, DW, adres odpowiedzi.
 * Odpowiedź ma ok. 8 MB najwyżej — pozostałe wiadomości wracają w `more` do kolejnego żądania.
 */
export async function mailBodies(ctx: NativeContext, refs: MailRef[]) {
  const supabase = ctx.supabase;
  const ids = (type: MailRef['type']) => refs.filter((r) => r.type === type).map((r) => r.id);
  const [received, sent, contact, attachments] = await Promise.all([
    ids('received').length
      ? supabase.from('received_emails').select('id, from_address, to_address, subject, received_date, body_html, body_text, message_id, email_account_id, raw_headers').in('id', ids('received'))
      : Promise.resolve({ data: [], error: null }),
    ids('sent').length
      ? supabase.from('sent_emails').select('id, to_address, subject, sent_at, body, email_account_id, employee_id, delivery_archive').in('id', ids('sent'))
      : Promise.resolve({ data: [], error: null }),
    ids('contact_form').length
      ? supabase.from('contact_messages').select('id, name, email, phone, subject, message, created_at').in('id', ids('contact_form'))
      : Promise.resolve({ data: [], error: null }),
    ids('received').length + ids('sent').length
      ? supabase.from('email_attachments').select('id, email_id, email_type, filename, content_type, size_bytes, storage_path').in('email_id', [...ids('received'), ...ids('sent')])
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [received, sent, contact]) if (result.error) throw result.error;
  const files = new Map<string, Row[]>();
  for (const file of (attachments.data || []) as Row[]) {
    const key = `${file.email_type}:${file.email_id}`;
    files.set(key, [...(files.get(key) || []), { id: file.id, filename: file.filename, content_type: file.content_type, size_bytes: file.size_bytes, storage_path: file.storage_path }]);
  }
  const signatures = new Map<string, Promise<string[]>>();
  const signatureImages = (employeeId: string | null, emailAccountId: string | null) => {
    const key = `${employeeId}|${emailAccountId}`;
    if (!signatures.has(key)) {
      signatures.set(key, buildCompanySignatureHtml({ client: supabase as SupabaseClient, employeeId, emailAccountId })
        .then((signature) => Array.from(signature.html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/gi)).map((m) => m[2]))
        .catch(() => []));
    }
    return signatures.get(key)!;
  };
  const document = async (html: string, employeeId: string | null, emailAccountId: string | null) => {
    if (!html?.trim()) return null;
    let images: string[] = [];
    if (/\bsrc\s*=\s*(["'])cid:/i.test(html) && (employeeId || emailAccountId)) images = await signatureImages(employeeId, emailAccountId);
    let index = 0;
    const resolved = html.replace(/<img\b[^>]*\bsrc\s*=\s*(["'])cid:[^"']+\1[^>]*>/gi, (tag) => {
      const source = images[index++];
      return source ? tag.replace(/(\bsrc\s*=\s*)(["'])cid:[^"']+\2/i, (_s, prefix: string, quote: string) => `${prefix}${quote}${source}${quote}`) : '';
    });
    return emailPreviewDocument(resolved);
  };

  const out: Record<string, unknown>[] = [];
  const more: MailRef[] = [];
  let size = 0;
  const order = new Map(refs.map((r, i) => [`${r.type}:${r.id}`, i]));
  const rows = [
    ...((received.data || []) as Row[]).map((row) => ({ type: 'received' as const, row })),
    ...((sent.data || []) as Row[]).map((row) => ({ type: 'sent' as const, row })),
    ...((contact.data || []) as Row[]).map((row) => ({ type: 'contact_form' as const, row })),
  ].sort((a, b) => (order.get(`${a.type}:${a.row.id}`) ?? 0) - (order.get(`${b.type}:${b.row.id}`) ?? 0));
  for (const { type, row } of rows) {
    if (size > BODY_BUDGET) { more.push({ id: row.id, type }); continue; }
    let entry: Record<string, unknown>;
    if (type === 'received') {
      const html = row.body_html || '';
      const text = row.body_text || '';
      const reply = String(row.from_address || '');
      entry = {
        id: row.id, type, from: row.from_address, to: row.to_address, subject: row.subject, subjectLabel: formatSystemSubject(row.subject),
        date: row.received_date, email_account_id: row.email_account_id, body: text, preview: preview(text || stripHtml(html)),
        html: await document(html, null, row.email_account_id), plain: isPlainEmailHtml(html),
        replyAddress: (reply.match(/<([^>]+)>/)?.[1] || reply).trim(), cc: row.raw_headers?.cc || null, messageId: row.message_id || null,
        attachments: files.get(`received:${row.id}`) || [],
      };
    } else if (type === 'sent') {
      const html = row.body || '';
      const text = html.replace(/<[^>]*>/g, '');
      entry = {
        id: row.id, type, to: row.to_address, subject: row.subject, subjectLabel: formatSystemSubject(row.subject), date: row.sent_at,
        email_account_id: row.email_account_id, body: text, preview: preview(stripHtml(html)),
        html: await document(html, row.employee_id ?? null, row.email_account_id), plain: isPlainEmailHtml(html),
        employeeId: row.employee_id ?? null, deliveryArchive: row.delivery_archive ?? null, replyAddress: '',
        attachments: files.get(`sent:${row.id}`) || [],
      };
    } else {
      const html = `<p><strong>Od:</strong> ${escapeHtml(String(row.name || ''))} (${escapeHtml(String(row.email || ''))})</p>
                   ${row.phone ? `<p><strong>Telefon:</strong> ${escapeHtml(String(row.phone))}</p>` : ''}
                   <p>${escapeHtml(String(row.message || '')).replace(/\n/g, '<br>')}</p>`;
      const subject = row.subject || 'Wiadomość z formularza';
      entry = {
        id: row.id, type, from: `${row.name} <${row.email}>`, to: 'Formularz kontaktowy', subject, subjectLabel: formatSystemSubject(subject),
        date: row.created_at, body: row.message || '', preview: preview(row.message || ''), html: emailPreviewDocument(html), plain: true,
        replyAddress: String(row.email || '').trim(), phone: row.phone ?? null, attachments: [],
      };
    }
    size += String(entry.html || '').length + String(entry.body || '').length;
    out.push(entry);
  }
  const found = new Set(rows.map(({ type, row }) => `${type}:${row.id}`));
  return { messages: out, more, missing: refs.filter((r) => !found.has(`${r.type}:${r.id}`)).map((r) => `${r.type}:${r.id}`) };
}

/** Lejek sprzedaży i analiza AI dla wskazanych wiadomości (najwyżej 100 naraz, jak w CRM). */
export async function mailSales(ctx: NativeContext, refs: MailRef[]) {
  return readMessageSalesContext(ctx.supabase, refs.slice(0, 100));
}
