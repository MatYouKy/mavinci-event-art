import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

    const { emailAccountId } = await req.json();

    if (!emailAccountId) {
      throw new Error("Missing emailAccountId");
    }

    const { data: emailAccount, error: accountError } = await supabase
      .from("employee_email_accounts")
      .select("*")
      .eq("id", emailAccountId)
      .maybeSingle();

    if (accountError || !emailAccount) {
      throw new Error("Email account not found");
    }

    const emails = [];

    console.log("Fetching emails for account:", emailAccount.email_address);

    // 1. Pobierz wysłane emaile z tego konta
    const { data: sentEmails, error: sentError } = await supabase
      .from("sent_emails")
      .select(`
        *,
        employees(name, surname, email)
      `)
      .eq("email_account_id", emailAccountId)
      .order("sent_at", { ascending: false })
      .limit(50);

    if (sentEmails && !sentError) {
      for (const sent of sentEmails) {
        const employee = sent.employees as any;
        const fromName = employee
          ? `${employee.name} ${employee.surname}`
          : "System";
        const fromEmail = employee?.email || emailAccount.email_address;

        emails.push({
          from: `${fromName} <${fromEmail}>`,
          to: sent.to_address,
          subject: sent.subject,
          date: new Date(sent.sent_at),
          text: sent.body.replace(/<[^>]*>/g, ""),
          html: sent.body,
          messageId: sent.message_id || sent.id,
          type: "sent",
          source: "sent_emails",
        });
      }
    }

    // 2. OPCJONALNIE: Spróbuj pobrać z IMAP (może nie zadziałać)
    // Zakomentowane bo nie działa w Deno Edge Runtime
    /*
    try {
      const imapSimple = await import("npm:imap-simple@5.1.0");
      // ... kod IMAP ...
    } catch (imapError) {
      console.warn("IMAP not available:", imapError);
    }
    */

    // Sortuj wszystkie emaile po dacie
    emails.sort((a, b) => b.date.getTime() - a.date.getTime());

    console.log(`Returned ${emails.length} emails (sent: ${sentEmails?.length || 0})`);

    return new Response(
      JSON.stringify({
        success: true,
        emails: emails,
        count: emails.length,
        stats: {
          sent_emails: sentEmails?.length || 0,
          imap_available: false,
        },
        message: "UWAGA: Pobieranie przez IMAP nie jest dostępne w środowisku Supabase Edge Functions. Wyświetlane są tylko wysłane emaile.",
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error fetching emails:", error);

    const errorMessage = error instanceof Error
      ? error.message
      : typeof error === "string"
      ? error
      : "Unknown error";

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
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