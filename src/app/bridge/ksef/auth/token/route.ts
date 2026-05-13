import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server.app";
import {
  getKSeFChallenge,
  authenticateWithKSeFToken,
  getKSeFAuthStatus,
  getKSeFPublicKeyCertificates,
  redeemKSeFAuthToken,
} from "../../client";
import { encryptKSeFTokenPayloadFromCertificate } from "../../crypto";
import { getErrorMessage, KSEF_LOG_PREFIX, mask } from "../../logger";
import type { KSeFCredentialsRow } from "../../types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  try {
    const body = await req.json().catch(() => null);
    const companyId =
      typeof body?.companyId === "string" ? body.companyId.trim() : "";

    if (!companyId) {
      return NextResponse.json(
        {
          success: false,
          error: "Brak companyId",
        },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const supabase = createSupabaseServerClient(cookieStore);

    const { data: credentials, error } = await supabase
      .from("ksef_credentials")
      .select("id, my_company_id, nip, token, is_test_environment, is_active")
      .eq("my_company_id", companyId)
      .eq("is_active", true)
      .maybeSingle<KSeFCredentialsRow>();

    if (error) {
      console.error(`${KSEF_LOG_PREFIX} credentials query error`, {
        requestId,
        companyId: mask(companyId),
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });

      return NextResponse.json(
        {
          success: false,
          error: "Nie udało się pobrać danych KSeF",
        },
        { status: 500 }
      );
    }

    if (!credentials) {
      console.error(`${KSEF_LOG_PREFIX} credentials not found`, {
        requestId,
        companyId: mask(companyId),
      });

      return NextResponse.json(
        {
          success: false,
          error: "Brak aktywnej konfiguracji KSeF dla tej firmy",
        },
        { status: 404 }
      );
    }

    if (!credentials.token?.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: "Brak tokenu KSeF w konfiguracji firmy",
        },
        { status: 400 }
      );
    }

    const challenge = await getKSeFChallenge(credentials.is_test_environment, {
      requestId,
      stage: "challenge",
      companyId: mask(credentials.my_company_id),
      nip: credentials.nip,
    });

    const publicKeyCertificates = await getKSeFPublicKeyCertificates(
      credentials.is_test_environment,
      {
        requestId,
        stage: "public-key-certificates",
        companyId: mask(credentials.my_company_id),
        nip: credentials.nip,
      }
    );

    const encryptionCertificate = publicKeyCertificates.find((cert) =>
      cert.usage?.includes("KsefTokenEncryption")
    );

    if (!encryptionCertificate) {
      console.error(`${KSEF_LOG_PREFIX} missing KsefTokenEncryption certificate`, {
        requestId,
        availableUsages: publicKeyCertificates.map((c) => c.usage),
      });

      return NextResponse.json(
        {
          success: false,
          error: "Nie znaleziono certyfikatu do szyfrowania tokenu KSeF",
        },
        { status: 500 }
      );
    }

    const plainToEncrypt = `${credentials.token}|${challenge.timestampMs}`;

    const encryptedToken = encryptKSeFTokenPayloadFromCertificate(
      plainToEncrypt,
      encryptionCertificate.certificate
    );

    const authStart = await authenticateWithKSeFToken(
      {
        encryptedToken,
        challenge: challenge.challenge,
        nip: credentials.nip,
      },
      credentials.is_test_environment,
      {
        requestId,
        stage: "auth-ksef-token",
        companyId: mask(credentials.my_company_id),
        nip: credentials.nip,
      }
    );

    if (!authStart.authenticationToken?.token) {
      return NextResponse.json(
        {
          success: false,
          error: "KSeF nie zwrócił authenticationToken",
        },
        { status: 500 }
      );
    }

    await wait(1500);

    const authStatus = await getKSeFAuthStatus(
      authStart.referenceNumber,
      authStart.authenticationToken.token,
      credentials.is_test_environment,
      {
        requestId,
        stage: "auth-status",
        companyId: mask(credentials.my_company_id),
        nip: credentials.nip,
      }
    );

    if (authStatus.status?.code !== 200) {
      return NextResponse.json({
        success: true,
        data: {
          referenceNumber: authStart.referenceNumber,
          authStatus,
          redeemed: false,
        },
      });
    }

    const redeemedTokens = await redeemKSeFAuthToken(
      authStart.authenticationToken.token,
      credentials.is_test_environment,
      {
        requestId,
        stage: "auth-token-redeem",
        companyId: mask(credentials.my_company_id),
        nip: credentials.nip,
      }
    );

    const updatePayload = {
      access_token: redeemedTokens.accessToken?.token ?? null,
      access_token_valid_until: redeemedTokens.accessToken?.validUntil ?? null,
      refresh_token: redeemedTokens.refreshToken?.token ?? null,
      refresh_token_valid_until: redeemedTokens.refreshToken?.validUntil ?? null,
      last_auth_reference_number: authStart.referenceNumber,
      last_authenticated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("ksef_credentials")
      .update(updatePayload)
      .eq("id", credentials.id);

    if (updateError) {
      console.error(`${KSEF_LOG_PREFIX} failed to persist redeemed tokens`, {
        requestId,
        credentialsId: mask(credentials.id),
        code: updateError.code,
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint,
      });

      return NextResponse.json(
        {
          success: false,
          error: "Uwierzytelnienie KSeF się udało, ale nie zapisano tokenów w bazie",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        referenceNumber: authStart.referenceNumber,
        authStatus,
        redeemed: true,
        accessTokenValidUntil: redeemedTokens.accessToken?.validUntil ?? null,
        refreshTokenValidUntil: redeemedTokens.refreshToken?.validUntil ?? null,
      },
    });
  } catch (error) {
    console.error(`${KSEF_LOG_PREFIX} auth token route error`, {
      requestId,
      message: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}