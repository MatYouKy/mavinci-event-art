import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  useTls: boolean;
  from: string;
  fromName: string;
}

interface EmailRequest {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
  messageId?: string;
  emailAccountId?: string;
  smtpConfig?: SmtpConfig;
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
    const { to, subject, body, replyTo, messageId, emailAccountId, smtpConfig }: EmailRequest = await req.json();

    if (!to || !subject || !body) {
      throw new Error("Missing required fields: to, subject, body");
    }

    let smtpSettings: {
      host: string;
      port: number;
      username: string;
      password: string;
      useTls: boolean;
      from: string;
      fromName: string;
    };

    if (smtpConfig) {
      smtpSettings = smtpConfig;
    } else if (emailAccountId) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data: emailAccount, error: accountError } = await supabase
        .from("employee_email_accounts")
        .select("*")
        .eq("id", emailAccountId)
        .maybeSingle();

      if (accountError || !emailAccount) {
        throw new Error("Email account not found");
      }

      const account = emailAccount as EmailAccount;
      smtpSettings = {
        host: account.smtp_host,
        port: account.smtp_port,
        username: account.smtp_username,
        password: account.smtp_password,
        useTls: account.smtp_use_tls,
        from: account.email_address,
        fromName: account.from_name,
      };
    } else {
      throw new Error("Either emailAccountId or smtpConfig must be provided");
    }

    const nodemailer = await import("npm:nodemailer@6.9.7");

    const transporter = nodemailer.default.createTransport({
      host: smtpSettings.host,
      port: smtpSettings.port,
      secure: smtpSettings.port === 465,
      auth: {
        user: smtpSettings.username,
        pass: smtpSettings.password,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    const mailOptions: any = {
      from: `${smtpSettings.fromName} <${smtpSettings.from}>`,
      to: to,
      subject: subject,
      html: body,
    };

    if (replyTo) {
      mailOptions.replyTo = replyTo;
    }

    const info = await transporter.sendMail(mailOptions);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Zapisz wysłany email w bazie
    const authHeader = req.headers.get("Authorization");
    if (authHeader && emailAccountId) {
      const { data: { user } } = await supabase.auth.getUser(
        authHeader.replace("Bearer ", "")
      );

      if (user) {
        await supabase.from("sent_emails").insert({
          employee_id: user.id,
          email_account_id: emailAccountId,
          to_address: to,
          subject: subject,
          body: body,
          reply_to: replyTo,
          message_id: info.messageId,
          sent_at: new Date().toISOString(),
        });
      }
    }

    // Zaktualizuj status wiadomości kontaktowej jeśli to odpowiedź
    if (messageId && emailAccountId) {
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