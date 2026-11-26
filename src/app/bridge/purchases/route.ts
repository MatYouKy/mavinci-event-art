import { NextResponse } from 'next/server';
import { requireSessionEmployee } from '@/lib/auth/requireEmployee.server';
import { purchaseFailure, purchasesGet, purchasesPost } from '@/lib/purchases/purchaseRoute.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/*
 * Zakupy → „Moje wydatki” w CRM (`docs/purchases.md`, `src/lib/purchases/purchaseRoute.server.ts`) — sesja z ciasteczek
 * (albo Bearer). Dane i prawa liczy baza (`purchase_*`), pliki — serwer po sprawdzeniu prawa.
 */

const respond = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: Request) {
  const session = await requireSessionEmployee(request);
  if (!session.ok) return session.response;
  try {
    return respond(await purchasesGet(session.client, new URL(request.url).searchParams));
  } catch (error) {
    const { message, status } = purchaseFailure(error, 'Nie udało się wczytać zakupów.');
    return respond({ error: message }, status);
  }
}

export async function POST(request: Request) {
  const session = await requireSessionEmployee(request);
  if (!session.ok) return session.response;
  try {
    return respond(await purchasesPost(session.client, request));
  } catch (error) {
    const { message, status } = purchaseFailure(error, 'Serwer nie wykonał operacji.');
    return respond({ error: message }, status);
  }
}
