import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const REQUIRED_FIELDS = [
  "source_id",
  "event_type",
  "title",
  "external_event_id",
] as const;
const VALID_PRIORITIES = ["low", "normal", "high", "critical"];

const PRIORITY_TO_NOTIFICATION_TYPE: Record<string, string> = {
  low: "info",
  normal: "info",
  high: "warning",
  critical: "error",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const apiKey = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!apiKey) {
      return jsonResponse({ error: "Missing API key in Authorization header" }, 401);
    }

    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const missing = REQUIRED_FIELDS.filter(
      (f) => !payload[f] || typeof payload[f] !== "string" || !(payload[f] as string).trim(),
    );
    if (missing.length > 0) {
      return jsonResponse(
        { error: `Missing required fields: ${missing.join(", ")}` },
        400,
      );
    }

    const sourceSlug = (payload.source_id as string).trim();
    const eventType = (payload.event_type as string).trim();
    const title = (payload.title as string).trim();
    const externalEventId = (payload.external_event_id as string).trim();
    const body = typeof payload.body === "string" ? payload.body.trim() : null;
    const priority =
      typeof payload.priority === "string" &&
      VALID_PRIORITIES.includes(payload.priority)
        ? payload.priority
        : "normal";
    const detailUrl =
      typeof payload.detail_url === "string" ? payload.detail_url.trim() : null;
    const eventTime =
      typeof payload.event_time === "string" ? payload.event_time : null;
    const metadata =
      typeof payload.metadata === "object" && payload.metadata !== null
        ? payload.metadata
        : {};

    if (title.length > 500) {
      return jsonResponse({ error: "Title exceeds 500 characters" }, 400);
    }
    if (externalEventId.length > 255) {
      return jsonResponse({ error: "external_event_id exceeds 255 characters" }, 400);
    }
    if (eventTime && Number.isNaN(Date.parse(eventTime))) {
      return jsonResponse({ error: "event_time must be a valid ISO date" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: source, error: srcErr } = await supabase
      .from("webhook_sources")
      .select("id, name, slug, api_key_hash, is_active, allowed_event_types, default_notify_permissions")
      .eq("slug", sourceSlug)
      .maybeSingle();

    if (srcErr || !source) {
      return jsonResponse({ error: "Unknown source" }, 401);
    }

    if (!source.is_active) {
      return jsonResponse({ error: "Source is disabled" }, 403);
    }

    const incomingHash = await sha256Hex(apiKey);
    if (incomingHash !== source.api_key_hash) {
      return jsonResponse({ error: "Invalid API key" }, 401);
    }

    if (
      source.allowed_event_types &&
      source.allowed_event_types.length > 0 &&
      !source.allowed_event_types.includes(eventType)
    ) {
      return jsonResponse(
        {
          error: `Event type '${eventType}' is not allowed for this source`,
          allowed: source.allowed_event_types,
        },
        422,
      );
    }

    const { data: existing } = await supabase
      .from("inbound_events")
      .select("id, status, created_at")
      .eq("source_id", source.id)
      .eq("external_event_id", externalEventId)
      .maybeSingle();

    if (existing && existing.status !== "failed") {
      return jsonResponse(
        {
          status: "duplicate",
          message: "Event already received",
          event_id: existing.id,
          received_at: existing.created_at,
        },
        200,
      );
    }

    if (existing?.status === "failed") {
      const { error: deleteFailedEventError } = await supabase
        .from("inbound_events")
        .delete()
        .eq("id", existing.id);

      if (deleteFailedEventError) {
        console.error("Failed to prepare webhook retry:", deleteFailedEventError);
        return jsonResponse({ error: "Failed to retry event" }, 500);
      }
    }

    const { data: event, error: insertErr } = await supabase
      .from("inbound_events")
      .insert({
        source_id: source.id,
        external_event_id: externalEventId,
        event_type: eventType,
        title,
        body,
        priority,
        detail_url: detailUrl,
        event_time: eventTime,
        metadata,
        status: "received",
      })
      .select("id")
      .single();

    if (insertErr || !event) {
      console.error("Insert inbound_event failed:", insertErr);
      return jsonResponse({ error: "Failed to store event" }, 500);
    }

    let notificationId: string | null = null;
    try {
      const notifMessage = body
        ? `${body.slice(0, 300)}${body.length > 300 ? "..." : ""}`
        : `Zdarzenie typu "${eventType}" ze źródła "${source.name}"`;

      const { data: notif, error: notifErr } = await supabase
        .from("notifications")
        .insert({
          title,
          message: notifMessage,
          type: PRIORITY_TO_NOTIFICATION_TYPE[priority] || "info",
          category: "webhook",
          related_entity_type: "inbound_event",
          related_entity_id: event.id,
          action_url: detailUrl || `/crm/settings/webhooks`,
          metadata: {
            origin: "webhook",
            inbound_event_id: event.id,
            source_slug: source.slug,
            source_name: source.name,
            event_type: eventType,
            priority,
          },
        })
        .select("id")
        .single();

      if (notifErr || !notif) {
        throw new Error(`Insert notification failed: ${notifErr?.message ?? "unknown error"}`);
      }

      notificationId = notif.id;

      const configuredPermissions = source.default_notify_permissions as string[] | null;
      const perms = configuredPermissions && configuredPermissions.length > 0
        ? configuredPermissions
        : [
          "messages_view",
          "messages_manage",
        ];

      const { data: employees, error: employeesError } = await supabase
        .from("employees")
        .select("id, role, access_level, permissions")
        .eq("is_active", true);

      if (employeesError) {
        throw new Error(`Fetch recipients failed: ${employeesError.message}`);
      }

      const recipients = (employees ?? []).filter(
        (employee: {
          id: string;
          role: string | null;
          access_level: string | null;
          permissions: string[] | null;
        }) =>
          employee.role === "admin" ||
          employee.access_level === "admin" ||
          (employee.permissions?.some((permission) => perms.includes(permission)) ?? false),
      );

      if (recipients.length === 0) {
        throw new Error("No active notification recipients found");
      }

      const rows = recipients.map((recipient: { id: string }) => ({
        notification_id: notif.id,
        user_id: recipient.id,
      }));

      const { error: recipientsError } = await supabase
        .from("notification_recipients")
        .insert(rows);

      if (recipientsError) {
        throw new Error(`Insert notification recipients failed: ${recipientsError.message}`);
      }

      const { error: processedError } = await supabase
        .from("inbound_events")
        .update({
          status: "processed",
          notification_id: notificationId,
          processed_at: new Date().toISOString(),
        })
        .eq("id", event.id);

      if (processedError) {
        throw new Error(`Mark event as processed failed: ${processedError.message}`);
      }
    } catch (notifyErr) {
      console.error("Notification pipeline error:", notifyErr);
      if (notificationId) {
        await supabase.from("notifications").delete().eq("id", notificationId);
        notificationId = null;
      }
      await supabase
        .from("inbound_events")
        .update({ status: "failed" })
        .eq("id", event.id);

      return jsonResponse(
        {
          error: "Event stored but notification delivery failed",
          event_id: event.id,
        },
        500,
      );
    }

    return jsonResponse(
      {
        status: "accepted",
        event_id: event.id,
        notification_id: notificationId,
      },
      201,
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
