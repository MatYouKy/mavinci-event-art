import { nativeContext, nativeJson, nativeUnauthorized, readJson, type NativeContext } from '@/lib/native/auth';
import { canCreate } from '@/lib/permissions';
import { formatSystemSubject } from '@/lib/ui/systemLabels';
import { messageMatchesFolder } from '@/lib/CRM/messages/messageFolder';
import { readMailboxViewPreferences } from '@/lib/CRM/messages/mailboxPreferences';
import { messageInquirySaveFeedback } from '@/lib/CRM/messages/salesContext';
import { dispatchCrmEmail } from '@/lib/emailScheduling';
import {
  emailAccounts,
  listMessages,
  mailboxTrashPermissions,
  markMessageRead,
  messageDetails,
  searchMessages,
  toggleMessageStar,
  unreadCountsByAccount,
  type MessageDetails,
  type MessageFolder,
  type MessageListItem,
} from '@/lib/CRM/messages/messagesQueries';
import { invalidateMail, mailBodies, mailItems, mailRefs, mailSales, mailState } from '@/lib/native/mail';
import { composeEmailHtml, emailPreviewDocument, isPlainEmailHtml, messagePreviewHtml, replyAddress, replyQuoteHtml, replyThreadHeaders } from '@/lib/native/messages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Wiadomości CRM dla aplikacji na Maca — te same zapytania co strona `/crm/messages` (`messagesQueries.ts`), wykonywane
 * tokenem pracownika (RLS). Kosz poczty IMAP, „oznacz wszystkie jako przeczytane” i załączniki aplikacja wywołuje
 * bezpośrednio w istniejących trasach `/bridge/messages/*` (przyjmują Bearer), żeby logika była w jednym miejscu.
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const folders: MessageFolder[] = ['all', 'contact_form', 'sent', 'received', 'drafts', 'trash'];
const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);

function access(ctx: NativeContext) {
  const e = ctx.employee;
  const canManage = e.isAdmin || e.permissions.includes('messages_manage');
  const canView = canManage || e.permissions.includes('messages_view');
  const canCreateTasks = canCreate({ permissions: e.permissions, role: e.role, access_level: e.accessLevel } as never, 'tasks');
  return { canManage, canView, canCreateTasks };
}

const listItem = (message: MessageListItem) => ({ ...message, subjectLabel: formatSystemSubject(message.subject) });
const bearer = (request: Request) => (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

async function details(ctx: NativeContext, id: string, type: 'contact_form' | 'sent' | 'received') {
  const message = await messageDetails(ctx.supabase, { id, type });
  if (!message) return null;
  const original = message.originalData || {};
  const { originalData: _original, bodyHtml: _html, ...rest } = message;
  return {
    message: {
      ...rest,
      subjectLabel: formatSystemSubject(message.subject),
      html: await messagePreviewHtml(ctx.supabase, message),
      plain: isPlainEmailHtml(message.bodyHtml || ''),
      replyAddress: replyAddress(message),
      cc: original.raw_headers?.cc || original.cc || null,
      employeeId: original.employee_id ?? null,
      deliveryArchive: type === 'sent' ? original.delivery_archive ?? null : null,
      phone: type === 'contact_form' ? original.phone ?? null : null,
    },
  };
}

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const rights = access(ctx);
  if (!rights.canView) return failure('Nie masz dostępu do wiadomości.', 403);
  const url = new URL(request.url);
  const q = (key: string) => url.searchParams.get(key) || '';
  const user = { id: ctx.employee.id };
  try {
    switch (q('op')) {
      case 'accounts': {
        const [accounts, unread, trash, profile] = await Promise.all([
          emailAccounts(ctx.supabase, user),
          unreadCountsByAccount(ctx.supabase, user),
          mailboxTrashPermissions(ctx.supabase).catch(() => [] as string[]),
          ctx.supabase.from('employees').select('preferences').eq('id', ctx.employee.id).maybeSingle(),
        ]);
        const preferences = (profile.data?.preferences || {}) as { messages?: { mailboxOrder?: string[] } };
        const muted = Array.from(readMailboxViewPreferences(profile.data?.preferences).muted);
        return nativeJson({
          ...accounts,
          ...rights,
          employeeId: ctx.employee.id,
          unread,
          trashMailboxIds: trash,
          mailboxOrder: preferences.messages?.mailboxOrder || [],
          mutedMailboxIds: muted,
        });
      }
      case 'unread':
        return nativeJson({ unread: await unreadCountsByAccount(ctx.supabase, user) });
      case 'mirror':
        // Kopia na Macu: skrót wszystkich widocznych wiadomości; przy różnicy — skróty koszyków (`sync.ts`).
        return nativeJson(await mailState(ctx, q('hash') || undefined));
      case 'list': {
        const folder = folders.includes(q('folder') as MessageFolder) ? (q('folder') as MessageFolder) : 'all';
        const account = q('account');
        if (!account) return failure('Wybierz skrzynkę.');
        const offset = Math.max(0, Number(q('offset')) || 0);
        const result = await listMessages(ctx.supabase, user, { emailAccountId: account, offset, limit: 50, filterType: folder });
        return nativeJson({ messages: result.messages.map(listItem), hasMore: result.hasMore });
      }
      case 'search': {
        const folder = folders.includes(q('folder') as MessageFolder) ? (q('folder') as MessageFolder) : 'all';
        const account = q('account');
        const query = q('query').trim();
        if (!account || !query) return failure('Wprowadź frazę do wyszukania');
        const searchFolder = ['all', 'contact_form', 'sent', 'received'].includes(folder) ? folder : 'all';
        const result = await searchMessages(ctx.supabase, user, {
          emailAccountId: account, query, dateFrom: q('dateFrom') || undefined, dateTo: q('dateTo') || undefined,
          filterType: searchFolder as 'all' | 'contact_form' | 'sent' | 'received',
        });
        const messages = result.messages.filter((message) => messageMatchesFolder(message, account, folder));
        return nativeJson({ messages: messages.map(listItem), total: result.total });
      }
      case 'details': {
        const type = q('type');
        if (!uuid.test(q('id')) || !['contact_form', 'sent', 'received'].includes(type)) return failure('Nieprawidłowa wiadomość.');
        const result = await details(ctx, q('id'), type as 'contact_form' | 'sent' | 'received');
        return result ? nativeJson(result) : failure('Nie znaleziono wiadomości lub nie masz do niej dostępu.', 404);
      }
      case 'employees': {
        const { data, error } = await ctx.supabase.from('employees')
          .select('id,name,surname,email,avatar_url,permissions,role').eq('is_active', true).order('name');
        if (error) throw error;
        const assignable = q('purpose') === 'assign';
        const employees = (data || [])
          .filter((row) => !assignable || row.role === 'admin' || (Array.isArray(row.permissions) &&
            ['messages_view', 'messages_manage', 'messages_assign'].some((scope) => row.permissions.includes(scope))))
          .map(({ id, name, surname, email, avatar_url }) => ({ id, name, surname, email, avatarUrl: avatar_url }));
        return nativeJson({ employees });
      }
      case 'inquiries': {
        let request = ctx.supabase.from('tasks').select('id,title').eq('is_inquiry', true).is('archived_at', null)
          .order('created_at', { ascending: false }).limit(30);
        const query = q('query').trim();
        if (query) request = request.ilike('title', `%${query.replace(/[\\%_]/g, '\\$&')}%`);
        const { data, error } = await request;
        if (error) return failure('Nie udało się pobrać zapytań.', 503);
        return nativeJson({ inquiries: (data || []).map((row) => ({ id: row.id, title: formatSystemSubject(row.title) })) });
      }
      case 'attachment': {
        const path = q('path');
        if (!path || path.includes('..')) return failure('Nieprawidłowy załącznik.');
        const { data, error } = await ctx.supabase.storage.from('email-attachments').createSignedUrl(path, 120);
        if (error || !data?.signedUrl) return failure('Nie udało się pobrać załącznika. Spróbuj ponownie.', 403);
        return nativeJson({ url: data.signedUrl });
      }
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    console.error('[native/messages] GET', q('op'), error);
    return failure(errorText(error, 'Nie udało się pobrać wiadomości.'), 503);
  }
}

type SendInput = {
  accountId?: string; to?: string; cc?: string; bcc?: string; subject?: string; text?: string;
  scheduledAt?: string | null; reply?: { id?: string; type?: string } | null;
  attachments?: Array<{ filename?: string; content?: string; contentType?: string }>;
};

async function replyContext(ctx: NativeContext, reply: SendInput['reply']): Promise<MessageDetails | null> {
  if (!reply?.id || !uuid.test(reply.id) || !['contact_form', 'received', 'sent'].includes(reply.type || '')) return null;
  return messageDetails(ctx.supabase, { id: reply.id, type: reply.type as 'contact_form' | 'received' | 'sent' });
}

async function sendingAccount(ctx: NativeContext, accountId: string | undefined) {
  const { accounts } = await emailAccounts(ctx.supabase, { id: ctx.employee.id });
  return accounts.find((account) => account.id === accountId && account.can_send === true) || null;
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const rights = access(ctx);
  if (!rights.canView) return failure('Nie masz dostępu do wiadomości.', 403);
  let input: any;
  try { input = await readJson(request, 35 * 1024 * 1024); } catch (error) {
    return (error as Error)?.message === 'too_large' ? failure('Wiadomość jest zbyt duża (maks. ok. 25 MB załączników).', 413) : failure('Nieprawidłowe dane.');
  }
  const op = String(input?.op || '');
  // Każda zmiana wiadomości jest widoczna przy następnej synchronizacji kopii na Macu (po zapisie, nie przed).
  const writes = !['mirrorItems', 'bodies', 'sales', 'preview', 'compose'].includes(op);
  try {
    switch (op) {
      case 'mirrorItems':
        return nativeJson(await mailItems(ctx, Array.isArray(input.buckets) ? input.buckets.slice(0, 256) : []));
      case 'bodies':
        return nativeJson(await mailBodies(ctx, mailRefs(input.refs, 40)));
      case 'sales': {
        const refs = mailRefs(input.refs, 100);
        return nativeJson({ sales: refs.length ? await mailSales(ctx, refs) : {} });
      }
      case 'touch':
        return nativeJson({ ok: true });
      case 'read': {
        if (!uuid.test(input.id) || !['contact_form', 'received'].includes(input.type)) return failure('Nieprawidłowa wiadomość.');
        await markMessageRead(ctx.supabase, { id: input.id, type: input.type, isRead: input.isRead !== false });
        return nativeJson({ ok: true });
      }
      case 'star': {
        if (!uuid.test(input.id)) return failure('Nieprawidłowa wiadomość.');
        await toggleMessageStar(ctx.supabase, { id: input.id, isStarred: Boolean(input.isStarred) });
        return nativeJson({ ok: true });
      }
      case 'trash':
      case 'restore': {
        // Formularz i wersje robocze — kosz CRM; poczta IMAP przez `/bridge/messages/trash`.
        const table = input.type === 'contact_form' ? 'contact_messages' : input.type === 'draft' ? 'email_drafts' : null;
        if (!uuid.test(input.id) || !table) return failure('Nieprawidłowa wiadomość.');
        if (input.type === 'contact_form' && !rights.canManage) return failure('Brak uprawnień do zmiany tej wiadomości.', 403);
        const { data, error } = await ctx.supabase.from(table)
          .update({ deleted_at: op === 'trash' ? new Date().toISOString() : null }).eq('id', input.id).select('id').maybeSingle();
        if (error || !data) return failure(error?.message || 'Brak uprawnień do zmiany tej wiadomości.', 403);
        return nativeJson({ ok: true });
      }
      case 'assign': {
        if (!rights.canManage) return failure('Brak uprawnień do przypisywania wiadomości.', 403);
        if (!uuid.test(input.id) || !['contact_form', 'received'].includes(input.type)) return failure('Nieprawidłowa wiadomość.');
        const assignee = input.assignee ? String(input.assignee) : null;
        const current = input.current ? String(input.current) : null;
        let update = ctx.supabase.from(input.type === 'contact_form' ? 'contact_messages' : 'received_emails')
          .update(assignee
            ? { assigned_to: assignee, assigned_at: new Date().toISOString(), assigned_by: ctx.employee.id }
            : { assigned_to: null, assigned_at: null, assigned_by: null })
          .eq('id', input.id);
        update = current ? update.eq('assigned_to', current) : update.is('assigned_to', null);
        const { data, error } = await update.select('id').maybeSingle();
        if (error) throw error;
        if (!data) return failure('Przypisanie już się zmieniło. Odśwież wiadomość.', 409);
        return nativeJson({ ok: true, message: assignee ? 'Wiadomość została przypisana' : 'Przypisanie zostało usunięte' });
      }
      case 'inquiry': {
        if (!uuid.test(input.id) || !uuid.test(input.owner || '')) return failure('Wybierz opiekuna zapytania.');
        const guests = input.guestCount === null || input.guestCount === undefined || input.guestCount === '' ? null : Number(input.guestCount);
        if (guests !== null && (!Number.isInteger(guests) || guests < 1 || guests > 100000)) {
          return failure('Podaj całkowitą liczbę osób od 1 do 100 000 lub zostaw pole puste.');
        }
        const { data, error } = await ctx.supabase.rpc('crm_create_inquiry_from_message', {
          p_type: input.type, p_id: input.id, p_owner: input.owner, p_guest_count: guests,
        });
        if (error) throw error;
        if (!data?.id) return failure('Serwer nie potwierdził zapisu zapytania.', 503);
        return nativeJson({ ok: true, id: data.id, warning: data.ownerId !== input.owner, message: messageInquirySaveFeedback(data, input.owner) });
      }
      case 'link': {
        if (!uuid.test(input.inquiryId || '') || !uuid.test(input.id) || !['received', 'sent'].includes(input.type)) return failure('Wybierz zapytanie.');
        const { error } = await ctx.supabase.rpc('link_inquiry_email', {
          p_inquiry_id: input.inquiryId, p_type: input.type, p_id: input.id, p_thread: input.thread !== false,
        });
        if (error) return failure(errorText(error, 'Nie udało się zapisać powiązania. Spróbuj ponownie.'), 409);
        return nativeJson({ ok: true, id: input.inquiryId, message: 'Konwersacja została powiązana z zapytaniem.' });
      }
      case 'task': {
        if (!rights.canCreateTasks) return failure('Brak uprawnień do tworzenia zadań.', 403);
        const title = String(input.title || '').trim();
        if (!title) return failure('Podaj tytuł zadania');
        if (!uuid.test(input.id) || !['contact_form', 'received', 'sent'].includes(input.type)) return failure('Nieprawidłowa wiadomość.');
        const priority = ['low', 'medium', 'high', 'urgent'].includes(input.priority) ? input.priority : 'high';
        const assignee = input.assignee && uuid.test(input.assignee) ? input.assignee : null;
        let linkedInquiry: string | null = null;
        if (input.type === 'contact_form') {
          const result = await ctx.supabase.from('tasks').select('id').eq('is_inquiry', true)
            .contains('inquiry_details', { source_message_id: input.id, source_message_type: 'contact_form' })
            .order('created_at').limit(1).maybeSingle();
          if (result.error) throw result.error;
          linkedInquiry = result.data?.id || null;
          if (!linkedInquiry) return failure('Najpierw otwórz zapytanie tego formularza w lejku. Jeśli go nie widzisz, sprawdź dostęp do zapytań i migrację źródeł.', 409);
        }
        const sourceUrl = `/crm/messages/${input.id}?type=${input.type}`;
        const { data: task, error: taskError } = await ctx.supabase.from('tasks').insert({
          title,
          description: String(input.description || '').trim().slice(0, 10000) || `Wiadomość źródłowa: ${sourceUrl}`,
          priority, status: 'todo', board_column: 'todo', order_index: 0,
          due_date: input.dueDate ? new Date(input.dueDate).toISOString() : null,
          created_by: ctx.employee.id, assigned_to: assignee, owner_id: ctx.employee.id,
          is_private: false, is_inquiry: false, inquiry_id: linkedInquiry,
        }).select('id').single();
        if (taskError) throw taskError;
        if (assignee) {
          const { data: assignment, error: assignmentError } = await ctx.supabase.from('task_assignees')
            .insert({ task_id: task.id, employee_id: assignee, assigned_by: ctx.employee.id }).select('id').single();
          if (assignmentError) throw assignmentError;
          const push = await ctx.supabase.functions.invoke('send-task-assignment-push', { body: { assignment_id: assignment.id } });
          if (push.error) console.warn('[native/messages] Task assignment push failed:', push.error);
        }
        return nativeJson({ ok: true, id: task.id, message: 'Utworzono zadanie z wiadomości' });
      }
      case 'fetch': {
        if (!rights.canManage) return failure('Brak uprawnień do pobierania poczty.', 403);
        if (!uuid.test(input.accountId || '')) return failure('Wybierz konkretne konto email');
        const { data, error } = await ctx.supabase.functions.invoke('fetch-emails', { body: { emailAccountId: input.accountId } });
        if (error || !data?.success) return failure(`Błąd: ${data?.error || errorText(error, 'Nie udało się pobrać wiadomości')}`, 502);
        return nativeJson({ ok: true, count: data.count || 0, message: `Pobrano ${data.count || 0} nowych wiadomości` });
      }
      case 'preview':
      case 'compose':
      case 'send': {
        const body = input as SendInput;
        const account = await sendingAccount(ctx, body.accountId);
        if (!account) return failure('Nie masz uprawnień do wysyłania z tej skrzynki.', 403);
        const reply = await replyContext(ctx, body.reply);
        const html = await composeEmailHtml(ctx.supabase, {
          employeeId: ctx.employee.id, accountId: account.id, subject: String(body.subject || ''),
          text: String(body.text || ''), quotedHtml: reply ? replyQuoteHtml(reply) : '',
        });
        if (op === 'preview') return nativeJson({ html: emailPreviewDocument(html) });
        // Aplikacja wysyła załączniki bezpośrednio do funkcji poczty (jak przeglądarka) — tu tylko treść i nagłówki wątku.
        if (op === 'compose') {
          return nativeJson({
            html,
            messageId: reply?.type === 'contact_form' ? reply.id : null,
            ...(reply ? replyThreadHeaders(reply) : {}),
          });
        }
        if (!String(body.to || '').trim() || !String(body.subject || '').trim() || !String(body.text || '').trim()) return failure('Wypełnij wszystkie pola');
        let scheduledAt: string | null = null;
        if (body.scheduledAt) {
          const date = new Date(body.scheduledAt);
          if (Number.isNaN(date.getTime())) return failure('Podaj prawidłową datę i godzinę wysyłki');
          if (date.getTime() < Date.now() + 30_000) return failure('Termin wysyłki musi przypadać w przyszłości');
          scheduledAt = date.toISOString();
        }
        const attachments = (body.attachments || [])
          .filter((file) => file?.filename && typeof file.content === 'string')
          .map((file) => ({ filename: String(file.filename), content: String(file.content), contentType: file.contentType || 'application/octet-stream' }));
        const result = await dispatchCrmEmail({
          accessToken: bearer(request),
          functionName: 'send-email',
          scheduledAt,
          metadata: { entityType: 'message', actionUrl: '/crm/messages' },
          payload: {
            emailAccountId: account.id,
            to: String(body.to).trim(), cc: String(body.cc || '').trim(), bcc: String(body.bcc || '').trim(),
            subject: String(body.subject).trim(), body: html, attachments,
            messageId: reply?.type === 'contact_form' ? reply.id : undefined,
            ...(reply ? replyThreadHeaders(reply) : {}),
          },
        });
        return nativeJson({ ok: true, scheduled: result.scheduled, scheduledAt: result.scheduledAt ?? null });
      }
      case 'order': {
        const ids = Array.isArray(input.ids) ? input.ids.filter((id: unknown) => typeof id === 'string' && uuid.test(id)).slice(0, 200) : [];
        const { data: profile, error } = await ctx.supabase.from('employees').select('preferences').eq('id', ctx.employee.id).maybeSingle();
        if (error) throw error;
        const preferences = (profile?.preferences || {}) as Record<string, any>;
        const next = { ...preferences, messages: { ...(preferences.messages || {}), mailboxOrder: ids } };
        const saved = await ctx.supabase.from('employees').update({ preferences: next }).eq('id', ctx.employee.id);
        if (saved.error) throw saved.error;
        return nativeJson({ ok: true });
      }
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    console.error('[native/messages] POST', op, error);
    return failure(errorText(error, 'Nie udało się wykonać operacji.'), 503);
  } finally {
    if (writes) invalidateMail();
  }
}
