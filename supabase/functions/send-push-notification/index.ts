import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PushPayload {
  employee_ids: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
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

    const payload: PushPayload = await req.json();

    if (
      !payload.employee_ids ||
      !Array.isArray(payload.employee_ids) ||
      payload.employee_ids.length === 0
    ) {
      return new Response(
        JSON.stringify({ error: "employee_ids array is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: tokens, error: tokensError } = await supabase
      .from("push_tokens")
      .select("token, employee_id")
      .in("employee_id", payload.employee_ids);

    if (tokensError) {
      throw new Error(`Error fetching tokens: ${tokensError.message}`);
    }

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No push tokens found" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const messages = tokens.map((t: { token: string; employee_id: string }) => ({
      to: t.token,
      sound: "default",
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      priority: "high",
      channelId: "default",
    }));

    const chunks = chunkArray(messages, 100);
    let totalSent = 0;
    const errors: string[] = [];

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
        errors.push(`Expo API error: ${response.status} - ${errText}`);
        continue;
      }

      const result = await response.json();

      if (result.data) {
        for (const ticket of result.data) {
          if (ticket.status === "ok") {
            totalSent++;
          } else if (ticket.status === "error") {
            errors.push(ticket.message ?? "Unknown push error");
            if (
              ticket.details?.error === "DeviceNotRegistered" &&
              ticket.details?.expoPushToken
            ) {
              await supabase
                .from("push_tokens")
                .delete()
                .eq("token", ticket.details.expoPushToken);
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: totalSent,
        total_tokens: tokens.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
