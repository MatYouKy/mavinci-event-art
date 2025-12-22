import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface EventInvitationRequest {
  assignmentId: string;
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

    const { assignmentId }: EventInvitationRequest = await req.json();

    if (!assignmentId) {
      throw new Error("Assignment ID is required");
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
          email
        ),
        events(
          id,
          name,
          event_date,
          event_end_date,
          location,
          description,
          event_categories(name, color)
        )
      `)
      .eq("id", assignmentId)
      .maybeSingle();

    if (assignmentError || !assignment) {
      throw new Error("Assignment not found");
    }

    if (assignment.status !== "pending") {
      throw new Error("Can only send invitations for pending assignments");
    }

    const employee = assignment.employees as any;
    const event = assignment.events as any;

    if (!employee?.email) {
      throw new Error("Employee email not found");
    }

    if (!assignment.invitation_token) {
      throw new Error("Invitation token not generated");
    }

    const frontendUrl = Deno.env.get("FRONTEND_URL") || "https://mavinci.pl";
    const acceptUrl = `${frontendUrl}/crm/events/invitation/accept?token=${assignment.invitation_token}`;
    const rejectUrl = `${frontendUrl}/crm/events/invitation/reject?token=${assignment.invitation_token}`;
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

    const emailBody = `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zaproszenie do wydarzenia</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0f1119; color: #e5e4e2;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #1c1f33 0%, #0f1119 100%); border: 1px solid rgba(211, 187, 115, 0.2); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);">
      
      <div style="background: linear-gradient(90deg, #d3bb73 0%, #c5ad65 100%); padding: 30px 40px; text-align: center;">
        <h1 style="margin: 0; color: #1c1f33; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">🎉 Zaproszenie do wydarzenia</h1>
      </div>
      
      <div style="padding: 40px;">
        <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #e5e4e2;">
          Cześć <strong>${employee.name} ${employee.surname}</strong>,
        </p>
        
        <p style="margin: 0 0 30px; font-size: 16px; line-height: 1.6; color: rgba(229, 228, 226, 0.8);">
          Zostałeś zaproszony do zespołu wydarzenia. Poniżej szczegóły:
        </p>
        
        <div style="background: rgba(211, 187, 115, 0.1); border-left: 4px solid #d3bb73; padding: 25px; margin: 30px 0; border-radius: 8px;">
          <h2 style="margin: 0 0 20px; color: #d3bb73; font-size: 22px; font-weight: 600;">${event.name}</h2>
          
          <div style="margin-bottom: 15px;">
            <span style="color: rgba(229, 228, 226, 0.6); font-size: 14px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">📅 Data wydarzenia</span>
            <p style="margin: 5px 0 0; font-size: 16px; color: #e5e4e2; font-weight: 500;">${eventDateFormatted}</p>
          </div>
          
          ${event.location ? `
          <div style="margin-bottom: 15px;">
            <span style="color: rgba(229, 228, 226, 0.6); font-size: 14px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">📍 Lokalizacja</span>
            <p style="margin: 5px 0 0; font-size: 16px; color: #e5e4e2;">${event.location}</p>
          </div>
          ` : ''}
          
          ${assignment.role ? `
          <div style="margin-bottom: 15px;">
            <span style="color: rgba(229, 228, 226, 0.6); font-size: 14px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">👤 Twoja rola</span>
            <p style="margin: 5px 0 0; font-size: 16px; color: #e5e4e2;">${assignment.role}</p>
          </div>
          ` : ''}
          
          ${assignment.responsibilities ? `
          <div style="margin-bottom: 15px;">
            <span style="color: rgba(229, 228, 226, 0.6); font-size: 14px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">📋 Obowiązki</span>
            <p style="margin: 5px 0 0; font-size: 16px; color: #e5e4e2; white-space: pre-wrap;">${assignment.responsibilities}</p>
          </div>
          ` : ''}
          
          ${event.description ? `
          <div>
            <span style="color: rgba(229, 228, 226, 0.6); font-size: 14px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">ℹ️ Opis wydarzenia</span>
            <p style="margin: 5px 0 0; font-size: 16px; color: rgba(229, 228, 226, 0.8); line-height: 1.6; white-space: pre-wrap;">${event.description}</p>
          </div>
          ` : ''}
        </div>
        
        <div style="margin: 40px 0;">
          <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.6; color: #e5e4e2; text-align: center; font-weight: 500;">
            Potwierdź swoją obecność:
          </p>
          
          <div style="display: flex; gap: 15px; justify-content: center; flex-wrap: wrap;">
            <a href="${acceptUrl}" style="display: inline-block; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; text-align: center; box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3); transition: all 0.3s ease;">
              ✓ Akceptuję zaproszenie
            </a>
            
            <a href="${rejectUrl}" style="display: inline-block; background: rgba(239, 68, 68, 0.9); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; text-align: center; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3); transition: all 0.3s ease;">
              ✕ Odrzucam zaproszenie
            </a>
          </div>
        </div>
        
        <div style="margin-top: 30px; padding-top: 25px; border-top: 1px solid rgba(211, 187, 115, 0.2);">
          <p style="margin: 0 0 15px; font-size: 14px; color: rgba(229, 228, 226, 0.6); text-align: center;">
            Możesz też zalogować się do systemu CRM aby zobaczyć więcej szczegółów:
          </p>
          <p style="margin: 0; text-align: center;">
            <a href="${eventUrl}" style="color: #d3bb73; text-decoration: none; font-weight: 500; font-size: 15px; border-bottom: 1px solid rgba(211, 187, 115, 0.4); padding-bottom: 2px; transition: all 0.3s ease;">
              Zobacz szczegóły wydarzenia w CRM →
            </a>
          </p>
        </div>
        
        <div style="margin-top: 30px; padding: 20px; background: rgba(211, 187, 115, 0.05); border-radius: 8px; border: 1px solid rgba(211, 187, 115, 0.1);">
          <p style="margin: 0; font-size: 13px; color: rgba(229, 228, 226, 0.5); text-align: center; line-height: 1.6;">
            ⏰ Link wygasa: <strong style="color: #d3bb73;">${expiresAt}</strong><br>
            Po tym czasie musisz zalogować się do systemu CRM aby potwierdzić udział.
          </p>
        </div>
      </div>
      
      <div style="background: rgba(211, 187, 115, 0.05); padding: 25px 40px; text-align: center; border-top: 1px solid rgba(211, 187, 115, 0.1);">
        <p style="margin: 0 0 8px; font-size: 14px; color: rgba(229, 228, 226, 0.6);">
          Wiadomość wysłana z systemu <strong style="color: #d3bb73;">Mavinci CRM</strong>
        </p>
        <p style="margin: 0; font-size: 12px; color: rgba(229, 228, 226, 0.4);">
          © ${new Date().getFullYear()} Mavinci Events. Wszelkie prawa zastrzeżone.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
    `;

    const { data: systemEmail } = await supabase
      .from("employee_email_accounts")
      .select("id")
      .eq("is_system_account", true)
      .maybeSingle();

    if (!systemEmail) {
      throw new Error("System email account not configured");
    }

    const sendEmailUrl = `${supabaseUrl}/functions/v1/send-email`;
    const sendEmailResponse = await fetch(sendEmailUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": req.headers.get("Authorization") || "",
      },
      body: JSON.stringify({
        to: employee.email,
        subject: `Zaproszenie do wydarzenia: ${event.name}`,
        body: emailBody,
        emailAccountId: systemEmail.id,
      }),
    });

    if (!sendEmailResponse.ok) {
      const errorData = await sendEmailResponse.json();
      throw new Error(`Failed to send email: ${errorData.error || 'Unknown error'}`);
    }

    await supabase
      .from("employee_assignments")
      .update({
        invitation_email_sent: true,
        invitation_email_sent_at: new Date().toISOString(),
      })
      .eq("id", assignmentId);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Invitation email sent successfully",
        sentTo: employee.email,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error sending invitation email:", error);
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