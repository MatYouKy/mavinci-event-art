import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SendInvoiceEmailRequest {
  invoiceId: string;
  to: string;
  subject: string;
  message: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { invoiceId, to, subject, message }: SendInvoiceEmailRequest = await req.json();

    if (!invoiceId || !to || !subject) {
      throw new Error("Missing required fields: invoiceId, to, subject");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: { user } } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (!user) {
      throw new Error("Unauthorized");
    }

    const { data: invoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();

    if (!invoice) {
      throw new Error("Invoice not found");
    }

    const { data: systemConfig } = await supabase
      .from("system_email_config")
      .select("*")
      .eq("config_key", "system")
      .eq("is_active", true)
      .maybeSingle();

    if (!systemConfig) {
      throw new Error("System email configuration not found or inactive");
    }

    if (!systemConfig.smtp_password) {
      throw new Error("System email password not configured. Please set SYSTEM_EMAIL_PASSWORD environment variable.");
    }

    const relayUrl = Deno.env.get("SMTP_RELAY_URL");
    const relaySecret = Deno.env.get("SMTP_RELAY_SECRET");

    if (!relayUrl || !relaySecret) {
      throw new Error("SMTP_RELAY_URL or SMTP_RELAY_SECRET not configured");
    }

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <p>${message.replace(/\n/g, '<br>')}</p>
        ${systemConfig.signature || ''}
      </div>
    `;

    const relayPayload = {
      smtpConfig: {
        host: systemConfig.smtp_host,
        port: systemConfig.smtp_port,
        username: systemConfig.smtp_username,
        password: systemConfig.smtp_password,
        from: systemConfig.from_email,
        fromName: systemConfig.from_name,
      },
      to,
      subject,
      body: htmlBody,
    };

    const relayResponse = await fetch(`${relayUrl}/api/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${relaySecret}`,
      },
      body: JSON.stringify(relayPayload),
    });

    if (!relayResponse.ok) {
      const errorData = await relayResponse.json();
      throw new Error(`Relay error: ${errorData.error || 'Unknown error'}`);
    }

    const relayResult = await relayResponse.json();
    const info = { messageId: relayResult.messageId };

    return new Response(
      JSON.stringify({
        success: true,
        messageId: info.messageId,
        message: "Invoice email sent successfully"
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error sending invoice email:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
