import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  addCity, addCityCase, addPlace, cityCases, cityPlace, citySearch, deleteCityCase, deletePlace, marketingAnalysis, marketingCampaignStatus,
  marketingMessageRead, marketingOverview, marketingSelectCompany, marketingSync, onlineUsers, resetAnalytics, saveSchemaGlobal, schemaOrg,
  searchCities, updateCityCase, updatePlace, websiteAnalytics, websitePages,
} from '@/lib/native/website';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/*
 * Strona dla aplikacji na Maca (`src/lib/native/website.ts`): GET op=pages&days | analytics&range[&from&to][&url] | online |
 * schema | cities&query | cityCases | citySearch&input&sessiontoken | cityPlace&placeId&sessiontoken | marketing[&companyId];
 * POST op=resetAnalytics {password} | schemaGlobal {id, values} | placeAdd | placeUpdate {id} | placeDelete {id} | cityAdd |
 * caseAdd | caseUpdate {id} | caseDelete {id} | marketingCompany {companyId} | marketingSync {companyId} |
 * marketingCampaign {companyId, campaignId, status} | marketingMessageRead {companyId, messageId} | marketingAnalysis {companyId}.
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) => (error as { message?: string })?.message || fallback;
const statusOf = (error: unknown) => {
  const status = (error as { status?: number } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 600 ? status : 500;
};

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  const q = (key: string) => url.searchParams.get(key) || '';
  try {
    switch (q('op')) {
      case 'pages':
        return nativeJson(await websitePages(ctx, Number(q('days')) || 30));
      case 'analytics':
        return nativeJson(await websiteAnalytics(ctx, Number(q('range')) || 30, q('from') || null, q('to') || null, q('url') || null));
      case 'online':
        return nativeJson(await onlineUsers(ctx));
      case 'schema':
        return nativeJson(await schemaOrg(ctx));
      case 'cities':
        return nativeJson(await searchCities(ctx, q('query')));
      case 'cityCases':
        return nativeJson(await cityCases(ctx));
      case 'citySearch':
        return nativeJson(await citySearch(ctx, url.searchParams));
      case 'cityPlace':
        return nativeJson(await cityPlace(ctx, url.searchParams));
      case 'marketing': {
        const companyId = q('companyId');
        if (companyId && !uuid.test(companyId)) return failure('Nieprawidłowa marka.');
        return nativeJson(await marketingOverview(ctx, companyId || null));
      }
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-website]', error);
    return failure(errorText(error, 'Nie udało się wczytać danych strony.'), statusOf(error));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  let body: Record<string, any>;
  try {
    body = await readJson(request, 128_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const id = String(body.id || '');
  const companyId = String(body.companyId || '');
  const needs = (value: string, message: string) => {
    if (!uuid.test(value)) throw Object.assign(new Error(message), { status: 400 });
  };
  try {
    switch (String(body.op || '')) {
      case 'resetAnalytics':
        return nativeJson(await resetAnalytics(ctx, body));
      case 'schemaGlobal':
        return nativeJson(await saveSchemaGlobal(ctx, body));
      case 'placeAdd':
        return nativeJson(await addPlace(ctx, body));
      case 'placeUpdate':
        needs(id, 'Nieprawidłowe miejsce.');
        return nativeJson(await updatePlace(ctx, id, body));
      case 'placeDelete':
        needs(id, 'Nieprawidłowe miejsce.');
        return nativeJson(await deletePlace(ctx, id));
      case 'cityAdd':
        return nativeJson(await addCity(ctx, body));
      case 'caseAdd':
        return nativeJson(await addCityCase(ctx, body));
      case 'caseUpdate':
        needs(id, 'Nieprawidłowy wyjątek odmiany.');
        return nativeJson(await updateCityCase(ctx, id, body));
      case 'caseDelete':
        needs(id, 'Nieprawidłowy wyjątek odmiany.');
        return nativeJson(await deleteCityCase(ctx, id));
      case 'marketingCompany':
        needs(companyId, 'Nieprawidłowa marka.');
        return nativeJson(await marketingSelectCompany(ctx, companyId));
      case 'marketingSync':
        needs(companyId, 'Nieprawidłowa marka.');
        return nativeJson(await marketingSync(ctx, companyId));
      case 'marketingCampaign':
        needs(companyId, 'Nieprawidłowa marka.');
        needs(String(body.campaignId || ''), 'Nieprawidłowa kampania.');
        return nativeJson(await marketingCampaignStatus(ctx, companyId, String(body.campaignId), body.status));
      case 'marketingMessageRead':
        needs(companyId, 'Nieprawidłowa marka.');
        needs(String(body.messageId || ''), 'Nieprawidłowa wiadomość.');
        return nativeJson(await marketingMessageRead(ctx, companyId, String(body.messageId)));
      case 'marketingAnalysis':
        needs(companyId, 'Nieprawidłowa marka.');
        return nativeJson(await marketingAnalysis(ctx, companyId));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    if (statusOf(error) >= 500 && statusOf(error) !== 503) console.error('[native-website]', error);
    return failure(errorText(error, 'Nie udało się zapisać zmian.'), statusOf(error));
  }
}
