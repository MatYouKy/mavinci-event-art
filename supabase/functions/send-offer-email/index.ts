import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Keep these helpers local: Supabase Dashboard deployments may include only index.ts.
// When updating the equivalents in _shared, keep both send-email functions in sync.
async function salesDeliveryActor(req: Request, body: any, service: any, functionName: string) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Wymagane logowanie');
  if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    const id = body._scheduledDispatch?.scheduledEmailId;
    if (!id) throw new Error('Brak zlecenia wysyłki');
    const { data: job, error } = await service.from('scheduled_emails').select('created_by,status,function_name').eq('id', id).single();
    if (error || job.status !== 'processing' || job.function_name !== functionName) throw new Error('Nieprawidłowe zlecenie wysyłki');
    return { userId: job.created_by, scheduled: true, deliveryKey: `scheduled:${id}` };
  }
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new Error('Sesja wygasła');
  return { userId: data.user.id, scheduled: false, deliveryKey: null };
}
async function assertSalesDocumentPermission(service: any, kind: string, id: string, userId: string) {
  const { data, error } = await service.rpc('sales_actor_can_manage', { p_kind: kind, p_document: id, p_user: userId });
  if (error || !data) throw new Error('Brak uprawnień do dokumentu');
}

interface RelayEmailAttachment {
  filename: string;
  content: string;
  contentType?: string;
  contentDisposition?: "attachment" | "inline";
  cid?: string;
}

interface PreparedEmail {
  html: string;
  attachments: RelayEmailAttachment[];
}

const extensionForMime = (mime: string): string => {
  const normalized = mime.toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/svg+xml") return "svg";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/webp") return "webp";
  return "png";
};

/**
 * Gmail usuwa data:image/... z HTML wiadomości. Zamieniamy je na obrazy MIME
 * osadzone przez Content-ID, zachowując przy tym dotychczasowy szablon stopki.
 */
const prepareInlineEmailImages = (
  html: string,
  existingAttachments: RelayEmailAttachment[] = [],
): PreparedEmail => {
  if (!html || !/data:image\//i.test(html)) {
    return { html, attachments: [...existingAttachments] };
  }

  const inlineAttachments: RelayEmailAttachment[] = [];
  const knownImages = new Map<string, string>();
  let imageIndex = 0;

  const preparedHtml = html.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(data:(image\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,([^"']+))\2/gi,
    (_match, prefix: string, quote: string, dataUri: string, mime: string, base64: string) => {
      const existingCid = knownImages.get(dataUri);
      if (existingCid) return `${prefix}${quote}cid:${existingCid}${quote}`;

      imageIndex += 1;
      const cid = `mavinci-inline-${imageIndex}-${crypto.randomUUID()}@mavinci.pl`;
      knownImages.set(dataUri, cid);
      inlineAttachments.push({
        filename: `mavinci-inline-${imageIndex}.${extensionForMime(mime)}`,
        content: base64.replace(/\s+/g, ""),
        contentType: mime,
        contentDisposition: "inline",
        cid,
      });

      return `${prefix}${quote}cid:${cid}${quote}`;
    },
  );

  return {
    html: preparedHtml,
    attachments: [...existingAttachments, ...inlineAttachments],
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SendOfferEmailRequest {
  offerId: string;
  emailAccountId?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  message: string;
  messageHtml?: string;
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
    out = out.replace(re, () => value ?? "");
  }
  return out;
};

const hasTemplatePlaceholder = (template: string, key: string): boolean =>
  new RegExp(`{{\\s*${key}\\s*}}`, "i").test(template || "");

const decodeEmailEntities = (value: string): string => value.replace(
  /&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi,
  (entity, code: string) => {
    const named: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (!code.startsWith('#')) return named[code.toLowerCase()] ?? entity;
    const number = code.toLowerCase().startsWith('#x') ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  },
);

const normalizeMessageText = (value: string): string => decodeEmailEntities(
  (value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '),
).replace(/\s+/g, ' ').trim();

const plainMessageToHtml = (value: string): string => value
  .replace(/\r\n?/g, '\n')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')
  .replace(/\t/g, '    ')
  .replace(/ {2,}/g, (spaces) => '&nbsp;'.repeat(spaces.length - 1) + ' ')
  .replace(/\n/g, '<br>');

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

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
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

  try {
    const requestBody = await req.json();
    const {
      offerId,
      emailAccountId,
      to,
      cc,
      bcc,
      subject,
      message = "",
      messageHtml,
      signatureHtml,
      recipientName,
    }: SendOfferEmailRequest = requestBody;

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

    const actor = await salesDeliveryActor(req, requestBody, supabase, 'send-offer-email');
    const user = { id: actor.userId };
    await assertSalesDocumentPermission(supabase, 'offer', offerId, user.id);

    // Email delivery only needs offer fields; no event or organization is required.
    const { data: offer, error: offerError } = await supabase
      .from("offers")
      .select("*")
      .eq("id", offerId)
      .maybeSingle();

    if (offerError) {
      console.error('[send-offer-email] Offer lookup failed:', offerError);
      throw new Error(`Nie udało się pobrać oferty: ${offerError.message}`);
    }
    if (!offer) {
      throw new Error("Offer not found");
    }

    const { data: employee } = await supabase
      .from("employees")
      .select("*")
      .or(`id.eq.${user.id},auth_user_id.eq.${user.id}`)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (!employee) {
      throw new Error("Employee not found");
    }

    const isAdmin = employee.permissions?.includes('admin');
    const isCreator = offer.created_by === user.id || offer.created_by === employee.id;



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
        const isPersonalAccount = requestedAccount.employee_id === employee.id;
        let isAssignedAccount = false;
        if (!isPersonalAccount) {
          const { data: assignment } = await supabase
            .from("employee_email_account_assignments")
            .select("id")
            .eq("email_account_id", requestedAccount.id)
            .eq("employee_id", employee.id)
            .eq("can_send", true)
            .maybeSingle();
          isAssignedAccount = Boolean(assignment);
        }
        if (isPersonalAccount || isAssignedAccount) emailAccount = requestedAccount;
      }
    } else {
      const { data: personalAccounts } = await supabase
        .from("employee_email_accounts")
        .select("*")
        .eq("employee_id", employee.id)
        .eq("is_active", true)
        .or("account_type.is.null,account_type.neq.system")
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1);
      emailAccount = personalAccounts?.[0] || null;
    }

    if (!emailAccount) {
      throw new Error("Wybierz aktywną skrzynkę pracownika. Oferty nie mogą być wysyłane z konta systemowego.");
    }

    const relayUrl = Deno.env.get("SMTP_RELAY_URL");
    const relaySecret = Deno.env.get("SMTP_RELAY_SECRET");

    if (!relayUrl || !relaySecret) {
      throw new Error("SMTP_RELAY_URL or SMTP_RELAY_SECRET not configured");
    }

    const pdfStoragePath = String(requestBody.documentPath || offer.generated_pdf_url || '');
    if (!pdfStoragePath) throw new Error('Najpierw wygeneruj PDF oferty.');
    if (!actor.scheduled && (offer.modified_after_generation || pdfStoragePath !== offer.generated_pdf_url)) throw new Error('Oferta zmieniła się. Wygeneruj aktualny PDF przed wysyłką.');
    if (actor.scheduled) {
      const { data: file } = await supabase.from('sales_document_files').select('id').eq('offer_id', offerId).eq('storage_bucket', 'generated-offers').eq('storage_path', pdfStoragePath).maybeSingle();
      if (!file) throw new Error('Brak zapisanej wersji oferty z chwili planowania wysyłki.');
    }

    const { data: pdfFile, error: pdfDownloadError } = await supabase.storage
      .from('generated-offers')
      .download(pdfStoragePath);
    if (pdfDownloadError || !pdfFile) {
      throw new Error(`Nie udało się pobrać PDF do załącznika: ${pdfDownloadError?.message || 'brak pliku'}`);
    }
    const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());
    if (pdfBytes.byteLength === 0) {
      throw new Error("Wygenerowany PDF jest pusty. Wiadomość nie została wysłana.");
    }
    const safeOfferNumber = String(offer.offer_number || offerId)
      .replace(/[^a-zA-Z0-9._-]+/g, "_");
    const pdfAttachment = {
      filename: `Oferta_${safeOfferNumber}.pdf`,
      content: bytesToBase64(pdfBytes),
      contentType: "application/pdf",
      contentDisposition: "attachment",
    };

    let companyQuery = supabase
      .from("my_companies")
      .select("*")
      .eq("is_active", true);
    companyQuery = emailAccount.my_company_id
      ? companyQuery.eq("id", emailAccount.my_company_id)
      : companyQuery.order("is_default", { ascending: false });
    const { data: companies } = await companyQuery.limit(1);
    const company = companies?.[0] ?? null;

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
        .in("purpose", ["offer", "general"]);
      const findAssigned = (key: string) => {
        const row = (assignmentRows ?? []).find((r: any) => r.purpose === key);
        const t = (row as any)?.template;
        return t?.is_active && t?.template_html ? (t.template_html as string) : null;
      };
      const assignedHtml = findAssigned("offer") ?? findAssigned("general");
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

    const contentHtml = plainMessageToHtml(message);
    const finalSignature = signatureHtml || emailAccount.signature || "";
    const expectedMessageText = message.replace(/\s+/g, ' ').trim();
    const preparedMessageText = normalizeMessageText(messageHtml || "");
    const messageHtmlContainsContent =
      Boolean(messageHtml) &&
      (!expectedMessageText
        || preparedMessageText.replace(/\s/g, '').includes(expectedMessageText.replace(/\s/g, '')));

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
        sender_name: `${employee.name ?? ""} ${employee.surname ?? ""}`.trim(),
        sender_email: emailAccount.email_address ?? employee.email ?? "",
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
    const preparedEmail = prepareInlineEmailImages(htmlBody, [pdfAttachment]);
    htmlBody = preparedEmail.html;

    const relayPayload = {
      smtpConfig: {
        host: emailAccount.smtp_host,
        port: emailAccount.smtp_port,
        username: emailAccount.smtp_username,
        password: emailAccount.smtp_password,
        from: emailAccount.email_address,
        fromName: emailAccount.from_name,
        replyTo: emailAccount.email_address,
      },
      to,
      cc,
      bcc,
      subject,
      body: htmlBody,
      replyTo: emailAccount.email_address,
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
      reply_to: emailAccount.email_address,
      message_id: info.messageId,
      sent_at: new Date().toISOString(),
    });

    const { error: deliveryError } = await supabase.rpc('record_sales_delivery', { p_kind: 'offer', p_document: offerId, p_delivery_key: actor.deliveryKey || `offer:${offerId}:${info.messageId || crypto.randomUUID()}`, p_storage_path: pdfStoragePath, p_recipient: to });
    if (deliveryError) console.error('Offer delivered; activity write failed', deliveryError.code);

    return new Response(
      JSON.stringify({
        success: true,
        messageId: info.messageId,
        warning: deliveryError ? 'Wiadomość wysłana, ale nie zapisano jej w historii zapytania. Nie ponawiaj wysyłki.' : null,
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
