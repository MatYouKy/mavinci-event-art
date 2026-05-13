import {
  KSEF_API_BASE_URL_TEST,
  KSEF_API_BASE_URL_PROD,
  KSEF_TIMEOUT_MS,
} from './config';
import { getErrorMessage, KSEF_LOG_PREFIX } from './logger';
import type {
  KSeFChallengeResponse,
  KSeFTokenAuthResponse,
  KSeFAuthStatusResponse,
  KSeFPublicKeyCertificate,
  KSeFRedeemTokensResponse,
  KSeFSessionOpenOnlineRequest,
  KSeFSessionOpenOnlineResponse,
  KSeFSendInvoiceResponse,
  KSeFSessionStatusResponse,
  KSeFSessionInvoicesResponse,
  KSeFFormCode,
} from './types';
import type { EncryptedInvoicePayload, SymmetricKeyMaterial } from './crypto';

function getBaseUrl(isTestEnvironment: boolean) {
  return isTestEnvironment ? KSEF_API_BASE_URL_TEST : KSEF_API_BASE_URL_PROD;
}

export async function ksefFetch<T>(
  path: string,
  init: RequestInit,
  options: {
    isTestEnvironment: boolean;
    context?: Record<string, unknown>;
  },
): Promise<T> {
  const baseUrl = getBaseUrl(options.isTestEnvironment);
  const url = `${baseUrl}${path}`;
  const context = options.context ?? {};

  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(KSEF_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    console.error(`${KSEF_LOG_PREFIX} transport error`, {
      url,
      method: init.method ?? 'GET',
      environment: options.isTestEnvironment ? 'test' : 'production',
      message: getErrorMessage(error),
      ...context,
    });

    throw new Error(`KSeF transport error: ${getErrorMessage(error)}`);
  }

  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    const raw = await response.text();

    console.error(`${KSEF_LOG_PREFIX} api error response`, {
      url,
      status: response.status,
      body: raw,
      environment: options.isTestEnvironment ? 'test' : 'production',
      ...context,
    });

    throw new Error(`KSeF API error ${response.status}: ${raw}`);
  }

  // 204 No Content - poprawna odpowiedź bez body
  if (response.status === 204) {
    return undefined as T;
  }

  const raw = await response.text();

  // puste body też traktujemy jako poprawną odpowiedź
  if (!raw.trim()) {
    return undefined as T;
  }

  if (!contentType.includes('application/json')) {
    console.error(`${KSEF_LOG_PREFIX} unexpected content-type`, {
      url,
      status: response.status,
      contentType,
      body: raw,
      environment: options.isTestEnvironment ? 'test' : 'production',
      ...context,
    });

    throw new Error(`Unexpected KSeF content-type: ${contentType}`);
  }

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error(`${KSEF_LOG_PREFIX} invalid json response`, {
      url,
      status: response.status,
      contentType,
      body: raw,
      environment: options.isTestEnvironment ? 'test' : 'production',
      message: getErrorMessage(error),
      ...context,
    });

    throw new Error(`Invalid KSeF JSON response: ${getErrorMessage(error)}`);
  }
}

export async function getKSeFChallenge(
  isTestEnvironment: boolean,
  context?: Record<string, unknown>,
): Promise<KSeFChallengeResponse> {
  return await ksefFetch<KSeFChallengeResponse>(
    '/auth/challenge',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
    },
    { isTestEnvironment, context },
  );
}

export async function getKSeFPublicKeyCertificates(
  isTestEnvironment: boolean,
  context?: Record<string, unknown>,
): Promise<KSeFPublicKeyCertificate[]> {
  return await ksefFetch<KSeFPublicKeyCertificate[]>(
    '/security/public-key-certificates',
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
    { isTestEnvironment, context },
  );
}

export async function authenticateWithKSeFToken(
  params: {
    encryptedToken: string;
    challenge: string;
    nip: string;
  },
  isTestEnvironment: boolean,
  context?: Record<string, unknown>,
): Promise<KSeFTokenAuthResponse> {
  return await ksefFetch<KSeFTokenAuthResponse>(
    '/auth/ksef-token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        challenge: params.challenge,
        contextIdentifier: {
          type: 'Nip',
          value: params.nip,
        },
        encryptedToken: params.encryptedToken,
      }),
    },
    { isTestEnvironment, context },
  );
}

export async function getKSeFAuthStatus(
  referenceNumber: string,
  authenticationToken: string,
  isTestEnvironment: boolean,
  context?: Record<string, unknown>,
): Promise<KSeFAuthStatusResponse> {
  return await ksefFetch<KSeFAuthStatusResponse>(
    `/auth/${referenceNumber}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${authenticationToken}`,
      },
    },
    { isTestEnvironment, context },
  );
}

export async function redeemKSeFAuthToken(
  authenticationToken: string,
  isTestEnvironment: boolean,
  context?: Record<string, unknown>,
): Promise<KSeFRedeemTokensResponse> {
  return await ksefFetch<KSeFRedeemTokensResponse>(
    '/auth/token/redeem',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${authenticationToken}`,
      },
    },
    { isTestEnvironment, context },
  );
}

export async function openKSeFOnlineSession(
  accessToken: string,
  formCode: KSeFFormCode,
  encryptionMaterial: SymmetricKeyMaterial,
  isTestEnvironment: boolean,
  context?: Record<string, unknown>,
): Promise<KSeFSessionOpenOnlineResponse> {
  const requestBody: KSeFSessionOpenOnlineRequest = {
    formCode,
    encryption: {
      encryptedSymmetricKey: encryptionMaterial.encryptedSymmetricKey,
      initializationVector: encryptionMaterial.initializationVectorBase64,
    },
  };

  return await ksefFetch<KSeFSessionOpenOnlineResponse>(
    '/sessions/online',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    },
    { isTestEnvironment, context },
  );
}

export async function sendKSeFInvoiceInSession(
  sessionReferenceNumber: string,
  encryptedInvoice: EncryptedInvoicePayload,
  accessToken: string,
  isTestEnvironment: boolean,
  context?: Record<string, unknown>,
): Promise<KSeFSendInvoiceResponse> {
  return await ksefFetch<KSeFSendInvoiceResponse>(
    `/sessions/online/${sessionReferenceNumber}/invoices`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(encryptedInvoice),
    },
    { isTestEnvironment, context },
  );
}

export async function getKSeFSessionStatus(
  sessionReferenceNumber: string,
  accessToken: string,
  isTestEnvironment: boolean,
  context?: Record<string, unknown>,
): Promise<KSeFSessionStatusResponse> {
  return await ksefFetch<KSeFSessionStatusResponse>(
    `/sessions/${sessionReferenceNumber}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { isTestEnvironment, context },
  );
}

export async function getKSeFSessionInvoices(
  sessionReferenceNumber: string,
  accessToken: string,
  isTestEnvironment: boolean,
  context?: Record<string, unknown>,
): Promise<KSeFSessionInvoicesResponse> {
  return await ksefFetch<KSeFSessionInvoicesResponse>(
    `/sessions/${sessionReferenceNumber}/invoices`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { isTestEnvironment, context },
  );
}

export async function closeKSeFOnlineSession(
  sessionReferenceNumber: string,
  accessToken: string,
  isTestEnvironment: boolean,
  context?: Record<string, unknown>,
): Promise<void> {
  await ksefFetch<unknown>(
    `/sessions/online/${sessionReferenceNumber}/close`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { isTestEnvironment, context },
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
  context?: Record<string, unknown>,
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
    { isTestEnvironment, context },
  );
}