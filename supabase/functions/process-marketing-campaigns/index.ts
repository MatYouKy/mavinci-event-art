import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Marketing-Worker-Secret",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const replacePlaceholders = (value: string, recipient: Record<string, unknown>, html = false) => {
  const displayName = String(recipient.display_name || "").trim();
  const firstName = displayName.split(/\s+/)[0] || "";
  const personalization = (recipient.personalization || {}) as Record<string, unknown>;
  const values: Record<string, string> = {
    IMIE: firstName,
    NAME: displayName,
    EMAIL: String(recipient.email || ""),
    FIRMA: String(personalization.organization_name || ""),
  };
  return Object.entries(values).reduce((result, [key, replacement]) => (
    result.replaceAll(`{{${key}}}`, html ? escapeHtml(replacement) : replacement)
  ), value);
};

const rewriteLinks = (html: string, trackingBase: string, token: string) => html.replace(
  /href=(['"])(https?:\/\/[^'"\s>]+)\1/gi,
  (_match, quote: string, target: string) => {
    if (target.startsWith(trackingBase)) return `href=${quote}${target}${quote}`;
    const tracked = `${trackingBase}?type=click&token=${encodeURIComponent(token)}&url=${encodeURIComponent(target)}`;
    return `href=${quote}${tracked}${quote}`;
  },
);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  try {
    const configuredWorkerSecret = Deno.env.get("MARKETING_WORKER_SECRET") || "";
    const suppliedWorkerSecret = request.headers.get("X-Marketing-Worker-Secret") || "";
    const isInternalWorker = Boolean(configuredWorkerSecret) && suppliedWorkerSecret === configuredWorkerSecret;

    if (!isInternalWorker) {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: authData, error: authError } = await service.auth.getUser(token);
      if (authError || !authData.user) return json({ error: "Brak autoryzacji" }, 401);
      const { data: employee } = await service.from("employees")
        .select("role, access_level, permissions, is_active")
        .or(`id.eq.${authData.user.id},auth_user_id.eq.${authData.user.id}`)
        .eq("is_active", true)
        .maybeSingle();
      const canManage = employee && (
        employee.role === "admin" || employee.access_level === "admin"
        || (employee.permissions || []).includes("marketing_campaigns_manage")
      );
      if (!canManage) return json({ error: "Brak uprawnień do uruchomienia kolejki" }, 403);
    }

    const { data: claim, error: claimError } = await service.rpc("claim_mailing_campaign_batch", { p_max_batch: 20 });
    if (claimError) throw claimError;
    if (!claim?.campaign_id || !Array.isArray(claim.recipient_ids) || claim.recipient_ids.length === 0) {
      return json({ status: "idle", processed: 0 });
    }

    const campaignId = String(claim.campaign_id);
    const [{ data: campaign, error: campaignError }, { data: recipients, error: recipientsError }] = await Promise.all([
      service.from("mailing_campaigns")
        .select("id, subject, content, preview_text, status, email_account_id, track_opens, track_clicks")
        .eq("id", campaignId).single(),
      service.from("mailing_recipients")
        .select("id, email, display_name, personalization, unsubscribe_token, attempt_count, status")
        .in("id", claim.recipient_ids).order("created_at"),
    ]);
    if (campaignError || !campaign) throw campaignError || new Error("Nie znaleziono kampanii");
    if (recipientsError) throw recipientsError;
    if (!campaign.email_account_id) throw new Error("Brak konta nadawczego");

    const { data: account, error: accountError } = await service.from("employee_email_accounts")
      .select("smtp_host, smtp_port, smtp_username, smtp_password, smtp_use_tls, email_address, from_name, is_active")
      .eq("id", campaign.email_account_id).eq("is_active", true).single();
    if (accountError || !account) throw accountError || new Error("Konto nadawcze jest niedostępne");

    const relayUrl = Deno.env.get("SMTP_RELAY_URL");
    const relaySecret = Deno.env.get("SMTP_RELAY_SECRET");
    if (!relayUrl || !relaySecret) throw new Error("Brak konfiguracji SMTP relay");

    const unsubscribeBase = `${supabaseUrl}/functions/v1/unsubscribe-marketing`;
    const trackingBase = `${supabaseUrl}/functions/v1/track-marketing-event`;
    let sent = 0;
    let failed = 0;
    let retried = 0;

    for (const recipient of recipients || []) {
      const { data: liveRecipient } = await service.from("mailing_recipients")
        .select("status").eq("id", recipient.id).maybeSingle();
      const { data: liveCampaign } = await service.from("mailing_campaigns")
        .select("status").eq("id", campaignId).maybeSingle();
      if (liveRecipient?.status !== "processing") continue;
      if (liveCampaign?.status !== "sending") {
        await service.from("mailing_recipients").update({
          status: "retry", claimed_at: null, next_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", recipient.id).eq("status", "processing");
        continue;
      }

      try {
        if (!recipient.email) throw new Error("Brak adresu e-mail");
        const token = String(recipient.unsubscribe_token);
        const unsubscribeUrl = `${unsubscribeBase}?token=${encodeURIComponent(token)}`;
        let body = replacePlaceholders(String(campaign.content || ""), recipient, true);
        if (campaign.track_clicks) body = rewriteLinks(body, trackingBase, token);
        const preheader = campaign.preview_text
          ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(campaign.preview_text)}</div>`
          : "";
        const footer = `<div style="margin-top:28px;padding-top:14px;border-top:1px solid #ddd;color:#777;font:12px Arial,sans-serif;line-height:1.5">Otrzymujesz tę wiadomość na podstawie zapisanych preferencji komunikacji. <a href="${unsubscribeUrl}" style="color:#555;text-decoration:underline">Wypisz mnie</a>.</div>`;
        const pixel = campaign.track_opens
          ? `<img src="${trackingBase}?type=open&token=${encodeURIComponent(token)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px" />`
          : "";

        const relayResponse = await fetch(`${relayUrl}/api/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${relaySecret}` },
          body: JSON.stringify({
            smtpConfig: {
              host: account.smtp_host,
              port: account.smtp_port,
              username: account.smtp_username,
              password: account.smtp_password,
              useTls: account.smtp_use_tls,
              from: account.email_address,
              fromName: account.from_name,
            },
            to: recipient.email,
            subject: replacePlaceholders(String(campaign.subject || ""), recipient),
            body: `${preheader}${body}${footer}${pixel}`,
          }),
        });
        const relayResult = await relayResponse.json().catch(() => ({}));
        if (!relayResponse.ok || relayResult.success === false) throw new Error(relayResult.error || "Błąd SMTP relay");

        const sentAt = new Date().toISOString();
        await service.from("mailing_recipients").update({
          status: "sent", sent_at: sentAt, message_id: relayResult.messageId || null,
          claimed_at: null, next_attempt_at: null, error_message: null, updated_at: sentAt,
        }).eq("id", recipient.id).eq("status", "processing");
        await service.from("mailing_campaign_events").insert({
          campaign_id: campaignId, recipient_id: recipient.id, event_type: "sent",
          metadata: { message_id: relayResult.messageId || null },
        });
        sent += 1;
      } catch (error) {
        const attemptCount = Number(recipient.attempt_count || 1);
        const shouldRetry = attemptCount < 3;
        const retryAt = new Date(Date.now() + Math.min(3600, 60 * (2 ** Math.max(0, attemptCount - 1))) * 1000).toISOString();
        await service.from("mailing_recipients").update({
          status: shouldRetry ? "retry" : "failed",
          next_attempt_at: shouldRetry ? retryAt : null,
          failed_at: shouldRetry ? null : new Date().toISOString(),
          claimed_at: null,
          error_message: error instanceof Error ? error.message.slice(0, 1000) : "Nieznany błąd wysyłki",
          updated_at: new Date().toISOString(),
        }).eq("id", recipient.id).eq("status", "processing");
        if (shouldRetry) retried += 1;
        else failed += 1;
        if (!shouldRetry) await service.from("mailing_campaign_events").insert({
          campaign_id: campaignId, recipient_id: recipient.id, event_type: "failed",
          metadata: { error: error instanceof Error ? error.message.slice(0, 500) : "Nieznany błąd" },
        });
      }
    }

    const { data: summary, error: finalizeError } = await service.rpc("finalize_mailing_campaign_batch", { p_campaign_id: campaignId });
    if (finalizeError) throw finalizeError;
    return json({ status: "processed", campaignId, sent, failed, retried, summary });
  } catch (error) {
    console.error("[process-marketing-campaigns]", error);
    return json({ error: error instanceof Error ? error.message : "Nie udało się przetworzyć kampanii" }, 500);
  }
});
