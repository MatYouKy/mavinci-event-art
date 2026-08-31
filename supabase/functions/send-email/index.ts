import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { prepareInlineEmailImages } from "../_shared/emailInlineImages.ts";
import type { RelayEmailAttachment } from "../_shared/emailInlineImages.ts";

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
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  replyTo?: string;
  inReplyTo?: string;
  references?: string[];
  messageId?: string;
  emailAccountId?: string;
  smtpConfig?: SmtpConfig;
  attachments?: RelayEmailAttachment[];
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

    const requestBody = await req.json();

    const {
      to,
      cc,
      bcc,
      subject,
      body,
      replyTo,
      inReplyTo,
      references,
      messageId,
      emailAccountId,
      smtpConfig,
      attachments,
    }: EmailRequest = requestBody;

    if (!to || !subject || !body) {
      console.error('[send-email] Missing fields:', { to: !!to, subject: !!subject, body: !!body });
      throw new Error("Missing required fields: to, subject, body");
    }

    console.log('[send-email] Sending to:', to);
    

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

    console.log('[send-email] SMTP settings:', {
      host: smtpSettings.host,
      port: smtpSettings.port,
      username: smtpSettings.username,
    });

    const relayUrl = Deno.env.get("SMTP_RELAY_URL");
    const relaySecret = Deno.env.get("SMTP_RELAY_SECRET");

    if (!relayUrl || !relaySecret) {
      throw new Error("SMTP_RELAY_URL or SMTP_RELAY_SECRET not configured");
    }

    console.log('[send-email] Using SMTP relay:', relayUrl);

    const preparedEmail = prepareInlineEmailImages(body, attachments ?? []);

    const relayPayload = {
      smtpConfig: smtpSettings,
      to,
      cc,
      bcc,
      subject,
      body: preparedEmail.html,
      replyTo,
      inReplyTo,
      references,
      attachments: preparedEmail.attachments,
    };

    console.log('[send-email] Sending request to relay with attachments count:', attachments?.length || 0);

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

    console.log('[send-email] Email sent successfully via relay. MessageId:', info.messageId);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let persistedSentEmailId: string | null = null;

    if (emailAccountId) {
      let employeeId: string | null = null;

      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        try {
          const { data: { user } } = await supabase.auth.getUser(
            authHeader.replace("Bearer ", "")
          );
          if (user) employeeId = user.id;
        } catch (e) {
          console.warn('[send-email] Could not resolve user from auth header:', e);
        }
      }

      if (!employeeId) {
        const { data: accountRow } = await supabase
          .from("employee_email_accounts")
          .select("employee_id")
          .eq("id", emailAccountId)
          .maybeSingle();
        if (accountRow?.employee_id) employeeId = accountRow.employee_id;
      }

      if (employeeId) {
        const { data: sentEmail, error: insertError } = await supabase
          .from("sent_emails")
          .insert({
            employee_id: employeeId,
            email_account_id: emailAccountId,
            to_address: to,
            subject: subject,
            // Do CRM zapisujemy wersję z obrazami data URI. Wersja CID jest
            // przeznaczona wyłącznie dla transportu SMTP i bez części MIME nie
            // nadaje się do późniejszego podglądu w folderze „Wysłane”.
            body,
            reply_to: replyTo,
            in_reply_to: inReplyTo || null,
            email_references: references || [],
            message_id: info.messageId,
            sent_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (insertError) {
          console.error('[send-email] Failed to insert sent_emails record:', insertError);
        } else {
          persistedSentEmailId = sentEmail.id;
        }
      } else {
        console.warn('[send-email] No employee_id resolved; skipping sent_emails persistence');
      }
    }

    if (persistedSentEmailId && attachments?.length) {
      for (const attachment of attachments) {
        try {
          const encoded = attachment.content.includes(",")
            ? attachment.content.split(",").pop() || ""
            : attachment.content;
          const binary = atob(encoded);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
          }

          const safeFilename = attachment.filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
          const storagePath = `sent/${persistedSentEmailId}/${crypto.randomUUID()}-${safeFilename}`;
          const contentType = attachment.contentType || "application/octet-stream";
          const { error: uploadError } = await supabase.storage
            .from("email-attachments")
            .upload(storagePath, bytes, { contentType, upsert: false });
          if (uploadError) throw uploadError;

          const { error: attachmentError } = await supabase.from("email_attachments").insert({
            email_id: persistedSentEmailId,
            email_type: "sent",
            filename: attachment.filename,
            content_type: contentType,
            size_bytes: bytes.byteLength,
            storage_path: storagePath,
          });
          if (attachmentError) {
            await supabase.storage.from("email-attachments").remove([storagePath]);
            throw attachmentError;
          }
        } catch (attachmentError) {
          console.error("[send-email] Failed to persist attachment:", attachment.filename, attachmentError);
        }
      }
    }

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
        message: "Email sent successfully",
        sentEmailId: persistedSentEmailId
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
