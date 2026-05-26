import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { eventId } = await req.json();

    if (!eventId) {
      throw new Error("eventId is required");
    }

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select(
        `
        id,
        name,
        event_date,
        event_end_date,
        description,
        notes,
        location_id,
        organization_id,
        contact_person_id,
        category_id,
        my_company_id
      `
      )
      .eq("id", eventId)
      .maybeSingle();

    if (eventError || !event) {
      throw new Error("Event not found");
    }

    const [
      organizationRes,
      contactRes,
      phasesRes,
      locationRes,
      categoryRes,
      offerRes,
      companyRes,
    ] = await Promise.all([
      event.organization_id
        ? supabase
            .from("organizations")
            .select("name, email, phone, nip")
            .eq("id", event.organization_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      event.contact_person_id
        ? supabase
            .from("contacts")
            .select(
              "first_name, last_name, full_name, email, phone, mobile"
            )
            .eq("id", event.contact_person_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("event_phases")
        .select("name, phase_type, start_time, end_time, sequence_order")
        .eq("event_id", eventId)
        .order("sequence_order", { ascending: true }),
      event.location_id
        ? supabase
            .from("locations")
            .select("name, city, street, postal_code")
            .eq("id", event.location_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      event.category_id
        ? supabase
            .from("event_categories")
            .select("name")
            .eq("id", event.category_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("offers")
        .select(
          `
          id,
          offer_items(name, quantity, unit, total, display_order)
        `
        )
        .eq("event_id", eventId)
        .eq("status", "accepted")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      event.my_company_id
        ? supabase
            .from("my_companies")
            .select("legal_name, phone, email, logo_url")
            .eq("id", event.my_company_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const organization = organizationRes.data;
    const contact = contactRes.data;
    const phases = phasesRes.data || [];
    const location = locationRes.data;
    const category = categoryRes.data;
    const offer = offerRes.data;
    const company = companyRes.data;

    const recipientEmail =
      contact?.email || organization?.email;

    if (!recipientEmail) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Brak adresu email odbiorcy (brak emaila kontaktu ani organizacji)",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contactName =
      contact?.full_name ||
      [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") ||
      organization?.name ||
      "Szanowni Państwo";

    const eventDate = event.event_date
      ? new Date(event.event_date).toLocaleDateString("pl-PL", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : null;

    const eventTime = event.event_date
      ? new Date(event.event_date).toLocaleTimeString("pl-PL", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

    const eventEndTime = event.event_end_date
      ? new Date(event.event_end_date).toLocaleTimeString("pl-PL", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

    const locationText = location
      ? [location.name, location.street, [location.postal_code, location.city].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", ")
      : null;

    const realizationPhase = phases.find(
      (p: any) => p.phase_type === "realization"
    );
    const realizationTime = realizationPhase
      ? {
          start: realizationPhase.start_time
            ? new Date(realizationPhase.start_time).toLocaleTimeString(
                "pl-PL",
                { hour: "2-digit", minute: "2-digit" }
              )
            : null,
          end: realizationPhase.end_time
            ? new Date(realizationPhase.end_time).toLocaleTimeString(
                "pl-PL",
                { hour: "2-digit", minute: "2-digit" }
              )
            : null,
        }
      : null;

    const offerItems = offer?.offer_items
      ? [...offer.offer_items]
          .sort(
            (a: any, b: any) =>
              (a.display_order ?? 0) - (b.display_order ?? 0)
          )
          .map((item: any) => item.name)
          .filter(Boolean)
      : [];

    const companyName = company?.legal_name || "Mavinci";
    const companyLogo = company?.logo_url
      ? `${supabaseUrl}/storage/v1/object/public/company-logos/${company.logo_url}`
      : null;

    const emailBody = buildConfirmationEmailHtml({
      contactName,
      eventName: event.name,
      eventDate,
      eventTime,
      eventEndTime,
      realizationTime,
      locationText,
      categoryName: category?.name || null,
      offerItems,
      companyName,
      companyPhone: company?.phone || null,
      companyEmail: company?.email || null,
      companyLogo,
    });

    const { data: systemEmail } = await supabase
      .from("employee_email_accounts")
      .select("id")
      .eq("is_system_account", true)
      .maybeSingle();

    if (!systemEmail) {
      throw new Error("Brak skonfigurowanego konta email systemowego");
    }

    const sendEmailUrl = `${supabaseUrl}/functions/v1/send-email`;
    const sendEmailResponse = await fetch(sendEmailUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        to: recipientEmail,
        subject: `Potwierdzenie realizacji: ${event.name}`,
        body: emailBody,
        emailAccountId: systemEmail.id,
      }),
    });

    if (!sendEmailResponse.ok) {
      const errorData = await sendEmailResponse.json();
      throw new Error(
        `Failed to send email: ${errorData.error || "Unknown error"}`
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Confirmation email sent to ${recipientEmail}`,
        recipientEmail,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[send-event-confirmation] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

interface ConfirmationEmailData {
  contactName: string;
  eventName: string;
  eventDate: string | null;
  eventTime: string | null;
  eventEndTime: string | null;
  realizationTime: { start: string | null; end: string | null } | null;
  locationText: string | null;
  categoryName: string | null;
  offerItems: string[];
  companyName: string;
  companyPhone: string | null;
  companyEmail: string | null;
  companyLogo: string | null;
}

function buildConfirmationEmailHtml(data: ConfirmationEmailData): string {
  const detailRows: string[] = [];

  if (data.eventDate) {
    detailRows.push(buildDetailRow("Data wydarzenia", data.eventDate));
  }

  if (data.realizationTime?.start) {
    const timeText = data.realizationTime.end
      ? `${data.realizationTime.start} - ${data.realizationTime.end}`
      : `od ${data.realizationTime.start}`;
    detailRows.push(buildDetailRow("Godziny realizacji", timeText));
  } else if (data.eventTime) {
    const timeText = data.eventEndTime
      ? `${data.eventTime} - ${data.eventEndTime}`
      : `od ${data.eventTime}`;
    detailRows.push(buildDetailRow("Godziny", timeText));
  }

  if (data.locationText) {
    detailRows.push(buildDetailRow("Miejsce", data.locationText));
  }

  if (data.categoryName) {
    detailRows.push(buildDetailRow("Typ wydarzenia", data.categoryName));
  }

  const scopeHtml =
    data.offerItems.length > 0
      ? `
    <div style="margin-top: 24px;">
      <div style="font-size: 14px; font-weight: 600; color: #d3bb73; margin-bottom: 12px;">
        Zakres realizacji
      </div>
      <div style="background: #f8f7f4; border: 1px solid #e8e4d9; border-radius: 8px; padding: 16px;">
        ${data.offerItems.map((item) => `<div style="padding: 6px 0; border-bottom: 1px solid #ede9df; font-size: 13px; color: #333;">${escapeHtml(item)}</div>`).join("")}
      </div>
    </div>
  `
      : "";

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background: #f4f3f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">

      <!-- Header -->
      <div style="background: #1c1f33; padding: 32px 40px; text-align: center;">
        ${data.companyLogo ? `<img src="${data.companyLogo}" alt="${escapeHtml(data.companyName)}" style="height: 36px; margin-bottom: 16px;">` : `<div style="font-size: 20px; font-weight: 700; color: #d3bb73; margin-bottom: 8px;">${escapeHtml(data.companyName)}</div>`}
        <div style="font-size: 13px; color: rgba(228, 225, 219, 0.6); letter-spacing: 1px; text-transform: uppercase;">
          Potwierdzenie realizacji
        </div>
      </div>

      <!-- Body -->
      <div style="padding: 40px;">
        <div style="font-size: 15px; color: #333; line-height: 1.6; margin-bottom: 24px;">
          Dzień dobry, <strong>${escapeHtml(data.contactName)}</strong>,
        </div>

        <div style="font-size: 15px; color: #333; line-height: 1.6; margin-bottom: 24px;">
          Z przyjemnością potwierdzamy realizację wydarzenia:
        </div>

        <div style="background: #1c1f33; border-radius: 10px; padding: 24px; margin-bottom: 24px;">
          <div style="font-size: 18px; font-weight: 600; color: #d3bb73; margin-bottom: 4px;">
            ${escapeHtml(data.eventName)}
          </div>
        </div>

        ${detailRows.length > 0 ? `
        <div style="margin-bottom: 24px;">
          <div style="font-size: 14px; font-weight: 600; color: #d3bb73; margin-bottom: 12px;">
            Szczegóły
          </div>
          <div style="background: #f8f7f4; border: 1px solid #e8e4d9; border-radius: 8px; padding: 16px;">
            ${detailRows.join("")}
          </div>
        </div>
        ` : ""}

        ${scopeHtml}

        <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e8e4d9; font-size: 14px; color: #555; line-height: 1.6;">
          W razie pytań lub zmian prosimy o kontakt${data.companyPhone ? ` pod numerem <strong>${escapeHtml(data.companyPhone)}</strong>` : ""}${data.companyEmail ? ` lub mailowo: <strong>${escapeHtml(data.companyEmail)}</strong>` : ""}.
        </div>

        <div style="margin-top: 24px; font-size: 14px; color: #333;">
          Z poważaniem,<br>
          <strong>Zespół ${escapeHtml(data.companyName)}</strong>
        </div>
      </div>

      <!-- Footer -->
      <div style="background: #f8f7f4; padding: 20px 40px; text-align: center; font-size: 11px; color: #999;">
        Ta wiadomość została wygenerowana automatycznie. Prosimy nie odpowiadać na ten adres.
      </div>
    </div>
  </div>
</body>
</html>`;
}

function buildDetailRow(label: string, value: string): string {
  return `
    <div style="display: flex; padding: 8px 0; border-bottom: 1px solid #ede9df;">
      <div style="min-width: 140px; font-size: 12px; color: #888; padding-top: 2px;">${escapeHtml(label)}</div>
      <div style="font-size: 14px; color: #333; font-weight: 500;">${escapeHtml(value)}</div>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
