import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface EmailAccount {
  id: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
  email_address: string;
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

    const account = emailAccount as EmailAccount;

    // Próba użycia imap-simple zamiast starej biblioteki imap
    const imapSimple = await import("npm:imap-simple@5.1.0");
    const { simpleParser } = await import("npm:mailparser@3.6.5");

    const config = {
      imap: {
        user: account.imap_username,
        password: account.imap_password,
        host: account.imap_host,
        port: account.imap_port,
        tls: account.imap_use_ssl,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
      },
    };

    console.log("Connecting to IMAP server...", account.imap_host);

    const connection = await imapSimple.connect(config);

    console.log("Opening INBOX...");
    await connection.openBox("INBOX");

    const searchCriteria = ["ALL"];
    const fetchOptions = {
      bodies: ["HEADER", "TEXT"],
      markSeen: false,
      struct: true,
    };

    console.log("Searching for messages...");
    const messages = await connection.search(searchCriteria, fetchOptions);

    console.log(`Found ${messages.length} messages`);

    // Ogranicz do ostatnich 50 wiadomości
    const recentMessages = messages.slice(-50);

    const emails = [];

    for (const item of recentMessages) {
      const all = item.parts.find((part: any) => part.which === "");
      if (all && all.body) {
        try {
          const parsed = await simpleParser(all.body);
          emails.push({
            from: parsed.from?.text || "",
            to: parsed.to?.text || "",
            subject: parsed.subject || "(No subject)",
            date: parsed.date,
            text: parsed.text || "",
            html: parsed.html || "",
            messageId: parsed.messageId || `${Date.now()}-${Math.random()}`,
          });
        } catch (parseError) {
          console.error("Error parsing email:", parseError);
        }
      }
    }

    connection.end();

    console.log(`Parsed ${emails.length} emails successfully`);

    return new Response(
      JSON.stringify({
        success: true,
        emails: emails,
        count: emails.length,
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

    const errorStack = error instanceof Error ? error.stack : undefined;

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        details: errorStack,
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