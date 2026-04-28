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
  signatureHtml?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { offerId, to, subject, message, signatureHtml }: SendOfferEmailRequest = await req.json();

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

    console.log('[send-offer-email] Generating PDF for offer:', offerId);
    let pdfDownloadUrl = '';

    try {
      const pdfResponse = await fetch(`${supabaseUrl}/functions/v1/generate-offer-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify({
          offerId: offerId,
          employeeId: user.id,
        }),
      });

      if (pdfResponse.ok) {
        const pdfResult = await pdfResponse.json();
        if (pdfResult.success && pdfResult.fileName) {
          const { data: signedUrlData } = await supabase.storage
            .from('generated-offers')
            .createSignedUrl(pdfResult.fileName, 60 * 60 * 24 * 7);
          if (signedUrlData?.signedUrl) {
            pdfDownloadUrl = signedUrlData.signedUrl;
          }
        }
      } else {
        const errorText = await pdfResponse.text();
        console.error('[send-offer-email] PDF generation failed:', errorText);
      }
    } catch (pdfError) {
      console.error('[send-offer-email] Error generating PDF:', pdfError);
    }

    if (!pdfDownloadUrl && offer.generated_pdf_url) {
      const { data: signedUrlData } = await supabase.storage
        .from('generated-offers')
        .createSignedUrl(offer.generated_pdf_url, 60 * 60 * 24 * 7);
      if (signedUrlData?.signedUrl) {
        pdfDownloadUrl = signedUrlData.signedUrl;
      }
    }

    const pdfLinkHtml = pdfDownloadUrl
      ? `
        <div style="margin: 24px 0; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #f9f9f9;">
          <p style="margin: 0 0 12px 0; font-size: 14px; color: #555;">Oferta do pobrania:</p>
          <a href="${pdfDownloadUrl}" target="_blank" style="display: inline-block; padding: 12px 24px; background-color: #d3bb73; color: #1c1f33; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">Pobierz ofertę PDF</a>
          <p style="margin: 12px 0 0 0; font-size: 12px; color: #999;">Link jest ważny przez 7 dni.</p>
        </div>
      `
      : '';

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <p>${message.replace(/\n/g, '<br>')}</p>
        ${pdfLinkHtml}
        ${signatureHtml || emailAccount.signature || ''}
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