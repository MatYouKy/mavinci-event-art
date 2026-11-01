import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface GeneratePdfRequest {
  contractId: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { contractId }: GeneratePdfRequest = await req.json();

    if (!contractId) {
      throw new Error("contractId is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // Umowę czytamy z uprawnieniami wywołującego, nie kluczem service_role: o dostępie decyduje
    // RLS tabeli contracts (crm_contract_permission('view'), zakres marek i rekordów, blokada
    // portalu sprzedawcy). Wcześniej każdy z publicznym kluczem anon mógł pobrać dowolną umowę.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = token
      ? await supabase.auth.getUser(token)
      : { data: { user: null }, error: null };
    if (userError || !userData.user) {
      return new Response(
        JSON.stringify({ success: false, error: "Zaloguj się ponownie." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: contract, error } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", contractId)
      .maybeSingle();

    if (error || !contract) {
      throw new Error("Contract not found");
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Please generate PDF on client side using html2pdf.js",
        contract: contract
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error:", error);
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