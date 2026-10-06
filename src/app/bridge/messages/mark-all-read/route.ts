import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const BATCH_SIZE = 25;
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store' },
});

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin');
    if (!origin || new URL(origin).host !== request.headers.get('host')) {
      return json({ error: 'Nieprawidłowe źródło żądania.' }, 403);
    }
    const input = await request.json().catch(() => null);
    if (typeof input?.accountId !== 'string' || !uuid.test(input.accountId) ||
        (input.cursor != null && (typeof input.cursor !== 'string' || !uuid.test(input.cursor)))) {
      return json({ error: 'Nieprawidłowa skrzynka lub zakres wiadomości.' }, 400);
    }
    // Keep new arrivals outside an operation already in progress.
    const cutoff = input.cutoff ?? new Date().toISOString();
    if (typeof cutoff !== 'string' || !Number.isFinite(Date.parse(cutoff)) || Date.parse(cutoff) > Date.now() + 5000) {
      return json({ error: 'Nieprawidłowy zakres wiadomości.' }, 400);
    }
    const client = createSupabaseServerClient(cookies());
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return json({ error: 'Zaloguj się ponownie.' }, 401);
    const access = await client.from('employee_email_accounts').select('id')
      .eq('id', input.accountId).eq('is_active', true).maybeSingle();
    if (access.error || !access.data) return json({ error: 'Brak dostępu do aktywnej skrzynki.' }, 403);
    // Read and write messages with the user's RLS. Admin is only for IMAP credentials.
    let query = client.from('received_emails')
      .select('id,message_id,imap_mailbox')
      .eq('email_account_id', input.accountId).eq('is_read', false)
      .is('deleted_at', null).lte('created_at', cutoff).order('id').limit(BATCH_SIZE);
    if (input.cursor) query = query.gt('id', input.cursor);
    const { data: messages, error } = await query;
    if (error) return json({ error: 'Nie udało się odczytać wiadomości.' }, 503);
    if (!messages?.length) return json({ ids: [], missingOnServer: 0, cursor: null, cutoff });

    const relayUrl = process.env.IMAP_ATTACHMENT_RELAY_URL || process.env.SMTP_RELAY_URL;
    const secret = process.env.IMAP_ATTACHMENT_RELAY_SECRET || process.env.SMTP_RELAY_SECRET;
    if (!relayUrl || !secret) return json({ error: 'Synchronizacja poczty nie jest skonfigurowana na serwerze.' }, 503);
    const admin = createSupabaseAdminClient();
    const { data: account, error: accountError } = await admin.from('employee_email_accounts')
      .select('imap_host,imap_port,imap_username,imap_password,imap_use_ssl,is_active')
      .eq('id', input.accountId).single();
    if (accountError || !account?.is_active || !account.imap_host || !account.imap_username || !account.imap_password) {
      return json({ error: 'Skrzynka nie ma aktywnej konfiguracji odbierania poczty.' }, 503);
    }
    let missingOnServer = 0;
    for (const mailbox of [...new Set(messages.map(message => message.imap_mailbox || 'INBOX'))]) {
      const group = messages.filter(message => (message.imap_mailbox || 'INBOX') === mailbox);
      const identifiable = group.filter(message => message.message_id);
      missingOnServer += group.length - identifiable.length;
      if (!identifiable.length) continue;
      const response = await fetch(`${relayUrl.replace(/\/$/, '')}/api/imap/read-state`, {
        method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(60000),
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imapConfig: { host: account.imap_host, port: account.imap_port, username: account.imap_username, password: account.imap_password, secure: account.imap_use_ssl },
          // Resolve by Message-ID rather than trusting potentially obsolete cached UIDs.
          messages: identifiable.map(message => ({ id: message.id, messageId: message.message_id })),
          mailbox, targetReadState: true,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true || !Array.isArray(result.states)) {
        return json({ error: 'Nie udało się oznaczyć wiadomości na serwerze pocztowym. Spróbuj ponownie.' }, 503);
      }
      for (const message of identifiable) {
        const state = result.states.find((entry: { id: string }) => entry.id === message.id);
        if (!state || (state.found && state.isRead !== true)) {
          return json({ error: 'Serwer nie potwierdził zmiany wszystkich wiadomości. Spróbuj ponownie.' }, 503);
        }
        if (!state.found) missingOnServer++;
      }
    }
    const ids = messages.map(message => message.id);
    const saved = await client.from('received_emails').update({ is_read: true })
      .eq('email_account_id', input.accountId).in('id', ids).is('deleted_at', null).select('id');
    if (saved.error || saved.data?.length !== ids.length) {
      return json({ error: 'Nie udało się zapisać wszystkich zmian w CRM. Część wiadomości mogła już zostać oznaczona. Spróbuj ponownie.' }, 503);
    }
    return json({ ids, missingOnServer, cursor: messages.length === BATCH_SIZE ? ids[ids.length - 1] : null, cutoff });
  } catch {
    return json({ error: 'Nie udało się zakończyć oznaczania wiadomości. Spróbuj ponownie.' }, 503);
  }
}
