import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const hash = async (value: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = request.headers.get("Authorization") || "";
    const auth = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: authData } = await auth.auth.getUser();
    if (!authData.user) return json({ error: "Unauthorized" }, 401);

    const service = createClient(url, serviceKey);
    const { data: employee } = await service.from("employees")
      .select("id, role, access_level, permissions")
      .or(`auth_user_id.eq.${authData.user.id},id.eq.${authData.user.id}`).limit(1).maybeSingle();
    const permissions: string[] = Array.isArray(employee?.permissions) ? employee.permissions : [];
    const mayManage = employee && (
      employee.role === "admin" || employee.access_level === "admin" ||
      permissions.includes("events_manage") || permissions.includes("subcontractors_manage")
    );
    if (!mayManage) return json({ error: "Forbidden" }, 403);

    const { taskId } = await request.json();
    if (!taskId) return json({ error: "taskId is required" }, 400);
    const { data: task, error } = await service.from("subcontractor_tasks").select(`
      id, task_name, scope_of_work, description, deliverables, guidelines,
      scheduled_start, scheduled_end, contact_name_snapshot, contact_email_snapshot,
      subcontractors(company_name, contact_person, email),
      events(id, name, event_date, event_end_date)
    `).eq("id", taskId).maybeSingle();
    if (error || !task) return json({ error: "Subcontractor order not found" }, 404);

    const provider = Array.isArray(task.subcontractors) ? task.subcontractors[0] : task.subcontractors;
    const event = Array.isArray(task.events) ? task.events[0] : task.events;
    const recipient = task.contact_email_snapshot || provider?.email;
    if (!recipient) return json({ error: "Subcontractor email is missing" }, 400);

    const token = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
    const expiresAt = new Date(Date.now() + 30 * 86400000);
    const appUrl = (Deno.env.get("PUBLIC_APP_URL") || "https://mavinci.pl").replace(/\/$/, "");
    const confirmationUrl = `${appUrl}/subcontractor-confirmation?token=${encodeURIComponent(token)}`;
    const format = (value?: string | null) => value
      ? new Date(value).toLocaleString("pl-PL", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Warsaw" })
      : "do ustalenia";
    const startsAt = task.scheduled_start || event?.event_date;
    const endsAt = task.scheduled_end || event?.event_end_date;
    const body = `<!doctype html><html><body style="margin:0;background:#f3f1eb;font-family:Arial,sans-serif;color:#1c1f33">
      <table role="presentation" width="100%"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="640" style="max-width:640px;width:100%;background:#fff;border-radius:14px">
      <tr><td style="background:#1c1f33;padding:24px 30px;color:#d3bb73;font-size:20px;font-weight:bold">MAVINCI · Wytyczne realizacji</td></tr><tr><td style="padding:30px">
      <p>Dzień dobry ${escapeHtml(task.contact_name_snapshot || provider?.contact_person || provider?.company_name || "")},</p>
      <p>prosimy o potwierdzenie przyjęcia wytycznych do wydarzenia <strong>${escapeHtml(event?.name || "")}</strong>.</p>
      <p><strong>Zlecenie:</strong> ${escapeHtml(task.task_name)}<br><strong>Od:</strong> ${escapeHtml(format(startsAt))}<br><strong>Do:</strong> ${escapeHtml(format(endsAt))}</p>
      <h3>Zakres obowiązków</h3><p style="white-space:pre-line">${escapeHtml(task.scope_of_work || task.description || "Brak dodatkowego opisu")}</p>
      ${task.deliverables ? `<h3>Oczekiwany rezultat</h3><p style="white-space:pre-line">${escapeHtml(task.deliverables)}</p>` : ""}
      ${task.guidelines ? `<h3>Wytyczne organizacyjne</h3><p style="white-space:pre-line">${escapeHtml(task.guidelines)}</p>` : ""}
      <p style="text-align:center;margin:28px 0"><a href="${confirmationUrl}" style="display:inline-block;background:#d3bb73;color:#1c1f33;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:bold">Potwierdź lub zgłoś problem</a></p>
      <p style="font-size:12px;color:#6b7280">Indywidualny link jest ważny przez 30 dni.</p></td></tr></table></td></tr></table></body></html>`;

    const { data: account } = await service.from("employee_email_accounts").select("id")
      .eq("is_system_account", true).eq("is_active", true).limit(1).maybeSingle();
    if (!account) return json({ error: "System email account is not configured" }, 409);
    const relay = await fetch(`${url}/functions/v1/send-email`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        to: recipient,
        subject: `Wytyczne: ${task.task_name} · ${event?.name || "wydarzenie"}`,
        body, emailAccountId: account.id,
      }),
    });
    if (!relay.ok) throw new Error(`Email relay returned ${relay.status}`);

    const { error: updateError } = await service.from("subcontractor_tasks").update({
      confirmation_token_hash: await hash(token), confirmation_expires_at: expiresAt.toISOString(),
      guidelines_status: "sent", guidelines_sent_at: new Date().toISOString(),
      declined_at: null, response_note: null,
    }).eq("id", taskId);
    if (updateError) throw updateError;
    return json({ success: true });
  } catch (error) {
    console.error("send-subcontractor-assignment", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
