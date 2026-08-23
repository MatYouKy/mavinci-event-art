import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SALES_CONFIDENCE_THRESHOLD = 0.75;
const MODEL = Deno.env.get("OPENAI_EMAIL_CLASSIFIER_MODEL") || "gpt-5.6-luna";

type JsonRecord = Record<string, unknown>;

interface QualificationJob {
  id: string;
  received_email_id: string;
  attempt_count: number;
}

interface Classification {
  is_sales_opportunity: boolean;
  intent: "event_inquiry" | "market_research" | "vendor" | "job_application" | "invoice" | "spam" | "other";
  confidence: number;
  summary: string;
  reasoning: string;
  customer_name: string | null;
  company_name: string | null;
  phone: string | null;
  event_type: string | null;
  event_date: string | null;
  location: string | null;
  budget: string | null;
  requested_services: string[];
  signals: string[];
}

function extractAddress(value: string | null): string {
  const source = value || "";
  return (source.match(/<([^>]+)>/)?.[1] || source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || source)
    .trim()
    .toLowerCase();
}

function extractName(value: string | null): string | null {
  if (!value) return null;
  const beforeAddress = value.replace(/<[^>]+>/g, "").replace(/^['"]|['"]$/g, "").trim();
  return beforeAddress && beforeAddress !== extractAddress(value) ? beforeAddress : null;
}

function normalizeSubject(value: string | null): string {
  return (value || "")
    .toLowerCase()
    .replace(/^((re|fw|fwd|odp|pd|przek)\s*:\s*)+/i, "")
    .trim();
}

function headerValue(headers: JsonRecord | null, names: string[]): string {
  if (!headers) return "";
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, value] of Object.entries(headers)) {
    if (wanted.has(key.toLowerCase())) {
      return Array.isArray(value) ? value.join(" ") : String(value || "");
    }
  }
  return "";
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

function splitName(displayName: string | null, email: string): { first_name: string; last_name: string } {
  const fallback = email.split("@")[0].replace(/[._-]+/g, " ").trim() || "Kontakt";
  const parts = (displayName || fallback).split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] || "Kontakt",
    last_name: parts.slice(1).join(" ") || "(e-mail)",
  };
}

async function classifyEmail(
  email: JsonRecord,
  senderEmail: string,
  priorContext: JsonRecord[],
): Promise<Classification> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY Edge Function secret");

  const compactHistory = priorContext.slice(0, 6).map((item) => ({
    date: item.received_date || item.created_at,
    subject: item.subject || item.title,
    result: item.inquiry_stage || item.status,
    lost_reason: item.lost_reason,
    excerpt: String(item.body_text || item.description || "").slice(0, 500),
  }));

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      is_sales_opportunity: { type: "boolean" },
      intent: {
        type: "string",
        enum: ["event_inquiry", "market_research", "vendor", "job_application", "invoice", "spam", "other"],
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      summary: { type: "string" },
      reasoning: { type: "string" },
      customer_name: { type: ["string", "null"] },
      company_name: { type: ["string", "null"] },
      phone: { type: ["string", "null"] },
      event_type: { type: ["string", "null"] },
      event_date: { type: ["string", "null"] },
      location: { type: ["string", "null"] },
      budget: { type: ["string", "null"] },
      requested_services: { type: "array", items: { type: "string" } },
      signals: { type: "array", items: { type: "string" } },
    },
    required: [
      "is_sales_opportunity", "intent", "confidence", "summary", "reasoning", "customer_name",
      "company_name", "phone", "event_type", "event_date", "location", "budget",
      "requested_services", "signals",
    ],
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text: [
              "Jesteś kwalifikatorem sprzedaży firmy eventowej Mavinci.",
              "Rozpoznaj wyłącznie nowe, realne zapytania o organizację lub obsługę wydarzenia.",
              "Badanie rynku bez konkretnej intencji zakupu oznacz jako market_research.",
              "Faktury, oferty dostawców, rekrutację, spam i zwykłą korespondencję oznacz jako niesprzedażowe.",
              "Nie dopowiadaj brakujących danych. Uzasadnienie ma być krótkie i bez danych wrażliwych.",
            ].join(" "),
          }],
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text: JSON.stringify({
              sender: senderEmail,
              subject: email.subject,
              body: String(email.body_text || "").slice(0, 12000),
              previous_contact_context: compactHistory,
            }),
          }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "email_sales_qualification",
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }

  return JSON.parse(responseText(await response.json())) as Classification;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    if (!req.headers.get("Authorization")) throw new Error("Missing authorization header");
    const requestBody = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(Number(requestBody.batchSize) || 10, 1), 25);

    const { data: jobs, error: claimError } = await supabase.rpc("claim_email_ai_qualification", {
      batch_size: batchSize,
    });
    if (claimError) throw claimError;

    const results: JsonRecord[] = [];
    for (const job of (jobs || []) as QualificationJob[]) {
      try {
        const { data: email, error: emailError } = await supabase
          .from("received_emails")
          .select("*")
          .eq("id", job.received_email_id)
          .single();
        if (emailError || !email) throw emailError || new Error("Received email not found");

        const senderEmail = extractAddress(email.from_address);
        const senderName = extractName(email.from_address);
        const normalizedSubject = normalizeSubject(email.subject);
        const headers = (email.raw_headers || {}) as JsonRecord;
        const references = `${headerValue(headers, ["in-reply-to"])} ${headerValue(headers, ["references"])}`.trim();
        const hasReplySubject = /^\s*(re|odp)\s*:/i.test(email.subject || "");

        let conversation = null;
        let currentMessageAlreadyLinked = false;
        let priorReceivedEmail: { id: string; message_id: string | null; received_date: string } | null = null;

        const { data: currentMessageLink } = await supabase
          .from("email_sales_conversation_messages")
          .select("conversation_id")
          .eq("received_email_id", email.id)
          .maybeSingle();
        if (currentMessageLink?.conversation_id) {
          const { data } = await supabase
            .from("email_sales_conversations")
            .select("*")
            .eq("id", currentMessageLink.conversation_id)
            .single();
          conversation = data;
          currentMessageAlreadyLinked = Boolean(data);
        }

        if (!conversation && references) {
          const referenceIds = references.match(/<[^>]+>/g) || [references];
          const { data: linkedMessage } = await supabase
            .from("email_sales_conversation_messages")
            .select("conversation_id")
            .in("message_id", referenceIds)
            .limit(1)
            .maybeSingle();
          if (linkedMessage?.conversation_id) {
            const { data } = await supabase
              .from("email_sales_conversations")
              .select("*")
              .eq("id", linkedMessage.conversation_id)
              .single();
            conversation = data;
          }
        }

        if (!conversation && hasReplySubject) {
          const { data } = await supabase
            .from("email_sales_conversations")
            .select("*")
            .eq("email_account_id", email.email_account_id)
            .ilike("participant_email", senderEmail)
            .eq("normalized_subject", normalizedSubject)
            .gte("last_message_at", new Date(Date.now() - 365 * 86400000).toISOString())
            .order("last_message_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          conversation = data;
        }

        let isContinuation = Boolean(conversation) && !currentMessageAlreadyLinked;
        if (!conversation && (references || hasReplySubject)) {
          const escapedSender = senderEmail.replace(/[%_]/g, "\\$&");
          const { data: priorEmail } = await supabase
            .from("received_emails")
            .select("id, message_id, received_date")
            .eq("email_account_id", email.email_account_id)
            .neq("id", email.id)
            .ilike("from_address", `%${escapedSender}%`)
            .gte("received_date", new Date(Date.now() - 365 * 86400000).toISOString())
            .limit(1)
            .maybeSingle();
          priorReceivedEmail = priorEmail;
          isContinuation = Boolean(priorEmail);
        }

        if (!conversation) {
          const { data, error } = await supabase
            .from("email_sales_conversations")
            .insert({
              email_account_id: email.email_account_id,
              participant_email: senderEmail,
              participant_name: senderName,
              normalized_subject: normalizedSubject,
              first_message_at: email.received_date,
              last_message_at: email.received_date,
            })
            .select("*")
            .single();
          if (error) throw error;
          conversation = data;
        }

        const { error: messageLinkError } = await supabase.from("email_sales_conversation_messages").insert({
          conversation_id: conversation.id,
          received_email_id: email.id,
          direction: "incoming",
          message_id: email.message_id,
          message_at: email.received_date,
        });
        if (messageLinkError && messageLinkError.code !== "23505") throw messageLinkError;

        if (priorReceivedEmail) {
          const { error: priorLinkError } = await supabase.from("email_sales_conversation_messages").insert({
            conversation_id: conversation.id,
            received_email_id: priorReceivedEmail.id,
            direction: "incoming",
            message_id: priorReceivedEmail.message_id,
            message_at: priorReceivedEmail.received_date,
          });
          if (priorLinkError && priorLinkError.code !== "23505") throw priorLinkError;
        }

        await supabase.from("email_sales_conversations").update({
          participant_name: conversation.participant_name || senderName,
          last_message_at: email.received_date,
          updated_at: new Date().toISOString(),
        }).eq("id", conversation.id);

        if (isContinuation) {
          await supabase.from("email_ai_qualifications").update({
            conversation_id: conversation.id,
            status: "skipped_continuation",
            is_new_thread: false,
            is_sales_opportunity: false,
            summary: "Kontynuacja istniejącej korespondencji",
            reasoning: "Wiadomość zawiera nagłówki odpowiedzi lub pasuje do istniejącego wątku.",
            processed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", job.id);
          results.push({ id: job.id, status: "skipped_continuation" });
          continue;
        }

        const escapedSender = senderEmail.replace(/[%_]/g, "\\$&");
        const [{ data: priorEmails }, { data: priorInquiries }, { data: priorConversations }] = await Promise.all([
          supabase.from("received_emails")
            .select("subject, body_text, received_date")
            .neq("id", email.id)
            .ilike("from_address", `%${escapedSender}%`)
            .order("received_date", { ascending: false })
            .limit(6),
          supabase.from("tasks")
            .select("title, description, inquiry_stage, lost_reason, created_at")
            .eq("is_inquiry", true)
            .contains("inquiry_details", { client_email: senderEmail })
            .order("created_at", { ascending: false })
            .limit(6),
          supabase.from("email_sales_conversations")
            .select("status, outcome_reason, ai_summary, last_message_at")
            .eq("email_account_id", email.email_account_id)
            .ilike("participant_email", senderEmail)
            .neq("id", conversation.id)
            .order("last_message_at", { ascending: false })
            .limit(6),
        ]);

        const classification = await classifyEmail(email, senderEmail, [
          ...(priorInquiries || []),
          ...(priorConversations || []).map((item) => ({
            created_at: item.last_message_at,
            title: "Poprzedni wątek korespondencji",
            description: item.ai_summary,
            status: item.status,
            lost_reason: item.outcome_reason,
          })),
          ...(priorEmails || []),
        ]);

        let contact = null;
        let organization = null;
        let inquiry = null;

        const { data: existingContact } = await supabase
          .from("contacts")
          .select("id, first_name, last_name, email")
          .ilike("email", senderEmail)
          .limit(1)
          .maybeSingle();
        contact = existingContact;

        if (!contact && classification.is_sales_opportunity && classification.confidence >= SALES_CONFIDENCE_THRESHOLD) {
          const names = splitName(classification.customer_name || senderName, senderEmail);
          const { data, error } = await supabase.from("contacts").insert({
            ...names,
            email: senderEmail,
            phone: classification.phone,
            tags: ["zapytanie-email-ai"],
            notes: "Kontakt utworzony automatycznie na podstawie zakwalifikowanej wiadomości e-mail.",
          }).select("id, first_name, last_name, email").single();
          if (error) throw error;
          contact = data;
        }

        if (classification.company_name) {
          const { data } = await supabase.from("organizations")
            .select("id, name")
            .ilike("name", classification.company_name)
            .limit(1)
            .maybeSingle();
          organization = data;
        }

        if (contact && organization) {
          await supabase.from("contact_organizations").upsert({
            contact_id: contact.id,
            organization_id: organization.id,
            is_current: true,
          }, { onConflict: "contact_id,organization_id" });
        }

        const shouldCreateInquiry = classification.is_sales_opportunity
          && classification.intent === "event_inquiry"
          && classification.confidence >= SALES_CONFIDENCE_THRESHOLD;

        if (shouldCreateInquiry) {
          const { data: existingInquiry } = await supabase.from("tasks")
            .select("id")
            .eq("is_inquiry", true)
            .contains("inquiry_details", { received_email_id: email.id })
            .limit(1)
            .maybeSingle();

          inquiry = existingInquiry;

          const { data: admin } = await supabase.from("employees")
            .select("id")
            .eq("is_active", true)
            .or("role.eq.admin,access_level.eq.admin")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();

          const description = [
            `Źródło: e-mail ${senderEmail}`,
            `Temat: ${email.subject || "(bez tematu)"}`,
            classification.customer_name ? `Klient: ${classification.customer_name}` : null,
            classification.company_name ? `Firma: ${classification.company_name}` : null,
            classification.phone ? `Telefon: ${classification.phone}` : null,
            classification.event_type ? `Rodzaj wydarzenia: ${classification.event_type}` : null,
            classification.event_date ? `Termin: ${classification.event_date}` : null,
            classification.location ? `Miejsce: ${classification.location}` : null,
            classification.budget ? `Budżet: ${classification.budget}` : null,
            classification.requested_services.length ? `Zakres: ${classification.requested_services.join(", ")}` : null,
            "",
            classification.summary,
            "",
            "Treść wiadomości:",
            String(email.body_text || "Brak treści").slice(0, 8000),
          ].filter((line) => line !== null).join("\n");

          if (!inquiry) {
            const { data, error } = await supabase.from("tasks").insert({
              title: `Zapytanie e-mail: ${classification.event_type || email.subject || senderEmail}`.slice(0, 500),
              description: description.slice(0, 10000),
              priority: "urgent",
              status: "todo",
              board_column: "todo",
              order_index: 0,
              created_by: admin?.id || null,
              is_inquiry: true,
              inquiry_stage: "new",
              inquiry_owner_id: null,
              next_action_at: new Date(Date.now() + 2 * 3600000).toISOString(),
              win_probability: Math.max(10, Math.min(80, Math.round(classification.confidence * 70))),
              inquiry_details: {
                source_kind: "email_ai",
                received_email_id: email.id,
                conversation_id: conversation.id,
                contact_id: contact?.id || null,
                organization_id: organization?.id || null,
                client_text: classification.customer_name || senderName,
                client_email: senderEmail,
                client_phone: classification.phone,
                client_company: classification.company_name,
                event_type: classification.event_type,
                event_date: classification.event_date,
                location: classification.location,
                budget: classification.budget,
                requested_services: classification.requested_services,
                ai_confidence: classification.confidence,
                ai_reasoning: classification.reasoning,
              },
            }).select("id").single();
            if (error) throw error;
            inquiry = data;
          }
        }

        const previousLostReason = (priorInquiries || []).find((item) => item.lost_reason)?.lost_reason
          || (priorConversations || []).find((item) => item.outcome_reason)?.outcome_reason
          || null;
        const qualificationStatus = (
          classification.is_sales_opportunity && classification.confidence < SALES_CONFIDENCE_THRESHOLD
        ) || classification.confidence < 0.55
          ? "manual_review"
          : "classified";
        const conversationStatus = classification.intent === "market_research"
          ? "market_research"
          : inquiry
          ? "qualified"
          : "non_sales";

        await supabase.from("email_sales_conversations").update({
          contact_id: contact?.id || null,
          organization_id: organization?.id || null,
          inquiry_id: inquiry?.id || null,
          status: conversationStatus,
          is_market_research: classification.intent === "market_research",
          ai_summary: classification.summary,
          updated_at: new Date().toISOString(),
        }).eq("id", conversation.id);

        await supabase.from("email_ai_qualifications").update({
          conversation_id: conversation.id,
          status: qualificationStatus,
          intent: classification.intent,
          is_new_thread: true,
          is_sales_opportunity: classification.is_sales_opportunity,
          confidence: classification.confidence,
          summary: classification.summary,
          reasoning: classification.reasoning,
          extracted_data: {
            ...classification,
            crm_context: {
              previous_inquiries: (priorInquiries || []).length,
              previous_conversations: (priorConversations || []).length,
              previous_emails: (priorEmails || []).length,
              previous_lost_reason: previousLostReason,
            },
          },
          model: MODEL,
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);

        results.push({ id: job.id, status: qualificationStatus, inquiry_id: inquiry?.id || null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const finalFailure = job.attempt_count >= 3;
        await supabase.from("email_ai_qualifications").update({
          status: finalFailure ? "failed" : "pending",
          last_error: message.slice(0, 2000),
          claimed_at: null,
          processed_at: finalFailure ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);
        results.push({ id: job.id, status: finalFailure ? "failed" : "retry", error: message });
      }
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("AI email qualification failed:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
