import {
  KSEF_API_BASE_URL_TEST,
  KSEF_API_BASE_URL_PROD,
  KSEF_TIMEOUT_MS,
} from "./config";
import { getErrorMessage, KSEF_LOG_PREFIX } from "./logger";
import type {
  KSeFChallengeResponse,
  KSeFTokenAuthResponse,
  KSeFAuthStatusResponse,
  KSeFPublicKeyCertificate,
  KSeFExceptionResponse,
  KSeFRedeemTokensResponse,
  KSeFSessionOpenOnlineResponse,
  KSeFInvoiceSendResponse,
  KSeFSessionCloseResponse,
} from "./types";

function getBaseUrl(isTestEnvironment: boolean) {
  return isTestEnvironment ? KSEF_API_BASE_URL_TEST : KSEF_API_BASE_URL_PROD;
}

export async function ksefFetch<T>(
  path: string,
  init: RequestInit,
  options: {
    isTestEnvironment: boolean;
    context?: Record<string, unknown>;
  }
): Promise<T> {
  const baseUrl = getBaseUrl(options.isTestEnvironment);
  const url = `${baseUrl}${path}`;
  const context = options.context ?? {};

  console.log(`${KSEF_LOG_PREFIX} fetch start`, {
    url,
    method: init.method ?? "GET",
    environment: options.isTestEnvironment ? "test" : "production",
    ...context,
  });

  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(KSEF_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    console.error(`${KSEF_LOG_PREFIX} transport error`, {
      url,
      method: init.method ?? "GET",
      environment: options.isTestEnvironment ? "test" : "production",
      message: getErrorMessage(error),
      ...context,
    });
    throw new Error(`KSeF transport error: ${getErrorMessage(error)}`);
  }

  const contentType = response.headers.get("content-type") || "";

  console.log(`${KSEF_LOG_PREFIX} fetch response`, {
    url,
    method: init.method ?? "GET",
    status: response.status,
    ok: response.ok,
    contentType,
    environment: options.isTestEnvironment ? "test" : "production",
    ...context,
  });

  if (!response.ok) {
    const raw = await response.text();

    console.error(`${KSEF_LOG_PREFIX} api error response`, {
      url,
      status: response.status,
      body: raw,
      environment: options.isTestEnvironment ? "test" : "production",
      ...context,
    });

    throw new Error(`KSeF API error ${response.status}: ${raw}`);
  }

  if (!contentType.includes("application/json")) {
    const raw = await response.text();

    console.error(`${KSEF_LOG_PREFIX} unexpected content-type`, {
      url,
      status: response.status,
      contentType,
      body: raw,
      environment: options.isTestEnvironment ? "test" : "production",
      ...context,
    });

    throw new Error(`Unexpected KSeF content-type: ${contentType}`);
  }

  return (await response.json()) as T;
}

export async function getKSeFChallenge(
  isTestEnvironment: boolean,
  context?: Record<string, unknown>
): Promise<KSeFChallengeResponse> {
  return await ksefFetch<KSeFChallengeResponse>(
    "/auth/challenge",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
    },
    { isTestEnvironment, context }
  );
}

// TO JEST KLUCZOWA ZMIANA:
export async function getKSeFPublicKeyCertificates(
  isTestEnvironment: boolean,
  context?: Record<string, unknown>
): Promise<KSeFPublicKeyCertificate[]> {
  return await ksefFetch<KSeFPublicKeyCertificate[]>(
    "/security/public-key-certificates",
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
    { isTestEnvironment, context }
  );
}

export async function authenticateWithKSeFToken(
  params: {
    encryptedToken: string;
    challenge: string;
    nip: string;
  },
  isTestEnvironment: boolean,
  context?: Record<string, unknown>
): Promise<KSeFTokenAuthResponse> {
  return await ksefFetch<KSeFTokenAuthResponse>(
    "/auth/ksef-token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        challenge: params.challenge,
        contextIdentifier: {
          type: "Nip",
          value: params.nip,
        },
        encryptedToken: params.encryptedToken,
      }),
    },
    { isTestEnvironment, context }
  );
}

export async function getKSeFAuthStatus(
  referenceNumber: string,
  authenticationToken: string,
  isTestEnvironment: boolean,
  context?: Record<string, unknown>
): Promise<KSeFAuthStatusResponse> {
  return await ksefFetch<KSeFAuthStatusResponse>(
    `/auth/${referenceNumber}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${authenticationToken}`,
      },
    },
    { isTestEnvironment, context }
  );
}

export async function redeemKSeFAuthToken(
  authenticationToken: string,
  isTestEnvironment: boolean,
  context?: Record<string, unknown>
): Promise<KSeFRedeemTokensResponse> {
  return await ksefFetch<KSeFRedeemTokensResponse>(
    "/auth/token/redeem",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${authenticationToken}`,
      },
    },
    { isTestEnvironment, context }
  );
}

export async function openKSeFOnlineSession(
  accessToken: string,
  invoiceVersion: "v2" | "v3",
  isTestEnvironment: boolean,
  context?: Record<string, unknown>
): Promise<KSeFSessionOpenOnlineResponse> {
  return await ksefFetch<KSeFSessionOpenOnlineResponse>(
    "/sessions/online",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ invoiceVersion }),
    },
    { isTestEnvironment, context }
  );
}

export async function sendKSeFInvoiceInSession(
  sessionReferenceNumber: string,
  invoiceXml: string,
  accessToken: string,
  isTestEnvironment: boolean,
  context?: Record<string, unknown>
): Promise<KSeFInvoiceSendResponse> {
  return await ksefFetch<KSeFInvoiceSendResponse>(
    `/sessions/online/${sessionReferenceNumber}/invoices`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: invoiceXml,
    },
    { isTestEnvironment, context }
  );
}

export async function getKSeFInvoiceStatus(
  sessionReferenceNumber: string,
  invoiceReferenceNumber: string,
  accessToken: string,
  isTestEnvironment: boolean,
  context?: Record<string, unknown>
): Promise<any> {
  return await ksefFetch<any>(
    `/sessions/${sessionReferenceNumber}/invoices/${invoiceReferenceNumber}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { isTestEnvironment, context }
  );
}

export async function closeKSeFOnlineSession(
  sessionReferenceNumber: string,
  accessToken: string,
  isTestEnvironment: boolean,
  context?: Record<string, unknown>
): Promise<KSeFSessionCloseResponse> {
  return await ksefFetch<KSeFSessionCloseResponse>(
    `/sessions/online/${sessionReferenceNumber}/close`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { isTestEnvironment, context }
  );
}

export async function getKSeFInvoices(
  params: {
    accessToken: string;
    subjectType: 'Subject1' | 'Subject2';
    dateFrom: string;
    dateTo: string;
    pageOffset?: number;
    pageSize?: number;
    sortOrder?: 'Asc' | 'Desc';
  },
  isTestEnvironment: boolean,
  context?: Record<string, unknown>
) {
  const searchParams = new URLSearchParams({
    sortOrder: params.sortOrder ?? 'Desc',
    pageOffset: String(params.pageOffset ?? 0),
    pageSize: String(params.pageSize ?? 100),
  });

  return await ksefFetch<any>(
    `/invoices/query/metadata?${searchParams.toString()}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({
        subjectType: params.subjectType,
        dateRange: {
          dateType: 'PermanentStorage',
          from: params.dateFrom,
          to: params.dateTo,
        },
      }),
    },
    { isTestEnvironment, context }
  );
}