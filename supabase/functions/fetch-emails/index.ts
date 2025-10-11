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

    // Use imap library through npm
    const { default: Imap } = await import("npm:imap@0.8.19");
    const { inspect } = await import("node:util");
    const { simpleParser } = await import("npm:mailparser@3.6.5");

    const imap = new Imap({
      user: account.imap_username,
      password: account.imap_password,
      host: account.imap_host,
      port: account.imap_port,
      tls: account.imap_use_ssl,
      tlsOptions: { rejectUnauthorized: false },
    });

    const emails: any[] = [];

    const fetchEmails = () => {
      return new Promise((resolve, reject) => {
        imap.once("ready", () => {
          imap.openBox("INBOX", true, (err: any, box: any) => {
            if (err) {
              reject(err);
              return;
            }

            // Fetch last 50 emails
            const fetchLimit = 50;
            const totalMessages = box.messages.total;
            const start = Math.max(1, totalMessages - fetchLimit + 1);
            const end = totalMessages;

            if (totalMessages === 0) {
              resolve([]);
              imap.end();
              return;
            }

            const fetch = imap.seq.fetch(`${start}:${end}`, {
              bodies: "",
              struct: true,
            });

            fetch.on("message", (msg: any, seqno: number) => {
              let buffer = "";

              msg.on("body", (stream: any) => {
                stream.on("data", (chunk: any) => {
                  buffer += chunk.toString("utf8");
                });
              });

              msg.once("end", async () => {
                try {
                  const parsed = await simpleParser(buffer);
                  emails.push({
                    from: parsed.from?.text || "",
                    to: parsed.to?.text || "",
                    subject: parsed.subject || "(No subject)",
                    date: parsed.date,
                    text: parsed.text || "",
                    html: parsed.html || "",
                    messageId: parsed.messageId,
                  });
                } catch (parseError) {
                  console.error("Error parsing email:", parseError);
                }
              });
            });

            fetch.once("error", (err: any) => {
              reject(err);
            });

            fetch.once("end", () => {
              imap.end();
            });
          });
        });

        imap.once("error", (err: any) => {
          reject(err);
        });

        imap.once("end", () => {
          resolve(emails);
        });

        imap.connect();
      });
    };

    const fetchedEmails = await fetchEmails();

    return new Response(
      JSON.stringify({ 
        success: true, 
        emails: fetchedEmails,
        count: fetchedEmails.length
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
