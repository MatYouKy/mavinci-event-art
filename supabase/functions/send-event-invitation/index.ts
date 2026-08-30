import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DEFAULT_EMAIL_LOGO_URL =
  "https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/company-logos/brandbook/d4474f90-5e61-4ba4-928e-c25c0f0659b5/1779367661905.png";

const toPublicCompanyLogoUrl = (value: string, supabaseUrl: string): string => {
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  return `${supabaseUrl}/storage/v1/object/public/company-logos/${value.replace(/^\/+/, "")}`;
};

interface EventInvitationRequest {
  assignmentId: string;
  includePhases?: boolean;
  mode?: "invitation" | "timeline_update";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    console.log('[send-event-invitation] Starting...');

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const {
      assignmentId,
      includePhases = true,
      mode = "invitation",
    }: EventInvitationRequest = await req.json();
    console.log('[send-event-invitation] Assignment ID:', assignmentId);

    if (!assignmentId) {
      throw new Error("Assignment ID is required");
    }
    if (mode !== "invitation" && mode !== "timeline_update") {
      throw new Error("Unsupported email mode");
    }

    const { data: assignment, error: assignmentError } = await supabase
      .from("employee_assignments")
      .select(`
        id,
        status,
        role,
        responsibilities,
        invitation_token,
        invitation_expires_at,
        invitation_email_sent,
        employee_id,
        event_id,
        employees!employee_assignments_employee_id_fkey(
          id,
          name,
          surname,
          email,
          personal_email,
          notification_email_preference
        ),
        events(
          id,
          name,
          event_date,
          event_end_date,
          location,
          description,
          my_company_id,
          event_categories(name, color)
        )
      `)
      .eq("id", assignmentId)
      .maybeSingle();

    if (assignmentError || !assignment) {
      console.error('[send-event-invitation] Assignment not found:', assignmentError);
      throw new Error("Assignment not found");
    }

    let phaseAssignments: any[] = [];
    let phasesError: any = null;
    if (includePhases) {
      const phaseResult = await supabase
        .from("event_phase_assignments")
        .select(`
          phase_id,
          assignment_start,
          assignment_end,
          phase_work_start,
          phase_work_end,
          event_phases!inner(
            id,
            name,
            start_time,
            end_time,
            color,
            event_id
          )
        `)
        .eq("employee_id", assignment.employee_id)
        .eq("event_phases.event_id", assignment.event_id);
      phaseAssignments = phaseResult.data || [];
      phasesError = phaseResult.error;
    }

    if (phasesError) {
      console.error('[send-event-invitation] Error fetching phases:', phasesError);
    }

    console.log('[send-event-invitation] Found phase assignments:', phaseAssignments?.length || 0);

    console.log('[send-event-invitation] Assignment status:', assignment.status);

    if (mode === "invitation" && assignment.status !== "pending") {
      throw new Error("Can only send invitations for pending assignments");
    }
    if (mode === "timeline_update" && assignment.status === "rejected") {
      throw new Error("Cannot send a timeline update to a rejected assignment");
    }
    if (mode === "timeline_update" && phaseAssignments.length === 0) {
      throw new Error("No timeline phases are assigned to this employee");
    }

    const employee = assignment.employees as any;
    const event = assignment.events as any;

    let emailLogoUrl = DEFAULT_EMAIL_LOGO_URL;
    if (event?.my_company_id) {
      const { data: defaultBrandbookLogo } = await supabase
        .from("company_brandbook_logos")
        .select("url")
        .eq("company_id", event.my_company_id)
        .eq("is_default", true)
        .order("order_index", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (defaultBrandbookLogo?.url) {
        emailLogoUrl = toPublicCompanyLogoUrl(defaultBrandbookLogo.url, supabaseUrl);
      }
    }

    console.log('[send-event-invitation] Employee email:', employee?.email);
    console.log('[send-event-invitation] Employee personal_email:', employee?.personal_email);
    console.log('[send-event-invitation] Email preference:', employee?.notification_email_preference);

    const notificationEmails: string[] = [];
    const preference = employee?.notification_email_preference || 'work';

    switch (preference) {
      case 'work':
        if (employee?.email) {
          notificationEmails.push(employee.email);
        }
        break;

      case 'personal':
        if (employee?.personal_email) {
          notificationEmails.push(employee.personal_email);
        }
        break;

      case 'both':
        if (employee?.email) {
          notificationEmails.push(employee.email);
        }
        if (employee?.personal_email) {
          notificationEmails.push(employee.personal_email);
        }
        break;

      case 'none':
        break;

      default:
        if (employee?.email) {
          notificationEmails.push(employee.email);
        }
    }

    console.log('[send-event-invitation] Will send to emails:', notificationEmails);

    if (notificationEmails.length === 0) {
      console.log('[send-event-invitation] No emails to send based on preference');

      await supabase
        .from("employee_assignments")
        .update({
          invitation_email_sent: false,
          invitation_email_sent_at: new Date().toISOString(),
        })
        .eq("id", assignmentId);

      return new Response(
        JSON.stringify({
          success: true,
          message: "No email sent due to employee preferences",
          preference: preference,
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (mode === "invitation" && !assignment.invitation_token) {
      throw new Error("Invitation token not generated");
    }

    const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://mavinci.pl";
    console.log('[send-event-invitation] Frontend URL:', frontendUrl);

    const acceptUrl = `${frontendUrl}/invitation/accept?token=${assignment.invitation_token}`;
    const rejectUrl = `${frontendUrl}/invitation/reject?token=${assignment.invitation_token}`;
    const eventUrl = `${frontendUrl}/crm/events/${event.id}`;

    const eventDateFormatted = new Date(event.event_date).toLocaleDateString('pl-PL', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const expiresAt = new Date(assignment.invitation_expires_at).toLocaleDateString('pl-PL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const phasesTableHtml = phaseAssignments && phaseAssignments.length > 0 ? `<div style="margin: 30px 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;">
    <tr>
      <td style="vertical-align:middle;padding-right:8px;">
        <img src="https://mavinci.pl/icons/checklist-gold.svg"
             width="16"
             style="display:inline-block; vertical-align:middle; position:relative; top:1px;">
      </td>
      <td style="vertical-align:middle;">
        <span style="font-size:18px; font-weight:600; color:#d3bb73;">
          Twoje przypisane fazy
        </span>
      </td>
    </tr>
  </table>

  <div style="background: rgba(211, 187, 115, 0.05); border: 1px solid rgba(211, 187, 115, 0.1); border-radius: 8px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
      <thead>
        <tr style="background: rgba(211, 187, 115, 0.15);">
          <th style="padding: 10px; text-align: left; font-size: 12px; font-weight: 600; color: #d3bb73; border-bottom: 1px solid rgba(211, 187, 115, 0.2);">
            Faza
          </th>
          <th style="padding: 10px; text-align: left; font-size: 12px; font-weight: 600; color: #d3bb73; border-bottom: 1px solid rgba(211, 187, 115, 0.2);">
            Rozpoczęcie pracy
          </th>
          <th style="padding: 10px; text-align: left; font-size: 12px; font-weight: 600; color: #d3bb73; border-bottom: 1px solid rgba(211, 187, 115, 0.2);">
            Zakończenie pracy
          </th>
        </tr>
      </thead>
      <tbody>
        ${phaseAssignments.map((phase: any) => {
          const phaseData = phase.event_phases;
          const workStart = new Date(
            phase.phase_work_start || phase.assignment_start || phaseData.start_time,
          ).toLocaleString('pl-PL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
          const workEnd = new Date(
            phase.phase_work_end || phase.assignment_end || phaseData.end_time,
          ).toLocaleString('pl-PL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });

          return `
            <tr style="border-bottom: 1px solid rgba(211, 187, 115, 0.1);">
              <td style="padding: 10px; font-size: 13px; color: #e5e4e2; font-weight: 500;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding-right:8px; vertical-align:middle;">
                      <div style="width:8px; height:8px; border-radius:50%; background:${phaseData.color || '#3b82f6'};"></div>
                    </td>
                    <td style="vertical-align:middle; font-size:13px; color:#e5e4e2; font-weight:500;">
                      ${phaseData.name}
                    </td>
                  </tr>
                </table>
              </td>
              <td style="padding: 10px; font-size: 13px; color: rgba(229, 228, 226, 0.8);">
                ${workStart}
              </td>
              <td style="padding: 10px; font-size: 13px; color: rgba(229, 228, 226, 0.8);">
                ${workEnd}
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  </div>

  <p style="margin: 10px 0 0; font-size: 12px; color: rgba(229, 228, 226, 0.5); text-align: center;">
    Godziny pracy w poszczególnych fazach wydarzenia
  </p>
</div>` : mode === "invitation" ? `
  <div style="margin:24px 0;padding:16px;border:1px solid rgba(211,187,115,.18);border-radius:8px;background:rgba(211,187,115,.05);">
    <strong style="color:#d3bb73;">Harmonogram zostanie uzupełniony później</strong>
    <p style="margin:8px 0 0;color:rgba(229,228,226,.75);line-height:1.5;">
      Jesteś zapraszany do zespołu wydarzenia niezależnie od timeline. Po przypisaniu godzin otrzymasz osobną wiadomość z aktualnym harmonogramem.
    </p>
  </div>
` : '';

    const actionSectionHtml = mode === "timeline_update" ? `
      <div style="margin-top:30px;padding:22px;border:1px solid rgba(211,187,115,.2);border-radius:10px;text-align:center;">
        <p style="margin:0 0 14px;color:#e5e4e2;line-height:1.6;">
          Harmonogram został uzupełniony. Sprawdź godziny pracy powyżej. W razie rozbieżności skontaktuj się z opiekunem wydarzenia.
        </p>
        <a href="${eventUrl}" class="link">Zobacz szczegóły wydarzenia w CRM →</a>
      </div>
    ` : `
      <p class="text center" style="margin-top:40px;margin-bottom:20px;font-weight:500;">Potwierdź swoją obecność:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td class="mobile-full" width="50%" style="padding:5px;">
          <a href="${acceptUrl}" style="display:block;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;padding:14px 20px;text-align:center;">Akceptuję zaproszenie</a>
        </td>
        <td class="mobile-full" width="50%" style="padding:5px;">
          <a href="${rejectUrl}" style="display:block;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;padding:14px 20px;text-align:center;">Odrzucam zaproszenie</a>
        </td>
      </tr></table>
      <div style="margin-top:30px;padding-top:25px;border-top:1px solid rgba(211,187,115,.2);text-align:center;">
        <p style="font-size:14px;color:rgba(229,228,226,.6);">Możesz też zalogować się do CRM, aby zobaczyć więcej szczegółów.</p>
        <a href="${eventUrl}" class="link">Zobacz szczegóły wydarzenia w CRM →</a>
        <p style="margin-top:20px;font-size:12px;color:rgba(229,228,226,.55);">Link do odpowiedzi wygasa: <strong style="color:#d3bb73;">${expiresAt}</strong></p>
      </div>
    `;

    const emailBody = `
<!DOCTYPE html>
<html lang="pl">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Zaproszenie do wydarzenia</title>
  <style>
    body,
    table,
    td,
    a {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }

    table,
    td {
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }

    img {
      -ms-interpolation-mode: bicubic;
      border: 0;
      outline: none;
      text-decoration: none;
      display: block;
      max-width: 100%;
      height: auto;
    }

    body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      height: 100% !important;
      background-color: #0f1119;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    .wrapper {
      width: 100%;
      background-color: #0f1119;
      margin: 0;
      padding: 0;
    }

    .container {
      width: 100%;
      max-width: 600px;
      margin: 0 auto;
    }

    .card {
      background: linear-gradient(135deg, #1c1f33 0%, #0f1119 100%);
      border: 1px solid rgba(211, 187, 115, 0.2);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }

    .header {
      background: linear-gradient(90deg, #d3bb73 0%, #c5ad65 100%);
      padding: 20px 40px;
      text-align: center;
    }

    .header-logo {
      padding: 30px 40px;
      text-align: center;
    }

    .header-logo img {
      margin: 0 auto;
      max-width: 100%;
      height: auto;
      width: 60%;
      object-fit: contain;
    }

    .header-title {
      margin: 0;
      color: #1c1f33;
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.5px;
      line-height: 1.3;
    }

    .content {
      padding: 40px;
      color: #e5e4e2;
    }

    .text {
      margin: 0 0 20px;
      font-size: 16px;
      line-height: 1.6;
      color: #e5e4e2;
    }

    .muted {
      color: rgba(229, 228, 226, 0.8);
    }

    .info-box {
      background: rgba(211, 187, 115, 0.1);
      border-left: 4px solid #d3bb73;
      padding: 25px;
      margin: 30px 0;
      border-radius: 8px;
    }

    .event-title {
      margin: 0 0 20px;
      color: #d3bb73;
      font-size: 22px;
      font-weight: 600;
      line-height: 1.4;
    }

    .label {
      color: rgba(229, 228, 226, 0.6);
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: block;
      margin-bottom: 6px;
    }

    .value {
      margin: 0 0 16px;
      font-size: 16px;
      color: #e5e4e2;
      line-height: 1.6;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .center {
      text-align: center;
    }

    .button-wrap {
      padding-top: 10px;
      padding-bottom: 10px;
    }

    .button {
      display: block;
      width: 100%;
      box-sizing: border-box;
      text-align: center;
      text-decoration: none;
      font-size: 16px;
      font-weight: 600;
      line-height: 1.2;
      padding: 16px 20px;
      border-radius: 8px;
    }

    .button-accept {
      background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
      color: #ffffff !important;
    }

    .button-reject {
      background: rgba(239, 68, 68, 0.9);
      color: #ffffff !important;
    }

    .link {
      color: #d3bb73 !important;
      text-decoration: none;
      font-weight: 500;
      font-size: 15px;
      border-bottom: 1px solid rgba(211, 187, 115, 0.4);
      padding-bottom: 2px;
      word-break: break-word;
    }

    .footer-note {
      margin-top: 30px;
      padding: 20px;
      background: rgba(211, 187, 115, 0.05);
      border-radius: 8px;
      border: 1px solid rgba(211, 187, 115, 0.1);
    }

    .footer-note-text {
      margin: 0;
      font-size: 13px;
      color: rgba(229, 228, 226, 0.5);
      text-align: center;
      line-height: 1.6;
    }

    .bottom {
      background: rgba(211, 187, 115, 0.05);
      padding: 25px 40px;
      text-align: center;
      border-top: 1px solid rgba(211, 187, 115, 0.1);
    }

    .bottom-text {
      margin: 0 0 8px;
      font-size: 14px;
      color: rgba(229, 228, 226, 0.6);
      line-height: 1.5;
    }

    .bottom-copy {
      margin: 0;
      font-size: 12px;
      color: rgba(229, 228, 226, 0.4);
      line-height: 1.5;
    }

    @media only screen and (max-width: 600px) {
      .mobile-full {
        width: 100% !important;
        display: block !important;
      }

      .content {
        padding: 24px 18px !important;
      }

      .header {
        padding: 24px 18px !important;
      }

      .bottom {
        padding: 20px 18px !important;
      }

      .header-title {
        font-size: 24px !important;
        line-height: 1.3 !important;
      }

      .text,
      .value {
        font-size: 15px !important;
      }

      .event-title {
        font-size: 20px !important;
      }

      .info-box {
        padding: 18px !important;
        margin: 24px 0 !important;
      }

      .button {
        font-size: 15px !important;
        padding: 15px 16px !important;
      }

      .footer-note {
        padding: 16px !important;
      }
    }
  </style>
</head>

<body>
  <table bgcolor="#0f1119" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="wrapper">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="container">
          <tr>
            <td class="card">

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td class="header-logo">
                    <img src="${emailLogoUrl}" alt="Mavinci CRM" width="120" style="display:block; width:120px; max-width:100%; height:auto; margin:0 auto;">
                  </td>
                </tr>
                <tr>
                  <td class="header">
                    <h1 class="header-title">Zaproszenie do wydarzenia</h1>
                  </td>
                </tr>

                <tr>
                  <td class="content">
                    <p class="text">
                      Cześć <strong>${employee.name} ${employee.surname}</strong>,
                    </p>

                    <p class="text muted">
                      Zostałeś zaproszony do zespołu wydarzenia. Poniżej szczegóły:
                    </p>

                    <div class="info-box">
                      <h2 class="event-title">${event.name}</h2>

                      <!-- DATA -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
                        <tr>
                          <td style="vertical-align:middle;padding-right:8px;">
                            <img src="https://mavinci.pl/icons/calendar-gold.svg" width="16"
                              style="display:inline-block; vertical-align:middle; position:relative; top:1px;">
                          </td>
                          <td style="vertical-align:middle;">
                            <span
                              style="font-size:12px;font-weight:600;letter-spacing:0.6px;color:#d3bb73;text-transform:uppercase;">
                              Data wydarzenia
                            </span>
                          </td>
                        </tr>
                      </table>

                      <div style="font-size:16px;color:#e5e4e2;font-weight:500;margin-bottom:12px;">
                        ${eventDateFormatted}
                      </div>

                      ${event.location ? `
                      <!-- LOKALIZACJA -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
                        <tr>
                          <td style="vertical-align:middle;padding-right:8px;">
                            <img src="https://mavinci.pl/icons/location-gold.svg" width="16"
                              style="display:inline-block; vertical-align:middle; position:relative; top:1px;">
                          </td>
                          <td style="vertical-align:middle;">
                            <span
                              style="font-size:12px;font-weight:600;letter-spacing:0.6px;color:#d3bb73;text-transform:uppercase;">
                              Lokalizacja
                            </span>
                          </td>
                        </tr>
                      </table>

                      <div style="font-size:16px;color:#e5e4e2;margin-bottom:12px;word-break:break-word;">
                        ${event.location}
                      </div>
                      ` : ''}

                      ${assignment.role ? `
                      <!-- ROLA -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
                        <tr>
                          <td style="vertical-align:middle;padding-right:8px;">
                            <img src="https://mavinci.pl/icons/user-gold.svg" width="16"
                              style="display:inline-block; vertical-align:middle; position:relative; top:1px;">
                          </td>
                          <td style="vertical-align:middle;">
                            <span
                              style="font-size:12px;font-weight:600;letter-spacing:0.6px;color:#d3bb73;text-transform:uppercase;">
                              Twoja rola
                            </span>
                          </td>
                        </tr>
                      </table>

                      <div style="font-size:16px;color:#e5e4e2;margin-bottom:12px;">
                        ${assignment.role}
                      </div>
                      ` : ''}

                      ${assignment.responsibilities ? `
                      <!-- OBOWIĄZKI -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
                        <tr>
                          <td style="vertical-align:middle;padding-right:8px;">
                            <img src="https://mavinci.pl/icons/checklist-gold.svg" width="16"
                              style="display:inline-block; vertical-align:middle; position:relative; top:1px;">
                          </td>
                          <td style="vertical-align:middle;">
                            <span
                              style="font-size:12px;font-weight:600;letter-spacing:0.6px;color:#d3bb73;text-transform:uppercase;">
                              Obowiązki
                            </span>
                          </td>
                        </tr>
                      </table>

                      <div style="font-size:16px;color:#e5e4e2;margin-bottom:12px;white-space:pre-wrap;">
                        ${assignment.responsibilities}
                      </div>
                      ` : ''}

                      ${event.description ? `
                      <!-- OPIS -->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px;">
                        <tr>
                          <td style="vertical-align:middle;padding-right:8px;">
                            <img src="https://mavinci.pl/icons/info-gold.svg" width="16"
                              style="display:inline-block; vertical-align:middle; position:relative; top:1px;">
                          </td>
                          <td style="vertical-align:middle;">
                            <span
                              style="font-size:12px;font-weight:600;letter-spacing:0.6px;color:#d3bb73;text-transform:uppercase;">
                              Opis wydarzenia
                            </span>
                          </td>
                        </tr>
                      </table>

                      <div
                        style="font-size:16px;color:rgba(229,228,226,0.8);margin-bottom:12px;line-height:1.6;white-space:pre-wrap;">
                        ${event.description}
                      </div>
                      ` : ''}

                    </div>

                    ${phasesTableHtml}

                    ${actionSectionHtml}
                  </td>
                </tr>

                <tr>
                  <td class="bottom">
                    <p class="bottom-text">
                      Wiadomość wysłana z systemu <strong style="color: #d3bb73;">Mavinci CRM</strong>
                    </p>
                    <p class="bottom-copy">
                      © ${new Date().getFullYear()} Mavinci Events. Wszelkie prawa zastrzeżone.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>

</html>
    `;

    const { data: systemEmail } = await supabase
      .from("employee_email_accounts")
      .select("id")
      .eq("is_system_account", true)
      .maybeSingle();

    if (!systemEmail) {
      console.error('[send-event-invitation] System email not configured');
      throw new Error("System email account not configured");
    }

    const sendEmailUrl = `${supabaseUrl}/functions/v1/send-email`;

    const emailPromises = notificationEmails.map(async (emailAddress) => {
      console.log('[send-event-invitation] Sending email to:', emailAddress);

      const sendEmailResponse = await fetch(sendEmailUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": req.headers.get("Authorization") || "",
        },
        body: JSON.stringify({
          to: emailAddress,
          subject: mode === "timeline_update"
            ? `Uzupełniony harmonogram: ${event.name}`
            : `Zaproszenie do wydarzenia: ${event.name}`,
          body: emailBody,
          emailAccountId: systemEmail.id,
        }),
      });

      if (!sendEmailResponse.ok) {
        const errorData = await sendEmailResponse.json();
        console.error(`[send-event-invitation] Email send failed for ${emailAddress}:`, errorData);
        throw new Error(`Failed to send email to ${emailAddress}: ${errorData.error || 'Unknown error'}`);
      }

      return emailAddress;
    });

    const sentEmails = await Promise.all(emailPromises);

    await supabase
      .from("employee_assignments")
      .update(mode === "timeline_update" ? {
        invitation_includes_phases: true,
        timeline_update_email_sent_at: new Date().toISOString(),
      } : {
        invitation_email_sent: true,
        invitation_email_sent_at: new Date().toISOString(),
        invitation_includes_phases: includePhases && phaseAssignments.length > 0,
      })
      .eq("id", assignmentId);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Invitation email sent successfully",
        sentTo: sentEmails,
        preference: preference,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("[send-event-invitation] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
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
