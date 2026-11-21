import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { httpStatus } from '@/lib/social/socialCommon.server';
import { PORTFOLIO_LIMITS } from '@/lib/portfolio/portfolioShared';
import {
  portfolioAi, portfolioCreate, portfolioDelete, portfolioDiscard, portfolioEvents, portfolioHome, portfolioImport, portfolioItem,
  portfolioPhotos, portfolioPublish, portfolioSave, portfolioSocialPost, portfolioUnpublish, portfolioUpload,
} from '@/lib/portfolio/portfolio.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/*
 * Marketing → „Realizacje” (portfolio strony) — jedno API dla CRM (`x-mavinci-client: web`), aplikacji na Maca i telefonu.
 * Token pracownika (Bearer), RLS i funkcje bazy (`src/lib/portfolio/portfolio.server.ts`); dostęp — edycja strony.
 * GET op=home | item&id | photos&source=event&event | photos&source=material&q | photos&source=social&q | events&q.
 * POST ?op=upload&id=<realizacja> — bajty zdjęcia (JPEG / PNG / WebP do 40 MB) → `{photo}` do dodania w kreatorze.
 * POST JSON op=create {title?, eventId?} | save {id, version, content, eventId} | publish {id, version, overwrite?} |
 *   discard {id} (kopia robocza = wersja ze strony) | unpublish {id, version} | delete {id, version, removeFromSite} |
 *   import {id, source: event | material | social, fileId, alt?} → `{photo}` |
 *   assist {id, content, eventId, brief, fields[], usePhotos} (asystent AI — propozycje bez zapisu) |
 *   socialPost {id, photos?[], channels?[], companyId?} → `{postId, companyId, photos}` (szkic posta social media z karuzelą).
 */

const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) => {
  const status = httpStatus(error);
  if (status >= 500) console.error('[native-portfolio]', error);
  return status >= 500 && !(error as { status?: number })?.status ? fallback : (error as Error)?.message || fallback;
};

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const params = new URL(request.url).searchParams;
  try {
    switch (params.get('op')) {
      case 'home':
        return nativeJson(await portfolioHome(ctx));
      case 'item':
        return nativeJson(await portfolioItem(ctx, params.get('id') || ''));
      case 'photos':
        return nativeJson(await portfolioPhotos(ctx, params));
      case 'events':
        return nativeJson(await portfolioEvents(ctx, params));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się załadować realizacji.'), httpStatus(error));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  if (url.searchParams.get('op') === 'upload') {
    if (Number(request.headers.get('content-length') || 0) > PORTFOLIO_LIMITS.uploadBytes) return failure('Zdjęcie może mieć najwyżej 40 MB.', 413);
    try {
      const bytes = Buffer.from(await request.arrayBuffer());
      return nativeJson(await portfolioUpload(ctx, url.searchParams.get('id') || '', bytes));
    } catch (error) {
      return failure(errorText(error, 'Nie udało się wgrać zdjęcia.'), httpStatus(error));
    }
  }
  let body: Record<string, any>;
  try {
    body = await readJson(request, 1_000_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  try {
    switch (String(body.op || '')) {
      case 'create':
        return nativeJson(await portfolioCreate(ctx, body));
      case 'save':
        return nativeJson(await portfolioSave(ctx, body));
      case 'publish':
        return nativeJson(await portfolioPublish(ctx, body));
      case 'discard':
        return nativeJson(await portfolioDiscard(ctx, body));
      case 'unpublish':
        return nativeJson(await portfolioUnpublish(ctx, body));
      case 'delete':
        return nativeJson(await portfolioDelete(ctx, body));
      case 'import':
        return nativeJson(await portfolioImport(ctx, body));
      case 'assist':
        return nativeJson(await portfolioAi(ctx, body));
      case 'socialPost':
        return nativeJson(await portfolioSocialPost(ctx, body));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się zapisać realizacji.'), httpStatus(error));
  }
}
