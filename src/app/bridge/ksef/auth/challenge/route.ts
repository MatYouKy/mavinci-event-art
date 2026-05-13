import { NextResponse } from "next/server";
import { getKSeFChallenge } from '../../client';
import { getErrorMessage, KSEF_LOG_PREFIX } from '../../logger';


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
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