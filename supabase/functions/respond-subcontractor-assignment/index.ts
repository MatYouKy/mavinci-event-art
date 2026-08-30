import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const hash = async (value: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const { token, action = "details", name, note } = await request.json();
    if (!token) return reply({ error: "Token is required" }, 400);
    if (!["details", "confirm", "decline"].includes(action)) return reply({ error: "Invalid action" }, 400);

    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: task, error } = await client.from("subcontractor_tasks").select(`
      id, task_name, scope_of_work, deliverables, guidelines, scheduled_start, scheduled_end,
      guidelines_status, confirmation_expires_at, confirmed_at, declined_at,
      subcontractors(company_name), events(name, event_date, event_end_date)
    `).eq("confirmation_token_hash", await hash(token)).maybeSingle();
    if (error || !task) return reply({ error: "Link jest nieprawidłowy" }, 404);
    if (task.confirmation_expires_at && new Date(task.confirmation_expires_at) < new Date()) {
      if (task.guidelines_status === "sent") {
        await client.from("subcontractor_tasks").update({ guidelines_status: "expired" }).eq("id", task.id);
      }
      return reply({ error: "Link wygasł. Poproś opiekuna wydarzenia o ponowne wysłanie." }, 410);
    }

    const event = Array.isArray(task.events) ? task.events[0] : task.events;
    const provider = Array.isArray(task.subcontractors) ? task.subcontractors[0] : task.subcontractors;
    const safeDetails = {
      taskName: task.task_name,
      eventName: event?.name,
      providerName: provider?.company_name,
      startsAt: task.scheduled_start || event?.event_date,
      endsAt: task.scheduled_end || event?.event_end_date,
      scopeOfWork: task.scope_of_work,
      deliverables: task.deliverables,
      guidelines: task.guidelines,
      status: task.guidelines_status,
    };
    if (action === "details") return reply(safeDetails);

    const now = new Date().toISOString();
    const patch = action === "confirm"
      ? { guidelines_status: "confirmed", confirmed_at: now, declined_at: null, confirmed_by_name: name || null, response_note: note || null }
      : { guidelines_status: "declined", declined_at: now, confirmed_at: null, confirmed_by_name: name || null, response_note: note || null };
    const { error: updateError } = await client.from("subcontractor_tasks").update(patch).eq("id", task.id);
    if (updateError) throw updateError;
    return reply({ ...safeDetails, status: patch.guidelines_status });
  } catch (error) {
    console.error("respond-subcontractor-assignment", error);
    return reply({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
