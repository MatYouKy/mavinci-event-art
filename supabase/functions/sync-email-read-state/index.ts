import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const { messageId, mode = "sync" } = await req.json().catch(() => ({}));

    if (!['sync', 'mark_read', 'mark_unread'].includes(mode)) return json({ success: false, error: 'Invalid mode' }, 400);
    if (mode !== 'sync' && !messageId) return json({ success: false, error: 'messageId required' }, 400);

    const [{ data: personal }, { data: assigned }] = await Promise.all([
      supabase.from("employee_email_accounts").select("id").eq("employee_id", user.id).eq("is_active", true),
      supabase.from("employee_email_account_assignments").select("email_account_id").eq("employee_id", user.id),
    ]);
    const allowedAccountIds = [...new Set([
      ...(personal || []).map((row) => row.id),
      ...(assigned || []).map((row) => row.email_account_id),
    ])];
    if (!allowedAccountIds.length) return json({ success: true, updated: 0 });

    const isDirectChange = mode === "mark_read" || mode === "mark_unread";
    let emailQuery = supabase
      .from("received_emails")
      .select("id, message_id, email_account_id, imap_uid, imap_uidvalidity, imap_mailbox, imap_flags, is_read")
      .in("email_account_id", allowedAccountIds)
      .is("deleted_at", null)
      .order("received_date", { ascending: false })
      .limit(isDirectChange ? 1 : 500);
    if (messageId) emailQuery = emailQuery.eq("id", messageId);

    const { data: emails, error: emailError } = await emailQuery;
    if (emailError) throw emailError;
    if (!emails?.length) {
      return json({ success: true, updated: 0 });
    }

    let updated = 0;
    for (const accountId of [...new Set(emails.map((email) => email.email_account_id))]) {
      const { data: account, error: accountError } = await supabase
        .from("employee_email_accounts")
        .select("imap_host, imap_port, imap_username, imap_password, imap_use_ssl")
        .eq("id", accountId)
        .single();
      if (accountError || !account) continue;

      const accountEmails = emails
        .filter((email) => email.email_account_id === accountId && email.message_id)
        .map((email) => ({
          id: email.id,
          messageId: email.message_id,
          imapUid: email.imap_uid,
          imapUidValidity: email.imap_uidvalidity,
          mailbox: email.imap_mailbox || "INBOX",
        }));
      const relayResponse = await fetch(`${Deno.env.get("SMTP_RELAY_URL")}/api/imap/read-state`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SMTP_RELAY_SECRET")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imapConfig: {
            host: account.imap_host,
            port: account.imap_port,
            username: account.imap_username,
            password: account.imap_password,
            secure: account.imap_use_ssl,
          },
          messages: accountEmails,
          targetReadState:
            mode === "mark_read" ? true : mode === "mark_unread" ? false : null,
          mailbox: "INBOX",
        }),
        signal: AbortSignal.timeout(20000),
      });
      const relayResult = await relayResponse.json();
      if (!relayResponse.ok || !relayResult.success) throw new Error(relayResult.error || "IMAP relay error");

      const knownEmails = new Map(emails.filter(email => email.email_account_id === accountId).map(email => [email.id, email]));
      for (const state of relayResult.states || []) {
        const previous = knownEmails.get(state.id);
        if (!state.found || !previous || typeof state.isRead !== 'boolean') continue;
        const next = {
          is_read: state.isRead,
          imap_uid: state.uid || null,
          imap_uidvalidity: state.uidValidity || null,
          imap_mailbox: state.mailbox || 'INBOX',
          imap_flags: Array.isArray(state.flags) ? [...new Set(state.flags)].sort() : [],
        };
        const sameFlags = JSON.stringify([...(previous.imap_flags || [])].sort()) === JSON.stringify(next.imap_flags);
        if (previous.is_read === next.is_read && String(previous.imap_uid ?? '') === String(next.imap_uid ?? '')
          && String(previous.imap_uidvalidity ?? '') === String(next.imap_uidvalidity ?? '')
          && previous.imap_mailbox === next.imap_mailbox && sameFlags) continue;
        let update = supabase.from('received_emails')
          .update({ ...next, imap_synced_at: new Date().toISOString() })
          .eq('id', previous.id).eq('email_account_id', accountId);
        // A background snapshot must not undo a newer manual read/unread action.
        if (!isDirectChange) update = previous.is_read === null ? update.is('is_read', null) : update.eq('is_read', previous.is_read);
        const { error, data } = await update.select('id');
        if (error) throw error;
        updated += data?.length || 0;
      }
    }

    return json({ success: true, updated });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
