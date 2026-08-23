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

type NotificationRecipient = WebhookPayload["record"];

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
    const requestedRecipient = payload.record;

    if (!requestedRecipient?.id) {
      return new Response(
        JSON.stringify({ error: "Invalid payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Never trust recipient/user identifiers supplied by the HTTP caller. The
    // unguessable row id is resolved against the database and all push content
    // is built from canonical CRM records.
    const { data: canonicalRecipient, error: recipientError } = await supabase
      .from("notification_recipients")
      .select("id, notification_id, user_id, is_read")
      .eq("id", requestedRecipient.id)
      .maybeSingle();

    if (recipientError || !canonicalRecipient) {
      return new Response(
        JSON.stringify({ error: "Notification recipient not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recipient = canonicalRecipient as NotificationRecipient;

    if (
      (requestedRecipient.notification_id &&
        requestedRecipient.notification_id !== recipient.notification_id) ||
      (requestedRecipient.user_id && requestedRecipient.user_id !== recipient.user_id)
    ) {
      return new Response(
        JSON.stringify({ error: "Recipient payload mismatch" }),
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

    // Claim delivery before any external request. A database trigger and a
    // legacy explicit caller may arrive at the same time; only one can win.
    const { error: claimError } = await supabase
      .from("notification_push_deliveries")
      .insert({
        notification_recipient_id: recipient.id,
        status: "processing",
        attempt_count: 1,
      });

    if (claimError?.code === "23505") {
      return new Response(
        JSON.stringify({ success: true, sent: 0, reason: "already_dispatched" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (claimError) {
      throw new Error(`Unable to claim push delivery: ${claimError.message}`);
    }

    const updateDelivery = async (
      status: "sent" | "skipped" | "failed",
      lastError: string | null = null,
    ) => {
      await supabase
        .from("notification_push_deliveries")
        .update({
          status,
          last_error: lastError,
          sent_at: status === "sent" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("notification_recipient_id", recipient.id);
    };

    // Get the notification details
    const { data: notification, error: notifError } = await supabase
      .from("notifications")
      .select("title, message, category, related_entity_type, related_entity_id, action_url, metadata")
      .eq("id", recipient.notification_id)
      .maybeSingle();

    if (notifError || !notification) {
      console.error("[crm-push] Notification fetch error:", notifError);
      await updateDelivery("failed", "Notification not found");
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
      await updateDelivery("skipped", "No registered push tokens");
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

    const metadata =
      notification.metadata && typeof notification.metadata === "object"
        ? notification.metadata as Record<string, unknown>
        : null;
    const invitationAssignmentId =
      typeof metadata?.assignment_id === "string" ? metadata.assignment_id : "";
    const isEventInvitation =
      invitationAssignmentId.length > 0 && metadata?.requires_response === true;
    const isInquiryFollowup = metadata?.kind === "inquiry_followup";
    const isInquiryActionable = isInquiryFollowup && metadata?.actionable === true;

    if (isInquiryFollowup) {
      data.type = "inquiry_reminder";
    }

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
      metadata &&
      typeof metadata.inbound_event_id === "string"
    ) {
      data.inbound_event_id = metadata.inbound_event_id;
    }
    if (
      metadata &&
      typeof metadata.initial_tab === "string"
    ) {
      data.initial_tab = metadata.initial_tab;
    }
    if (invitationAssignmentId) {
      data.assignment_id = invitationAssignmentId;
      data.requires_response = String(metadata?.requires_response === true);
    }
    if (typeof metadata?.event_id === "string") {
      data.event_id = metadata.event_id;
    }
    if (typeof metadata?.inquiry_id === "string") {
      data.entity_id = metadata.inquiry_id;
      data.entity_type = "inquiry";
      data.inquiry_id = metadata.inquiry_id;
    }
    if (typeof metadata?.followup_kind === "string") {
      data.followup_kind = metadata.followup_kind;
    }

    // Build Expo push messages
    const messages = tokens.map((t: { token: string }) => ({
      to: t.token,
      sound: "default",
      title,
      body,
      data,
      categoryId: isEventInvitation
        ? "event_invitation"
        : isInquiryActionable
          ? "inquiry_followup"
          : undefined,
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
      await updateDelivery("failed", `Expo API error: ${response.status}`);
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

    if (sent > 0) {
      await updateDelivery("sent");
    } else {
      await updateDelivery("failed", "Expo did not accept any push ticket");
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
