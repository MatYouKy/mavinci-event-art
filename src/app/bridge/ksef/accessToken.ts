import type { SupabaseClient } from '@supabase/supabase-js';
import {
  authenticateWithKSeFToken,
  getKSeFAuthStatus,
  getKSeFChallenge,
  getKSeFPublicKeyCertificates,
  redeemKSeFAuthToken,
} from './client';
import { encryptKSeFTokenPayloadFromCertificate } from './crypto';

/**
 * Token dostępu KSeF dla zapytań serwera CRM (UPO, sesje): zapisany w ksef_credentials, a gdy wygasł albo KSeF odpowie
 * 401 — nowy z tokenu KSeF działalności (ten sam przebieg co przy wysyłce faktury). Wymaga klienta z kluczem serwisowym.
 */

export interface KsefCredentialsRow {
  id: string;
  nip: string;
  token: string | null;
  is_test_environment: boolean | null;
  access_token: string | null;
  access_token_valid_until: string | null;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function reauthenticateKsef(
  supabase: SupabaseClient<any>,
  credentials: KsefCredentialsRow,
  context: Record<string, unknown>,
): Promise<string> {
  if (!credentials.token) {
    throw new Error('Brak tokenu KSeF działalności — uwierzytelnij KSeF w panelu KSeF.');
  }
  const isTestEnv = credentials.is_test_environment ?? false;

  const challengeResponse = await getKSeFChallenge(isTestEnv, context);
  const certificates = await getKSeFPublicKeyCertificates(isTestEnv, context);
  const tokenEncryptionCert = certificates.find((cert) => cert.usage?.includes('KsefTokenEncryption'));
  if (!tokenEncryptionCert?.certificate) {
    throw new Error('Nie znaleziono certyfikatu KsefTokenEncryption');
  }

  const encryptedToken = encryptKSeFTokenPayloadFromCertificate(
    `${credentials.token}|${challengeResponse.timestampMs}`,
    tokenEncryptionCert.certificate,
  );
  const authResponse = await authenticateWithKSeFToken(
    { encryptedToken, challenge: challengeResponse.challenge, nip: credentials.nip },
    isTestEnv,
    context,
  );
  if (!authResponse.authenticationToken?.token) {
    throw new Error('KSeF nie zwrócił authenticationToken');
  }

  // Uwierzytelnienie jest asynchroniczne (kod 100 = w toku).
  let statusCode: number | undefined;
  let statusDescription: string | undefined;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await wait(1500);
    const status = await getKSeFAuthStatus(
      authResponse.referenceNumber,
      authResponse.authenticationToken.token,
      isTestEnv,
      context,
    );
    statusCode = status.status?.code;
    statusDescription = status.status?.description;
    if (statusCode !== 100) break;
  }
  if (statusCode !== 200) {
    throw new Error(`KSeF auth status: ${statusCode} - ${statusDescription}`);
  }

  const redeemResponse = await redeemKSeFAuthToken(authResponse.authenticationToken.token, isTestEnv, context);
  const { error } = await (supabase.from as any)('ksef_credentials')
    .update({
      access_token: redeemResponse.accessToken.token,
      access_token_valid_until: redeemResponse.accessToken.validUntil,
      refresh_token: redeemResponse.refreshToken?.token ?? null,
      refresh_token_valid_until: redeemResponse.refreshToken?.validUntil ?? null,
      last_auth_reference_number: authResponse.referenceNumber,
      last_authenticated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', credentials.id);
  if (error) {
    throw new Error('Błąd podczas aktualizacji danych uwierzytelniających KSeF');
  }

  credentials.access_token = redeemResponse.accessToken.token;
  credentials.access_token_valid_until = redeemResponse.accessToken.validUntil;
  return redeemResponse.accessToken.token;
}

export async function withKsefAccessToken<T>(
  supabase: SupabaseClient<any>,
  credentials: KsefCredentialsRow,
  context: Record<string, unknown>,
  run: (accessToken: string) => Promise<T>,
): Promise<T> {
  const validUntil = credentials.access_token_valid_until ? Date.parse(credentials.access_token_valid_until) : 0;
  let accessToken = credentials.access_token && validUntil > Date.now() + 60_000 ? credentials.access_token : null;
  if (!accessToken) {
    accessToken = await reauthenticateKsef(supabase, credentials, context);
  }
  try {
    return await run(accessToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('KSeF API error 401')) throw error;
    accessToken = await reauthenticateKsef(supabase, credentials, context);
    return await run(accessToken);
  }
}
