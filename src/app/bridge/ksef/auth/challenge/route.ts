import { NextResponse } from "next/server";
import { requireSessionEmployee } from "@/lib/auth/requireEmployee.server";
import { getKSeFChallenge } from '../../client';
import { getErrorMessage, KSEF_LOG_PREFIX } from '../../logger';


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await requireSessionEmployee(request);
  if (!access.ok) return access.response;
  // Konfiguracja KSeF: „Zarządzanie finansami” w co najmniej jednej działalności (finance_can_manage),
  // nie stare uprawnienia ksef_manage / invoices_manage / finances_manage.
  const { data: canManageFinance, error: permissionError } = await access.client.rpc("finance_can_manage");
  if (permissionError || canManageFinance !== true) {
    return NextResponse.json({ success: false, error: "Brak uprawnień do KSeF." }, { status: 403 });
  }

  const requestId = crypto.randomUUID();

  try {
    const challenge = await getKSeFChallenge(true, {
      requestId,
      stage: "challenge",
    });
    return NextResponse.json({
      success: true,
      data: challenge,
    });
  } catch (error) {
    console.error(`${KSEF_LOG_PREFIX} challenge route error`, {
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