import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface EmailRequest {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  messageId?: string;
  emailAccountId: string;
}

interface EmailAccount {
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_use_tls: boolean;
  email_address: string;
  from_name: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const { to, subject, body, replyTo, messageId, emailAccountId }: EmailRequest = await req.json();

    if (!to || !subject || !body || !emailAccountId) {
      throw new Error("Missing required fields");
    }

    const { data: emailAccount, error: accountError } = await supabase
      .from("employee_email_accounts")
      .select("*")
      .eq("id", emailAccountId)
      .maybeSingle();

    if (accountError || !emailAccount) {
      throw new Error("Email account not found");
    }

    const account = emailAccount as EmailAccount;

    // Use nodemailer through npm
    const nodemailer = await import("npm:nodemailer@6.9.7");

    const transporter = nodemailer.default.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_use_tls,
      auth: {
        user: account.smtp_username,
        pass: account.smtp_password,
      },
    });

    const mailOptions: any = {
      from: `${account.from_name} <${account.email_address}>`,
      to: to,
      subject: subject,
      html: body,
    };

    if (replyTo) {
      mailOptions.replyTo = replyTo;
    }

    const info = await transporter.sendMail(mailOptions);

    if (messageId) {
      await supabase
        .from("contact_messages")
        .update({ 
          status: "replied",
          replied_at: new Date().toISOString()
        })
        .eq("id", messageId);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        messageId: info.messageId,
        message: "Email sent successfully"
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error sending email:", error);
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
