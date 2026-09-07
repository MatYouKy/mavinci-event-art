import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class WeddingDocumentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const getWeddingAdmin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/** The integration key stays on the two servers. Browser-supplied employee IDs are never trusted. */
export async function authorizeWeddingDocument(request: Request, eventId: string) {
  if (!UUID_PATTERN.test(eventId)) throw new WeddingDocumentError('Nieprawidłowe wydarzenie.');
  const admin = getWeddingAdmin();
  let employeeId: string | null = null;
  let userId: string | null = null;
  let actor: string;
  const sourceSlug = request.headers.get('X-Webhook-Source');
  if (sourceSlug !== null) {
    if (sourceSlug !== 'event-rulers') throw new WeddingDocumentError('Niedozwolona integracja.', 403);
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
    const { data: source, error } = await admin.from('webhook_sources')
      .select('id,api_key_hash,is_active').eq('slug', sourceSlug).maybeSingle();
    const digest = createHash('sha256').update(token).digest('hex');
    if (error || !source?.is_active || !token || source.api_key_hash?.length !== digest.length ||
        !timingSafeEqual(Buffer.from(digest), Buffer.from(source.api_key_hash))) {
      throw new WeddingDocumentError('Nieprawidłowe uwierzytelnienie integracji.', 401);
    }
    const externalId = request.headers.get('X-Eventrulers-User-Id') || '';
    if (!UUID_PATTERN.test(externalId)) throw new WeddingDocumentError('Brak tożsamości administratora.', 401);
    actor = `event-rulers:${externalId}`;
    const email = (request.headers.get('X-Eventrulers-User-Email') || '').trim().toLowerCase();
    // Match the verified ER login to an active CRM employee, then confirm its auth identity.
    // No match still permits PDF generation, but never grants access to an arbitrary mailbox.
    if (email && email.length <= 320 && !/[\r\n]/.test(email)) {
      const { data: employee } = await admin.from('employees').select('id,auth_user_id')
        .ilike('email', email.replace(/[\\%_]/g, '\\$&')).eq('is_active', true).maybeSingle();
      if (employee) {
        const candidateUserId = employee.auth_user_id || employee.id;
        const { data: auth } = await admin.auth.admin.getUserById(candidateUserId);
        if (auth.user?.email?.toLowerCase() === email) { employeeId = employee.id; userId = auth.user.id; }
      }
    }
    const { data: event, error: eventError } = await admin.from('events')
      .select('id,event_categories!inner(name)').eq('id', eventId).ilike('event_categories.name', 'wesele').maybeSingle();
    if (eventError || !event) throw new WeddingDocumentError('Nie znaleziono wydarzenia weselnego.', 404);
  } else {
    const client = createSupabaseServerClient(await cookies());
    const { data: auth } = await client.auth.getUser();
    if (!auth.user) throw new WeddingDocumentError('Wymagane logowanie.', 401);
    const { data: allowed, error } = await client.rpc('can_manage_event_workflows', { p_event_id: eventId });
    if (error || !allowed) throw new WeddingDocumentError('Nie masz uprawnień do Karty Weselnej.', 403);
    const { data } = await client.rpc('current_workflow_employee_id');
    employeeId = data || null;
    userId = auth.user.id;
    actor = `crm:${auth.user.id}`;
  }
  return { admin, employeeId, userId, actor };
}

export async function weddingSenderAccounts(access: Awaited<ReturnType<typeof authorizeWeddingDocument>>) {
  if (!access.employeeId || !access.userId) return [];
  const { admin, employeeId } = access;
  const fields = 'id,email_address,from_name,account_name,is_default';
  const [owned, assigned] = await Promise.all([
    admin.from('employee_email_accounts').select(fields).eq('employee_id', employeeId).eq('is_active', true).or('account_type.is.null,account_type.neq.system'),
    admin.from('employee_email_account_assignments').select('email_account_id').eq('employee_id', employeeId).eq('can_send', true),
  ]);
  if (owned.error || assigned.error) throw new WeddingDocumentError('Nie udało się pobrać skrzynek nadawczych.', 503);
  const ids = (assigned.data || []).map((row) => row.email_account_id);
  const shared = ids.length ? await admin.from('employee_email_accounts').select(fields).in('id', ids).eq('is_active', true).or('account_type.is.null,account_type.neq.system') : { data: [], error: null };
  if (shared.error) throw new WeddingDocumentError('Nie udało się pobrać skrzynek nadawczych.', 503);
  return [...new Map([...(owned.data || []), ...(shared.data || [])].map((account) => [account.id, account])).values()]
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.email_address.localeCompare(b.email_address));
}
