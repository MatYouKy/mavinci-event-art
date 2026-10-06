import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { prepareInlineEmailImages } from "../_shared/emailInlineImages.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface Attachment {
  filename: string;
  content: string;
  contentType: string;
  contentDisposition?: "attachment" | "inline";
  cid?: string;
}

interface SendInvoiceEmailRequest {
  invoiceId: string;
  emailAccountId?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  message: string;
  messageHtml?: string;
  attachments?: Attachment[];
  signatureHtml?: string;
  recipientName?: string;
}

const DEFAULT_EMAIL_BODY_TEMPLATE = `<div style="font-family: 'Helvetica Neue', Arial, sans-serif; background: #f5f5f5; padding: 24px 0; color: #1c1f33;">
  <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
    <div style="background: {{brand_primary_color}}; padding: 24px; text-align: center;">
      <img src="{{company_logo}}" alt="{{company_name}}" height="48" style="display: inline-block; max-height: 48px;" />
    </div>
    <div style="padding: 32px 28px; font-size: 14px; line-height: 1.6; color: #1c1f33;">
      <div style="white-space: pre-wrap;">{{content}}</div>
      {{pdf_link}}
    </div>
    <div style="padding: 24px 28px; border-top: 1px solid #ececec;">
      {{signature}}
    </div>
  </div>
  <div style="max-width: 640px; margin: 12px auto 0; text-align: center; font-size: 11px; color: #888;">
    Wiadomość wysłana z {{company_name}}
  </div>
</div>`;

const renderTemplate = (template: string, values: Record<string, string>): string => {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    const re = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    out = out.replace(re, value ?? "");
  }
  return out;
};

const hasTemplatePlaceholder = (template: string, key: string): boolean =>
  new RegExp(`{{\\s*${key}\\s*}}`, "i").test(template || "");

const normalizeMessageText = (value: string): string =>
  (value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

const fetchAsDataUri = async (url: string): Promise<string> => {
  if (!url || url.startsWith("data:")) return url;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return url;
    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const mime = resp.headers.get("content-type") || "image/png";
    return `data:${mime};base64,${base64}`;
  } catch {
    return url;
  }
};

const toPublicLogoUrl = (value: string | null | undefined, supabaseUrl: string): string => {
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  return `${supabaseUrl}/storage/v1/object/public/company-logos/${value.replace(/^\/+/, "")}`;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Niedozwolona metoda." }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const {
      invoiceId,
      emailAccountId,
      to,
      cc,
      bcc,
      subject,
      message = "",
      messageHtml,
      attachments = [],
      signatureHtml,
      recipientName,
    }: SendInvoiceEmailRequest = await req.json();

    if (!invoiceId || !to || !subject) {
      throw new Error("Missing required fields: invoiceId, to, subject");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ success: false, error: "Nieprawidłowa sesja." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Check the invoice in the caller's authenticated scope before service-role
    // reads. A valid login alone does not authorize sending another seller's PDF.
    const { data: canManageInvoice, error: invoiceAccessError } = await userClient.rpc("can_manage_invoice", {
      p_invoice_id: invoiceId,
    });
    if (invoiceAccessError || canManageInvoice !== true) {
      return new Response(JSON.stringify({ success: false, error: "Brak uprawnień do wysłania tej faktury." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const { data: invoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();

    if (!invoice) {
      throw new Error("Invoice not found");
    }

    const { data: employee } = await supabase
      .from("employees")
      .select("*")
      .or(`id.eq.${user.id},auth_user_id.eq.${user.id}`)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!employee) throw new Error("Employee not found");

    let emailAccount: any = null;
    if (emailAccountId) {
      const { data: requestedAccount } = await supabase
        .from("employee_email_accounts")
        .select("*")
        .eq("id", emailAccountId)
        .eq("is_active", true)
        .or("account_type.is.null,account_type.neq.system")
        .maybeSingle();

      if (requestedAccount) {
        const isPersonal = requestedAccount.employee_id === employee.id;
        let isAssigned = false;
        if (!isPersonal) {
          const { data: assignment } = await supabase
            .from("employee_email_account_assignments")
            .select("id")
            .eq("employee_id", employee.id)
            .eq("email_account_id", requestedAccount.id)
            .eq("can_send", true)
            .maybeSingle();
          isAssigned = Boolean(assignment);
        }
        if (isPersonal || isAssigned) emailAccount = requestedAccount;
      }
    }

    if (!emailAccount) {
      const { data: anyOwnAccounts } = await supabase
        .from("employee_email_accounts")
        .select("*")
        .eq("employee_id", employee.id)
        .eq("is_active", true)
        .or("account_type.is.null,account_type.neq.system")
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1);

      if (!anyOwnAccounts?.[0]) {
        throw new Error("Nie masz skonfigurowanego konta email. Skonfiguruj swoje konto w ustawieniach.");
      }

      emailAccount = anyOwnAccounts[0];
    }

    const relayUrl = Deno.env.get("SMTP_RELAY_URL");
    const relaySecret = Deno.env.get("SMTP_RELAY_SECRET");

    if (!relayUrl || !relaySecret) {
      throw new Error("SMTP_RELAY_URL or SMTP_RELAY_SECRET not configured");
    }

    const { data: companies } = await supabase
      .from("my_companies")
      .select("*")
      .eq("is_active", true)
      .eq("id", invoice.my_company_id)
      .limit(1);

    let company = companies?.[0] ?? null;

    if (!company) {
      // Fallback: try to get company from event
      if (invoice.event_id) {
        const { data: evt } = await supabase
          .from("events")
          .select("my_company_id")
          .eq("id", invoice.event_id)
          .maybeSingle();
        if (evt?.my_company_id) {
          const { data: evtCompanies } = await supabase
            .from("my_companies")
            .select("*")
            .eq("is_active", true)
            .eq("id", evt.my_company_id)
            .limit(1);
          company = evtCompanies?.[0] ?? null;
        }
      }
      // Final fallback: default company
      if (!company) {
        const { data: defaultCompanies } = await supabase
          .from("my_companies")
          .select("*")
          .eq("is_active", true)
          .order("is_default", { ascending: false })
          .limit(1);
        company = defaultCompanies?.[0] ?? null;
      }
    }

    let companyLogoDataUri = "";
    let primaryColor = "#d3bb73";
    let secondaryColor = "#d3bb73";
    let accentColor = "#d3bb73";
    let useBodyTemplate = false;
    let bodyTemplate = DEFAULT_EMAIL_BODY_TEMPLATE;

    if (company) {
      const { data: assignmentRows } = await supabase
        .from("email_body_template_assignments")
        .select("purpose, template:email_body_templates(template_html, is_active)")
        .eq("company_id", company.id)
        .in("purpose", ["invoice", "general"]);
      const findAssigned = (key: string) => {
        const row = (assignmentRows ?? []).find((r: any) => r.purpose === key);
        const t = (row as any)?.template;
        return t?.is_active && t?.template_html ? (t.template_html as string) : null;
      };
      const assignedHtml = findAssigned("invoice") ?? findAssigned("general");
      if (assignedHtml) {
        useBodyTemplate = true;
        bodyTemplate = assignedHtml;
      } else {
        useBodyTemplate = !!company.email_body_use_template;
        if (company.email_body_template) bodyTemplate = company.email_body_template;
      }

      const [logosRes, colorsRes] = await Promise.all([
        supabase
          .from("company_brandbook_logos")
          .select("url,is_default,order_index")
          .eq("company_id", company.id)
          .order("order_index"),
        supabase
          .from("company_brandbook_colors")
          .select("hex,role")
          .eq("company_id", company.id),
      ]);
      const logos = (logosRes.data ?? []) as Array<{ url: string; is_default: boolean }>;
      const colors = (colorsRes.data ?? []) as Array<{ hex: string; role: string }>;
      const rawLogo = logos.find((l) => l.is_default)?.url || logos[0]?.url || company.logo_url || "";
      companyLogoDataUri = await fetchAsDataUri(toPublicLogoUrl(rawLogo, supabaseUrl));
      primaryColor = colors.find((c) => c.role === "primary")?.hex || "#d3bb73";
      secondaryColor = colors.find((c) => c.role === "secondary")?.hex || "#d3bb73";
      accentColor = colors.find((c) => c.role === "accent")?.hex || "#d3bb73";
    }

    const contentHtml = message.replace(/\n/g, "<br>");
    const finalSignature = signatureHtml || emailAccount.signature || "";
    const expectedMessageText = normalizeMessageText(message);
    const preparedMessageText = normalizeMessageText(messageHtml || "");
    const messageHtmlContainsContent =
      Boolean(messageHtml) &&
      (!expectedMessageText || preparedMessageText.includes(expectedMessageText));

    let htmlBody: string;
    if (messageHtmlContainsContent) {
      htmlBody = messageHtml;
    } else if (useBodyTemplate) {
      const safeBodyTemplate =
        hasTemplatePlaceholder(bodyTemplate, "content") &&
        (!finalSignature || hasTemplatePlaceholder(bodyTemplate, "signature"))
          ? bodyTemplate
          : DEFAULT_EMAIL_BODY_TEMPLATE;
      htmlBody = renderTemplate(safeBodyTemplate, {
        content: contentHtml,
        subject,
        recipient_name: recipientName ?? "",
        sender_name: employee ? `${employee.name ?? ""} ${employee.surname ?? ""}`.trim() : "",
        sender_email: employee?.email ?? "",
        company_logo: companyLogoDataUri,
        company_name: company?.name ?? "",
        company_website: company?.website ?? "",
        brand_primary_color: primaryColor,
        brand_secondary_color: secondaryColor,
        brand_accent_color: accentColor,
        signature: finalSignature,
        pdf_link: "",
      });
    } else {
      htmlBody = `
        <div style="display:block;width:100%;max-width:none;margin:0;padding:0;box-sizing:border-box;font-family:Arial,sans-serif;">
          <div style="margin:0;padding:0;">${contentHtml}</div>
          ${finalSignature}
        </div>
      `;
    }

    const storedHtmlBody = htmlBody;
    const preparedEmail = prepareInlineEmailImages(
      htmlBody,
      attachments.map((att: Attachment) => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType || 'application/pdf',
        contentDisposition: att.contentDisposition || 'attachment',
        cid: att.cid,
      })),
    );
    htmlBody = preparedEmail.html;

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
      cc,
      bcc,
      subject,
      body: htmlBody,
      attachments: preparedEmail.attachments,
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
      employee_id: employee.id,
      email_account_id: emailAccount.id,
      to_address: to,
      subject: subject,
      body: storedHtmlBody,
      message_id: info.messageId,
      sent_at: new Date().toISOString(),
    });

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
