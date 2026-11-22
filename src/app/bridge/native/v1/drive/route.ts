import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  DriveError, driveCancelScan, driveCancelUpload, driveCompleteScan, driveCompleteUpload, driveDeleteFile, driveDownload, driveList, drivePrepareScan,
  drivePrepareUpload, driveRoot, driveSync,
} from '@/lib/drive/drive.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/*
 * Dysk — działy chmury poza Eventami (`/bridge/native/v1/files`) i Materiałami (`/bridge/native/v1/materials`): Finanse (firma →
 * Księgowość → rok → miesiąc → teczka, Dokumenty spółki → kategoria, Umowy stałe → umowa; według dostępu do finansów firmy,
 * pliki do Kosztów, Dokumentów spółki i umów — „Finanse — zarządzanie”), Oferty,
 * Kalkulacje, Umowy (PDF-y z CRM, rok → miesiąc, tylko do odczytu), Magazyn (kategoria → sprzęt → pliki; dodawanie plików
 * z prawem „Zarządzanie magazynem”), Pracownicy (pracownik → Zdjęcia, Dokumenty, Umowy; dokumenty dodaje sam pracownik
 * i „Pracownicy — zarządzanie”) i księga znaku marki. Jedno API dla CRM, Findera, aplikacji na Maca i telefonu
 * (`src/lib/drive/drive.server.ts`, typy — `src/lib/drive/driveShared.ts`). Token pracownika (Bearer), RLS jak w CRM.
 * GET op=root | list&node=<finance|finance:<firma>[:books[:2026[-11[:sales|costs|bank|taxes|ksef]]]|:corporate[:<kategoria>]|
 *   :contracts[:<umowa>]]|offers|offers:2026|
 *   offers:2026-11|warehouse|warehouse:cat:<id>|warehouse:item:<id>|employees|employees:<id>|employees:<id>:photos|documents|contracts|
 *   brand:<firma>> | download&id=<typ:uuid>&mode=preview|download |
 *   sync (całe drzewo dla Findera).
 * POST JSON op=prepareUpload {parentId: warehouse:item:<id> | employees:<id>:documents | finance:<firma>:books:RRRR-MM:costs |
 *   finance:<firma>:corporate:<kategoria> | finance:<firma>:contracts:<umowa>, name, size, mime} → podpisany adres wysyłki |
 *   completeUpload {parentId, bucket, path, name, size, mime, title?, documentType?, description?, expiryDate?, documentDate?} → {file, notice?} |
 *   cancelUpload {parentId, bucket, path} | deleteFile {id: employee-document:<id> | company-document:<id> | agreement-file:<id>} |
 *   prepareScan {parentId (folder Finansów), pages} → adresy stron | completeScan {parentId, scanId, pages, title?} → {file, notice?} |
 *   cancelScan {parentId, scanId, pages}.
 */

function failure(error: unknown, fallback: string) {
  if (error instanceof DriveError) {
    if (error.status >= 500) console.error('[native-drive]', error.message);
    return nativeJson({ error: error.message, ...error.extra }, error.status);
  }
  console.error('[native-drive]', error);
  return nativeJson({ error: fallback }, 500);
}

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const params = new URL(request.url).searchParams;
  try {
    switch (params.get('op')) {
      case 'root':
        return nativeJson(await driveRoot(ctx));
      case 'list':
        return nativeJson(await driveList(ctx, params.get('node') || ''));
      case 'download':
        return nativeJson(await driveDownload(ctx, params.get('id') || '', params.get('mode') === 'preview' ? 'preview' : 'download'));
      case 'sync':
        return nativeJson(await driveSync(ctx));
      default:
        return nativeJson({ error: 'Nieznana operacja.' }, 400);
    }
  } catch (error) {
    return failure(error, 'Nie udało się załadować Dysku.');
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  let body: Record<string, any>;
  try {
    body = await readJson(request, 100_000);
  } catch {
    return nativeJson({ error: 'Nieprawidłowe dane.' }, 400);
  }
  try {
    switch (String(body.op || '')) {
      case 'prepareUpload':
        return nativeJson(await drivePrepareUpload(ctx, body));
      case 'completeUpload':
        return nativeJson(await driveCompleteUpload(ctx, body));
      case 'cancelUpload':
        return nativeJson(await driveCancelUpload(ctx, body));
      case 'deleteFile':
        return nativeJson(await driveDeleteFile(ctx, body));
      case 'prepareScan':
        return nativeJson(await drivePrepareScan(ctx, body));
      case 'completeScan':
        return nativeJson(await driveCompleteScan(ctx, body));
      case 'cancelScan':
        return nativeJson(await driveCancelScan(ctx, body));
      default:
        return nativeJson({ error: 'Nieznana operacja.' }, 400);
    }
  } catch (error) {
    return failure(error, 'Nie udało się wykonać operacji na Dysku.');
  }
}
