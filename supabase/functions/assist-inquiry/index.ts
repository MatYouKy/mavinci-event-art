import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type JsonRecord = Record<string, unknown>;
type Action = "recommend" | "improve_email" | "draft_product_offer_content" | "draft_offer_assumptions";

const json = (body: JsonRecord, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const responseText = (payload: JsonRecord): string => {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of (Array.isArray(payload.output) ? payload.output : []) as JsonRecord[]) {
    for (const part of (Array.isArray(item.content) ? item.content : []) as JsonRecord[]) {
      if (typeof part.text === "string") return part.text;
    }
  }
  throw new Error("Model nie zwrócił odpowiedzi tekstowej");
};

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;

const sanitizeInquiryText = (value: unknown) => String(value || "")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[adres e-mail pominięty]")
  .replace(/(?:\+?48[\s-]?)?(?:\d[\s-]?){9}\b/g, "[numer telefonu pominięty]")
  .replace(/\b\d{11}\b/g, "[identyfikator pominięty]")
  .slice(0, 12000);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Brak autoryzacji" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "Brak sekretu OPENAI_API_KEY" }, 503);

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Nieprawidłowa sesja" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: employee } = await admin
      .from("employees")
      .select("id, role, access_level, permissions, is_active")
      .eq("id", authData.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!employee) return json({ error: "Brak aktywnego profilu pracownika" }, 403);

    const body = await req.json().catch(() => ({})) as {
      inquiryId?: string;
      productId?: string;
      action?: Action;
      subject?: string;
      draft?: string;
      currentContent?: {
        short_description?: string;
        description?: string;
        benefits?: string[];
        image_alt?: string;
      };
      context?: {
        event_category?: string;
        product_names?: string[];
      };
    };
    if (!body.action) return json({ error: "Brak action" }, 400);

    const permissions = Array.isArray(employee.permissions) ? employee.permissions : [];
    const canManageOffers =
      employee.role === "admin" ||
      employee.access_level === "admin" ||
      permissions.includes("admin") ||
      permissions.includes("offers_manage");

    const recommendationSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        event_assumptions: { type: "string" },
        event_goal: { type: "string" },
        preliminary_estimate: {
          type: "object",
          additionalProperties: false,
          properties: {
            min_net: { type: "number", minimum: 0 },
            max_net: { type: "number", minimum: 0 },
            summary: { type: "string" },
            basis: { type: "array", items: { type: "string" } },
          },
          required: ["min_net", "max_net", "summary", "basis"],
        },
        missing_information: { type: "array", items: { type: "string" } },
        suggested_products: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              product_id: { type: "string" },
              name: { type: "string" },
              reason: { type: "string" },
            },
            required: ["product_id", "name", "reason"],
          },
        },
        suggested_resources: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              resource_id: { type: "string" },
              name: { type: "string" },
              reason: { type: "string" },
            },
            required: ["resource_id", "name", "reason"],
          },
        },
        next_actions: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "event_assumptions", "event_goal", "preliminary_estimate", "missing_information", "suggested_products", "suggested_resources", "next_actions", "risks"],
    };

    const emailSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["subject", "body"],
    };

    const productOfferContentSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        short_description: { type: "string" },
        description: { type: "string" },
        benefits: { type: "array", items: { type: "string" } },
        image_alt: { type: "string" },
      },
      required: ["short_description", "description", "benefits", "image_alt"],
    };

    const offerAssumptionsSchema = {
      type: "object",
      additionalProperties: false,
      properties: {
        assumptions: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              key: {
                type: "string",
                enum: [
                  "guest_count", "event_hours", "client_needs", "event_format", "agenda",
                  "venue", "audience", "engagement", "brand_visibility", "guest_experience",
                  "online_participants", "technical_scope", "special_requirements", "custom",
                ],
              },
              label: { type: "string" },
              value: { type: "string", maxLength: 250 },
              badge_value: { type: "string" },
            },
            required: ["key", "label", "value", "badge_value"],
          },
        },
      },
      required: ["assumptions"],
    };

    let systemInstruction = "";
    let userPayload: JsonRecord = {};
    let outputSchema: JsonRecord = recommendationSchema;
    let outputName = "inquiry_recommendations";

    if (body.action === "draft_product_offer_content") {
      if (!body.productId) return json({ error: "Brak productId" }, 400);

      if (!canManageOffers) {
        return json({ error: "Brak uprawnienia do edycji produktów ofertowych" }, 403);
      }

      // Pracownik zostal zweryfikowany powyzej. Pobieramy tylko stabilne dane katalogowe;
      // zatwierdzona i niezapisana tresc prezentacyjna przychodzi jawnie z edytora.
      const { data: product, error: productError } = await admin
        .from("offer_products")
        .select("id, name, description, unit, tags")
        .eq("id", body.productId)
        .maybeSingle();
      if (productError) {
        console.error("draft product lookup error", {
          productId: body.productId,
          message: productError.message,
        });
        return json({ error: "Nie udało się pobrać produktu z CRM" }, 500);
      }
      if (!product) {
        return json({ error: "Nie znaleziono produktu w CRM" }, 404);
      }

      systemInstruction = [
        "Jesteś redaktorem ofert polskiej firmy eventowej Mavinci.",
        "Na podstawie wyłącznie przekazanych danych przygotuj zwięzłą, konkretną treść karty produktu po polsku.",
        "Nie wymyślaj parametrów, zakresu, cen, ilości, terminów, dostępności, gwarancji ani obietnic.",
        "Jeżeli danych jest mało, pisz zachowawczo i nie uzupełniaj braków domysłami.",
        "Opis ma być gotowy do pokazania klientowi, bez HTML, bez nagłówków i bez marketingowych superlatywów.",
        "Zwróć od 2 do 5 krótkich korzyści wynikających bezpośrednio z danych produktu.",
      ].join(" ");
      userPayload = {
        product: {
          id: product.id,
          name: product.name,
          catalog_description: product.description,
          unit: product.unit,
          tags: product.tags,
          editor_content: body.currentContent || {},
        },
      };
      outputSchema = productOfferContentSchema;
      outputName = "product_offer_content_draft";
    } else if (body.action === "draft_offer_assumptions") {
      if (!canManageOffers) {
        return json({ error: "Brak uprawnienia do edycji ofert" }, 403);
      }

      const eventCategory = String(body.context?.event_category || '').trim().slice(0, 100);
      const productNames = (Array.isArray(body.context?.product_names) ? body.context.product_names : [])
        .map((name) => String(name).trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 30);
      let inquiryContext: JsonRecord | null = null;
      if (body.inquiryId) {
        // Zapytanie pobieramy w kontekście zalogowanego pracownika. RLS rozstrzyga dostęp,
        // a do modelu nie przekazujemy pól kontaktowych ani identyfikatorów klienta.
        const { data: inquiry, error: inquiryError } = await authClient
          .from("tasks")
          .select("id, title, description, inquiry_details, inquiry_stage, estimated_value")
          .eq("id", body.inquiryId)
          .eq("is_inquiry", true)
          .maybeSingle();
        if (inquiryError || !inquiry) {
          return json({ error: "Nie znaleziono zapytania lub brak dostępu" }, 404);
        }
        const details = asRecord(inquiry.inquiry_details) || {};
        const detailKeys = [
          "scope", "event_type", "termin", "location_text", "event_assumptions", "event_goal",
          "estimated_budget", "participants", "guest_count", "hours", "requirements",
        ];
        inquiryContext = {
          title: sanitizeInquiryText(inquiry.title),
          description: sanitizeInquiryText(inquiry.description),
          details: Object.fromEntries(detailKeys
            .filter((key) => details[key] !== undefined && details[key] !== null && details[key] !== "")
            .map((key) => [key, sanitizeInquiryText(details[key])])),
          stage: inquiry.inquiry_stage,
          estimated_value: inquiry.estimated_value,
        };
      }

      systemInstruction = [
        "Jesteś doświadczonym producentem wydarzeń i doradcą sprzedażowym firmy Mavinci.",
        "Na podstawie dostępnego kontekstu zapytania, kategorii wydarzenia i nazw wybranych produktów przygotuj dokładnie trzy różne założenia biznesowe.",
        "Założenia mają pomagać klientowi zrozumieć format realizacji, korzyść, priorytet albo ogólny zakres techniczny.",
        "Pisz po polsku, konkretnie i językiem korzyści, bez pustych sloganów.",
        "Nie wymyślaj liczby osób, godzin, miejsca, cen, parametrów technicznych ani szczegółów, których nie ma w danych.",
        "Nie używaj w odpowiedzi nazwisk, adresów e-mail, numerów telefonu ani innych danych osobowych.",
        "Treść każdego pola value musi być zwarta, mieć maksymalnie 250 znaków i mieścić się w czterech krótkich wierszach oferty PDF.",
        "Nie powtarzaj kluczy. Preferuj event_format, client_needs, guest_experience, technical_scope, engagement albo brand_visibility.",
        "badge_value może zawierać maksymalnie 7 znaków; bez potwierdzonej wartości zwróć pusty tekst.",
        "Dla klucza custom podaj krótki własny label, dla pozostałych label może być pusty.",
      ].join(" ");
      userPayload = {
        inquiry: inquiryContext,
        event_category: eventCategory,
        selected_product_names: productNames,
      };
      outputSchema = offerAssumptionsSchema;
      outputName = "offer_business_assumptions_draft";
    } else {
      if (!body.inquiryId) return json({ error: "Brak inquiryId" }, 400);

      // Pobranie przez klienta użytkownika jest istotne: RLS rozstrzyga, czy pracownik
      // ma prawo zobaczyć zapytanie. Service role nie służy tu do obchodzenia dostępu.
      const { data: inquiry, error: inquiryError } = await authClient
        .from("tasks")
        .select("id, title, description, inquiry_details, inquiry_stage, estimated_value, contact_id, organization_id")
        .eq("id", body.inquiryId)
        .eq("is_inquiry", true)
        .maybeSingle();
      if (inquiryError || !inquiry) {
        return json({ error: "Nie znaleziono zapytania lub brak dostępu" }, 404);
      }

      const inquiryContext = {
        title: inquiry.title,
        description: inquiry.description,
        details: inquiry.inquiry_details,
        stage: inquiry.inquiry_stage,
        estimated_value: inquiry.estimated_value,
      };

      if (body.action === "improve_email") {
        systemInstruction = [
          "Jesteś asystentem sprzedaży polskiej firmy eventowej Mavinci.",
          "Popraw wiadomość tak, by była konkretna, uprzejma i poprawna językowo.",
          "Nie dopowiadaj cen, dostępności, zakresu ani obietnic, których nie ma w danych.",
          "Zachowaj intencję autora i zwykły tekst bez HTML oraz bez stopki.",
        ].join(" ");
        userPayload = {
          inquiry: inquiryContext,
          current_subject: body.subject || "",
          current_draft: body.draft || "",
        };
        outputSchema = emailSchema;
        outputName = "inquiry_email_draft";
      } else {
        const [productsResult, equipmentResult] = await Promise.all([
          authClient
            .from("offer_products")
            .select("id, name, description, base_price, unit, tags, is_active")
            .eq("is_active", true)
            .limit(250),
          authClient
            .from("equipment_items")
            .select("id, name, description, brand, model")
            .eq("is_active", true)
            .limit(250),
        ]);

        systemInstruction = [
          "Jesteś asystentem sprzedaży i produkcji wydarzeń firmy Mavinci.",
          "Analizuj wyłącznie dane zapytania i dostarczony katalog.",
          "Proponuj tylko produkty i zasoby obecne w katalogu; zachowaj ich identyfikatory.",
          "Ustal zwięzłe założenia wydarzenia i jego cel jako roboczą treść gotową do dalszej edycji w CRM.",
          "Przygotuj niewiążące widełki wstępnego kosztorysu netto w PLN na podstawie cen produktów z katalogu oraz zakresu zapytania.",
          "Pole preliminary_estimate.summary ma wyjaśniać klientowi, co obejmują widełki, a basis ma wymieniać najważniejsze założenia wyceny.",
          "Wartość min_net nie może być większa niż max_net. Nie dodawaj do wyceny produktów spoza katalogu ani cen, których nie można uzasadnić danymi katalogowymi.",
          "Jeśli brakuje ilości lub zakresu, przyjmij ostrożny wariant roboczy, wyraźnie opisz go w basis i dodaj brak do missing_information.",
          "Nie deklaruj dostępności terminowej. Wskaż brakujące dane i ryzyka zamiast zgadywać.",
          "Nie ujawniaj danych osobowych w podsumowaniu.",
        ].join(" ");
        userPayload = {
          inquiry: inquiryContext,
          product_catalog: (productsResult.data || []).map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            price: item.base_price,
            unit: item.unit,
            tags: item.tags,
          })),
          resource_catalog: (equipmentResult.data || []).map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            brand: item.brand,
            model: item.model,
          })),
        };
      }
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_INQUIRY_ASSISTANT_MODEL") || "gpt-5-mini",
        store: false,
        input: [
          { role: "system", content: [{ type: "input_text", text: systemInstruction }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify(userPayload) }] },
        ],
        text: {
          format: {
            type: "json_schema",
            name: outputName,
            strict: true,
            schema: outputSchema,
          },
        },
      }),
    });
    if (!response.ok) {
      const responsePayload = await response.json().catch(() => null);
      const upstreamError = asRecord(asRecord(responsePayload)?.error);
      const upstreamCode = typeof upstreamError?.code === "string" ? upstreamError.code : "";
      const upstreamType = typeof upstreamError?.type === "string" ? upstreamError.type : "";
      const requestId = response.headers.get("x-request-id");
      console.error("assist-inquiry upstream error", {
        status: response.status,
        code: upstreamCode || null,
        type: upstreamType || null,
        requestId,
      });
      if (response.status === 429) {
        const quotaErrors = new Set([
          "insufficient_quota",
          "credit_balance_exhausted",
          "organization_spend_limit_exceeded",
          "project_spend_limit_exceeded",
          "organization_usage_limit_exceeded",
        ]);
        if (quotaErrors.has(upstreamCode) || upstreamType === "insufficient_quota") {
          return json({
            error: "Brak dostępnego budżetu OpenAI API. Uzupełnij środki lub zwiększ limit projektu AI.",
            error_code: "ai_quota_exceeded",
            retryable: false,
          }, 429);
        }

        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterSeconds = retryAfterHeader && /^\d+$/.test(retryAfterHeader)
          ? Number(retryAfterHeader)
          : null;
        return json({
          error: "Limit liczby zapytań AI został chwilowo przekroczony. Spróbuj ponownie za moment.",
          error_code: "ai_rate_limited",
          retryable: true,
          ...(retryAfterSeconds !== null ? { retry_after_seconds: retryAfterSeconds } : {}),
        }, 429);
      }
      if (response.status === 401 || response.status === 403) {
        return json({ error: "Usługa AI wymaga poprawnej konfiguracji", error_code: "ai_configuration_error" }, 503);
      }
      return json({ error: "Usługa AI nie odpowiedziała prawidłowo", error_code: "ai_upstream_error" }, 502);
    }

    return json({ result: JSON.parse(responseText(await response.json())) });
  } catch (error) {
    console.error("assist-inquiry error", error);
    return json({ error: "Nie udało się przygotować treści AI", error_code: "ai_processing_error" }, 500);
  }
});
