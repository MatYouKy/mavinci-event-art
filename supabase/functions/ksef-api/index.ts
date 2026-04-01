import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const KSEF_TEST_URL = "https://ksef-test.mf.gov.pl/api";
const KSEF_PROD_URL = "https://ksef.mf.gov.pl/api";

interface KSeFCredentials {
  nip: string;
  token: string;
  is_test_environment: boolean;
  session_token?: string;
  session_expires_at?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const organizationId = url.searchParams.get("organizationId");

    if (!organizationId) {
      throw new Error("Organization ID is required");
    }

    const { data: credentials, error: credError } = await supabaseClient
      .from("ksef_credentials")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .single();

    if (credError || !credentials) {
      throw new Error("KSeF credentials not found for this organization");
    }

    const baseUrl = credentials.is_test_environment ? KSEF_TEST_URL : KSEF_PROD_URL;

    switch (action) {
      case "authenticate":
        return await authenticate(supabaseClient, credentials, baseUrl);

      case "get-issued-invoices":
        return await getIssuedInvoices(supabaseClient, credentials, baseUrl, req);

      case "get-received-invoices":
        return await getReceivedInvoices(supabaseClient, credentials, baseUrl, req);

      case "issue-invoice":
        return await issueInvoice(supabaseClient, credentials, baseUrl, req);

      case "get-invoice-xml":
        return await getInvoiceXml(supabaseClient, credentials, baseUrl, req);

      default:
        throw new Error("Invalid action");
    }
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function authenticate(
  supabase: any,
  credentials: KSeFCredentials,
  baseUrl: string
) {
  try {
    const response = await fetch(`${baseUrl}/online/Session/InitToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contextIdentifier: {
          type: "onip",
          identifier: credentials.nip,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Authentication failed: ${error}`);
    }

    const data = await response.json();
    const sessionToken = data.sessionToken?.token;
    const expiresIn = data.sessionToken?.context?.contextIdentifier?.timeoutToken || 3600;

    if (!sessionToken) {
      throw new Error("No session token received");
    }

    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + expiresIn);

    await supabase
      .from("ksef_credentials")
      .update({
        session_token: sessionToken,
        session_expires_at: expiresAt.toISOString(),
      })
      .eq("nip", credentials.nip);

    await fetch(`${baseUrl}/online/Session/AuthorisationChallenge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "SessionToken": sessionToken,
      },
      body: JSON.stringify({
        contextIdentifier: {
          type: "onip",
          identifier: credentials.nip,
        },
      }),
    });

    const authResponse = await fetch(`${baseUrl}/online/Session/InitSessionToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "SessionToken": sessionToken,
      },
      body: JSON.stringify({
        token: credentials.token,
      }),
    });

    if (!authResponse.ok) {
      const error = await authResponse.text();
      throw new Error(`Session initialization failed: ${error}`);
    }

    return new Response(
      JSON.stringify({ success: true, sessionToken }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Authentication error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}

async function getIssuedInvoices(
  supabase: any,
  credentials: KSeFCredentials,
  baseUrl: string,
  req: Request
) {
  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");

  if (!credentials.session_token) {
    throw new Error("No active session. Please authenticate first.");
  }

  const queryParams = new URLSearchParams();
  if (dateFrom) queryParams.append("invoicingDateFrom", dateFrom);
  if (dateTo) queryParams.append("invoicingDateTo", dateTo);

  const response = await fetch(
    `${baseUrl}/online/Query/Invoice/Issued?${queryParams.toString()}`,
    {
      method: "GET",
      headers: {
        "SessionToken": credentials.session_token,
        "Accept": "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch issued invoices: ${error}`);
  }

  const data = await response.json();

  const syncLogId = crypto.randomUUID();
  await supabase.from("ksef_sync_log").insert({
    id: syncLogId,
    sync_type: "issued",
    status: "success",
    invoices_count: data.invoiceList?.length || 0,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });

  return new Response(
    JSON.stringify(data),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

async function getReceivedInvoices(
  supabase: any,
  credentials: KSeFCredentials,
  baseUrl: string,
  req: Request
) {
  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");

  if (!credentials.session_token) {
    throw new Error("No active session. Please authenticate first.");
  }

  const queryParams = new URLSearchParams();
  if (dateFrom) queryParams.append("acquisitionTimestampFrom", dateFrom);
  if (dateTo) queryParams.append("acquisitionTimestampTo", dateTo);

  const response = await fetch(
    `${baseUrl}/online/Query/Invoice/Received?${queryParams.toString()}`,
    {
      method: "GET",
      headers: {
        "SessionToken": credentials.session_token,
        "Accept": "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch received invoices: ${error}`);
  }

  const data = await response.json();

  const syncLogId = crypto.randomUUID();
  await supabase.from("ksef_sync_log").insert({
    id: syncLogId,
    sync_type: "received",
    status: "success",
    invoices_count: data.invoiceList?.length || 0,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });

  return new Response(
    JSON.stringify(data),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

async function issueInvoice(
  supabase: any,
  credentials: KSeFCredentials,
  baseUrl: string,
  req: Request
) {
  if (!credentials.session_token) {
    throw new Error("No active session. Please authenticate first.");
  }

  const body = await req.json();
  const { invoiceXml, invoiceId } = body;

  if (!invoiceXml) {
    throw new Error("Invoice XML is required");
  }

  const response = await fetch(`${baseUrl}/online/Invoice/Send`, {
    method: "POST",
    headers: {
      "SessionToken": credentials.session_token,
      "Content-Type": "application/xml",
    },
    body: invoiceXml,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to issue invoice: ${error}`);
  }

  const data = await response.json();
  const ksefReferenceNumber = data.elementReferenceNumber;

  if (invoiceId && ksefReferenceNumber) {
    await supabase.from("ksef_invoices").insert({
      invoice_id: invoiceId,
      ksef_reference_number: ksefReferenceNumber,
      invoice_type: "issued",
      xml_content: invoiceXml,
      sync_status: "synced",
      ksef_issued_at: new Date().toISOString(),
    });
  }

  return new Response(
    JSON.stringify(data),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

async function getInvoiceXml(
  supabase: any,
  credentials: KSeFCredentials,
  baseUrl: string,
  req: Request
) {
  if (!credentials.session_token) {
    throw new Error("No active session. Please authenticate first.");
  }

  const url = new URL(req.url);
  const ksefReferenceNumber = url.searchParams.get("ksefReferenceNumber");

  if (!ksefReferenceNumber) {
    throw new Error("KSeF reference number is required");
  }

  const response = await fetch(
    `${baseUrl}/online/Invoice/Get/${ksefReferenceNumber}`,
    {
      method: "GET",
      headers: {
        "SessionToken": credentials.session_token,
        "Accept": "application/xml",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch invoice XML: ${error}`);
  }

  const xml = await response.text();

  return new Response(
    JSON.stringify({ xml }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}
