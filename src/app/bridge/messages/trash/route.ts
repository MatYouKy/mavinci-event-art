import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const json = (body: unknown,status = 200) => NextResponse.json(body,{ status,headers: { 'Cache-Control': 'private, no-store' } });

export async function POST(request: NextRequest) {
  let operation: { type: string; id: string; token: string } | null = null;
  try {
    // Native clients use their existing user bearer token. Browser requests use
    // same-origin cookies. Both paths call the same permission-checked RPC.
    const authorization = request.headers.get('authorization');
    const bearer = authorization?.startsWith('Bearer ') ? authorization : null;
    const origin = request.headers.get('origin');
    if (!bearer && (!origin || new URL(origin).host !== request.headers.get('host'))) return json({ error: 'Nieprawidłowe źródło żądania.' },403);
    const client = bearer ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
      global: { headers: { Authorization: bearer } },auth: { persistSession: false,autoRefreshToken: false },
    }) : createSupabaseServerClient(cookies());
    const { data: { user },error: authError } = await client.auth.getUser(bearer?.slice(7));
    if (authError || !user) return json({ error: 'Zaloguj się ponownie.' },401);
    const input = await request.json().catch(() => null);
    if (!uuid.test(input?.id || '') || !['received','sent'].includes(input?.type) || !['trash','restore'].includes(input?.action)) {
      return json({ error: 'Nieprawidłowa wiadomość lub operacja.' },400);
    }
    // Apply existing message visibility as well as mailbox membership before
    // claiming an operation; a guessed UUID must not bypass SELECT policies.
    const visible = await client.from(input.type === 'received' ? 'received_emails' : 'sent_emails')
      .select('id').eq('id', input.id).maybeSingle();
    if (visible.error || !visible.data) return json({ error: 'Nie znaleziono wiadomości lub nie masz do niej dostępu.' },403);
    const relayUrl = process.env.IMAP_ATTACHMENT_RELAY_URL || process.env.SMTP_RELAY_URL;
    const secret = process.env.IMAP_ATTACHMENT_RELAY_SECRET || process.env.SMTP_RELAY_SECRET;
    if (!relayUrl || !secret) return json({ error: 'Synchronizacja kosza nie jest skonfigurowana.' },503);
    const { data: move,error } = await client.rpc('begin_email_trash_operation',{ p_type: input.type,p_id: input.id,p_action: input.action });
    if (error || !move) return json({ error: error?.code === 'PGRST202'
      ? 'Synchronizacja kosza wymaga aktualizacji bazy danych.'
      : error?.message || 'Nie udało się sprawdzić uprawnień do skrzynki.' },error?.code === '42501' ? 403 : 409);
    operation = { type: input.type,id: input.id,token: move.token };
    const admin = createSupabaseAdminClient();
    const { data: account,error: accountError } = await admin.from('employee_email_accounts')
      .select('imap_host,imap_port,imap_username,imap_password,imap_use_ssl,is_active').eq('id',move.accountId).single();
    if (accountError || !account?.is_active || !account.imap_host || !account.imap_username || !account.imap_password) {
      throw new Error('Skrzynka nie ma aktywnej konfiguracji IMAP.');
    }
    const response = await fetch(`${relayUrl.replace(/\/$/,'')}/api/imap/trash`,{
      method: 'POST',cache: 'no-store',signal: AbortSignal.timeout(50000),
      headers: { Authorization: `Bearer ${secret}`,'Content-Type': 'application/json' },
      body: JSON.stringify({ action: input.action,kind: input.type,message: move,
        imapConfig: { host: account.imap_host,port: account.imap_port,username: account.imap_username,password: account.imap_password,secure: account.imap_use_ssl } }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.success !== true) {
      const errors: Record<string,string> = {
        MOVE_UNSUPPORTED: 'Serwer nie obsługuje bezpiecznego przenoszenia wiadomości. Niczego nie usunięto.',
        FOLDER_AMBIGUOUS: 'Nie udało się rozpoznać folderu Kosz lub folderu docelowego. Sprawdź konfigurację skrzynki.',
        MESSAGE_AMBIGUOUS: 'Kilka wiadomości ma ten sam identyfikator. Otwórz skrzynkę w programie pocztowym, aby wybrać właściwą.',
        MESSAGE_NOT_FOUND: 'Nie znaleziono wiadomości w folderze źródłowym ani docelowym. Odśwież skrzynkę.',
        BUSY: 'Trwa porządkowanie innych wiadomości. Spróbuj za chwilę.',
      };
      throw new Error(errors[result?.code] || 'Serwer nie potwierdził przeniesienia. Ponów tę samą czynność, aby uzgodnić stan wiadomości.');
    }
    const saved = await admin.rpc('finish_email_trash_operation',{ p_type: input.type,p_id: input.id,p_token: move.token,p_result: result });
    if (saved.error) throw new Error('Serwer pocztowy przeniósł wiadomość, ale CRM nie zapisał potwierdzenia. Ponów tę samą czynność, aby uzgodnić stan.');
    operation = null;
    return json({ ok: true,action: input.action });
  } catch (error) {
    if (operation) {
      await createSupabaseAdminClient().rpc('finish_email_trash_operation',{
        p_type: operation.type,p_id: operation.id,p_token: operation.token,p_result: { success: false },
      }).then(() => undefined,() => undefined);
    }
    const message = error instanceof Error && error.name !== 'TimeoutError' && error.name !== 'TypeError'
      ? error.message : 'Nie otrzymano potwierdzenia z serwera. Ponów tę samą czynność, aby uzgodnić stan wiadomości.';
    return json({ error: message },503);
  }
}
