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

    const [{ data: personal }, { data: assigned }] = await Promise.all([
      supabase.from("employee_email_accounts").select("id").eq("employee_id", user.id).eq("is_active", true),
      supabase.from("employee_email_account_assignments").select("email_account_id").eq("employee_id", user.id),
    ]);
    const allowedAccountIds = [...new Set([
      ...(personal || []).map((row) => row.id),
      ...(assigned || []).map((row) => row.email_account_id),
    ])];
    if (!allowedAccountIds.length) return json({ success: true, updated: 0 });

    let emailQuery = supabase
      .from("received_emails")
      .select("id, message_id, email_account_id")
      .in("email_account_id", allowedAccountIds)
      .is("deleted_at", null)
      .order("received_date", { ascending: false })
      .limit(mode === "mark_read" ? 1 : 250);
    if (messageId) emailQuery = emailQuery.eq("id", messageId);

    const { data: emails, error: emailError } = await emailQuery;
    if (emailError) throw emailError;
    if (!emails?.length) throw new Error("Email not found or unavailable");

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
        .map((email) => ({ id: email.id, messageId: email.message_id }));
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
          markAsRead: mode === "mark_read",
        }),
      });
      const relayResult = await relayResponse.json();
      if (!relayResponse.ok || !relayResult.success) throw new Error(relayResult.error || "IMAP relay error");

      for (const state of relayResult.states || []) {
        if (!state.found) continue;
        const { error } = await supabase
          .from("received_emails")
          .update({ is_read: state.isRead })
          .eq("id", state.id);
        if (!error) updated += 1;
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
