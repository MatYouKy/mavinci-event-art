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

    // Sprawdź czy konto istnieje
    const { data: emailAccount, error: accountError } = await supabase
      .from("employee_email_accounts")
      .select("*")
      .eq("id", emailAccountId)
      .maybeSingle();

    if (accountError || !emailAccount) {
      throw new Error("Email account not found");
    }

    // UWAGA: Biblioteki IMAP nie działają w Supabase Edge Functions
    // Zwracamy informacyjną wiadomość z instrukcją

    return new Response(
      JSON.stringify({
        success: false,
        error: "IMAP libraries are not compatible with Supabase Edge Functions",
        message: "Pobieranie emaili przez IMAP nie jest obecnie możliwe w środowisku Supabase Edge Functions. Zalecane rozwiązania:",
        solutions: [
          "1. Użyj Gmail API (wymaga OAuth2)",
          "2. Użyj zewnętrznego serwisu do synchronizacji emaili",
          "3. Skonfiguruj przekierowanie emaili do Supabase przez webhook",
          "4. Użyj dedykowanego serwera z Node.js do pobierania emaili"
        ],
        accountInfo: {
          email: emailAccount.email_address,
          host: emailAccount.imap_host,
          port: emailAccount.imap_port
        }
      }),
      {
        status: 501,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error in fetch-emails:", error);

    const errorMessage = error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : "Unknown error";

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString()
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