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
  id: string;
  my_company_id: string;
  nip: string;
  token: string;
  is_test_environment: boolean;
  is_active?: boolean;
  session_token?: string;
  session_expires_at?: string;
}

const LOG_PREFIX = "[KSEF_EDGE]";

function mask(value?: string | null) {
  if (!value) return "null";
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTransientTransportError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();

  return [
    "http2 error",
    "stream no longer needed",
    "sendrequest",
    "error sending request",
    "connection reset",
    "broken pipe",
    "eof",
    "timed out",
    "timeout",
    "network error",
    "connection closed",
  ].some((part) => message.includes(part));
}

function createRequestId() {
  return crypto.randomUUID();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: {
    retries?: number;
    timeoutMs?: number;
    retryDelayMs?: number;
    requestId?: string;
    context?: Record<string, unknown>;
  }
) {
  const retries = options?.retries ?? 2;
  const timeoutMs = options?.timeoutMs ?? 15000;
  const retryDelayMs = options?.retryDelayMs ?? 1000;
  const requestId = options?.requestId ?? "unknown";
  const context = options?.context ?? {};

  let lastError: unknown;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      console.log(`${LOG_PREFIX} fetch attempt`, {
        requestId,
        url,
        method: init.method ?? "GET",
        attempt,
        maxAttempts: retries + 1,
        timeoutMs,
        ...context,
      });

      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });

      console.log(`${LOG_PREFIX} fetch response`, {
        requestId,
        url,
        method: init.method ?? "GET",
        attempt,
        status: response.status,
        ok: response.ok,
        ...context,
      });

      return response;
    } catch (error) {
      lastError = error;

      console.error(`${LOG_PREFIX} fetch transport error`, {
        requestId,
        url,
        method: init.method ?? "GET",
        attempt,
        maxAttempts: retries + 1,
        message: getErrorMessage(error),
        transient: isTransientTransportError(error),
        ...context,
      });

      if (attempt > retries || !isTransientTransportError(error)) {
        throw error;
      }

      await sleep(retryDelayMs * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown fetch error");
}

Deno.serve(async (req: Request) => {
  const requestId = createRequestId();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    console.log(`${LOG_PREFIX} request start`, {
      requestId,
      method: req.method,
      url: req.url,
      hasSupabaseUrl: !!supabaseUrl,
      hasServiceRoleKey: !!supabaseServiceRoleKey,
    });

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error(`${LOG_PREFIX} Missing Supabase env vars`, {
        requestId,
        hasSupabaseUrl: !!supabaseUrl,
        hasServiceRoleKey: !!supabaseServiceRoleKey,
      });
      throw new Error("Missing Supabase configuration");
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error(`${LOG_PREFIX} Missing authorization header`, { requestId });
      throw new Error("Missing authorization header");
    }

    const accessToken = authHeader.replace("Bearer ", "").trim();

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(accessToken);

    if (userError || !user) {
      console.error(`${LOG_PREFIX} Unauthorized`, {
        requestId,
        userError: userError?.message,
      });
      throw new Error("Unauthorized");
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const companyId = url.searchParams.get("companyId");

    console.log(`${LOG_PREFIX} Incoming request`, {
      requestId,
      action,
      companyId: mask(companyId),
      userId: user.id,
      method: req.method,
    });

    if (!companyId) {
      console.error(`${LOG_PREFIX} Missing companyId`, { requestId, action });
      throw new Error("Company ID is required");
    }

    const { data: credentials, error: credError } = await supabaseClient
      .from("ksef_credentials")
      .select("*")
      .eq("my_company_id", companyId)
      .eq("is_active", true)
      .maybeSingle();

    if (credError) {
      console.error(`${LOG_PREFIX} Error fetching credentials`, {
        requestId,
        companyId: mask(companyId),
        code: credError.code,
        message: credError.message,
        details: credError.details,
        hint: credError.hint,
      });
      throw new Error("Failed to fetch KSeF credentials");
    }

    if (!credentials) {
      console.error(`${LOG_PREFIX} Credentials not found`, {
        requestId,
        companyId: mask(companyId),
      });
      throw new Error("KSeF credentials not found for this company");
    }

    console.log(`${LOG_PREFIX} Credentials found`, {
      requestId,
      credentialsId: mask(credentials.id),
      companyId: mask(credentials.my_company_id),
      hasToken: !!credentials.token,
      hasSessionToken: !!credentials.session_token,
      hasSessionExpiresAt: !!credentials.session_expires_at,
      isTestEnvironment: !!credentials.is_test_environment,
      isActive: credentials.is_active ?? true,
    });

    const baseUrl = credentials.is_test_environment ? KSEF_TEST_URL : KSEF_PROD_URL;

    console.log(`${LOG_PREFIX} Selected environment`, {
      requestId,
      companyId: mask(credentials.my_company_id),
      environment: credentials.is_test_environment ? "test" : "production",
      baseUrl,
    });

    switch (action) {
      case "authenticate":
        return await authenticate(supabaseClient, credentials, baseUrl, requestId);

      default:
        console.error(`${LOG_PREFIX} Invalid action`, {
          requestId,
          action,
          companyId: mask(companyId),
        });
        throw new Error("Invalid action");
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Error`, {
      requestId,
      message: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
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
  baseUrl: string,
  requestId: string
) {
  try {
    console.log(`${LOG_PREFIX} authenticate start`, {
      requestId,
      companyId: mask(credentials.my_company_id),
      credentialsId: mask(credentials.id),
      nip: credentials.nip,
      hasToken: !!credentials.token,
      isTestEnvironment: credentials.is_test_environment,
      baseUrl,
    });

    const initTokenUrl = `${baseUrl}/online/Session/InitToken`;

    const initTokenResponse = await fetchWithRetry(
      initTokenUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          contextIdentifier: {
            type: "onip",
            identifier: credentials.nip,
          },
        }),
      },
      {
        retries: 2,
        timeoutMs: 15000,
        retryDelayMs: 1000,
        requestId,
        context: {
          stage: "InitToken",
          companyId: mask(credentials.my_company_id),
          nip: credentials.nip,
          isTestEnvironment: credentials.is_test_environment,
        },
      }
    );

    console.log(`${LOG_PREFIX} InitToken completed`, {
      requestId,
      companyId: mask(credentials.my_company_id),
      nip: credentials.nip,
      status: initTokenResponse.status,
      ok: initTokenResponse.ok,
    });

    if (!initTokenResponse.ok) {
      const errorText = await initTokenResponse.text();

      console.error(`${LOG_PREFIX} InitToken failed`, {
        requestId,
        companyId: mask(credentials.my_company_id),
        nip: credentials.nip,
        status: initTokenResponse.status,
        errorText,
      });

      throw new Error(`Authentication failed: ${errorText}`);
    }

    const initTokenData = await initTokenResponse.json();

    console.log(`${LOG_PREFIX} InitToken raw response received`, {
      requestId,
      companyId: mask(credentials.my_company_id),
      nip: credentials.nip,
      hasSessionTokenObject: !!initTokenData?.sessionToken,
      hasSessionTokenValue: !!initTokenData?.sessionToken?.token,
      hasTimeoutToken: !!initTokenData?.sessionToken?.context?.contextIdentifier?.timeoutToken,
    });

    const sessionToken = initTokenData?.sessionToken?.token;
    const expiresIn =
      initTokenData?.sessionToken?.context?.contextIdentifier?.timeoutToken || 3600;

    if (!sessionToken) {
      console.error(`${LOG_PREFIX} No session token received`, {
        requestId,
        companyId: mask(credentials.my_company_id),
        nip: credentials.nip,
        responseKeys:
          initTokenData && typeof initTokenData === "object"
            ? Object.keys(initTokenData)
            : null,
      });
      throw new Error("No session token received");
    }

    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + expiresIn);

    console.log(`${LOG_PREFIX} Session token extracted`, {
      requestId,
      companyId: mask(credentials.my_company_id),
      nip: credentials.nip,
      maskedSessionToken: mask(sessionToken),
      expiresIn,
      expiresAt: expiresAt.toISOString(),
    });

    const updateResult = await supabase
      .from("ksef_credentials")
      .update({
        session_token: sessionToken,
        session_expires_at: expiresAt.toISOString(),
      })
      .eq("my_company_id", credentials.my_company_id);

    if (updateResult.error) {
      console.error(`${LOG_PREFIX} Failed to persist session token`, {
        requestId,
        companyId: mask(credentials.my_company_id),
        nip: credentials.nip,
        code: updateResult.error.code,
        message: updateResult.error.message,
        details: updateResult.error.details,
        hint: updateResult.error.hint,
      });
      throw new Error("Failed to persist KSeF session token");
    }

    console.log(`${LOG_PREFIX} Session token persisted`, {
      requestId,
      companyId: mask(credentials.my_company_id),
      nip: credentials.nip,
    });

    const challengeUrl = `${baseUrl}/online/Session/AuthorisationChallenge`;

    const challengeResponse = await fetchWithRetry(
      challengeUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "SessionToken": sessionToken,
        },
        body: JSON.stringify({
          contextIdentifier: {
            type: "onip",
            identifier: credentials.nip,
          },
        }),
      },
      {
        retries: 1,
        timeoutMs: 15000,
        retryDelayMs: 800,
        requestId,
        context: {
          stage: "AuthorisationChallenge",
          companyId: mask(credentials.my_company_id),
          nip: credentials.nip,
        },
      }
    );

    console.log(`${LOG_PREFIX} AuthorisationChallenge completed`, {
      requestId,
      companyId: mask(credentials.my_company_id),
      nip: credentials.nip,
      status: challengeResponse.status,
      ok: challengeResponse.ok,
    });

    if (!challengeResponse.ok) {
      const errorText = await challengeResponse.text();

      console.error(`${LOG_PREFIX} AuthorisationChallenge failed`, {
        requestId,
        companyId: mask(credentials.my_company_id),
        nip: credentials.nip,
        status: challengeResponse.status,
        errorText,
      });

      throw new Error(`Authorisation challenge failed: ${errorText}`);
    }

    const initSessionUrl = `${baseUrl}/online/Session/InitSessionToken`;

    const authResponse = await fetchWithRetry(
      initSessionUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "SessionToken": sessionToken,
        },
        body: JSON.stringify({
          token: credentials.token,
        }),
      },
      {
        retries: 2,
        timeoutMs: 15000,
        retryDelayMs: 1000,
        requestId,
        context: {
          stage: "InitSessionToken",
          companyId: mask(credentials.my_company_id),
          nip: credentials.nip,
        },
      }
    );

    console.log(`${LOG_PREFIX} InitSessionToken completed`, {
      requestId,
      companyId: mask(credentials.my_company_id),
      nip: credentials.nip,
      status: authResponse.status,
      ok: authResponse.ok,
    });

    if (!authResponse.ok) {
      const errorText = await authResponse.text();

      console.error(`${LOG_PREFIX} InitSessionToken failed`, {
        requestId,
        companyId: mask(credentials.my_company_id),
        nip: credentials.nip,
        status: authResponse.status,
        errorText,
      });

      throw new Error(`Session initialization failed: ${errorText}`);
    }

    const authData = await authResponse.json();

    console.log(`${LOG_PREFIX} Authentication success`, {
      requestId,
      companyId: mask(credentials.my_company_id),
      nip: credentials.nip,
      responseKeys:
        authData && typeof authData === "object" ? Object.keys(authData) : null,
    });

    return new Response(
      JSON.stringify({
        success: true,
        sessionToken,
        sessionTokenMasked: mask(sessionToken),
        expiresAt: expiresAt.toISOString(),
        authData,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error(`${LOG_PREFIX} Authentication error`, {
      requestId,
      message: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
      nip: credentials.nip,
      companyId: mask(credentials.my_company_id),
      isTestEnvironment: credentials.is_test_environment,
      transientTransportError: isTransientTransportError(error),
    });

    return new Response(
      JSON.stringify({
        error: isTransientTransportError(error)
          ? "Błąd transportowy podczas połączenia z KSeF. Spróbuj ponownie za chwilę. Jeśli problem będzie się powtarzał w Supabase Edge Functions, przenieś integrację KSeF do backendu Node."
          : error instanceof Error
            ? error.message
            : "Authentication error",
        details: getErrorMessage(error),
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}