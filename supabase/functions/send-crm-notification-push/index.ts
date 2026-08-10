import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface WebhookPayload {
  type: "INSERT";
  table: string;
  schema: string;
  record: {
    id: string;
    notification_id: string;
    user_id: string;
    is_read: boolean;
  };
  old_record: null;
}

function htmlToPlainText(value: string | null): string {
  if (!value) return "";
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const messageTypeLabels: Record<string, string> = {
  event_inquiry: "Zapytanie Event",
  contact_form: "Formularz kontaktowy",
  general: "Wiadomość ogólna",
  team_join: "Rekrutacja",
  portfolio: "Portfolio",
  services: "Zapytanie o usługi",
  quote_request: "Prośba o wycenę",
  inquiry: "Zapytanie",
  lead: "Nowy lead",
  order: "Nowe zamówienie",
  payment: "Płatność",
  registration: "Rejestracja",
  booking: "Rezerwacja",
  newsletter_signup: "Zapis do newslettera",
};

function humanizeMessageEnums(value: string): string {
  return value.replace(
    /\b(event_inquiry|contact_form|team_join|quote_request|newsletter_signup|general|portfolio|services|inquiry|lead|order|payment|registration|booking)\b/g,
    (match) => messageTypeLabels[match] || match,
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const payload: WebhookPayload = await req.json();
    const recipient = payload.record;

    if (!recipient || !recipient.notification_id || !recipient.user_id) {
      return new Response(
        JSON.stringify({ error: "Invalid payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Already read? Skip.
    if (recipient.is_read) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, reason: "already_read" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the notification details
    const { data: notification, error: notifError } = await supabase
      .from("notifications")
      .select("title, message, category, related_entity_type, related_entity_id, action_url, metadata")
      .eq("id", recipient.notification_id)
      .maybeSingle();

    if (notifError || !notification) {
      console.error("[crm-push] Notification fetch error:", notifError);
      return new Response(
        JSON.stringify({ error: "Notification not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get push tokens for this user
    const { data: tokens, error: tokensError } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("employee_id", recipient.user_id);

    if (tokensError) {
      throw new Error(`Error fetching tokens: ${tokensError.message}`);
    }

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, reason: "no_push_tokens" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build notification content
    let title = notification.title || "Mavinci CRM";
    let body = notification.message || "";

    // An email banner should explain what arrived, not only say that an email exists.
    if (
      notification.related_entity_type === "received_email" &&
      notification.related_entity_id
    ) {
      const { data: email } = await supabase
        .from("received_emails")
        .select("from_address, subject, body_text, body_html")
        .eq("id", notification.related_entity_id)
        .maybeSingle();

      if (email) {
        const preview = (email.body_text?.trim() || htmlToPlainText(email.body_html)).slice(0, 180);
        title = email.subject?.trim() || "Nowa wiadomość e-mail";
        body = preview
          ? `Od: ${email.from_address}\n${preview}${preview.length === 180 ? "…" : ""}`
          : `Od: ${email.from_address}`;
      }
    }

    if (
      notification.related_entity_type === "contact_messages" &&
      notification.related_entity_id
    ) {
      const { data: contactMessage } = await supabase
        .from("contact_messages")
        .select("name, email, subject, message")
        .eq("id", notification.related_entity_id)
        .maybeSingle();

      if (contactMessage) {
        const preview = (contactMessage.message || "").trim().slice(0, 180);
        title = contactMessage.subject?.trim() || "Nowa wiadomość z mavinci.pl";
        body = preview
          ? `Od: ${contactMessage.name} (${contactMessage.email})\n${preview}${preview.length === 180 ? "…" : ""}`
          : `Od: ${contactMessage.name} (${contactMessage.email})`;
      }
    }

    title = humanizeMessageEnums(title);
    body = humanizeMessageEnums(body);

    const data: Record<string, string> = {
      type: "crm_notification",
      notification_id: recipient.notification_id,
    };

    if (notification.related_entity_type) {
      data.entity_type = notification.related_entity_type;
    }
    if (notification.related_entity_id) {
      data.entity_id = notification.related_entity_id;
    }
    if (notification.category) {
      data.category = notification.category;
    }
    if (notification.action_url) {
      data.action_url = notification.action_url;
    }
    if (
      notification.metadata &&
      typeof notification.metadata === "object" &&
      typeof notification.metadata.inbound_event_id === "string"
    ) {
      data.inbound_event_id = notification.metadata.inbound_event_id;
    }

    // Build Expo push messages
    const messages = tokens.map((t: { token: string }) => ({
      to: t.token,
      sound: "default",
      title,
      body,
      data,
      priority: "high",
      channelId: "default",
    }));

    // Send to Expo push service
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[crm-push] Expo API error: ${response.status} - ${errText}`);
      return new Response(
        JSON.stringify({ error: `Expo API error: ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    let sent = 0;
    const invalidTokens: string[] = [];

    if (result.data) {
      for (let i = 0; i < result.data.length; i++) {
        const ticket = result.data[i];
        if (ticket.status === "ok") {
          sent++;
        } else if (
          ticket.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered"
        ) {
          invalidTokens.push(messages[i].to);
        }
      }
    }

    // Remove invalid tokens
    if (invalidTokens.length > 0) {
      await supabase.from("push_tokens").delete().in("token", invalidTokens);
    }

    return new Response(
      JSON.stringify({ success: true, sent, total_tokens: tokens.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[crm-push] Fatal error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
