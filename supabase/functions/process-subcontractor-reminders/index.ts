import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Definicje lokalne: ta funkcja musi dać się wdrożyć z samego index.ts
// w edytorze Supabase (bez dostępu do katalogu ../_shared).
const EMAIL_BRAND = {
  background: "#1b0710",
  surface: "#351020",
  panel: "#46172b",
  gold: "#d3bb73",
  text: "#f3e9ed",
  cream: "#faf6f7",
} as const;

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
  const expected = Deno.env.get("SUBCONTRACTOR_REMINDER_SECRET") || "";
  if (!expected || request.headers.get("X-Subcontractor-Reminder-Secret") !== expected) {
    return response({ error: "Unauthorized" }, 401);
  }
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const client = createClient(url, serviceKey);
    const now = Date.now();
    const from = new Date(now + 12 * 60 * 60 * 1000).toISOString();
    const to = new Date(now + 8 * 24 * 60 * 60 * 1000).toISOString();
    const { data: tasks, error } = await client.from("subcontractor_tasks").select(`
      id, task_name, scheduled_start, guidelines_status, reminder_week_sent_at,
      reminder_day_sent_at, contact_name_snapshot, contact_email_snapshot,
      subcontractors(company_name, contact_person, email), events(name)
    `).eq("guidelines_status", "confirmed").neq("status", "cancelled")
      .gte("scheduled_start", from).lte("scheduled_start", to);
    if (error) throw error;

    const { data: account } = await client.from("employee_email_accounts").select("id")
      .eq("is_system_account", true).eq("is_active", true).limit(1).maybeSingle();
    if (!account) return response({ error: "System email account is not configured" }, 409);

    let sent = 0;
    for (const task of tasks || []) {
      const start = new Date(task.scheduled_start).getTime();
      const days = (start - now) / 86400000;
      const kind = days >= 6 && days <= 8 && !task.reminder_week_sent_at
        ? "week"
        : days >= 0.5 && days <= 1.5 && !task.reminder_day_sent_at
          ? "day"
          : null;
      if (!kind) continue;
      const provider = Array.isArray(task.subcontractors) ? task.subcontractors[0] : task.subcontractors;
      const event = Array.isArray(task.events) ? task.events[0] : task.events;
      const recipient = task.contact_email_snapshot || provider?.email;
      if (!recipient) continue;
      const when = new Date(task.scheduled_start).toLocaleString("pl-PL", {
        dateStyle: "long", timeStyle: "short", timeZone: "Europe/Warsaw",
      });
      const body = `<div style="font-family:Arial,sans-serif;color:${EMAIL_BRAND.surface};max-width:620px;margin:auto">
        <h2 style="background:${EMAIL_BRAND.surface};color:#d3bb73;padding:22px">Przypomnienie o realizacji</h2>
        <p>Dzień dobry ${escapeHtml(task.contact_name_snapshot || provider?.contact_person || provider?.company_name || "")},</p>
        <p>${kind === "week" ? "Za tydzień" : "Jutro"} realizujesz zlecenie <strong>${escapeHtml(task.task_name)}</strong> podczas wydarzenia <strong>${escapeHtml(event?.name || "")}</strong>.</p>
        <p><strong>Termin rozpoczęcia:</strong> ${escapeHtml(when)}</p>
        <p>Jeżeli pojawiła się przeszkoda, skontaktuj się niezwłocznie z opiekunem wydarzenia.</p>
      </div>`;
      const relay = await fetch(`${url}/functions/v1/send-email`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          to: recipient,
          subject: `${kind === "week" ? "Za tydzień" : "Jutro"}: ${task.task_name}`,
          body, emailAccountId: account.id,
        }),
      });
      if (!relay.ok) continue;
      await client.from("subcontractor_tasks").update(
        kind === "week"
          ? { reminder_week_sent_at: new Date().toISOString() }
          : { reminder_day_sent_at: new Date().toISOString() },
      ).eq("id", task.id);
      sent += 1;
    }
    return response({ success: true, scanned: tasks?.length || 0, sent });
  } catch (error) {
    console.error("process-subcontractor-reminders", error);
    return response({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
