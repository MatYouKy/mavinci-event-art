import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type JsonRecord = Record<string, unknown>;
type Direction = "credit" | "debit";
type DocumentSource = "ksef" | "crm" | "external";

type SafeTransaction = {
  ref: string;
  companyRef: string;
  date: string;
  direction: Direction;
  amount: number;
  remainingAmount: number;
  currency: string;
  counterparty: string;
  title: string;
  mappedCounterparty: string;
  mappingAlias: string;
  accountingNote: string;
  accountingCategory: string;
  accountingReviewStatus: "pending" | "explained";
};

type SafeDocument = {
  ref: string;
  companyRef: string;
  source: DocumentSource;
  number: string;
  issueDate: string;
  dueDate: string;
  direction: Direction;
  amount: number;
  grossAmount: number;
  settledAmount: number;
  currency: string;
  counterparty: string;
  paymentStatus: string;
  documentKind: string;
  settlementDocumentNumbers: string[];
  sourceDocumentNumbers: string[];
  requiresKsefReview: boolean;
  accountingNote: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
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

function safeText(value: unknown, maxLength: number) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeMoney(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(Math.min(Math.abs(number), 1_000_000_000) * 100) / 100;
}

function safeCurrency(value: unknown) {
  const currency = safeText(value, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "PLN";
}

function safeDate(value: unknown) {
  const date = safeText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function prepareTransactions(value: unknown): SafeTransaction[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 160).flatMap((item, index) => {
    const direction = item?.direction === "credit"
      ? "credit"
      : item?.direction === "debit"
      ? "debit"
      : null;
    const amount = safeMoney(item?.amount);
    const remainingAmount = Math.min(safeMoney(item?.remainingAmount), amount);
    if (!direction || amount <= 0 || remainingAmount <= 0) return [];
    return [{
      ref: /^T\d{1,4}$/.test(item?.ref) ? item.ref : `T${index + 1}`,
      companyRef: /^F\d{1,3}$/.test(item?.companyRef) ? item.companyRef : "F0",
      date: safeDate(item?.date),
      direction,
      amount,
      remainingAmount,
      currency: safeCurrency(item?.currency),
      counterparty: safeText(item?.counterparty, 100),
      title: safeText(item?.title, 180),
      mappedCounterparty: safeText(item?.mappedCounterparty, 160),
      mappingAlias: safeText(item?.mappingAlias, 120),
      accountingNote: safeText(item?.accountingNote, 600),
      accountingCategory: safeText(item?.accountingCategory, 40),
      accountingReviewStatus: item?.accountingReviewStatus === "explained" ? "explained" : "pending",
    }];
  });
}

function prepareDocuments(value: unknown): SafeDocument[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 320).flatMap((item, index) => {
    const direction = item?.direction === "credit"
      ? "credit"
      : item?.direction === "debit"
      ? "debit"
      : null;
    const source = ["ksef", "crm", "external"].includes(item?.source)
      ? item.source as DocumentSource
      : null;
    const amount = safeMoney(item?.amount);
    if (!direction || !source || amount <= 0) return [];
    const settlementDocumentNumbers = Array.isArray(item?.settlementDocumentNumbers)
      ? item.settlementDocumentNumbers.slice(0, 12).map((entry: unknown) => safeText(entry, 80)).filter(Boolean)
      : [];
    const sourceDocumentNumbers = Array.isArray(item?.sourceDocumentNumbers)
      ? item.sourceDocumentNumbers.slice(0, 12).map((entry: unknown) => safeText(entry, 80)).filter(Boolean)
      : [];
    return [{
      ref: /^D\d{1,4}$/.test(item?.ref) ? item.ref : `D${index + 1}`,
      companyRef: /^F\d{1,3}$/.test(item?.companyRef) ? item.companyRef : "F0",
      source,
      number: safeText(item?.number, 80),
      issueDate: safeDate(item?.issueDate),
      dueDate: safeDate(item?.dueDate),
      direction,
      amount,
      grossAmount: Math.max(safeMoney(item?.grossAmount), amount),
      settledAmount: safeMoney(item?.settledAmount),
      currency: safeCurrency(item?.currency),
      counterparty: safeText(item?.counterparty, 100),
      paymentStatus: safeText(item?.paymentStatus, 30),
      documentKind: safeText(item?.documentKind, 30),
      settlementDocumentNumbers,
      sourceDocumentNumbers,
      requiresKsefReview: item?.requiresKsefReview === true,
      accountingNote: safeText(item?.accountingNote, 600),
    }];
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Brak autoryzacji" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiKey) return json({ error: "Brak sekretu OPENAI_API_KEY" }, 503);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const token = authorization.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Nieprawidłowa sesja" }, 401);

    const { data: canManageInvoices, error: permissionError } = await userClient.rpc(
      "can_manage_invoices",
    );
    if (permissionError || !canManageInvoices) {
      return json({ error: "Brak uprawnień do analizy rozliczeń" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const month = Number(body?.month);
    const year = Number(body?.year);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) {
      return json({ error: "Nieprawidłowy okres analizy" }, 400);
    }

    const transactions = prepareTransactions(body?.transactions);
    const documents = prepareDocuments(body?.documents);
    if (!transactions.length) {
      return json({ error: "Brak nierozliczonych transakcji do analizy" }, 400);
    }

    const snapshot = { month, year, transactions, documents };
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        likelyMatches: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              transactionRef: { type: "string" },
              documentRefs: { type: "array", minItems: 1, maxItems: 12, items: { type: "string" } },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              reason: { type: "string" },
              amountExplanation: { type: "string" },
              recommendedAction: { type: "string" },
            },
            required: ["transactionRef", "documentRefs", "confidence", "reason", "amountExplanation", "recommendedAction"],
          },
        },
        missingDocuments: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              transactionRef: { type: "string" },
              documentType: {
                type: "string",
                enum: ["invoice", "receipt", "foreign_invoice", "customs", "tax_or_zus", "payroll", "bank_fee", "other"],
              },
              priority: { type: "string", enum: ["high", "medium", "low"] },
              reason: { type: "string" },
              recommendedAction: { type: "string" },
            },
            required: ["transactionRef", "documentType", "priority", "reason", "recommendedAction"],
          },
        },
        reviewTransactions: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              transactionRef: { type: "string" },
              priority: { type: "string", enum: ["high", "medium", "low"] },
              reason: { type: "string" },
              recommendedAction: { type: "string" },
            },
            required: ["transactionRef", "priority", "reason", "recommendedAction"],
          },
        },
        reviewDocuments: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              documentRef: { type: "string" },
              priority: { type: "string", enum: ["high", "medium", "low"] },
              reason: { type: "string" },
              recommendedAction: { type: "string" },
            },
            required: ["documentRef", "priority", "reason", "recommendedAction"],
          },
        },
        warnings: { type: "array", maxItems: 12, items: { type: "string" } },
      },
      required: ["summary", "likelyMatches", "missingDocuments", "reviewTransactions", "reviewDocuments", "warnings"],
    };

    const model = Deno.env.get("OPENAI_BANK_ANALYSIS_MODEL") ||
      Deno.env.get("OPENAI_FINANCIAL_MODEL") ||
      "gpt-5.6-luna";
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
          "Jesteś ostrożnym asystentem uzgadniania płatności w polskim CRM.",
          "Analizujesz wyłącznie przekazany, zminimalizowany zestaw danych. Nie wymyślaj dokumentów ani faktów.",
          "Dopasowanie jest tylko sugestią do ręcznego zatwierdzenia, nigdy decyzją księgową ani podatkową.",
          "Łącz wyłącznie pozycje o tym samym companyRef i kierunku. Zwykle wymagaj tej samej waluty.",
          "Wyjątek stanowią dokumenty source=external w walucie obcej: możesz zaproponować płatność w PLN po przewalutowaniu tylko wtedy, gdy tytuł płatności jednoznacznie wskazuje sprzedawcę lub numer dokumentu. Nigdy nie opieraj takiej sugestii wyłącznie na kwocie; wskaż obie waluty i konieczność ręcznej kontroli kursu.",
          "Uwzględniaj płatności częściowe, opóźnione, przedpłaty oraz jeden przelew obejmujący kilka dokumentów, np. Allegro Pay.",
          "Pole document.amount oznacza aktualną kwotę do zapłaty lub dopłaty, a document.grossAmount pełną wartość brutto dokumentu. Dla faktur końcowych nie porównuj przelewu z pełnym brutto, jeżeli zaliczki obniżyły kwotę do dopłaty.",
          "Pola settlementDocumentNumbers i sourceDocumentNumbers opisują łańcuch proforma → faktura zaliczkowa → faktura końcowa. Traktuj taki łańcuch jako jedno rozliczenie, ale nie przypisuj ponownie wcześniej zapłaconej zaliczki.",
          "Dokładny numer faktury występujący w tytule przelewu jest silniejszym sygnałem niż sama zgodność kwoty. Najpierw porównaj pełny numer dokumentu, potem kontrahenta, kwotę i chronologię; nietypowy tytuł nie wyklucza dopasowania, ale wymaga innych zgodnych sygnałów.",
          "Nie proponuj wyłącznie na podstawie identycznej kwoty dokumentu wystawionego ponad 7 dni po płatności. Wyjątkiem jest sytuacja, gdy jego dokładny numer znajduje się w tytule przelewu; inaczej preferuj dokument z miesiąca płatności lub wcześniejszy i oznacz niepewność.",
          "Dokument CRM z requiresKsefReview=true nie ma potwierdzonego odpowiednika KSeF w przekazanych danych. Umieść go w reviewDocuments i zaleć sprawdzenie wysyłki lub wyłączenia z obowiązku; nie traktuj kopii CRM dokumentu KSeF jako osobnej faktury.",
          "Dokument może pochodzić z innego miesiąca niż płatność. Sama zgodność kwoty nie wystarcza do wysokiej pewności.",
          "Jeżeli numer i nazwa kontrahenta nie dają dopasowania, sprawdź dokumenty o identycznym document.amount, companyRef, kierunku i walucie. Taką pozycję możesz zwrócić jako likelyMatch wyłącznie z confidence=low oraz wyraźnym zaleceniem ręcznego sprawdzenia kontrahenta, numeru i daty.",
          "Dla wydatków bez dokumentu odróżniaj zakup od podatku, ZUS, wynagrodzenia, przelewu własnego, opłaty bankowej i wypłaty gotówki.",
          "Pola accountingNote i accountingCategory zawierają ręczny opis księgowy. Jeżeli accountingReviewStatus=explained i opis spójnie wyjaśnia opłatę bankową, podatek, ZUS, wynagrodzenie lub przelew własny, nie zgłaszaj braku faktury; zgłoś tylko rzeczywistą sprzeczność wymagającą kontroli.",
          "Pole mappedCounterparty pochodzi z ręcznie potwierdzonego szablonu aliasu bankowego opisanego w mappingAlias. Traktuj je jako mocny sygnał tożsamości kontrahenta, ale nadal sprawdzaj działalność, kierunek, walutę, kwotę i numer dokumentu.",
          "Dla zakupów zagranicznych, szczególnie z Chin, wskaż do sprawdzenia fakturę handlową, potwierdzenie płatności oraz dokumenty celne/importowe (jeżeli dotyczą), zamiast zakładać brak zwykłej polskiej faktury.",
          "Zwróć krótkie, konkretne uzasadnienia po polsku. Priorytet high oznacza pozycję, którą człowiek powinien sprawdzić najpierw.",
          "Odpowiedź musi być zwięzła: summary maksymalnie 3 zdania, a każde reason, amountExplanation, recommendedAction i warning maksymalnie 2 krótkie zdania.",
        ].join(" "),
        input: `Przeanalizuj uzgodnienie za ${month}/${year}. Dane:\n${JSON.stringify(snapshot)}`,
        reasoning: { effort: "low" },
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "bank_reconciliation_analysis",
            strict: true,
            schema,
          },
        },
        max_output_tokens: 16000,
      }),
    });

    if (!openAiResponse.ok) {
      const payload = await openAiResponse.json().catch(() => null) as JsonRecord | null;
      const upstreamError = payload?.error as JsonRecord | undefined;
      const upstreamMessage = typeof upstreamError?.message === "string"
        ? upstreamError.message
        : `OpenAI ${openAiResponse.status}`;
      throw new Error(upstreamMessage.slice(0, 500));
    }

    const responsePayload = await openAiResponse.json() as JsonRecord;
    if (responsePayload.status === "incomplete") {
      const incompleteDetails = responsePayload.incomplete_details as JsonRecord | undefined;
      const reason = typeof incompleteDetails?.reason === "string" ? incompleteDetails.reason : "unknown";
      if (reason === "max_output_tokens") {
        throw new Error("Analiza była zbyt obszerna i nie została ukończona. Spróbuj uruchomić ją ponownie.");
      }
      throw new Error("OpenAI nie ukończyło analizy. Spróbuj uruchomić ją ponownie.");
    }

    let result: JsonRecord;
    try {
      result = JSON.parse(responseText(responsePayload)) as JsonRecord;
    } catch (error) {
      console.error("Invalid structured OpenAI response", error);
      throw new Error("Odpowiedź AI była niepełna. Spróbuj uruchomić analizę ponownie.");
    }
    return json({ ...result, model, generated_at: new Date().toISOString() });
  } catch (error) {
    console.error("analyze-bank-reconciliation", error);
    return json({ error: error instanceof Error ? error.message : "Nieznany błąd" }, 500);
  }
});
