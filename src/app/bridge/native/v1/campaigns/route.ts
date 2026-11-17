import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  approveCampaign, campaignDemo, campaignRecipients, campaignsHome, cancelCampaign, createCampaign, isCampaignId, pauseCampaign,
  refreshAudience, resumeCampaign, saveCampaign, scheduleCampaign, sendTest, submitCampaign,
} from '@/lib/native/campaigns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/*
 * Kampanie e-mail dla aplikacji na Maca (`src/lib/native/campaigns.ts`): GET op=home | recipients&id | demo&id;
 * POST JSON op=create | save {id, updatedAt, …pola} | audience {id} | test {id, email} | submit {id} | approve {id} |
 * schedule {id, scheduledAt, batchSize, sendIntervalSeconds} | pause {id} | resume {id} | cancel {id}.
 * PDF kampanii z broszury: `/bridge/brochures/generate-pdf` (jak w CRM).
 */

const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) => (error as { message?: string })?.message || fallback;
const statusOf = (error: unknown) => (error as { status?: number } | null)?.status || 500;

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  try {
    switch (url.searchParams.get('op')) {
      case 'home':
        return nativeJson(await campaignsHome(ctx));
      case 'recipients':
        if (!isCampaignId(id)) return failure('Nie znaleziono kampanii.', 404);
        return nativeJson(await campaignRecipients(ctx, id));
      case 'demo':
        if (!isCampaignId(id)) return failure('Nie znaleziono kampanii.', 404);
        return nativeJson(await campaignDemo(ctx, id));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-campaigns]', error);
    return failure(errorText(error, 'Nie udało się załadować Centrum Kampanii'), statusOf(error));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  let body: Record<string, any>;
  try {
    body = await readJson(request, 2_000_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  const id = String(body.id || '');
  if (op !== 'create' && !isCampaignId(id)) return failure('Nie znaleziono kampanii.', 404);
  try {
    switch (op) {
      case 'create':
        return nativeJson(await createCampaign(ctx));
      case 'save':
        return nativeJson(await saveCampaign(ctx, id, body));
      case 'audience':
        return nativeJson(await refreshAudience(ctx, id));
      case 'test':
        return nativeJson(await sendTest(ctx, id, body.email));
      case 'submit':
        return nativeJson(await submitCampaign(ctx, id));
      case 'approve':
        return nativeJson(await approveCampaign(ctx, id));
      case 'schedule':
        return nativeJson(await scheduleCampaign(ctx, id, body));
      case 'pause':
        return nativeJson(await pauseCampaign(ctx, id));
      case 'resume':
        return nativeJson(await resumeCampaign(ctx, id));
      case 'cancel':
        return nativeJson(await cancelCampaign(ctx, id));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-campaigns]', error);
    return failure(errorText(error, 'Operacja nie powiodła się'), statusOf(error));
  }
}
