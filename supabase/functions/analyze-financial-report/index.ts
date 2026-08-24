import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type JsonRecord = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function responseText(payload: JsonRecord): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output as JsonRecord[]) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content as JsonRecord[]) {
      if (typeof part.text === "string") return part.text;
    }
  }
  throw new Error("OpenAI response did not contain structured output");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Brak autoryzacji" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiKey) return json({ error: "Brak sekretu OPENAI_API_KEY" }, 503);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Nieprawidłowa sesja" }, 401);

    const { data: employee, error: employeeError } = await serviceClient
      .from("employees")
      .select("id,role,access_level,permissions,is_active")
      .or(`id.eq.${userData.user.id},auth_user_id.eq.${userData.user.id}`)
      .eq("is_active", true)
      .maybeSingle();
    if (employeeError || !employee) return json({ error: "Nie znaleziono aktywnego pracownika" }, 403);

    const permissions = Array.isArray(employee.permissions) ? employee.permissions : [];
    const canView = employee.role === "admin" || employee.access_level === "admin" ||
      permissions.some((permission: string) => ["admin", "finances_manage", "invoices_manage", "invoices_view", "ksef_manage"].includes(permission));
    if (!canView) return json({ error: "Brak uprawnień do finansów" }, 403);

    const body = await req.json().catch(() => ({}));
    const currentYear = new Date().getFullYear();
    const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(body.date_from || "") ? body.date_from : `${currentYear}-01-01`;
    const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(body.date_to || "") ? body.date_to : `${currentYear}-12-31`;
    const companyIds = Array.isArray(body.company_ids) ? body.company_ids.slice(0, 20) : null;

    const { data: report, error: reportError } = await userClient.rpc("get_financial_report", {
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_company_ids: companyIds,
    });
    if (reportError || !report) throw reportError || new Error("Brak danych raportu");

    // Do OpenAI trafia wyłącznie ekonomiczna treść pozycji: nazwa i łączna wartość.
    // Nie wysyłamy nagłówków faktur, kontrahentów, NIP-ów, numerów dokumentów,
    // danych klientów, dat, identyfikatorów ani surowych plików.
    const costItems = (report.expense_items || []).slice(0, 100).map((item: JsonRecord) => ({
      item: item.name,
      cost: item.amount,
    }));
    const revenueItems = (report.revenue_items || []).slice(0, 100).map((item: JsonRecord) => ({
      item: item.name,
      revenue: item.amount,
    }));
    if (costItems.length === 0 && revenueItems.length === 0) {
      return json({ error: "Brak pozycji finansowych do analizy w wybranym okresie" }, 422);
    }

    const analysisInput = {
      cost_items: costItems,
      revenue_items: revenueItems,
    };

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        insights: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              severity: { type: "string", enum: ["info", "warning", "opportunity"] },
              title: { type: "string" },
              description: { type: "string" },
              recommendation: { type: "string" },
            },
            required: ["severity", "title", "description", "recommendation"],
          },
        },
      },
      required: ["summary", "insights"],
    };

    const model = Deno.env.get("OPENAI_FINANCIAL_MODEL") || "gpt-5.6-luna";
    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        instructions: [
          "Jesteś analitykiem zarządczym firmy eventowej.",
          "Analizuj wyłącznie przekazane nazwy pozycji faktur i odpowiadające im kwoty kosztów lub przychodów.",
          "Wskaż, na jakie pozycje firma wydaje najwięcej oraz które pozycje generują największy przychód.",
          "Nie zgaduj kontrahentów, klientów, rentowności, trendów ani przepływów pieniężnych, ponieważ te dane nie zostały przekazane.",
          "Nie udzielaj porad podatkowych ani księgowych i nie traktuj korelacji jako przyczyny.",
          "Rekomendacje mają być konkretne, krótkie i możliwe do wykonania w CRM.",
        ].join(" "),
        input: JSON.stringify(analysisInput),
        text: {
          format: {
            type: "json_schema",
            name: "financial_management_analysis",
            strict: true,
            schema,
          },
        },
      }),
    });

    if (!openAiResponse.ok) {
      throw new Error(`OpenAI ${openAiResponse.status}: ${(await openAiResponse.text()).slice(0, 500)}`);
    }

    const result = JSON.parse(responseText(await openAiResponse.json()));
    return json({ ...result, model, generated_at: new Date().toISOString() });
  } catch (error) {
    console.error("analyze-financial-report", error);
    return json({ error: error instanceof Error ? error.message : "Nieznany błąd" }, 500);
  }
});
