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
    conversation_id: string;
    sender_id: string;
    content: string;
    message_type: string;
    created_at: string;
  };
  old_record: null;
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
    const message = payload.record;

    if (!message || !message.conversation_id || !message.sender_id) {
      return new Response(
        JSON.stringify({ error: "Invalid payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get all participants except the sender
    const { data: participants, error: participantsError } = await supabase
      .from("employee_conversation_participants")
      .select("employee_id")
      .eq("conversation_id", message.conversation_id)
      .neq("employee_id", message.sender_id);

    if (participantsError) {
      throw new Error(`Error fetching participants: ${participantsError.message}`);
    }

    if (!participants || participants.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No other participants" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recipientIds = participants.map((p: { employee_id: string }) => p.employee_id);

    // Get push tokens for all recipients
    const { data: tokens, error: tokensError } = await supabase
      .from("push_tokens")
      .select("token, employee_id")
      .in("employee_id", recipientIds);

    if (tokensError) {
      throw new Error(`Error fetching tokens: ${tokensError.message}`);
    }

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No push tokens found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get sender name
    const { data: sender } = await supabase
      .from("employees")
      .select("name, surname, nickname")
      .eq("id", message.sender_id)
      .maybeSingle();

    let title = "Nowa wiadomość";
    if (sender) {
      title = sender.nickname || `${sender.name} ${sender.surname}`;
    }

    // Check if it's a group conversation - use conversation name if available
    const { data: conversation } = await supabase
      .from("employee_conversations")
      .select("name, is_group")
      .eq("id", message.conversation_id)
      .maybeSingle();

    if (conversation?.is_group && conversation?.name) {
      title = `${conversation.name} • ${sender?.nickname || sender?.name || ""}`;
    }

    // Truncate body to 150 chars
    const body = message.content.length > 150
      ? message.content.slice(0, 150) + "..."
      : message.content;

    // Build Expo push messages
    const messages = tokens.map((t: { token: string; employee_id: string }) => ({
      to: t.token,
      sound: "default",
      title,
      body,
      data: {
        type: "chat_message",
        conversation_id: message.conversation_id,
        message_id: message.id,
        sender_id: message.sender_id,
      },
      priority: "high",
      channelId: "default",
    }));

    // Send in chunks of 100
    const chunks = chunkArray(messages, 100);
    let totalSent = 0;
    const invalidTokens: string[] = [];

    for (const chunk of chunks) {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Expo API error: ${response.status} - ${errText}`);
        continue;
      }

      const result = await response.json();

      if (result.data) {
        for (let i = 0; i < result.data.length; i++) {
          const ticket = result.data[i];
          if (ticket.status === "ok") {
            totalSent++;
          } else if (ticket.status === "error") {
            console.error(`Push error: ${ticket.message}`);
            if (ticket.details?.error === "DeviceNotRegistered") {
              invalidTokens.push(chunk[i].to);
            }
          }
        }
      }
    }

    // Remove invalid tokens
    if (invalidTokens.length > 0) {
      await supabase
        .from("push_tokens")
        .delete()
        .in("token", invalidTokens);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: totalSent,
        total_tokens: tokens.length,
        invalid_removed: invalidTokens.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("send-chat-push error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
