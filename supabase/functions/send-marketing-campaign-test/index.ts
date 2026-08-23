import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Brak autoryzacji" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const service = createClient(supabaseUrl, serviceRoleKey);
    const { data: authData, error: authError } = await service.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Nieprawidłowa sesja" }, 401);

    const { campaignId, testEmail } = await request.json();
    const normalizedEmail = String(testEmail || "").trim().toLowerCase();
    if (!campaignId || !isEmail(normalizedEmail)) return json({ error: "Podaj kampanię i poprawny adres testowy" }, 400);

    const { data: employee, error: employeeError } = await service
      .from("employees")
      .select("id, role, access_level, permissions, is_active")
      .or(`id.eq.${authData.user.id},auth_user_id.eq.${authData.user.id}`)
      .eq("is_active", true)
      .maybeSingle();
    if (employeeError || !employee) return json({ error: "Nie znaleziono aktywnego pracownika" }, 403);
    const canManage = employee.role === "admin" || employee.access_level === "admin"
      || (employee.permissions || []).includes("marketing_campaigns_manage");
    if (!canManage) return json({ error: "Brak uprawnień do testowania kampanii" }, 403);

    const { data: campaign, error: campaignError } = await service
      .from("mailing_campaigns")
      .select("id, name, subject, content, status, email_account_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (campaignError || !campaign) return json({ error: "Nie znaleziono kampanii" }, 404);
    if (!["draft", "pending_approval"].includes(campaign.status)) return json({ error: "Kampania nie jest dostępna do testu" }, 409);
    if (!campaign.email_account_id || !campaign.subject || !campaign.content) return json({ error: "Uzupełnij konto, temat i treść kampanii" }, 400);

    const { data: account, error: accountError } = await service
      .from("employee_email_accounts")
      .select("id, employee_id, account_type, smtp_host, smtp_port, smtp_username, smtp_password, smtp_use_tls, email_address, from_name, is_active")
      .eq("id", campaign.email_account_id)
      .eq("is_active", true)
      .maybeSingle();
    if (accountError || !account) return json({ error: "Konto nadawcze jest niedostępne" }, 400);

    if (employee.role !== "admin" && employee.access_level !== "admin" && account.employee_id !== employee.id) {
      const { data: assignment } = await service.from("employee_email_account_assignments")
        .select("id").eq("email_account_id", account.id).eq("employee_id", employee.id).maybeSingle();
      if (!assignment) return json({ error: "Brak dostępu do wybranego konta nadawczego" }, 403);
    }

    const relayUrl = Deno.env.get("SMTP_RELAY_URL");
    const relaySecret = Deno.env.get("SMTP_RELAY_SECRET");
    if (!relayUrl || !relaySecret) throw new Error("Brak konfiguracji SMTP relay");

    const testBody = `
      <div style="padding:12px 16px;background:#fff3cd;border:1px solid #d3bb73;color:#5c4700;font:600 14px Arial,sans-serif;">
        WIADOMOŚĆ TESTOWA — kampania nie została wysłana do odbiorców
      </div>
      ${campaign.content}
      <div style="margin-top:24px;padding-top:12px;border-top:1px solid #ddd;color:#777;font:12px Arial,sans-serif;">
        Podgląd stopki kampanii: link rezygnacji zostanie wygenerowany indywidualnie podczas właściwej wysyłki.
      </div>`;

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
        to: normalizedEmail,
        subject: `[TEST] ${campaign.subject}`,
        body: testBody,
      }),
    });
    const relayResult = await relayResponse.json().catch(() => ({}));
    if (!relayResponse.ok) throw new Error(relayResult.error || "Błąd serwera pocztowego");

    const { data: updatedCampaign, error: updateError } = await service
      .from("mailing_campaigns")
      .update({ test_sent_at: new Date().toISOString(), test_sent_to: normalizedEmail })
      .eq("id", campaign.id)
      .in("status", ["draft", "pending_approval"])
      .select("id")
      .maybeSingle();
    if (updateError || !updatedCampaign) {
      throw new Error("Kampania zmieniła stan podczas testu. Odśwież widok i spróbuj ponownie.");
    }
    const { error: logError } = await service.from("mailing_campaign_approval_log").insert({
      campaign_id: campaign.id,
      action: "test_sent",
      actor_id: employee.id,
      metadata: { recipient: normalizedEmail, message_id: relayResult.messageId || null },
    });
    if (logError) throw new Error("Test wysłano, ale nie udało się zapisać śladu audytowego");

    return json({ status: "sent", recipient: normalizedEmail, messageId: relayResult.messageId || null });
  } catch (error) {
    console.error("[send-marketing-campaign-test]", error);
    return json({ error: error instanceof Error ? error.message : "Nie udało się wysłać testu" }, 500);
  }
});
