import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  assetCreate, assetDelete, assetDetail, assetFinish, assetImport, assetUpdate, assetUpload, consentSave, eventImages, eventsPicker,
  libraryList, portfolioPicker,
} from '@/lib/social/socialAssets.server';
import { httpStatus, isUuid } from '@/lib/social/socialCommon.server';
import {
  brandbookOptions, createPost, deletePost, duplicatePost, postPackage, publishNow, refreshComments, renderPost, replyComment, savePost,
  saveSettings, saveTemplate, schedulePost, schedulePublication, socialComments, socialHome, socialPost, suggestPost, transitionPost,
} from '@/lib/social/socialPosts.server';
import { generateReport, refreshCompanyMetrics, refreshPostMetrics, socialStats } from '@/lib/social/socialReport.server';
import { pdfContentDisposition } from '@/lib/print/pdfRenderer.server';
import { SOCIAL_LIMITS } from '@/lib/social/socialShared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/*
 * Marketing → „Social media” — jedno API dla web CRM (`x-mavinci-client: web`), aplikacji na Maca i telefonu.
 * Token pracownika (Bearer), RLS i funkcje bazy jak w przeglądarce (`src/lib/social/*`).
 * GET op=home&company&from&to | post&id | library&company&status&event&consent&used&q&offset&limit | asset&id |
 *   events&company&q | eventImages&event | portfolio&q | brandbook&company | package&id (ZIP: grafiki + opis.txt) |
 *   comments&post | comments&company&filter=unanswered (wątki komentarzy Facebook i Instagram) |
 *   stats&company&days=7|28|90&report (zakładka „Statystyki” i raport tygodniowy „Trendy i rekomendacje”).
 * POST ?op=upload&id=<zdjęcie> — bajty zdjęcia (po assetCreate; Mac i telefon).
 * POST JSON op=createPost {companyId, channels, scheduledAt, eventId, assetId, formats, headline, subline, title} |
 *   savePost {id, updatedAt, …pola, variants[{format, assetId, crop, headline, subline}], render} | renderPost {id} |
 *   transition {id, action, revision, note, url} | schedule {id, updatedAt, scheduledAt} | duplicate {id} | deletePost {id} |
 *   suggest {id} | assetCreate {companyId, eventId, fileName, mimeType, bytes, source} | assetFinish {id} |
 *   assetImport {companyId, eventFileId | portfolioProjectId + imageUrl} | assetUpdate {id, updatedAt, …} | assetDelete {id} |
 *   consent {eventId | organizationId, status, channels, note} | settings {companyId, …} | template {companyId, id?, …} |
 *   schedulePublication {id, scheduledAt, revision} | publishNow {id, revision} (publikacja w Meta, wynik w `publishResult`) |
 *   commentsRefresh {postId | companyId, filter} | reply {commentId, message, scope: post | company, filter} |
 *   metricsRefresh {postId} → karta posta | metricsRefresh {companyId, days, report} → statystyki |
 *   reportGenerate {companyId, weekStart?, days} (twórca treści; raport za poprzedni albo wskazany tydzień) → statystyki.
 */

const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) => {
  const status = httpStatus(error);
  const message = (error as { message?: string } | null)?.message;
  return status >= 500 && !(error as { status?: number })?.status ? fallback : message || fallback;
};

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  const params = url.searchParams;
  const id = params.get('id') || '';
  try {
    switch (params.get('op')) {
      case 'home':
        return nativeJson(await socialHome(ctx, params));
      case 'post':
        if (!isUuid(id)) return failure('Nie znaleziono posta.', 404);
        return nativeJson(await socialPost(ctx, id));
      case 'library':
        return nativeJson(await libraryList(ctx, params));
      case 'asset':
        if (!isUuid(id)) return failure('Nie znaleziono zdjęcia.', 404);
        return nativeJson(await assetDetail(ctx, id));
      case 'events':
        return nativeJson(await eventsPicker(ctx, params));
      case 'eventImages':
        return nativeJson(await eventImages(ctx, params.get('event') || ''));
      case 'portfolio':
        return nativeJson(await portfolioPicker(ctx, params));
      case 'brandbook':
        return nativeJson(await brandbookOptions(ctx, params.get('company') || ''));
      case 'comments':
        return nativeJson(await socialComments(ctx, params));
      case 'stats':
        return nativeJson(await socialStats(ctx, params));
      case 'package': {
        if (!isUuid(id)) return failure('Nie znaleziono posta.', 404);
        const { fileName, zip } = await postPackage(ctx, id);
        return new Response(new Uint8Array(zip), {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': pdfContentDisposition(fileName, true),
            'Cache-Control': 'private, no-store',
          },
        });
      }
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (httpStatus(error) >= 500) console.error('[native-social]', error);
    return failure(errorText(error, 'Nie udało się załadować social media.'), httpStatus(error));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  // Plik zdjęcia (Mac, telefon): POST ?op=upload&id=<zdjęcie>, treść — bajty JPEG / PNG / WebP (do 40 MB).
  if (url.searchParams.get('op') === 'upload') {
    const id = url.searchParams.get('id') || '';
    if (!isUuid(id)) return failure('Nie znaleziono zdjęcia.', 404);
    if (Number(request.headers.get('content-length') || 0) > SOCIAL_LIMITS.uploadBytes) return failure('Zdjęcie może mieć najwyżej 40 MB.', 413);
    try {
      return nativeJson(await assetUpload(ctx, id, Buffer.from(await request.arrayBuffer())));
    } catch (error) {
      if (httpStatus(error) >= 500) console.error('[native-social] upload', error);
      return failure(errorText(error, 'Nie udało się wgrać zdjęcia.'), httpStatus(error));
    }
  }
  let body: Record<string, any>;
  try {
    body = await readJson(request, 2_000_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  const id = String(body.id || '');
  try {
    switch (op) {
      case 'createPost':
        return nativeJson(await createPost(ctx, body));
      case 'savePost':
        return nativeJson(await savePost(ctx, body));
      case 'renderPost':
        return nativeJson(await renderPost(ctx, id));
      case 'transition':
        return nativeJson(await transitionPost(ctx, body));
      case 'schedule':
        return nativeJson(await schedulePost(ctx, body));
      case 'duplicate':
        return nativeJson(await duplicatePost(ctx, id));
      case 'deletePost':
        return nativeJson(await deletePost(ctx, id));
      case 'suggest':
        return nativeJson(await suggestPost(ctx, id));
      case 'assetCreate':
        return nativeJson(await assetCreate(ctx, body));
      case 'assetFinish':
        if (!isUuid(id)) return failure('Nie znaleziono zdjęcia.', 404);
        return nativeJson(await assetFinish(ctx, id));
      case 'assetImport':
        return nativeJson(await assetImport(ctx, body));
      case 'assetUpdate':
        return nativeJson(await assetUpdate(ctx, body));
      case 'assetDelete':
        return nativeJson(await assetDelete(ctx, id));
      case 'consent':
        return nativeJson(await consentSave(ctx, body));
      case 'settings':
        return nativeJson(await saveSettings(ctx, body));
      case 'template':
        return nativeJson(await saveTemplate(ctx, body));
      case 'schedulePublication':
        return nativeJson(await schedulePublication(ctx, body));
      case 'publishNow':
        return nativeJson(await publishNow(ctx, body));
      case 'commentsRefresh':
        return nativeJson(await refreshComments(ctx, body));
      case 'reply':
        return nativeJson(await replyComment(ctx, body));
      case 'metricsRefresh':
        if (isUuid(body.postId)) {
          await refreshPostMetrics(ctx, String(body.postId).toLowerCase());
          return nativeJson(await socialPost(ctx, String(body.postId).toLowerCase()));
        }
        return nativeJson(await refreshCompanyMetrics(ctx, body));
      case 'reportGenerate':
        return nativeJson(await generateReport(ctx, body));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (httpStatus(error) >= 500) console.error('[native-social]', op, error);
    return failure(errorText(error, 'Nie udało się zapisać zmian w social media.'), httpStatus(error));
  }
}
