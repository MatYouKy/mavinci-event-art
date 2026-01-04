import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SendOfferEmailRequest {
  offerId: string;
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
    const { offerId, to, subject, message }: SendOfferEmailRequest = await req.json();

    if (!offerId || !to || !subject) {
      throw new Error("Missing required fields: offerId, to, subject");
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

    const { data: offer } = await supabase
      .from("offers")
      .select("*, organization:organizations(*), event:events(*)")
      .eq("id", offerId)
      .maybeSingle();

    if (!offer) {
      throw new Error("Offer not found");
    }

    const { data: employee } = await supabase
      .from("employees")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (!employee) {
      throw new Error("Employee not found");
    }

    const isAdmin = employee.permissions?.includes('admin');
    const isCreator = offer.created_by === user.id;

    if (!isAdmin && !isCreator) {
      throw new Error("Not authorized to send this offer");
    }

    let { data: emailAccount } = await supabase
      .from("employee_email_accounts")
      .select("*")
      .eq("employee_id", user.id)
      .eq("is_default", true)
      .maybeSingle();

    if (!emailAccount) {
      const { data: systemAccount } = await supabase
        .from("employee_email_accounts")
        .select("*")
        .eq("is_system_account", true)
        .maybeSingle();

      if (!systemAccount) {
        throw new Error("Nie masz skonfigurowanego domyślnego konta email. Skontaktuj się z administratorem lub skonfiguruj konto w ustawieniach.");
      }

      emailAccount = systemAccount;
    }

    const relayUrl = Deno.env.get("SMTP_RELAY_URL");
    const relaySecret = Deno.env.get("SMTP_RELAY_SECRET");

    if (!relayUrl || !relaySecret) {
      throw new Error("SMTP_RELAY_URL or SMTP_RELAY_SECRET not configured");
    }

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <p>${message.replace(/\n/g, '<br>')}</p>
        ${emailAccount.signature || ''}
      </div>
    `;

    const relayPayload = {
      smtpConfig: {
        host: emailAccount.smtp_host,
        port: emailAccount.smtp_port,
        username: emailAccount.smtp_username,
        password: emailAccount.smtp_password,
        from: emailAccount.email_address,
        fromName: emailAccount.from_name,
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

    await supabase.from("sent_emails").insert({
      employee_id: user.id,
      email_account_id: emailAccount.id,
      to_address: to,
      subject: subject,
      body: htmlBody,
      message_id: info.messageId,
      sent_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({
        success: true,
        messageId: info.messageId,
        message: "Offer email sent successfully"
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error sending offer email:", error);
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